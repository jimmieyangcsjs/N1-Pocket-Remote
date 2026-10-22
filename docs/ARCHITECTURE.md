# 架构说明

```text
Phone PWA
  │ authenticated HTTP / JSON
  ▼
RemoteServer (0.0.0.0:8088)
  ├─ static web assets (memory-cached)
  ├─ app listing / launch / uninstall
  ├─ screenshot / APK upload / text input
  ├─ key and pointer commands
  └─ loopback health endpoint
       │
       ├─ InputDaemon ── persistent root event-device stream
       ├─ PointerOverlay ── non-touchable system pointer
       └─ N1RemoteIme ── Chinese text bridge

CleanYourTV ── signature ContentProvider ── RemoteService status
```

## 服务生命周期

`RemoteService` 以前台服务运行，并维持 `RemoteServer` 监听。它注册默认网络回调，每 30 秒检查一次本地回环端口；监听器失去响应时会自动替换服务实例。

## 低延迟按键

Android 的 `input keyevent` 每次都会启动一个 Java VM，在 N1 上耗时接近 1 秒。`InputDaemon` 保持一个 root 所有的 `cat` 进程直接打开 Amlogic 键盘事件设备，并写入内核 `input_event` 记录。遇到不支持的按键时才回退到 `input keyevent`。

## 状态数据暴露

桌面需要当前 IP、端口和 PIN 才能生成二维码。这些数据由 `StatusProvider` 提供，并受以下权限保护：

```text
com.gathin.n1remote.permission.READ_STATUS
protectionLevel=signature
```

局域网中没有任何无需认证即可读取 PIN 的接口。

## 开机与离线行为

HTTP 服务不依赖网络即可绑定。开机广播或桌面 Provider 查询都可以启动服务。网络恢复后，手机心跳和桌面网络回调会刷新当前地址。

## 触控指针

指针是全屏、`FLAG_NOT_TOUCHABLE` 的系统悬浮层。手机将触控位移映射到电视真实分辨率；点击和长按会在指针当前位置注入绝对触控事件。

