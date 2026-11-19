package com.example.aiphotostudio

import android.content.Context
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/** 配置存储在应用私有 SharedPreferences 中，Key 不会写入代码或日志。 */
class Config(private val ctx: Context) {
    private val prefs = ctx.getSharedPreferences("ai_photo_studio", Context.MODE_PRIVATE)

    fun get(key: String, def: String = ""): String = prefs.getString(key, def) ?: def
    fun getInt(key: String, def: Int): Int = try {
        (prefs.getString(key, null) ?: def.toString()).toInt()
    } catch (e: Exception) {
        def
    }

    fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }

    fun visibleConfig(): JSONObject = JSONObject().apply {
        put("api_key", mask(get("api_key")))
        put("base_url", get("base_url", "https://apihub.agnes-ai.com/v1"))
        put("model", get("model", "agnes-image-2.5-flash"))
        put("timeout", getInt("timeout", 240))
        put("max_upload_mb", getInt("max_upload_mb", 12))
        put("max_long_edge", getInt("max_long_edge", 2560))
        put("size", get("size", "2K"))
    }

    fun update(json: JSONObject) {
        val keys = listOf("api_key", "base_url", "model", "timeout",
            "max_upload_mb", "max_long_edge", "size")
        val editor = prefs.edit()
        for (k in keys) {
            if (json.has(k)) {
                val v = json.get(k)
                if (v != null && v.toString().trim().isNotEmpty()) {
                    editor.putString(k, v.toString())
                }
            }
        }
        editor.apply()
    }

    private fun mask(v: String): String = when {
        v.isEmpty() -> ""
        v.length <= 8 -> "*".repeat(v.length)
        else -> v.take(4) + "*".repeat(v.length - 8) + v.takeLast(4)
    }
}

/** Agnes AI OpenAI 兼容接口客户端（使用标准库 HttpURLConnection）。 */
class AgnesClient(private val cfg: Config) {

    private val base: String
        get() = cfg.get("base_url", "https://apihub.agnes-ai.com/v1").trim().trimEnd('/')
    private val timeout: Int
        get() = cfg.getInt("timeout", 240).coerceIn(30, 900) * 1000

    private fun requireKey() {
        if (cfg.get("api_key").isBlank()) {
            throw Exception("尚未配置 Agnes API Key，请先在「设置」中填写。")
        }
    }

    private fun request(path: String, payload: JSONObject?, method: String = "POST",
                        retry: Boolean = true): String {
        requireKey()
        var last: Exception? = null
        val attempts = if (retry) 3 else 1
        for (i in 0 until attempts) {
            var conn: HttpURLConnection? = null
            try {
                conn = URL(base + path).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = minOf(timeout, 60000)
                conn.readTimeout = timeout
                conn.setRequestProperty("Authorization", "Bearer " + cfg.get("api_key").trim())
                conn.setRequestProperty("Accept", "application/json")
                if (payload != null) {
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conn.doOutput = true
                    conn.outputStream.use {
                        it.write(payload.toString().toByteArray(Charsets.UTF_8))
                    }
                }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
                if (code !in 200..299) {
                    last = Exception(explain(code, body))
                    if (code in listOf(429, 500, 502, 503, 504) && i < attempts - 1) {
                        Thread.sleep(1500L * (i + 1))
                        continue
                    }
                    throw last!!
                }
                return body
            } catch (e: Exception) {
                if (e is java.net.SocketTimeoutException) {
                    last = Exception("请求超时（${cfg.getInt("timeout", 240)} 秒）。可把超时调大或先用 1K 档位重试。")
                } else if (e is java.net.UnknownHostException || e is java.io.IOException) {
                    last = Exception("网络请求失败：${e.message}。请检查网络与 Base URL。")
                } else {
                    last = e
                }
                if (i >= attempts - 1 || e !is java.io.IOException) break
                Thread.sleep(1000L)
            } finally {
                conn?.disconnect()
            }
        }
        throw last ?: Exception("请求失败")
    }

    fun generate(prompt: String, size: String, ratio: String?, images: List<String>?): JSONObject {
        val payload = JSONObject().apply {
            put("model", cfg.get("model", "agnes-image-2.5-flash"))
            put("prompt", prompt)
            put("size", size)
            if (!ratio.isNullOrBlank()) put("ratio", ratio)
            if (!images.isNullOrEmpty()) {
                put("extra_body", JSONObject().apply {
                    put("image", org.json.JSONArray(images))
                    put("response_format", "b64_json")
                })
            } else {
                put("return_base64", true)
            }
        }
        val resp = JSONObject(request("/images/generations", payload))
        return extractImage(resp)
    }

    private fun extractImage(resp: JSONObject): JSONObject {
        val data = resp.optJSONArray("data")
        val item = if (data != null && data.length() > 0) data.optJSONObject(0) else null
        val b64 = item?.optString("b64_json", "")
        if (!b64.isNullOrBlank()) {
            return JSONObject().apply {
                put("kind", "b64")
                put("data", b64)
            }
        }
        val url = item?.optString("url", "")
        if (!url.isNullOrBlank()) {
            val bytes = URL(url).openStream().use { it.readBytes() }
            return JSONObject().apply {
                put("kind", "b64")
                put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
            }
        }
        throw Exception("接口没有返回图像数据：${resp.toString().take(300)}")
    }

    fun test(): String {
        requireKey()
        return try {
            val raw = request("/models", null, "GET", false)
            val count = try {
                JSONObject(raw).optJSONArray("data")?.length() ?: 0
            } catch (e: Exception) { 0 }
            "连接成功，/models 返回 $count 个模型。"
        } catch (e: Exception) {
            if (e.message?.contains("404") == true || e.message?.contains("405") == true) {
                request("/chat/completions", JSONObject().apply {
                    put("model", "agnes-3.0-flash")
                    put("messages", org.json.JSONArray().put(JSONObject().apply {
                        put("role", "user"); put("content", "ping")
                    }))
                    put("max_tokens", 8)
                }, "POST", false)
                "连接成功，API Key 有效。"
            } else {
                throw e
            }
        }
    }

    private fun explain(code: Int, body: String): String {
        val hint = mapOf(
            400 to "请求参数有误", 401 to "API Key 无效或已失效", 403 to "没有权限访问",
            404 to "接口地址不存在，请检查 Base URL", 408 to "服务器处理超时",
            413 to "上传图片过大", 429 to "请求过于频繁或额度不足",
            500 to "服务器内部错误", 502 to "网关错误", 503 to "服务暂不可用",
            504 to "网关超时"
        )[code] ?: "请求失败"
        var msg = body
        try {
            val j = JSONObject(body)
            val err = j.opt("error")
            msg = when (err) {
                is JSONObject -> err.optString("message", body)
                is String -> err
                else -> j.optString("message", body)
            }
        } catch (e: Exception) { }
        if (msg.length > 500) msg = msg.take(500) + "…"
        return "HTTP $code（$hint）\n$msg"
    }
}
