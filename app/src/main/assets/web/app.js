"use strict";

const $ = id => document.getElementById(id);
const core = window.N1RemoteCore;
const PAGE_TITLES = {
  remote: "遥控",
  touch: "触控板",
  apps: "应用",
  install: "安装 APK",
  text: "文字输入",
  more: "连接与安全"
};
const VALID_TABS = new Set(Object.keys(PAGE_TITLES));
const requestedTab = new URLSearchParams(location.search).get("tab") || location.hash.slice(1);
const state = {
  token: localStorage.getItem("n1remotePin") || "",
  connected: false,
  pointerActive: false,
  screenWidth: 1920,
  screenHeight: 1080,
  sensitivity: Number(localStorage.getItem("n1remoteSensitivity")) || 1,
  apps: [],
  appsLoaded: false,
  appsLoading: false,
  search: ""
};
let toastTimer;
let heartbeatTimer;
let lastErrorText = "";
let lastErrorAt = 0;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

function reportError(error, silent = false) {
  if (error && error.status === 401) {
    forgetSession("访问 PIN 已失效，请重新连接");
    return;
  }
  if (error && error.offline) markOffline();
  if (silent) return;
  const message = error && error.message ? error.message : "操作失败";
  const now = Date.now();
  if (message === lastErrorText && now - lastErrorAt < 2200) return;
  lastErrorText = message;
  lastErrorAt = now;
  toast(message);
}

async function request(path, options = {}, withAuth = true, timeoutMs = 8000) {
  const headers = new Headers(options.headers || {});
  if (withAuth) headers.set("X-N1-Token", state.token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, { ...options, headers, signal: controller.signal });
  } catch (cause) {
    const error = new Error(cause.name === "AbortError"
      ? "请求超时，请检查 N1 是否在线"
      : "无法连接 N1，请确认手机与盒子在同一网络");
    error.offline = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    data = { ok: false, error: `N1 返回了无效响应（HTTP ${response.status}）` };
  }
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function postJson(path, body, timeoutMs = 8000) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, true, timeoutMs);
}

function setBadge(kind, text) {
  const badge = $("connectionBadge");
  badge.textContent = text;
  badge.dataset.state = kind;
  badge.classList.toggle("online", kind === "online");
  document.body.dataset.connection = kind;
}

function revealShell() {
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
}

function showLogin() {
  $("appView").classList.add("hidden");
  $("loginView").classList.remove("hidden");
  hidePointer();
}

function markOnline() {
  state.connected = true;
  setBadge("online", "已连接");
  if (state.token) revealShell();
}

function markOffline() {
  state.connected = false;
  setBadge("offline", state.token ? "连接中断" : "未连接");
  if (state.token) revealShell();
  else showLogin();
}

function forgetSession(message) {
  hidePointer();
  clearTimeout(heartbeatTimer);
  heartbeatTimer = null;
  state.token = "";
  state.connected = false;
  state.apps = [];
  state.appsLoaded = false;
  localStorage.removeItem("n1remotePin");
  setBadge("offline", "未连接");
  showLogin();
  if (message) toast(message);
}

async function login() {
  const pin = $("pin").value.trim();
  if (!/^\d{6}$/.test(pin)) {
    toast("请输入电视上显示的 6 位 PIN");
    return;
  }
  const button = $("loginButton");
  button.disabled = true;
  button.textContent = "正在连接…";
  try {
    await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    }, false);
    state.token = pin;
    state.apps = [];
    state.appsLoaded = false;
    localStorage.setItem("n1remotePin", pin);
    markOnline();
    await Promise.all([refreshStatus(), loadApps({ silent: true })]);
    activateRequestedTab();
    scheduleHeartbeat(core.nextRetryDelay(true));
    toast("已连接 N1");
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "进入控制台";
  }
}

async function restoreSession() {
  if (!state.token) {
    showLogin();
    return;
  }
  revealShell();
  setBadge("checking", "正在连接");
  try {
    await refreshStatus();
    markOnline();
    await loadApps({ silent: true });
    activateRequestedTab();
  } catch (error) {
    if (error.status === 401) {
      forgetSession("已保存的 PIN 已失效，请重新扫码");
      return;
    }
    markOffline();
    reportError(error);
    activateRequestedTab();
  } finally {
    if (state.token) scheduleHeartbeat(core.nextRetryDelay(state.connected));
  }
}

