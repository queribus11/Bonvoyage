// ============================================================
//  Hors-ligne : copie locale du voyage + file d'attente d'envoi
//  - le dernier état de chaque voyage est gardé dans localStorage
//  - les traces/balises modifiées hors ligne sont marquées _pending
//  - les photos prises hors ligne attendent dans IndexedDB
// ============================================================
(function () {
  const LS = {
    get(k, def = null) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { } },
  };

  // ---------- Copie locale des voyages ----------
  const tripKey = (id) => "cv_trip_" + id;
  function cacheTrip(cur) {
    if (!cur || !cur.trip) return;
    // On ne garde pas les objets volumineux inutiles ; les traces (points) sont nécessaires
    LS.set(tripKey(cur.trip.id), { savedAt: Date.now(), trip: cur.trip, days: cur.days, tracks: cur.tracks, media: cur.media, comments: cur.comments });
  }
  function getCachedTrip(id) { return LS.get(tripKey(id)); }
  function cacheTrips(list) { LS.set("cv_trips", { savedAt: Date.now(), list }); }
  function getCachedTrips() { return LS.get("cv_trips"); }
  function isLocalId(id) { return typeof id === "string" && id.startsWith("local-"); }
  function localId() { return "local-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // Fusionne les traces en attente (cache) dans des données fraîches du serveur
  function mergePending(fresh, cached) {
    if (!cached) return fresh;
    for (const t of cached.tracks || []) {
      if (!t._pending) continue;
      const i = fresh.tracks.findIndex((x) => x.id === t.id);
      if (i >= 0) { if ((t.points || []).length >= (fresh.tracks[i].points || []).length) fresh.tracks[i] = t; }
      else fresh.tracks.push(t);
    }
    return fresh;
  }

  // ---------- Photos en attente (IndexedDB) ----------
  const DB_NAME = "carnet-voyage", STORE = "pending_media";
  function idb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("IndexedDB indisponible"));
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function tx(mode, fn) {
    return idb().then((db) => new Promise((res, rej) => {
      const t = db.transaction(STORE, mode); const st = t.objectStore(STORE);
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error);
    }));
  }
  async function addPendingMedia(item) { item.id = item.id || localId(); item.createdAt = Date.now(); await tx("readwrite", (st) => st.put(item)); return item; }
  async function listPendingMedia(tripId) {
    const all = await tx("readonly", (st) => st.getAll());
    return (all || []).filter((x) => !tripId || x.tripId === tripId).sort((a, b) => a.createdAt - b.createdAt);
  }
  async function removePendingMedia(id) { await tx("readwrite", (st) => st.delete(id)); }

  // ---------- Erreurs lisibles ----------
  function isNetworkError(err) {
    const m = String(err && err.message || err || "").toLowerCase();
    return !navigator.onLine || /fetch|network|load failed|timeout|connexion|réseau/.test(m);
  }
  const FRIENDLY = [
    [/invalid login credentials/i, "Email ou mot de passe incorrect"],
    [/email not confirmed/i, "Confirme d'abord ton email (regarde ta boîte de réception)"],
    [/user already registered/i, "Un compte existe déjà avec cet email : connecte-toi"],
    [/password should be at least/i, "Mot de passe trop court (6 caractères minimum)"],
    [/failed to fetch|load failed|networkerror|network request failed/i, "Pas de connexion internet pour le moment"],
    [/payload too large|exceeded the maximum allowed size|maximum size/i, "Fichier trop lourd pour l'hébergement"],
    [/row-level security|permission denied/i, "Accès refusé : la base n'est pas correctement configurée (relance le script SQL)"],
    [/jwt|token.*expired|session/i, "Session expirée : reconnecte-toi"],
    [/rate limit/i, "Trop de tentatives, réessaie dans une minute"],
    [/signups? not allowed|signup is disabled/i, "Les inscriptions sont fermées"],
  ];
  function friendly(err) {
    const m = String(err && err.message || err || "Erreur inconnue");
    for (const [re, txt] of FRIENDLY) if (re.test(m)) return txt;
    return m.length > 120 ? m.slice(0, 117) + "…" : m;
  }

  window.OFF = { LS, cacheTrip, getCachedTrip, cacheTrips, getCachedTrips, isLocalId, localId, mergePending,
    addPendingMedia, listPendingMedia, removePendingMedia, isNetworkError, friendly };
})();
