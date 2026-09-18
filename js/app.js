// ============================================================
//  Carnet de Voyage — application principale (côté propriétaire)
// ============================================================
(function () {
  const { cfg, esc, nl2p, toast, fmtDate, fmtDateShort, fmtTime, fmtDistance, dayNumber, today, isoDate, ic } = CV;
  const { friendly, isNetworkError } = OFF;
  const errToast = (err, ms) => toast(friendly(err), "error", ms);
  // #51 - Un accusé de réception NOMME ce qui vient d'être gardé : « Photo 2 : à pied,
  // enregistré ». Un message qui cite la chose ne peut pas mentir. Il ne se construit
  // que depuis la liste de ce qui est réellement parti, et jamais après un échec.
  const FEMININ = new Set(["légende", "journée", "heure"]);
  const listeFr = (mots) => mots.length < 2 ? (mots[0] || "") : mots.slice(0, -1).join(", ") + " et " + mots[mots.length - 1];
  const accuse = (quoi, mots) => `${quoi} : ${listeFr(mots)}, ${mots.length > 1 ? "enregistrés" : FEMININ.has(mots[0]) ? "enregistrée" : "enregistré"}`;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // #1 · Chaque écran prend la taille qui correspond à ce qu'il affiche vraiment (v10.36).
  //   thumbSrc · 192 px : pastilles de la carte et petites vignettes (au plus 168 px réels)
  //   gridSrc  · 768 px : grille des photos et couverture de journée (jusqu'à 1200 px réels)
  // Les photos d'avant la v10.36 n'ont pas de vignette de grille : elles retombent sur
  // l'ancienne vignette, donc elles s'affichent exactement comme aujourd'hui.
  const thumbSrc = (m) => API.publicUrl(m.thumb_path || (m.kind === "photo" ? m.path : ""));
  const gridSrc = (m) => API.publicUrl(m.grid_path || m.thumb_path || (m.kind === "photo" ? m.path : ""));

  const S = {
    user: null, trips: [], cur: null,      // cur = { trip, days, tracks, media, comments }
    map: null, drawn: null, meMarker: null,
    tab: "days", dayFilter: null, placing: null, stopping: null,
    gps: { watchId: null, track: null, points: [], lastSaved: 0, dirty: false, startedAt: null, wakeLock: null, lastFix: 0, watchdog: null, errAt: 0 },
    offline: false, syncing: false, pendingMedia: [],
    members: [], voices: [], stories: [], notes: [],   // v10 : l'équipage et les contributions signées
    stops: [],                                        // v10.8 : les arrêts d'une journée (#5)
    camps: [],                                        // v10.40 : les camps de base, où l'on dort (#38)
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
  function openModal(html, { wide = false, onClose, guard, guardText } = {}) {
    const host = $("#modal-host");
    const back = document.createElement("div");
    back.className = "modal-back";
    back.innerHTML = `<div class="modal${wide ? " wide" : ""}">${html}</div>`;
    host.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); onClose && onClose(); };
    // #72 · la phrase de la question est FACULTATIVE : sans elle, celle d'avant, et les
    // fenêtres qui protégeaient déjà ne changent pas d'un mot. Une fenêtre qui sait NOMMER
    // ce qu'elle va perdre la fournit — et la construit depuis sa liste de champs, jamais
    // à côté d'elle. Une phrase vide retombe sur la phrase générale.
    const tryClose = async () => {
      const dit = (guardText && guardText()) || "Tu as des modifications non enregistrées. Fermer quand même ?";
      if (guard && guard() && !(await confirm(dit, "Fermer sans enregistrer"))) return;
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
  // Comme confirm(), mais pour une action qui n'est pas une suppression : bouton
  // principal en bleu, contenu libre (une liste, par exemple) et les deux libelles
  // se choisissent.
  function ask(html, okLabel, cancelLabel = "Annuler") {
    return new Promise((res) => {
      const m = openModal(`${html}<div class="actions"><button class="btn" data-close>${esc(cancelLabel)}</button><button class="btn primary" id="ok">${esc(okLabel)}</button></div>`,
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
          ${BVMAP.SPEEDS.map((s) => `<option value="${s.k}" ${(+trip.replay_speed || 1) === s.k ? "selected" : ""}>${s.icon} ${s.label}</option>`).join("")}</select></div>
        ` : ""}
        <div class="field"><label>Introduction (affichée en haut du récit)</label><textarea name="description" placeholder="Pourquoi ce voyage, avec qui, l'état d'esprit du départ…">${esc(trip?.description || "")}</textarea></div>
        ${!isNew ? `<div class="field"><label>Photo de couverture</label><select name="cover_path"><option value="">— aucune —</option>
          ${(S.cur?.media || []).filter((x) => x.kind === "photo").map((x) => `<option value="${esc(x.path)}" ${x.path === trip.cover_path ? "selected" : ""}>${esc(x.caption || fmtDate(x.day_date, false) || "photo")}</option>`).join("")}</select></div>` : ""}
        ${!isNew ? `<div class="field"><label>Qui a accès</label>
          <button type="button" class="btn sm" id="access">${ic("share", "sm")} Co-auteurs et liens des proches</button>
          <span class="small muted">Inviter quelqu'un à écrire dans ce carnet, et gérer les liens envoyés aux proches.</span></div>` : ""}
        ${!isNew ? `<div class="field"><label>Sauvegarde</label><div class="row"><button type="button" class="btn sm" id="backup">${ic("download", "sm")} Sauvegarde complète</button><button type="button" class="btn sm ghost" id="backup-light">Texte et traces seulement</button></div>
          <span class="small muted">Télécharge un fichier .zip avec ton récit, tes traces (GPX), tes photos, audios et les commentaires. À faire de temps en temps, et à la fin du voyage.</span></div>` : ""}
        <!-- 🔴 v10.50 · BARRE COLLANTE, comme toutes les fenêtres longues du projet.
             C'était la SEULE fenêtre longue à ne pas l'avoir : ses onze champs poussaient
             « Annuler » et « Enregistrer » à 177 px sous le bas de l'écran, et rien ne disait
             que la fenêtre se déroulait. En y ajoutant l'essai d'épaisseur, j'ai porté ce
             chiffre à 340 px et Sophie s'est retrouvée enfermée dans ses propres réglages. -->
        <div class="actions sticky">
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
    S.cur.stops = S.cur.stops || [];   // une base pas encore mise à jour n'en renvoie pas : le carnet marche quand même
    S.cur.camps = S.cur.camps || [];   // idem pour les camps de base (#38)
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
    // #22 : rattrapage — les traces déjà en base sans aucune altitude sont complétées ici, en arrière-plan
    if (navigator.onLine && !S.offline) CV.fillElevations(S.cur, enrichElevation).catch(() => { });
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
  // #22 : complète en douceur l'altitude d'une trace qui n'en a aucune (relief déduit des tuiles DEM).
  // Ne fait rien si la trace n'est plus modifiable (droits) ou pas encore synchronisée (id local, hors ligne).
  async function enrichElevation(t, pts) {
    if (!canEdit(t) || t._pending || OFF.isLocalId(t.id)) return;
    const distance_m = CV.trackDistance(pts);
    const u = await API.updateTrack(t.id, { points: pts, distance_m });
    Object.assign(t, u); saveLocal(); redraw(); if (S.tab === "days") renderPanel();
  }
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
          else {
            fields.path = await up(pm.big, "jpg");
            // pm.grid manque aux photos mises en attente par une version antérieure à la v10.36 :
            // elles partent alors comme avant, sans vignette de grille.
            // Inutile d'envoyer un fichier que la base ne saura pas référencer : une fois
            // la colonne connue comme absente, on s'épargne le fichier orphelin.
            if (pm.grid && !API._noGridColumn) fields.grid_path = await up(pm.grid, "jpg");
            fields.thumb_path = await up(pm.thumb, "jpg");
          }
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
    const kmTot = CV.tripDistance(S.cur, allDays());   // #38 · même règle que les journées
    $("#trip-sub").textContent = [t.start_date ? fmtDate(t.start_date, false) : "", CV.fmtDayDistance(kmTot), S.cur.media.length ? S.cur.media.length + " photos" : ""].filter(Boolean).join(" · ");
  }

  // ---------- Carte ----------
  function ensureMap() {
    if (S.map) return;
    S.map = BVMAP.create("map", { controlsPos: "bottom-right", switcherClass: "in-app" });
    BVMAP.onClick(S.map, (e) => {
      // Poser un arrêt : on demande à OpenStreetMap ce qu'il y a là, puis Sophie choisit.
      if (S.stopping) {
        const iso = S.stopping; S.stopping = null;
        BVMAP.setCursor(S.map, "");
        stopFromPoint(iso, e);
        return;
      }
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
    $("#btn-locate").onclick = () => locateMe(true);
    $("#btn-beacon").onclick = () => addBeacon();
  }
  function redraw(fitAfter = false) {
    S.drawn = BVMAP.draw(S.map, S.cur, {
      dayFilter: S.dayFilter, dayList: allDays(),
      thumbUrl: thumbSrc,
      dayNumber: (iso) => dayNumber(S.cur.trip, iso),
      onMediaClick: (m) => mediaViewer(m),
      onTrackClick: (tr) => trackForm(tr),
      onDayClick: (iso) => { if (navigator.vibrate) navigator.vibrate(8); S.dayFilter = S.dayFilter === iso ? null : iso; redraw(true); renderPanel(); },
      onStopClick: (st) => stopForm(st.day_date, st),
      onCampClick: (c) => campForm(c.night_date, () => renderPanel()),
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
    // Le panneau replié change la hauteur de la carte : on la recale avant de lancer l'animation, sinon Valdo est décalé du tracé
    setTimeout(() => BVMAP.resize(S.map), 300);
    setTimeout(() => BVMAP.replay(S.map, S.cur, {
      // #61 · La caméra se cadre par SÉQUENCE : un tronçon en avion fait la sienne, ce qui
      // vient après en fait une autre. Choisi au doigt par Sophie le 18/09 sur son Jour 1
      // d'Algarve — variante A, le recul d'aujourd'hui. Le récit, les titres, la carte et la
      // fiche du survol ne changent pas : seule la caméra se coupe.
      sequences: true,
      dayList: allDays(), only, speed: () => tripSpeed(), dayNumber: (iso) => dayNumber(S.cur.trip, iso),
      onPause: (p) => { pauseBtn.innerHTML = p ? `${ic("play", "sm")}` : `${ic("pause", "sm")}`; pauseBtn.title = p ? "Reprendre" : "Pause"; },
      // v10.47 · La distance vient de `CV.fmtDayDistance`, comme la liste des journées et la
      // fiche journée : même chiffre, même « ≈ ». Et `info.n != null`, parce qu'une journée
      // datée la veille du départ porte le numéro 0 — qui est faux en JavaScript (v10.42).
      onDay: (iso, info) => { const d = dayInfo(iso) || {}; const km = CV.fmtDayDistance(info.dist); $("#app-replay-caption").innerHTML = `<b>${info.n != null ? "Jour " + info.n : fmtDate(iso, false)}</b>${d.title ? ` · ${esc(d.title)}` : ""}${d.place ? `<span>${esc(d.place)}</span>` : ""}${km ? `<span>${km}</span>` : ""}`; },
      onDone: () => { $("#app-replay").hidden = true; if (opts.onDone) opts.onDone(); },
    }), 450);
  }
  // Vitesse du survol : un réglage du voyage, choisi par Sophie, appliqué aussi chez les proches
  function tripSpeed() { const v = +(S.cur && S.cur.trip.replay_speed); return BVMAP.SPEEDS.some((s) => s.k === v) ? v : 1; }
  // RÈGLE 10 · Ce bouton n'affichait qu'un animal, et son seul libellé était une infobulle —
  // qui ne s'affiche JAMAIS sur un écran tactile. Une seule pression changeait la vitesse du
  // survol et l'enregistrait pour Sophie ET pour tous ses proches, sans rien demander. Un doigt
  // qui a glissé à côté de « Revoir » a mis son carnet sur ×2 à son insu : toutes les durées
  // #40 · Le bouton qui faisait défiler la vitesse est parti. Une seule pression écrivait
  // un réglage pour Sophie ET pour tous ses proches ; il avait mis le carnet sur ×2 à son
  // insu (#45). La vitesse se choisit dans les réglages du voyage, à la liste, et nulle part
  // ailleurs. Ne pas remettre de raccourci.
  // #51 - La fiche-carte flottante d'une journée vieillit dès qu'on enregistre : elle
  // affichait « 0 photo » ou l'ancien titre longtemps après. Elle se redessine donc
  // seule, à la fin de renderPanel() — par où passent déjà tous les enregistrements
  // réussis. Aucune commande n'est retouchée : rien à relier à nouveau.
  function dayCardMeta(iso) {
    const d = dayInfo(iso), ph = S.cur.media.filter((x) => x.day_date === iso);
    return `${d?.place ? esc(d.place) + " · " : ""}${ph.length} photo${ph.length > 1 ? "s" : ""}${d?.story ? " · récit" : ""}`;
  }
  function refreshDayCard() {
    const card = $("#day-card"), iso = S.dayFilter;
    if (!card || card.hidden || !iso || !$("#dc-meta")) return;
    const d = dayInfo(iso), n = dayNumber(S.cur.trip, iso), num = $("#dc-num");
    if (num) { num.textContent = n != null ? "J" + n : fmtDateShort(iso); num.style.background = CV.colorForDay(allDays(), iso); }
    $("#dc-title").textContent = d?.title || fmtDate(iso, false);
    $("#dc-meta").innerHTML = dayCardMeta(iso);
  }

  // Ouvrir une journée : on la voit d'abord (survol de la journée), puis la carte flottante mène aux photos et au récit
  function openDay(iso) {
    const d = dayInfo(iso), n = dayNumber(S.cur.trip, iso);
    const ph = S.cur.media.filter((x) => x.day_date === iso);
    const hasPath = S.cur.tracks.some((t) => t.day_date === iso && (t.points || []).length >= 2) || ph.filter((x) => x.lat != null).length >= 2;
    if (S.map.replaying && S.map.stopReplay) S.map.stopReplay();
    S.dayFilter = iso; redraw(true); renderPanel();
    const card = $("#day-card");
    card.innerHTML = `<div class="dc-head"><span class="dc-num" id="dc-num" style="background:${CV.colorForDay(allDays(), iso)}">${n != null ? "J" + n : fmtDateShort(iso)}</span><div class="grow" style="min-width:0"><b id="dc-title">${esc(d?.title || fmtDate(iso, false))}</b><span class="small muted" id="dc-meta">${dayCardMeta(iso)}</span></div></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm primary" id="dc-open">${ic("photo", "sm")} Photos & récit</button><button type="button" class="btn sm" id="dc-stop" title="Toucher la carte à l'endroit de l'arrêt">${ic("pin", "sm")} Marquer un arrêt</button>${hasPath ? `<button type="button" class="btn sm" id="dc-replay">${ic("play", "sm")} Revoir</button>` : ""}<span class="grow"></span><button type="button" class="btn sm ghost" id="dc-all">Tout le voyage</button></div>`;
    card.hidden = false;
    $("#dc-open").onclick = () => dayForm(iso);
    // Marquer un arrêt : on arme le mode, puis c'est le doigt sur la carte qui décide
    $("#dc-stop").onclick = () => {
      if (S.map.replaying && S.map.stopReplay) S.map.stopReplay();
      S.stopping = iso; S.placing = null;
      BVMAP.setCursor(S.map, "crosshair");
      $("#panel").classList.add("collapsed");
      toast("Touche la carte à l'endroit de l'arrêt");
      setTimeout(() => BVMAP.resize(S.map), 280);
    };
    // #73 · la fiche n'a plus qu'UNE sortie. La croix muette d'avant appelait exactement
    // cette fonction, comme « Tout le voyage » : deux sorties pour une seule action, dans
    // une fiche de sept centimètres. Le mot était déjà là — c'est la croix qui est partie.
    const closeCard = () => { card.hidden = true; if (S.map.stopReplay && S.map.replaying) S.map.stopReplay(); S.dayFilter = null; redraw(true); renderPanel(); };
    $("#dc-all").onclick = closeCard;
    const rp = $("#dc-replay");
    const dayReplay = () => {
      if (S.map.replaying) { S.map.stopReplay(); return; }
      // Pendant le survol, la carte de journée s'efface pour laisser toute la place au tracé ; il reste « Arrêter » en bas
      card.hidden = true;
      startReplay(iso, { silent: true, onDone: () => { if (S.cur && S.dayFilter === iso) card.hidden = false; } });
    };
    if (rp) rp.onclick = dayReplay;
    // #40 · Le survol ne part plus tout seul. « Deux appareils, deux gestes, le même
    // obstacle » : celui qui veut revoir touche « Revoir », qui est juste là.
    $("#panel").classList.add("collapsed"); setTimeout(() => BVMAP.resize(S.map), 300);
  }
  // #70 · SUR LE RAIL ON DÉPLACE LA CAMÉRA ; dans le panneau et sur la fiche on change ce
  // qu'on regarde. Ce bouton cadre donc CE QUI EST DESSINÉ — le voyage entier hors filtre,
  // la journée seule quand une journée est ouverte, puisque `S.drawn` suit `S.dayFilter`.
  // Il ne touche jamais au filtre : un bouton de caméra ne change pas ce qui est à l'écran.
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
    refreshDayCard();   // #51 - la fiche-carte d'une journée ne reste jamais en retard
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
    (S.cur.stops || []).forEach((x) => x.day_date && set.add(x.day_date));
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
  // #30 - Un brouillon publiable par moi : exactement ce qui porte la puce
  // « Brouillon » dans la liste, et dont j'ai le droit de disposer (ma journee,
  // ou toutes si le carnet est a moi). En direct, rien n'est en brouillon.
  function myDraftDays(days) {
    if (isLive()) return [];
    return (days || allDays()).filter((iso) => {
      const d = dayInfo(iso);
      if (d?.published) return false;
      // Volontairement plus strict que canEdit() : celui-ci laisse passer les lignes
      // d'avant la v10 (author_id vide), que la base refuserait ensuite a un co-auteur.
      // Une action de masse ne doit pas promettre ce qui echouera ligne a ligne.
      if (!(isTripOwner() || !d || d.author_id === S.user.id)) return false;
      return !!d || S.cur.media.some((x) => x.day_date === iso) || S.cur.tracks.some((x) => x.day_date === iso);
    });
  }
  function renderDays(body) {
    const days = allDays();
    const dl = S.drawn ? S.drawn.dayList : days;
    const drafts = myDraftDays(days);
    body.innerHTML = `
      ${crewNewsHtml()}
      ${drafts.length > 1 ? `<div class="row" style="margin-bottom:12px"><button class="btn sm secondary grow" id="pub-all">${ic("check", "sm")} Publier les ${drafts.length} brouillons</button></div>` : ""}
      <div class="row between" style="margin-bottom:12px">
        <span class="kicker">${days.length} journée${days.length > 1 ? "s" : ""}${S.dayFilter ? " · " + fmtDate(S.dayFilter, false) : ""}</span>
        <div class="row">${S.dayFilter ? `<button class="btn sm" id="clear-filter">Tout le voyage</button>` : ""}<button class="btn sm" id="add-day">${ic("plus")} Journée</button></div>
      </div>
      ${days.length ? "" : `<div class="empty valdo-empty"><img src="icons/valdo.svg" alt="">Ajoute une journée pour commencer ton récit.</div>`}
      <div class="day-list">${days.map((iso) => {
        const d = dayInfo(iso), n = dayNumber(S.cur.trip, iso);
        const km = S.cur.tracks.filter((x) => x.day_date === iso).reduce((a, x) => a + (x.distance_m || 0), 0);
        // #38 · mesuré + estimé, et « ≈ » dès qu'une estimation entre dedans.
        // Dans L'ATELIER, une journée sans rien affiche « — » : le vide est ce que
        // Sophie a besoin de voir pour travailler. Chez le proche, rien du tout.
        const dd = CV.dayDistance(S.cur, iso), kmTxt = CV.fmtDayDistance(dd) || "—";
        const ph = S.cur.media.filter((x) => x.day_date === iso);
        const color = CV.colorForDay(dl, iso);
        const st = CV.dayStats(S.cur.tracks.filter((x) => x.day_date === iso));
        const cover = ph.find((x) => x.kind === "photo") || ph[0];
        return `<div class="day-item${S.dayFilter === iso ? " active" : ""}" data-iso="${iso}">
          <div class="num" style="background:${color}" title="Voir cette journée sur la carte"><small>${n != null ? "Jour" : ""}</small>${n != null ? n : fmtDateShort(iso)}</div>
          <div class="info"><b>${esc(d?.title || fmtDate(iso))}</b>${pill(d?.author_id, { small: true })}
            <span>${d?.title ? fmtDate(iso, false) : ""}${d?.place ? ` · ${ic("pin", "sm")} ${esc(d.place)}` : ""}</span>
            <span>${ic("route", "sm")} ${kmTxt}${st.hasAlt && st.gain ? ` · ↗ ${st.gain} m` : ""}${ph.length ? ` · ${ic("camera", "sm")} ${ph.length}` : ""}${d?.story ? ` · ${ic("edit", "sm")}` : ""}${d?.audio_path ? ` ${ic("mic", "sm")}` : ""}</span>
            ${cover ? `<div class="day-cover" style="background-image:url('${gridSrc(cover)}')"></div>` : ""}
            ${(km || ph.length || d) ? `<div class="status">${isLive() ? (d?.published ? `<span class="chip pub">Annoncée</span>` : "") : (d?.published ? `<span class="chip pub">Publiée</span>` : `<span class="chip draft">Brouillon</span>`)}</div>` : ""}
            ${ph.length > 1 ? `<div class="thumbs">${ph.slice(1, 6).map((x) => `<img src="${API.publicUrl(x.thumb_path || x.path)}" alt="">`).join("")}</div>` : ""}
          </div></div>`; }).join("")}</div>`;
    $("#add-day").onclick = () => dayForm(null);
    const pa = $("#pub-all", body); if (pa) pa.onclick = () => publishDrafts(drafts);
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
    const dd = iso ? CV.dayDistance(S.cur, iso) : null;
    const statsHtml = iso ? `<div class="day-stats">
        <div><b>${CV.fmtDayDistance(dd) || "—"}</b><small>distance</small></div>
        ${st.duration_s ? `<div><b>${CV.fmtDuration(st.duration_s)}</b><small>durée</small></div>` : ""}
        ${st.hasAlt ? `<div><b>↗ ${st.gain} m</b><small>montée</small></div><div><b>↘ ${st.loss} m</b><small>descente</small></div><div><b>${st.maxAlt} m</b><small>alt. max</small></div>` : ""}
      </div>${st.hasAlt ? CV.profileSvg(st.profile, CV.colorForDay(dl0, iso)) : ""}` : "";
    // v10 · qui écrit quoi. `mine` = j'ai le droit de toucher à la journée
    // elle-même (je l'ai créée, ou je suis propriétaire du carnet).
    const mine = !d || canEdit(d);
    const myStory   = d ? S.stories.find((x) => x.day_id === d.id && x.author_id === S.user.id) : null;
    const myNote    = d ? S.notes.find((x) => x.day_id === d.id && x.author_id === S.user.id) : null;
    // #51 - Le brouillon local garde les QUATRE textes de la fiche, carnet de bord et
    // récit de co-auteur compris : ce sont justement ceux qui tombaient. Un brouillon
    // d'avant la v10.38 n'a que le titre et le récit — les champs qu'il ne connaît pas
    // gardent leur valeur d'origine au lieu de s'effacer.
    const draft = OFF.LS.get(draftKey(iso));
    const dBase = { title: d?.title || "", story: d?.story || "", my_story: myStory?.body || "", my_note: myNote?.body || "" };
    const dVal = (k) => (draft && draft[k] != null) ? draft[k] : dBase[k];
    const useDraft = !!draft && Object.keys(dBase).some((k) => dVal(k) !== dBase[k]);
    // #40 T8 · « Dans l'atelier, pas de contenu, UN SIGNAL. » Le repli est fermé, mais son
    // titre dit toujours ce qu'il y a dedans — « aucun arrêt » est une information, pas un vide.
    const nStops = iso ? stopsOf(iso).length : 0, campJour = iso ? campOf(iso) : null;
    const signalDetails = !iso ? "" : [
      nStops ? `${nStops} arrêt${nStops > 1 ? "s" : ""}` : "aucun arrêt",
      campJour ? "camp" : "pas de camp",
      d?.transport && BVMAP.MODES[d.transport] ? BVMAP.MODES[d.transport].label : "",
      dVal("my_note") ? "carnet de bord" : "",
    ].filter(Boolean).join(" · ");
    const dayVoices = d ? S.voices.filter((v) => v.day_id === d.id) : [];
    // Le mot du jour n'a de sens qu'à plusieurs : sur un carnet solo, le récit
    // audio suffit et ce bloc n'existe pas.
    const showVoices = !!iso && (MEMBERS.isShared() || dayVoices.length > 0);
    // La date prend toute la largeur, sur sa propre ligne : les fleches et la croix
    // sont descendues au niveau du titre, avec qui elles vont. Sans quoi la date se
    // casse en deux lignes pour leur laisser la place.
    const m = openModal(`${iso ? `<div class="kicker" style="margin-bottom:6px">${n0 != null ? "Jour " + n0 + " · " : ""}${fmtDate(iso)} ${pill(d?.author_id, { small: true })}</div>` : ""}
      <div class="modal-head" style="align-items:center"><div class="grow"><h2 style="margin-bottom:0">${iso ? esc(d?.title || (n0 ? "Jour " + n0 : fmtDate(iso, false))) : "Nouvelle journée"}</h2></div>
      <div class="row" style="gap:6px;flex:0 0 auto;flex-wrap:nowrap">${iso ? `<button type="button" class="btn icon ghost sm" id="day-prev" title="Journée précédente (enregistre)">${ic("chevron-left")}</button><button type="button" class="btn icon ghost sm" id="day-next" title="Journée suivante (enregistre)">${ic("chevron-right")}</button>` : ""}<button type="button" class="btn ghost sm" data-close>Fermer</button></div></div>
      ${status ? `<div style="margin:-6px 0 14px">${status}${d?.published && !isLive() && mine ? ` <button type="button" class="btn sm ghost" id="unpub">Retirer de la vue de mes proches</button>` : ""}</div>` : ""}
      ${useDraft ? `<div class="setup-help" style="margin-bottom:12px">✍️ Un brouillon non enregistré a été retrouvé et restauré.</div>` : ""}
      ${d?.place ? `<div class="kicker" style="margin:-4px 0 10px">${ic("pin", "sm")} ${esc(d.place)}</div>` : ""}
      <form id="f">
        <!-- #40 T8 · DEHORS : ce qui fabrique le RÉCIT, et rien d'autre. Titre, photos,
             récit. Le reste fabrique la carte : il descend dans le repli ci-dessous. -->
        <div class="field"><label>Titre de la journée</label><input name="title" value="${esc(dVal("title"))}" placeholder="Traversée des Highlands" ${mine ? "" : "readonly"}></div>
        ${iso ? `<div class="field"><label>Photos de la journée${dayPhotos.length ? ` (${dayPhotos.length})` : ""}</label>
          ${d?.published && !isLive() ? `<p class="small muted" style="margin:-2px 0 8px">Journée publiée : les photos ajoutées ici sont <b>déjà visibles</b> par tes proches. « Envoyer le lien » sert seulement à les prévenir.</p>` : ""}
          ${dayPhotos.length ? `<div class="media-grid day-gallery" id="day-gallery">${dayPhotos.map((x) => mediaTile(x)).join("")}</div>` : `<p class="small muted">Aucune photo pour cette journée.</p>`}
          <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="day-add-photos">${ic("camera", "sm")} Ajouter des photos à cette journée</button><input type="file" id="day-files" accept="image/*,video/*" multiple hidden></div>
          <div id="uprog" hidden><div class="small muted" id="uptxt"></div><div class="progress"><div id="upbar"></div></div></div></div>` : ""}
        ${mine ? `<div class="field"><label>Récit</label><textarea name="story" class="story" placeholder="Raconte ta journée… (les paragraphes sont conservés)">${esc(dVal("story"))}</textarea></div>
        <div class="field"><label>Récit audio (en plus ou à la place du texte)</label><div id="day-rec"></div></div>`
        : `${d?.story ? `<div class="field"><label>Le récit de ${esc(MEMBERS.name(d.author_id) || "l'équipage")}</label><div class="story-read">${nl2p(d.story)}</div></div>` : ""}
           <div class="field"><label>Mon récit</label><textarea name="my_story" class="story" placeholder="Et toi, comment as-tu vécu cette journée ?">${esc(dVal("my_story"))}</textarea></div>`}
        <div id="story-list"></div>
        ${showVoices ? `<div class="field"><label>Le mot du jour</label><div id="day-voice"></div><div id="voice-list"></div>
          <p class="help">Trente secondes à ta façon, en plus du récit — chacun laisse le sien. C'est ce qui vaudra le plus, plus tard.</p></div>` : ""}
        <!-- #40 T8 · LE REPLI. Fermé, mais jamais muet : son titre DIT ce qu'il contient,
             même quand il ne contient rien (« aucun arrêt · pas de camp »). Dans l'atelier,
             pas de contenu ne veut pas dire pas de bloc — ça veut dire un signal. -->
        ${iso ? `<details class="details-jour"><summary><b>Les détails de la journée</b> <span class="small muted">${signalDetails}</span></summary>
        <div class="field"><label>Date</label><input type="date" name="day_date" required value="${iso || today()}" ${iso ? "readonly" : ""}></div>
        ${iso ? stopsFieldHtml(iso) : ""}
        ${iso ? campFieldHtml(iso) : ""}
        ${iso && mine ? `<div class="field"><label>Comment as-tu voyagé ce jour-là ?</label>
          <div class="mode-picker" id="day-mode-picker">${[["", "🤔", "l'app devine"], ...Object.entries(BVMAP.MODES).map(([k, v]) => [k, v.icon, v.label.replace(/^(à|en) /, "")])].map(([k, icon, lab]) => `<button type="button" class="mode${dayMode === k ? " active" : ""}" data-mode="${k}">${icon}<small>${lab}</small></button>`).join("")}<input type="hidden" name="transport" value="${esc(dayMode)}"></div>
          <p class="help">Le moyen de locomotion de la journée. S'il change en cours de route, indique-le sur la photo où ça change (ci-dessous ou dans la fiche de la photo). Sans indication, l'app devine : voiture par la route au-delà de 2,5 km entre deux photos, à pied en dessous.</p></div>
        ${legs && legs.length > 1 ? `<div class="field legs-field"><label>Changements en cours de journée (${legs.length} tronçons)</label><div class="legs">${legs.map((l, i) => `<div class="leg">${legBout(l.from, l.fromKind)}<span class="arrow">→</span>${legBout(l.to, l.toKind)}
            <select data-from="${l.from.id || ""}" data-kind="${l.fromKind || "media"}" class="leg-mode" ${l.fromKind === "trace" ? "disabled" : ""}><option value="">${l.auto ? `auto : ${BVMAP.MODES[l.mode].label}` : `comme avant (${BVMAP.MODES[l.mode].label})`}</option>${Object.entries(BVMAP.MODES).map(([k, v]) => `<option value="${k}" ${l.from.transport === k ? "selected" : ""}>${v.icon} ${v.label}</option>`).join("")}</select></div>`).join("")}</div><p class="help">Chaque ligne = le trajet du point de gauche à celui de droite ; le choix vaut à partir du point de gauche jusqu'au prochain changement.</p></div>` : ""}` : ""}
        ${iso ? `<div class="field private-note${MEMBERS.isShared() ? " shared" : ""}"><label>Carnet de bord</label>
          <textarea name="my_note" placeholder="Ce qui ne va pas dans le récit : l'adresse du gîte, ce qu'il faut penser à faire demain…">${esc(dVal("my_note"))}</textarea>
          <div id="note-list"></div></div>` : ""}
        ${statsHtml}
        ${iso ? `${canRoute ? `<div class="field"><label>Trajet</label><p class="small muted" style="margin:-2px 0 8px">Pas de trace GPS ce jour-là : la carte relie les photos en pointillés, dans l'ordre de l'heure, selon le moyen de locomotion choisi sur chaque photo. « Tracer l'itinéraire » fait suivre les vraies routes aux tronçons en voiture, bus ou vélo.</p>
          <button type="button" class="btn sm" id="day-route">${ic("route", "sm")} Tracer l'itinéraire par la route</button></div>` : ""}
        ${routeTrack ? `<div class="field"><label>Trajet</label><div class="row between"><span class="small">${ic("route", "sm")} Itinéraire par la route · <b>${fmtDistance(routeTrack.distance_m)}</b> · ${routeTrack.points.length} points</span><button type="button" class="btn sm ghost danger" id="day-route-del">Retirer</button></div>
          <p class="help">Retirer l'itinéraire fait revenir les pointillés entre les photos. Refais « Tracer » après avoir changé un moyen de locomotion.</p></div>` : ""}` : ""}
          ${d && mine ? `<div class="field"><button type="button" class="btn ghost danger" id="del">${ic("trash", "sm")} Supprimer cette journée</button><p class="help">Le titre et le récit partent ; les photos et les traces restent.</p></div>` : ""}
        </details>` : ""}
        <!-- #40 T3 · DEUX boutons, et pas cinq. « Publier » ouvre la feuille du jour, où
             vivent les deux façons de publier. « Retirer de la vue de mes proches » est
             monté près du badge, avec l'état qu'il change. -->
        <div class="actions sticky">
          <span class="grow"></span>
          <button class="btn secondary" type="submit">Enregistrer</button>
          ${iso && mine ? `<button type="button" class="btn primary" id="pub">${ic("sparkle")} ${isLive() || d?.published ? "Envoyer le lien" : "Publier"}</button>` : ""}
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
    // #51 - Aucun `catch` ici : une erreur doit remonter à saveDay(), qui garde la fiche
    // ouverte et le brouillon. Attrapée puis jetée, elle laissait s'afficher
    // « Journée enregistrée » par-dessus le message d'erreur — et le carnet de bord
    // était perdu. Renvoie la liste de ce qui est réellement parti.
    async function saveMine(savedDay) {
      const done = [];
      if (!savedDay) return done;
      const f = $("#f", m.el);
      const ch = mineChanged();
      if (f.my_story) {
        const r = await API.saveDayStory(S.cur.trip.id, savedDay.id, savedDay.day_date, S.user.id, f.my_story.value, myStory);
        S.stories = S.stories.filter((x) => !(x.day_id === savedDay.id && x.author_id === S.user.id));
        if (r) S.stories.push(r);
        if (ch.story) done.push("mon récit");
      }
      if (f.my_note) {
        const r = await API.saveDayNote(S.cur.trip.id, savedDay.id, savedDay.day_date, S.user.id, f.my_note.value, myNote);
        S.notes = S.notes.filter((x) => !(x.day_id === savedDay.id && x.author_id === S.user.id));
        if (r) S.notes.push(r);
        if (ch.note) done.push("carnet de bord");
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
          done.push("mot du jour");
        } else if (voiceRec.isRemoved() && mineVoice) {
          await API.deleteDayVoice(mineVoice);
          S.voices = S.voices.filter((x) => x.id !== mineVoice.id);
          done.push("mot du jour retiré");
        }
      }
      return done;
    }

    // #51 - Comme pour la fiche photo : ce qui est envoyé est décrit UNE fois, et
    // « la fiche est modifiée » en découle. `transport` en faisait déjà partie sans
    // que dirty() le sache — sur une journée sans fiche, il se perdait sous les flèches.
    // `transport` n'existe pas sur une journée qu'on vient de créer (le choix du moyen
    // de locomotion n'apparaît qu'avec une date) : on le lit prudemment.
    const dayFields = () => ({ title: form.title.value, story: form.story.value, transport: (form.transport && form.transport.value) || null });
    const dayBase = () => ({ title: d?.title || "", story: d?.story || "", transport: d?.transport || null });
    const dayChanged = () => { if (!mine) return []; const f = dayFields(), b = dayBase(); return Object.keys(f).filter((k) => (f[k] ?? "") !== (b[k] ?? "")); };
    const dayAudio = () => !!rec && (!!rec.getBlob() || rec.isRemoved());
    // Ce qui n'appartient qu'à moi, même principe : une liste, pas deux.
    const mineChanged = () => ({
      story: !!form.my_story && form.my_story.value !== (myStory?.body || ""),
      note: !!form.my_note && form.my_note.value !== (myNote?.body || ""),
      voice: !!voiceRec && (!!voiceRec.getBlob() || voiceRec.isRemoved()),
    });
    const dirty = () => { const mc = mineChanged(); return dayChanged().length > 0 || dayAudio() || mc.story || mc.note || mc.voice; };
    // Brouillon sauvé à chaque frappe : un tap malheureux ne perd plus rien. Il garde
    // les QUATRE textes — le carnet de bord et le récit d'un co-auteur sont justement
    // ceux qui tombaient, et ils n'y étaient pas.
    const DRAFT_FIELDS = ["title", "story", "my_story", "my_note"];
    const draftValues = () => { const v = { at: Date.now() }; DRAFT_FIELDS.forEach((n) => { if (form[n]) v[n] = form[n].value; }); return v; };
    const saveDraft = () => { if (dirty()) OFF.LS.set(draftKey(iso), draftValues()); else OFF.LS.del(draftKey(iso)); };
    DRAFT_FIELDS.forEach((n) => { if (form[n]) form[n].addEventListener("input", saveDraft); });
    // #31 - Le seul chemin d'écriture de la fiche : le bouton « Enregistrer » et les
    // flèches ◀ ▶ passent tous les deux par ici, brouillon local (draftKey) et
    // contributions personnelles (saveMine) compris. Renvoie false si ça a échoué.
    const DAY_WORDS = { title: "titre", story: "récit" };
    async function saveDay() {
      const fd = Object.fromEntries(new FormData(form));
      const changed = dayChanged(), withAudio = dayAudio();
      try {
        let saved = d;
        // La journée elle-même : seulement si elle est à moi (ou si je la crée).
        if (mine) {
          const fields = dayFields();   // la même liste que celle dont dérive dirty()
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
        // Si ça échoue, l'erreur remonte ici : la fiche reste ouverte et le brouillon
        // n'est pas effacé — la ligne suivante n'est pas atteinte.
        const done = await saveMine(saved);
        OFF.LS.del(draftKey(iso)); saveLocal();
        const mots = changed.map((k) => k === "transport"
          ? (saved?.transport && BVMAP.MODES[saved.transport] ? BVMAP.MODES[saved.transport].label : "sans moyen de locomotion")
          : DAY_WORDS[k]).filter(Boolean)
          .concat(withAudio ? [(saved && saved.audio_path) ? "récit audio" : "récit audio retiré"] : []).concat(done);
        return { saved: mots, day: (saved && saved.day_date) || fd.day_date };
      } catch (err) { saveLocal(); errToast(err, 6000); if (isNetworkError(err)) toast("Ton texte est gardé sur le téléphone : réessaie quand tu auras du réseau", "info", 6000); return false; }
    }
    form.onsubmit = async (e) => {
      e.preventDefault();
      const r = await saveDay();
      if (!r) return;
      m.close(); renderPanel();
      if (r.saved.length) toast(accuse(`Journée du ${fmtDate(r.day, false)}`, r.saved), "ok");
      else toast("Aucune modification à enregistrer");
    };

    // #31 - ◀ ▶ : enregistrer puis ouvrir la journée voisine sans repasser par la
    // liste. `dl0` est l'ordre de allDays(), celui de la liste affichée.
    const navIdx = iso ? dl0.indexOf(iso) : -1;
    const goDay = async (dir) => {
      const nx = dl0[navIdx + dir];
      if (!nx) return toast(dir > 0 ? "Dernière journée" : "Première journée");
      if (dirty()) { const r = await saveDay(); if (!r) return; if (r.saved.length) toast(accuse(`Journée du ${fmtDate(r.day, false)}`, r.saved), "ok"); }   // rien n'est perdu si l'envoi échoue
      m.close(); renderPanel(); dayForm(nx);
    };
    const dPrev = $("#day-prev", m.el), dNext = $("#day-next", m.el);
    if (dPrev) { dPrev.onclick = () => goDay(-1); dPrev.disabled = navIdx <= 0; }
    if (dNext) { dNext.onclick = () => goDay(1); dNext.disabled = navIdx < 0 || navIdx >= dl0.length - 1; }
    const del = $("#del", m.el);
    if (del) del.onclick = async () => {
      if (!(await confirm("Supprimer le titre et le récit de cette journée ? (les photos et traces restent)"))) return;
      if (d.audio_path) API.removeFiles([d.audio_path]).catch(() => {});
      await API.deleteDay(d.id); S.cur.days = S.cur.days.filter((x) => x.id !== d.id); m.close(); renderPanel();
    };
    // Les arrêts de la journée : la liste se redessine sur place après chaque ajout
    const refreshStops = () => {
      const holder = $("#stop-list", m.el);
      if (holder) { holder.innerHTML = stopsOf(iso).map(stopRowHtml).join(""); bindStopsField(m.el, iso, refreshStops); }
      const box = $("#camp-box", m.el);
      if (box) box.innerHTML = campBoxHtml(iso);
      const boxM = $("#camp-box-matin", m.el);            // #58 · le camp du matin, premier jour seulement
      if (boxM) boxM.innerHTML = campBoxHtml(veille(iso), true);
      if (box || boxM) bindCampField(m.el, iso, refreshStops);
      const lab = holder && holder.parentElement && $("label", holder.parentElement);
      if (lab) { const n = stopsOf(iso).length; lab.textContent = `Les arrêts de la journée${n ? ` (${n})` : ""}`; }
    };
    if (iso) { bindStopsField(m.el, iso, refreshStops); bindCampField(m.el, iso, refreshStops); }
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
        if (navigator.onLine) CV.fillElevations(S.cur, enrichElevation).catch(() => { }); // #22 : un itinéraire estimé n'a jamais d'altitude propre
      } catch (err) { errToast(err, 6000); busy(routeBtn, false); }
    };
    $$("#day-mode-picker .mode", m.el).forEach((b) => b.onclick = async () => {
      $$("#day-mode-picker .mode", m.el).forEach((x) => x.classList.toggle("active", x === b)); form.transport.value = b.dataset.mode;
      if (!d) return; // journée sans fiche : enregistré avec le formulaire
      try { const u = await API.upsertDay(S.user, S.cur.trip.id, iso, { transport: b.dataset.mode || null }); Object.assign(d, u); saveLocal(); redraw(); toast(b.dataset.mode ? `Journée ${BVMAP.MODES[b.dataset.mode].label}` : "L'app devinera le moyen de locomotion", "ok", 1800); }
      catch (err) { errToast(err); }
    });
    // #38 · Le bout d'un tronçon n'est plus forcément une photo : ce peut être un arrêt ou
    // un camp. On écrit donc dans la table qui convient — avant, ce code faisait un
    // `S.cur.media.find(...)` et sortait EN SILENCE pour tout le reste.
    $$(".leg-mode", m.el).forEach((sel) => sel.onchange = async () => {
      const id = sel.dataset.from, kind = sel.dataset.kind, mode = sel.value || null;
      const dit = () => { saveLocal(); redraw(); toast(mode ? `Tronçon ${BVMAP.MODES[mode].label}` : "Tronçon : comme le précédent", "ok", 1800); };
      try {
        if (kind === "stop") {
          const st = (S.cur.stops || []).find((y) => y.id === id); if (!st) return;
          Object.assign(st, await API.updateStop(st.id, { transport: mode })); dit();
        } else if (kind === "camp") {
          const c = (S.cur.camps || []).find((y) => y.id === id); if (!c) return;
          Object.assign(c, await API.upsertCamp(S.cur.trip.id, c.night_date, { lat: c.lat, lng: c.lng, name: c.name, address: c.address, transport: mode })); dit();
        } else {
          const x = S.cur.media.find((y) => y.id === id); if (!x) return;
          Object.assign(x, await API.updateMedia(x.id, { transport: mode })); dit();
        }
      } catch (err) { errToast(err); }
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
        const fields = dayFields();   // #51 - la même liste qu'ailleurs : publier ne perd plus le moyen de locomotion
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
    const pub = $("#pub", m.el); if (pub) pub.onclick = () => feuilleDuJour(iso, d, publish);
    const unpub = $("#unpub", m.el);
    if (unpub) unpub.onclick = async () => {
      try { const saved = await API.upsertDay(S.user, S.cur.trip.id, iso, { published: false });
        const i = S.cur.days.findIndex((x) => x.id === saved.id); S.cur.days[i] = saved; saveLocal(); m.close(); renderPanel(); toast("Journée repassée en brouillon"); }
      catch (err) { errToast(err); }
    };
  }
  // #40 T3 · LA FEUILLE DU JOUR. Un seul bouton « Publier » dans la barre, et les deux façons
  // de publier vivent ici — « en silence » et « en prévenant ». Elles ont quitté la barre parce
  // qu'un bouton qui envoie un message à toute la famille ne se touche pas du coin du pouce.
  // Elle parle d'UN jour, jamais du voyage : c'est un geste du soir, pas le partage du carnet.
  function feuilleDuJour(iso, d, publish) {
    const n = dayNumber(S.cur.trip, iso);
    const titre = n != null ? "Jour " + n : fmtDate(iso, false);
    const dejaVisible = isLive() || !!d?.published;
    const f = openModal(`<h2>${esc(titre)}</h2>
      <p class="small muted">${dejaVisible
        ? "Cette journée est déjà visible par tes proches."
        : "Personne ne l'a encore vue. À toi de choisir comment elle arrive."}</p>
      ${dejaVisible ? "" : `<div class="field"><button type="button" class="btn primary" id="fj-quiet" style="width:100%">${ic("check")} Publier en silence</button>
        <p class="help">Elle devient visible. Tes proches la découvriront à leur prochaine visite.</p></div>`}
      <div class="field"><button type="button" class="btn ${dejaVisible ? "primary" : "secondary"}" id="fj-notify" style="width:100%">${ic("sparkle")} ${dejaVisible ? "Envoyer le lien à mes proches" : "Publier et prévenir"}</button>
        <p class="help">${dejaVisible ? "Ouvre le partage de ton téléphone, avec un message prêt." : "Elle devient visible, et le partage de ton téléphone s'ouvre avec un message prêt."}</p></div>
      <div class="share-box"><input readonly value="${esc(shareUrl() + "#day-" + iso)}" id="fj-url">
        <div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="fj-copy">Copier le lien de cette journée</button></div></div>
      <div class="actions sticky"><button type="button" class="btn ghost" data-close>Annuler</button></div>`);
    const quiet = $("#fj-quiet", f.el); if (quiet) quiet.onclick = () => { f.close(); publish(false); };
    // En mode direct, une journée peut n'avoir que des photos et aucune fiche : `d` est alors
    // absent, et `announceDay` lirait sa date dans le vide. On passe par `publish`, qui crée
    // la fiche puis annonce.
    $("#fj-notify", f.el).onclick = () => { f.close(); if (dejaVisible && d) announceDay(d); else publish(true); };
    $("#fj-copy", f.el).onclick = async () => {
      const url = $("#fj-url", f.el).value;
      try { await navigator.clipboard.writeText(url); toast("Lien de la journée copié", "ok"); }
      catch { $("#fj-url", f.el).select(); toast("Copie-le à la main", "info", 6000); }
    };
  }

  // Ouvre la feuille de partage du téléphone avec un message prêt à envoyer
  async function announceDay(d) {
    const n = dayNumber(S.cur.trip, d.day_date);
    const url = shareUrl() + "#day-" + d.day_date;
    const label = `${n != null ? "Jour " + n : fmtDate(d.day_date, false)}${d.title ? " · " + d.title : ""}`;
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

  // #30 - Publier plusieurs brouillons d'un coup. Le vrai cas d'usage est le
  // rattrapage : trois jours sans réseau, quatre journées en attente. Silencieux,
  // puis UN SEUL message proposé pour l'ensemble — publier quatre journées ne doit
  // jamais prévenir quatre fois (c'est le travers corrigé par #11 et le bandeau v10).
  async function publishDrafts(list) {
    if (!list || list.length < 2) return;
    const line = (iso) => {
      const d = dayInfo(iso), n = dayNumber(S.cur.trip, iso);
      const ph = S.cur.media.filter((x) => x.day_date === iso).length;
      const quoi = [ph ? `${ph} photo${ph > 1 ? "s" : ""}` : "", d?.story ? "récit" : "", d?.audio_path ? "récit audio" : ""].filter(Boolean).join(" · ");
      return `<li><b>${n != null ? "Jour " + n : fmtDateShort(iso)}</b> — ${esc(d?.title || fmtDate(iso, false))}${quoi ? `<br><span class="small muted">${quoi}</span>` : ""}</li>`;
    };
    const go = await ask(`<h2>Publier ${list.length} journées ?</h2>
      <p class="small muted">Elles deviendront visibles par tes proches. Personne n'est prévenu tout de suite : tu pourras ensuite envoyer <b>un seul</b> message pour l'ensemble.</p>
      <ul style="margin:10px 0 16px;padding-left:20px;line-height:1.6">${list.map(line).join("")}</ul>`,
      `Publier les ${list.length}`);
    if (!go) return;
    const done = [], failed = [];
    for (const iso of list) {
      try {
        const saved = await API.upsertDay(S.user, S.cur.trip.id, iso, { published: true, published_at: new Date().toISOString() });
        const i = S.cur.days.findIndex((x) => x.id === saved.id);
        if (i >= 0) S.cur.days[i] = saved; else S.cur.days.push(saved);
        done.push(saved);
      } catch (err) { failed.push(iso); }
    }
    S.cur.days.sort((a, b) => a.day_date.localeCompare(b.day_date));
    saveLocal(); renderPanel();
    if (!done.length) return toast("Aucune journée n'a pu être publiée — réessaie quand tu auras du réseau", "error", 6000);
    toast(`${done.length} journée${done.length > 1 ? "s" : ""} publiée${done.length > 1 ? "s" : ""} — tes proches ${done.length > 1 ? "les" : "la"} verront à leur prochaine visite`, "ok", 5000);
    if (failed.length) toast(`${failed.length} journée${failed.length > 1 ? "s" : ""} n'a pas pu être publiée — réessaie plus tard`, "error", 6000);
    if (!(await ask(`<h2>Prévenir tes proches ?</h2>
      <p class="small muted">Un seul message pour ${done.length > 1 ? `ces ${done.length} journées` : "cette journée"}.</p>`,
      "Envoyer le message", "Plus tard"))) return;
    // Si une seule a finalement abouti, c'est le message d'une journée qui convient.
    if (done.length === 1) announceDay(done[0]); else announceDays(done);
  }

  // Le message unique de #30 — le pendant de announceDay() pour un lot de journées.
  async function announceDays(list) {
    const url = shareUrl() + "#day-" + list[0].day_date;
    // « jours 2 à 5 » quand la série se suit — c'est le cas du rattrapage, celui de #30.
    const nums = list.map((d) => dayNumber(S.cur.trip, d.day_date));
    const join = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " et " + a[a.length - 1] : a[0]);
    const suite = list.length > 2 && nums.every(Boolean) && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    const quoi = !nums.every(Boolean) ? join(list.map((d) => fmtDate(d.day_date, false)))
      : suite ? `jours ${nums[0]} à ${nums[nums.length - 1]}`
      : `jours ${join(nums.map(String))}`;
    const text = `${S.cur.trip.title} — ${list.length} nouvelles journées en ligne (${quoi}) ! Carte, photos et récits ici : ${url}`;
    if (cfg.VAPID_PUBLIC_KEY) {
      API.notify(S.cur.trip.id, S.cur.trip.title, `${list.length} nouvelles journées en ligne 🧳`, url)
        .then((r) => { if (r && r.total) toast(`Notification envoyée à ${r.sent} proche${r.sent > 1 ? "s" : ""}`, "ok"); })
        .catch((e) => toast("Notifications non envoyées : " + friendly(e), "error", 6000));
    }
    if (navigator.share) {
      try { await navigator.share({ title: S.cur.trip.title, text, url }); toast("Message envoyé", "ok"); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(text); toast("Message copié · colle-le dans WhatsApp, SMS ou email", "ok", 6000); }
    catch { toast("Journées publiées", "ok"); }
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
        <div class="row">${S.dayFilter ? `<button class="btn sm" id="clear-filter">Tout le voyage</button>` : ""}${list.length ? `<button class="btn sm ${S.selecting ? "secondary" : ""}" id="select-toggle">${S.selecting ? "Terminer" : `${ic("check", "sm")} Sélectionner`}</button>` : ""}</div>
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
    const src = gridSrc(x);
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
          const img = await CV.prepareImage(f, cfg.PHOTO_MAX_SIZE || 1600, cfg.PHOTO_GRID_SIZE || 768, cfg.PHOTO_THUMB_SIZE || 192);
          prepared = { tripId: S.cur.trip.id, fields, big: img.big, grid: img.grid, thumb: img.thumb };
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
    // #34 · On ne place pas une photo d'après une heure inventée. Un itinéraire calculé
    // portait une seconde par point, à partir de 8 h du matin : chercher « où étais-tu à
    // 14 h 03 » dedans revenait à tirer un point au hasard sur la route.
    for (const tr of S.cur.tracks.filter(CV.heuresFiables)) for (const p of tr.points || []) {
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
        <button type="button" class="close mot" data-close>Annuler</button></div>
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
    // #51 - La liste des champs envoyés à la base est ici, et NULLE PART ailleurs :
    // « la fiche est modifiée » et l'accusé de réception en découlent tous les deux.
    // Une garde écrite à côté de cette liste finit toujours par ne plus lui ressembler —
    // c'est ainsi qu'un moyen de locomotion changé seul se perdait en silence.
    const photoFields = () => {
      const fd = Object.fromEntries(new FormData(form));
      // Le champ « Prise le » ne descend qu'à la minute. Tant qu'il montre la même
      // minute que l'heure enregistrée, on garde celle-ci telle quelle : ses secondes
      // viennent de l'appareil photo, et les réécrire se lirait comme une modification.
      const minute = (x) => Math.floor(+new Date(x || 0) / 60000);
      const saisie = fd.taken_at ? new Date(fd.taken_at).toISOString() : m.taken_at;
      return { caption: fd.caption, day_date: fd.day_date,
        taken_at: minute(saisie) === minute(m.taken_at) ? m.taken_at : saisie,
        transport: fd.transport || null };
    };
    const samePhoto = (k, v) => (v ?? "") === (m[k] ?? "");
    const photoChanged = () => Object.entries(photoFields()).filter(([k, v]) => !samePhoto(k, v)).map(([k]) => k);
    const audioChanged = () => !!mrec.getBlob() || mrec.isRemoved();
    const dirty = () => photoChanged().length > 0 || audioChanged();
    // Renvoie { saved: [ce qui est réellement parti] } — ou false si l'envoi a échoué.
    // Les appelants s'écrivent tous `if (await save())` : un objet est toujours vrai.
    async function save() {
      const changed = photoChanged(), withAudio = audioChanged();
      if (!changed.length && !withAudio) return { saved: [] };
      try {
        const fields = photoFields();
        const blob = mrec.getBlob();
        if (blob) fields.audio_path = await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type));
        else if (mrec.isRemoved()) fields.audio_path = null;
        const old = m.audio_path;
        const u = await API.updateMedia(m.id, fields);
        if (old && old !== u.audio_path) API.removeFiles([old]).catch(() => {});
        Object.assign(m, u); saveLocal();
        return { saved: changed.concat(withAudio ? ["audio"] : []) };
      } catch (err) { errToast(err); return false; }
    }
    const PHOTO_WORDS = { caption: "légende", day_date: "journée", taken_at: "heure" };
    const photoMsg = (saved) => accuse(`Photo ${idx + 1}`, saved.map((k) => k === "transport"
      ? (m.transport && BVMAP.MODES[m.transport] ? BVMAP.MODES[m.transport].label : "sans moyen de locomotion")
      : k === "audio" ? (m.audio_path ? "commentaire audio" : "commentaire audio retiré")
      : PHOTO_WORDS[k]));
    const tellSaved = (r) => r.saved.length ? toast(photoMsg(r.saved), "ok") : toast("Aucune modification à enregistrer");
    form.onsubmit = async (e) => { e.preventDefault(); const r = await save(); if (!r) return; modal.close(); redraw(); renderPanel(); tellSaved(r); };
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
      // #51 - Un seul enregistrement par écran : « Commenter » garde d'abord la photo.
      // Sans cela, écrire une légende puis toucher « Commenter » envoyait le commentaire
      // et laissait la légende affichée — tout l'air d'un enregistrement, et rien de gardé.
      const rp = await save();
      if (!rp) return toast("Ton commentaire n'est pas envoyé : la photo n'a pas pu être enregistrée", "error", 6000);
      if (rp.saved.length) { redraw(); renderPanel(); }
      try {
        const audio_path = blob ? await API.uploadFile(S.user, S.cur.trip.id, blob, CV.audioExt(blob.type)) : null;
        const c = await API.addOwnerComment(S.cur.trip.id, { media_id: m.id, author: "Moi", body, audio_path });
        crec.reset();
        S.cur.comments.push(c); e.target.reset();
        $("#clist", el).insertAdjacentHTML("beforeend", commentHtml(c)); bindCommentDeletes(el); CV.bindBigAudio(el);
        toast(rp.saved.length ? `Commentaire ajouté · ${photoMsg(rp.saved)}` : "Commentaire ajouté", "ok");
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

  // ---------------------------------------------------------------
  //  Les arrêts d'une journée (#5)
  //  Un arrêt se pose LE SOIR : soit à partir d'un groupe de photos, soit en
  //  touchant la carte. Dans les deux cas c'est Sophie qui tranche — l'app
  //  propose, elle n'enregistre jamais toute seule.
  // ---------------------------------------------------------------
  const stopsOf = (iso) => (S.cur.stops || []).filter((x) => x.day_date === iso)
    .sort((a, b) => (a.at_time || "").localeCompare(b.at_time || "") || (a.sort_order - b.sort_order));
  const stopPicto = (cat) => (window.BV_STOP_PICTOS && (BV_STOP_PICTOS[cat] || BV_STOP_PICTOS.autre)) || "";
  // Comme pour une journée ou une photo : on ne corrige que ce qu'on a soi-même ajouté.
  const canEditStop = (st) => !st.author_id || st.author_id === S.user.id || isTripOwner();

  // Le type d'un lieu et sa catégorie disent parfois la même chose
  // (« Point de vue · Points de vue ») : on n'écrit le mot qu'une fois.
  function placeMeta(f) {
    const cat = CV.stopCategoryLabel(f.category);
    // « Point de vue » et « Points de vue » sont le même mot : on compare au singulier
    const nu = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[\s/]+/).map((w) => w.replace(/s$/, "")).filter(Boolean).join(" ");
    const kind = f.kind && nu(f.kind) !== nu(cat) ? f.kind : "";
    return [kind, cat, f.dist != null ? f.dist + " m" : ""].filter(Boolean).join(" · ");
  }

  function stopRowHtml(st) {
    const when = st.at_time ? fmtTime(st.at_time) : "";
    const bits = [CV.stopCategoryLabel(st.category), (st.media_ids || []).length ? `${(st.media_ids || []).length} photo${(st.media_ids || []).length > 1 ? "s" : ""}` : ""].filter(Boolean);
    return `<div class="stop-row" data-id="${st.id}">
      <span class="pic">${stopPicto(st.category)}</span>
      <span class="grow"><span class="nm">${when ? `<span style="color:var(--azur)">${when}</span> · ` : ""}${esc(st.name || "Sans nom")}</span>
        <span class="meta">${esc(bits.join(" · "))}${st.note ? " · " + esc(st.note) : ""}</span></span>
      ${canEditStop(st) ? `<button type="button" class="btn icon ghost sm stop-edit" title="Modifier cet arrêt">${ic("edit", "sm")}</button>` : ""}
    </div>`;
  }

  // Le bloc de la fiche journée. Rien à afficher → il n'existe pas du tout
  // (règle : pas de contenu, pas de cadre).
  // #38 · Un bout de tronçon : la vignette quand c'est une photo, un picto sinon.
  // Un camp ni un arrêt n'ont d'image — l'ancien code leur demandait `thumb_path`.
  function legBout(x, kind) {
    if (kind === "camp") return `<span class="leg-picto" title="${esc(x.name || "Notre camp de base")}">${window.BV_CAMP_PICTO || ic("pin")}</span>`;
    if (kind === "stop") return `<span class="leg-picto" title="${esc(x.name || "Arrêt")}">${(window.BV_STOP_PICTOS && (BV_STOP_PICTOS[x.category] || BV_STOP_PICTOS.autre)) || ic("pin")}</span>`;
    if (kind === "trace") return `<span class="leg-picto" title="La trace GPS">${ic("route")}</span>`;
    return `<img src="${API.publicUrl(x.thumb_path || x.path)}" alt="">`;
  }

  // ---- #38 · « Notre camp de base » ----
  // Le camp marqué sur une journée est l'endroit où l'on dort À LA FIN de cette
  // journée : il la ferme, et il ouvre la suivante. Il vaut ensuite tant qu'on n'en
  // marque pas un autre — trois nuits au même endroit, un seul geste.
  const campOf = (iso) => CV.campClosing(S.cur.camps, iso, S.cur);   // #57 · les journées décident de la reconduction
  // #58 · La veille d'une date, en ISO. Sert au camp du matin du PREMIER jour.
  const veille = (iso) => { const [y, m, d] = iso.split("-").map(Number); const x = new Date(y, m - 1, d - 1); return isoDate(x); };
  // Le premier jour du voyage est le SEUL qui n'a pas de veille dont hériter : c'est pour
  // cela, et pour rien d'autre, qu'il lui faut un champ de plus. Aucune autre journée ne
  // l'affiche — et surtout pas la dernière : le champ du soir est déjà son côté arrivée.
  const estPremierJour = (iso) => !!iso && !!S.cur.trip.start_date && iso === S.cur.trip.start_date;

  function campFieldHtml(iso) {
    const c = campOf(iso), propre = c && c.night_date === iso;
    const matin = estPremierJour(iso);
    return `${matin ? `<div class="field"><label>D'où partez-vous le matin</label>
      <div id="camp-box-matin">${campBoxHtml(veille(iso), true)}</div>
      <p class="help">Le premier jour est le seul à n'avoir pas de veille : dis d'où tu pars,
        sinon la journée n'a pas de point de départ. Paris le matin, Tavira le soir.</p></div>` : ""}
      <div class="field"><label>Notre camp de base</label>
      <div id="camp-box">${campBoxHtml(iso)}</div>
      <p class="help">${propre
        ? "C'est ici que vous dormez ce soir-là. Cette nuit ferme la journée et ouvre la suivante."
        : c ? "Repris de la nuit précédente : tant que tu n'en marques pas un autre, c'est le même."
            : "Marque l'endroit où vous dormez ce soir-là : la journée pourra partir de là."}</p></div>`;
  }
  // `matin` = la boîte du camp du matin (nuit de la veille) : mêmes gestes, autres identifiants.
  function campBoxHtml(iso, matin) {
    const c = campOf(iso), propre = c && c.night_date === iso;
    const sfx = matin ? "-matin" : "";
    // Le nom sur sa ligne, les boutons en dessous : à 440 px, un nom d'hôtel et deux
    // boutons sur la même ligne se cassent — vu en image avant de le montrer à Sophie.
    return `${c ? `<div class="camp-nom"><span class="chip">${ic("pin", "sm")} <b>${esc(c.name || "Sans nom")}</b></span>${propre ? "" : `<span class="small muted">reconduit</span>`}</div>` : ""}
      <div class="row" style="gap:8px;flex-wrap:wrap">
      <button type="button" class="btn sm" id="camp-set${sfx}">${ic(c ? "edit" : "pin", "sm")} ${c && propre ? "Changer le camp" : "Marquer le camp"}</button>
      ${propre ? `<button type="button" class="btn sm ghost danger" id="camp-del${sfx}">Retirer</button>` : ""}</div>`;
  }
  function bindCampField(root, iso, refresh) {
    bindUneBoite(root, iso, refresh, "");
    if (estPremierJour(iso)) bindUneBoite(root, veille(iso), refresh, "-matin");
  }
  function bindUneBoite(root, iso, refresh, sfx) {
    const set = $("#camp-set" + sfx, root); if (set) set.onclick = () => campForm(iso, refresh);
    const del = $("#camp-del" + sfx, root);
    if (del) del.onclick = async () => {
      const c = campOf(iso); if (!c || c.night_date !== iso) return;
      if (!(await confirm("Retirer ce camp de base ? Les journées suivantes reprendront le camp d'avant."))) return;
      try {
        await API.deleteCamp(c.id);
        S.cur.camps = S.cur.camps.filter((x) => x.id !== c.id);
        saveLocal(); redraw(); if (refresh) refresh();
        toast("Camp de base retiré", "ok");
      } catch (err) { errToast(err, 6000); }
    };
  }
  // La fiche du camp. Comme partout depuis la v10.38 : la garde « c'est modifié »
  // est DÉRIVÉE de la liste des champs envoyés, l'erreur remonte, et l'accusé de
  // réception nomme ce qui vient d'être gardé.
  function campForm(iso, after) {
    const exist = (S.cur.camps || []).find((c) => c.night_date === iso) || null;
    const repris = !exist ? campOf(iso) : null;   // celui qu'on reconduit, s'il y en a un
    const n = dayNumber(S.cur.trip, iso);
    const m = openModal(`<div class="kicker" style="margin-bottom:6px">${n != null ? "Jour " + n + " · " : ""}${fmtDate(iso)}</div>
      <div class="modal-head"><div class="grow"><h2 style="margin-bottom:0">Notre camp de base</h2></div>
        <button type="button" class="btn ghost sm" data-close>Annuler</button></div>
      <p class="small muted">Où dormez-vous à la fin de cette journée ? Cette nuit ferme le
        ${fmtDate(iso, false)} et ouvre le lendemain — et elle vaudra pour les nuits suivantes
        tant que tu n'en marques pas une autre.</p>
      ${repris ? `<p class="small muted">Pour l'instant, cette journée reprend « ${esc(repris.name || "Sans nom")} », marqué le ${fmtDate(repris.night_date, false)}.</p>` : ""}
      <div id="camp-finder"></div>
      <div class="field"><label>Pour partir d'ici, on voyage…</label>
        <select id="camp-mode">${[["", "comme la journée"], ...Object.entries(BVMAP.MODES).map(([k, v]) => [k, `${v.icon} ${v.label}`])].map(([k, lab]) => `<option value="${k}" ${((exist && exist.transport) || "") === k ? "selected" : ""}>${lab}</option>`).join("")}</select>
        <p class="help">Le cas courant : la marche est à pied, mais le trajet depuis l'hôtel se fait en voiture.</p></div>
      <div class="actions sticky"><span class="grow"></span>
        <button class="btn primary" id="camp-save" type="button">${ic("check")} Enregistrer</button></div>`,
      { guard: () => dirty() });

    const finder = CV.placeFinder($("#camp-finder", m.el), {
      value: exist ? { name: exist.name, address: exist.address, lat: exist.lat, lng: exist.lng, osm_type: exist.osm_type, osm_id: exist.osm_id } : null,
      label: "Nom de l'hôtel, ou adresse",
    });

    // #51 · une seule liste : ce qui part en base, et rien à côté.
    const campFields = () => { const p = finder.get(); return p && p.lat != null
      ? { name: p.name || "", address: p.address || "", lat: +(+p.lat).toFixed(6), lng: +(+p.lng).toFixed(6),
          transport: ($("#camp-mode", m.el) || {}).value || null,
          osm_type: p.osm_type || null, osm_id: p.osm_id != null ? +p.osm_id : null }
      : null; };
    const same = (a, b) => (a ?? "") === (b ?? "");
    const changed = () => {
      const f = campFields(); if (!f) return [];
      if (!exist) return Object.keys(f);
      return Object.keys(f).filter((k) => (k === "lat" || k === "lng") ? Math.abs((f[k] || 0) - (exist[k] || 0)) > 1e-6 : !same(f[k], exist[k]));
    };
    const dirty = () => changed().length > 0;

    $("#camp-save", m.el).onclick = async () => {
      const f = campFields();
      if (!f) return toast("Cherche le lieu, ou écris-le toi-même", "error");
      if (!changed().length) { m.close(); return toast("Aucune modification à enregistrer"); }
      try {
        const r = await API.upsertCamp(S.cur.trip.id, iso, f);
        const i = (S.cur.camps || []).findIndex((c) => c.night_date === iso);
        if (i >= 0) S.cur.camps[i] = r; else S.cur.camps.push(r);
        saveLocal(); redraw(); m.close(); if (after) after();
        toast(`Camp de base du ${fmtDate(iso, false)} : ${f.name || "sans nom"}, enregistré`, "ok");
      } catch (err) { errToast(err, 6000); }   // la fiche reste ouverte, rien n'est perdu
    };
  }

  function stopsFieldHtml(iso) {
    const list = stopsOf(iso);
    const canFind = CV.photoClusters(S.cur.media, iso).length > 0;
    if (!list.length && !canFind) return "";
    return `<div class="field"><label>Les arrêts de la journée${list.length ? ` (${list.length})` : ""}</label>
      <div id="stop-list">${list.map(stopRowHtml).join("")}</div>
      ${canFind ? `<div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="stop-find">${ic("pin", "sm")} Retrouver les arrêts d'après mes photos</button></div>` : ""}
      <p class="help">Les lieux de la journée : un musée, un restaurant, un point de vue. Tu peux aussi en poser un en touchant la carte, depuis la carte de la journée.</p></div>`;
  }

  // Les boutons du bloc, à recâbler après chaque redessin de la liste
  function bindStopsField(root, iso, refresh) {
    $$("#stop-list .stop-edit", root).forEach((b) => b.onclick = () => {
      const st = (S.cur.stops || []).find((x) => x.id === b.closest(".stop-row").dataset.id);
      if (st) stopForm(iso, st, refresh);
    });
    const find = $("#stop-find", root);
    if (find) find.onclick = () => findStops(iso, refresh);
  }

  // ---- La fiche d'un arrêt : nom, catégorie, heure, note ----
  // `preset` sert aux arrêts qui n'existent pas encore (proposés, ou posés sur la carte).
  function stopForm(iso, st, after) {
    const preset = st && !st.id ? st : null;
    const cur = preset || st || {};
    const isNew = !st || !st.id;
    if (st && st.id && !canEditStop(st)) return toast("Cet arrêt a été ajouté par quelqu'un d'autre", "info");
    const n = dayNumber(S.cur.trip, iso);
    const m = openModal(`<div class="kicker" style="margin-bottom:6px">${n != null ? "Jour " + n + " · " : ""}${fmtDate(iso)}</div>
      <div class="modal-head"><div class="grow"><h2 style="margin-bottom:0">${isNew ? "Un arrêt" : "Modifier l'arrêt"}</h2></div>
        <button type="button" class="btn ghost sm" data-close>Annuler</button></div>
      <form id="sf">
        <div class="field"><label>Nom du lieu</label><input name="name" required value="${esc(cur.name || "")}" placeholder="Musée de l'Azulejo"></div>
        <div class="field"><label>Catégorie</label><select name="category">${CV.STOP_CATEGORIES.map((c) => `<option value="${c.k}" ${(cur.category || "autre") === c.k ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
        <div class="row"><div class="field grow"><label>Heure</label><input type="time" name="hhmm" value="${cur.at_time ? toLocalTime(cur.at_time) : ""}">
          <p class="help">Vide quand il n'y a pas de photo : l'app n'invente pas d'heure.</p></div></div>
        <div class="field"><label>À partir d'ici, je voyage…</label>
          <select name="transport">${[["", "comme avant"], ...Object.entries(BVMAP.MODES).map(([k, v]) => [k, `${v.icon} ${v.label}`])].map(([k, lab]) => `<option value="${k}" ${(cur.transport || "") === k ? "selected" : ""}>${lab}</option>`).join("")}</select>
          <p class="help">Le parking porte « à pied » quand la photo d'avant portait « voiture » : sans ça, la voiture irait jusqu'à la porte du musée.</p></div>
        <div class="field"><label>Une note, si tu veux</label><input name="note" value="${esc(cur.note || "")}" placeholder="La lumière de fin d'après-midi"></div>
        ${(cur.media_ids || []).length ? `<p class="small muted">${cur.media_ids.length} photo${cur.media_ids.length > 1 ? "s" : ""} rattachée${cur.media_ids.length > 1 ? "s" : ""} à cet arrêt.</p>` : ""}
        <div class="actions sticky">
          ${!isNew ? `<button type="button" class="btn icon ghost danger" id="sdel" title="Supprimer cet arrêt">${ic("trash")}</button>` : ""}<span class="grow"></span>
          <button class="btn primary" type="submit">Enregistrer</button>
        </div></form>`,
      // #72 · la fiche d'arrêt était la SEULE fenêtre de saisie sans garde : elle fermait
      // sans un mot et la saisie partait en silence. Les trois portes qui la referment
      // (« Annuler », un doigt à côté de la fenêtre, Échap) passent toutes par `tryClose` :
      // une seule garde les couvre. « Enregistrer » et la corbeille ferment directement.
      { guard: () => dirty(), guardText: () => perdu() });
    const f = $("#sf", m.el);
    // #51 · UNE SEULE LISTE : ce qui part en base. La garde et la phrase de la question la
    // parcourent ; aucune des deux n'écrit la sienne à côté. `from === "cur"` relit l'état
    // d'ouverture avec les MÊMES expressions que les `value=` du formulaire ci-dessus —
    // d'où : ouvrir une fiche et la refermer aussitôt ne change rien, donc ne demande rien.
    const stopFields = (from) => {
      const fd = from === "cur"
        ? { name: cur.name || "", category: cur.category || "autre", note: cur.note || "",
            hhmm: cur.at_time ? toLocalTime(cur.at_time) : "", transport: cur.transport || "" }
        : Object.fromEntries(new FormData(f));
      // Le champ « Heure » ne descend qu'à la minute ; `at_time` en base porte des secondes.
      // Tant qu'il montre la même minute que l'heure enregistrée, on garde celle-ci telle
      // quelle — sinon la fiche se croirait modifiée à chaque ouverture (v10.38).
      const minute = (x) => x ? Math.floor(+new Date(x) / 60000) : null;
      const saisie = timeToIso(iso, fd.hhmm);
      const out = {
        day_date: iso, lat: cur.lat, lng: cur.lng, name: (fd.name || "").trim(),
        category: fd.category || "autre", note: (fd.note || "").trim(),
        at_time: minute(saisie) === minute(cur.at_time) ? (cur.at_time || null) : saisie,
        transport: fd.transport || null,
      };
      if (isNew) { out.media_ids = cur.media_ids || []; if (cur.osm_type) { out.osm_type = cur.osm_type; out.osm_id = cur.osm_id; } }
      return out;
    };
    const same = (a, b) => Array.isArray(a) || Array.isArray(b) ? (a || []).join() === (b || []).join()
      : (typeof a === "number" && typeof b === "number") ? Math.abs(a - b) < 1e-6
      : (a ?? "") === (b ?? "");
    const stopChanged = () => { const g = stopFields(), o = stopFields("cur"); return Object.keys(g).filter((k) => !same(g[k], o[k])); };
    const dirty = () => stopChanged().length > 0;
    const STOP_WORDS = { name: "le nom du lieu", category: "la catégorie", at_time: "l'heure",
      transport: "le moyen de locomotion", note: "la note" };
    // La v10.38 retournée : l'accusé de réception nomme ce qu'il a GARDÉ, la question nomme
    // ce qui va PARTIR. « Fermer quand même ? » tout seul ne dit rien de ce qu'on perd.
    const perdu = () => {
      const liste = stopChanged().map((k) => STOP_WORDS[k]).filter(Boolean);
      if (!liste.length) return "";                        // retombe sur la phrase générale
      // Sur un arrêt neuf, l'endroit touché sur la carte et les photos rattachées partent
      // avec : la phrase les nomme aussi, sinon elle ment par omission.
      const nPh = (cur.media_ids || []).length;
      if (isNew) { liste.push("le point posé sur la carte"); if (nPh) liste.push(nPh > 1 ? `ses ${nPh} photos` : "sa photo"); }
      // Une énumération, pas une phrase à accorder : « la note » et « le nom » ne
      // demandent pas le même participe, et une phrase fausse en français se voit.
      const quoi = liste.length > 1 ? `${liste.slice(0, -1).join(", ")} et ${liste[liste.length - 1]}` : liste[0];
      return isNew ? `Cet arrêt ne sera pas créé. Ce qui part : ${quoi}. Fermer quand même ?`
        : `Ce qui n'est pas enregistré : ${quoi}. Fermer quand même ?`;
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fields = stopFields();
      if (!fields.name) return toast("Il faut un nom", "error");
      try {
        if (isNew) { const r = await API.createStop(S.cur.trip.id, fields); S.cur.stops.push(r); }
        else { const r = await API.updateStop(st.id, fields); Object.assign(st, r); }
        saveLocal(); redraw(); m.close(); if (after) after();
        toast(isNew ? "Arrêt ajouté" : "Arrêt modifié", "ok");
      } catch (err) { errToast(err, 6000); }
    };
    const del = $("#sdel", m.el);
    if (del) del.onclick = async () => {
      if (!(await confirm("Supprimer cet arrêt ? (les photos, elles, restent)"))) return;
      try { await API.deleteStop(st.id); S.cur.stops = S.cur.stops.filter((x) => x.id !== st.id); saveLocal(); redraw(); m.close(); if (after) after(); }
      catch (err) { errToast(err); }
    };
  }
  // L'heure d'un arrêt se saisit en heure locale ; on la range en date complète du jour.
  function toLocalTime(iso) { const d = new Date(iso); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  function timeToIso(dayIso, hhmm) {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return null;
    const [y, mo, dd] = dayIso.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
    return new Date(y, mo - 1, dd, h, mi).toISOString();
  }

  // ---- Geste 2 : en touchant la carte ----
  // On demande à OpenStreetMap les lieux nommés autour du point, avec leur type.
  // Un doigt sur l'un d'eux remplit le nom et la catégorie : Sophie ne tape rien.
  async function stopFromPoint(iso, pt) {
    BVMAP.ping(S.map, pt.lat, pt.lng);
    CV.progress("Qu'y a-t-il ici ?…");
    let near = [];
    try { near = (await CV.placesAround([pt], 130))[0] || []; } catch { near = []; }
    CV.progress(null);
    // L'heure vient de la photo la plus proche — la première s'il y en a plusieurs.
    // Pas de photo à côté : pas d'heure du tout.
    const t = CV.timeFromNearbyPhotos(S.cur.media, iso, pt, 150);
    const base = { lat: +pt.lat.toFixed(6), lng: +pt.lng.toFixed(6), at_time: t.at, media_ids: t.ids };
    if (!near.length) {
      toast("Aucun lieu connu ici : donne-lui son nom", "info", 4000);
      return stopForm(iso, { ...base, name: "", category: "autre" }, () => renderPanel());
    }
    const m = openModal(`<h2>Qu'est-ce qu'il y a ici ?</h2>
      <p class="small muted" style="margin-top:-6px">D'après OpenStreetMap, autour de l'endroit que tu as touché.</p>
      <div class="stop-picks">${near.map((f, i) => `<button type="button" class="stop-pick" data-i="${i}">
        <span class="pic">${stopPicto(f.category)}</span>
        <span class="grow" style="min-width:0"><span class="nm">${esc(f.name)}</span>
          <span class="meta">${esc(placeMeta(f))}</span></span></button>`).join("")}</div>
      <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><span class="grow"></span>
        <button type="button" class="btn" id="sp-manual">Nommer moi-même</button></div>`);
    $$(".stop-pick", m.el).forEach((b) => b.onclick = () => {
      const f = near[+b.dataset.i];
      m.close();
      stopForm(iso, { ...base, lat: +f.lat.toFixed(6), lng: +f.lng.toFixed(6), name: f.name, category: f.category, osm_type: f.osm_type, osm_id: f.osm_id }, () => renderPanel());
    });
    $("#sp-manual", m.el).onclick = () => { m.close(); stopForm(iso, { ...base, name: "", category: "autre" }, () => renderPanel()); };
  }

  // ---- Geste 1 : à partir des photos ----
  // Le regroupement fait cinq ou six propositions, pas soixante. Un seul appel à
  // OpenStreetMap pour toute la journée. Et on ne décide rien : on propose.
  async function findStops(iso, after) {
    const taken = new Set(stopsOf(iso).map((x) => `${x.osm_type || ""}/${x.osm_id || ""}`).filter((k) => k !== "/"));
    const already = stopsOf(iso);
    let groups = CV.photoClusters(S.cur.media, iso);
    // Un groupe déjà couvert par un arrêt existant ne se repropose pas
    groups = groups.filter((g) => !already.some((st) => CV.haversine(st, g) < 120));
    if (!groups.length) return toast("Tous tes groupes de photos ont déjà leur arrêt", "info", 4000);
    CV.progress("On demande à OpenStreetMap…");
    let lists = [];
    try { lists = await CV.placesAround(groups, 130); } catch { lists = []; }
    CV.progress(null);
    const offline = !lists.some((l) => l && l.length);
    const m = openModal(`<h2>Les arrêts de la journée</h2>
      <p class="small muted" style="margin-top:-6px">${groups.length} groupe${groups.length > 1 ? "s" : ""} de photos. ${offline ? "OpenStreetMap n'a rien renvoyé — tu peux nommer chaque lieu toi-même." : "Tu tranches : rien n'est enregistré sans toi."}</p>
      <div id="sp-list"></div>
      <div class="actions sticky"><span class="grow"></span><button type="button" class="btn primary" data-close>Terminé</button></div>`, { wide: true });

    const render = () => {
      $("#sp-list", m.el).innerHTML = groups.map((g, i) => {
        if (g._done) return `<div class="stop-proposal done"><div class="lead">✓ ${esc(g._doneName)} — arrêt ajouté.</div></div>`;
        if (g._skipped) return "";
        const cands = (lists[i] || []).filter((f) => !taken.has(`${f.osm_type}/${f.osm_id}`));
        const best = cands[0];
        const from = g.at ? fmtTime(g.at) : "", to = g.until && g.until !== g.at ? fmtTime(g.until) : "";
        const quand = from ? (to ? `de ${from} à ${to}` : `vers ${from}`) : "";
        return `<div class="stop-proposal" data-i="${i}">
          <div class="lead">Tes <b>${g.items.length} photos</b>${quand ? " " + quand : ""} sont autour ${best ? `du <b>${esc(best.name)}</b>${best.kind ? ` (${esc(best.kind)})` : ""}` : "d'un endroit qu'OpenStreetMap ne connaît pas"}. En faire un arrêt ?</div>
          <div class="thumbs">${g.items.slice(0, 8).map((x) => `<img src="${API.publicUrl(x.thumb_path || x.path)}" alt="" loading="lazy">`).join("")}</div>
          <div class="row" style="flex-wrap:wrap">
            ${best ? `<button type="button" class="btn sm primary" data-act="yes" data-i="${i}">${ic("check", "sm")} Oui</button>` : ""}
            ${cands.length > 1 || !best ? `<button type="button" class="btn sm" data-act="other" data-i="${i}">Un autre lieu</button>` : ""}
            <button type="button" class="btn sm ghost" data-act="no" data-i="${i}">Non</button>
          </div></div>`;
      }).join("") || `<p class="small muted">Plus rien à proposer.</p>`;
      bind();
    };

    // Enregistre l'arrêt d'un groupe. L'heure = celle de la PREMIÈRE photo du groupe.
    const add = async (i, place, name, category) => {
      const g = groups[i];
      try {
        const r = await API.createStop(S.cur.trip.id, {
          day_date: iso,
          lat: place ? +place.lat.toFixed(6) : g.lat, lng: place ? +place.lng.toFixed(6) : g.lng,
          name, category: category || "autre", at_time: g.at || null, media_ids: g.ids,
          osm_type: place ? place.osm_type : null, osm_id: place ? place.osm_id : null,
        });
        S.cur.stops.push(r);
        if (place) taken.add(`${place.osm_type}/${place.osm_id}`);
        g._done = true; g._doneName = name;
        saveLocal(); redraw(); render(); if (after) after();
      } catch (err) { errToast(err, 6000); }
    };

    const bind = () => {
      $$("[data-act]", m.el).forEach((b) => b.onclick = async () => {
        const i = +b.dataset.i, g = groups[i], cands = (lists[i] || []).filter((f) => !taken.has(`${f.osm_type}/${f.osm_id}`));
        if (b.dataset.act === "no") { g._skipped = true; return render(); }
        if (b.dataset.act === "yes") { const f = cands[0]; busy(b, true); await add(i, f, f.name, f.category); return; }
        // « Un autre lieu » : les autres candidats du même groupe, ou le nom à la main
        const pick = openModal(`<h2>Un autre lieu</h2>
          <p class="small muted" style="margin-top:-6px">Autour de tes ${g.items.length} photos.</p>
          ${cands.length ? `<div class="stop-picks">${cands.map((f, j) => `<button type="button" class="stop-pick" data-j="${j}">
            <span class="pic">${stopPicto(f.category)}</span>
            <span class="grow" style="min-width:0"><span class="nm">${esc(f.name)}</span>
              <span class="meta">${esc(placeMeta(f))}</span></span></button>`).join("")}</div>`
            : `<p class="small muted">OpenStreetMap ne connaît rien de nommé à cet endroit.</p>`}
          <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><span class="grow"></span>
            <button type="button" class="btn" id="sp-hand">Nommer moi-même</button></div>`);
        $$(".stop-pick", pick.el).forEach((pb) => pb.onclick = async () => {
          const f = cands[+pb.dataset.j]; pick.close(); await add(i, f, f.name, f.category);
        });
        $("#sp-hand", pick.el).onclick = () => {
          pick.close();
          stopForm(iso, { lat: g.lat, lng: g.lng, at_time: g.at, media_ids: g.ids, name: "", category: "autre" }, () => { g._done = true; g._doneName = "Cet arrêt"; render(); if (after) after(); });
        };
      });
    };
    render();
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
            : `<div class="row" style="flex-wrap:nowrap"><button class="btn secondary grow" id="gps-beacon">${ic("pin")} Balise</button></div>
               <p class="help"><b>Balise</b> : un point maintenant, même sans réseau. Pour une belle trace de rando, une montre ou une appli puis « Importer un GPX » reste la meilleure option.</p>`}
      </div>
      <div class="row between" style="margin:18px 0 6px"><span class="kicker">Traces · ${S.cur.tracks.length}</span>
        <div class="row"><button class="btn sm" id="gpx-import">${ic("upload", "sm")} Importer un GPX</button>${S.cur.tracks.length ? `<button class="btn sm ghost" id="gpx-export">${ic("download", "sm")}</button>` : ""}</div>
        <input type="file" id="gpx-file" accept=".gpx,application/gpx+xml" multiple hidden></div>
      ${S.cur.tracks.length ? "" : `<p class="help">Aucune trace pour l'instant : pose des balises, démarre un suivi ou importe un GPX (montre, Strava, Komoot…).</p>`}
      ${[...S.cur.tracks].reverse().map((t) => `<div class="track-item" data-id="${t.id}"><span class="swatch" style="background:${CV.colorForDay(dl, t.day_date)}"></span>
        <span class="grow" style="min-width:0"><span style="display:block;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name || "Trace")}</span><span class="small muted">${t.day_date ? fmtDate(t.day_date, false) : "sans date"} · ${t.points.length} pts · ${t.source === "gpx" ? "GPX" : t.source === "manual" ? "balises" : t.source === "route" ? "itinéraire estimé" : "suivi"}${t._pending ? ` · <span class="chip draft">à envoyer</span>` : ""}</span></span>
        <span class="dist">${fmtDistance(t.distance_m)}</span>${ic("chevron-right", "sm")}</div>`).join("")}`;
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
    // #22 : le GPX importé n'a pas toujours d'altitude (montre, appli) — on la déduit du relief sans bloquer l'import
    if (navigator.onLine) CV.fillElevations(S.cur, enrichElevation).catch(() => { });
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
        txt += `\n==== ${n != null ? "Jour " + n + " — " : ""}${fmtDate(iso)}${d?.title ? " — " + d.title : ""} ====\n\n${d?.story || ""}\n`;
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
        <button class="btn sm primary" id="copy">Copier le lien</button>${navigator.share ? `<button class="btn sm" id="nshare">${ic("send", "sm")} Envoyer</button>` : ""}<a class="btn sm ghost" href="${esc(url)}&apercu=1">Voir comme un proche</a></div>
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
        // v10.2 — location.replace() puis location.reload() se marchaient dessus : la page se
        // rechargeait AVANT que le « ?join= » ne soit retiré, et l'invitation, tout juste
        // consommée, répondait « déjà utilisée ». history.replaceState change l'adresse
        // immédiatement, sans naviguer ; le reload qui suit repart donc de la bonne.
        onCancel: () => { history.replaceState(null, "", location.pathname); location.reload(); },
        onJoined: (tripId) => { history.replaceState(null, "", location.pathname + "#trip=" + tripId); location.reload(); },
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
        <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><span class="grow"></span>
          <button class="btn primary" type="submit">Changer</button></div></form>`);
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
