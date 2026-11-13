"use strict";

let worker;
let workerPromise;
let nextStateId = 1;
const sessions = new Map();

function ensureWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = new Promise((resolve, reject) => {
    worker = new Worker("/tinyh264/worker.js", { type: "module" });
    worker.addEventListener("message", ({ data }) => {
      if (data.type === "decoderReady") {
        resolve();
        return;
      }
      if (data.type !== "pictureReady") return;
      const session = sessions.get(data.renderStateId);
      if (!session) return;
      try {
        session.receive(data);
      } catch (error) {
        session.fail(error);
      }
    });
    worker.addEventListener("error", event => {
      const error = new Error(event.message || "WebAssembly H.264 解码器异常");
      reject(error);
      for (const session of sessions.values()) session.fail(error);
      sessions.clear();
      worker = null;
      workerPromise = null;
    });
  });
  return workerPromise;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader 编译失败");
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_uv = vec2((a_position.x + 1.0) * 0.5, (1.0 - a_position.y) * 0.5);
    }
  `));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_y;
    uniform sampler2D u_u;
    uniform sampler2D u_v;
    void main() {
      float y = max(0.0, texture2D(u_y, v_uv).r - 0.0625) * 1.164;
      float u = texture2D(u_u, v_uv).r - 0.5;
      float v = texture2D(u_v, v_uv).r - 0.5;
      vec3 rgb = vec3(
        y + 1.596 * v,
        y - 0.391 * u - 0.813 * v,
        y + 2.018 * u
      );
      gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
    }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL shader 链接失败");
  }
  return program;
}

class YuvRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = "";
    this.width = 0;
    this.height = 0;
    this.yTexture = null;
    this.uTexture = null;
    this.vTexture = null;
    this.context2d = null;
    this.imageData = null;

    const options = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      desynchronized: true,
      preserveDrawingBuffer: false
    };
    const gl = canvas.getContext("webgl2", options) || canvas.getContext("webgl", options);
    if (gl) {
      this.mode = "webgl";
      this.gl = gl;
      this.program = createProgram(gl);
      this.yTexture = gl.createTexture();
      this.uTexture = gl.createTexture();
      this.vTexture = gl.createTexture();
      for (const texture of [this.yTexture, this.uTexture, this.vTexture]) {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      this.position = gl.getAttribLocation(this.program, "a_position");
      this.uY = gl.getUniformLocation(this.program, "u_y");
      this.uU = gl.getUniformLocation(this.program, "u_u");
      this.uV = gl.getUniformLocation(this.program, "u_v");
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 1, -1, -1, 1, 1, 1
      ]), gl.STATIC_DRAW);
    } else {
      this.mode = "canvas";
      this.context2d = canvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!this.context2d) throw new Error("手机不支持 WebGL 或 Canvas 渲染");
    }
  }

  render(width, height, buffer) {
    if (width <= 0 || height <= 0) return;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.width = width;
      this.height = height;
    }
    const data = new Uint8Array(buffer);
    if (this.mode === "webgl") this.#renderWebGl(width, height, data);
    else this.#renderCanvas(width, height, data);
  }

  #renderWebGl(width, height, data) {
    const gl = this.gl;
    const chromaWidth = Math.ceil(width / 2);
    const chromaHeight = Math.ceil(height / 2);
    const ySize = width * height;
    const chromaSize = chromaWidth * chromaHeight;
    if (data.length < ySize + chromaSize * 2) return;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.yTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE, data.subarray(0, ySize));
    gl.bindTexture(gl.TEXTURE_2D, this.uTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, chromaWidth, chromaHeight, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE, data.subarray(ySize, ySize + chromaSize));
    gl.bindTexture(gl.TEXTURE_2D, this.vTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, chromaWidth, chromaHeight, 0,
      gl.LUMINANCE, gl.UNSIGNED_BYTE,
      data.subarray(ySize + chromaSize, ySize + chromaSize * 2));

    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.enableVertexAttribArray(this.position);
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.yTexture);
    gl.uniform1i(this.uY, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.uTexture);
    gl.uniform1i(this.uU, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.vTexture);
    gl.uniform1i(this.uV, 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  #renderCanvas(width, height, data) {
    const chromaWidth = Math.ceil(width / 2);
    const chromaHeight = Math.ceil(height / 2);
    const ySize = width * height;
    const chromaSize = chromaWidth * chromaHeight;
    if (data.length < ySize + chromaSize * 2) return;
    if (!this.imageData || this.imageData.width !== width || this.imageData.height !== height) {
      this.imageData = this.context2d.createImageData(width, height);
    }
    const output = this.imageData.data;
    for (let y = 0; y < height; y++) {
      const chromaRow = Math.floor(y / 2) * chromaWidth;
      for (let x = 0; x < width; x++) {
        const chroma = chromaRow + Math.floor(x / 2);
        const luma = Math.max(0, data[y * width + x] - 16) * 1.164;
        const u = data[ySize + chroma] - 128;
        const v = data[ySize + chromaSize + chroma] - 128;
        const offset = (y * width + x) * 4;
        output[offset] = Math.max(0, Math.min(255, luma + 1.596 * v));
        output[offset + 1] = Math.max(0, Math.min(255, luma - 0.391 * u - 0.813 * v));
        output[offset + 2] = Math.max(0, Math.min(255, luma + 2.018 * u));
        output[offset + 3] = 255;
      }
    }
    this.context2d.putImageData(this.imageData, 0, 0);
  }

  dispose() {
    this.imageData = null;
    this.context2d = null;
    this.gl = null;
  }
}

class TinyH264Session {
  constructor(canvas, stateId, handlers) {
    this.stateId = stateId;
    this.handlers = handlers;
    this.renderer = new YuvRenderer(canvas);
    this.closed = false;
  }

  receive(message) {
    if (this.closed) return;
    const width = Number(message.width);
    const height = Number(message.height);
    this.renderer.render(width, height, message.data);
    this.handlers.onFrame?.(width, height);
  }

  feed(data) {
    if (this.closed || !data?.byteLength) return;
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    worker.postMessage({
      type: "decode",
      data: buffer,
      offset: 0,
      length: buffer.byteLength,
      renderStateId: this.stateId
    }, [buffer]);
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this.stateId);
    this.handlers.onError?.(error);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    sessions.delete(this.stateId);
    this.renderer.dispose();
    worker?.postMessage({ type: "release", renderStateId: this.stateId });
  }

  get rendererMode() {
    return this.renderer.mode;
  }
}

export async function createTinyH264Session(canvas, handlers = {}) {
  await ensureWorker();
  const stateId = nextStateId++;
  const session = new TinyH264Session(canvas, stateId, handlers);
  sessions.set(stateId, session);
  return session;
}