function activateRequestedTab() {
  if (VALID_TABS.has(requestedTab)) activateTab(requestedTab);
  else activateTab("remote");
}

function activateTab(name) {
  if (!VALID_TABS.has(name)) return;
  const previous = document.querySelector(".panel.active")?.id.replace("tab-", "");
  const navName = name === "install" ? "apps" : name;
  document.querySelectorAll(".tab").forEach(tab =>
    tab.classList.toggle("active", tab.dataset.tab === navName));
  document.querySelectorAll(".panel").forEach(panel =>
    panel.classList.toggle("active", panel.id === `tab-${name}`));
  document.title = `${PAGE_TITLES[name]} · N1 Remote`;

  if (previous === "touch" && name !== "touch") hidePointer();
  if (name === "touch") showPointer();
  if (name === "apps") {
    if (!state.appsLoaded && !state.appsLoading) loadApps();
    else renderApps();
  }
  if (name === "more") refreshStatus().catch(error => reportError(error));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function refreshStatus() {
  const data = await request("/api/status");
  $("deviceLine").textContent = `${data.ip}:${data.port}`;
  $("statusAddress").textContent = `${data.ip}:${data.port}`;
  $("statusRoot").textContent = data.adb ? "正常" : "不可用";
  $("statusIme").textContent = data.ime && data.ime !== "null" ? data.ime : "未知";
  state.screenWidth = Number(data.screenWidth) || state.screenWidth;
  state.screenHeight = Number(data.screenHeight) || state.screenHeight;
  updateTouchMapping();
  return data;
}

async function loadApps({ silent = false } = {}) {
  if (state.appsLoading) return;
  state.appsLoading = true;
  const grid = $("appsGrid");
  const refresh = $("appsRefresh");
  refresh.disabled = true;
  if (!silent && !state.appsLoaded) {
    grid.innerHTML = '<div class="empty-state loading-state"><span></span>正在读取 N1 应用…</div>';
    $("appCount").textContent = "读取中";
  }
  try {
    const data = await request("/api/apps");
    state.apps = Array.isArray(data.apps) ? data.apps : [];
    state.appsLoaded = true;
    renderApps();
  } catch (error) {
    reportError(error, silent);
    if (!state.appsLoaded) {
      grid.innerHTML = '<div class="empty-state">暂时无法读取应用列表，请检查连接后重试。</div>';
      $("appCount").textContent = "离线";
    }
  } finally {
    state.appsLoading = false;
    refresh.disabled = false;
  }
}

function renderApps() {
  const grid = $("appsGrid");
  const apps = core.filterApps(state.apps, state.search);
  grid.textContent = "";
  $("appCount").textContent = state.search
    ? `${apps.length} / ${state.apps.length}`
    : `${state.apps.length} 个`;

  if (!apps.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.search ? "没有匹配的应用" : "没有发现可启动应用";
    grid.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const app of apps) {
    const label = app.label || app.package;
    const tile = document.createElement("div");
    tile.className = "app-tile";
    tile.title = app.package;
    tile.tabIndex = 0;
    tile.setAttribute("role", "button");
    tile.setAttribute("aria-label", `启动 ${label}`);

    const icon = document.createElement("img");
    icon.alt = "";
    icon.loading = "lazy";
    icon.decoding = "async";
    icon.src = app.icon || "/icon.png";
    icon.addEventListener("error", () => {
      icon.src = "/icon.png";
    }, { once: true });

    const name = document.createElement("div");
    name.className = "app-name";
    name.textContent = label;

    const meta = document.createElement("div");
    meta.className = "app-meta";
    meta.textContent = app.system ? "系统应用" : "用户应用";

    const launch = async () => {
      if (tile.classList.contains("launching")) return;
      tile.classList.add("launching");
      try {
        await postJson("/api/launch", { package: app.package });
        toast(`已启动 ${label}`);
      } catch (error) {
        reportError(error);
      } finally {
        tile.classList.remove("launching");
      }
    };
    tile.addEventListener("click", launch);
    tile.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      launch();
    });

    if (!app.system) {
      const remove = document.createElement("button");
      remove.className = "app-uninstall";
      remove.type = "button";
      remove.textContent = "×";
      remove.title = `卸载 ${label}`;
      remove.setAttribute("aria-label", `卸载 ${label}`);
      remove.addEventListener("click", async event => {
        event.stopPropagation();
        if (!confirm(`从 N1 卸载“${label}”？应用数据也会被删除。`)) return;
        remove.disabled = true;
        try {
          await postJson("/api/uninstall", { package: app.package });
          toast(`已卸载 ${label}`);
          await loadApps();
        } catch (error) {
          reportError(error);
          remove.disabled = false;
        }
      });
      tile.append(remove);
    }
    tile.append(icon, name, meta);
    fragment.append(tile);
  }
  grid.append(fragment);
}

