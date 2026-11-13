const CACHE = "n1remote-v13-2026-11-13";
const FILES = ["/", "/styles.css", "/client-core.js", "/app.js", "/mirror.html", "/mirror.css",
  "/mirror.js", "/icon.png", "/manifest.webmanifest", "/lxgw-wenkai-screen-subset.woff2",
  "/tinyh264/client.js", "/tinyh264/worker.js", "/tinyh264/TinyH264.js",
  "/tinyh264/TinyH264Decoder.js"];
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE)
    .then(cache => cache.addAll(FILES))
    .then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then(hit => {
      const network = fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
