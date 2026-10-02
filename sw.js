// Service worker ParaSpot : hors-ligne + notifications push.
// Incrémenter VERSION à chaque modification de l'interface pour forcer la mise à jour sur le téléphone.
const VERSION = "paraspot-v3";
const SHELL = ["./", "index.html", "styles.css", "app.js", "scoring.js", "basemap.js", "config.js", "data/spots.json", "manifest.webmanifest", "vendor/leaflet.js", "vendor/leaflet.css",
  "icons/icon-192.png", "icons/icon.svg", "icons/badge-96.png", "icons/apple-touch-icon.png"];
const CDN = ["fonts.googleapis.com", "fonts.gstatic.com"];
// Tuiles des fonds « Détail » et « Relief » : mises en cache au fil de la navigation (limitées)
const TILES = ["tile.openstreetmap.fr", "tile.opentopomap.org"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Prévisions : réseau d'abord, cache en secours
  if (url.hostname.endsWith("open-meteo.com")) {
    e.respondWith(fetch(e.request).then((r) => put(e.request, r)).catch(() => caches.match(e.request)));
    return;
  }
  if (TILES.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(caches.open(VERSION + "-tiles").then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }))));
    return;
  }
  // App, police, Leaflet : cache d'abord, mise à jour en arrière-plan (tuiles de carte non mises en cache)
  if (url.origin === location.origin || CDN.includes(url.hostname)) {
    e.respondWith(caches.match(e.request, { ignoreSearch: url.origin === location.origin && (url.pathname.endsWith("/") || url.pathname.endsWith("index.html")) }).then((cached) => {
      const net = fetch(e.request).then((r) => put(e.request, r)).catch(() => cached);
      return cached || net;
    }));
  }
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: "ParaSpot", body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "ParaSpot", {
    body: d.body, tag: d.tag || "fv", renotify: true,
    icon: "icons/icon-192.png", badge: "icons/badge-96.png",
    data: { url: d.url || "./" },
    actions: [{ action: "open", title: "Voir le créneau" }]
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) { c.navigate(target); return c.focus(); }
    return clients.openWindow(target);
  }));
});
