const http = require("http");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "../app/src/main/assets/web");
const apps = [
  { package: "com.github.avbox.osc", label: "AVBox", icon: "/icon.png", system: false },
  { package: "com.example.piliplus", label: "PiliPlus", icon: "/icon.png", system: false },
  { package: "com.oriontv", label: "OrionTV", icon: "/icon.png", system: false },
  { package: "com.android.tv.settings", label: "设置", icon: "/icon.png", system: true }
];

function json(res, value, code = 200) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(value));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8099");
  if (url.pathname === "/api/login" || url.pathname === "/api/ping") return json(res, { ok: true });
  if (url.pathname === "/api/status") return json(res, {
    ok: true,
    ip: "192.0.2.10",
    port: 8088,
    adb: true,
    ime: "com.gathin.n1remote/.N1RemoteIme",
    screenWidth: 1920,
    screenHeight: 1080
  });
  if (url.pathname === "/api/apps") return json(res, { ok: true, apps });
  if (url.pathname === "/api/screenshot") return json(res, { ok: false, error: "Mock screenshot unavailable" });
  if (url.pathname.startsWith("/api/")) return json(res, { ok: true, mode: "ime" });

  const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = path.join(root, name);
  if (!file.startsWith(root) || !fs.existsSync(file)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const type = name.endsWith(".html") ? "text/html; charset=utf-8" :
    name.endsWith(".js") ? "application/javascript; charset=utf-8" :
    name.endsWith(".css") ? "text/css; charset=utf-8" :
    name.endsWith(".webmanifest") ? "application/manifest+json; charset=utf-8" :
    name.endsWith(".woff2") ? "font/woff2" :
    name.endsWith(".txt") ? "text/plain; charset=utf-8" : "image/png";
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(file).pipe(res);
});

server.listen(8099, "127.0.0.1", () => console.log("N1 Remote mock: http://127.0.0.1:8099"));
