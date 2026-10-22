# Installation

## Requirements

- Android TV 7.0+ device with Wi-Fi and root management
- SuperSU or an equivalent root command
- Device and phone on the same private LAN
- N1 builds tested with Android 7.1 / API 25

## Install APK

```powershell
adb install -r dist\N1Remote-v0.1.apk
adb shell am start -n com.gathin.n1remote/.MainActivity
```

Approve the SuperSU prompt once. The foreground service will remain active after the app returns to Home.

## Connect

1. Open Home. A launcher built for N1 Remote can show the status card and QR.
2. Otherwise open N1 Remote and scan the QR.
3. Manual address: `http://<device-ip>:8088`.
4. Enter the six-digit PIN shown on the TV.
5. Add the page to the phone home screen for PWA-style access.

The PIN is generated locally with `SecureRandom`; it is not a hard-coded default.

## Root and overlay permission

The service can start without network or root prompt. The virtual pointer requests `SYSTEM_ALERT_WINDOW` only when the touch page is first opened. If SuperSU is unavailable, ordinary remote keys still work but pointer overlay may not.

## Recovery

- Boot: `BOOT_COMPLETED`
- Package update: `MY_PACKAGE_REPLACED`
- Network return: connectivity and Wi-Fi broadcasts
- Service restart: `START_STICKY`
- Dead listener: 30-second loopback watchdog
- Boot broadcast race: launcher status provider starts the service on first query

## Remove

```powershell
adb uninstall com.gathin.n1remote
```

