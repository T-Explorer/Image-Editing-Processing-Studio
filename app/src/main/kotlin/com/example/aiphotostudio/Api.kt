@file:Suppress("DEPRECATION")
package com.example.aiphotostudio

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** 配置存储在应用私有 SharedPreferences 中，Key 不会写入代码或日志。 */
class Config(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("ai_photo_studio", Context.MODE_PRIVATE)

    fun get(key: String, def: String = ""): String {
        val value: String? = prefs.getString(key, def)
        return value ?: def
    }

    fun getInt(key: String, def: Int): Int {
        return try {
            get(key, def.toString()).toInt()
        } catch (e: Exception) {
            def
        }
    }

    fun visibleConfig(): JSONObject {
        val obj = JSONObject()
        obj.put("api_key", mask(get("api_key")))
        obj.put("base_url", get("base_url", "https://apihub.agnes-ai.com/v1"))
        obj.put("model", get("model", "agnes-image-2.5-flash"))
        obj.put("timeout", getInt("timeout", 240))
        obj.put("max_upload_mb", getInt("max_upload_mb", 12))
        obj.put("max_long_edge", getInt("max_long_edge", 2560))
        obj.put("size", get("size", "2K"))
        return obj
    }

    fun update(json: JSONObject) {
        val keys = arrayOf("api_key", "base_url", "model", "timeout",
            "max_upload_mb", "max_long_edge", "size")
        val editor = prefs.edit()
        for (k in keys) {
            val value: String = json.optString(k, "")
            if (value.trim().isNotEmpty()) {
                editor.putString(k, value)
            }
        }
        editor.apply()
    }

    private fun mask(v: String): String {
        return when {
            v.isEmpty() -> ""
            v.length <= 8 -> "*".repeat(v.length)
            else -> v.substring(0, 4) + "*".repeat(v.length - 8) + v.substring(v.length - 4)
        }
    }
}

/** Agnes AI OpenAI 兼容接口客户端（使用标准库 HttpURLConnection）。 */
class AgnesClient(private val cfg: Config) {

    private val base: String
        get() = getBaseUrl()

    private fun getBaseUrl(): String {
        val raw: String = cfg.get("base_url", "https://apihub.agnes-ai.com/v1")
        return raw.trim().trimEnd('/')
    }

    private fun timeoutMs(): Int {
        val seconds: Int = cfg.getInt("timeout", 240)
        return Math.max(30, Math.min(900, seconds)) * 1000
    }

    private fun requireKey() {
        val key: String = cfg.get("api_key")
        if (key.isBlank()) {
            throw Exception("尚未配置 Agnes API Key，请先在「设置」中填写。")
        }
    }

    private fun request(path: String, payload: JSONObject?, method: String,
                        retry: Boolean): String {
        requireKey()
        val key: String = cfg.get("api_key").trim()
        val attempts = if (retry) 3 else 1
        var lastError: Exception? = null
        var i = 0
        while (i < attempts) {
            var conn: HttpURLConnection? = null
            try {
                conn = URL(base + path).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = Math.min(timeoutMs(), 60000)
                conn.readTimeout = timeoutMs()
                conn.setRequestProperty("Authorization", "Bearer " + key)
                conn.setRequestProperty("Accept", "application/json")
                if (payload != null) {
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.doOutput = true
                    val out = conn.outputStream
                    out.write(payload.toString().toByteArray(Charsets.UTF_8))
                    out.close()
                }
                val code: Int = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                var body = ""
                if (stream != null) {
                    val reader = stream.bufferedReader()
                    body = reader.readText()
                    reader.close()
                }
                if (code !in 200..299) {
                    lastError = Exception(explain(code, body))
                    if ((code == 429 || code in 500..504) && i < attempts - 1) {
                        Thread.sleep(1500L * (i + 1))
                        i++
                        continue
                    }
                    throw lastError!!
                }
                return body
            } catch (e: Exception) {
                if (e is java.net.SocketTimeoutException) {
                    val seconds: Int = cfg.getInt("timeout", 240)
                    lastError = Exception("请求超时（" + seconds + " 秒）。可把超时调大或先用 1K 档位重试。")
                } else if (e is java.net.UnknownHostException || e is java.io.IOException) {
                    lastError = Exception("网络请求失败：" + (e.message ?: "") + "。请检查网络与 Base URL。")
                } else {
                    lastError = e
                }
                if (i >= attempts - 1 || e !is java.io.IOException) break
                Thread.sleep(1000L)
            } finally {
                conn?.disconnect()
            }
            i++
        }
        throw lastError ?: Exception("请求失败")
    }

