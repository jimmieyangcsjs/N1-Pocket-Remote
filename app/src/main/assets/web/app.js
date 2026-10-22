const $ = (id) => document.getElementById(id);
const state = {
  token: localStorage.getItem("n1remotePin") || "",
  busy: false,
  pointerActive: false,
  screenWidth: 1920,
  screenHeight: 1080,
  sensitivity: Number(localStorage.getItem("n1remoteSensitivity")) || 1
};
const requestedTab = new URLSearchParams(location.search).get("tab") || location.hash.slice(1);
let toastTimer;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function request(path, options = {}, withAuth = true, timeoutMs = 8000) {
  const headers = new Headers(options.headers || {});
  if (withAuth) headers.set("X-N1-Token", state.token);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, { ...options, headers, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("请求超时，请检查 N1 是否在线");
    throw error;
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await response.json(); } catch (_) { data = { ok: false, error: `HTTP ${response.status}` }; }
  if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function postJson(path, body, timeoutMs = 8000) {
  return request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, true, timeoutMs);
}

function setConnected(connected) {
  const badge = $("connectionBadge");
  badge.textContent = connected ? "已连接" : "未连接";
  badge.classList.toggle("online", connected);
  $("loginView").classList.toggle("hidden", connected);
  $("appView").classList.toggle("hidden", !connected);
  if (!connected) hidePointer();
}

async function login() {
  const pin = $("pin").value.trim();
  if (!/^\d{6}$/.test(pin)) return toast("请输入 6 位 PIN");
  try {
    await request("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    }, false);
    state.token = pin;
    localStorage.setItem("n1remotePin", pin);
    setConnected(true);
    await refreshStatus();
    await loadApps();
    activateRequestedTab();
    toast("已连接 N1");
  } catch (error) {
    toast(error.message);
  }
}

async function restoreSession() {
  if (!state.token) return setConnected(false);
  try {
    await refreshStatus();
    setConnected(true);
    await loadApps();
    activateRequestedTab();
  } catch (_) {
    state.token = "";
    localStorage.removeItem("n1remotePin");
    setConnected(false);
  }
}

function activateRequestedTab() {
  if (["remote", "touch", "apps", "text", "install", "more"].includes(requestedTab)) {
    activateTab(requestedTab);
  }
}

async function refreshStatus() {
  const data = await request("/api/status");
  $("deviceLine").textContent = `${data.ip}:${data.port}`;
  $("statusAddress").textContent = `${data.ip}:${data.port}`;
  $("statusRoot").textContent = data.adb ? "已连接" : "不可用";
  $("statusIme").textContent = data.ime && data.ime !== "null" ? data.ime : "未知";
  state.screenWidth = Number(data.screenWidth) || state.screenWidth;
  state.screenHeight = Number(data.screenHeight) || state.screenHeight;
  updateTouchMapping();
}

async function sendKey(code, longPress = false) {
  if (state.busy) return;
  state.busy = true;
  try { await postJson("/api/key", { code, long: longPress }); }
  catch (error) { toast(error.message); }
  finally { state.busy = false; }
}

function activateTab(name) {
  const leavingTouch = document.querySelector(".tab.active")?.dataset.tab === "touch";
  document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.toggle("active", panel.id === `tab-${name}`));
  if (name === "apps" && !$("appsGrid").children.length) loadApps();
  if (name === "more") refreshStatus().catch(error => toast(error.message));
  if (name === "touch") {
    updateTouchMapping();
    showPointer();
  } else if (leavingTouch) {
    hidePointer();
  }
}

async function loadApps() {
  const grid = $("appsGrid");
  grid.innerHTML = '<div class="hint">正在读取应用列表……</div>';
  try {
    const data = await request("/api/apps");
    grid.innerHTML = "";
    for (const app of data.apps) {
      const tile = document.createElement("div");
      tile.className = "app-tile";
      tile.title = app.package;
      const icon = document.createElement("img");
      icon.alt = "";
      icon.src = app.icon || "";
      const name = document.createElement("div");
      name.className = "app-name";
      name.textContent = app.label || app.package;
      tile.append(icon, name);
      tile.addEventListener("click", async () => {
        try {
          await postJson("/api/launch", { package: app.package });
          toast(`已启动 ${app.label}`);
        } catch (error) { toast(error.message); }
      });
      if (!app.system) {
        const remove = document.createElement("button");
        remove.className = "app-uninstall";
        remove.textContent = "×";
        remove.title = "卸载";
        remove.addEventListener("click", async event => {
          event.stopPropagation();
          if (!confirm(`从 N1 卸载“${app.label}”？应用数据也会被删除。`)) return;
          try {
            await postJson("/api/uninstall", { package: app.package });
            toast("已卸载");
            loadApps();
          } catch (error) { toast(error.message); }
        });
        tile.append(remove);
      }
      grid.append(tile);
    }
    if (!data.apps.length) grid.innerHTML = '<p class="hint">没有发现可启动应用。</p>';
  } catch (error) {
    grid.innerHTML = "";
    toast(error.message);
  }
}

async function takeScreenshot() {
  const button = $("shotButton");
  button.disabled = true;
  button.textContent = "正在获取…";
  try {
    const data = await request("/api/screenshot");
    $("screenshot").src = data.image;
    $("screenshot").style.display = "block";
    $("screenPlaceholder").style.display = "none";
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "刷新截图";
  }
}

