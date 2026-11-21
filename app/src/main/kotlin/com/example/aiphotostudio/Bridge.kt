@file:Suppress("DEPRECATION")
package com.example.aiphotostudio

import android.content.ContentResolver
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
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
import java.io.File

/** WebView 与原生之间的桥。JS 侧通过 window.Android 调用。 */
class Bridge(
    private val activity: MainActivity,
    private val cfg: Config,
    private val pickLauncher: ActivityResultLauncher<Array<String>>,
    private val folderLauncher: ActivityResultLauncher<Uri?>,
) {
    companion object {
        const val VERSION = "3.0"
        private const val HISTORY_FILE = "history.json"
        private const val MAX_HISTORY = 24
    }

    private val historyLock = Any()

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
    private fun evalCallback(name: String, id: String, json: String) {
        activity.evalJs("window." + name + " && window." + name + "(" + jsStr(id) + "," + json + ")")
    }
    private fun enhanceProgress(id: String, text: String, pct: Int) {
        activity.evalJs("window.__enhanceProgress && window.__enhanceProgress(" +
            jsStr(id) + "," + jsStr(text) + "," + pct + ")")
    }

    // ---------- 配置 ----------
    @JavascriptInterface
    fun getConfig(): String = cfg.visibleConfig().toString()

    @JavascriptInterface
    fun getAppVersion(): String = obj { put("ok", true); put("version", VERSION) }

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

    @JavascriptInterface
    fun testConnectionAsync(callbackId: String) {
        Thread {
            try {
                val message: String = AgnesClient(cfg).test()
                evalCallback("__testResult", callbackId, obj { put("ok", true); put("message", message) })
            } catch (e: Exception) {
                evalCallback("__testResult", callbackId, errorJson(e))
            }
        }.start()
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

    @JavascriptInterface
    fun enhancePromptAsync(prompt: String, callbackId: String) {
        Thread {
            try {
                enhanceProgress(callbackId, "AI 正在优化描述…", 35)
                val result: String = AgnesClient(cfg).enhancePrompt(prompt)
                evalCallback("__enhanceResult", callbackId, obj { put("ok", true); put("result", result) })
            } catch (e: Exception) {
                evalCallback("__enhanceResult", callbackId, errorJson(e))
            }
        }.start()
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

    /** 读取原图（本地无损放大专用）：最多 4096 长边，不做上传体积压缩。 */
    @JavascriptInterface
    fun readImageFull(uriString: String): String {
        return try {
            val uri = Uri.parse(uriString)
            val pair = decodeUri(uri, maxEdgeOverride = 4096, uploadLimit = false)
            obj {
                put("ok", true); put("uri", uriString); put("dataUri", pair.first)
                put("width", pair.second.first); put("height", pair.second.second)
                put("name", displayName(uri) ?: "image")
            }
        } catch (e: Exception) { errorJson(e) }
    }

    /** 异步读取图片，避免大图解码阻塞 WebView。full=1 时读取原图。 */
    @JavascriptInterface
    fun readImageAsync(uriString: String, full: String, callbackId: String) {
        Thread {
            try {
                val uri = Uri.parse(uriString)
                val isFull = full == "1"
                val pair = if (isFull) decodeUri(uri, maxEdgeOverride = 4096, uploadLimit = false)
                else decodeUri(uri)
                evalCallback("__readImageResult", callbackId, obj {
                    put("ok", true); put("uri", uriString); put("dataUri", pair.first)
                    put("width", pair.second.first); put("height", pair.second.second)
                    put("name", displayName(uri) ?: "image")
                })
            } catch (e: Exception) {
                evalCallback("__readImageResult", callbackId, errorJson(e))
            }
        }.start()
    }

    @JavascriptInterface
    fun imageInfo(uriString: String): String {
        return try {
            val uri = Uri.parse(uriString)
            val bounds = BitmapFactory.Options()
            bounds.inJustDecodeBounds = true
            activity.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw Exception("无法读取图片尺寸")
            obj { put("ok", true); put("width", bounds.outWidth); put("height", bounds.outHeight) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun listImages(folderUri: String): String {
        return try {
            obj { put("ok", true); put("files", listImagesInternal(folderUri, true)) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun listImagesAsync(folderUri: String, recursive: String, callbackId: String) {
        Thread {
            try {
                val items = listImagesInternal(folderUri, recursive == "1")
                evalCallback("__listResult", callbackId, obj { put("ok", true); put("files", items) })
            } catch (e: Exception) {
                evalCallback("__listResult", callbackId, errorJson(e))
            }
        }.start()
    }

    private fun listImagesInternal(folderUri: String, recursive: Boolean): JSONArray {
        val tree = Uri.parse(folderUri)
        val rootId: String = DocumentsContract.getTreeDocumentId(tree)
        val childrenUri: Uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId)
        val items = mutableListOf<JSONObject>()
        walkTree(activity.contentResolver, tree, childrenUri, arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE), items, 0, recursive)
        items.sortBy { it.optString("name").lowercase() }
        val arr = JSONArray()
        for (item in items) arr.put(item)
        return arr
    }

    private fun walkTree(resolver: ContentResolver, tree: Uri, parent: Uri,
                         projection: Array<String>, items: MutableList<JSONObject>,
                         depth: Int, recursive: Boolean) {
        if (depth > 8) return
        val cursor = resolver.query(parent, projection, null, null, null) ?: return
        try {
            while (cursor.moveToNext()) {
                val mime: String = cursor.getString(2) ?: ""
                val id: String = cursor.getString(0) ?: continue
                val name: String = cursor.getString(1) ?: "image"
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    if (recursive) {
                        walkTree(resolver, tree, DocumentsContract.buildChildDocumentsUriUsingTree(tree, id),
                            projection, items, depth + 1, true)
                    }
                } else if (mime.startsWith("image/")) {
                    val item = JSONObject()
                    item.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString())
                    item.put("name", name)
                    items.add(item)
                }
            }
        } finally { cursor.close() }
    }

    // ---------- 保存图片 ----------
    @JavascriptInterface
    fun saveImage(dataUrl: String, filename: String): String {
        return try {
            val path = saveImageInternal(dataUrl, filename)
            obj { put("ok", true); put("path", path) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun saveImagesAsync(json: String, callbackId: String) {
        Thread {
            try {
                val arr = JSONArray(json)
                val results = JSONArray()
                var i = 0
                while (i < arr.length()) {
                    val item = arr.optJSONObject(i)
                    val dataUrl = item?.optString("dataUrl", "") ?: ""
                    val name = item?.optString("name", "image.png") ?: "image.png"
                    try {
                        val path = saveImageInternal(dataUrl, name)
                        results.put(obj { put("ok", true); put("path", path) })
                    } catch (e: Exception) {
                        results.put(obj { put("ok", false); put("error", e.message ?: "保存失败") })
                    }
                    i++
                }
                evalCallback("__saveImagesResult", callbackId, obj { put("ok", true); put("results", results) })
            } catch (e: Exception) {
                evalCallback("__saveImagesResult", callbackId, errorJson(e))
            }
        }.start()
    }

    private fun saveImageInternal(dataUrl: String, filename: String): String {
        val comma = dataUrl.indexOf(',')
        val raw: String = if (comma >= 0) dataUrl.substring(comma + 1) else dataUrl
        val bytes = Base64.decode(raw, Base64.DEFAULT)
        val mime = when {
            dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg") -> "image/jpeg"
            dataUrl.startsWith("data:image/webp") -> "image/webp"
            else -> "image/png"
        }
        val ext = when (mime) {
            "image/jpeg" -> ".jpg"
            "image/webp" -> ".webp"
            else -> ".png"
        }
        var base: String = filename.replace(Regex("[\\\\/:*?\"<>|\\r\\n]"), "_").trim()
        if (base.isEmpty()) base = "AI相馆_" + System.currentTimeMillis()
        val dot = base.lastIndexOf('.')
        if (dot > 0) base = base.substring(0, dot)
        if (base.isEmpty()) base = "AI相馆_" + System.currentTimeMillis()
        val finalName = base + ext

        val values = android.content.ContentValues()
        values.put(MediaStore.Downloads.DISPLAY_NAME, finalName)
        values.put(MediaStore.Downloads.MIME_TYPE, mime)
        values.put(MediaStore.Downloads.RELATIVE_PATH, "Download/AIPhotoStudio")
        values.put(MediaStore.Downloads.IS_PENDING, 1)
        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw Exception("无法创建文件")
        try {
            val out = resolver.openOutputStream(uri) ?: throw Exception("无法写入文件")
            out.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            try { resolver.delete(uri, null, null) } catch (ignore: Exception) {}
            throw e
        }
        return "Download/AIPhotoStudio/" + finalName
    }

    @JavascriptInterface
    fun existsImage(filename: String): String {
        return try {
            val projection = arrayOf(MediaStore.Downloads._ID)
            val selection = MediaStore.Downloads.DISPLAY_NAME + "=? AND " +
                MediaStore.Downloads.RELATIVE_PATH + " LIKE ?"
            val args = arrayOf(filename, "%AIPhotoStudio%")
            val cursor = activity.contentResolver.query(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI, projection, selection, args, null)
            val exists = cursor?.use { it.count > 0 } ?: false
            obj { put("ok", true); put("exists", exists) }
        } catch (e: Exception) { errorJson(e) }
    }

    // ---------- 历史记录（文件存储，支持多条与删除） ----------
    private val historyFile: File get() = File(activity.filesDir, HISTORY_FILE)

    private fun readHistory(): JSONArray {
        return try {
            if (historyFile.exists()) JSONArray(historyFile.readText()) else JSONArray()
        } catch (e: Exception) { JSONArray() }
    }
    private fun writeHistory(arr: JSONArray) {
        val tmp = File(activity.filesDir, HISTORY_FILE + ".tmp")
        tmp.writeText(arr.toString())
        if (!tmp.renameTo(historyFile)) {
            historyFile.writeText(arr.toString())
            tmp.delete()
        }
    }

    @JavascriptInterface
    fun getHistory(): String {
        return try {
            synchronized(historyLock) {
                obj { put("ok", true); put("items", readHistory()) }
            }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun saveHistory(entry: String): String {
        return try {
            synchronized(historyLock) {
                val arr = readHistory()
                val obj = JSONObject(entry)
                if (!obj.has("id")) obj.put("id", "h_" + System.currentTimeMillis())
                arr.put(0, obj)
                while (arr.length() > MAX_HISTORY) arr.remove(arr.length() - 1)
                writeHistory(arr)
            }
            obj { put("ok", true) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun deleteHistory(id: String): String {
        return try {
            synchronized(historyLock) {
                val arr = readHistory()
                val out = JSONArray()
                var i = 0
                while (i < arr.length()) {
                    val item = arr.optJSONObject(i)
                    if (item != null && item.optString("id") != id) out.put(item)
                    i++
                }
                writeHistory(out)
            }
            obj { put("ok", true) }
        } catch (e: Exception) { errorJson(e) }
    }

    @JavascriptInterface
    fun clearHistory(): String {
        return try {
            synchronized(historyLock) { writeHistory(JSONArray()) }
            obj { put("ok", true) }
        } catch (e: Exception) { errorJson(e) }
    }

    fun onImagePicked(uri: Uri) {
        try {
            val pair = decodeUri(uri)
            val o = obj {
                put("ok", true); put("uri", uri.toString()); put("dataUri", pair.first)
                put("width", pair.second.first); put("height", pair.second.second)
                put("name", displayName(uri) ?: "image")
            }
            activity.evalJs("window.onImagePicked && window.onImagePicked(" + o + ")")
        } catch (e: Exception) {
            activity.evalJs("window.onImagePicked && window.onImagePicked(" + errorJson(e) + ")")
        }
    }

    fun onFolderPicked(uri: Uri) {
        try {
            activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (e: Exception) {}
        val o = obj { put("ok", true); put("uri", uri.toString()) }
        activity.evalJs("window.onFolderPicked && window.onFolderPicked(" + o + ")")
    }

    // ---------- 图像处理 ----------
    private fun decodeUri(
        uri: Uri,
        maxEdgeOverride: Int? = null,
        uploadLimit: Boolean = true,
    ): Pair<String, Pair<Int, Int>> {
        val cr = activity.contentResolver
        val bounds = BitmapFactory.Options()
        bounds.inJustDecodeBounds = true
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val ow = bounds.outWidth; val oh = bounds.outHeight
        if (ow <= 0 || oh <= 0) throw Exception("无法读取图片尺寸")
        val maxEdge: Int = (maxEdgeOverride
            ?: cfg.getInt("max_long_edge", 2560)).coerceIn(512, 8192)
        var sample = 1
        while (Math.max(ow, oh) / sample > maxEdge * 2) sample *= 2
        val opts = BitmapFactory.Options()
        opts.inSampleSize = sample; opts.inPreferredConfig = Bitmap.Config.ARGB_8888
        var bitmap: Bitmap = cr.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, opts)
        } ?: throw Exception("无法解码图片")
        bitmap = fixRotation(cr, uri, bitmap)
        if (Math.max(bitmap.width, bitmap.height) > maxEdge) {
            val scale = maxEdge.toFloat() / Math.max(bitmap.width, bitmap.height).toFloat()
            val w = Math.max(1, (bitmap.width.toFloat() * scale).toInt())
            val h = Math.max(1, (bitmap.height.toFloat() * scale).toInt())
            bitmap = Bitmap.createScaledBitmap(bitmap, w, h, true)
        }
        val hasAlpha = hasTransparency(bitmap)
        val out = ByteArrayOutputStream()
        var quality = 92
        val limit: Int = if (uploadLimit)
            cfg.getInt("max_upload_mb", 12).coerceIn(1, 100) * 1024 * 1024 else Int.MAX_VALUE
        while (true) {
            out.reset()
            if (hasAlpha) bitmap.compress(Bitmap.CompressFormat.PNG, quality, out)
            else bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
            if (out.size() <= limit || quality <= 40) break
            quality -= 12
        }
        // 透明 PNG 压缩率有限：仍超限时继续缩小尺寸，保证能上传。
        if (uploadLimit && out.size() > limit) {
            var scaled = bitmap
            while (out.size() > limit && Math.max(scaled.width, scaled.height) > 640) {
                val w = Math.max(1, scaled.width * 3 / 4)
                val h = Math.max(1, scaled.height * 3 / 4)
                scaled = Bitmap.createScaledBitmap(scaled, w, h, true)
                out.reset()
                if (hasAlpha) scaled.compress(Bitmap.CompressFormat.PNG, 92, out)
                else scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
            }
            bitmap = scaled
        }
        val mime: String = if (hasAlpha) "image/png" else "image/jpeg"
        val data: String = "data:" + mime + ";base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return Pair(data, Pair(bitmap.width, bitmap.height))
    }

    /** 采样检查是否真的存在半透明/透明像素；ARGB_8888 的 hasAlpha() 恒为 true，不能直接用。 */
    private fun hasTransparency(bitmap: Bitmap): Boolean {
        if (!bitmap.hasAlpha()) return false
        val width = bitmap.width
        val height = bitmap.height
        if (width <= 0 || height <= 0) return false
        val row = IntArray(width)
        val xStep = Math.max(1, width / 700)
        val yStep = Math.max(1, height / 700)
        var y = 0
        while (y < height) {
            bitmap.getPixels(row, 0, width, 0, y, width, 1)
            var x = 0
            while (x < width) {
                if ((row[x] ushr 24) < 250) return true
                x += xStep
            }
            y += yStep
        }
        return false
    }

    private fun fixRotation(cr: ContentResolver, uri: Uri, bitmap: Bitmap): Bitmap {
        return try {
            val input = cr.openInputStream(uri) ?: return bitmap
            val exif = ExifInterface(input)
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            input.close()
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> {
                    matrix.postRotate(90f); matrix.postScale(-1f, 1f)
                }
                ExifInterface.ORIENTATION_TRANSVERSE -> {
                    matrix.postRotate(270f); matrix.postScale(-1f, 1f)
                }
                else -> return bitmap
            }
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
