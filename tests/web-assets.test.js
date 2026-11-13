const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../app/src/main/assets/web");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mirrorHtml = fs.readFileSync(path.join(root, "mirror.html"), "utf8");
const mirrorScript = fs.readFileSync(path.join(root, "mirror.js"), "utf8");
const mirrorStyles = fs.readFileSync(path.join(root, "mirror.css"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const repoRoot = path.join(__dirname, "..");

test("redesigned phone console exposes all navigation and management controls", () => {
  for (const id of [
    "openInstall", "installBack", "appsSearch", "appCount", "textCount",
    "touchpad", "installButton", "logoutButton"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const tab of ["remote", "touch", "apps", "text", "more"]) {
    assert.match(html, new RegExp(`data-tab="${tab}"`));
  }
  assert.doesNotMatch(html, /data-tab="install"/);
  assert.match(html, /href="\/mirror\.html"/);
  assert.doesNotMatch(html, /id="tab-mirror"/);
});

test("real-time mirror is a standalone feature page", () => {
  for (const id of [
    "screen", "viewport", "retry", "reconnect", "exitMirror",
    "backKey", "homeKey", "menuKey", "navPad",
    "upKey", "downKey", "leftKey", "rightKey", "centerKey"
  ]) {
    assert.match(mirrorHtml, new RegExp(`id="${id}"`));
  }
  assert.match(mirrorHtml, /WebCodecs|H\.264/);
  assert.match(mirrorHtml, /src="\/mirror\.js"/);
});

test("mirror direction pad supports portrait and landscape placement with long press", () => {
  assert.match(mirrorHtml, /aria-label="向上"/);
  assert.match(mirrorHtml, /aria-label="向下"/);
  assert.match(mirrorHtml, /aria-label="向左"/);
  assert.match(mirrorHtml, /aria-label="向右"/);
  assert.match(mirrorHtml, /aria-label="确定"/);
  assert.match(mirrorScript, /bindKey\(\$\("upKey"\), 19\)/);
  assert.match(mirrorScript, /bindKey\(\$\("downKey"\), 20\)/);
  assert.match(mirrorScript, /bindKey\(\$\("leftKey"\), 21\)/);
  assert.match(mirrorScript, /bindKey\(\$\("rightKey"\), 22\)/);
  assert.match(mirrorScript, /bindKey\(\$\("centerKey"\), 23\)/);
  assert.match(mirrorScript, /controls-side/);
  assert.match(mirrorStyles, /\.stage\.controls-side/);
});

test("mirror quick keys share one adaptive cluster with the direction pad", () => {
  assert.match(mirrorHtml, /id="controlCluster"/);
  assert.doesNotMatch(mirrorHtml, /class="primary-controls"/);
  const clusterStart = mirrorHtml.indexOf('id="controlCluster"');
  for (const id of ["backKey", "homeKey", "navPad", "menuKey", "fullscreen"]) {
    assert.ok(mirrorHtml.indexOf(`id="${id}"`) > clusterStart, `${id} must be inside controlCluster`);
  }
  assert.match(mirrorStyles, /\.control-cluster/);
  assert.match(mirrorStyles, /\.controls-side\s+\.control-cluster/);
  assert.match(mirrorScript, /controlCluster\.getBoundingClientRect/);
});

test("landscape mirror uses the full height and an inset right control rail", () => {
  assert.match(mirrorStyles, /--rail-inset/);
  assert.match(mirrorStyles, /--rail-width/);
  assert.match(
    mirrorStyles,
    /@media\s*\(orientation:\s*landscape\)[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)/
  );
  assert.match(
    mirrorStyles,
    /@media\s*\(orientation:\s*landscape\)[\s\S]*?\.mirror-bar\s*\{[^}]*position:\s*absolute/
  );
  assert.match(
    mirrorStyles,
    /@media\s*\(orientation:\s*landscape\)[\s\S]*?\.control-deck\s*\{[^}]*position:\s*absolute/
  );
});

test("landscape rail separates the title, controls and session actions", () => {
  const landscape = mirrorStyles.slice(
    mirrorStyles.indexOf("@media (orientation: landscape) and (max-height: 620px)"),
    mirrorStyles.indexOf("@media (min-width: 900px)")
  );
  assert.match(landscape, /"back title status"/);
  assert.match(landscape, /repeat\(4,\s*minmax\(44px,\s*1fr\)\)/);
  assert.match(landscape, /\.session-controls\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
});

test("all user-facing Chinese mirror copy uses the term 镜像", () => {
  const textFiles = [
    "README.md",
    "CHANGELOG.md",
    "AI-NOTICE.md",
    "NOTICE.md",
    "SECURITY.md",
    "docs/ARCHITECTURE.md",
    "docs/INSTALL.md",
    "dist/AI-NOTICE.txt",
    "dist/NOTICE.txt",
    "app/src/main/res/layout/activity_main.xml",
    "app/src/main/assets/web/index.html",
    "app/src/main/assets/web/mirror.html",
    "app/src/main/assets/web/mirror.js",
    "app/src/main/java/com/gathin/n1remote/RemoteServer.java",
    "app/src/main/java/com/gathin/n1remote/ScrcpyMirror.java"
  ];
  for (const relative of textFiles) {
    const content = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    assert.doesNotMatch(content, /镜面/, `${relative} still contains 镜面`);
  }
  assert.match(mirrorHtml, /实时镜像/);
  assert.match(mirrorHtml, /退出镜像/);
});

test("client core loads before the application and cache version changes with this release", () => {
  assert.ok(html.indexOf("/client-core.js") >= 0);
  assert.ok(html.indexOf("/client-core.js") < html.indexOf("/app.js"));
  assert.match(serviceWorker, /n1remote-v13/);
  assert.match(serviceWorker, /skipWaiting/);
  assert.match(serviceWorker, /clients\.claim/);
});

test("HTTP mirror has an offline WebAssembly decoder fallback", () => {
  assert.match(mirrorScript, /tinyh264\/client\.js/);
  assert.match(serviceWorker, /\/tinyh264\/TinyH264\.js/);
  assert.match(mirrorHtml, /H\.264/);
});

test("mirror uses full-page fullscreen and recalculates after rotation or viewport changes", () => {
  assert.match(mirrorHtml, /id="mirrorApp"/);
  assert.match(mirrorScript, /mirrorApp\.requestFullscreen/);
  assert.doesNotMatch(mirrorScript, /viewport\.requestFullscreen/);
  assert.match(mirrorScript, /fullscreenchange/);
  assert.match(mirrorScript, /orientationchange/);
  assert.match(mirrorScript, /visualViewport/);
  assert.match(mirrorScript, /ResizeObserver/);
  assert.match(mirrorScript, /--mirror-ratio/);
});

test("mirror keeps touch gestures alive through cancellation and lost capture", () => {
  assert.match(mirrorScript, /lostpointercapture/);
  assert.match(mirrorScript, /getCoalescedEvents/);
  assert.match(mirrorScript, /passive:\s*false/);
});

test("mirror fullscreen retries without navigation options on older mobile browsers", () => {
  assert.match(
    mirrorScript,
    /requestFullscreen\(\{\s*navigationUI:\s*"hide"\s*\}\)[\s\S]*catch[\s\S]*requestFullscreen\(\)/
  );
});

test("fullscreen stays edge-to-edge after the 1080p and 4K size rules", () => {
  const largeScreenRule = mirrorStyles.lastIndexOf("@media (min-width: 3000px)");
  const fullscreenOverride = mirrorStyles.lastIndexOf(".mirror-app:fullscreen");
  assert.ok(fullscreenOverride > largeScreenRule);
  assert.match(
    mirrorStyles.slice(fullscreenOverride),
    /max-width:\s*none\s*!important/
  );
});
