"use strict";

const $ = id => document.getElementById(id);
const core = window.N1RemoteCore;
const queryPin = new URLSearchParams(location.search).get("pin");
const token = /^\d{6}$/.test(queryPin || "")
  ? queryPin
  : localStorage.getItem("n1remotePin") || "";
if (/^\d{6}$/.test(queryPin || "")) {
  localStorage.setItem("n1remotePin", queryPin);
  history.replaceState(null, "", location.pathname);
}
const canvas = $("screen");
const viewport = $("viewport");
const mirrorApp = $("mirrorApp");
const stage = document.querySelector(".stage");
const controlCluster = $("controlCluster");

const state = {
  abort: null,
  decoder: null,
  tinySession: null,
  context: null,
  decoderMode: "",
  width: 1920,
  height: 1080,
  packetCount: 0,
  frameCount: 0,
  startedAt: 0,
  lastTimestamp: 0,
  streamError: "",
  inputBusy: false
};

const inputQueue = [];
let pendingFrame = null;
let drawFrame = 0;
let gesture = null;
let pendingMove = null;
let moveFrame = 0;
let layoutFrame = 0;

function setStatus(kind, text) {
  const element = $("linkState");
  element.dataset.state = kind;
  element.querySelector("span").textContent = text;
}

function showPlaceholder(title, text, retry = false) {
  $("placeholderTitle").textContent = title;
  $("placeholderText").textContent = text;
  $("retry").hidden = !retry;
  viewport.classList.remove("streaming");
}

function formatLatency(ms) {
  return ms < 1 ? "<1 ms" : `${Math.round(ms)} ms`;
}

function updateMirrorMetrics(width, height) {
  const nextWidth = Math.round(Number(width));
  const nextHeight = Math.round(Number(height));
  if (nextWidth <= 0 || nextHeight <= 0) return;
  state.width = nextWidth;
  state.height = nextHeight;
  document.documentElement.style.setProperty(
    "--mirror-ratio",
    core.mirrorAspect(nextWidth, nextHeight).toFixed(8)
  );
  viewport.style.aspectRatio = `${nextWidth} / ${nextHeight}`;
  $("resolution").textContent = `${nextWidth}×${nextHeight}`;
  scheduleMirrorLayout();
}

function fitMirrorToStage() {
  layoutFrame = 0;
  const viewportHeight = Math.max(1, visualViewport?.height || innerHeight);
  document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
  const box = stage.getBoundingClientRect();
  const style = getComputedStyle(stage);
  const sideControls = matchMedia("(orientation: landscape)").matches;
  stage.classList.toggle("controls-side", sideControls);
  const contentWidth = Math.max(1, box.width
    - (parseFloat(style.paddingLeft) || 0)
    - (parseFloat(style.paddingRight) || 0));
  const contentHeight = Math.max(1, box.height
    - (parseFloat(style.paddingTop) || 0)
    - (parseFloat(style.paddingBottom) || 0));
  const controlsBox = controlCluster.getBoundingClientRect();
  const gap = parseFloat(sideControls ? style.columnGap : style.rowGap) || 0;
  const available = core.mirrorStageSpace(contentWidth, contentHeight, {
    width: controlsBox.width,
    height: controlsBox.height,
    gap
  }, sideControls);
  const fitted = core.mirrorFit(
    state.width,
    state.height,
    available.width,
    available.height
  );
  viewport.style.width = `${fitted.width}px`;
  viewport.style.height = `${fitted.height}px`;
}

function scheduleMirrorLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(fitMirrorToStage);
}

