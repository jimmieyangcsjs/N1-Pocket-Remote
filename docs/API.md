# HTTP 接口

除登录接口外，所有接口都需要请求头：

```http
X-N1-Token: <six-digit-pin>
```

## 无需登录

- `POST /api/login`：`{"pin":"123456"}`。

## 需要认证

- `GET /api/ping`：轻量健康检查，不执行 Shell。
- `GET /api/status`：IP、端口、root Shell、输入法和屏幕尺寸。
- `POST /api/mirror/start`：启动 scrcpy 5.0.1 编码器和控制通道。
- `GET /api/mirror/video`：持续输出带 12 字节包头的 H.264 视频流。
- `POST /api/mirror/touch`：`{"action":"down|move|up|cancel","x":0.5,"y":0.5}`，坐标范围 0–1。
- `POST /api/mirror/stop`：停止视频流、释放触摸并关闭 scrcpy。
- `GET /api/apps`：可启动应用及 PNG 图标。
- `POST /api/launch`：`{"package":"com.example.app"}`。
- `POST /api/uninstall`：仅允许卸载用户应用。
- `POST /api/key`：`{"code":22,"long":false}`。
- `POST /api/touch`：`tap`、`long` 或 `swipe`。
- `POST /api/pointer`：`show`、`hide`、`move`、`click` 或 `long`。
- `POST /api/text`：通过 N1RemoteIme 发送文字，失败时使用剪贴板。
- `POST /api/ime`：`select` 或 `restore`。
- `POST /api/install`：原始 APK 请求体。
- `GET /api/screenshot`：Base64 PNG。

所有 API 响应格式为 `{"ok":true,...}` 或 `{"ok":false,"error":"..."}`。

`/api/mirror/video` 是 HTTP chunked 流，响应头包含 `X-N1-Codec`、`X-N1-Width`、`X-N1-Height` 和 `X-N1-Scrcpy`。视频流同一时间只允许一个查看器。

