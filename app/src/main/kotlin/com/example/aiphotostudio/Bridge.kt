@file:Suppress("DEPRECATION")
package com.example.aiphotostudio

import android.content.ContentResolver
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** WebView 与原生之间的桥。JS 侧通过 window.Android 调用。 */
class Bridge(
    private val activity: MainActivity,
    private val cfg: Config,
    private val pickLauncher: ActivityResultLauncher<Array<String>>,
    private val folderLauncher: ActivityResultLauncher<Uri?>,
) {
    companion object {
        const val VERSION = "2.1"
        private const val HISTORY_KEY = "history_json"
        private const val MAX_HISTORY = 60
    }

    // ---------- JS 回调工具 ----------
    private fun jsStr(s: String): String {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "") + "\""
    }
    private fun progress(id: String, text: String, pct: Int) {
        activity.evalJs("window.__apiProgress && window.__apiProgress(" +
            jsStr(id) + "," + jsStr(text) + "," + pct + ")")
    }
    private fun finish(id: String, json: String) {
        activity.evalJs("window.__apiResult && window.__apiResult(" +
            jsStr(id) + "," + json + ")")
    }

    // ---------- 配置 ----------
    @JavascriptInterface
    fun getConfig(): String = cfg.visibleConfig().toString()

    @JavascriptInterface
    fun getAppVersion(): String = VERSION

    @JavascriptInterface
    fun saveConfig(json: String): String {
        return try {
            cfg.update(JSONObject(json))
            obj { put("ok", true) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun testConnection(): String {
        return try {
            val message: String = AgnesClient(cfg).test()
            obj { put("ok", true); put("message", message) }
        } catch (e: Exception) { errorJson(e) }
    }

    // ---------- 主题 ----------
    @JavascriptInterface
    fun setTheme(mode: String) { activity.runOnUiThread { activity.applyThemeMode(mode) } }

    @JavascriptInterface
    fun getSystemTheme(): String = activity.systemTheme()

    @JavascriptInterface
    fun toast(message: String) {
        activity.runOnUiThread { Toast.makeText(activity, message, Toast.LENGTH_SHORT).show() }
    }

    // ---------- 异步 API（不阻塞 UI，带进度） ----------
    /** payload.images 传图片 URI（content://）或 data URI。后台线程读取并请求。 */
    @JavascriptInterface
    fun callApiAsync(payload: String, callbackId: String) {
        Thread {
            var tickerDone = false
            val ticker = Thread {
                var p = 56
                try {
                    while (!tickerDone && p < 90) {
                        Thread.sleep(1100)
                        if (!tickerDone) { p += 4; progress(callbackId, "AI 正在生成图像…", p) }
                    }
                } catch (e: Exception) {}
            }
            ticker.isDaemon = true
            try {
                progress(callbackId, "解析参数…", 8)
                val req = JSONObject(payload)
                val prompt: String = req.optString("prompt", "")
                val size: String = req.optString("size", cfg.get("size", "2K"))
                val ratioText: String = req.optString("ratio", "")
                val ratio: String? = if (ratioText.trim().isEmpty()) null else ratioText

                val uriArr = req.optJSONArray("images")
                val uris = mutableListOf<String>()
                if (uriArr != null) {
                    var i = 0
                    while (i < uriArr.length()) { uris.add(uriArr.getString(i)); i++ }
                }
                val dataUris = mutableListOf<String>()
                if (uris.isNotEmpty()) {
                    progress(callbackId, "读取图像…", 20)
                    var i = 0
                    while (i < uris.size) {
                        val u = uris[i]
                        if (u.startsWith("data:")) dataUris.add(u)
                        else {
                            val pair = decodeUri(Uri.parse(u))
                            dataUris.add(pair.first)
                        }
                        progress(callbackId, "已读取 " + (i + 1) + "/" + uris.size + " 张图像", 20 + (i + 1) * 20 / uris.size)
                        i++
                    }
                }
                progress(callbackId, "连接 Agnes AI…", 52)
                ticker.start()
                val result = AgnesClient(cfg).generate(prompt, size, ratio, dataUris)
                tickerDone = true
                progress(callbackId, "处理生成结果…", 92)
                val out = obj {
                    put("ok", true)
                    put("kind", result.getString("kind"))
                    put("data", result.getString("data"))
                }
                progress(callbackId, "完成", 100)
                finish(callbackId, out)
            } catch (e: Exception) {
                tickerDone = true
                finish(callbackId, errorJson(e))
            }
        }.start()
    }

    @JavascriptInterface
    fun enhancePrompt(prompt: String): String {
        return try {
            val result: String = AgnesClient(cfg).enhancePrompt(prompt)
            obj { put("ok", true); put("result", result) }
        } catch (e: Exception) { errorJson(e) }
    }

    // ---------- 选图 / 选文件夹 ----------
    @JavascriptInterface
    fun pickImage(): String {
        activity.runOnUiThread {
            try { pickLauncher.launch(arrayOf("image/*")) }
            catch (e: Exception) { activity.evalJs("window.onImagePicked && window.onImagePicked(" + errorJson(e) + ")") }
        }
        return "{\"ok\":true,\"pending\":true}"
    }

    @JavascriptInterface
    fun pickFolder(): String {
        activity.runOnUiThread {
            try { folderLauncher.launch(null) }
            catch (e: Exception) { activity.evalJs("window.onFolderPicked && window.onFolderPicked(" + errorJson(e) + ")") }
        }
        return "{\"ok\":true,\"pending\":true}"
    }

    @JavascriptInterface
    fun readImage(uriString: String): String {
        return try {
            val uri = Uri.parse(uriString)
            val pair = decodeUri(uri)
            obj {
                put("ok", true); put("uri", uriString); put("dataUri", pair.first)
                put("width", pair.second.first); put("height", pair.second.second)
                put("name", displayName(uri) ?: "image")
            }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun listImages(folderUri: String): String {
        return try {
            val tree = Uri.parse(folderUri)
            val rootId: String = DocumentsContract.getTreeDocumentId(tree)
            val childrenUri: Uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId)
            val items = JSONArray()
            walkTree(activity.contentResolver, tree, childrenUri, arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE), items, 0)
            obj { put("ok", true); put("files", items) }
        } catch (e: Exception) { errorJson(e) }
    }

    private fun walkTree(resolver: ContentResolver, tree: Uri, parent: Uri,
                         projection: Array<String>, items: JSONArray, depth: Int) {
        if (depth > 8) return
        val cursor = resolver.query(parent, projection, null, null, null) ?: return
        try {
            while (cursor.moveToNext()) {
                val mime: String = cursor.getString(2) ?: ""
                val id: String = cursor.getString(0) ?: continue
                val name: String = cursor.getString(1) ?: "image"
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    walkTree(resolver, tree, DocumentsContract.buildChildDocumentsUriUsingTree(tree, id), projection, items, depth + 1)
                } else if (mime.startsWith("image/")) {
                    val item = JSONObject()
                    item.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString())
                    item.put("name", name)
                    items.put(item)
                }
            }
        } finally { cursor.close() }
    }

    @JavascriptInterface
    fun saveImage(dataUrl: String, filename: String): String {
        return try {
            val comma = dataUrl.indexOf(',')
            val raw: String = if (comma >= 0) dataUrl.substring(comma + 1) else dataUrl
            val bytes = Base64.decode(raw, Base64.DEFAULT)
            var name: String = filename.replace(Regex("[^A-Za-z0-9._\\-]"), "_")
            if (!name.endsWith(".png") && !name.endsWith(".jpg") && !name.endsWith(".jpeg")) name += ".png"
            val values = android.content.ContentValues()
            values.put(MediaStore.Downloads.DISPLAY_NAME, name)
            values.put(MediaStore.Downloads.MIME_TYPE, "image/png")
            values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/AIPhotoStudio")
            values.put(MediaStore.Downloads.IS_PENDING, 1)
            val resolver = activity.contentResolver
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw Exception("无法创建文件")
            val out = resolver.openOutputStream(uri)
            if (out != null) { out.write(bytes); out.close() }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            obj { put("ok", true); put("path", "Download/AIPhotoStudio/" + name) }
        } catch (e: Exception) { errorJson(e) }
    }

    // ---------- 历史记录 ----------
    private fun readHistory(): JSONArray {
        val prefs = activity.getSharedPreferences("ai_photo_studio", android.content.Context.MODE_PRIVATE)
        val raw: String = prefs.getString(HISTORY_KEY, "[]") ?: "[]"
        return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
    }
    private fun writeHistory(arr: JSONArray) {
        val prefs = activity.getSharedPreferences("ai_photo_studio", android.content.Context.MODE_PRIVATE)
        prefs.edit().putString(HISTORY_KEY, arr.toString()).apply()
    }

    @JavascriptInterface
    fun getHistory(): String {
        return try { obj { put("ok", true); put("items", readHistory()) } }
        catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun saveHistory(entry: String): String {
        return try {
            val arr = readHistory()
            arr.put(0, JSONObject(entry))
            while (arr.length() > MAX_HISTORY) arr.remove(arr.length() - 1)
            writeHistory(arr)
            obj { put("ok", true) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun clearHistory(): String {
        return try { writeHistory(JSONArray()); obj { put("ok", true) } }
        catch (e: Exception) { errorJson(e) }
    }

    fun onImagePicked(uri: Uri) {
        try {
            val pair = decodeUri(uri)
            val o = obj {
                put("ok", true); put("uri", uri.toString()); put("dataUri", pair.first)
                put("width", pair.second.first); put("height", pair.second.second)
                put("name", displayName(uri) ?: "image")
            }
            activity.evalJs("window.onImagePicked && window.onImagePicked(" + o.toString() + ")")
        } catch (e: Exception) {
            activity.evalJs("window.onImagePicked && window.onImagePicked(" + errorJson(e) + ")")
        }
    }

    fun onFolderPicked(uri: Uri) {
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: Exception) {}
        val o = obj { put("ok", true); put("uri", uri.toString()) }
        activity.evalJs("window.onFolderPicked && window.onFolderPicked(" + o.toString() + ")")
    }

    // ---------- 图像处理 ----------
    private fun decodeUri(uri: Uri): Pair<String, Pair<Int, Int>> {
        val cr = activity.contentResolver
        val bounds = BitmapFactory.Options()
        bounds.inJustDecodeBounds = true
        val firstInput = cr.openInputStream(uri)
        if (firstInput != null) {
            BitmapFactory.decodeStream(firstInput, null, bounds); firstInput.close()
        }
        val ow = bounds.outWidth; val oh = bounds.outHeight
        if (ow <= 0 || oh <= 0) throw Exception("无法读取图片尺寸")
        val maxEdge: Int = cfg.getInt("max_long_edge", 2560).coerceIn(512, 8192)
        var sample = 1
        while (Math.max(ow, oh) / sample > maxEdge * 2) sample *= 2
        val opts = BitmapFactory.Options()
        opts.inSampleSize = sample; opts.inPreferredConfig = Bitmap.Config.ARGB_8888
        val input = cr.openInputStream(uri) ?: throw Exception("无法打开图片")
        var bitmap: Bitmap = BitmapFactory.decodeStream(input, null, opts) ?: throw Exception("无法解码图片")
        input.close()
        bitmap = fixRotation(cr, uri, bitmap)
        if (Math.max(bitmap.width, bitmap.height) > maxEdge) {
            val scale = maxEdge.toFloat() / Math.max(bitmap.width, bitmap.height).toFloat()
            val w = Math.max(1, (bitmap.width.toFloat() * scale).toInt())
            val h = Math.max(1, (bitmap.height.toFloat() * scale).toInt())
            bitmap = Bitmap.createScaledBitmap(bitmap, w, h, true)
        }
        val hasAlpha = bitmap.config == Bitmap.Config.ARGB_8888
        val out = ByteArrayOutputStream()
        var quality = 92
        val limit: Int = cfg.getInt("max_upload_mb", 12).coerceIn(1, 100) * 1024 * 1024
        while (true) {
            out.reset()
            if (hasAlpha) bitmap.compress(Bitmap.CompressFormat.PNG, quality, out)
            else bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            if (out.size() <= limit || quality <= 40) break
            quality -= 12
        }
        val mime: String = if (hasAlpha) "image/png" else "image/jpeg"
        val data: String = "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return Pair(data, Pair(ow, oh))
    }

    private fun fixRotation(cr: ContentResolver, uri: Uri, bitmap: Bitmap): Bitmap {
        return try {
            val cursor = cr.query(uri, arrayOf(MediaStore.Images.Media.ORIENTATION), null, null, null) ?: return bitmap
            var degree = 0
            try { if (cursor.moveToFirst()) degree = cursor.getInt(0) } finally { cursor.close() }
            if (degree == 0 || degree == 360) return bitmap
            val matrix = Matrix(); matrix.postRotate(degree.toFloat())
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (e: Exception) { bitmap }
    }

    private fun displayName(uri: Uri): String? {
        val cursor = activity.contentResolver.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null) ?: return null
        try { return if (cursor.moveToFirst()) cursor.getString(0) else null } finally { cursor.close() }
    }

    private fun obj(builder: JSONObject.() -> Unit): String {
        val o = JSONObject(); o.builder(); return o.toString()
    }
    private fun errorJson(e: Exception): String {
        val o = JSONObject()
        o.put("ok", false)
        o.put("error", e.javaClass.simpleName + ": " + (e.message ?: ""))
        return o.toString()
    }
}