async function jsonRequest(path, body, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-N1-Token": token
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("N1 响应超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function outputFrame(frame) {
  state.frameCount += 1;
  if (pendingFrame) pendingFrame.close();
  pendingFrame = frame;
  if (drawFrame) return;
  drawFrame = requestAnimationFrame(() => {
    drawFrame = 0;
    const latest = pendingFrame;
    pendingFrame = null;
    if (!latest) return;
    if (canvas.width !== latest.displayWidth || canvas.height !== latest.displayHeight) {
      canvas.width = latest.displayWidth;
      canvas.height = latest.displayHeight;
    }
    if (!state.context) state.context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    state.context.drawImage(latest, 0, 0, canvas.width, canvas.height);
    latest.close();
    viewport.classList.add("streaming");
    const elapsed = performance.now() - state.startedAt;
    $("latency").textContent =
      `${state.frameCount} 帧 · ${formatLatency(elapsed / state.frameCount)}/帧`;
  });
}

function updateRenderedFrame(width, height) {
  state.frameCount += 1;
  viewport.classList.add("streaming");
  const elapsed = performance.now() - state.startedAt;
  $("latency").textContent =
    `${state.frameCount} 帧 · ${formatLatency(elapsed / state.frameCount)}/帧`;
}

function decoderError(error) {
  failStream(error instanceof Error ? error : new Error(String(error)));
}

async function configureDecoder(codec) {
  if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") return false;
  const config = {
    codec,
    codedWidth: state.width,
    codedHeight: state.height,
    hardwareAcceleration: "prefer-hardware",
    optimizeForLatency: true
  };
  if (VideoDecoder.isConfigSupported) {
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support.supported) throw new Error(`手机不支持 ${codec} 硬件解码`);
  }
  const decoder = new VideoDecoder({ output: outputFrame, error: decoderError });
  decoder.configure(config);
  state.decoder = decoder;
  state.decoderMode = "webcodecs";
  state.context = canvas.getContext("2d", { alpha: false, desynchronized: true });
  return true;
}

function nextTimestamp() {
  const now = Math.max(state.lastTimestamp + 1, Math.round(performance.now() * 1000));
  state.lastTimestamp = now;
  return now;
}

function feedPacket(packet, pendingConfig) {
  if (state.decoderMode === "tinyh264") {
    state.tinySession.feed(packet.data);
    return { pendingConfig: null };
  }
  if (packet.config) return { pendingConfig: packet.data.slice() };
  if (!state.decoder) return { pendingConfig };
  if (!packet.key && !pendingConfig) return { pendingConfig };

  let bytes = packet.data.slice();
  if (pendingConfig) {
    bytes = new Uint8Array(pendingConfig.length + bytes.length);
    bytes.set(pendingConfig, 0);
    bytes.set(packet.data, pendingConfig.length);
  }
  state.decoder.decode(new EncodedVideoChunk({
    type: packet.key ? "key" : "delta",
    timestamp: nextTimestamp(),
    data: bytes
  }));
  return { pendingConfig: null };
}

async function prepareDecoder(codec) {
  if (window.isSecureContext) {
    try {
      if (await configureDecoder(codec)) return "硬件解码";
    } catch (error) {
      console.warn("WebCodecs unavailable, falling back to TinyH264", error);
      stopDecoder();
    }
  }

  const module = await import("/tinyh264/client.js");
  state.tinySession = await module.createTinyH264Session(canvas, {
    onFrame: updateRenderedFrame,
    onError: decoderError
  });
  state.decoderMode = "tinyh264";
  return state.tinySession.rendererMode === "webgl"
    ? "WebAssembly · WebGL"
    : "WebAssembly · Canvas";
}

async function consumeVideo(response) {
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let config = null;
  state.startedAt = performance.now();

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (!chunk.value || !chunk.value.length) continue;
    const merged = new Uint8Array(buffer.length + chunk.value.length);
    merged.set(buffer);
    merged.set(chunk.value, buffer.length);
    buffer = merged;

    let offset = 0;
    while (buffer.length - offset >= 12) {
      const header = core.readScrcpyHeader(buffer.subarray(offset, offset + 12));
      if (header.length > 16 * 1024 * 1024) throw new Error("视频包大小异常");
      const end = offset + 12 + header.length;
      if (buffer.length < end) break;
      const packet = {
        ...header,
        data: buffer.slice(offset + 12, end)
      };
      const next = feedPacket(packet, config);
      config = next.pendingConfig;
      state.packetCount += 1;
      offset = end;
    }
    if (offset) buffer = buffer.slice(offset);
  }
}

