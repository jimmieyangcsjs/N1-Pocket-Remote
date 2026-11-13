# 安装与使用

## 环境要求

- 支持 Wi-Fi 和 root 管理的 Android TV 7.0+ 设备
- SuperSU 或等效的 root 命令
- 电视盒子和手机位于同一私有局域网
- N1 实测版本为 Android 7.1 / API 25

## 安装 APK

```powershell
adb install -r dist\N1Remote-v0.1.1.apk
adb shell am start -n com.gathin.n1remote/.MainActivity
```

首次打开时允许一次 SuperSU 授权。App 返回首页后，前台服务仍会继续运行。升级旧版本时只使用 `install -r` 覆盖安装，不要卸载，否则会清除应用数据并要求重新授权 root。

## 连接控制台

1. 打开电视首页；集成 N1 Remote 的桌面会直接显示状态卡和二维码。
2. 也可以打开 N1 Remote，扫描电视上的二维码。
3. 手动访问地址：`http://<设备IP>:8088`。
4. 输入电视显示的 6 位 PIN。
5. 在手机浏览器中选择“添加到主屏幕”，以 PWA 方式使用。

PIN 由本机 `SecureRandom` 生成，不是硬编码默认值。

## 实时镜像

手机控制台中的“实时镜像”是独立页面 `/mirror.html`。首次进入需要几秒启动 scrcpy 编码器。

- 普通 `http://` 局域网地址会使用内置 TinyH264 WebAssembly 软件解码。
- 若以后为控制台配置可信 HTTPS，页面会优先使用 WebCodecs 硬件解码。
- 镜像只允许一部手机同时查看；关闭页面后会自动释放编码器和触摸状态。
- 斐讯 N1 没有 H.265 硬件编码器，镜像固定使用 H.264。
- 手机竖屏时控制区位于画面下方；手机横屏时 TV 画面留在左侧，标题、方向键和所有功能按钮进入右侧控制栏。
- 右侧快捷按钮保持触控面积，重新连接和退出镜像固定在右栏底部，不会覆盖 TV 画面。

镜像帧率取决于手机 CPU、Wi-Fi 信号和电视画面变化量。N1 只负责硬件 H.264 编码，不会把 ADB `5555` 暴露给手机页面。

如果手机仍显示更新前的页面，刷新一次控制台以加载新版 Service Worker 缓存；当前资源版本为 `n1remote-v13-2026-11-13`。

## Root 与悬浮层权限

服务在没有网络或尚未弹出 root 授权时也能先启动。虚拟指针只会在第一次进入触控页时申请 `SYSTEM_ALERT_WINDOW`。如果 SuperSU 不可用，普通遥控按键仍可工作，但指针层可能无法显示。

## 自动恢复

- 开机：`BOOT_COMPLETED`
- 应用更新：`MY_PACKAGE_REPLACED`
- 网络恢复：连接和 Wi-Fi 广播
- 服务重启：`START_STICKY`
- 监听失效：30 秒本地端口看门狗
- 开机广播竞争：桌面第一次读取状态时由 Provider 主动启动服务

## 卸载

```powershell
adb uninstall com.gathin.n1remote
```

