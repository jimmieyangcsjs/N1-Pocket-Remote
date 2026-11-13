# 参与贡献

## 提交前检查

- 修改必须保持 API 25 兼容。
- 不要通过普通 root 上下文测试输入注入。N1 固件可能触发 InputManager 异常，必须使用 shell 上下文或常驻的 `InputDaemon`。
- HTTP 服务不得增加会泄露 PIN、IP、应用数据、文件或 Shell 输出的匿名接口。
- 不要提交真实 PIN、局域网 IP、设备序列号、私有 APK，或包含上述信息的设备截图。
- 新增手机控件必须适合触控，并保留键盘可访问性。

## 开发检查

```powershell
node --check app/src/main/assets/web/app.js
node --check app/src/main/assets/web/client-core.js
node --check app/src/main/assets/web/mirror.js
node --test tests/web-assets.test.js tests/client-core.test.js tests/android-tv-layout.test.js
.\gradlew.bat test assembleRelease
```

至少验证以下场景：

- PIN 登录与 URL 自动登录
- 遥控按键和长按
- 触控点击、长按和移动
- 应用启动与 APK 上传
- 服务停止或重启后的恢复
- 无网络启动与网络恢复
- 手机镜像页在竖屏、横屏、全屏和屏幕旋转后的布局
- 手机横屏左侧 TV 画面、右侧标题/控制键/会话按钮互不重叠
- 用户可见文案统一使用“镜像”，不再出现旧文案“镜面”

提交 Pull Request 时，请注明测试设备、固件版本和已验证的异常场景。

