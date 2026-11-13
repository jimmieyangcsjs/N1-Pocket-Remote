(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.N1RemoteCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeSearch(value) {
    return String(value || "").trim().toLocaleLowerCase("zh-CN");
  }

  function filterApps(apps, query) {
    const needle = normalizeSearch(query);
    if (!needle) return apps.slice();
    return apps.filter(app =>
      normalizeSearch(app.label).includes(needle) ||
      normalizeSearch(app.package).includes(needle)
    );
  }

  function countText(value) {
    return Array.from(String(value || "")).length;
  }

  function createSerialQueue(send, onError = () => {}, limit = 96) {
    const pending = [];
    const idleWaiters = [];
    let running = false;

    function finishIfIdle() {
      if (running || pending.length) return;
      for (const resolve of idleWaiters.splice(0)) resolve();
    }

    async function drain() {
      if (running) return;
      running = true;
      while (pending.length) {
        const command = pending.shift();
        try {
          await send(command);
        } catch (error) {
          try {
            onError(error, command);
          } catch (_) {
            // Error reporting must not wedge the input queue.
          }
        }
      }
      running = false;
      finishIfIdle();
    }

    function enqueue(command) {
      if (pending.length >= limit) {
        onError(new Error("操作过于频繁，请稍候"), command);
        return false;
      }
      pending.push(command);
      drain();
      return true;
    }

    function idle() {
      if (!running && !pending.length) return Promise.resolve();
      return new Promise(resolve => idleWaiters.push(resolve));
    }

    return {
      enqueue,
      idle,
      get pending() {
        return pending.length + (running ? 1 : 0);
      }
    };
  }

  function nextRetryDelay(online) {
    return online ? 15_000 : 3_000;
  }

  function mirrorPoint(clientX, clientY, rect) {
    const clamp = value => Math.max(0, Math.min(1, value));
    return {
      x: Number(clamp((clientX - rect.left) / Math.max(1, rect.width)).toFixed(4)),
      y: Number(clamp((clientY - rect.top) / Math.max(1, rect.height)).toFixed(4))
    };
  }

  function mirrorAspect(width, height) {
    const validWidth = Number(width);
    const validHeight = Number(height);
    return validWidth > 0 && validHeight > 0 ? validWidth / validHeight : 16 / 9;
  }

  function mirrorFit(width, height, availableWidth, availableHeight) {
    const ratio = mirrorAspect(width, height);
    const fittedWidth = Math.min(
      Math.max(1, Number(availableWidth) || 1),
      Math.max(1, Number(availableHeight) || 1) * ratio
    );
    return {
      width: Math.max(1, Math.floor(fittedWidth)),
      height: Math.max(1, Math.floor(fittedWidth / ratio))
    };
  }

  function mirrorStageSpace(availableWidth, availableHeight, controls, sideLayout) {
    const width = Math.max(1, Number(availableWidth) || 1);
    const height = Math.max(1, Number(availableHeight) || 1);
    const controlWidth = Math.max(0, Number(controls?.width) || 0);
    const controlHeight = Math.max(0, Number(controls?.height) || 0);
    const gap = Math.max(0, Number(controls?.gap) || 0);
    if (sideLayout) {
      return {
        width: Math.max(1, Math.floor(width - controlWidth - gap)),
        height: Math.floor(height)
      };
    }
    return {
      width: Math.floor(width),
      height: Math.max(1, Math.floor(height - controlHeight - gap))
    };
  }

  function gestureAction(start, end, heldMs) {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance > 0.022) {
      return { name: "swipe", duration: Math.max(140, Math.min(2000, Math.round(heldMs))) };
    }
    return heldMs >= 600 ? "long" : "tap";
  }

  function readScrcpyHeader(bytes) {
    if (!bytes || bytes.byteLength < 12) throw new Error("scrcpy 视频头不完整");
    const view = new DataView(bytes.buffer, bytes.byteOffset, 12);
    const flags = view.getBigUint64(0, false);
    const configMask = 1n << 62n;
    const keyMask = 1n << 61n;
    return {
      flags: flags.toString(),
      config: (flags & configMask) !== 0n,
      key: (flags & keyMask) !== 0n,
      length: view.getUint32(8, false),
      timestamp: Number(flags & ((1n << 61n) - 1n))
    };
  }

  return {
    countText,
    createSerialQueue,
    filterApps,
    gestureAction,
    mirrorAspect,
    mirrorFit,
    mirrorPoint,
    mirrorStageSpace,
    nextRetryDelay,
    normalizeSearch,
    readScrcpyHeader
  };
});
