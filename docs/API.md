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

