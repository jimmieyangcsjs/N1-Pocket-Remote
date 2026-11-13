# 第三方组件声明

## ZXing

二维码生成使用 ZXing Core 3.5.3，采用 Apache License 2.0。

## 霞鹜文楷 GB Screen

手机 Web 界面包含霞鹜文楷 GB Screen 的 WOFF2 子集。

- 项目地址：<https://github.com/lxgw/LxgwWenKai-Screen>
- 许可证：SIL Open Font License 1.1
- 完整许可证：`app/src/main/assets/web/OFL-LXGW-WenKai-Screen.txt`

该子集仅用于 N1 Remote 内部 Web 字体分发。

## scrcpy

实时镜像使用官方 scrcpy-server 5.0.1 作为设备端采集与输入注入服务，采用 Apache License 2.0。

- 项目地址：<https://github.com/Genymobile/scrcpy>
- 发布版本：`5.0.1`
- APK 内置文件：`app/src/main/assets/scrcpy-server.bin`
- 上游文件 SHA-256：`764EB6F79811D5211E9DF341120882BA9994C7A61B897D7BF3FB662E53BC536`
- 完整许可证：`app/src/main/assets/scrcpy/LICENSE.txt`

视频流代理、HTTP 鉴权、浏览器页面和触摸坐标映射为本项目实现。协议实现同时参考了 YA-webadb 对 scrcpy 视频与 WebCodecs 解码路径的公开实现：

- <https://github.com/yume-chan/ya-webadb>

## TinyH264

局域网 HTTP 页面无法使用受安全上下文限制的 WebCodecs，因此非 HTTPS 环境使用 TinyH264 WebAssembly 解码回退。

- 项目地址：<https://github.com/udevbe/tinyh264>
- 发布版本：`0.0.7`
- 许可证：Apache License 2.0
- APK 内置目录：`app/src/main/assets/web/tinyh264/`
- 完整许可证：`app/src/main/assets/web/tinyh264/LICENSE.txt`

TinyH264 内的解码器包装代码同时保留其 MIT 许可声明。WebGL 纹理上传、YUV 色彩转换、Worker 生命周期和页面集成由本项目实现。

