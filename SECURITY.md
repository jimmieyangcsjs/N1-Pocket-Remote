# Security

N1 Remote is designed for a trusted private LAN.

- Never expose port `8088` or ADB port `5555` directly to the internet.
- Use a separate/VLAN network or Tailscale when remote access is required.
- Treat screenshots containing the QR code or PIN as secrets.
- The web UI uses HTTP because the legacy Android TV device does not provide a practical local HTTPS certificate. Do not assume transport encryption.
- The launcher status provider is protected by a `signature` permission. A differently signed APK cannot read the PIN.

Report security issues privately to the repository owner rather than opening a public issue with active credentials.

