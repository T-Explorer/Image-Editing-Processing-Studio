@file:Suppress("DEPRECATION")
package com.example.aiphotostudio

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JsResult
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var bridge: Bridge
    private lateinit var cfg: Config
    private var themeMode: String = "system"

    private val pickLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) bridge.onImagePicked(uri)
            else evalJs("window.onImagePicked && window.onImagePicked({ok:false,error:'已取消'})")
        }

    private val folderLauncher: ActivityResultLauncher<Uri?> =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            if (uri != null) bridge.onFolderPicked(uri)
            else evalJs("window.onFolderPicked && window.onFolderPicked({ok:false,error:'已取消'})")
        }

    fun systemTheme(): String {
        val mask = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
        return if (mask == Configuration.UI_MODE_NIGHT_YES) "dark" else "light"
    }

    private fun isDarkTheme(): Boolean {
        return when (themeMode) {
            "dark" -> true
            "light" -> false
            else -> systemTheme() == "dark"
        }
    }

    /** 只更新网页与状态栏，不重建 Activity，避免丢失当前页面和输入内容。 */
    fun applyThemeMode(mode: String) {
        themeMode = mode
        getSharedPreferences("ai_photo_studio", MODE_PRIVATE)
            .edit().putString("theme_mode", mode).apply()
        if (::webView.isInitialized) {
            webView.setBackgroundColor(if (isDarkTheme()) Color.parseColor("#0E0E13")
                else Color.parseColor("#F5F4F9"))
        }
        updateStatusBar()
    }

    private fun updateStatusBar() {
        val dark = isDarkTheme()
        window.statusBarColor = if (dark) resources.getColor(R.color.surface_dark)
            else resources.getColor(R.color.purple_700)
        window.navigationBarColor = if (dark) resources.getColor(R.color.surface_dark)
            else resources.getColor(R.color.surface_light)
        // 状态栏始终是深色底（紫色或深灰），因此使用浅色图标。
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightStatusBars = false
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightNavigationBars = !dark
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cfg = Config(this)
        val prefs = getSharedPreferences("ai_photo_studio", MODE_PRIVATE)
        themeMode = prefs.getString("theme_mode", "system") ?: "system"

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(if (isDarkTheme()) Color.parseColor("#0E0E13")
                else Color.parseColor("#F5F4F9"))
        }
        setContentView(webView)

        bridge = Bridge(this, cfg, pickLauncher, folderLauncher)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            useWideViewPort = true
            loadWithOverviewMode = false
            textZoom = 100
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        webView.addJavascriptInterface(bridge, "Android")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("file:///android_asset/")) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                    true
                } catch (e: Exception) { true }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                evalJs("window.refreshTheme && window.refreshTheme()")
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onJsAlert(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("AI 照相馆")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

            override fun onJsConfirm(view: WebView?, url: String?, message: String?, result: JsResult?): Boolean {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("AI 照相馆")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok) { _, _ -> result?.confirm() }
                    .setNegativeButton(android.R.string.cancel) { _, _ -> result?.cancel() }
                    .setOnCancelListener { result?.cancel() }
                    .show()
                return true
            }

        }

        applyThemeMode(themeMode)
        requestStoragePermissionIfNeeded()
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        updateStatusBar()
        evalJs("window.refreshTheme && window.refreshTheme()")
    }

    private fun requestStoragePermissionIfNeeded() {
        if (Build.VERSION.SDK_INT <= 32) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE), 1001)
            }
        }
    }

    /** 从任意线程安全地执行 JS。 */
    fun evalJs(script: String) {
        if (!::webView.isInitialized) return
        webView.post {
            try {
                webView.evaluateJavascript(script, null)
            } catch (e: Exception) {
                // ignore
            }
        }
    }

    override fun onBackPressed() {
        if (!::webView.isInitialized) {
            super.onBackPressed()
            return
        }
        webView.evaluateJavascript("(window.handleBack && window.handleBack()) ? 1 : 0") { value ->
            if (value == "1") return@evaluateJavascript
            if (webView.canGoBack()) webView.goBack() else finish()
        }
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            webView.removeJavascriptInterface("Android")
            webView.destroy()
        }
        super.onDestroy()
    }
}
