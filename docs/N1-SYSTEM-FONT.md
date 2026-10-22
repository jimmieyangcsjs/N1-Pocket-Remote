# 可选：N1 系统字体

实测 N1 使用 **霞鹜文楷 GB Screen** 作为简体中文主字体，同时保留 Noto 符号和缺字回退字体。

这是可选的设备级修改，不是 N1 Remote 的运行前提。

## 安全要求

- 备份 `/system/etc/fonts.xml`。
- 保留原始 Noto CJK、Emoji 和 Symbols 字体。
- 只将新字体加入 `lang="zh-Hans"` 字体族，避免抢占图标和特殊符号回退。
- 重启前校验 XML、文件权限、SELinux 标签和 SHA-256。
- 保留 USB ADB 恢复通道。

完整字体约 26 MB，因此不提交到仓库。请从官方 [LxgwWenKai-Screen Releases](https://github.com/lxgw/LxgwWenKai-Screen/releases) 下载 `LXGWWenKaiGBScreen.ttf`。

许可证：SIL OFL 1.1。

