// ============================================================
//  Fonctions partagées : carte, traces, GPX, dates, images
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

  // ---------- Carte ----------
  // Fonds de carte gratuits, sans clé d'accès
  const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const TILES = {
    osm:      { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: OSM_ATTR, max: 19, subdomains: "" },
    voyager:  { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: OSM_ATTR, max: 19, subdomains: "" },   // ancien nom, même carte
    positron: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: OSM_ATTR, max: 19, subdomains: "" },
    outdoors: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr: OSM_ATTR + ', SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a>', max: 17, subdomains: "abc" },
    dark:     { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: OSM_ATTR, max: 19, subdomains: "", className: "tiles-dark" },
  };
  const DAY_COLORS = ["#F97316", "#0D8FE0", "#7CB518", "#F5B301", "#123F66", "#3AA0F5", "#9ACD1E", "#5E6142", "#E05A8A", "#8B5CF6"];

  function createMap(el, opts = {}) {
    const map = L.map(el, { zoomControl: false, attributionControl: true, ...opts });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    let tiles = null;
    const setTiles = () => {
      const dark = window.THEME && THEME.isDark() && cfg.MAP_STYLE !== "outdoors";
      const style = dark ? TILES.dark : (TILES[cfg.MAP_STYLE] || TILES.voyager);
      if (tiles) map.removeLayer(tiles);
      tiles = L.tileLayer(style.url, { attribution: style.attr, maxZoom: style.max, subdomains: style.subdomains || "abc", className: style.className || "" }).addTo(map);
      if (tiles.bringToBack) tiles.bringToBack();
    };
    setTiles();
    document.addEventListener("themechange", setTiles);
    map.setView([46.6, 2.5], 5);
    return map;
  }

  function colorForDay(dayList, iso) {
    const i = dayList.indexOf(iso);
    return DAY_COLORS[(i < 0 ? 0 : i) % DAY_COLORS.length];
  }

  // Dessine traces + photos. Renvoie { layer, bounds, markers:{mediaId:marker} }
  function drawTrip(map, data, options = {}) {
    const { tracks = [], media = [] } = data;
    const dayList = options.dayList || [...new Set([...tracks.map((t) => t.day_date), ...media.map((m) => m.day_date)].filter(Boolean))].sort();
    const layer = L.featureGroup();
    const markers = {};
    const filter = options.dayFilter;

    for (const tr of tracks) {
      if (filter && tr.day_date !== filter) continue;
      const latlngs = (tr.points || []).map((p) => [p.lat, p.lng]);
      if (latlngs.length < 2) {
        if (latlngs.length === 1) L.circleMarker(latlngs[0], { radius: 5, color: colorForDay(dayList, tr.day_date), fillOpacity: 0.9 }).addTo(layer);
        continue;
      }
      const color = colorForDay(dayList, tr.day_date);
      L.polyline(latlngs, { color: "#fff", weight: 7, opacity: 0.8, lineJoin: "round" }).addTo(layer);
      const line = L.polyline(latlngs, { color, weight: 4, opacity: 0.95, lineJoin: "round" }).addTo(layer);
      line.bindTooltip(`${tr.name || "Trace"}${tr.day_date ? " · " + fmtDate(tr.day_date, false) : ""} · ${fmtDistance(tr.distance_m)}`, { sticky: true });
      if (options.onTrackClick) line.on("click", () => options.onTrackClick(tr));
    }

    for (const m of media) {
      if (filter && m.day_date !== filter) continue;
      if (m.lat == null || m.lng == null) continue;
      const url = options.thumbUrl ? options.thumbUrl(m) : "";
      const icon = L.divIcon({
        className: "photo-pin",
        html: `<div class="photo-pin-inner${m.kind === "video" ? " is-video" : ""}"${url ? ` style="background-image:url('${url}')"` : ""}></div>`,
        iconSize: [44, 44], iconAnchor: [22, 44], popupAnchor: [0, -40],
      });
      const mk = L.marker([m.lat, m.lng], { icon, riseOnHover: true }).addTo(layer);
      if (options.onMediaClick) mk.on("click", () => options.onMediaClick(m));
      markers[m.id] = mk;
    }

    layer.addTo(map);
    const bounds = layer.getBounds();
    return { layer, bounds, markers, dayList };
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
    parseGPX, toGPX, createMap, drawTrip, colorForDay, DAY_COLORS, resizeImage, readExif, esc, nl2p, toast, download,
    audioRecorder, audioHtml, audioExt, audioMime, ic, bigAudio, bindBigAudio };
})();
