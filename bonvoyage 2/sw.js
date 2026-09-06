// Service worker : l'app s'ouvre même sans réseau (les données, elles, viennent de Supabase).
const CACHE = "bonvoyage-v2";
const SHELL = ["./", "./index.html", "./share.html", "./css/style.css", "./js/config.js", "./js/common.js", "./js/offline.js", "./js/theme.js", "./js/api.js", "./js/app.js", "./js/share.js", "./vapid.html", "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-192.png", "./icons/valdo.svg", "./icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// ---- Notifications ----
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { title: "Bonvoyage", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Bonvoyage", {
    body: d.body || "", icon: "./icons/icon-192.png", "./icons/valdo.svg", "./icons/apple-touch-icon.png", badge: "./icons/icon-192.png", "./icons/valdo.svg", "./icons/apple-touch-icon.png", data: { url: d.url || "./" }, tag: "carnet-" + (d.url || ""),
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
    const net = fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; });
    const slow = new Promise((res) => setTimeout(() => res(null), 4000));
    e.respondWith(Promise.race([net.catch(() => null), slow]).then((r) => r || caches.match(e.request).then((hit) => hit || net)));
    return;
  }
  // Bibliothèques, polices, tuiles de carte : cache d'abord
  if (/unpkg\.com|jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|opentopomap\.org/.test(url.host)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
  }
});
