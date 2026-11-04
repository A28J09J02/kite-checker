// Kite-Checker – Service Worker: App startet auch ohne Netz.
// Eigene Dateien: erst Netz (immer aktuell), bei Funkloch aus dem Cache.
// Wetterdaten laufen nicht hierüber – die liegen im localStorage-Cache der App.
const CACHE = "kc-shell-v1";
const SHELL = ["./", "index.html", "logic.js", "manifest.webmanifest", "alarm.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("kc-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Wetter-APIs, Karte, Schriften: normal übers Netz
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req.mode === "navigate" ? "index.html" : url.pathname.endsWith("alarm.json") ? "alarm.json" : req, res.clone());
      return res;
    } catch (err) {
      const hit = req.mode === "navigate"
        ? await cache.match("index.html")
        : await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
