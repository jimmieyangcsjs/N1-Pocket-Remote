# Architecture

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

## Service lifecycle

`RemoteService` runs in the foreground and keeps `RemoteServer` listening. It registers a default network callback, watches the loopback port every 30 seconds, and restarts a server that is no longer accepting connections.

## Low-latency keys

Calling Android's `input keyevent` starts a Java VM for every key. On N1 this costs close to one second. `InputDaemon` instead keeps a root-owned `cat` process open against the Amlogic keyboard event device and writes kernel `input_event` records directly. Unsupported keys fall back to `input keyevent`.

## State exposure

The launcher needs the current IP, port and PIN to draw a QR code. This data is provided by `StatusProvider`, protected by:

```text
com.gathin.n1remote.permission.READ_STATUS
protectionLevel=signature
```

There is no unauthenticated LAN endpoint that discloses the PIN.

## Boot and offline behavior

The server binds independently of network availability. A boot broadcast or the launcher's provider query can start the service. When network returns, the phone heartbeat and launcher network callback refresh the displayed address.

## Touch pointer

The pointer is a full-screen, `FLAG_NOT_TOUCHABLE` system overlay. The phone maps its touchpad deltas to the TV's real resolution. Click and long-press commands inject absolute touch events at the drawn pointer position.