async function startMirror() {
  if (!token) {
    $("authGate").hidden = false;
    return;
  }
  stopStream(false);
  showPlaceholder("正在启动硬件镜像", "首次连接需要数秒准备视频编码器");
  setStatus("working", "正在连接");
  $("retry").hidden = true;
  state.streamError = "";
  state.abort = new AbortController();
  state.packetCount = 0;
  state.frameCount = 0;
  state.lastTimestamp = 0;
  try {
    const started = await jsonRequest("/api/mirror/start", {});
    updateMirrorMetrics(Number(started.width) || 1920, Number(started.height) || 1080);
    canvas.width = Math.min(1920, state.width);
    canvas.height = Math.round(canvas.width * state.height / state.width);
    $("latency").textContent = "等待首帧";
    showPlaceholder("正在接收 H.264 视频流", `${started.server || "scrcpy"} · 解码器初始化`);

    const response = await fetch("/api/mirror/video", {
      headers: { "X-N1-Token": token },
      signal: state.abort.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      let message = `视频流请求失败（HTTP ${response.status}）`;
      try {
        const failure = await response.json();
        if (failure.error) message = failure.error;
      } catch (_) {}
      throw new Error(message);
    }
    const codec = response.headers.get("X-N1-Codec") || "avc1.42E01E";
    updateMirrorMetrics(
      Number(response.headers.get("X-N1-Width")) || state.width,
      Number(response.headers.get("X-N1-Height")) || state.height
    );
    const decoderLabel = await prepareDecoder(codec);
    showPlaceholder("正在接收 H.264 视频流", decoderLabel);
    setStatus("online", decoderLabel.startsWith("WebAssembly") ? "兼容解码" : "硬件解码");
    await consumeVideo(response);
    if ((state.decoder || state.tinySession) && !state.streamError) {
      throw new Error("视频流已结束，请重新连接");
    }
  } catch (error) {
    if (error.name !== "AbortError") failStream(error);
  }
}

function failStream(error) {
  if (state.streamError) return;
  state.streamError = error.message || "实时镜像中断";
  setStatus("offline", "连接中断");
  showPlaceholder("实时镜像暂不可用", state.streamError, true);
  stopDecoder();
}

function stopDecoder() {
  if (pendingFrame) pendingFrame.close();
  pendingFrame = null;
  if (drawFrame) cancelAnimationFrame(drawFrame);
  drawFrame = 0;
  if (state.decoder && state.decoder.state !== "closed") {
    try { state.decoder.close(); } catch (_) {}
  }
  state.decoder = null;
  if (state.tinySession) {
    try { state.tinySession.close(); } catch (_) {}
  }
  state.tinySession = null;
  state.context = null;
  state.decoderMode = "";
}

function stopStream(notifyServer = true) {
  if (state.abort) state.abort.abort();
  state.abort = null;
  stopDecoder();
  viewport.classList.remove("streaming");
  if (notifyServer && token) {
    fetch("/api/mirror/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-N1-Token": token },
      body: "{}",
      keepalive: true
    }).catch(() => {});
  }
}

function enqueueInput(command) {
  if (!token || state.streamError) return;
  if (command.action === "move") {
    const existing = inputQueue.findIndex(item => item.action === "move");
    if (existing >= 0) inputQueue.splice(existing, 1);
  }
  inputQueue.push(command);
  if (!state.inputBusy) pumpInput();
}

function queueMove(point) {
  gesture.point = point;
  pendingMove = point;
  if (moveFrame) return;
  moveFrame = requestAnimationFrame(() => {
    moveFrame = 0;
    if (!pendingMove || !gesture) return;
    const next = pendingMove;
    pendingMove = null;
    enqueueInput({ action: "move", x: next.x, y: next.y });
  });
}

function flushMove() {
  if (moveFrame) cancelAnimationFrame(moveFrame);
  moveFrame = 0;
  if (pendingMove) {
    const next = pendingMove;
    pendingMove = null;
    enqueueInput({ action: "move", x: next.x, y: next.y });
  }
}

async function pumpInput() {
  state.inputBusy = true;
  while (inputQueue.length) {
    const command = inputQueue.shift();
    try {
      await jsonRequest("/api/mirror/touch", command, 4_000);
    } catch (error) {
      if (error.status === 401) {
        $("authGate").hidden = false;
        break;
      }
      if (command.action === "down") failStream(error);
    }
  }
  state.inputBusy = false;
}

function pointFromEvent(event) {
  return core.mirrorPoint(event.clientX, event.clientY, viewport.getBoundingClientRect());
}

function rippleAt(event) {
  const box = viewport.getBoundingClientRect();
  const ripple = $("ripple");
  ripple.style.left = `${event.clientX - box.left}px`;
  ripple.style.top = `${event.clientY - box.top}px`;
  ripple.classList.remove("active");
  void ripple.offsetWidth;
  ripple.classList.add("active");
}

viewport.addEventListener("pointerdown", event => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!viewport.classList.contains("streaming")) return;
  try { viewport.setPointerCapture(event.pointerId); } catch (_) {}
  const point = pointFromEvent(event);
  gesture = { pointerId: event.pointerId, point };
  enqueueInput({ action: "down", x: point.x, y: point.y });
  rippleAt(event);
  navigator.vibrate?.(7);
  event.preventDefault();
}, { passive: false });