async function installApk() {
  const file = $("apkFile").files[0];
  if (!file) return toast("请先选择 APK");
  const button = $("installButton");
  button.disabled = true;
  button.textContent = "正在上传并安装…";
  $("installLog").textContent = `${file.name}\n大小：${(file.size / 1024 / 1024).toFixed(1)} MB`;
  try {
    const result = await request("/api/install", {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "X-File-Name": encodeURIComponent(file.name)
      },
      body: file
    });
    $("installLog").textContent += "\n安装成功";
    toast(result.ok ? "安装成功" : "安装结束");
    loadApps();
  } catch (error) {
    $("installLog").textContent += `\n失败：${error.message}`;
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "上传并安装";
  }
}

async function sendText() {
  const text = $("textInput").value;
  if (!text) return toast("请输入文字");
  try {
    const result = await postJson("/api/text", { text });
    toast(result.mode === "ime" ? "已通过 N1 输入法发送" : "已复制并发送粘贴");
  } catch (error) { toast(error.message); }
}

async function imeAction(action) {
  try {
    await postJson("/api/ime", { action });
    toast(action === "select" ? "已切换到 N1 输入法" : "已恢复原输入法");
    refreshStatus().catch(() => {});
  } catch (error) { toast(error.message); }
}

// One visual/haptic feedback path for every phone-side button, including dynamically bound keys.
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
  if (!button) return;
  button.classList.remove("is-pressed");
}, { passive: true });

const touchpad = $("touchpad");
const touchDot = $("touchDot");
let touchGesture = null;
let pointerMoveBusy = false;
let pointerMoveTimer = null;
let pendingMove = { dx: 0, dy: 0 };

function updateTouchMapping() {
  const mapping = $("touchMapping");
  if (!mapping) return;
  mapping.textContent = `手机 ${Math.round(innerWidth)} × ${Math.round(innerHeight)}  →  N1 ${state.screenWidth} × ${state.screenHeight}`;
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
    toast(error.message);
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
    toast(error.message);
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
  // Keyboard/accessibility activation has detail 0 and no preceding pointer sequence.
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
    toast(error.message);
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
    end: point,
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
  touchGesture.end = point;
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
    // Normalise each axis independently, then let the TV side multiply by its real pixel size.
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
    toast(error.message);
  }
}

touchpad.addEventListener("pointerup", finishTouch);
touchpad.addEventListener("pointercancel", () => {
  if (touchGesture) clearTimeout(touchGesture.timer);
  touchGesture = null;
  touchDot.classList.remove("visible", "holding");
});
touchpad.addEventListener("contextmenu", event => event.preventDefault());

$("loginButton").addEventListener("click", login);
$("pin").addEventListener("keydown", event => { if (event.key === "Enter") login(); });
document.querySelectorAll("[data-key]").forEach(button =>
  button.addEventListener("click", () => sendKey(Number(button.dataset.key))));
document.querySelectorAll(".tab").forEach(tab =>
  tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
document.querySelectorAll("[data-sensitivity]").forEach(button =>
  button.addEventListener("click", () => {
    state.sensitivity = Number(button.dataset.sensitivity);
    localStorage.setItem("n1remoteSensitivity", String(state.sensitivity));
    document.querySelectorAll("[data-sensitivity]").forEach(item =>
      item.classList.toggle("active", item === button));
  }));
document.querySelectorAll("[data-touch-action]").forEach(button =>
  bindTouchCommand(button, longPress => pointerCommand(longPress)));
document.querySelectorAll("[data-touch-key]").forEach(button =>
  bindTouchCommand(button, longPress => sendKey(Number(button.dataset.touchKey), longPress)));
$("touchBackToRemote").addEventListener("click", () => activateTab("remote"));
$("appsRefresh").addEventListener("click", loadApps);
$("shotButton").addEventListener("click", takeScreenshot);
$("installButton").addEventListener("click", installApk);
$("textSend").addEventListener("click", sendText);
$("imeSelect").addEventListener("click", () => imeAction("select"));
$("imeRestore").addEventListener("click", () => imeAction("restore"));
$("logoutButton").addEventListener("click", () => {
  hidePointer();
  state.token = "";
  localStorage.removeItem("n1remotePin");
  setConnected(false);
});

const queryPin = new URLSearchParams(location.search).get("pin");
if (/^\d{6}$/.test(queryPin || "")) {
  state.token = queryPin;
  localStorage.setItem("n1remotePin", queryPin);
  history.replaceState(null, "", "/");
}
restoreSession();
const savedSensitivity = document.querySelector(`[data-sensitivity="${state.sensitivity}"]`)
  || document.querySelector('[data-sensitivity="1"]');
if (savedSensitivity) savedSensitivity.click();
addEventListener("resize", updateTouchMapping);
setInterval(async () => {
  if (!state.token || document.hidden) return;
  try {
    await request("/api/ping", {}, true, 3500);
    const badge = $("connectionBadge");
    badge.textContent = "已连接";
    badge.classList.add("online");
  } catch (_) {
    const badge = $("connectionBadge");
    badge.textContent = "连接中断";
    badge.classList.remove("online");
  }
}, 15_000);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    // LAN HTTP is not a secure origin in every browser; the page still works without offline caching.
  });
}
