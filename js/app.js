// ============================================================
//  Carnet de Voyage — application principale (côté propriétaire)
// ============================================================
(function () {
  const { cfg, esc, nl2p, toast, fmtDate, fmtDateShort, fmtTime, fmtDistance, dayNumber, today, isoDate, ic } = CV;
  const { friendly, isNetworkError } = OFF;
  const errToast = (err, ms) => toast(friendly(err), "error", ms);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const S = {
    user: null, trips: [], cur: null,      // cur = { trip, days, tracks, media, comments }
    map: null, drawn: null, meMarker: null,
    tab: "days", dayFilter: null, placing: null,
    gps: { watchId: null, track: null, points: [], lastSaved: 0, dirty: false, startedAt: null, wakeLock: null, lastFix: 0, watchdog: null, errAt: 0 },
    offline: false, syncing: false, pendingMedia: [],
    members: [], voices: [], stories: [], notes: [],   // v10 : l'équipage et les contributions signées
  };

  // ---------------------------------------------------------------
  //  Navigation entre écrans
  // ---------------------------------------------------------------
  function show(id) {
    $$(".screen").forEach((s) => s.classList.toggle("active", s.id === id));
    window.scrollTo(0, 0);
    if (id === "screen-trip") setTimeout(() => S.map && BVMAP.resize(S.map), 50);
  }

  // ---------------------------------------------------------------
  //  Modales génériques
  // ---------------------------------------------------------------
  // guard() : renvoie true si des modifications non enregistrées existent → on demande confirmation avant de fermer
  function openModal(html, { wide = false, onClose, guard } = {}) {
    const host = $("#modal-host");
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal${wide ? " wide" : ""}">${html}</div>`;
    host.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); };
    const tryClose = async () => {
      if (guard && guard() && !(await confirm("Tu as des modifications non enregistrées. Fermer quand même ?", "Fermer sans enregistrer"))) return;
      close();
    };
    back.addEventListener("click", (e) => { if (e.target === back) tryClose(); });
    back.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", tryClose));
    const onKey = (e) => { if (e.key === "Escape" && host.lastElementChild === back) tryClose(); };
    document.addEventListener("keydown", onKey);
    return { el: back.firstElementChild, close };
  }
  function confirm(msg, okLabel = "Supprimer") {
    return new Promise((res) => {
      const m = openModal(`<h2>Confirmer</h2><p>${esc(msg)}</p>
        <div class="actions"><button class="btn" data-close>Annuler</button><button class="btn danger" id="ok">${esc(okLabel)}</button></div>`,
        { onClose: () => res(false) });
      $("#ok", m.el).onclick = () => { res(true); m.close(); };
    });
  }
  function busy(el, on) { el.disabled = on; el.dataset.txt ??= el.textContent; el.textContent = on ? "…" : el.dataset.txt; }

  // ---------------------------------------------------------------
  //  Authentification
  // ---------------------------------------------------------------
  let authMode = "login";
  $$(".tabs button", $("#auth-card")).forEach((b) => b.onclick = () => {
    authMode = b.dataset.mode;
    $$(".tabs button", $("#auth-card")).forEach((x) => x.classList.toggle("active", x === b));
    $("#auth-submit").textContent = authMode === "login" ? "Se connecter" : "Créer mon compte";
    $("#auth-password").autocomplete = authMode === "login" ? "current-password" : "new-password";
  });
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("#auth-submit"); busy(btn, true);
    try {
      const email = $("#auth-email").value.trim(), password = $("#auth-password").value;
      if (authMode === "login") await API.signIn(email, password);
      else {
        const r = await API.signUp(email, password);
        if (r && r.user && !r.session) toast("Compte créé ! Vérifie ta boîte mail pour confirmer, puis connecte-toi.", "ok", 6000);
      }
    } catch (err) { errToast(err); }
    busy(btn, false);
  };
  $("#auth-forgot").onclick = async (e) => {
    e.preventDefault();
    const email = $("#auth-email").value.trim();
    if (!email) return toast("Indique ton email d'abord", "error");
    try { await API.resetPassword(email); toast("Email de réinitialisation envoyé", "ok"); } catch (err) { errToast(err); }
  };
  if (cfg.ALLOW_SIGNUP === false) $('.tabs button[data-mode="signup"]', $("#auth-card")).hidden = true;
  $("#btn-logout").onclick = async () => { await API.signOut(); };

  // ---------------------------------------------------------------
  //  Liste des voyages
  // ---------------------------------------------------------------
  async function loadTrips() {
    try {
      S.trips = await API.listTrips();
      const all = await API.listAllComments();
      // v10 : chacun a son propre repère « déjà vu » (trip_members), pas celui du propriétaire
      const mine = await API.listMyMemberships().catch(() => []);
      for (const t of S.trips) {
        const mem = mine.find((m) => m.trip_id === t.id);
        const seen = Date.parse((mem && mem.comments_seen_at) || t.comments_seen_at || 0) || 0;
        t._new = all.filter((c) => c.trip_id === t.id && Date.parse(c.created_at) > seen).length;
        t._guest = t.user_id !== S.user.id;
      }
      OFF.cacheTrips(S.trips);
    } catch (e) {
      const c = OFF.getCachedTrips();
      if (c) { S.trips = c.list; toast("Hors ligne : liste des voyages telle qu'à la dernière connexion"); }
      else { errToast(e); S.trips = []; }
    }
    renderTrips();
  }
  function tripDays(t) {
    if (!t.start_date) return 0;
    const p = (x) => { const [y, m, d] = x.split("-").map(Number); return new Date(y, m - 1, d); };
    return Math.round((p(t.end_date || t.start_date) - p(t.start_date)) / 86400000) + 1;
  }
  function renderTrips() {
    const g = $("#trip-grid");
    g.innerHTML = S.trips.length ? S.trips.map((t) => { const n = tripDays(t); return `
      <div class="trip-card" data-id="${t.id}">
        ${t._new ? `<span class="badge-count" title="Nouveaux commentaires">${t._new}</span>` : ""}
        <div class="cover${t.cover_path ? "" : " fallback"}" ${t.cover_path ? `style="background-image:url('${API.publicUrl(t.cover_path)}')"` : ""}>
          ${t.subtitle ? `<div class="sub">${esc(t.subtitle)}</div>` : ""}<h3>${esc(t.title)}</h3></div>
        <div class="meta"><span>${ic("calendar")} ${t.start_date ? fmtDate(t.start_date, false) : "dates à définir"}</span>${n ? `<span>${ic("clock")} ${n} jour${n > 1 ? "s" : ""}</span>` : ""}${t._guest ? `<span>${ic("share")} carnet partagé</span>` : ""}</div>
      </div>`; }).join("")
      : `<div class="empty valdo-empty"><img src="icons/valdo.svg" alt=""><b>Ton premier voyage commence ici</b><span class="small">Appuie sur « Nouveau voyage » pour créer le carnet.</span></div>`;
    $$(".trip-card[data-id]", g).forEach((c) => c.onclick = () => openTrip(c.dataset.id));
  }
  $("#new-trip").onclick = () => tripForm();

  function tripForm(trip) {
    const isNew = !trip;
    const m = openModal(`<h2>${isNew ? "Nouveau voyage" : "Réglages du voyage"}</h2>
      <form id="f">
        <div class="field"><label>Titre</label><input name="title" required value="${esc(trip?.title || "")}" placeholder="Road-trip en Écosse"></div>
        <div class="field"><label>Sous-titre</label><input name="subtitle" value="${esc(trip?.subtitle || "")}" placeholder="Trois semaines de lochs et de moutons"></div>
        <div class="row"><div class="field grow"><label>Début</label><input type="date" name="start_date" value="${trip?.start_date || (isNew ? today() : "")}"></div>
        <div class="field grow"><label>Fin</label><input type="date" name="end_date" value="${trip?.end_date || ""}"></div></div>
        ${!isNew ? `<div class="field"><label>Ce que voient tes proches</label><select name="publish_mode">
          <option value="manual" ${trip.publish_mode !== "live" ? "selected" : ""}>Une journée n'apparaît que lorsque je la publie (brouillon avant)</option>
          <option value="live" ${trip.publish_mode === "live" ? "selected" : ""}>Tout apparaît en direct, « Publier » sert seulement à prévenir</option></select></div>
        <div class="field"><label>Vitesse du survol (pour toi et tes proches)</label><select name="replay_speed">
          ${BVMAP.SPEEDS.map((s) => `<option value="${s.k}" ${(+trip.replay_speed || 1) === s.k ? "selected" : ""}>${s.icon} ${s.label}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label>Introduction (affichée en haut du récit)</label><textarea name="description" placeholder="Pourquoi ce voyage, avec qui, l'état d'esprit du départ…">${esc(trip?.description || "")}</textarea></div>
        ${!isNew ? `<div class="field"><label>Photo de couverture</label><select name="cover_path"><option value="">— aucune —</option>
          ${(S.cur?.media || []).filter((x) => x.kind === "photo").map((x) => `<option value="${esc(x.path)}" ${x.path === trip.cover_path ? "selected" : ""}>${esc(x.caption || fmtDate(x.day_date, false) || "photo")}</option>`).join("")}</select></div>` : ""}
        ${!isNew ? `<div class="field"><label>Qui a accès</label>
          <button type="button" class="btn sm" id="access">${ic("share", "sm")} Co-auteurs et liens des proches</button>
          <span class="small muted">Inviter quelqu'un à écrire dans ce carnet, et gérer les liens envoyés aux proches.</span></div>` : ""}
        ${!isNew ? `<div class="field"><label>Sauvegarde</label><div class="row"><button type="button" class="btn sm" id="backup">${ic("download", "sm")} Sauvegarde complète</button><button type="button" class="btn sm ghost" id="backup-light">Texte et traces seulement</button></div>
          <span class="small muted">Télécharge un fichier .zip avec ton récit, tes traces (GPX), tes photos, audios et les commentaires. À faire de temps en temps, et à la fin du voyage.</span></div>` : ""}
        <div class="actions">
          ${!isNew ? `<button type="button" class="btn ghost danger sm" id="del">${ic("trash", "sm")} Supprimer le voyage</button><span class="grow"></span>` : ""}
          <button type="button" class="btn ghost" data-close>Annuler</button>
          <button class="btn primary" type="submit">${isNew ? "Créer le voyage" : "Enregistrer"}</button>
        </div></form>`);
    $("#f", m.el).onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      for (const k of ["start_date", "end_date", "cover_path"]) if (fd[k] === "") fd[k] = null;
      if (fd.replay_speed != null) fd.replay_speed = +fd.replay_speed;
      try {
        if (isNew) { const t = await API.createTrip(S.user, fd); m.close(); await loadTrips(); openTrip(t.id); }
        else { S.cur.trip = await API.updateTrip(trip.id, fd); m.close(); renderTripHeader(); renderPanel(); }
      } catch (err) { errToast(err); }
    };
    const acc = $("#access", m.el); if (acc) acc.onclick = () => { m.close(); openAccess(); };
    const bk = $("#backup", m.el); if (bk) bk.onclick = () => backup(true, bk);
    const bkl = $("#backup-light", m.el); if (bkl) bkl.onclick = () => backup(false, bkl);
    const del = $("#del", m.el);
    if (del) del.onclick = async () => {
      if (!(await confirm("Supprimer définitivement ce voyage, ses traces, ses photos et son récit ?"))) return;
      try { await API.deleteTrip(trip.id); OFF.LS.del("cv_trip_" + trip.id); m.close(); backToTrips(); } catch (err) { errToast(err); }
    };
  }

  // ---------------------------------------------------------------
  //  Écran voyage
  // ---------------------------------------------------------------
  async function openTrip(id) {
    show("screen-trip");
    $("#panel-body").innerHTML = `<div class="spinner"></div>`;
    const cached = OFF.getCachedTrip(id);
    try {
      S.cur = OFF.mergePending(await API.loadTrip(id), cached);
      S.offline = false;
    } catch (e) {
      if (cached) { S.cur = cached; S.offline = true; toast("Hors ligne : voyage tel qu'à la dernière connexion. Balises et photos seront envoyées au retour du réseau.", "info", 6000); }
      else { errToast(e); return backToTrips(); }
    }
    S.dayFilter = null; S.tab = "days";
    S.members = S.cur.members || [];
    S.voices = S.cur.voices || []; S.stories = S.cur.stories || []; S.notes = S.cur.notes || [];
    if (window.MEMBERS) MEMBERS.setCrew(S.members, S.user.id);
    $$(".panel-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === "days"));
    ensureMap();
    renderTripHeader();
    redraw(true);
    updateCommentBadge();
    renderPanel();
    location.hash = "trip=" + id;
    resumeRecordingIfAny();
    S.pendingMedia = await OFF.listPendingMedia(id).catch(() => []);
    if (S.pendingMedia.length && S.tab === "photos") renderPanel();
    OFF.cacheTrip(S.cur);
    // Nom des lieux (commune, pays) des journées, complété en douceur et gardé en base
    if (navigator.onLine && !S.offline) CV.fillPlaces(S.cur, async (d, name) => {
      if (!canEdit(d)) return;                 // v10 : la journée d'un autre ne m'appartient pas
      const u = await API.upsertDay(S.user, S.cur.trip.id, d.day_date, { place: name });
      Object.assign(d, u); if (S.tab === "days") renderPanel();
    }).catch(() => { });
    syncAll();
  }
  function saveLocal() { if (S.cur) OFF.cacheTrip(S.cur); }

  // ---------------------------------------------------------------
  //  Le carnet à plusieurs
  // ---------------------------------------------------------------
  const meMember = () => S.members.find((m) => m.user_id === S.user.id) || null;
  const isTripOwner = () => !!S.cur && S.cur.trip.user_id === S.user.id;
  // « Ce que j'ai moi-même ajouté » — plus tout, si je suis le propriétaire du voyage.
  // Les lignes d'avant la v10 n'ont pas d'auteur : elles appartiennent au propriétaire.
  const canEdit = (row) => isTripOwner() || !row || !row.author_id || row.author_id === S.user.id;
  const pill = (id, o) => (window.MEMBERS ? MEMBERS.pill(id, o) : "");
  const dot = (id, o) => (window.MEMBERS ? MEMBERS.dot(id, o) : "");
  async function reloadMembers() {
    if (!S.cur) return;
    try { S.members = await API.listMembers(S.cur.trip.id); MEMBERS.setCrew(S.members, S.user.id); } catch { }
  }
  function openAccess() {
    MEMBERS.openAccess({
      trip: S.cur.trip, user: S.user, api: API, openModal, confirm, toast,
      shareBase: location.href.split("#")[0].split("?")[0].replace(/index\.html$/, "") + "share.html",
      onChange: async () => { await reloadMembers(); renderTripHeader(); renderPanel(); redraw(); },
    });
  }
  // Le bandeau « du nouveau chez tes co-auteurs » : un repère, pas une notification.
  // Six photos ajoutées par le mari font une ligne ici, et zéro vibration chez les proches.
  function crewNewsHtml() {
    const mem = meMember();
    if (!mem || !window.MEMBERS || !MEMBERS.isShared()) return "";
    const since = Date.parse(mem.activity_seen_at || 0) || 0;
    const news = [...S.cur.media, ...S.cur.days].filter((x) =>
      x.author_id && x.author_id !== S.user.id && Date.parse(x.created_at) > since);
    if (!news.length) return "";
    const who = [...new Set(news.map((x) => MEMBERS.name(x.author_id)).filter(Boolean))];
    const nPh = news.filter((x) => x.kind).length, nJ = news.length - nPh;
    const quoi = [nPh ? `${nPh} photo${nPh > 1 ? "s" : ""}` : "", nJ ? `${nJ} journée${nJ > 1 ? "s" : ""}` : ""].filter(Boolean).join(" et ");
    return `<div class="crew-news"><span class="grow">${esc(who.join(", "))} ${who.length > 1 ? "ont ajouté" : "a ajouté"} ${quoi} depuis ta dernière visite.</span>
      <button class="btn sm ghost" id="crew-seen">Vu</button></div>`;
  }

  // Envoie tout ce qui attend (traces/balises hors ligne, photos) dès que le réseau est là
  async function syncAll(opts = {}) {
    if (!S.cur || !navigator.onLine) return 0;
    // Une synchro déjà en cours (ouverture du voyage, retour du réseau) : on attend qu'elle finisse puis on repart
    while (S.syncing) await new Promise((r) => setTimeout(r, 300));
    if (!S.pendingMedia.length && !S.cur.tracks.some((t) => t._pending)) return 0;
    S.syncing = true;
    // Envoi avec délai maximal (réseau captif, 2G) : au-delà on considère le réseau absent, la photo reste en attente
    const up = (blob, ext, isVideo) => Promise.race([API.uploadFile(S.user, S.cur.trip.id, blob, ext), new Promise((_, rej) => setTimeout(() => rej(new Error("Failed to fetch (délai dépassé)")), isVideo ? 240000 : 90000))]);
    let mediaDone = 0;
    const wasOffline = S.offline;
    let sent = 0;
    try {
      for (const tr of [...S.cur.tracks]) {
        if (!tr._pending) continue;
        if (S.gps.track && S.gps.track.id === tr.id && S.gps.watchId != null && !S.gps.dirty) continue;
        try {
          const fields = { name: tr.name, day_date: tr.day_date, source: tr.source, points: tr.points, distance_m: CV.trackDistance(tr.points) };
          const saved = OFF.isLocalId(tr.id) ? await API.createTrack(S.user, S.cur.trip.id, fields) : await API.updateTrack(tr.id, { points: tr.points, distance_m: fields.distance_m });
          const i = S.cur.tracks.indexOf(tr);
          if (i >= 0) S.cur.tracks[i] = saved;
          if (S.gps.track === tr) { S.gps.track = saved; S.gps.dirty = false; S.gps.lastSaved = Date.now(); persistRecording(); }
          sent++;
        } catch (e) { if (isNetworkError(e)) break; else { console.warn("sync trace", e); tr._pending = false; } }
      }
      const total = S.pendingMedia.length;
      for (const pm of [...S.pendingMedia]) {
        if (opts.label) CV.progress(`${opts.label} ${mediaDone + 1}/${total}…`);
        try {
          const fields = { ...pm.fields };
          if (pm.video) fields.path = await up(pm.video, pm.ext || "mp4", true);
          else { fields.path = await up(pm.big, "jpg"); fields.thumb_path = await up(pm.thumb, "jpg"); }
          if (fields.lat == null) { const g = positionFromTracks(Date.parse(fields.taken_at)); if (g) { fields.lat = g.lat; fields.lng = g.lng; } }
          const m = await API.createMedia(S.user, S.cur.trip.id, fields);
          S.cur.media.push(m); await OFF.removePendingMedia(pm.id); S.pendingMedia = S.pendingMedia.filter((x) => x.id !== pm.id); sent++; mediaDone++;
        } catch (e) { if (isNetworkError(e)) break; else { toast("Photo refusée : " + friendly(e), "error", 6000); await OFF.removePendingMedia(pm.id); S.pendingMedia = S.pendingMedia.filter((x) => x.id !== pm.id); } }
      }
      S.cur.media.sort((a, b) => (a.taken_at || "").localeCompare(b.taken_at || ""));
    } finally { S.syncing = false; }
    saveLocal();
    if (sent) { S.offline = false; if (wasOffline && !opts.label) toast(`${sent} élément${sent > 1 ? "s" : ""} envoyé${sent > 1 ? "s" : ""} au retour du réseau`, "ok"); renderTripHeader(); redraw(); renderPanel(); }
    updatePendingChip();
    return mediaDone;
  }
  function pendingCount() { return (S.cur ? S.cur.tracks.filter((t) => t._pending).length : 0) + S.pendingMedia.length; }
  function updatePendingChip() {
    const n = pendingCount(); const el = $("#pending-chip");
    if (!el) return;
    el.hidden = !n; el.textContent = `⏳ ${n} en attente d'envoi`;
    el.onclick = () => navigator.onLine ? syncAll() : toast("Toujours hors ligne — l'envoi se fera automatiquement", "info");
  }
  function hideDayCard() { const c = $("#day-card"); if (c) c.hidden = true; }
  function backToTrips() {
    hideDayCard();
    if (S.gps.watchId != null) { toast("Arrête d'abord l'enregistrement GPS", "error"); return; }
    S.cur = null; location.hash = ""; show("screen-trips"); loadTrips();
  }
  $("#btn-back").onclick = backToTrips;
  $("#btn-trip-settings").onclick = () => tripForm(S.cur.trip);
  $("#btn-share").onclick = () => shareModal();

  function renderTripHeader() {
    const t = S.cur.trip;
    $("#trip-title").textContent = t.title;
    const km = S.cur.tracks.reduce((a, x) => a + (x.distance_m || 0), 0);
    $("#trip-sub").textContent = [t.start_date ? fmtDate(t.start_date, false) : "", km ? fmtDistance(km) : "", S.cur.media.length ? S.cur.media.length + " photos" : ""].filter(Boolean).join(" · ");
  }

  // ---------- Carte ----------
  function ensureMap() {
    if (S.map) return;
    S.map = BVMAP.create("map", { controlsPos: "bottom-right", switcherClass: "in-app" });
    BVMAP.onClick(S.map, (e) => {
      if (!S.placing) return;
      const m = S.placing; S.placing = null;
      BVMAP.setCursor(S.map, "");
      API.updateMedia(m.id, { lat: e.lat, lng: e.lng }).then((u) => {
        Object.assign(m, u); redraw(); toast("Photo placée sur la carte", "ok"); renderPanel();
      }).catch((err) => errToast(err));
    });
    $("#btn-fit").onclick = () => fit();
    $("#btn-replay").onclick = () => startReplay();
    $("#app-replay-stop").onclick = () => { if (S.map.stopReplay) S.map.stopReplay(); };
    $("#app-replay-pause").onclick = () => { const c = S.map.replayCtl; if (!c) return; c.paused ? c.resume() : c.pause(); };
    $("#app-replay-next").onclick = () => { const c = S.map.replayCtl; if (c) c.next(); };
    $$(".speed-btn").forEach((b) => b.onclick = cycleSpeed);
    $("#btn-locate").onclick = () => locateMe(true);
    $("#btn-beacon").onclick = () => addBeacon();
  }
  function redraw(fitAfter = false) {
    S.drawn = BVMAP.draw(S.map, S.cur, {
      dayFilter: S.dayFilter, dayList: allDays(),
      thumbUrl: (m) => API.publicUrl(m.thumb_path || (m.kind === "photo" ? m.path : "")),
      dayNumber: (iso) => dayNumber(S.cur.trip, iso),
      onMediaClick: (m) => mediaViewer(m),
      onTrackClick: (tr) => trackForm(tr),
      onDayClick: (iso) => { if (navigator.vibrate) navigator.vibrate(8); S.dayFilter = S.dayFilter === iso ? null : iso; redraw(true); renderPanel(); },
    });
    if (fitAfter) fit();
  }
  // Survol du voyage (Valdo sur le parcours), comme sur la page des proches ; `only` = une seule journée
  function startReplay(only = null, opts = {}) {
    if (!S.cur || S.map.replaying) return;
    if (!only) { hideDayCard(); if (S.dayFilter) { S.dayFilter = null; redraw(); renderPanel(); } }
    $("#panel").classList.add("collapsed");
    const ov = $("#app-replay"); ov.hidden = false; ov.classList.toggle("compact", !!opts.silent);
    const pauseBtn = $("#app-replay-pause"); pauseBtn.innerHTML = `${ic("pause", "sm")}`; pauseBtn.title = "Pause";
    $("#app-replay-next").hidden = !!only;
    updateSpeedBtns();
    // Le panneau replié change la hauteur de la carte : on la recale avant de lancer l'animation, sinon Valdo est décalé du tracé
    setTimeout(() => BVMAP.resize(S.map), 300);
    setTimeout(() => BVMAP.replay(S.map, S.cur, {
      dayList: allDays(), only, speed: () => tripSpeed(), dayNumber: (iso) => dayNumber(S.cur.trip, iso),
      onPause: (p) => { pauseBtn.innerHTML = p ? `${ic("play", "sm")}` : `${ic("pause", "sm")}`; pauseBtn.title = p ? "Reprendre" : "Pause"; },
      onDay: (iso, info) => { const d = dayInfo(iso) || {}; $("#app-replay-caption").innerHTML = `<b>${info.n ? "Jour " + info.n : fmtDate(iso, false)}</b>${d.title ? ` · ${esc(d.title)}` : ""}${d.place ? `<span>${esc(d.place)}</span>` : ""}${info.km ? `<span>${fmtDistance(info.km * 1000)}</span>` : ""}`; },
      onDone: () => { $("#app-replay").hidden = true; if (opts.onDone) opts.onDone(); },
    }), 450);
  }
  // Vitesse du survol : un réglage du voyage, choisi par Sophie, appliqué aussi chez les proches
  function tripSpeed() { const v = +(S.cur && S.cur.trip.replay_speed); return BVMAP.SPEEDS.some((s) => s.k === v) ? v : 1; }
  function updateSpeedBtns() { const s = BVMAP.SPEEDS.find((x) => x.k === tripSpeed()); $$(".speed-btn").forEach((b) => { b.textContent = s.icon; b.title = "Vitesse du survol : " + s.label; }); }
  async function cycleSpeed() {
    const i = BVMAP.SPEEDS.findIndex((s) => s.k === tripSpeed()); const n = BVMAP.SPEEDS[(i + 1) % BVMAP.SPEEDS.length];
    S.cur.trip.replay_speed = n.k; updateSpeedBtns();
    try { S.cur.trip = await API.updateTrip(S.cur.trip.id, { replay_speed: n.k }); saveLocal(); toast(`Vitesse du survol : ${n.label} — pour toi et tes proches (à partir de la prochaine journée)`, "info", 3000); }
    catch (err) { errToast(err); }
  }
  // Ouvrir une journée : on la voit d'abord (survol de la journée), puis la carte flottante mène aux photos et au récit
  function openDay(iso) {
    const d = dayInfo(iso), n = dayNumber(S.cur.trip, iso);
    const ph = S.cur.media.filter((x) => x.day_date === iso);
    const hasPath = S.cur.tracks.some((t) => t.day_date === iso && (t.points || []).length >= 2) || ph.filter((x) => x.lat != null).length >= 2;
    if (S.map.replaying && S.map.stopReplay) S.map.stopReplay();
    S.dayFilter = iso; redraw(true); renderPanel();
    const card = $("#day-card");
    card.innerHTML = `<div class="dc-head"><span class="dc-num" style="background:${CV.colorForDay(allDays(), iso)}">${n ? "J" + n : fmtDateShort(iso)}</span><div class="grow" style="min-width:0"><b>${esc(d?.title || fmtDate(iso, false))}</b><span class="small muted">${d?.place ? esc(d.place) + " · " : ""}${ph.length} photo${ph.length > 1 ? "s" : ""}${d?.story ? " · récit" : ""}</span></div><button type="button" class="btn icon ghost sm" id="dc-close" title="Tout le voyage">${ic("close")}</button></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" id="dc-open">${ic("photo", "sm")} Photos & récit</button>${hasPath ? `<button type="button" class="btn sm" id="dc-replay">${ic("play", "sm")} Revoir</button><button type="button" class="btn sm speed-btn" title="Vitesse"></button>` : ""}<span class="grow"></span><button type="button" class="btn sm ghost" id="dc-all">Tout le voyage</button></div>`;
    card.hidden = false;
    $("#dc-open").onclick = () => dayForm(iso);
    const closeCard = () => { card.hidden = true; if (S.map.stopReplay && S.map.replaying) S.map.stopReplay(); S.dayFilter = null; redraw(true); renderPanel(); };
    $("#dc-close").onclick = closeCard; $("#dc-all").onclick = closeCard;
    const rp = $("#dc-replay");
    const dayReplay = () => {
      if (S.map.replaying) { S.map.stopReplay(); return; }
      // Pendant le survol, la carte de journée s'efface pour laisser toute la place au tracé ; il reste « Arrêter » en bas
      card.hidden = true;
      startReplay(iso, { silent: true, onDone: () => { if (S.cur && S.dayFilter === iso) card.hidden = false; } });
    };
    if (rp) { rp.onclick = dayReplay; $$(".speed-btn", card).forEach((b) => b.onclick = cycleSpeed); updateSpeedBtns(); }
    if (hasPath) dayReplay(); else { $("#panel").classList.add("collapsed"); setTimeout(() => BVMAP.resize(S.map), 300); }
  }
  function fit() {
    if (S.drawn && S.drawn.bounds) BVMAP.fitBounds(S.map, S.drawn.bounds, { padding: 48, maxZoom: 15 });
    else { const me = BVMAP.meLngLat(S.map); if (me) BVMAP.easeTo(S.map, me.lat, me.lng, 13); }
  }
  function showMe(lat, lng) { BVMAP.showMe(S.map, lat, lng); }
  function locateMe(center) {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible", "error");
    navigator.geolocation.getCurrentPosition((p) => {
      showMe(p.coords.latitude, p.coords.longitude);
      if (center) BVMAP.easeTo(S.map, p.coords.latitude, p.coords.longitude, Math.max(BVMAP.getZoom(S.map), 14));
    }, (e) => toast(e.code === 1 ? "Localisation refusée : autorise-la dans les réglages du téléphone" : "Position introuvable pour l'instant", "error"), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  // ---------- Panneau ----------
  $$(".panel-tabs button").forEach((b) => b.onclick = () => {
    S.tab = b.dataset.tab;
    $$(".panel-tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $("#panel").classList.remove("collapsed");
    renderPanel(); renderRecBar();
  });
  // Glisser le panneau (mobile)
  (() => {
    const panel = $("#panel"), grip = $("#grip");
    let y0 = null;
    const start = (e) => { y0 = (e.touches ? e.touches[0] : e).clientY; };
    const end = (e) => {
      if (y0 == null) return;
      const y1 = (e.changedTouches ? e.changedTouches[0] : e).clientY;
      const dy = y1 - y0; y0 = null;
      if (dy < -40) { if (panel.classList.contains("collapsed")) panel.classList.remove("collapsed"); else panel.classList.add("expanded"); }
      else if (dy > 40) { if (panel.classList.contains("expanded")) panel.classList.remove("expanded"); else panel.classList.add("collapsed"); }
      else panel.classList.toggle("collapsed");
      setTimeout(() => S.map && BVMAP.resize(S.map), 280);
    };
    grip.addEventListener("touchstart", start, { passive: true }); grip.addEventListener("touchend", end);
    grip.addEventListener("mousedown", start); grip.addEventListener("mouseup", end);
  })();

  function renderPanel() {
    const body = $("#panel-body");
    if (!S.cur) return;
    body.scrollTop = 0;
    ({ days: renderDays, photos: renderPhotos, gps: renderGps, comments: renderComments })[S.tab](body);
  }

  // Liste des dates du voyage : plage start→end + toute date qui a du contenu
  function allDays() {
    const set = new Set();
    const t = S.cur.trip;
    if (t.start_date) {
      const parse = (x) => { const [y, m, d] = x.split("-").map(Number); return new Date(y, m - 1, d); };
      const end = parse(t.end_date || t.start_date);
      for (let d = parse(t.start_date); d <= end && set.size < 120; d.setDate(d.getDate() + 1)) set.add(isoDate(d));
    }
    S.cur.days.forEach((d) => set.add(d.day_date));
    S.cur.tracks.forEach((x) => x.day_date && set.add(x.day_date));
    S.cur.media.forEach((x) => x.day_date && set.add(x.day_date));
    return [...set].sort();
  }
  function dayInfo(iso) { return S.cur.days.find((d) => d.day_date === iso); }

  // ---------- Onglet Journées ----------
  function isLive() { return S.cur.trip.publish_mode === "live"; }
  const seenTs = () => { const m = meMember(); return Date.parse((m && m.comments_seen_at) || S.cur.trip.comments_seen_at || 0) || 0; };
  function newCommentCount() { return S.cur.comments.filter((c) => Date.parse(c.created_at) > seenTs()).length; }
  function updateCommentBadge() {
    const b = $(".panel-tabs button[data-tab=comments]"); const n = newCommentCount();
    b.innerHTML = `Commentaires${n ? `<span class="badge-count">${n}</span>` : ""}`;
  }
  function renderDays(body) {
    const days = allDays();
    const dl = S.drawn ? S.drawn.dayList : days;
    body.innerHTML = `
      ${crewNewsHtml()}
      <div class="row between" style="margin-bottom:12px">
        <span class="kicker">${days.length} journée${days.length > 1 ? "s" : ""}${S.dayFilter ? " · " + fmtDate(S.dayFilter, false) : ""}</span>
        <div class="row">${S.dayFilter ? `<button class="btn sm" id="clear-filter">Tout voir</button>` : ""}<button class="btn sm" id="add-day">${ic("plus")} Journée</button></div>
      </div>
      ${days.length ? "" : `<div class="empty valdo-empty"><img src="icons/valdo.svg" alt="">Ajoute une journée pour commencer ton récit.</div>`}
      <div class="day-list">${days.map((iso) => {
        const d = dayInfo(iso), n = dayNumber(S.cur.trip, iso);
        const km = S.cur.tracks.filter((x) => x.day_date === iso).reduce((a, x) => a + (x.distance_m || 0), 0);
        const ph = S.cur.media.filter((x) => x.day_date === iso);
        const color = CV.colorForDay(dl, iso);
        const st = CV.dayStats(S.cur.tracks.filter((x) => x.day_date === iso));
        const cover = ph.find((x) => x.kind === "photo") || ph[0];
        return `<div class="day-item${S.dayFilter === iso ? " active" : ""}" data-iso="${iso}">
          <div class="num" style="background:${color}" title="Voir cette journée sur la carte"><small>${n ? "Jour" : ""}</small>${n || fmtDateShort(iso)}</div>
          <div class="info"><b>${esc(d?.title || fmtDate(iso))}</b>${pill(d?.author_id, { small: true })}
            <span>${d?.title ? fmtDate(iso, false) : ""}${d?.place ? ` · ${ic("pin", "sm")} ${esc(d.place)}` : ""}</span>
            <span>${km ? `${ic("route", "sm")} ${fmtDistance(km)}` : ""}${st.hasAlt && st.gain ? ` · ↗ ${st.gain} m` : ""}${ph.length ? ` · ${ic("camera", "sm")} ${ph.length}` : ""}${d?.story ? ` · ${ic("edit", "sm")}` : ""}${d?.audio_path ? ` ${ic("mic", "sm")}` : ""}</span>
            ${cover ? `<div class="day-cover" style="background-image:url('${API.publicUrl(cover.thumb_path || cover.path)}')"></div>` : ""}
            ${(km || ph.length || d) ? `<div class="status">${isLive() ? (d?.published ? `<span class="chip pub">Annoncée</span>` : "") : (d?.published ? `<span class="chip pub">Publiée</span>` : `<span class="chip draft">Brouillon</span>`)}</div>` : ""}
            ${ph.length > 1 ? `<div class="thumbs">${ph.slice(1, 6).map((x) => `<img src="${API.publicUrl(x.thumb_path || x.path)}" alt="">`).join("")}</div>` : ""}
          </div></div>`; }).join("")}</div>`;
    $("#add-day").onclick = () => dayForm(null);
    const cs = $("#crew-seen", body);
    if (cs) cs.onclick = async () => { try { await API.markSeen(S.cur.trip.id, "activity_seen_at"); await reloadMembers(); renderPanel(); } catch (e) { errToast(e); } };
    const cf = $("#clear-filter"); if (cf) cf.onclick = () => { S.dayFilter = null; redraw(true); renderPanel(); };
    $$(".day-item", body).forEach((el) => {
      const iso = el.dataset.iso;
      el.onclick = () => openDay(iso);
      $(".num", el).onclick = (e) => { e.stopPropagation(); if (navigator.vibrate) navigator.vibrate(8); S.dayFilter = S.dayFilter === iso ? null : iso; redraw(true); renderPanel(); };
    });
  }

  const draftKey = (iso) => `cv_draft_${S.cur.trip.id}_${iso || "new"}`;
  function dayForm(iso) {
    const d = iso ? dayInfo(iso) : null;
    const draft = OFF.LS.get(draftKey(iso));
    const useDraft = draft && (draft.story !== (d?.story || "") || draft.title !== (d?.title || ""));
    const status = !iso ? "" : isLive()
      ? `<span class="chip pub">En direct</span> <span class="small muted">Tout est déjà visible ; « Envoyer le lien » prévient tes proches.</span>`
      : d?.published ? `<span class="chip pub">Publiée</span> <span class="small muted">Visible par tes proches, modifiable à tout moment.</span>`
      : `<span class="chip draft">Brouillon</span> <span class="small muted">Invisible pour tes proches tant que tu n'as pas publié.</span>`;
    const n0 = iso ? dayNumber(S.cur.trip, iso) : null;
    const st = iso ? CV.dayStats(S.cur.tracks.filter((x) => x.day_date === iso)) : null;
    const dayPhotos = iso ? S.cur.media.filter((x) => x.day_date === iso) : [];
    const routeTrack = iso ? S.cur.tracks.find((t) => t.day_date === iso && t.source === "route") : null;
    const legs = iso ? BVMAP.estimatedLegs(S.cur, iso) : null;
    const dayMode = d?.transport && BVMAP.MODES[d.transport] ? d.transport : "";
    const canRoute = iso && !routeTrack && !S.cur.tracks.some((t) => t.day_date === iso && (t.points || []).length >= 2) && dayPhotos.filter((x) => x.lat != null).length >= 2;
    const dl0 = allDays();
    const statsHtml = st && st.distance_m ? `<div class="day-stats">
        <div><b>${fmtDistance(st.distance_m)}</b><small>distance</small></div>
        ${st.duration_s ? `<div><b>${CV.fmtDuration(st.duration_s)}</b><small>durée</small></div>` : ""}
        ${st.hasAlt ? `<div><b>↗ ${st.gain} m</b><small>montée</small></div><div><b>↘ ${st.loss} m</b><small>descente</small></div><div><b>${st.maxAlt} m</b><small>alt. max</small></div>` : ""}
      </div>${st.hasAlt ? CV.profileSvg(st.profile, CV.colorForDay(dl0, iso)) : ""}` : "";
    // v10 · qui écrit quoi. `mine` = j'ai le droit de toucher à la journée
    // elle-même (je l'ai créée, ou je suis propriétaire du carnet).
    const mine = !d || canEdit(d);
    const myStory   = d ? S.stories.find((x) => x.day_id === d.id && x.author_id === S.user.id) : null;
    const myNote    = d ? S.notes.find((x) => x.day_id === d.id && x.author_id === S.user.id) : null;
    const dayVoices = d ? S.voices.filter((v) => v.day_id === d.id) : [];
    // Le mot du jour n'a de sens qu'à plusieurs : sur un carnet solo, le récit
    // audio suffit et ce bloc n'existe pas.
    const showVoices = !!iso && (MEMBERS.isShared() || dayVoices.length > 0);
    const m = openModal(`<div class="modal-head"><div class="grow">${iso ? `<div class="kicker">${n0 ? "Jour " + n0 + " · " : ""}${fmtDate(iso)} ${pill(d?.author_id, { small: true })}</div>` : ""}<h2>${iso ? esc(d?.title || (n0 ? "Jour " + n0 : fmtDate(iso, false))) : "Nouvelle journée"}</h2></div><button type="button" class="btn icon ghost" data-close title="Fermer">${ic("close")}</button></div>
      ${status ? `<div style="margin:-6px 0 14px">${status}</div>` : ""}
      ${useDraft ? `<div class="setup-help" style="margin-bottom:12px">✍️ Un brouillon non enregistré a été retrouvé et restauré.</div>` : ""}
      ${d?.place ? `<div class="kicker" style="margin:-4px 0 10px">${ic("pin", "sm")} ${esc(d.place)}</div>` : ""}
      <form id="f">
        <div class="row"><div class="field grow"><label>Date</label><input type="date" name="day_date" required value="${iso || today()}" ${iso ? "readonly" : ""}></div>
        <div class="field grow" style="flex:2"><label>Titre de la journée</label><input name="title" value="${esc(useDraft ? draft.title : (d?.title || ""))}" placeholder="Traversée des Highlands" ${mine ? "" : "readonly"}></div></div>
        ${iso ? `<div class="field"><label>Photos de la journée${dayPhotos.length ? ` (${dayPhotos.length})` : ""}</label>
          ${d?.published && !isLive() ? `<p class="small muted" style="margin:-2px 0 8px">Journée publiée : les photos ajoutées ici sont <b>déjà visibles</b> par tes proches. « Envoyer le lien » sert seulement à les prévenir.</p>` : ""}
          ${dayPhotos.length ? `<div class="media-grid day-gallery" id="day-gallery">${dayPhotos.map((x) => mediaTile(x)).join("")}</div>` : `<p class="small muted">Aucune photo pour cette journée.</p>`}
          <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="day-add-photos">${ic("camera", "sm")} Ajouter des photos à cette journée</button><input type="file" id="day-files" accept="image/*,video/*" multiple hidden></div>
          <div id="uprog" hidden><div class="small muted" id="uptxt"></div><div class="progress"><div id="upbar"></div></div></div></div>` : ""}
        ${iso && mine ? `<div class="field"><label>Comment as-tu voyagé ce jour-là ?</label>
          <div class="mode-picker" id="day-mode-picker">${[["", "🤔", "l'app devine"], ...Object.entries(BVMAP.MODES).map(([k, v]) => [k, v.icon, v.label.replace(/^(à|en) /, "")])].map(([k, icon, lab]) => `<button type="button" class="mode${dayMode === k ? " active" : ""}" data-mode="${k}">${icon}<small>${lab}</small></button>`).join("")}<input type="hidden" name="transport" value="${esc(dayMode)}"></div>
          <p class="help">Le moyen de locomotion de la journée. S'il change en cours de route, indique-le sur la photo où ça change (ci-dessous ou dans la fiche de la photo). Sans indication, l'app devine : voiture par la route au-delà de 2,5 km entre deux photos, à pied en dessous.</p></div>
        ${legs && legs.length > 1 ? `<details class="legs-details"><summary>Changements en cours de journée (${legs.length} tronçons)</summary><div class="legs">${legs.map((l, i) => `<div class="leg"><img src="${API.publicUrl(l.from.thumb_path || l.from.path)}" alt=""><span class="arrow">→</span><img src="${API.publicUrl(l.to.thumb_path || l.to.path)}" alt="">
            <select data-from="${l.from.id}" class="leg-mode"><option value="">${l.auto ? `auto : ${BVMAP.MODES[l.mode].label}` : `comme avant (${BVMAP.MODES[l.mode].label})`}</option>${Object.entries(BVMAP.MODES).map(([k, v]) => `<option value="${k}" ${l.from.transport === k ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("")}</select></div>`).join("")}</div><p class="help">Chaque ligne = le trajet de la photo de gauche à celle de droite ; le choix vaut à partir de la photo de gauche jusqu'au prochain changement.</p></details>` : ""}` : ""}
        ${mine ? `<div class="field"><label>Récit</label><textarea name="story" class="story" placeholder="Raconte ta journée… (les paragraphes sont conservés)">${esc(useDraft ? draft.story : (d?.story || ""))}</textarea></div>
        <div class="field"><label>Récit audio (en plus ou à la place du texte)</label><div id="day-rec"></div></div>`
        : `${d?.story ? `<div class="field"><label>Le récit de ${esc(MEMBERS.name(d.author_id) || "l'équipage")}</label><div class="story-read">${nl2p(d.story)}</div></div>` : ""}
           <div class="field"><label>Mon récit</label><textarea name="my_story" class="story" placeholder="Et toi, comment as-tu vécu cette journée ?">${esc(myStory?.body || "")}</textarea></div>`}
        <div id="story-list"></div>
        ${showVoices ? `<div class="field"><label>Le mot du jour</label><div id="day-voice"></div><div id="voice-list"></div>
          <p class="help">Trente secondes à ta façon, en plus du récit — chacun laisse le sien. C'est ce qui vaudra le plus, plus tard.</p></div>` : ""}
        ${iso ? `<div class="field private-note${MEMBERS.isShared() ? " shared" : ""}"><label>Carnet de bord</label>
          <textarea name="my_note" placeholder="Ce qui ne va pas dans le récit : l'adresse du gîte, ce qu'il faut penser à faire demain…">${esc(myNote?.body || "")}</textarea>
          <div id="note-list"></div></div>` : ""}
        ${statsHtml}
        ${iso ? `${canRoute ? `<div class="field"><label>Trajet</label><p class="small muted" style="margin:-2px 0 8px">Pas de trace GPS ce jour-là : la carte relie les photos en pointillés, dans l'ordre de l'heure, selon le moyen de locomotion choisi sur chaque photo. « Tracer l'itinéraire » fait suivre les vraies routes aux tronçons en voiture, bus ou vélo.</p>
          <button type="button" class="btn sm" id="day-route">${ic("route", "sm")} Tracer l'itinéraire par la route</button></div>` : ""}
        ${routeTrack ? `<div class="field"><label>Trajet</label><div class="row between"><span class="small">${ic("route", "sm")} Itinéraire par la route · <b>${fmtDistance(routeTrack.distance_m)}</b> · ${routeTrack.points.length} points</span><button type="button" class="btn sm ghost danger" id="day-route-del">Retirer</button></div>
          <p class="help">Retirer l'itinéraire fait revenir les pointillés entre les photos. Refais « Tracer » après avoir changé un moyen de locomotion.</p></div>` : ""}` : ""}
        <div class="actions sticky">
          ${d && mine ? `<button type="button" class="btn icon ghost danger" id="del" title="Supprimer le récit">${ic("trash")}</button>` : ""}${d?.published && !isLive() && mine ? `<button type="button" class="btn sm ghost" id="unpub" title="Repasser en brouillon">Brouillon</button>` : ""}<span class="grow"></span>
          <button class="btn secondary" type="submit">Enregistrer</button>
          ${iso && mine && !isLive() && !d?.published ? `<button type="button" class="btn secondary" id="pub-quiet" title="Rend la journée visible sans envoyer de message">${ic("check")} Publier</button>` : ""}
          ${iso && mine ? `<button type="button" class="btn primary" id="pub" title="Enregistre aussi les modifications">${ic("sparkle")} ${isLive() || d?.published ? "Envoyer le lien" : "Publier et prévenir"}</button>` : ""}
        </div></form>`,
      { guard: () => dirty() });
    const form = $("#f", m.el);
    const rec = $("#day-rec", m.el)
      ? CV.audioRecorder($("#day-rec", m.el), { existingUrl: d?.audio_path ? API.publicUrl(d.audio_path) : null, label: "Enregistrer le récit du jour" })
      : null;

    // ---- Les contributions des autres : rien à l'écran s'il n'y a rien ----
    function renderContribs() {
      if (!d) return;
      const sl = $("#story-list", m.el);
      if (sl) {
        sl.innerHTML = MEMBERS.signedList(
          S.stories.filter((x) => x.day_id === d.id && x.author_id !== S.user.id),
          { label: "Le récit des autres", icon: ic("edit", "sm"), when: true,
            render: (x) => `<div class="text">${nl2p(x.body)}</div>`,
            canDelete: () => isTripOwner() });
        bindSigDel(sl, "day_stories", () => S.stories, (l) => { S.stories = l; });
      }
      const nl = $("#note-list", m.el);
      if (nl) {
        nl.innerHTML = MEMBERS.signedList(
          S.notes.filter((x) => x.day_id === d.id && x.author_id !== S.user.id),
          { when: true, render: (x) => `<div class="text">${nl2p(x.body)}</div>`,
            canDelete: () => isTripOwner() });
        bindSigDel(nl, "day_notes", () => S.notes, (l) => { S.notes = l; });
      }
      const vl = $("#voice-list", m.el);
      if (vl) {
        vl.innerHTML = MEMBERS.signedList(
          S.voices.filter((v) => v.day_id === d.id && v.author_id !== S.user.id),
          { render: (v) => CV.bigAudio(API.publicUrl(v.audio_path), "Écouter " + (MEMBERS.name(v.author_id) || "le mot du jour"), true),
            canDelete: () => isTripOwner() });
        CV.bindBigAudio(vl);
        $$(".sig-del", vl).forEach((b) => b.onclick = async () => {
          const v = S.voices.find((x) => x.id === b.closest(".signed").dataset.id);
          if (!v || !(await confirm("Effacer ce mot du jour ?"))) return;
          try { await API.deleteDayVoice(v); S.voices = S.voices.filter((x) => x.id !== v.id); renderContribs(); }
          catch (e) { errToast(e); }
        });
      }
    }
    function bindSigDel(root, table, get, set) {
      $$(".sig-del", root).forEach((b) => b.onclick = async () => {
        const id = b.closest(".signed").dataset.id;
        if (!(await confirm("Effacer cette contribution ?"))) return;
        try { await API.deleteDayText(table, id); set(get().filter((x) => x.id !== id)); renderContribs(); }
        catch (e) { errToast(e); }
      });
    }

    // ---- Mon mot du jour : trente secondes, et il n'y en a qu'un par personne ----
    let voiceRec = null;
    if ($("#day-voice", m.el)) {
      const mineVoice = d ? S.voices.find((v) => v.day_id === d.id && v.author_id === S.user.id) : null;
      voiceRec = CV.audioRecorder($("#day-voice", m.el), {
        existingUrl: mineVoice ? API.publicUrl(mineVoice.audio_path) : null,
        label: "Mon mot du jour (30 s)", maxSeconds: 30,
      });
    }
    renderContribs();

    // ---- Enregistrer ce qui n'appartient qu'à moi ----
    async function saveMine(savedDay) {
      if (!savedDay) return;
      const f = $("#f", m.el);
      try {
        if (f.my_story) {
          const r = await API.saveDayStory(S.cur.trip.id, savedDay.id, savedDay.day_date, S.user.id, f.my_story.value, myStory);
          S.stories = S.stories.filter((x) => !(x.day_id === savedDay.id && x.author_id === S.user.id));
          if (r) S.stories.push(r);
        }
        if (f.my_note) {
          const r = await API.saveDayNote(S.cur.trip.id, savedDay.id, savedDay.day_date, S.user.id, f.my_note.value, myNote);
          S.notes = S.notes.filter((x) => !(x.day_id === savedDay.id && x.author_id === S.user.id));
          if (r) S.notes.push(r);
        }
        if (voiceRec) {
          const blob = voiceRec.getBlob();
          const mineVoice = S.voices.find((v) => v.day_id === savedDay.id && v.author_id === S.user.id);
          if (blob) {
            const path = await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type));
            const v = await API.upsertDayVoice(S.cur.trip.id, savedDay.id, savedDay.day_date, S.user.id, path, 0);
            if (mineVoice && mineVoice.audio_path !== path) API.removeFiles([mineVoice.audio_path]).catch(() => {});
            S.voices = S.voices.filter((x) => !(x.day_id === savedDay.id && x.author_id === S.user.id));
            S.voices.push(v);
          } else if (voiceRec.isRemoved() && mineVoice) {
            await API.deleteDayVoice(mineVoice);
            S.voices = S.voices.filter((x) => x.id !== mineVoice.id);
          }
        }
      } catch (e) { errToast(e, 6000); }
    }

    const dirty = () => (mine && (form.title.value !== (d?.title || "") || form.story.value !== (d?.story || "")))
      || (form.my_story && form.my_story.value !== (myStory?.body || ""))
      || (form.my_note && form.my_note.value !== (myNote?.body || ""))
      || (rec && (!!rec.getBlob() || rec.isRemoved()))
      || (voiceRec && (!!voiceRec.getBlob() || voiceRec.isRemoved()));
    // Brouillon sauvé à chaque frappe : un tap malheureux ne perd plus rien
    const saveDraft = () => { if (mine && dirty()) OFF.LS.set(draftKey(iso), { title: form.title.value, story: form.story.value, at: Date.now() }); else OFF.LS.del(draftKey(iso)); };
    if (mine) { form.title.addEventListener("input", saveDraft); form.story.addEventListener("input", saveDraft); }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        let saved = d;
        // La journée elle-même : seulement si elle est à moi (ou si je la crée).
        if (mine) {
          const fields = { title: fd.title, story: fd.story, transport: fd.transport || null };
          const blob = rec && rec.getBlob();
          if (blob) fields.audio_path = await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type));
          else if (rec && rec.isRemoved()) fields.audio_path = null;
          const oldAudio = d?.audio_path;
          saved = await API.upsertDay(S.user, S.cur.trip.id, fd.day_date, fields);
          if (oldAudio && oldAudio !== saved.audio_path) API.removeFiles([oldAudio]).catch(() => {});
          const i = S.cur.days.findIndex((x) => x.id === saved.id);
          if (i >= 0) S.cur.days[i] = saved; else S.cur.days.push(saved);
          S.cur.days.sort((a, b) => a.day_date.localeCompare(b.day_date));
        }
        // Ce qui n'appartient qu'à moi : mon récit, mon mot du jour, mon carnet de bord.
        await saveMine(saved);
        OFF.LS.del(draftKey(iso)); saveLocal();
        m.close(); renderPanel(); toast(mine ? "Journée enregistrée" : "Ta contribution est enregistrée", "ok");
      } catch (err) { errToast(err, 6000); if (isNetworkError(err)) toast("Ton texte est gardé sur le téléphone : réessaie quand tu auras du réseau", "info", 6000); }
    };
    const del = $("#del", m.el);
    if (del) del.onclick = async () => {
      if (!(await confirm("Supprimer le titre et le récit de cette journée ? (les photos et traces restent)"))) return;
      if (d.audio_path) API.removeFiles([d.audio_path]).catch(() => {});
      await API.deleteDay(d.id); S.cur.days = S.cur.days.filter((x) => x.id !== d.id); m.close(); renderPanel();
    };
    // Galerie de la journée
    $$("#day-gallery .media-tile", m.el).forEach((el) => el.onclick = () => mediaViewer(S.cur.media.find((x) => x.id === el.dataset.id)));
    const addBtn = $("#day-add-photos", m.el), dayFiles = $("#day-files", m.el);
    if (addBtn) { addBtn.onclick = () => dayFiles.click(); dayFiles.onchange = async () => { await uploadFiles([...dayFiles.files], iso); saveLocal(); redraw(); const keep = { title: form.title.value, story: form.story.value }; m.close(); dayForm(iso); const f2 = $("#modal-host form#f"); if (f2) { f2.title.value = keep.title; f2.story.value = keep.story; } }; }
    const routeBtn = $("#day-route", m.el);
    if (routeBtn) routeBtn.onclick = async () => {
      busy(routeBtn, true);
      try {
        const route = await CV.buildRoute(S.cur, iso);
        if (!route || route.length < 2) throw new Error("Itinéraire introuvable pour ces points");
        const tr = await API.createTrack(S.user, S.cur.trip.id, { name: "Itinéraire estimé (route)", day_date: iso, source: "route", points: route, distance_m: CV.trackDistance(route) });
        S.cur.tracks.push(tr); saveLocal(); redraw(); toast(`Itinéraire tracé · ${fmtDistance(tr.distance_m)}`, "ok"); m.close(); dayForm(iso);
      } catch (err) { errToast(err, 6000); busy(routeBtn, false); }
    };
    $$("#day-mode-picker .mode", m.el).forEach((b) => b.onclick = async () => {
      $$("#day-mode-picker .mode", m.el).forEach((x) => x.classList.toggle("active", x === b)); form.transport.value = b.dataset.mode;
      if (!d) return; // journée sans fiche : enregistré avec le formulaire
      try { const u = await API.upsertDay(S.user, S.cur.trip.id, iso, { transport: b.dataset.mode || null }); Object.assign(d, u); saveLocal(); redraw(); toast(b.dataset.mode ? `Journée ${BVMAP.MODES[b.dataset.mode].label}` : "L'app devinera le moyen de locomotion", "ok", 1800); }
      catch (err) { errToast(err); }
    });
    $$(".leg-mode", m.el).forEach((sel) => sel.onchange = async () => {
      const x = S.cur.media.find((y) => y.id === sel.dataset.from); if (!x) return;
      try { const u = await API.updateMedia(x.id, { transport: sel.value || null }); Object.assign(x, u); saveLocal(); redraw(); toast(sel.value ? `Tronçon ${BVMAP.MODES[sel.value].label}` : "Tronçon : comme le précédent", "ok", 1800); }
      catch (err) { errToast(err); }
    });
    const routeDel = $("#day-route-del", m.el);
    if (routeDel) routeDel.onclick = async () => {
      try { await API.deleteTrack(routeTrack.id); S.cur.tracks = S.cur.tracks.filter((t) => t.id !== routeTrack.id); saveLocal(); redraw(); toast("Itinéraire retiré", "ok"); m.close(); dayForm(iso); }
      catch (err) { errToast(err); }
    };
    const publish = async (notify) => {
      // On enregistre d'abord les modifications en cours, puis on publie
      const f = $("#f", m.el); const fd = Object.fromEntries(new FormData(f));
      try {
        const fields = { title: fd.title, story: fd.story };
        const blob = rec && rec.getBlob();
        if (blob) fields.audio_path = await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type));
        else if (rec && rec.isRemoved()) fields.audio_path = null;
        if (!d?.published) { fields.published = true; fields.published_at = new Date().toISOString(); }
        const saved = await API.upsertDay(S.user, S.cur.trip.id, iso, fields);
        await saveMine(saved);
        const i = S.cur.days.findIndex((x) => x.id === saved.id); if (i >= 0) S.cur.days[i] = saved; else S.cur.days.push(saved);
        OFF.LS.del(draftKey(iso)); saveLocal();
        m.close(); renderPanel();
        if (notify) announceDay(saved); else toast("Journée publiée — tes proches la verront à leur prochaine visite", "ok", 5000);
      } catch (err) { errToast(err, 6000); }
    };
    const pub = $("#pub", m.el); if (pub) pub.onclick = () => publish(true);
    const pubQ = $("#pub-quiet", m.el); if (pubQ) pubQ.onclick = () => publish(false);
    const unpub = $("#unpub", m.el);
    if (unpub) unpub.onclick = async () => {
      try { const saved = await API.upsertDay(S.user, S.cur.trip.id, iso, { published: false });
        const i = S.cur.days.findIndex((x) => x.id === saved.id); S.cur.days[i] = saved; saveLocal(); m.close(); renderPanel(); toast("Journée repassée en brouillon"); }
      catch (err) { errToast(err); }
    };
  }
  // Ouvre la feuille de partage du téléphone avec un message prêt à envoyer
  async function announceDay(d) {
    const n = dayNumber(S.cur.trip, d.day_date);
    const url = shareUrl() + "#day-" + d.day_date;
    const label = `${n ? "Jour " + n : fmtDate(d.day_date, false)}${d.title ? " · " + d.title : ""}`;
    const text = `${S.cur.trip.title} — ${label} est en ligne ! Carte, photos et récit ici : ${url}`;
    // Notifications aux proches abonnés (si configurées)
    if (cfg.VAPID_PUBLIC_KEY) {
      API.notify(S.cur.trip.id, S.cur.trip.title, `${label} est en ligne 🧳`, url)
        .then((r) => { if (r && r.total) toast(`Notification envoyée à ${r.sent} proche${r.sent > 1 ? "s" : ""}`, "ok"); })
        .catch((e) => toast("Notifications non envoyées : " + friendly(e), "error", 6000));
    }
    if (navigator.share) {
      // Avec la photo de couverture de la journée quand le téléphone sait partager un fichier (WhatsApp affiche alors l'image)
      let files = null;
      try {
        const cover = S.cur.media.find((x) => x.day_date === d.day_date && x.kind === "photo");
        if (cover && navigator.canShare) { const blob = await fetch(API.publicUrl(cover.path)).then((r) => r.blob()); const f = new File([blob], `bonvoyage-jour-${n || d.day_date}.jpg`, { type: blob.type || "image/jpeg" }); if (navigator.canShare({ files: [f] })) files = [f]; }
      } catch { files = null; }
      try { await navigator.share(files ? { title: S.cur.trip.title, text: text, files } : { title: S.cur.trip.title, text, url }); toast("Journée publiée", "ok"); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(text); toast("Journée publiée · message copié, colle-le dans WhatsApp, SMS ou email", "ok", 6000); }
    catch { toast("Journée publiée", "ok"); }
  }

  // ---------- Onglet Photos ----------
  function renderPhotos(body) {
    const list = S.cur.media.filter((x) => !S.dayFilter || x.day_date === S.dayFilter);
    body.innerHTML = `
      <div class="upload-zone" id="uz">${ic("camera")}<b>Ajouter des photos ou vidéos</b><span class="small">Date et position sont lues automatiquement</span>
        <input type="file" id="uf" accept="image/*,video/*" multiple hidden></div>
      <div id="uprog" hidden><div class="small muted" id="uptxt"></div><div class="progress"><div id="upbar"></div></div></div>
      <div class="row between" style="margin-bottom:10px">
        <span class="muted small">${S.dayFilter ? `Filtre : ${fmtDate(S.dayFilter, false)}` : `${list.length} photo${list.length > 1 ? "s" : ""}`}</span>
        <div class="row">${S.dayFilter ? `<button class="btn sm" id="clear-filter">Tout voir</button>` : ""}${list.length ? `<button class="btn sm ${S.selecting ? "secondary" : ""}" id="select-toggle">${S.selecting ? "Terminer" : `${ic("check", "sm")} Sélectionner`}</button>` : ""}</div>
      </div>
      ${S.selecting ? `<div class="select-bar" id="select-bar"><span id="sel-count">0 sélectionnée</span><span class="grow"></span><button class="btn sm ghost" id="sel-all">Tout</button><button class="btn sm ghost" id="sel-move" disabled>${ic("calendar", "sm")} Déplacer</button><button class="btn sm ghost danger" id="sel-del" disabled>${ic("trash", "sm")} Supprimer</button></div>` : ""}
      ${S.pendingMedia.length ? `<div class="setup-help" style="margin-bottom:10px">⏳ ${S.pendingMedia.length} photo${S.pendingMedia.length > 1 ? "s" : ""} en attente d'envoi (gardée${S.pendingMedia.length > 1 ? "s" : ""} sur le téléphone jusqu'au retour du réseau)</div>` : ""}
      ${list.length || S.pendingMedia.length ? "" : `<div class="empty">Aucune photo pour l'instant.</div>`}
      <div class="media-grid">${S.pendingMedia.map((pm) => `<div class="media-tile pending"><img src="${pm._url || (pm._url = URL.createObjectURL(pm.thumb || pm.video))}" alt=""><span class="badge">en attente</span></div>`).join("")}${list.map((x) => mediaTile(x)).join("")}</div>`;
    const uz = $("#uz", body), uf = $("#uf", body);
    uz.onclick = () => uf.click();
    uf.onchange = () => uploadFiles([...uf.files]);
    uz.ondragover = (e) => { e.preventDefault(); uz.classList.add("drag"); };
    uz.ondragleave = () => uz.classList.remove("drag");
    uz.ondrop = (e) => { e.preventDefault(); uz.classList.remove("drag"); uploadFiles([...e.dataTransfer.files]); };
    const cf = $("#clear-filter", body); if (cf) cf.onclick = () => { S.dayFilter = null; redraw(true); renderPanel(); };
    const st = $("#select-toggle", body); if (st) st.onclick = () => { S.selecting = !S.selecting; S.selected = new Set(); renderPanel(); };
    const tiles = $$(".media-tile:not(.pending)", body);
    if (!S.selecting) { tiles.forEach((el) => el.onclick = () => mediaViewer(S.cur.media.find((x) => x.id === el.dataset.id))); return; }
    // Mode sélection : cocher des photos, puis les supprimer ou les déplacer vers une autre journée
    S.selected = S.selected || new Set();
    const refresh = () => {
      tiles.forEach((el) => el.classList.toggle("selected", S.selected.has(el.dataset.id)));
      const n = S.selected.size;
      $("#sel-count", body).textContent = `${n} sélectionnée${n > 1 ? "s" : ""}`;
      $("#sel-del", body).disabled = !n; $("#sel-move", body).disabled = !n;
    };
    tiles.forEach((el) => { el.classList.add("selectable"); el.onclick = () => { const id = el.dataset.id; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); if (navigator.vibrate) navigator.vibrate(6); refresh(); }; });
    $("#sel-all", body).onclick = () => { if (S.selected.size === list.length) S.selected.clear(); else list.forEach((x) => S.selected.add(x.id)); refresh(); };
    $("#sel-del", body).onclick = async () => {
      const ids = [...S.selected]; if (!ids.length) return;
      if (!(await confirm(`Supprimer ${ids.length} photo${ids.length > 1 ? "s" : ""} définitivement ?`))) return;
      let ok = 0;
      for (const id of ids) { const m = S.cur.media.find((x) => x.id === id); if (!m) continue; try { await API.deleteMedia(m); S.cur.media = S.cur.media.filter((x) => x.id !== id); ok++; } catch (e) { errToast(e); break; } }
      S.selected.clear(); S.selecting = S.cur.media.some((x) => !S.dayFilter || x.day_date === S.dayFilter);
      saveLocal(); renderTripHeader(); redraw(); renderPanel(); toast(`${ok} photo${ok > 1 ? "s" : ""} supprimée${ok > 1 ? "s" : ""}`, "ok");
    };
    $("#sel-move", body).onclick = () => {
      const ids = [...S.selected]; if (!ids.length) return;
      const days = allDays();
      const m = openModal(`<h2>Déplacer ${ids.length} photo${ids.length > 1 ? "s" : ""}</h2><form id="f">
        <div class="field"><label>Vers la journée</label><select name="day_date">${days.map((d) => `<option value="${d}">${fmtDate(d)}</option>`).join("")}</select></div>
        <div class="field"><label>Ou une autre date</label><input type="date" name="other"></div>
        <div class="actions"><button type="button" class="btn" data-close>Annuler</button><span class="grow"></span><button class="btn primary">Déplacer</button></div></form>`);
      $("#f", m.el).onsubmit = async (e) => {
        e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); const target = fd.other || fd.day_date;
        try { for (const id of ids) { const x = S.cur.media.find((y) => y.id === id); if (!x || x.day_date === target) continue; const u = await API.updateMedia(id, { day_date: target }); Object.assign(x, u); } }
        catch (err) { errToast(err); }
        S.selected.clear(); S.selecting = false; m.close(); saveLocal(); redraw(); renderPanel(); toast("Photos déplacées", "ok");
      };
    };
    refresh();
  }
  function mediaTile(x) {
    const src = API.publicUrl(x.thumb_path || (x.kind === "photo" ? x.path : ""));
    return `<div class="media-tile" data-id="${x.id}">
      ${dot(x.author_id)}
      ${x.kind === "video" && !x.thumb_path ? `<video src="${API.publicUrl(x.path)}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${src}" alt="" loading="lazy">`}
      ${x.kind === "video" ? `<span class="badge">vidéo</span>` : ""}
      ${x.lat == null ? `<span class="nogps">sans position</span>` : ""}
      ${x.caption ? `<div class="cap">${esc(x.caption)}</div>` : ""}</div>`;
  }

  const VIDEO_MAX = 50 * 1024 * 1024;   // limite de l'offre gratuite Supabase
  // Ajout de photos en deux temps : 1) chaque photo est réduite puis mise en file d'attente sur le téléphone (IndexedDB),
  // 2) la file est envoyée par syncAll. Si l'app est fermée ou redémarre (mémoire iPhone, appel…), rien n'est perdu :
  // les photos en attente réapparaissent au retour et partent toutes seules.
  async function uploadFiles(files, forceDay = null) {
    if (!files.length) return;
    const host = $("#modal-host #uprog") ? $("#modal-host") : document;
    const prog = $("#uprog", host), bar = $("#upbar", host), txt = $("#uptxt", host);
    if (prog) prog.hidden = false;
    let done = 0, queued = 0;
    for (const f of files) {
      const msg = `Préparation ${done + 1}/${files.length}…`;
      if (txt) txt.textContent = msg; CV.progress(msg);
      try {
        const isVideo = f.type.startsWith("video/");
        const exif = isVideo ? {} : await CV.readExif(f);
        const takenAt = exif.takenAt || (f.lastModified ? new Date(f.lastModified) : new Date());
        const fields = { kind: isVideo ? "video" : "photo", taken_at: takenAt.toISOString(),
          day_date: forceDay || S.dayFilter || isoDate(takenAt), lat: exif.lat ?? null, lng: exif.lng ?? null, caption: "" };
        let prepared;
        if (isVideo) {
          if (f.size > VIDEO_MAX) throw new Error("Vidéo trop lourde (max 50 Mo)");
          prepared = { tripId: S.cur.trip.id, fields, video: f, ext: (f.name.split(".").pop() || "mp4").toLowerCase() };
        } else {
          const img = await CV.prepareImage(f, cfg.PHOTO_MAX_SIZE || 1600, 320);
          prepared = { tripId: S.cur.trip.id, fields, big: img.big, thumb: img.thumb };
        }
        S.pendingMedia.push(await OFF.addPendingMedia(prepared)); queued++;
        // Laisse le téléphone respirer entre deux photos (décodage lourd) et montre la vignette « en attente »
        if (S.tab === "photos" && !$("#modal-host #uprog")) renderPanel();
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        toast(`${f.name} : ${friendly(err)}`, "error", 6000);
      }
      done++; if (bar) bar.style.width = Math.round((done / files.length) * 100) + "%";
    }
    updatePendingChip();
    if (!queued) { CV.progress(null); if (prog) prog.hidden = true; return; }
    if (!navigator.onLine) {
      CV.progress(null); S.offline = true;
      toast(`${queued} photo${queued > 1 ? "s" : ""} gardée${queued > 1 ? "s" : ""} sur le téléphone, envoi automatique au retour du réseau`, "info", 6000);
    } else {
      const sent = await syncAll({ label: "Envoi", expected: queued });
      CV.progress(null);
      if (sent >= queued) toast(`${queued} photo${queued > 1 ? "s" : ""} ajoutée${queued > 1 ? "s" : ""} ✔`, "ok", 4000);
      else if (sent) toast(`${sent}/${queued} envoyée${sent > 1 ? "s" : ""} — le reste partira automatiquement`, "info", 6000);
      else toast(`Réseau indisponible : ${queued} photo${queued > 1 ? "s" : ""} gardée${queued > 1 ? "s" : ""} sur le téléphone, envoi automatique dès que possible`, "info", 7000);
    }
    if (prog) prog.hidden = true;
    saveLocal(); renderTripHeader(); redraw(); renderPanel(); updatePendingChip();
  }
  // Interpole la position sur les traces GPS à un instant donné (±10 min)
  function positionFromTracks(ts) {
    let best = null, bestDt = 10 * 60 * 1000;
    for (const tr of S.cur.tracks) for (const p of tr.points || []) {
      if (!p.t) continue;
      const dt = Math.abs(p.t - ts);
      if (dt < bestDt) { bestDt = dt; best = p; }
    }
    return best;
  }

  function mediaViewer(m) {
    if (!m) return;
    const url = API.publicUrl(m.path);
    const comments = S.cur.comments.filter((c) => c.media_id === m.id);
    const days = allDays();
    const listAll = S.cur.media.filter((x) => !S.dayFilter || x.day_date === S.dayFilter), idxAll = listAll.indexOf(m);
    const modal = openModal(`
      <div class="viewer-media">${m.kind === "video" ? `<video src="${url}" controls playsinline></video>` : `<img src="${url}" alt="">`}
        <span class="count">${idxAll + 1} / ${listAll.length}</span>
        <button type="button" class="nav prev" id="prev" title="Photo précédente (enregistre)">${ic("chevron-left")}</button>
        <button type="button" class="nav next" id="next" title="Photo suivante (enregistre)">${ic("chevron-right")}</button>
        <button type="button" class="close" data-close title="Fermer">${ic("close")}</button></div>
      ${m.author_id ? `<div style="margin:10px 0 -4px">${pill(m.author_id)}</div>` : ""}
      <form id="f">
        <div class="field caption-field"><label>Légende</label><textarea name="caption" placeholder="Un mot sur cette photo…">${esc(m.caption || "")}</textarea></div>
        <div class="field"><label>Commentaire audio</label><div id="media-rec"></div></div>
        <div class="row">
          <div class="field grow"><label>Journée</label><select name="day_date">${days.map((d) => `<option value="${d}" ${d === m.day_date ? "selected" : ""}>${fmtDate(d)}</option>`).join("")}${m.day_date && !days.includes(m.day_date) ? `<option value="${m.day_date}" selected>${fmtDate(m.day_date)}</option>` : ""}</select></div>
          <div class="field grow"><label>Prise le</label><input type="datetime-local" name="taken_at" value="${m.taken_at ? toLocalInput(m.taken_at) : ""}"></div>
        </div>
        <div class="field"><label>À partir de cette photo, je voyage…</label><div class="mode-picker" id="mode-picker">
          <button type="button" class="mode${!m.transport ? " active" : ""}" data-mode="" title="Comme avant (moyen de la journée ou du tronçon précédent)">↩︎<small>comme avant</small></button>
          ${Object.entries(BVMAP.MODES).map(([k, v]) => `<button type="button" class="mode${m.transport === k ? " active" : ""}" data-mode="${k}" title="${v.label}">${v.icon}<small>${v.label.replace(/^(à|en) /, "")}</small></button>`).join("")}
          <input type="hidden" name="transport" value="${esc(m.transport || "")}"></div>
          <p class="help" style="margin-top:6px">Ne change que si le moyen de locomotion change ici (par exemple : arrivée au parking, départ de la rando). Le moyen de la journée se règle dans la fiche de la journée.</p></div>
        <div class="row" style="margin-bottom:14px">
          <span class="chip tnum">${ic("pin", "sm")} ${m.lat != null ? `${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}` : "sans position"}</span>
          <button type="button" class="btn sm ghost" id="place">Placer sur la carte</button>
          <button type="button" class="btn sm ghost" id="here">Ma position</button>
          ${m.lat != null ? `<button type="button" class="btn sm ghost" id="goto">Voir sur la carte</button>` : ""}
        </div>
        <div class="actions sticky">${canEdit(m) ? `<button type="button" class="btn icon ghost danger" id="del" title="Supprimer">${ic("trash")}</button>` : ""}<span class="grow"></span>
          ${canEdit(m) ? `<button class="btn primary" type="submit">${ic("check")} Enregistrer</button>`
            : `<span class="small muted">Photo de ${esc(MEMBERS.name(m.author_id) || "un compagnon")} : tu peux la commenter, pas la modifier.</span>`}</div>
      </form>
      <h3 style="margin:18px 0 8px;font-size:17px">Commentaires (${comments.length})</h3>
      <div id="clist">${comments.map(commentHtml).join("") || `<p class="muted small">Pas encore de commentaire. Tes proches pourront en laisser depuis le lien de partage.</p>`}</div>
      <form class="comment-form" id="cf"><textarea name="body" placeholder="Ajouter ton propre commentaire…"></textarea><div id="c-rec"></div><div class="actions"><button class="btn sm" type="submit">${ic("send", "sm")} Commenter</button></div></form>
    `, { wide: true, guard: () => dirty() });
    const el = modal.el;
    const form = $("#f", el);
    $$("#mode-picker .mode", el).forEach((b) => b.onclick = () => { $$("#mode-picker .mode", el).forEach((x) => x.classList.toggle("active", x === b)); form.transport.value = b.dataset.mode; if (navigator.vibrate) navigator.vibrate(6); });
    const mrec = CV.audioRecorder($("#media-rec", el), { existingUrl: m.audio_path ? API.publicUrl(m.audio_path) : null, label: "Enregistrer un commentaire audio" });
    const crec = CV.audioRecorder($("#c-rec", el), { label: "Commentaire vocal", maxSeconds: 120 });
    const dirty = () => form.caption.value !== (m.caption || "") || form.day_date.value !== m.day_date || !!mrec.getBlob() || mrec.isRemoved();
    async function save() {
      if (!dirty()) return true;
      const fd = Object.fromEntries(new FormData(form));
      try {
        const fields = { caption: fd.caption, day_date: fd.day_date, taken_at: fd.taken_at ? new Date(fd.taken_at).toISOString() : m.taken_at, transport: fd.transport || null };
        const blob = mrec.getBlob();
        if (blob) fields.audio_path = await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type));
        else if (mrec.isRemoved()) fields.audio_path = null;
        const old = m.audio_path;
        const u = await API.updateMedia(m.id, fields);
        if (old && old !== u.audio_path) API.removeFiles([old]).catch(() => {});
        Object.assign(m, u); saveLocal(); return true;
      } catch (err) { errToast(err); return false; }
    }
    form.onsubmit = async (e) => { e.preventDefault(); if (await save()) { modal.close(); redraw(); renderPanel(); toast("Enregistré", "ok"); } };
    // Légender en série : ◀ ▶ enregistrent puis passent à la photo voisine (dans l'ordre affiché)
    const list = S.cur.media.filter((x) => !S.dayFilter || x.day_date === S.dayFilter), idx = list.indexOf(m);
    const go = async (dir) => { const nx = list[idx + dir]; if (!nx) return toast(dir > 0 ? "Dernière photo" : "Première photo"); if (await save()) { modal.close(); redraw(); renderPanel(); mediaViewer(nx); } };
    $("#prev", el).onclick = () => go(-1); $("#next", el).onclick = () => go(1);
    $("#prev", el).disabled = idx <= 0; $("#next", el).disabled = idx >= list.length - 1;
    const delBtn = $("#del", el);
    if (delBtn) delBtn.onclick = async () => {
      if (!(await confirm("Supprimer cette photo ?"))) return;
      try { await API.deleteMedia(m); S.cur.media = S.cur.media.filter((x) => x.id !== m.id); saveLocal(); modal.close(); renderTripHeader(); redraw(); renderPanel(); }
      catch (err) { errToast(err); }
    };
    $("#place", el).onclick = () => { S.placing = m; modal.close(); $("#panel").classList.add("collapsed"); BVMAP.setCursor(S.map, "crosshair"); toast("Touche la carte à l'endroit de la photo"); setTimeout(() => BVMAP.resize(S.map), 280); };
    $("#here", el).onclick = () => navigator.geolocation.getCurrentPosition(async (p) => {
      try { Object.assign(m, await API.updateMedia(m.id, { lat: p.coords.latitude, lng: p.coords.longitude })); saveLocal(); modal.close(); redraw(); renderPanel(); toast("Position enregistrée", "ok"); }
      catch (err) { errToast(err); }
    }, (e) => toast("Position introuvable", "error"), { enableHighAccuracy: true, timeout: 15000 });
    const gt = $("#goto", el); if (gt) gt.onclick = () => { modal.close(); BVMAP.easeTo(S.map, m.lat, m.lng, 16); };
    $("#cf", el).onsubmit = async (e) => {
      e.preventDefault();
      const body = e.target.body.value.trim(); const blob = crec.getBlob();
      if (!body && !blob) return toast("Écris ou enregistre un message", "error");
      try {
        const audio_path = blob ? await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type)) : null;
        const c = await API.addOwnerComment(S.cur.trip.id, { media_id: m.id, author: "Moi", body, audio_path });
        crec.reset();
        S.cur.comments.push(c); e.target.reset();
        $("#clist", el).insertAdjacentHTML("beforeend", commentHtml(c)); bindCommentDeletes(el); CV.bindBigAudio(el);
      } catch (err) { errToast(err); }
    };
    bindCommentDeletes(el); CV.bindBigAudio(el);
  }
  function toLocalInput(iso) {
    const d = new Date(iso), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function commentHtml(c, forceNew) {
    const isNew = forceNew != null ? forceNew : (Date.parse(c.created_at) > seenTs() && S.tab !== "comments");
    const initial = (c.author || "?").trim().charAt(0).toUpperCase();
    return `<div class="comment${isNew ? " is-new" : ""}" data-id="${c.id}"><span class="avatar">${esc(initial)}</span><div class="body"><b>${esc(c.author)}</b><span class="when">${new Date(c.created_at).toLocaleDateString("fr-FR")}</span>${c.body ? `<div>${esc(c.body)}</div>` : ""}${c.audio_path ? CV.bigAudio(API.publicUrl(c.audio_path), `Écouter ${esc(c.author)}`, true) : ""}</div><button class="btn icon sm ghost del" title="Supprimer">${ic("close", "sm")}</button></div>`;
  }
  function bindCommentDeletes(root) {
    $$(".comment .del", root).forEach((b) => b.onclick = async () => {
      const el = b.closest(".comment");
      if (!(await confirm("Supprimer ce commentaire ?"))) return;
      const c = S.cur.comments.find((x) => x.id === el.dataset.id);
      try { await API.deleteComment(c); S.cur.comments = S.cur.comments.filter((x) => x.id !== c.id); el.remove(); }
      catch (err) { errToast(err); }
    });
  }

  // ---------- Onglet Commentaires ----------
  function renderComments(body) {
    const list = [...S.cur.comments].reverse();
    const seenBefore = seenTs();
    const n = list.filter((c) => Date.parse(c.created_at) > seenBefore).length;
    // v10 : le repère est sur MA ligne de membre — un co-auteur n'a pas le droit d'écrire dans trips
    if (n) { API.markSeen(S.cur.trip.id, "comments_seen_at").then(reloadMembers).then(updateCommentBadge).catch(() => {}); }
    body.innerHTML = `<div class="comments-head"><span class="hand">Ce que disent tes proches</span>${n ? `<span class="badge-count">${n}</span>` : ""}</div>
      ${list.length ? "" : `<div class="empty valdo-empty"><img src="icons/valdo.svg" alt="">Aucun commentaire pour l'instant.<span class="small">Tes proches peuvent en laisser depuis le lien du voyage.</span></div>`}
      ${list.map((c) => {
        const m = c.media_id && S.cur.media.find((x) => x.id === c.media_id);
        const d = c.day_id && S.cur.days.find((x) => x.id === c.day_id);
        const isNew = Date.parse(c.created_at) > seenBefore;
        return `<div class="row" style="align-items:flex-start;margin-bottom:6px;flex-wrap:nowrap">
          ${m ? `<img src="${API.publicUrl(m.thumb_path || m.path)}" style="width:56px;height:56px;border-radius:12px;object-fit:cover;cursor:pointer;flex:none;box-shadow:var(--sh-1)" data-media="${m.id}">` : ""}
          <div class="grow" style="min-width:0">${commentHtml(c, isNew)}${d ? `<div class="small muted" style="margin:-4px 0 10px 12px">${ic("calendar", "sm")} ${esc(d.title || fmtDate(d.day_date))}</div>` : ""}</div></div>`; }).join("")}`;
    bindCommentDeletes(body); CV.bindBigAudio(body);
    $$("img[data-media]", body).forEach((i) => i.onclick = () => mediaViewer(S.cur.media.find((x) => x.id === i.dataset.media)));
  }

  // ---------- Onglet GPS ----------
  function renderGps(body) {
    const g = S.gps, on = g.watchId != null;
    const dl = S.drawn ? S.drawn.dayList : [];
    body.innerHTML = `
      <div class="gps-box${on ? " on" : ""}">
        <div class="row between"><b style="font-family:var(--font-title);font-weight:500;font-size:18px">${on ? `<span class="pulse"></span> Suivi en cours` : "Suivi GPS"}</b>
          <span class="chip">${on ? fmtDate(g.track.day_date, false) : "économe en batterie"}</span></div>
        <div class="gps-stat"><div><b id="st-dist">${fmtDistance(CV.trackDistance(g.points))}</b><span>distance</span></div>
          <div><b id="st-pts">${g.points.length}</b><span>points</span></div>
          <div><b id="st-time">${on ? elapsed(g.startedAt) : "–"}</b><span>durée</span></div></div>
        ${on ? `<button class="btn danger" id="gps-stop" style="width:100%">${ic("stop")} Terminer</button>
                <p class="help">L'app doit rester à l'écran (l'écran est maintenu allumé, baisse la luminosité). Un point est gardé tous les ${cfg.GPS_MIN_DISTANCE_M} m / ${cfg.GPS_MIN_INTERVAL_S} s.</p>
                <label class="row" style="margin-top:10px;justify-content:space-between"><span class="small">Empêcher la mise en veille</span><input type="checkbox" class="switch" id="wake" ${g.wakeLock ? "checked" : ""}></label>`
            : `<div class="row" style="flex-wrap:nowrap"><button class="btn secondary grow" id="gps-beacon">${ic("pin")} Balise</button>
                <button class="btn primary grow" id="gps-start">${ic("route")} Démarrer</button></div>
               <p class="help"><b>Balise</b> : un point maintenant, même sans réseau. <b>Suivi</b> : trace continue, écran allumé. Pour une belle trace de rando, une montre ou une appli puis « Importer un GPX » reste la meilleure option.</p>`}
      </div>
      <div class="row between" style="margin:18px 0 6px"><span class="kicker">Traces · ${S.cur.tracks.length}</span>
        <div class="row"><button class="btn sm" id="gpx-import">${ic("upload", "sm")} Importer un GPX</button>${S.cur.tracks.length ? `<button class="btn sm ghost" id="gpx-export">${ic("download", "sm")}</button>` : ""}</div>
        <input type="file" id="gpx-file" accept=".gpx,application/gpx+xml" multiple hidden></div>
      ${S.cur.tracks.length ? "" : `<p class="help">Aucune trace pour l'instant : pose des balises, démarre un suivi ou importe un GPX (montre, Strava, Komoot…).</p>`}
      ${[...S.cur.tracks].reverse().map((t) => `<div class="track-item" data-id="${t.id}"><span class="swatch" style="background:${CV.colorForDay(dl, t.day_date)}"></span>
        <span class="grow" style="min-width:0"><span style="display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name || "Trace")}</span><span class="small muted">${t.day_date ? fmtDate(t.day_date, false) : "sans date"} · ${t.points.length} pts · ${t.source === "gpx" ? "GPX" : t.source === "manual" ? "balises" : t.source === "route" ? "itinéraire estimé" : "suivi"}${t._pending ? ` · <span class="chip draft">à envoyer</span>` : ""}</span></span>
        <span class="dist">${fmtDistance(t.distance_m)}</span>${ic("chevron-right", "sm")}</div>`).join("")}`;
    const st = $("#gps-start", body); if (st) st.onclick = startRecording;
    const sp = $("#gps-stop", body); if (sp) sp.onclick = stopRecording;
    const bc = $("#gps-beacon", body); if (bc) bc.onclick = addBeacon;
    const wk = $("#wake", body); if (wk) wk.onchange = () => wk.checked ? requestWake() : releaseWake();
    $("#gpx-import", body).onclick = () => $("#gpx-file", body).click();
    $("#gpx-file", body).onchange = (e) => importGpx([...e.target.files]);
    const ex = $("#gpx-export", body); if (ex) ex.onclick = () => CV.download(`${S.cur.trip.title}.gpx`, CV.toGPX(S.cur.trip, S.cur.tracks), "application/gpx+xml");
    $$(".track-item", body).forEach((el) => el.onclick = () => trackForm(S.cur.tracks.find((t) => t.id === el.dataset.id)));
  }
  function elapsed(t0) {
    if (!t0) return "–";
    const s = Math.floor((Date.now() - t0) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
  }

  // --- Enregistrement continu (fonctionne sans réseau : la trace vit sur le téléphone jusqu'à l'envoi) ---
  const REC_KEY = "cv_recording";
  async function startRecording() {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible", "error");
    const g = S.gps;
    g.track = { id: OFF.localId(), trip_id: S.cur.trip.id, name: "Suivi " + fmtTime(Date.now()), day_date: today(), source: "gps", points: [], distance_m: 0, created_at: new Date().toISOString(), _pending: true };
    S.cur.tracks.push(g.track);
    g.points = []; g.startedAt = Date.now(); g.dirty = true; g.lastSaved = 0; g.lastFix = Date.now(); g.errAt = 0;
    persistRecording();
    g.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    requestWake();
    g.watchdog = setInterval(checkGpsAlive, 30000);
    toast("Suivi démarré — garde l'app à l'écran", "ok"); renderPanel(); renderRecBar();
    if (navigator.onLine) syncAll();
  }
  function onPositionError(e) {
    const g = S.gps;
    if (Date.now() - g.errAt < 120000) return;       // pas plus d'un message toutes les 2 min (tunnel, forêt…)
    g.errAt = Date.now();
    toast(e.code === 1 ? "Localisation refusée : autorise-la dans les réglages du téléphone" : "Signal GPS faible, on continue d'essayer…", "error");
  }
  function onPosition(p) {
    const g = S.gps, c = p.coords;
    g.lastFix = Date.now();
    if (c.accuracy > 100) return;                // point trop imprécis
    const pt = { lat: +c.latitude.toFixed(6), lng: +c.longitude.toFixed(6), t: p.timestamp || Date.now() };
    if (c.altitude != null) pt.alt = Math.round(c.altitude);
    showMe(pt.lat, pt.lng);
    const last = g.points[g.points.length - 1];
    if (last) {
      const dist = CV.haversine(last, pt), dt = (pt.t - last.t) / 1000;
      if (dist < (cfg.GPS_MIN_DISTANCE_M || 25) || dt < (cfg.GPS_MIN_INTERVAL_S || 20)) return;
    }
    g.points.push(pt); g.dirty = true;
    g.track.points = g.points; g.track.distance_m = CV.trackDistance(g.points); g.track._pending = true;
    persistRecording();
    if (S.tab === "gps") { const d = $("#st-dist"), n = $("#st-pts"), t = $("#st-time"); if (d) { d.textContent = fmtDistance(g.track.distance_m); n.textContent = g.points.length; t.textContent = elapsed(g.startedAt); } }
    renderRecBar();
    if (g.points.length % 5 === 0) redraw();
    if (Date.now() - g.lastSaved > 60000) flushRecording();
  }
  function checkGpsAlive() {
    const g = S.gps; if (g.watchId == null) return;
    const silent = Math.round((Date.now() - g.lastFix) / 60000);
    const bar = $("#rec-bar");
    if (silent >= 3) {
      if (bar) bar.classList.add("warn");
      if (silent % 5 === 3) toast(`⚠️ Aucune position depuis ${silent} min — l'app est-elle bien restée à l'écran ?`, "error", 8000);
    } else if (bar) bar.classList.remove("warn");
    if (document.visibilityState === "visible" && !g.wakeLock) requestWake();
  }
  // Barre d'enregistrement toujours visible, quel que soit l'onglet
  function renderRecBar() {
    const g = S.gps, bar = $("#rec-bar");
    if (!bar) return;
    if (g.watchId == null) { bar.hidden = true; return; }
    bar.hidden = false;
    if (S.tab === "gps") { bar.hidden = true; return; }
    bar.innerHTML = `<span class="pulse"></span> Suivi GPS · ${fmtDistance(CV.trackDistance(g.points))} · ${elapsed(g.startedAt)} <button class="btn sm danger" id="rec-bar-stop">${ic("stop", "sm")} Terminer</button>`;
    $("#rec-bar-stop", bar).onclick = stopRecording;
  }
  function persistRecording() {
    const g = S.gps;
    OFF.LS.set(REC_KEY, { tripId: S.cur.trip.id, trackId: g.track.id, startedAt: g.startedAt });
    saveLocal();
  }
  async function flushRecording() {
    const g = S.gps;
    if (!g.track || !g.dirty || !navigator.onLine) return;
    g.dirty = false;
    try {
      if (OFF.isLocalId(g.track.id)) { await syncAll(); return; }
      const saved = await API.updateTrack(g.track.id, { points: g.points, distance_m: CV.trackDistance(g.points) });
      g.track._pending = false; g.lastSaved = Date.now();
      const i = S.cur.tracks.findIndex((t) => t.id === saved.id); if (i >= 0) { S.cur.tracks[i] = { ...saved, _pending: false }; g.track = S.cur.tracks[i]; g.track.points = g.points; }
      saveLocal();
    } catch { g.dirty = true; /* on réessaiera */ }
  }
  async function stopRecording() {
    const g = S.gps;
    if (g.watchId != null) navigator.geolocation.clearWatch(g.watchId);
    g.watchId = null; releaseWake();
    if (g.watchdog) { clearInterval(g.watchdog); g.watchdog = null; }
    const track = g.track, n = g.points.length, dist = CV.trackDistance(g.points);
    OFF.LS.del(REC_KEY);
    if (n === 0) {
      S.cur.tracks = S.cur.tracks.filter((t) => t !== track);
      if (!OFF.isLocalId(track.id)) { try { await API.deleteTrack(track.id); } catch { } }
      toast("Aucun point relevé : trace ignorée");
    } else {
      track.points = g.points; track.distance_m = dist; track._pending = true;
      g.dirty = true;
      if (navigator.onLine) {
        try {
          const saved = OFF.isLocalId(track.id)
            ? await API.createTrack(S.user, S.cur.trip.id, { name: track.name, day_date: track.day_date, source: "gps", points: g.points, distance_m: dist })
            : await API.updateTrack(track.id, { points: g.points, distance_m: dist });
          const i = S.cur.tracks.indexOf(track); if (i >= 0) S.cur.tracks[i] = saved;
          toast(`Trace enregistrée : ${fmtDistance(dist)}`, "ok");
        } catch (err) { S.offline = true; toast(`Trace gardée sur le téléphone (${fmtDistance(dist)}) : envoi au retour du réseau`, "info", 6000); }
      } else { S.offline = true; toast(`Trace gardée sur le téléphone (${fmtDistance(dist)}) : envoi au retour du réseau`, "info", 6000); }
    }
    g.track = null; g.points = []; g.startedAt = null; g.dirty = false;
    saveLocal(); renderTripHeader(); redraw(); renderPanel(); renderRecBar(); updatePendingChip();
  }
  // Reprise après fermeture accidentelle de l'app pendant un suivi : la trace est dans la copie locale
  function resumeRecordingIfAny() {
    const saved = OFF.LS.get(REC_KEY);
    if (!saved || saved.tripId !== S.cur.trip.id) return;
    const track = S.cur.tracks.find((t) => t.id === saved.trackId);
    OFF.LS.del(REC_KEY);
    if (track && (track.points || []).length) { track._pending = true; toast(`Suivi interrompu retrouvé (${fmtDistance(track.distance_m)}) : il sera envoyé automatiquement`, "info", 6000); }
  }
  async function requestWake() {
    if (!("wakeLock" in navigator) || S.gps.wakeLock) return;
    try { S.gps.wakeLock = await navigator.wakeLock.request("screen"); S.gps.wakeLock.addEventListener("release", () => { S.gps.wakeLock = null; }); }
    catch { /* non supporté */ }
  }
  function releaseWake() { if (S.gps.wakeLock) { S.gps.wakeLock.release(); S.gps.wakeLock = null; } }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { if (S.gps.watchId != null && !S.gps.wakeLock && ($("#wake")?.checked ?? true)) requestWake(); syncAll(); }
    if (document.visibilityState === "hidden") { flushRecording(); saveLocal(); }
  });

  // --- Balise : un seul point, relié aux balises du jour — fonctionne sans réseau ---
  function addBeacon() {
    if (!navigator.geolocation) return toast("Géolocalisation indisponible", "error");
    toast("Recherche de la position…");
    navigator.geolocation.getCurrentPosition(async (p) => {
      const pt = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), t: p.timestamp || Date.now() };
      if (p.coords.altitude != null) pt.alt = Math.round(p.coords.altitude);
      showMe(pt.lat, pt.lng);
      if (navigator.vibrate) navigator.vibrate([12, 40, 18]);
      const bb = $("#btn-beacon"); if (bb) { bb.classList.remove("pop"); void bb.offsetWidth; bb.classList.add("pop"); }
      try { BVMAP.ping(S.map, pt.lat, pt.lng); } catch { }
      const d = today();
      let tr = S.cur.tracks.find((t) => t.source === "manual" && t.day_date === d);
      if (tr) { tr.points = [...tr.points, pt]; tr.distance_m = CV.trackDistance(tr.points); tr._pending = true; }
      else { tr = { id: OFF.localId(), trip_id: S.cur.trip.id, name: "Balises", day_date: d, source: "manual", points: [pt], distance_m: 0, created_at: new Date().toISOString(), _pending: true }; S.cur.tracks.push(tr); }
      saveLocal(); renderTripHeader(); redraw(); renderPanel(); updatePendingChip();
      if (navigator.onLine) { await syncAll(); const still = S.cur.tracks.some((t) => t.source === "manual" && t.day_date === d && t._pending); toast(still ? "Balise gardée sur le téléphone, envoi au retour du réseau" : "Balise posée", "ok"); }
      else { S.offline = true; toast("Balise gardée sur le téléphone, envoi au retour du réseau", "ok"); }
    }, (e) => toast(e.code === 1 ? "Localisation refusée : autorise-la dans les réglages du téléphone" : "Position introuvable pour l'instant, réessaie dans un instant", "error"), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  // --- Import GPX ---
  async function importGpx(files) {
    for (const f of files) {
      try {
        const { name, points } = CV.parseGPX(await f.text());
        const first = points.find((p) => p.t);
        const tr = await API.createTrack(S.user, S.cur.trip.id, { name: name || f.name.replace(/\.gpx$/i, ""), day_date: first ? isoDate(new Date(first.t)) : (S.dayFilter || today()),
          source: "gpx", points, distance_m: CV.trackDistance(points) });
        S.cur.tracks.push(tr); toast(`${tr.name} importée (${fmtDistance(tr.distance_m)})`, "ok");
      } catch (err) { toast(`${f.name} : ${friendly(err)}`, "error", 5000); }
    }
    saveLocal(); renderTripHeader(); redraw(true); renderPanel();
  }
  function trackForm(tr) {
    const m = openModal(`<h2>Trace</h2><form id="f">
      <div class="field"><label>Nom</label><input name="name" value="${esc(tr.name || "")}"></div>
      <div class="field"><label>Journée</label><input type="date" name="day_date" value="${tr.day_date || ""}"></div>
      <p class="small muted">${tr.points.length} points · ${fmtDistance(tr.distance_m)} · source : ${tr.source}</p>
      <div class="actions"><button type="button" class="btn danger" id="del">Supprimer</button><span class="grow"></span><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">Enregistrer</button></div></form>`);
    $("#f", m.el).onsubmit = async (e) => {
      e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target));
      try {
        if (OFF.isLocalId(tr.id)) { tr.name = fd.name; tr.day_date = fd.day_date || null; }
        else Object.assign(tr, await API.updateTrack(tr.id, { name: fd.name, day_date: fd.day_date || null }));
        saveLocal(); m.close(); redraw(); renderPanel();
      } catch (err) { errToast(err); }
    };
    $("#del", m.el).onclick = async () => {
      if (!(await confirm("Supprimer cette trace ?"))) return;
      try { if (!OFF.isLocalId(tr.id)) await API.deleteTrack(tr.id); S.cur.tracks = S.cur.tracks.filter((t) => t.id !== tr.id); saveLocal(); m.close(); renderTripHeader(); redraw(); renderPanel(); updatePendingChip(); }
      catch (err) { errToast(err); }
    };
  }

  // ---------- Sauvegarde complète ----------
  async function backup(withFiles, btn) {
    if (!window.JSZip) return toast("Module de compression non chargé (pas de réseau ?)", "error");
    const { trip, days, tracks, media, comments } = S.cur;
    busy(btn, true);
    try {
      const zip = new JSZip();
      const safe = (s) => String(s || "").replace(/[^\w\u00C0-\u024F .-]+/g, "_").trim();
      const root = zip.folder(safe(trip.title) || "voyage");
      root.file("voyage.json", JSON.stringify({ exporte_le: new Date().toISOString(), trip, days, tracks, media, comments,
        membres: S.members, recits_des_co_auteurs: S.stories, carnet_de_bord: S.notes, mots_du_jour: S.voices }, null, 2));
      if (tracks.length) root.file("traces.gpx", CV.toGPX(trip, tracks));
      // Récit lisible en texte
      let txt = `${trip.title}\n${trip.subtitle || ""}\n\n${trip.description || ""}\n\n`;
      for (const iso of allDays()) {
        const d = dayInfo(iso); const n = dayNumber(trip, iso);
        txt += `\n==== ${n ? "Jour " + n + " — " : ""}${fmtDate(iso)}${d?.title ? " — " + d.title : ""} ====\n\n${d?.story || ""}\n`;
        if (d && MEMBERS.name(d.author_id) && MEMBERS.isShared()) txt += `   (journée de ${MEMBERS.name(d.author_id)})\n`;
        for (const st of S.stories.filter((x) => x.day_date === iso)) txt += `\n   — récit de ${MEMBERS.name(st.author_id) || "?"} —\n${st.body}\n`;
        for (const nt of S.notes.filter((x) => x.day_date === iso)) txt += `\n   [carnet de bord · ${MEMBERS.name(nt.author_id) || "?"}] ${nt.body}\n`;
        for (const v of S.voices.filter((v) => v.day_date === iso)) txt += `   🎙 mot du jour de ${MEMBERS.name(v.author_id) || "?"}\n`;
        for (const x of media.filter((x) => x.day_date === iso)) txt += `\n[${x.kind}] ${x.path.split("/").pop()}${MEMBERS.name(x.author_id) ? " par " + MEMBERS.name(x.author_id) : ""}${x.caption ? " — " + x.caption : ""}${x.lat != null ? ` (${x.lat}, ${x.lng})` : ""}\n`;
        for (const c of comments.filter((c) => (c.day_id && c.day_id === d?.id) || media.some((x) => x.day_date === iso && x.id === c.media_id))) txt += `   💬 ${c.author} : ${c.body}${c.audio_path ? " [audio]" : ""}\n`;
      }
      root.file("recit.txt", txt);
      if (withFiles) {
        const files = [];
        for (const x of media) { files.push([`photos/${x.day_date || "sans-date"}/${x.path.split("/").pop()}`, x.path]); if (x.audio_path) files.push([`audios/photo-${x.audio_path.split("/").pop()}`, x.audio_path]); }
        for (const d of days) if (d.audio_path) files.push([`audios/recit-${d.day_date}-${d.audio_path.split("/").pop()}`, d.audio_path]);
        for (const v of S.voices) files.push([`audios/mot-du-jour-${v.day_date}-${safe(MEMBERS.name(v.author_id))}.${(v.audio_path.split(".").pop() || "m4a")}`, v.audio_path]);
        for (const c of comments) if (c.audio_path) files.push([`audios/commentaire-${safe(c.author)}-${c.audio_path.split("/").pop()}`, c.audio_path]);
        let i = 0;
        for (const [name, path] of files) {
          i++; btn.textContent = `Téléchargement ${i}/${files.length}…`;
          try { const r = await fetch(API.publicUrl(path)); if (r.ok) root.file(name, await r.blob()); } catch { /* fichier manquant, on continue */ }
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${safe(trip.title) || "voyage"}-sauvegarde-${today()}.zip`; a.click();
      toast("Sauvegarde téléchargée", "ok");
    } catch (err) { toast("Sauvegarde impossible : " + friendly(err), "error"); }
    busy(btn, false);
  }

  // ---------- Partage ----------
  function shareUrl() {
    const base = location.href.split("#")[0].replace(/index\.html$/, "");
    return `${base}share.html?t=${S.cur.trip.share_token}`;
  }
  function shareModal() {
    const t = S.cur.trip, url = shareUrl();
    const m = openModal(`<h2>Partager avec tes proches</h2>
      <p class="small muted">Ils ouvrent simplement ce lien dans leur navigateur : pas de compte, rien à installer. Le lien est secret — ne le publie pas en public.</p>
      <div class="share-box"><input readonly value="${esc(url)}" id="su"><div class="row" style="margin-top:8px">
        <button class="btn sm primary" id="copy">Copier le lien</button>${navigator.share ? `<button class="btn sm" id="nshare">${ic("send", "sm")} Envoyer</button>` : ""}<a class="btn sm ghost" href="${esc(url)}" target="_blank">Aperçu</a></div>
        <div class="row" style="margin-top:10px"><button class="btn sm ghost" id="named-links">${ic("share", "sm")} Plutôt un lien par personne…</button></div></div>
      ${cfg.VAPID_PUBLIC_KEY ? `<p class="small muted" id="push-count" style="margin-top:12px">…</p>` : ""}
      <label class="row" style="margin-top:16px"><input type="checkbox" id="is_shared" ${t.is_shared ? "checked" : ""}> Lien de partage actif</label>
      <label class="row" style="margin-top:8px"><input type="checkbox" id="allow_comments" ${t.allow_comments ? "checked" : ""}> Autoriser les commentaires des proches</label>
      <div class="actions" style="margin-top:16px"><button class="btn" data-close>Fermer</button></div>`);
    $("#copy", m.el).onclick = async () => { try { await navigator.clipboard.writeText(url); toast("Lien copié", "ok"); } catch { $("#su", m.el).select(); } };
    $("#named-links", m.el).onclick = () => { m.close(); openAccess(); };
    const pc = $("#push-count", m.el);
    if (pc) API.countPushSubscriptions(t.id).then((n) => { pc.textContent = n ? `${n} proche${n > 1 ? "s reçoivent" : " reçoit"} une notification à chaque journée publiée.` : "Personne n'a encore activé les notifications (bouton « Me prévenir » sur la page du voyage)."; }).catch(() => { pc.textContent = ""; });
    const ns = $("#nshare", m.el); if (ns) ns.onclick = () => navigator.share({ title: t.title, text: "Suis mon voyage : " + t.title, url }).catch(() => { });
    for (const k of ["is_shared", "allow_comments"]) $("#" + k, m.el).onchange = async (e) => {
      try { S.cur.trip = await API.updateTrip(t.id, { [k]: e.target.checked }); saveLocal(); toast("Réglage enregistré", "ok"); } catch (err) { errToast(err); }
    };
  }

  // ---------------------------------------------------------------
  //  Démarrage
  // ---------------------------------------------------------------
  function setOnline() { $("#offline").hidden = navigator.onLine; if (navigator.onLine) { flushRecording(); syncAll(); } }
  window.addEventListener("online", setOnline); window.addEventListener("offline", setOnline); setOnline();
  window.addEventListener("beforeunload", (e) => { if (S.gps.watchId != null) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- Onboarding (première ouverture) ----------
  const ONB_KEY = "bv_onboarded";
  function onboarding(force) {
    if (!force && OFF.LS.get(ONB_KEY)) return;
    if ($("#modal-host .onb")) return;      // v10.1 — déjà à l'écran : on n'en empile pas un second
    OFF.LS.set(ONB_KEY, true);              // v10.1 — marqué dès l'ouverture, plus à la fermeture
    const slides = [
      { hand: "Bienvenue !", title: "Ton voyage sur une carte", text: "Pose une balise 📍 à chaque étape, importe la trace de ta montre (GPX), ajoute tes photos : elles se placent toutes seules grâce à leur date et leur position." },
      { hand: "Chaque soir…", title: "Raconte ta journée", text: "Un titre, quelques lignes ou un récit dicté au micro 🎙, une légende ou un mot audio sur chaque photo. Tout reste en brouillon jusqu'à ce que tu appuies sur « Publier »." },
      { hand: "Et tes proches ?", title: "Ils suivent sans rien installer", text: "Un lien secret, envoyé par WhatsApp à chaque journée publiée. Ils voient la carte, les photos, entendent ta voix, et te laissent un mot écrit ou vocal. Tu retrouves leurs messages ici, avec un badge." },
    ];
    let i = 0;
    const m = openModal(`<div class="onb">
      <img src="icons/valdo.svg" alt="Valdo" class="valdo-scene">
      <div class="slides">${slides.map((s, k) => `<div class="slide${k === 0 ? " active" : ""}"><span class="hand">${esc(s.hand)}</span><h2>${esc(s.title)}</h2><p>${esc(s.text)}</p></div>`).join("")}</div>
      <div class="dots">${slides.map((_, k) => `<i class="${k === 0 ? "on" : ""}"></i>`).join("")}</div>
      <div class="actions"><button type="button" class="btn ghost" id="onb-skip">Passer</button><button type="button" class="btn primary" id="onb-next">Suivant →</button></div>
    </div>`);
    const show = () => { $$(".slide", m.el).forEach((s, k) => s.classList.toggle("active", k === i)); $$(".dots i", m.el).forEach((d, k) => d.classList.toggle("on", k === i)); $("#onb-next", m.el).textContent = i === slides.length - 1 ? "C'est parti !" : "Suivant →"; };
    $("#onb-next", m.el).onclick = () => { if (i < slides.length - 1) { i++; show(); } else m.close(); };
    $("#onb-skip", m.el).onclick = () => m.close();
  }
  $("#btn-onboarding").onclick = () => onboarding(true);
  // Bouton thème : auto → clair → sombre
  const themeBtn = $("#btn-theme");
  const themeLabel = () => { const p = THEME.pref(); themeBtn.innerHTML = ic(p === "dark" ? "moon" : p === "light" ? "sun" : "auto"); themeBtn.title = "Thème : " + (p === "auto" ? "automatique (suit le téléphone)" : p === "dark" ? "sombre" : "clair"); };
  themeBtn.onclick = () => { const p = THEME.cycle(); themeLabel(); toast("Thème " + (p === "auto" ? "automatique" : p === "dark" ? "sombre" : "clair")); };
  themeLabel();
  function hideSplash() { const s = $("#splash"); if (s) { s.classList.add("hide"); setTimeout(() => s.remove(), 400); } }

  async function boot() {
    if (cfg.APP_NAME && cfg.APP_NAME !== "Bonvoyage") $("#auth-app-name").textContent = cfg.APP_NAME;
    document.title = cfg.APP_NAME || "Bonvoyage";
    if (!API.isConfigured()) { $("#setup-help").hidden = false; $("#auth-card").hidden = true; show("screen-auth"); hideSplash(); return; }
    const ver = $("#app-version"); if (ver) ver.textContent = `Bonvoyage v${window.BV_VERSION || "?"}`;
    // Mise à jour automatique : quand une nouvelle version est installée, la page se recharge d'elle-même (une fois)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then((reg) => reg.update().catch(() => { })).catch(() => { });
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (reloaded || !navigator.serviceWorker.controller) return; reloaded = true; if (S.gps.watchId == null) location.reload(); });
    }

    // Lien d'invitation : index.html?join=<jeton>. On traite cet écran avant tout
    // le reste — l'invité n'a pas encore de compte, il n'y a rien à charger.
    const joinToken = new URLSearchParams(location.search).get("join");
    if (joinToken) {
      show("screen-join"); hideSplash();
      MEMBERS.joinScreen(joinToken, {
        api: API,
        onCancel: () => { location.replace(location.pathname); },
        onJoined: (tripId) => { location.replace(location.pathname + "#trip=" + tripId); location.reload(); },
      });
      return;
    }

    const onUser = async (user) => {
      const wasUser = S.user; S.user = user;
      if (!user) { S.cur = null; show("screen-auth"); hideSplash(); return; }
      // v10.1 — le « && S.cur » de la v9 ne couvrait pas l'écran « Mes voyages », où S.cur est vide :
      // chaque événement d'authentification y rejouait tout l'écran et empilait un onboarding de plus.
      if (wasUser && wasUser.id === user.id) return;   // simple rafraîchissement de jeton
      const hash = new URLSearchParams(location.hash.slice(1));
      if (hash.get("trip")) openTrip(hash.get("trip")); else { show("screen-trips"); loadTrips(); }
      hideSplash();
      setTimeout(() => onboarding(false), 400);
    };
    // Lien "mot de passe oublié" : Supabase renvoie avec type=recovery
    if (location.hash.includes("type=recovery")) {
      history.replaceState(null, "", location.pathname);
      const m = openModal(`<h2>Nouveau mot de passe</h2><form id="f">
        <div class="field"><label>Mot de passe (6 caractères minimum)</label><input type="password" name="p1" minlength="6" required autocomplete="new-password"></div>
        <div class="field"><label>Confirme-le</label><input type="password" name="p2" minlength="6" required autocomplete="new-password"></div>
        <div class="actions"><button class="btn primary" type="submit">Changer</button></div></form>`);
      $("#f", m.el).onsubmit = async (e) => {
        e.preventDefault(); const f = e.target;
        if (f.p1.value !== f.p2.value) return toast("Les deux mots de passe sont différents", "error");
        try { await API.updatePassword(f.p1.value); toast("Mot de passe changé", "ok"); m.close(); } catch (err) { errToast(err); }
      };
    }
    API.onAuthChange(onUser);
    onUser(await API.getUser());
  }
  boot();
  setTimeout(hideSplash, 6000);
  window.__S = S; // (debug)
})();
