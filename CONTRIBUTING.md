# Contributing

## Before submitting

- Build with API 25 compatibility in mind.
- Do not test input injection through an unrestricted root context. N1 firmware can throw an InputManager exception; shell context or the persistent `InputDaemon` is required.
- Keep the HTTP server free of unauthenticated endpoints that reveal PIN, IP, app data, files or shell output.
- Do not commit local PINs, LAN IPs, device serial numbers, APKs from private sources, or device captures containing those values.
- Keep new mobile controls touch-friendly and keyboard-accessible.

## Development checks

```powershell
node --check app/src/main/assets/web/app.js
.\gradlew.bat assembleRelease
```

Test at minimum:

- PIN login and URL auto-login
- remote keys and long press
- touchpad click, long press and movement
- app launch and APK upload
- service recovery after stop or reboot
- no-network start and network restoration

Open a pull request with the device/firmware tested and the failure modes checked.

