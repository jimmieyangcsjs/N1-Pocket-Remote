# HTTP API

All endpoints except login require:

```http
X-N1-Token: <six-digit-pin>
```

## Public

- `POST /api/login` — `{"pin":"123456"}`.

## Authenticated

- `GET /api/ping` — lightweight health check, no shell command.
- `GET /api/status` — IP, port, root shell, IME and screen size.
- `GET /api/apps` — launchable apps and PNG icons.
- `POST /api/launch` — `{"package":"com.example.app"}`.
- `POST /api/uninstall` — user-app only.
- `POST /api/key` — `{"code":22,"long":false}`.
- `POST /api/touch` — `tap`, `long` or `swipe`.
- `POST /api/pointer` — `show`, `hide`, `move`, `click`, `long`.
- `POST /api/text` — send text through N1RemoteIme or clipboard fallback.
- `POST /api/ime` — `select` or `restore`.
- `POST /api/install` — raw APK body.
- `GET /api/screenshot` — base64 PNG.

All API responses use `{"ok":true,...}` or `{"ok":false,"error":"..."}`.