async function takeScreenshot() {
  const button = $("shotButton");
  const shell = document.querySelector(".screen-shell");
  button.disabled = true;
  button.textContent = "正在获取…";
  shell.classList.add("loading");
  try {
    const data = await request("/api/screenshot", {}, true, 15_000);
    $("screenshot").src = data.image;
    $("screenshot").style.display = "block";
    $("screenPlaceholder").style.display = "none";
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "刷新截图";
    shell.classList.remove("loading");
  }
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function setInstallProgress(percent) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  $("installProgress").setAttribute("aria-valuenow", String(value));
  $("installProgressValue").style.width = `${value}%`;
  $("installProgressLabel").textContent = value < 100 ? `上传中 ${value}%` : "正在由 N1 安装…";
}

function uploadApk(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/install");
    xhr.timeout = 180_000;
    xhr.setRequestHeader("Content-Type", "application/vnd.android.package-archive");
    xhr.setRequestHeader("X-N1-Token", state.token);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) setInstallProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch (_) {
        data = { ok: false, error: `安装响应无效（HTTP ${xhr.status}）` };
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) resolve(data);
      else {
        const error = new Error(data.error || `安装失败（HTTP ${xhr.status}）`);
        error.status = xhr.status;
        reject(error);
      }
    };
    xhr.onerror = () => {
      const error = new Error("上传中断，请检查 N1 网络连接");
      error.offline = true;
      reject(error);
    };
    xhr.ontimeout = () => reject(new Error("上传超时，请重试"));
    xhr.send(file);
  });
}

async function installApk() {
  const file = $("apkFile").files[0];
  if (!file) {
    toast("请先选择 APK");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".apk")) {
    toast("请选择 .apk 安装包");
    return;
  }
  const button = $("installButton");
  const log = $("installLog");
  button.disabled = true;
  button.textContent = "正在上传…";
  $("installProgress").classList.add("visible");
  setInstallProgress(0);
  log.textContent = `${file.name}\n大小：${formatBytes(file.size)}`;
  let installed = false;
  try {
    await uploadApk(file);
    installed = true;
    setInstallProgress(100);
    log.textContent += "\n安装成功，应用列表已刷新";
    toast("APK 安装成功");
    await loadApps({ silent: true });
  } catch (error) {
    setInstallProgress(0);
    log.textContent += `\n失败：${error.message}`;
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "上传并安装";
    $("installProgressLabel").textContent = installed ? "安装完成" : "安装未完成";
  }
}

function updateTextCount() {
  $("textCount").textContent = `${core.countText($("textInput").value)} 字`;
}

async function sendText() {
  const text = $("textInput").value;
  if (!text.trim()) {
    toast("请输入要发送的文字");
    return;
  }
  const button = $("textSend");
  button.disabled = true;
  button.textContent = "正在发送…";
  try {
    const result = await postJson("/api/text", { text });
    toast(result.mode === "ime" ? "已通过 N1 输入法发送" : "已复制到电视并发送粘贴");
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = "发送到电视";
  }
}

