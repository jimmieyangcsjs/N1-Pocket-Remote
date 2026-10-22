# 安装与使用

## 环境要求

- 支持 Wi-Fi 和 root 管理的 Android TV 7.0+ 设备
- SuperSU 或等效的 root 命令
- 电视盒子和手机位于同一私有局域网
- N1 实测版本为 Android 7.1 / API 25

## 安装 APK

```powershell
adb install -r dist\N1Remote-v0.1.apk
adb shell am start -n com.gathin.n1remote/.MainActivity
```

首次打开时允许一次 SuperSU 授权。App 返回首页后，前台服务仍会继续运行。

## 连接控制台

1. 打开电视首页；集成 N1 Remote 的桌面会直接显示状态卡和二维码。
2. 也可以打开 N1 Remote，扫描电视上的二维码。
3. 手动访问地址：`http://<设备IP>:8088`。
4. 输入电视显示的 6 位 PIN。
5. 在手机浏览器中选择“添加到主屏幕”，以 PWA 方式使用。

PIN 由本机 `SecureRandom` 生成，不是硬编码默认值。

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