    fun generate(prompt: String, size: String, ratio: String?, images: List<String>?): JSONObject {
        val payload = JSONObject()
        payload.put("model", cfg.get("model", "agnes-image-2.5-flash"))
        payload.put("prompt", prompt)
        payload.put("size", size)
        if (ratio != null && ratio.trim().isNotEmpty()) {
            payload.put("ratio", ratio)
        }
        if (images != null && images.isNotEmpty()) {
            val arr = org.json.JSONArray()
            for (image in images) arr.put(image)
            val extra = JSONObject()
            extra.put("image", arr)
            extra.put("response_format", "b64_json")
            payload.put("extra_body", extra)
        } else {
            payload.put("return_base64", true)
        }
        val raw: String = request("/images/generations", payload, "POST", true)
        return extractImage(JSONObject(raw))
    }

    private fun extractImage(resp: JSONObject): JSONObject {
        val data = resp.optJSONArray("data")
        var item: JSONObject? = null
        if (data != null && data.length() > 0) {
            item = data.optJSONObject(0)
        }
        val b64: String = if (item != null) item.optString("b64_json", "") else ""
        if (b64.trim().isNotEmpty()) {
            val result = JSONObject()
            result.put("kind", "b64")
            result.put("data", b64)
            return result
        }
        val url: String = if (item != null) item.optString("url", "") else ""
        if (url.trim().isNotEmpty()) {
            val input = URL(url).openStream()
            val bytes = input.readBytes()
            input.close()
            val result = JSONObject()
            result.put("kind", "b64")
            result.put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            return result
        }
        throw Exception("接口没有返回图像数据：" + resp.toString().take(300))
    }

    fun test(): String {
        requireKey()
        try {
            val raw: String = request("/models", null, "GET", false)
            var count = 0
            try {
                val obj = JSONObject(raw)
                val arr = obj.optJSONArray("data")
                if (arr != null) count = arr.length()
            } catch (e: Exception) {
                count = 0
            }
            return "连接成功，/models 返回 " + count + " 个模型。"
        } catch (e: Exception) {
            val msg: String = e.message ?: ""
            if (msg.contains("404") || msg.contains("405")) {
                val payload = JSONObject()
                payload.put("model", "agnes-3.0-flash")
                val messages = org.json.JSONArray()
                val m = JSONObject()
                m.put("role", "user")
                m.put("content", "ping")
                messages.put(m)
                payload.put("messages", messages)
                payload.put("max_tokens", 8)
                request("/chat/completions", payload, "POST", false)
                return "连接成功，API Key 有效。"
            }
            throw e
        }
    }

    private fun explain(code: Int, body: String): String {
        var msg = body
        try {
            val obj = JSONObject(body)
            val detail: String = obj.optString("message", "")
            if (detail.isNotEmpty()) {
                msg = detail
            } else {
                val errorObj = obj.optJSONObject("error")
                if (errorObj != null) {
                    val errorMsg: String = errorObj.optString("message", "")
                    if (errorMsg.isNotEmpty()) msg = errorMsg
                }
            }
        } catch (e: Exception) {
            // keep original body
        }
        if (msg.length > 500) msg = msg.substring(0, 500) + "…"
        return "HTTP " + code + "：" + msg
    }
}