async function imeAction(action, button) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = action === "select" ? "正在切换…" : "正在恢复…";
  try {
    await postJson("/api/ime", { action });
    toast(action === "select" ? "已切换到 N1 输入法" : "已恢复原输入法");
    refreshStatus().catch(error => reportError(error, true));
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

// One visual/haptic path for all static and dynamically created phone buttons.
document.addEventListener("pointerdown", event => {
  const button = event.target.closest?.("button");
  if (!button || button.disabled) return;
  const box = button.getBoundingClientRect();
  button.style.setProperty("--press-x", `${event.clientX - box.left}px`);
  button.style.setProperty("--press-y", `${event.clientY - box.top}px`);
  button.classList.add("is-pressed");
  navigator.vibrate?.(7);
}, { passive: true });

function releaseButtonFeedback(event) {
  const button = event.target.closest?.("button");
  if (button) button.classList.remove("is-pressed");
}
document.addEventListener("pointerup", releaseButtonFeedback, { passive: true });
document.addEventListener("pointercancel", releaseButtonFeedback, { passive: true });
document.addEventListener("click", event => {
  const button = event.target.closest?.("button");
  if (button) button.classList.remove("is-pressed");
}, { passive: true });

const keyQueue = core.createSerialQueue(
  command => postJson("/api/key", command),
  error => reportError(error)
);

function sendKey(code, longPress = false) {
  if (!Number.isInteger(code) || code < 0) return;
  keyQueue.enqueue({ code, long: Boolean(longPress) });
}

const touchpad = $("touchpad");
const touchDot = $("touchDot");
let touchGesture = null;
let pointerMoveBusy = false;
let pointerMoveTimer = null;
let pendingMove = { dx: 0, dy: 0 };

function updateTouchMapping() {
  $("touchMapping").textContent =
    `手机 ${Math.round(innerWidth)} × ${Math.round(innerHeight)}  →  N1 ${state.screenWidth} × ${state.screenHeight}`;
}

function applyPointerState(data) {
  if (!data || typeof data.x !== "number") return;
  state.screenWidth = Number(data.screenWidth) || state.screenWidth;
  state.screenHeight = Number(data.screenHeight) || state.screenHeight;
  $("touchPointerState").textContent = `指针 ${data.x}, ${data.y}`;
  updateTouchMapping();
}

async function showPointer() {
  try {
    const data = await postJson("/api/pointer", { action: "show" });
    state.pointerActive = true;
    applyPointerState(data);
  } catch (error) {
    state.pointerActive = false;
    $("touchPointerState").textContent = "指针不可用";
    reportError(error);
  }
}

function hidePointer() {
  if (!state.pointerActive) return;
  state.pointerActive = false;
  pendingMove = { dx: 0, dy: 0 };
  clearTimeout(pointerMoveTimer);
  pointerMoveTimer = null;
  postJson("/api/pointer", { action: "hide" }).catch(() => {});
}

async function pointerCommand(longPress) {
  try {
    const data = await postJson("/api/pointer", { action: longPress ? "long" : "click" });
    state.pointerActive = true;
    applyPointerState(data);
    $("touchPointerState").textContent = longPress ? "已长按" : "已点击";
  } catch (error) {
    reportError(error);
  }
}

function bindTouchCommand(button, action) {
  let timer = null;
  let fired = false;
  let pointerId = null;
  const start = event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointerId = event.pointerId;
    button.setPointerCapture(pointerId);
    fired = false;
    button.classList.add("pressed");
    timer = setTimeout(() => {
      fired = true;
      navigator.vibrate?.(20);
      action(true);
    }, 560);
    event.preventDefault();
  };
  const finish = event => {
    if (pointerId !== null && event.pointerId !== pointerId) return;
    clearTimeout(timer);
    timer = null;
    pointerId = null;
    button.classList.remove("pressed");
    if (!fired) action(false);
    event.preventDefault();
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    pointerId = null;
    button.classList.remove("pressed");
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("contextmenu", event => event.preventDefault());
  button.addEventListener("click", event => {
    if (event.detail === 0) action(false);
  });
}

function queuePointerMove(dx, dy) {
  pendingMove.dx += dx;
  pendingMove.dy += dy;
  if (pointerMoveTimer) return;
  pointerMoveTimer = setTimeout(flushPointerMove, 38);
}

async function flushPointerMove() {
  pointerMoveTimer = null;
  if (pointerMoveBusy) {
    pointerMoveTimer = setTimeout(flushPointerMove, 30);
    return;
  }
  const dx = pendingMove.dx;
  const dy = pendingMove.dy;
  pendingMove = { dx: 0, dy: 0 };
  if (Math.abs(dx) + Math.abs(dy) < 0.0005) return;
  pointerMoveBusy = true;
  try {
    const data = await postJson("/api/pointer", { action: "move", dx, dy }, 2200);
    applyPointerState(data);
  } catch (error) {
    state.pointerActive = false;
    $("touchPointerState").textContent = "指针不可用";
    reportError(error);
  } finally {
    pointerMoveBusy = false;
    if (Math.abs(pendingMove.dx) + Math.abs(pendingMove.dy) >= 0.0005) {
      pointerMoveTimer = setTimeout(flushPointerMove, 20);
    }
  }
}

function touchPoint(event) {
  const box = touchpad.getBoundingClientRect();
  return {
    x: Math.max(0.005, Math.min(0.995, (event.clientX - box.left) / box.width)),
    y: Math.max(0.005, Math.min(0.995, (event.clientY - box.top) / box.height)),
    px: event.clientX - box.left,
    py: event.clientY - box.top
  };
}

function positionTouchDot(point) {
  touchDot.style.left = `${point.px}px`;
  touchDot.style.top = `${point.py}px`;
}

touchpad.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  touchpad.setPointerCapture(event.pointerId);
  const point = touchPoint(event);
  touchGesture = {
    start: point,
    last: point,
    time: performance.now(),
    hold: false,
    moved: false,
    timer: null
  };
  positionTouchDot(point);
  touchDot.classList.add("visible");
  touchDot.classList.remove("holding");
  navigator.vibrate?.(8);
  touchGesture.timer = setTimeout(() => {
    if (!touchGesture) return;
    touchGesture.hold = true;
    touchDot.classList.add("holding");
    navigator.vibrate?.(18);
  }, 560);
  event.preventDefault();
});

