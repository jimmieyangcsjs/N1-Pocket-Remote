# 架构说明

```text
Phone PWA
  │ authenticated HTTP / JSON
  ▼
RemoteServer (0.0.0.0:8088)
  ├─ static web assets (memory-cached)
  ├─ scrcpy video proxy / touch control
  ├─ app listing / launch / uninstall
  ├─ screenshot / APK upload / text input
  ├─ key and pointer commands
  └─ loopback health endpoint
       │
       ├─ InputDaemon ── persistent root event-device stream
       ├─ ScrcpyMirror ── scrcpy-server 5.0.1 video/control sockets
       ├─ PointerOverlay ── non-touchable system pointer
       └─ N1RemoteIme ── Chinese text bridge

Aerial-TV-N1 / CleanYourTV-N1 ── signature ContentProvider ── RemoteService status
```

移动端页面可按需加载独立镜像模块：

```text
/mirror.html
  ├─ WebCodecs (HTTPS / secure context)
  └─ TinyH264 WebAssembly + WebGL (HTTP LAN fallback)
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

## 实时镜像

`ScrcpyMirror` 将内置的官方 scrcpy-server 复制到 `/data/local/tmp`，通过 root shell 启动，并连接 scrcpy 的 abstract Unix socket。服务端只读取原始 12 字节帧头和 H.264 数据，通过现有 HTTP 服务转发，不开放 ADB 端口。

`ScrcpyStreamReader` 解析 scrcpy 的流元数据，记录编码器实际输出的宽高。Amlogic 编码器要求 16 像素对齐，因此 N1 的 1920×1080 物理屏幕会生成 1920×1072 视频流。触摸注入不能继续使用物理屏幕的 1920×1080，否则官方 scrcpy 会以尺寸不一致为由丢弃事件；后端和手机页面都使用当前视频会话尺寸。

浏览器有两个解码路径：

1. 页面位于安全上下文且支持 WebCodecs 时，使用浏览器硬件解码和 Canvas 显示。
2. 普通局域网 HTTP 页面使用 APK 内置的 TinyH264 WebAssembly，在 Worker 中软件解码，再通过 WebGL 上传 Y/U/V 三个纹理平面。

第二条路径是为了兼容 `http://局域网IP`。`VideoDecoder` 在非安全上下文中通常不可用，单纯加入 WebCodecs 并不能让手机直接播放。

镜像触摸使用 scrcpy 新版控制协议发送 `TYPE_INJECT_TOUCH_EVENT`。视频读取和触摸写入使用独立通道；视频读取等待新帧时不会占用控制锁。停止镜像或关闭页面时会先发送 `ACTION_CANCEL`，避免电视停留在按下状态。

当前实现只允许一个视频查看器。关闭 HTTP 视频流时，服务端和 scrcpy-server 会一起释放，防止 N1 编码器长期占用。

## 分辨率适配

电视端 Android 布局按逻辑宽度 `dp` 选择资源，而不是物理像素。N1 为 1920×1080、240 dpi，逻辑宽度为 1280 dp；常见 4K、320 dpi 电视的逻辑宽度为 1920 dp。项目分别为这两种逻辑宽度提供专用尺寸资源，壁纸、图标和二维码继续使用矢量或运行时生成资源。

手机镜像页从启动接口、视频响应头以及流元数据取得真实宽高，并通过 `ResizeObserver`、`orientationchange`、`visualViewport.resize` 重新计算画面。全屏作用于整个 `.mirror-app`，控制栏不会因只全屏画面区域而丢失；宽屏规则不会覆盖全屏的铺满约束。

手机横屏采用 `stage.controls-side` 两列布局。左列使用真实视频宽高比最大化画面，右列宽度由 `--rail-width` 控制。标题栏、控制簇和会话按钮分别绝对定位在右栏顶部、中部和底部，因此不会占用或覆盖视频列。`852×393` 视口中的自动化几何检查要求：标题与方向键不重叠、控制区与会话按钮不重叠、四个快捷按钮至少为 `44×44 px`，并且页面无滚动。

## 解码选择

N1 的上游硬件编码能力只有 `OMX.amlogic.video.encoder.avc`。因此即使手机支持 H.265，本设备也无法提供 H.265 硬件编码流。项目固定使用 H.264 Baseline，与 TinyH264 的兼容范围一致。

