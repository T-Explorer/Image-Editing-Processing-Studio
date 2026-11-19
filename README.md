# AI 照相馆 · Android 原生版

基于 **Agnes AI 图像模型** 的安卓 App：证件照（含 6 寸排版）、换背景、
人像精修、风格写真、老照片修复、AI 扩图、文生图/图生图、整文件夹批量处理。

- 形态：**Kotlin 原生 App + WebView 界面**；HTTP、图片读取、文件保存走原生。
- 兼容：Android 10 (API 29) 及以上，按 **Android 15 (API 35)** 编译。
- 构建：**GitHub Actions 云端免费编译**，不需要安装 Android Studio。
- 费用：全部免费；自己安装 APK 不需要 Google Play 开发者账号。

## 一、获取 APK（推荐：GitHub Actions，不用装 Android Studio）

1. 把本目录内容作为一个仓库上传到 GitHub（仓库建议设为 Public，Actions 分钟数免费）。
2. 打开仓库 → **Actions** 标签 → 左侧选择 **「构建 AI 照相馆 APK」** → 右侧
   **Run workflow** → 点绿色按钮。
3. 等待 3–8 分钟，构建完成后点进这次运行，在页面底部 **Artifacts** 下载
   **AI-Photo-Studio-APK**（里面是 `app-debug.apk`）。
4. 把 APK 传到手机，点击安装。系统会提示「未知来源」，选择**允许/仍要安装**即可。

> Debug APK 已用 Android 自动生成的调试证书签名，**可直接安装使用**。
> 想上架应用商店才需要正式签名（见第四节）。

## 二、在手机上使用

1. 打开 App → 右上角 **⚙ 设置**：
   - 粘贴 **Agnes API Key**（留空表示不修改）
   - 可改 Base URL、模型名、超时、上传上限、长边上限
   - 点 **保存** → **测试连接**，看到「连接成功」即可。
2. 选底部功能标签，点 **📷 选择图片 / 拍照** 选照片，填参数。
3. 可先勾选 **「只预览提示词」** 免费看效果，再取消勾选正式生成。
4. 结果页点 **保存到相册**，文件存到手机的 `下载/AIPhotoStudio/`。
5. **批量处理**：点 **📁 选择文件夹** 授权后，设置操作与张数上限，开始处理。

> 图片会上传到 Agnes AI 服务器处理；请确保已获得当事人授权，涉密照片请勿处理。

## 三、功能

| 标签 | 说明 |
| --- | --- |
| AI 证件照 | 11 种证件类型↔规格联动、自定义像素/DPI、背景色、服装/妆容/表情/眼镜/发型、6 寸排版（指定张数） |
| 更换背景 | 纯色/影棚渐变/花园/书房/海边等，虚化、光线、接触阴影、发丝边缘 |
| 人像精修 | 磨皮、瘦脸、瑕疵、肤色、面部光影、眼神光、牙齿、去油光 |
| 风格写真 | 汉服/学士服/婚纱/动漫/油画等，自定义风格与强度 |
| 老照片修复 | 去划痕、降噪、清晰化、面部细节、AI 自然上色 |
| AI 扩图 | 8 种比例、7 种扩展方向 |
| AI 文生图 | 提示词/负面词/风格/1K–4K，可上传参考图做图生图 |
| 批量处理 | 递归读取所选文件夹，自动按原图比例请求，结果存入相册 |

## 四、正式签名（可选，上架才需要）

Debug APK 只能用于安装测试。如需正式签名：

在 Android Studio 中：**Build → Generate Signed Bundle / APK → APK** →
创建新 keystore（**务必备份密码和 keystore 文件**）→ 选择 release → 完成。

或用命令行：

```bash
keytool -genkey -v -keystore my.keystore -alias aiphoto -keyalg RSA -keysize 2048 -validity 10000
# 在 app/build.gradle.kts 的 android.signingConfigs 中配置后：
gradle assembleRelease
```

GitHub Actions 也可通过仓库 **Secrets** 存放 base64 编码的 keystore 来自动签正式包，
需要的话我可以补上这段 workflow。

## 五、目录结构

```
ai-photo-studio-android/
├── .github/workflows/build.yml   # 云端免费编译
├── app/src/main/
│   ├── java/.../MainActivity.kt  # WebView + 权限 + 图片选择
│   ├── java/.../Bridge.kt        # JS↔原生桥：API/图片/文件/保存
│   ├── java/.../Api.kt           # Agnes HTTP 客户端 + 配置存储
│   └── assets/
│       ├── index.html            # 界面
│       ├── schema.js             # 表单定义（由服务端 schema 生成）
│       ├── prompts.js            # 提示词构建（移植自 presets.py）
│       ├── images.js             # Canvas 裁剪/6 寸排版
│       └── app.js                # 交互与批量逻辑
└── build.gradle.kts / settings.gradle.kts
```

## 六、隐私

- API Key 保存在应用私有 `SharedPreferences`，不上传、不写日志。
- 服务直连 Agnes API（`https://apihub.agnes-ai.com/v1`），无中间服务器。
- 图片仅用于调用 Agnes 生成，结果保存在本机相册。