touchpad.addEventListener("pointermove", event => {
  if (!touchGesture) return;
  const point = touchPoint(event);
  positionTouchDot(point);
  const dxPx = point.px - touchGesture.last.px;
  const dyPx = point.py - touchGesture.last.py;
  touchGesture.last = point;
  if (Math.hypot(point.px - touchGesture.start.px, point.py - touchGesture.start.py) > 7) {
    touchGesture.moved = true;
    clearTimeout(touchGesture.timer);
  }
  if (touchGesture.moved && (Math.abs(dxPx) > 0.2 || Math.abs(dyPx) > 0.2)) {
    const box = touchpad.getBoundingClientRect();
    queuePointerMove(
      (dxPx / Math.max(1, box.width)) * state.sensitivity,
      (dyPx / Math.max(1, box.height)) * state.sensitivity
    );
  }
  event.preventDefault();
});

async function finishTouch(event) {
  if (!touchGesture) return;
  const gesture = touchGesture;
  touchGesture = null;
  clearTimeout(gesture.timer);
  touchDot.classList.remove("visible", "holding");
  try {
    await flushPointerMove();
    if (!gesture.moved) {
      const data = await postJson("/api/pointer", {
        action: gesture.hold ? "long" : "click"
      });
      applyPointerState(data);
      $("touchPointerState").textContent = gesture.hold ? "已长按" : "已点击";
    }
  } catch (error) {
    reportError(error);
  }
  event.preventDefault();
}

touchpad.addEventListener("pointerup", finishTouch);
touchpad.addEventListener("pointercancel", () => {
  if (touchGesture) clearTimeout(touchGesture.timer);
  touchGesture = null;
  touchDot.classList.remove("visible", "holding");
});
touchpad.addEventListener("contextmenu", event => event.preventDefault());

function selectSensitivity(value) {
  state.sensitivity = Number(value);
  localStorage.setItem("n1remoteSensitivity", String(state.sensitivity));
  document.querySelectorAll("[data-sensitivity]").forEach(button =>
    button.classList.toggle("active", Number(button.dataset.sensitivity) === state.sensitivity));
}

$("loginButton").addEventListener("click", login);
$("pin").addEventListener("keydown", event => {
  if (event.key === "Enter") login();
});
document.querySelectorAll("[data-key]").forEach(button =>
  button.addEventListener("click", () => sendKey(Number(button.dataset.key))));