viewport.addEventListener("pointermove", event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const samples = event.getCoalescedEvents?.() || [event];
  const sample = samples[samples.length - 1] || event;
  queueMove(pointFromEvent(sample));
  event.preventDefault();
}, { passive: false });

function finishPointer(event, action) {
  if (!gesture || event.pointerId !== gesture.pointerId) return;
  const point = action === "cancel" ? gesture.point : pointFromEvent(event);
  flushMove();
  gesture = null;
  enqueueInput({ action, x: point.x, y: point.y });
  event.preventDefault();
}

viewport.addEventListener("pointerup", event => finishPointer(event, "up"), { passive: false });
viewport.addEventListener("pointercancel", event => finishPointer(event, "cancel"), { passive: false });
viewport.addEventListener("lostpointercapture", event => finishPointer(event, "cancel"), { passive: false });
viewport.addEventListener("contextmenu", event => event.preventDefault());

async function sendKey(code, longPress = false) {
  if (!token) return;
  try {
    await jsonRequest("/api/key", { code, long: Boolean(longPress) }, 5_000);
    navigator.vibrate?.(longPress ? 18 : 7);
  } catch (error) {
    if (error.status === 401) $("authGate").hidden = false;
    else failStream(error);
  }
}

function bindKey(button, code) {
  let timer = null;
  let longSent = false;
  button.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try { button.setPointerCapture(event.pointerId); } catch (_) {}
    button.classList.add("pressed");
    longSent = false;
    timer = setTimeout(() => {
      longSent = true;
      sendKey(code, true);
    }, 600);
    event.preventDefault();
  });
  button.addEventListener("pointerup", event => {
    clearTimeout(timer);
    button.classList.remove("pressed");
    if (!longSent) sendKey(code, false);
    event.preventDefault();
  }, { passive: false });
  button.addEventListener("pointercancel", () => {
    clearTimeout(timer);
    button.classList.remove("pressed");
  });
}

bindKey($("backKey"), 4);
bindKey($("homeKey"), 3);
bindKey($("menuKey"), 82);
bindKey($("upKey"), 19);
bindKey($("downKey"), 20);
bindKey($("leftKey"), 21);
bindKey($("rightKey"), 22);
bindKey($("centerKey"), 23);

function updateFullscreenUi() {
  const active = document.fullscreenElement === mirrorApp;
  $("fullscreen").setAttribute("aria-pressed", String(active));
  $("fullscreen").querySelector("span").textContent = active ? "退出全屏" : "全屏";
  scheduleMirrorLayout();
}

async function requestLandscape() {
  try {
    await screen.orientation?.lock?.("landscape");
  } catch (_) {}
}

async function enterFullscreen() {
  try {
    await mirrorApp.requestFullscreen({ navigationUI: "hide" });
  } catch (_) {
    await mirrorApp.requestFullscreen();
  }
}

async function releaseLandscape() {
  try {
    screen.orientation?.unlock?.();
  } catch (_) {}
}

$("fullscreen").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      releaseLandscape();
    } else {
      await enterFullscreen();
      await requestLandscape();
    }
  } catch (_) {
    scheduleMirrorLayout();
  }
});
$("retry").addEventListener("click", startMirror);
$("reconnect").addEventListener("click", startMirror);
$("exitMirror").addEventListener("click", () => {
  stopStream();
  location.href = "/";
});

addEventListener("pagehide", () => stopStream());
addEventListener("blur", () => {
  if (gesture) {
    const point = gesture.point;
    flushMove();
    gesture = null;
    enqueueInput({ action: "cancel", x: point.x, y: point.y });
  }
});
addEventListener("resize", scheduleMirrorLayout);
addEventListener("orientationchange", scheduleMirrorLayout);
addEventListener("fullscreenchange", updateFullscreenUi);
visualViewport?.addEventListener("resize", scheduleMirrorLayout);
if (typeof ResizeObserver === "function") {
  const observer = new ResizeObserver(scheduleMirrorLayout);
  observer.observe(stage);
  observer.observe(mirrorApp);
}
addEventListener("online", () => {
  if (state.streamError) startMirror();
});
scheduleMirrorLayout();

if (!token) {
  $("authGate").hidden = false;
  setStatus("offline", "未连接");
} else {
  startMirror();
}
