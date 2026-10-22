# Optional: N1 system font

The tested N1 build uses **LXGW WenKai GB Screen** for Simplified Chinese while keeping Noto fonts for symbols and missing glyphs.

This is an optional device modification, not required by N1 Remote.

## Safety

- Back up `/system/etc/fonts.xml`.
- Keep the original Noto CJK, Emoji and Symbols files.
- Add the font only to the `lang="zh-Hans"` family.
- Validate XML and hash before rebooting.
- Keep a recovery path over USB ADB.

The full font is not committed because it is about 26 MB. Download `LXGWWenKaiGBScreen.ttf` from the official [LxgwWenKai-Screen releases](https://github.com/lxgw/LxgwWenKai-Screen/releases).

License: SIL OFL 1.1.