document.querySelectorAll(".tab").forEach(tab =>
  tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
document.querySelectorAll("[data-open-tab]").forEach(button =>
  button.addEventListener("click", () => activateTab(button.dataset.openTab)));
document.querySelectorAll("[data-tab-jump]").forEach(button =>
  button.addEventListener("click", () => activateTab(button.dataset.tabJump)));
document.querySelectorAll("[data-sensitivity]").forEach(button =>
  button.addEventListener("click", () => selectSensitivity(button.dataset.sensitivity)));
document.querySelectorAll("[data-touch-action]").forEach(button =>
  bindTouchCommand(button, longPress => pointerCommand(longPress)));
document.querySelectorAll("[data-touch-key]").forEach(button =>
  bindTouchCommand(button, longPress => sendKey(Number(button.dataset.touchKey), longPress)));
$("touchBackToRemote").addEventListener("click", () => activateTab("remote"));
$("appsRefresh").addEventListener("click", () => loadApps());
$("appsSearch").addEventListener("input", event => {
  state.search = event.target.value;
  renderApps();
});
$("openInstall").addEventListener("click", () => activateTab("install"));
$("installBack").addEventListener("click", () => activateTab("apps"));
$("shotButton").addEventListener("click", takeScreenshot);
$("apkFile").addEventListener("change", event => {
  const file = event.target.files[0];
  $("apkFileName").textContent = file ? file.name : "选择安装包";
  $("apkMeta").textContent = file
    ? `${formatBytes(file.size)} · 点击更换文件`
    : "支持 .apk，覆盖安装会保留应用数据";
});
$("installButton").addEventListener("click", installApk);
$("textInput").addEventListener("input", updateTextCount);
$("textSend").addEventListener("click", sendText);
$("imeSelect").addEventListener("click", event => imeAction("select", event.currentTarget));
$("imeRestore").addEventListener("click", event => imeAction("restore", event.currentTarget));
$("logoutButton").addEventListener("click", () => {
  if (!confirm("断开手机并忘记当前 PIN？N1 上的服务不会被卸载。")) return;
  hidePointer();
  forgetSession("已断开并忘记 PIN");
});

function scheduleHeartbeat(delay) {
  clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(checkHeartbeat, delay);
}

async function checkHeartbeat() {
  heartbeatTimer = null;
  if (!state.token) return;
  if (document.hidden) {
    scheduleHeartbeat(15_000);
    return;
  }
  try {
    await request("/api/ping", {}, true, 4000);
    const recovered = !state.connected;
    markOnline();
    if (recovered) {
      toast("已重新连接 N1");
      refreshStatus().catch(error => reportError(error, true));
      if (state.appsLoaded) loadApps({ silent: true });
    }
    scheduleHeartbeat(core.nextRetryDelay(true));
  } catch (error) {
    if (error.status === 401) {
      forgetSession("访问 PIN 已失效，请重新扫码");
      return;
    }
    markOffline();
    scheduleHeartbeat(core.nextRetryDelay(false));
  }
}

addEventListener("online", () => {
  if (state.token) scheduleHeartbeat(300);
});
addEventListener("offline", () => {
  if (state.token) {
    markOffline();
    scheduleHeartbeat(core.nextRetryDelay(false));
  }
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.token) scheduleHeartbeat(150);
});
addEventListener("resize", updateTouchMapping);

const queryPin = new URLSearchParams(location.search).get("pin");
if (/^\d{6}$/.test(queryPin || "")) {
  state.token = queryPin;
  localStorage.setItem("n1remotePin", queryPin);
  history.replaceState(null, "", location.pathname + (requestedTab ? `?tab=${encodeURIComponent(requestedTab)}` : ""));
}

selectSensitivity(
  document.querySelector(`[data-sensitivity="${state.sensitivity}"]`) ? state.sensitivity : 1
);
updateTextCount();
updateTouchMapping();
if (requestedTab === "mirror") location.replace("/mirror.html");
else restoreSession();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js")
    .then(registration => registration.update())
    .catch(() => {
      // LAN HTTP is not a secure origin in every browser; the console still works without PWA caching.
    });
}
