// ============================================================
//  Fonctions partagées : traces, GPX, statistiques, lieux, dates, images, audio
// ============================================================
(function () {
  const cfg = window.CARNET_CONFIG || {};

  // ---------- Dates ----------
  const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
  const JOURS = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

  function isoDate(d) {
    const x = d instanceof Date ? d : new Date(d);
    const p = (n) => String(n).padStart(2, "0");
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  }
  function today() { return isoDate(new Date()); }
  function fmtDate(iso, withDay = true) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `${withDay ? JOURS[dt.getDay()] + " " : ""}${d} ${MOIS[m - 1]} ${y}`;
  }
  function fmtDateShort(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${MOIS[m - 1].slice(0, 4)}${MOIS[m - 1].length > 4 ? "." : ""}`;
  }
  function fmtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  function fmtDistance(m) {
    if (!m) return "0 km";
    return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace(".", ",") + " km" : Math.round(m) + " m";
  }
  function dayNumber(trip, iso) {
    if (!trip.start_date || !iso) return null;
    const a = new Date(trip.start_date), b = new Date(iso);
    return Math.round((b - a) / 86400000) + 1;
  }

  // ---------- Géométrie ----------
  function haversine(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function trackDistance(points) {
    let d = 0;
    for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
    return Math.round(d);
  }

  // ---------- GPX ----------
  function parseGPX(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("Fichier GPX illisible");
    const name = (doc.querySelector("trk > name, metadata > name, rte > name") || {}).textContent || "";
    let pts = [...doc.querySelectorAll("trkpt")];
    if (!pts.length) pts = [...doc.querySelectorAll("rtept")];
    if (!pts.length) pts = [...doc.querySelectorAll("wpt")];
    const points = pts.map((p) => {
      const ele = p.querySelector("ele"), time = p.querySelector("time");
      const o = { lat: parseFloat(p.getAttribute("lat")), lng: parseFloat(p.getAttribute("lon")) };
      if (ele) o.alt = Math.round(parseFloat(ele.textContent));
      if (time) o.t = new Date(time.textContent).getTime();
      return o;
    }).filter((p) => isFinite(p.lat) && isFinite(p.lng));
    if (!points.length) throw new Error("Aucun point trouvé dans ce fichier GPX");
    return { name: name.trim(), points };
  }
  function toGPX(trip, tracks) {
    const esc = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
    let out = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Bonvoyage" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(trip.title)}</name></metadata>\n`;
    for (const tr of tracks) {
      out += `<trk><name>${esc(tr.name || tr.day_date)}</name><trkseg>\n`;
      for (const p of tr.points) {
        out += `<trkpt lat="${p.lat}" lon="${p.lng}">${p.alt != null ? `<ele>${p.alt}</ele>` : ""}${p.t ? `<time>${new Date(p.t).toISOString()}</time>` : ""}</trkpt>\n`;
      }
      out += `</trkseg></trk>\n`;
    }
    return out + "</gpx>\n";
  }

  // ---------- Carte : moteur dans js/map.js (BVMAP) ; on garde ici les couleurs par journée et les statistiques ----------
  const DAY_COLORS = (window.BVMAP && BVMAP.DAY_COLORS) || ["#F97316", "#0D8FE0", "#7CB518", "#F5B301", "#3AA0F5", "#9ACD1E", "#E05A8A", "#8B5CF6"];
  function colorForDay(dayList, iso) {
    const i = dayList.indexOf(iso);
    return DAY_COLORS[(i < 0 ? 0 : i) % DAY_COLORS.length];
  }

  // Statistiques d'une journée (ou d'un voyage) à partir de ses traces :
  // distance, durée, dénivelé + / -, altitude min / max, profil d'altitude (échantillonné)
  function dayStats(tracks) {
    const trs = (tracks || []).filter((t) => (t.points || []).length);
    const out = { distance_m: trs.reduce((a, t) => a + (t.distance_m || 0), 0), gain: 0, loss: 0, minAlt: null, maxAlt: null, duration_s: 0, profile: [], hasAlt: false, moving: false };
    if (!trs.length) return out;
    const sorted = trs.slice().sort((a, b) => ((a.points[0] || {}).t || 0) - ((b.points[0] || {}).t || 0));
    let cum = 0, prev = null, tStart = null, tEnd = null;
    const samples = [];
    for (const t of sorted) {
      for (const p of t.points) {
        if (!p || p.lat == null) continue;
        if (prev) cum += haversine(prev, p);
        prev = p;
        if (p.t) { if (tStart == null || p.t < tStart) tStart = p.t; if (tEnd == null || p.t > tEnd) tEnd = p.t; }
        if (p.alt != null && isFinite(p.alt)) samples.push({ d: cum, alt: +p.alt });
      }
      prev = null; // pas de distance entre deux traces différentes
    }
    if (tStart != null && tEnd != null) out.duration_s = Math.round((tEnd - tStart) / 1000);
    if (samples.length >= 2) {
      out.hasAlt = true;
      // Lissage (moyenne glissante sur 5 points) puis seuil de 4 m pour ignorer le bruit du GPS
      const sm = samples.map((s, i) => { const w = samples.slice(Math.max(0, i - 2), i + 3); return { d: s.d, alt: w.reduce((a, x) => a + x.alt, 0) / w.length }; });
      let ref = sm[0].alt;
      for (const s of sm) {
        const diff = s.alt - ref;
        if (diff >= 4) { out.gain += diff; ref = s.alt; } else if (diff <= -4) { out.loss += -diff; ref = s.alt; }
      }
      out.gain = Math.round(out.gain); out.loss = Math.round(out.loss);
      out.minAlt = Math.round(Math.min(...sm.map((s) => s.alt))); out.maxAlt = Math.round(Math.max(...sm.map((s) => s.alt)));
      // Profil : 80 points max
      const step = Math.max(1, Math.floor(sm.length / 80));
      out.profile = sm.filter((_, i) => i % step === 0 || i === sm.length - 1);
    }
    return out;
  }
  function fmtDuration(s) { if (!s) return ""; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; }
  // Petit profil d'altitude en SVG (couleur de la journée)
  function profileSvg(profile, color = "#F97316", w = 320, h = 64) {
    if (!profile || profile.length < 2) return "";
    const dmax = profile[profile.length - 1].d || 1, amin = Math.min(...profile.map((p) => p.alt)), amax = Math.max(...profile.map((p) => p.alt)), span = Math.max(20, amax - amin);
    const x = (p) => (p.d / dmax * (w - 2) + 1).toFixed(1), y = (p) => (h - 4 - (p.alt - amin) / span * (h - 12)).toFixed(1);
    const pts = profile.map((p) => `${x(p)},${y(p)}`).join(" ");
    return `<svg class="alt-profile" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="Profil d'altitude de ${Math.round(amin)} à ${Math.round(amax)} m">
      <path d="M1,${h} L${pts.replace(/ /g, " L")} L${w - 1},${h} Z" fill="${color}" fill-opacity=".18"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  // Nom du lieu (commune, région, pays) d'après une position — Nominatim / OpenStreetMap, avec cache local
  const GEO_CACHE_KEY = "bv_places";
  async function placeName(lat, lng) {
    if (lat == null || lng == null) return "";
    const key = lat.toFixed(2) + "," + lng.toFixed(2);
    let cache = {}; try { cache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || "{}"); } catch { }
    if (cache[key] != null) return cache[key];
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&accept-language=fr`, { headers: { "Accept": "application/json" } });
      if (!r.ok) return "";
      const j = await r.json(), a = j.address || {};
      const town = a.city || a.town || a.village || a.municipality || a.hamlet || a.county || "";
      const region = a.state || a.region || a.province || "";
      const country = a.country || "";
      const name = [town, country && country !== "France" ? country : region].filter(Boolean).join(", ");
      cache[key] = name; try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch { }
      return name;
    } catch { return ""; }
  }
  // Itinéraire par la route entre des points (OSRM, serveur de démonstration public : gratuit, parfois lent, 100 points max)
  async function roadRoute(points) {
    const pts = points.filter((p) => p && p.lat != null).slice(0, 100);
    if (pts.length < 2) return null;
    const coords = pts.map((p) => `${(+p.lng).toFixed(5)},${(+p.lat).toFixed(5)}`).join(";");
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
    if (!r.ok) throw new Error("Service d'itinéraire indisponible (" + r.status + ")");
    const j = await r.json();
    if (j.code !== "Ok" || !j.routes || !j.routes[0]) throw new Error("Itinéraire introuvable");
    const t0 = pts[0].t || Date.parse(pts[0].taken_at || "") || Date.now();
    return j.routes[0].geometry.coordinates.map(([lng, lat], i) => ({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), t: t0 + i * 1000 }));
  }

  // Itinéraire estimé d'une journée, tronçon par tronçon selon le moyen de locomotion :
  // voiture / bus / vélo → par la route (OSRM) ; avion → arc ; le reste → ligne droite. Renvoie une liste de points.
  async function buildRoute(media, iso) {
    const legs = window.BVMAP ? BVMAP.estimatedLegs(media, iso) : null;
    if (!legs) return null;
    const pts = [];
    const push = (lng, lat, t) => { const last = pts[pts.length - 1]; if (last && last.lng === lng && last.lat === lat) return; pts.push({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), t }); };
    let t = Date.parse(legs[0].from.taken_at || legs[0].from.created_at || "") || Date.now();
    for (const l of legs) {
      const mode = l.mode && BVMAP.MODES[l.mode] ? BVMAP.MODES[l.mode] : null;
      let coords = l.coords;
      if (mode && mode.path === "road") {
        try { const r = await roadRoute([{ lat: l.from.lat, lng: l.from.lng }, { lat: l.to.lat, lng: l.to.lng }]); if (r && r.length >= 2) coords = r.map((p) => [p.lng, p.lat]); } catch { /* ligne droite en secours */ }
      }
      for (const c of coords) { t += 1000; push(c[0], c[1], t); }
    }
    return pts.length >= 2 ? pts : null;
  }

  // Complète le nom du lieu des journées qui n'en ont pas (une requête par seconde, en douceur)
  async function fillPlaces(cur, save) {
    const dayList = [...new Set([...cur.days.map((d) => d.day_date), ...cur.tracks.map((t) => t.day_date), ...cur.media.map((m) => m.day_date)].filter(Boolean))].sort();
    for (const iso of dayList) {
      const d = cur.days.find((x) => x.day_date === iso);
      if (!d || d.place) continue;
      const tr = cur.tracks.find((t) => t.day_date === iso && (t.points || []).length), m = cur.media.find((x) => x.day_date === iso && x.lat != null);
      const p = tr ? tr.points[Math.floor(tr.points.length / 2)] : (m ? { lat: m.lat, lng: m.lng } : null);
      if (!p) continue;
      const name = await placeName(p.lat, p.lng);
      if (name) { d.place = name; try { await save(d, name); } catch { } }
      await new Promise((r) => setTimeout(r, 1100));
    }
  }

  // ---------- Images ----------
  function loadImage(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Image illisible")); };
      img.src = url;
    });
  }
  async function resizeImage(file, maxSize, quality = 0.85) {
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { bitmap = await loadImage(file); }
    const w = bitmap.width, h = bitmap.height;
    const scale = Math.min(1, maxSize / Math.max(w, h));
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, cw, ch);
    return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  }

  // Lecture EXIF minimale (GPS + date) dans un JPEG, sans bibliothèque
  async function readExif(file) {
    const out = {};
    try {
      const buf = await file.slice(0, 256 * 1024).arrayBuffer();
      const dv = new DataView(buf);
      if (dv.getUint16(0) !== 0xffd8) return out;
      let off = 2;
      while (off < dv.byteLength - 4) {
        const marker = dv.getUint16(off); const len = dv.getUint16(off + 2);
        if (marker === 0xffe1 && dv.getUint32(off + 4) === 0x45786966) { parseTiff(dv, off + 10, out); break; }
        if ((marker & 0xff00) !== 0xff00) break;
        off += 2 + len;
      }
    } catch { /* ignore */ }
    return out;
  }
  function parseTiff(dv, start, out) {
    const le = dv.getUint16(start) === 0x4949;
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    const ifd0 = start + u32(start + 4);
    const readIfd = (ptr, handler) => {
      const n = u16(ptr);
      for (let i = 0; i < n; i++) {
        const e = ptr + 2 + i * 12;
        handler(u16(e), u16(e + 2), u32(e + 4), e + 8);
      }
    };
    const rational = (o) => u32(o) / u32(o + 4);
    const ascii = (o, count) => { let s = ""; const p = count > 4 ? start + u32(o) : o; for (let i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(p + i)); return s; };
    const dms = (o) => { const p = start + u32(o); return rational(p) + rational(p + 8) / 60 + rational(p + 16) / 3600; };
    let exifPtr = null, gpsPtr = null;
    readIfd(ifd0, (tag, type, count, vo) => {
      if (tag === 0x8769) exifPtr = start + u32(vo);
      if (tag === 0x8825) gpsPtr = start + u32(vo);
      if (tag === 0x0132) out.dateTime = ascii(vo, count);
    });
    if (exifPtr) readIfd(exifPtr, (tag, type, count, vo) => {
      if (tag === 0x9003) out.dateTime = ascii(vo, count);
    });
    if (gpsPtr) {
      let latRef = "N", lngRef = "E", lat, lng, alt;
      readIfd(gpsPtr, (tag, type, count, vo) => {
        if (tag === 1) latRef = ascii(vo, count);
        if (tag === 2) lat = dms(vo);
        if (tag === 3) lngRef = ascii(vo, count);
        if (tag === 4) lng = dms(vo);
        if (tag === 6) alt = rational(start + u32(vo));
      });
      if (isFinite(lat) && isFinite(lng)) {
        out.lat = latRef === "S" ? -lat : lat;
        out.lng = lngRef === "W" ? -lng : lng;
        if (isFinite(alt)) out.alt = Math.round(alt);
      }
    }
    if (out.dateTime) {
      const m = out.dateTime.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (m) out.takenAt = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
  }

  // ---------- Audio : enregistreur avec bouton Arrêter, lecteur ----------
  function audioMime() {
    if (!window.MediaRecorder) return null;
    for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"]) if (MediaRecorder.isTypeSupported(m)) return m;
    return "";
  }
  function audioExt(mime) { return mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"; }
  function audioHtml(url, small = false) {
    return url ? `<audio controls preload="none" src="${esc(url)}" class="${small ? "audio-sm" : "audio"}"></audio>` : "";
  }
  // Insère un enregistreur dans `container`. Renvoie { getBlob(), reset() }.
  // existingUrl : audio déjà enregistré (affiche le lecteur + bouton Remplacer / Supprimer).
  function audioRecorder(container, { existingUrl = null, label = "Enregistrer un message vocal", maxSeconds = 300, onChange } = {}) {
    const state = { blob: null, url: existingUrl, removed: false, rec: null, stream: null, timer: null, t0: 0 };
    const render = () => {
      const supported = audioMime() !== null;
      if (!supported) { container.innerHTML = `<p class="small muted">L'enregistrement audio n'est pas disponible dans ce navigateur.</p>`; return; }
      if (state.rec) {
        container.innerHTML = `<div class="rec-box on"><span class="pulse"></span> Enregistrement… <b id="rec-time">0:00</b>
          <button type="button" class="btn sm danger" id="rec-stop">${ic("stop")} Arrêter</button></div>`;
        container.querySelector("#rec-stop").onclick = stop;
        return;
      }
      if (state.url) {
        container.innerHTML = `<div class="rec-box">${bigAudio(state.url, "Écouter", true)}<div class="row">
          <button type="button" class="btn sm" id="rec-again">${ic("mic")} Refaire</button><button type="button" class="btn sm ghost danger" id="rec-del">${ic("trash")} Supprimer</button></div></div>`;
        bindBigAudio(container);
        container.querySelector("#rec-again").onclick = start;
        container.querySelector("#rec-del").onclick = () => { state.blob = null; state.url = null; state.removed = true; render(); onChange && onChange(); };
        return;
      }
      container.innerHTML = `<button type="button" class="btn" id="rec-start">${ic("mic")} ${esc(label)}</button>`;
      container.querySelector("#rec-start").onclick = start;
    };
    async function start() {
      try { state.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { toast("Micro refusé ou indisponible", "error"); return; }
      const mime = audioMime();
      const chunks = [];
      state.rec = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined);
      state.rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      state.rec.onstop = () => {
        state.stream.getTracks().forEach((t) => t.stop());
        state.blob = new Blob(chunks, { type: state.rec.mimeType || mime || "audio/webm" });
        state.url = URL.createObjectURL(state.blob); state.removed = false; state.rec = null;
        clearInterval(state.timer); render(); onChange && onChange();
      };
      state.rec.start(250); state.t0 = Date.now();
      state.timer = setInterval(() => {
        const s = Math.floor((Date.now() - state.t0) / 1000);
        const el = container.querySelector("#rec-time"); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        if (s >= maxSeconds) stop();
      }, 500);
      render();
    }
    function stop() { if (state.rec && state.rec.state !== "inactive") state.rec.stop(); }
    render();
    return { getBlob: () => state.blob, isRemoved: () => state.removed, stop, reset: () => { state.blob = null; state.url = null; render(); } };
  }

  // ---------- Divers ----------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function nl2p(s) {
    return String(s || "").split(/\n{2,}/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }
  // Icône du sprite SVG : ic("pin") → <svg class="i"><use href="#i-pin"/></svg>
  function ic(name, cls = "") { return `<svg class="i${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }

  // Toasts : en bas, deux au maximum (le plus ancien s'efface), durée selon le type
  function toast(msg, kind = "info", ms) {
    let host = document.getElementById("toasts");
    if (!host) { host = document.createElement("div"); host.id = "toasts"; document.body.appendChild(host); }
    if (ms == null) ms = kind === "error" ? 4000 : 2500;
    const live = [...host.querySelectorAll(".toast:not(.out)")];
    if (live.length >= 2) dismiss(live[0]);
    const t = document.createElement("div");
    t.className = "toast " + kind; t.textContent = msg;
    host.appendChild(t);
    t._timer = setTimeout(() => dismiss(t), ms);
    function dismiss(el) { clearTimeout(el._timer); el.classList.add("out"); setTimeout(() => el.remove(), 200); }
  }

  // Lecteur audio "gros bouton" : ▶ Écouter … (durée) + barre de progression ; un seul audio joue à la fois
  let currentAudio = null;
  function bigAudio(url, label, small = false) {
    return `<div class="big-audio${small ? " sm" : ""}" data-src="${esc(url)}" data-label="${esc(label)}"><button type="button" class="btn ${small ? "sm" : ""}">${ic("play")}<span class="lbl">${esc(label)}</span><span class="dur"></span></button><div class="bar"><i></i></div></div>`;
  }
  function bindBigAudio(root) {
    root.querySelectorAll(".big-audio").forEach((box) => {
      if (box._bound) return; box._bound = true;
      const btn = box.querySelector("button"), dur = box.querySelector(".dur"), bar = box.querySelector(".bar i");
      const a = new Audio(); a.preload = "metadata"; a.src = box.dataset.src;
      const fmt = (t) => isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "";
      const setIcon = (playing) => { btn.querySelector("svg use").setAttribute("href", playing ? "#i-pause" : "#i-play"); };
      a.onloadedmetadata = () => { dur.textContent = fmt(a.duration); };
      a.ontimeupdate = () => { if (a.duration) { bar.style.width = (a.currentTime / a.duration * 100) + "%"; if (!a.paused) dur.textContent = `${fmt(a.currentTime)} / ${fmt(a.duration)}`; } };
      a.onended = () => { setIcon(false); bar.style.width = "0%"; dur.textContent = fmt(a.duration); };
      a.onpause = () => setIcon(false);
      btn.onclick = () => {
        if (a.paused) { if (currentAudio && currentAudio !== a) currentAudio.pause(); currentAudio = a; a.play().then(() => setIcon(true)).catch(() => toast("Lecture impossible", "error")); }
        else a.pause();
      };
    });
  }
  function download(name, text, type = "application/octet-stream") {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  window.CV = { cfg, isoDate, today, fmtDate, fmtDateShort, fmtTime, fmtDistance, dayNumber, haversine, trackDistance,
    parseGPX, toGPX, colorForDay, DAY_COLORS, dayStats, fmtDuration, profileSvg, placeName, fillPlaces, roadRoute, buildRoute, resizeImage, readExif, esc, nl2p, toast, download,
    audioRecorder, audioHtml, audioExt, audioMime, ic, bigAudio, bindBigAudio };
})();
