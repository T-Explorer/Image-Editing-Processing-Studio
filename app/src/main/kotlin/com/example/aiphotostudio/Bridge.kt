package com.example.aiphotostudio

import android.app.Activity
import android.content.ContentResolver
import android.content.Context
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
    @JavascriptInterface
    fun getConfig(): String = cfg.visibleConfig().toString()

    @JavascriptInterface
    fun saveConfig(json: String): String = try {
        cfg.update(JSONObject(json))
        JSONObject().apply {
            put("ok", true)
            put("updated", JSONArray(cfg.visibleConfig().keys().asSequence().toList()))
        }.toString()
    } catch (e: Exception) {
        errorJson(e)
    }

    @JavascriptInterface
    fun testConnection(): String = try {
        val message = AgnesClient(cfg).test()
        JSONObject().apply { put("ok", true); put("message", message) }.toString()
    } catch (e: Exception) {
        JSONObject().apply { put("ok", false); put("error", e.message ?: "未知错误") }.toString()
    }

    /** 调用 Agnes 生成图像。payload 为完整请求体 JSON。 */
    @JavascriptInterface
    fun callApi(payload: String): String = try {
        val req = JSONObject(payload)
        val prompt = req.optString("prompt", "")
        val size = req.optString("size", cfg.get("size", "2K"))
        val ratio = req.optString("ratio", "").ifBlank { null }
        val images = req.optJSONArray("images")?.let { arr ->
            (0 until arr.length()).map { arr.getString(it) }
        }
        val result = AgnesClient(cfg).generate(prompt, size, ratio, images)
        JSONObject().apply {
            put("ok", true)
            put("kind", result.getString("kind"))
            put("data", result.getString("data"))
        }.toString()
    } catch (e: Exception) {
        JSONObject().apply { put("ok", false); put("error", e.message ?: "未知错误") }.toString()
    }

    /** 打开系统图片选择器；结果通过 window.onImagePicked(json) 回调。 */
    @JavascriptInterface
    fun pickImage(): String {
        activity.runOnUiThread {
            try {
                pickLauncher.launch(arrayOf("image/*"))
            } catch (e: Exception) {
                activity.evalJs("window.onImagePicked && window.onImagePicked(${errorJson(e)})")
            }
        }
        return "{\"ok\":true,\"pending\":true}"
    }

    /** 打开文件夹选择器；结果通过 window.onFolderPicked(json) 回调。 */
    @JavascriptInterface
    fun pickFolder(): String {
        activity.runOnUiThread {
            try {
                folderLauncher.launch(null)
            } catch (e: Exception) {
                activity.evalJs("window.onFolderPicked && window.onFolderPicked(${errorJson(e)})")
            }
        }
        return "{\"ok\":true,\"pending\":true}"
    }

    /** 读取任意图片 URI，返回 data URI 与尺寸。 */
    @JavascriptInterface
    fun readImage(uriString: String): String = try {
        val uri = Uri.parse(uriString)
        val pair = decodeUri(uri)
        JSONObject().apply {
            put("ok", true)
            put("uri", uriString)
            put("dataUri", pair.first)
            put("width", pair.second.first)
            put("height", pair.second.second)
            put("name", displayName(uri) ?: "image")
        }.toString()
    } catch (e: Exception) {
        errorJson(e)
    }

    /** 列出文件夹中的图片（用于批量处理）。 */
    @JavascriptInterface
    fun listImages(folderUri: String): String = try {
        val tree = Uri.parse(folderUri)
        val rootId = DocumentsContract.getTreeDocumentId(tree)
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, rootId)
        val resolver = activity.contentResolver
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        )
        val items = JSONArray()
        fun walk(parentUri: Uri, depth: Int) {
            if (depth > 8) return
            resolver.query(parentUri, projection, null, null, null)?.use { cursor ->
                while (cursor.moveToNext()) {
                    val mime = cursor.getString(2) ?: ""
                    val id = cursor.getString(0) ?: continue
                    val name = cursor.getString(1) ?: "image"
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                        walk(DocumentsContract.buildChildDocumentsUriUsingTree(tree, id), depth + 1)
                    } else if (mime.startsWith("image/")) {
                        val uri = DocumentsContract.buildDocumentUriUsingTree(tree, id).toString()
                        items.put(JSONObject().apply {
                            put("uri", uri); put("name", name)
                        })
                    }
                }
            }
        }
        walk(childrenUri, 0)
        JSONObject().apply { put("ok", true); put("files", items) }.toString()
    } catch (e: Exception) {
        errorJson(e)
    }

    /** 把 base64 图片保存到「下载/AIPhotoStudio」。 */
    @JavascriptInterface
    fun saveImage(dataUrl: String, filename: String): String = try {
        val comma = dataUrl.indexOf(',')
        val raw = if (comma >= 0) dataUrl.substring(comma + 1) else dataUrl
        val bytes = Base64.decode(raw, Base64.DEFAULT)
        val name = filename.replace(Regex("[^A-Za-z0-9._\\-]"), "_").let {
            if (it.endsWith(".png") || it.endsWith(".jpg") || it.endsWith(".jpeg")) it else "$it.png"
        }
        val values = android.content.ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, "image/png")
            put(MediaStore.Downloads.RELATIVE_PATH, "Download/AIPhotoStudio")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = activity.contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw Exception("无法创建文件")
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
        JSONObject().apply {
            put("ok", true)
            put("path", "Download/AIPhotoStudio/$name")
        }.toString()
    } catch (e: Exception) {
        errorJson(e)
    }

    @JavascriptInterface
    fun toast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    // ---------- 内部工具 ----------

    fun onImagePicked(uri: Uri) {
        try {
            val pair = decodeUri(uri)
            val json = JSONObject().apply {
                put("ok", true)
                put("uri", uri.toString())
                put("dataUri", pair.first)
                put("width", pair.second.first)
                put("height", pair.second.second)
                put("name", displayName(uri) ?: "image")
            }.toString()
            activity.evalJs("window.onImagePicked && window.onImagePicked($json)")
        } catch (e: Exception) {
            activity.evalJs("window.onImagePicked && window.onImagePicked(${errorJson(e)})")
        }
    }

    fun onFolderPicked(uri: Uri) {
        try {
            activity.contentResolver.takePersistableUriPermission(
                uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (e: Exception) { }
        val json = JSONObject().apply {
            put("ok", true); put("uri", uri.toString())
        }.toString()
        activity.evalJs("window.onFolderPicked && window.onFolderPicked($json)")
    }

    /** 解码图片，按 max_long_edge 与 max_upload_mb 限制缩小，返回 data URI 与原始尺寸。 */
    private fun decodeUri(uri: Uri): Pair<String, Pair<Int, Int>> {
        val cr = activity.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        val ow = bounds.outWidth
        val oh = bounds.outHeight
        if (ow <= 0 || oh <= 0) throw Exception("无法读取图片尺寸")

        val maxEdge = cfg.getInt("max_long_edge", 2560).coerceIn(512, 8192)
        var sample = 1
        while (maxOf(ow, oh) / sample > maxEdge * 2) sample *= 2
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        var bitmap = cr.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw Exception("无法解码图片")
        bitmap = fixRotation(cr, uri, bitmap)
        if (maxOf(bitmap.width, bitmap.height) > maxEdge) {
            val scale = maxEdge.toFloat() / maxOf(bitmap.width, bitmap.height)
            val w = (bitmap.width * scale).toInt().coerceAtLeast(1)
            val h = (bitmap.height * scale).toInt().coerceAtLeast(1)
            bitmap = Bitmap.createScaledBitmap(bitmap, w, h, true)
        }
        val hasAlpha = bitmap.config == Bitmap.Config.ARGB_8888
        val out = ByteArrayOutputStream()
        var quality = 92
        while (true) {
            out.reset()
            bitmap.compress(if (hasAlpha) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                quality, out)
            val limit = cfg.getInt("max_upload_mb", 12).coerceIn(1, 100) * 1024 * 1024
            if (out.size() <= limit || quality <= 40) break
            quality -= 12
        }
        val mime = if (hasAlpha) "image/png" else "image/jpeg"
        val data = "data:$mime;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return Pair(data, Pair(ow, oh))
    }

    private fun fixRotation(cr: ContentResolver, uri: Uri, bitmap: Bitmap): Bitmap {
        return try {
            val cursor = cr.query(uri, arrayOf(MediaStore.Images.Media.ORIENTATION), null, null, null)
            val degree = cursor?.use {
                if (it.moveToFirst()) it.getInt(0) else 0
            } ?: 0
            if (degree == 0 || degree == 360) return bitmap
            val matrix = Matrix().apply { postRotate(degree.toFloat()) }
            Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        } catch (e: Exception) {
            bitmap
        }
    }

    private fun displayName(uri: Uri): String? {
        val cr = activity.contentResolver
        val cursor = cr.query(uri, arrayOf(MediaStore.MediaColumns.DISPLAY_NAME), null, null, null)
        return cursor?.use { if (it.moveToFirst()) it.getString(0) else null }
    }

    private fun errorJson(e: Exception): String = JSONObject().apply {
        put("ok", false)
        put("error", "${e.javaClass.simpleName}: ${e.message}")
    }.toString()
}
