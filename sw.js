// Service worker : l'app s'ouvre même sans réseau (les données, elles, viennent de Supabase).
const CACHE = "bonvoyage-v10-24";
const TILES = "bonvoyage-tuiles-v1"; // fonds de carte (satellite, plan, relief, altitude) : cache à part, taillé à 4 000 tuiles
const SHELL = ["./", "./index.html", "./share.html", "./css/style.css", "./js/config.js", "./js/pictos.js", "./js/map.js", "./js/common.js", "./js/offline.js", "./js/theme.js", "./js/api.js", "./js/members.js", "./js/app.js", "./js/share.js", "./vapid.html", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/valdo.svg", "./icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { // Précache tolérant : un fichier manquant (config.js retiré d'un envoi, fichier renommé) ne bloque plus l'installation ni les mises à jour
e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" }))))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== TILES).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// ---- Notifications ----
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "Bonvoyage", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Bonvoyage", {
    body: d.body || "", icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", data: { url: d.url || "./" }, tag: "carnet-" + (d.url || ""),
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./", self.location.href).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if (c.url.split("#")[0] === url.split("#")[0] && "focus" in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Fichiers de l'app : réseau d'abord (pour recevoir les mises à jour), cache en secours
  if (url.origin === location.origin) {
    // Réseau d'abord, mais pas plus de 4 s : sur réseau lent, le cache prend le relais
    // cache: "no-cache" = on revalide toujours auprès de GitHub (sinon les navigateurs gardent les fichiers 10 min)
    const net = fetch(e.request, { cache: "no-cache" }).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; });
    const slow = new Promise((res) => setTimeout(() => res(null), 4000));
    e.respondWith(Promise.race([net.catch(() => null), slow]).then((r) => r || caches.match(e.request).then((hit) => hit || net.catch(() => Response.error()))));
    return;
  }
  // Tuiles de carte (satellite Esri, OpenStreetMap, OpenTopoMap, altitude AWS) : cache d'abord, dans un cache dédié et borné
  if (/arcgisonline\.com|tile\.openstreetmap\.org|opentopomap\.org|elevation-tiles-prod|nominatim/.test(url.host)) {
    if (/nominatim/.test(url.host)) return; // les noms de lieux ne se mettent pas en cache ici (cache local dans l'app)
    e.respondWith(caches.open(TILES).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") { c.put(e.request, r.clone()); trimTiles(c); } return r; }))));
    return;
  }
  // Bibliothèques et polices : cache d'abord
  if (/unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
  }
});
let trimming = false;
async function trimTiles(c) {
  if (trimming) return; trimming = true;
  try { const keys = await c.keys(); if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 3500)) await c.delete(k); } catch { }
  trimming = false;
}
