// ============================================================
//  Page publique : le récit du voyage, lu par les proches (sans compte)
// ============================================================
(function () {
  const { esc, nl2p, toast, fmtDate, fmtDistance, dayNumber, cfg, ic } = CV;
  const bigAudio = CV.bigAudio, bindBigAudio = CV.bindBigAudio;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = $("#share-root");
  const params = new URLSearchParams(location.search);
  const token = params.get("t");
  // #12 · « Voir comme un proche » : ?apercu=<prénom> (ou 1). Dans ce mode, la
  // page s'ouvre déconnectée, ne garde AUCUN repère (ni « déjà vu », ni prénom)
  // et n'envoie aucun commentaire — Sophie voit donc exactement la page d'un
  // proche qui arrive pour la première fois.
  const preview = params.get("apercu");
  const previewName = preview && preview !== "1" ? preview : "";
  if (preview && window.API && API.useAnonymousSession) API.useAnonymousSession();
  const NAME_KEY = "cv_visitor_name";
  const VISIT_KEY = "cv_last_visit_" + token;

  let D = null, map = null, drawn = null, dayFilter = null, lastVisit = 0, introDone = false, introStarted = false, replayWanted = false;
  try { if (!preview) lastVisit = Date.parse(localStorage.getItem(VISIT_KEY) || "") || 0; } catch { }
  const isNew = (ts) => !!lastVisit && !!ts && Date.parse(ts) > lastVisit;
  const isMobile = () => window.matchMedia("(max-width: 640px)").matches;
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = () => /Android/.test(navigator.userAgent);
  const friendly = (e) => (window.OFF ? OFF.friendly(e) : (e && e.message) || String(e));

  function fail(msg) {
    root.innerHTML = `<div class="center" style="text-align:center"><div class="brand"><div class="logo"><img src="icons/icon.svg" alt=""></div><h1>Oups</h1><p style="font-family:var(--font-body);color:var(--muted);font-size:16px">${esc(msg)}</p></div></div>`;
  }

  async function load() {
    if (!token) return fail("Ce lien est incomplet.");
    if (!API.isConfigured()) return fail("L'application n'est pas encore configurée.");
    try { D = await API.getSharedTrip(token); } catch (e) { return fail("Impossible de charger le voyage : " + e.message); }
    if (!D) return fail("Ce voyage n'existe pas ou n'est plus partagé.");
    if (window.MEMBERS) MEMBERS.setCrew(D.authors || [], null);
    document.title = D.trip.title + " — Bonvoyage";
    render();
    // un aperçu ne laisse aucune trace : le repère « déjà vu » n'est pas posé
    const stamp = () => { if (preview) return; try { localStorage.setItem(VISIT_KEY, new Date().toISOString()); } catch { } };
    let stamped = false; const stampOnce = () => { if (!stamped) { stamped = true; stamp(); } };
    window.addEventListener("scroll", () => { if (scrollY > innerHeight * .6) stampOnce(); }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") stampOnce(); });
    setTimeout(stampOnce, 90000);
    // Lien direct vers une journée (#day-2026-09-05)
    if (location.hash.startsWith("#day-")) setTimeout(() => $(location.hash)?.scrollIntoView({ behavior: "smooth" }), 400);
  }

  // Compteur de kilomètres animé (900 ms, sortie douce)
  function animateKm() {
    const el = $(".km"); if (!el || !window.requestAnimationFrame) return;
    const target = +el.dataset.km, t0 = performance.now();
    const step = (t) => { const p = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtDistance(target * e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  function homeTipHtml() {
    const inApp = /WhatsApp|FBAN|FBAV|Instagram|Messenger|Line\//i.test(navigator.userAgent);
    const ios = inApp
      ? `Sur iPhone : vous lisez ceci dans ${/WhatsApp/i.test(navigator.userAgent) ? "WhatsApp" : "une application"} ; touchez d'abord <b>Ouvrir dans Safari</b> (bouton en haut ou en bas de l'écran, ou l'icône « … »), puis dans Safari, bouton <b>Partager</b> (le carré avec une flèche) et <b>« Sur l'écran d'accueil »</b>.`
      : `Sur iPhone : dans Safari, bouton <b>Partager</b> (le carré avec une flèche, en bas de l'écran) puis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.`;
    const and = `Sur Android : dans Chrome, menu <b>⋮</b> (en haut à droite) puis <b>« Ajouter à l'écran d'accueil »</b>.`;
    return `<b>📱 Pour retrouver ce voyage facilement</b><br>${isIOS() ? ios : isAndroid() ? and : ios + "<br>" + and}<br>
      Une icône Bonvoyage (Valdo, la petite valise) apparaît sur votre téléphone : elle ouvre toujours le voyage à jour et signale les nouveautés depuis votre dernière visite.`;
  }
  // Manifest généré à la volée pour que l'icône Android ouvre bien CE voyage
  function installManifest() {
    if (!D) return;
    const base = location.href.split("#")[0];
    const icon = new URL("icons/icon-512.png", location.href).href;
    const m = { name: D.trip.title, short_name: D.trip.title.slice(0, 12), start_url: base, scope: new URL("./", location.href).href, display: "standalone",
      background_color: "#FFF8EF", theme_color: "#123F66", icons: [{ src: icon, sizes: "512x512", type: "image/png" }, { src: new URL("icons/icon-maskable-512.png", location.href).href, sizes: "512x512", type: "image/png", purpose: "maskable" }] };
    const link = document.createElement("link"); link.rel = "manifest";
    link.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: "application/manifest+json" }));
    document.head.appendChild(link);
  }

  // Le bandeau d'aperçu, en haut de la page, avec la sortie de secours.
  function previewBarHtml() {
    return `<div id="apercu-bar" style="position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:10px;
      padding:10px 14px;background:#123F66;color:#fff;font-size:14px;font-weight:700;line-height:1.35">
      <span style="flex:1;min-width:0">Aperçu · voici le carnet tel que ${previewName ? esc(previewName) + " le voit" : "le voient tes proches"}.</span>
      <button type="button" class="btn sm glass" id="apercu-close" style="flex:none">Fermer</button></div>`;
  }
  // Le lien de cette page, sans l'ancre ni le repère d'aperçu.
  function shareLink() {
    const u = new URL(location.href); u.hash = ""; u.searchParams.delete("apercu"); return u.href;
  }
  // #16 · Le proche peut faire suivre le carnet, par la feuille de partage de
  // son téléphone. « Envoyer » et « Copier le lien » restent deux gestes
  // séparés : une phrase collée dans une barre d'adresse devient une recherche.
  function shareBlockHtml() {
    return `<div class="home-tip" id="share-block" style="text-align:center">
      <b>Faire suivre ce carnet</b>
      <div class="small muted" style="margin:4px 0 12px">À quelqu'un d'autre de la famille, qui aimerait le suivre aussi.</div>
      <div class="row" style="justify-content:center">
        ${navigator.share ? `<button class="btn primary" id="sb-send">${ic("send", "sm")} Envoyer</button>` : ""}
        <button class="btn" id="sb-copy">Copier le lien</button>
      </div></div>`;
  }
  function bindShareBlock() {
    const send = $("#sb-send");
    if (send) send.onclick = async () => {
      try { await navigator.share({ title: D.trip.title, text: `Suis notre voyage « ${D.trip.title} » : `, url: shareLink() }); }
      catch { /* annulé */ }
    };
    const copy = $("#sb-copy");
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText(shareLink()); toast("Lien copié", "ok"); }
      catch { toast(shareLink(), "info", 10000); }
    };
  }

  function dayList() {
    const set = new Set([...D.days.map((d) => d.day_date), ...D.tracks.map((t) => t.day_date), ...D.media.map((m) => m.day_date)].filter(Boolean));
    return [...set].sort();
  }
  function thumb(m) { return API.publicUrl(m.thumb_path || (m.kind === "photo" ? m.path : "")); }

  function render() {
    const t = D.trip, days = dayList();
    const km = D.tracks.reduce((a, x) => a + (x.distance_m || 0), 0);
    const tripStats = CV.dayStats(D.tracks);
    const canReplay = D.tracks.some((t) => (t.points || []).length >= 2) || D.media.some((m) => m.lat != null);
    const cover = t.cover_path ? API.publicUrl(t.cover_path) : (D.media.find((m) => m.kind === "photo") ? API.publicUrl(D.media.find((m) => m.kind === "photo").path) : "");
    const newDays = days.filter((iso) => { const d = D.days.find((x) => x.day_date === iso); return (d && isNew(d.published_at)) || D.media.some((m) => m.day_date === iso && isNew(m.created_at)); });
    const showTip = isMobile() && !isStandalone() && !lastVisit;
    root.innerHTML = `
      ${preview ? previewBarHtml() : ""}
      ${newDays.length ? `<div class="news-pill"><div><i></i>Du nouveau : ${newDays.map((iso) => { const n = dayNumber(D.trip, iso); return `<a href="#day-${iso}">${n ? "Jour " + n : CV.fmtDateShort(iso)}</a>`; }).join(", ")}</div></div>` : ""}
      <header class="share-hero" ${cover ? `style="background-image:url('${cover}')"` : ""}>
        <div class="inner">${t.subtitle ? `<div class="sub">${esc(t.subtitle)}</div>` : ""}<h1>${esc(t.title)}</h1>
          ${MEMBERS.isShared() ? `<div class="crew">${(D.authors || []).map((a) => MEMBERS.pill(a.id, { solid: true, force: true })).join("")}</div>` : ""}
          <div class="stats">
            ${t.start_date ? `<span>${ic("calendar", "sm")} ${fmtDate(t.start_date, false)}${t.end_date ? " → " + fmtDate(t.end_date, false) : ""}</span>` : ""}
            ${days.length ? `<span>${ic("clock", "sm")} ${days.length} jour${days.length > 1 ? "s" : ""}</span>` : ""}
            ${km ? `<span>${ic("route", "sm")} <b class="km" data-km="${km}">${fmtDistance(km)}</b></span>` : ""}
            ${D.media.length ? `<span>${ic("camera", "sm")} ${D.media.length} photo${D.media.length > 1 ? "s" : ""}</span>` : ""}
            ${tripStats.hasAlt && tripStats.gain ? `<span title="Dénivelé positif cumulé">↗ ${tripStats.gain.toLocaleString("fr-FR")} m</span>` : ""}
          </div>
          ${canReplay ? `<button class="btn replay-btn" id="btn-replay">${ic("play")} Suivre le parcours</button>` : ""}
          <div id="notif-zone"></div>
          <a class="scroll-hint" href="#story-start" aria-label="Faire défiler pour lire le récit">${ic("chevron-right")}<span>Faire défiler pour lire</span></a></div>
      </header><div id="story-start"></div>
      ${showTip ? `<div class="home-tip top" id="tip-top">${homeTipHtml()}<button class="btn sm" id="tip-close" style="margin-top:8px">J'ai compris</button></div>` : ""}
      <div class="share-map-wrap" id="map-wrap"><div id="share-map"></div>
        <div class="legend" id="legend"></div>
        <div class="map-actions"><button class="btn sm glass" id="map-expand">${ic("expand", "sm")} Plein écran</button>${canReplay ? `<button class="btn sm glass" id="map-replay">${ic("play", "sm")} Suivre le parcours</button>` : ""}</div>
        <div class="replay-overlay" id="replay-overlay" hidden><div class="caption" id="replay-caption"></div><div class="replay-ctls"><button class="btn sm" id="replay-pause" title="Pause">${ic("pause", "sm")}</button><button class="btn sm" id="replay-next" title="Journée suivante">${ic("chevron-right", "sm")} Suivant</button><button class="btn sm" id="replay-stop">${ic("stop", "sm")} Retour au récit</button></div></div></div>
      <main class="story">
        ${t.description ? `<div class="intro">${nl2p(t.description)}</div>` : ""}
        ${days.map((iso) => daySection(iso, days)).join("")}
        ${!days.length ? `<p class="muted" style="text-align:center">Le récit n'a pas encore commencé… revenez bientôt !</p>` : ""}
      </main>
      ${shareBlockHtml()}
      <footer class="share-footer"><div class="logo"><img src="icons/icon.svg" alt="Valdo"></div><span class="wordmark"><span>bon</span><b>voyage</b></span><span class="hand">tes voyages, racontés</span><span class="version">v${window.BV_VERSION || "?"}</span>
        <div class="home-tip">${homeTipHtml()}</div>
      </footer>`;
    animateKm();
    bindShareBlock();
    const ab = $("#apercu-close");
    if (ab) ab.onclick = () => { window.close(); setTimeout(() => { location.href = "index.html"; }, 250); };
    const tc = $("#tip-close"); if (tc) tc.onclick = () => $("#tip-top").remove();
    installManifest();

    renderNotifButton();
    // Sur mobile, un doigt fait défiler la page, deux doigts bougent la carte (geste coopératif) ; « Agrandir » libère la carte
    map = BVMAP.create("share-map", { cooperative: true, globe: true, terrain: false, controlsPos: "bottom-right" });
    const setBig = (big) => {
      const w = $("#map-wrap"); w.classList.toggle("big", big);
      $("#map-expand").innerHTML = big ? `${ic("close", "sm")} Réduire` : `${ic("expand", "sm")} Plein écran`;
      BVMAP.setCooperative(map, !big);
      document.body.classList.toggle("map-big", big);
      setTimeout(() => { BVMAP.resize(map); if (!map.replaying && introDone && drawn && drawn.bounds) BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 14 }); }, 250);
    };
    $("#map-expand").onclick = () => setBig(!$("#map-wrap").classList.contains("big"));
    const startReplay = (only = null) => {
      if (!drawn || map.replaying) return;
      if (dayFilter && !only) { dayFilter = null; draw(false); renderLegend(days); }
      if (only && dayFilter !== only) { dayFilter = only; draw(false); renderLegend(days); }
      const wasBig = $("#map-wrap").classList.contains("big");
      if (isMobile()) setBig(true);
      $("#map-wrap").scrollIntoView({ behavior: "smooth", block: "center" });
      const go = () => {
        $("#replay-overlay").hidden = false; $("#replay-next").hidden = !!only;
        const pauseBtn = $("#replay-pause"); pauseBtn.innerHTML = ic("pause", "sm"); pauseBtn.title = "Pause";
        BVMAP.replay(map, D, {
          dayList: days, only, speed: +D.trip.replay_speed || 1, dayNumber: (iso) => dayNumber(D.trip, iso),
          onPause: (p) => { pauseBtn.innerHTML = p ? ic("play", "sm") : ic("pause", "sm"); pauseBtn.title = p ? "Reprendre" : "Pause"; },
          onDay: (iso, info) => { const d = D.days.find((x) => x.day_date === iso) || {}; $("#replay-caption").innerHTML = `<b>${info.n ? "Jour " + info.n : fmtDate(iso, false)}</b>${d.title ? ` · ${esc(d.title)}` : ""}${d.place ? `<span>${esc(d.place)}</span>` : ""}${info.km ? `<span>${fmtDistance(info.km * 1000)}${info.photos ? ` · ${info.photos} photo${info.photos > 1 ? "s" : ""}` : ""}</span>` : ""}`; },
          onDone: () => {
            $("#replay-overlay").hidden = true;
            if (isMobile() && !wasBig) setBig(false);   // on ne laisse personne enfermé dans la carte plein écran
            if (!only) showRecap();
          },
        });
      };
      if (introDone) setTimeout(go, isMobile() ? 400 : 700); else replayWanted = only || true;
    };
    $$(".day-replay", root).forEach((b) => b.onclick = () => startReplay(b.dataset.iso));
    $("#replay-stop").onclick = () => { if (map.stopReplay) map.stopReplay(); };
    $("#replay-pause").onclick = () => { const c = map.replayCtl; if (!c) return; c.paused ? c.resume() : c.pause(); };
    $("#replay-next").onclick = () => { const c = map.replayCtl; if (c) c.next(); };
    // Carte-bilan à la fin du survol complet : chiffres du voyage et invitation à laisser un mot
    const showRecap = () => {
      const km = D.tracks.reduce((a, x) => a + (x.distance_m || 0), 0);
      const back = document.createElement("div"); back.className = "modal-back recap-back";
      back.innerHTML = `<div class="modal recap"><img src="icons/valdo.svg" alt="" class="recap-valdo"><h2>${esc(D.trip.title)}</h2>
        <div class="recap-stats">${days.length ? `<div><b>${days.length}</b><small>jour${days.length > 1 ? "s" : ""}</small></div>` : ""}${km ? `<div><b>${fmtDistance(km)}</b><small>parcourus</small></div>` : ""}${D.media.length ? `<div><b>${D.media.length}</b><small>photo${D.media.length > 1 ? "s" : ""}</small></div>` : ""}</div>
        <div class="actions" style="justify-content:center;flex-wrap:wrap">${D.trip.allow_comments && D.days.length ? `<button class="btn primary" id="recap-comment">${ic("message", "sm")} Laisser un mot</button>` : ""}<button class="btn" id="recap-close">Retour au récit</button></div></div>`;
      $("#modal-host").appendChild(back);
      const close = () => back.remove();
      $("#recap-close", back).onclick = close; back.addEventListener("click", (e) => { if (e.target === back) close(); });
      const rc = $("#recap-comment", back); if (rc) rc.onclick = () => { close(); const last = D.days[D.days.length - 1]; commentForm({ dayId: last.id }); };
    };

    const rb = $("#btn-replay"); if (rb) rb.onclick = () => startReplay();
    const mr = $("#map-replay"); if (mr) mr.onclick = () => startReplay();
    draw(false);
    renderLegend(days);
    // Intro : le globe tourne vers le voyage quand la carte arrive à l'écran (une seule fois)
    const runIntro = () => {
      if (introStarted) return; introStarted = true;
      const done = () => { introDone = true; if (replayWanted) { const w = replayWanted; replayWanted = false; startReplay(w === true ? null : w); } };
      if (BVMAP.reducedMotion()) { if (drawn && drawn.bounds) BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 13, animate: false }); done(); }
      else BVMAP.intro(map, drawn && drawn.bounds, done);
    };
    if ("IntersectionObserver" in window) {
      const mo = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { runIntro(); mo.disconnect(); } }, { threshold: .35 });
      mo.observe($("#map-wrap"));
    } else runIntro();
    bindBigAudio(root);
    $$(".gallery figure", root).forEach((f) => f.onclick = () => viewer(D.media.find((m) => m.id === f.dataset.id)));
    $$(".day-comment-btn", root).forEach((b) => b.onclick = () => commentForm({ dayId: b.dataset.day }));
    $$(".day-section .kicker", root).forEach((k) => k.onclick = () => { if (map.replaying) return; dayFilter = dayFilter === k.dataset.iso ? null : k.dataset.iso; draw(introDone); renderLegend(days); $("#map-wrap").scrollIntoView({ behavior: "smooth", block: "center" }); });
    $$(".step-card.has-cover", root).forEach((c) => c.onclick = () => viewer(D.media.find((m) => m.id === c.dataset.id)));

    // Quand on scrolle sur une journée, la carte la met en avant
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting && !dayFilter) highlight(e.target.dataset.iso);
      }, { rootMargin: "-45% 0px -45% 0px" });
      $$(".day-section", root).forEach((s) => io.observe(s));
    }
  }

  function daySection(iso, days) {
    const d = D.days.find((x) => x.day_date === iso) || {};
    const n = dayNumber(D.trip, iso);
    const media = D.media.filter((m) => m.day_date === iso);
    const km = D.tracks.filter((x) => x.day_date === iso).reduce((a, x) => a + (x.distance_m || 0), 0);
    const comments = D.comments.filter((c) => c.day_id && c.day_id === d.id);
    const color = CV.colorForDay(days, iso);
    const st = CV.dayStats(D.tracks.filter((x) => x.day_date === iso));
    const cover = media.find((m) => m.kind === "photo") || null;
    const hasPath = D.tracks.some((t) => t.day_date === iso && (t.points || []).length >= 2) || media.filter((m) => m.lat != null).length >= 2;
    const chips = [km ? `${ic("route", "sm")} ${fmtDistance(km)}` : "", st.duration_s ? `${ic("clock", "sm")} ${CV.fmtDuration(st.duration_s)}` : "", st.hasAlt && st.gain ? `↗ ${st.gain} m` : "", st.hasAlt && st.maxAlt != null ? `⛰ ${st.maxAlt} m` : "", media.length ? `${ic("camera", "sm")} ${media.length}` : ""].filter(Boolean);
    return `<section class="day-section" data-iso="${iso}" id="day-${iso}">
      <div class="kicker" data-iso="${iso}" title="Voir cette journée sur la carte"><span class="dot" style="background:${color}"></span>${n ? `Jour ${n} · ` : ""}${fmtDate(iso)}</div>
      <h2>${esc(d.title || (n ? `Jour ${n}` : fmtDate(iso, false)))}${isNew(d.published_at) ? `<span class="new-mark">nouveau</span>` : ""}${MEMBERS.pill(d.author_id)}</h2>
      ${hasPath ? `<button class="btn sm day-replay" data-iso="${iso}" style="margin:-4px 0 12px">${ic("play", "sm")} Suivre cette journée</button>` : ""}
      ${cover || d.place || chips.length ? `<div class="step-card${cover ? " has-cover" : ""}" ${cover ? `style="background-image:url('${API.publicUrl(cover.path)}')"` : ""} data-id="${cover ? cover.id : ""}">
        <div class="step-inner">${d.place ? `<div class="place">${ic("pin", "sm")} ${esc(d.place)}</div>` : ""}${chips.length ? `<div class="chips">${chips.map((c) => `<span>${c}</span>`).join("")}</div>` : ""}</div></div>` : ""}
      ${st.hasAlt && st.profile.length > 2 ? `<div class="profile-wrap">${CV.profileSvg(st.profile, color)}<div class="small muted">Profil d'altitude · ${st.minAlt} → ${st.maxAlt} m</div></div>` : ""}
      ${media.length ? `<div class="gallery">${media.map((m) => `<figure data-id="${m.id}" class="${D.comments.some((c) => c.media_id === m.id) ? "has-comments" : ""}${isNew(m.created_at) ? " is-new" : ""}">
          ${MEMBERS.dot(m.author_id)}
          ${m.kind === "video" && !m.thumb_path ? `<video src="${API.publicUrl(m.path)}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${thumb(m)}" alt="${esc(m.caption)}" loading="lazy">`}
          ${m.caption || m.kind === "video" || m.audio_path || m.transport ? `<figcaption>${m.transport && BVMAP.MODES[m.transport] ? BVMAP.MODES[m.transport].icon + " " : ""}${m.kind === "video" ? "▶ " : ""}${m.audio_path ? "🎙 " : ""}${esc(m.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
      ${d.audio_path ? bigAudio(API.publicUrl(d.audio_path), "Écouter le récit du jour") : ""}
      ${MEMBERS.signedList((D.voices || []).filter((v) => v.day_id === d.id), { label: "Le mot du jour", icon: ic("mic", "sm"),
        render: (v) => bigAudio(API.publicUrl(v.audio_path), "Écouter " + (MEMBERS.name(v.author_id) || "le mot du jour"), true) })}
      ${d.story ? `<div class="story-text">${nl2p(d.story)}</div>${MEMBERS.isShared() ? `<span class="story-sign">Récit de ${esc(MEMBERS.name(d.author_id))}</span>` : ""}` : ""}
      ${MEMBERS.signedList((D.stories || []).filter((x) => x.day_id === d.id), { label: "Et de leur côté…", icon: ic("edit", "sm"),
        render: (x) => `<div class="text">${nl2p(x.body)}</div>` })}
      ${d.id ? `<div class="day-comments">${comments.map(commentHtml).join("")}
        ${D.trip.allow_comments ? `<button class="btn day-comment-btn" data-day="${d.id}">${ic("message")} Laisser un mot sur cette journée</button>` : ""}</div>` : ""}
    </section>`;
  }
  function commentHtml(c) {
    const initial = (c.author || "?").trim().charAt(0).toUpperCase();
    return `<div class="comment${isNew(c.created_at) ? " is-new" : ""}"><span class="avatar">${esc(initial)}</span><div class="body"><b>${esc(c.author)}</b><span class="when">${new Date(c.created_at).toLocaleDateString("fr-FR")}</span>${isNew(c.created_at) ? `<span class="new-mark">nouveau</span>` : ""}${c.body ? `<div>${esc(c.body)}</div>` : ""}${c.audio_path ? bigAudio(API.publicUrl(c.audio_path), `Écouter ${esc(c.author)}`, true) : ""}</div></div>`;
  }
  // #9 · Le prénom n'est demandé qu'au premier message, puis mémorisé dans le
  // navigateur du proche. La lecture est protégée : en navigation privée,
  // Safari fait échouer localStorage, et le formulaire ne doit pas disparaître.
  function knownName() {
    if (preview) return "";   // en aperçu, on veut voir le formulaire du tout premier message
    try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; }
  }
  function commentFormHtml() {
    const known = knownName();
    return `<form class="comment-form" id="cf">
        ${known ? `<div class="small muted" id="cf-who">Vous écrivez en tant que <b>${esc(known)}</b> · <a href="#" id="cf-not-me">pas vous ?</a></div>` : ""}
        <input name="author" placeholder="Votre prénom (obligatoire)" required maxlength="60" value="${esc(known)}" ${known ? "hidden" : ""}>
        <textarea name="body" placeholder="Votre message écrit…" maxlength="2000"></textarea>
        <div class="kicker">ou un message vocal</div><div id="cf-rec"></div>
        <div class="actions sticky"><button type="button" class="btn ghost" id="cf-cancel" hidden>Annuler</button><button class="btn primary" type="submit">${ic("send")} Envoyer</button></div></form>`;
  }
  function bindNotMe(form) {
    const a = $("#cf-not-me", form); if (!a) return;
    a.onclick = (e) => { e.preventDefault(); $("#cf-who", form).remove(); const inp = form.author; inp.hidden = false; inp.value = ""; inp.focus(); };
  }

  function draw(fit) {
    drawn = BVMAP.draw(map, D, { dayFilter, dayList: dayList(), thumbUrl: thumb, onMediaClick: viewer, dayNumber: (iso) => dayNumber(D.trip, iso),
      onDayClick: (iso) => { $(`#day-${iso}`)?.scrollIntoView({ behavior: "smooth" }); } });
    if (fit && drawn.bounds) BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 14 });
  }
  function highlight(iso) {
    if (!introDone || map.replaying) return;
    const trs = D.tracks.filter((t) => t.day_date === iso), ms = D.media.filter((m) => m.day_date === iso && m.lat != null);
    const pts = [...trs.flatMap((t) => t.points.filter((p) => p && p.lat != null)), ...ms];
    const b = BVMAP.boundsOf(pts);
    if (b) BVMAP.flyToBounds(map, b, { padding: 48, maxZoom: 13, duration: 1200, keepPitch: true });
  }
  function renderLegend(days) {
    const lg = $("#legend");
    lg.innerHTML = days.map((iso) => { const n = dayNumber(D.trip, iso); return `<button style="background:${CV.colorForDay(days, iso)}" class="${!dayFilter || dayFilter === iso ? "active" : ""}" data-iso="${iso}">${n ? "J" + n : CV.fmtDateShort(iso)}</button>`; }).join("");
    $$("button", lg).forEach((b) => b.onclick = () => {
      if (map.replaying) return;
      dayFilter = dayFilter === b.dataset.iso ? null : b.dataset.iso;
      draw(introDone); renderLegend(days);
      if (dayFilter) $(`#day-${dayFilter}`)?.scrollIntoView({ behavior: "smooth" });
    });
  }

  // ---------- Notifications : « Me prévenir des nouveautés » ----------
  const pushSupported = () => !!(cfg.VAPID_PUBLIC_KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
  function urlB64ToUint8(s) { const p = "=".repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  async function currentSubscription() {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function renderNotifButton() {
    const z = $("#notif-zone"); if (!z) return;
    if (!cfg.VAPID_PUBLIC_KEY) return;
    if (isIOS() && !isStandalone()) {
      z.innerHTML = `<button class="btn" id="notif-how">${ic("bell")} Être prévenu(e) des nouveautés</button>`;
      $("#notif-how", z).onclick = () => {
        const back = document.createElement("div"); back.className = "modal-back";
        back.innerHTML = `<div class="modal"><h2>Recevoir les nouveautés</h2><p>Sur iPhone, il faut d'abord mettre ce voyage sur votre écran d'accueil :</p><div class="home-tip">${homeTipHtml()}</div><p style="margin-top:12px">Ensuite, ouvrez le voyage depuis la nouvelle icône Bonvoyage et appuyez sur <b>« Me prévenir des nouveautés »</b>.</p><div class="actions"><button class="btn primary" id="ok">Compris</button></div></div>`;
        $("#modal-host").appendChild(back); $("#ok", back).onclick = () => back.remove(); back.onclick = (e) => { if (e.target === back) back.remove(); };
      };
      return;
    }
    if (!pushSupported()) return;
    const sub = await currentSubscription().catch(() => null);
    z.innerHTML = sub
      ? `<button class="btn" id="notif-off">${ic("check")} Vous serez prévenu(e) · <u>désactiver</u></button>`
      : `<button class="btn" id="notif-on">${ic("bell")} Me prévenir des nouveautés</button>`;
    const on = $("#notif-on", z); if (on) on.onclick = subscribe;
    const off = $("#notif-off", z); if (off) off.onclick = unsubscribe;
  }
  async function subscribe() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return toast("Notifications refusées par le téléphone", "error");
      const reg = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(cfg.VAPID_PUBLIC_KEY) });
      await API.subscribePush(token, sub.toJSON());
      toast("C'est noté ! Vous recevrez une notification à chaque journée publiée.", "ok", 5000);
      renderNotifButton();
    } catch (e) { toast("Impossible d'activer : " + e.message, "error", 5000); }
  }
  async function unsubscribe() {
    try {
      const sub = await currentSubscription();
      if (sub) { await API.unsubscribePush(token, sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
      toast("Notifications désactivées"); renderNotifButton();
    } catch (e) { toast(e.message, "error"); }
  }

  // ---------- Visionneuse + commentaires ----------
  function viewer(m) {
    if (!m) return;
    const list = D.media, i = list.indexOf(m);
    const comments = D.comments.filter((c) => c.media_id === m.id);
    const back = document.createElement("div"); back.className = "modal-back";
    back.innerHTML = `<div class="modal wide">
      <div class="viewer-media">${m.kind === "video" ? `<video src="${API.publicUrl(m.path)}" controls playsinline autoplay></video>` : `<img src="${API.publicUrl(m.path)}" alt="">`}<span class="count">${i + 1} / ${list.length}</span></div>
      <div class="row between"><div><b>${esc(m.caption || "")}</b><div class="small muted">${m.day_date ? fmtDate(m.day_date) : ""}${m.taken_at ? " · " + CV.fmtTime(m.taken_at) : ""}</div>${MEMBERS.pill(m.author_id)}${m.audio_path ? bigAudio(API.publicUrl(m.audio_path), "Écouter le commentaire", true) : ""}</div>
        <div class="row" style="flex-wrap:nowrap"><button class="btn icon" id="prev" ${i <= 0 ? "disabled" : ""} title="Photo précédente">${ic("chevron-left")}</button><button class="btn icon" id="next" ${i >= list.length - 1 ? "disabled" : ""} title="Photo suivante">${ic("chevron-right")}</button><button class="btn icon" id="close" title="Fermer">${ic("close")}</button></div></div>
      <p class="small muted" style="margin:6px 0 0">${list.length > 1 ? `Photo ${i + 1} / ${list.length} · glissez pour passer à la suivante` : ""}</p>
      <h3 style="margin:16px 0 8px;font-size:17px">Commentaires</h3>
      <div id="clist">${comments.map(commentHtml).join("") || `<p class="muted small">Soyez le premier à laisser un mot !</p>`}</div>
      ${D.trip.allow_comments ? commentFormHtml() : ""}
    </div>`;
    $("#modal-host").appendChild(back);
    const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
    const go = (dir) => { const nx = list[i + dir]; if (nx) { close(); viewer(nx); } };
    back.onclick = (e) => { if (e.target === back) close(); };
    $("#close", back).onclick = close;
    $("#prev", back).onclick = () => go(-1);
    $("#next", back).onclick = () => go(1);
    const onKey = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); };
    document.addEventListener("keydown", onKey);
    // Glisser à gauche / droite pour changer de photo, vers le bas pour fermer
    let t0 = null;
    const media = $(".viewer-media", back);
    media.addEventListener("touchstart", (e) => { t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
    media.addEventListener("touchend", (e) => {
      if (!t0) return; const dx = e.changedTouches[0].clientX - t0.x, dy = e.changedTouches[0].clientY - t0.y; t0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      else if (dy > 80 && Math.abs(dy) > Math.abs(dx)) close();
    });
    bindBigAudio(back);
    const cf = $("#cf", back);
    if (cf) { const rec = CV.audioRecorder($("#cf-rec", cf), { label: "Enregistrer un message vocal", maxSeconds: 120 }); bindNotMe(cf);
      cf.onsubmit = (e) => { e.preventDefault(); submitComment(cf, rec, { mediaId: m.id }, (c) => { $("#clist", back).insertAdjacentHTML("beforeend", commentHtml(c)); bindBigAudio(back); rec.reset(); }); }; }
  }

  function commentForm({ dayId }) {
    const back = document.createElement("div"); back.className = "modal-back";
    back.innerHTML = `<div class="modal"><h2>Un mot sur cette journée</h2>${commentFormHtml()}</div>`;
    $("#modal-host").appendChild(back);
    const close = () => back.remove();
    const cancel = $("#cf-cancel", back); cancel.hidden = false; cancel.onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
    const rec = CV.audioRecorder($("#cf-rec", back), { label: "Enregistrer un message vocal", maxSeconds: 120 }); bindNotMe($("#cf", back));
    $("#cf", back).onsubmit = (e) => { e.preventDefault(); submitComment(e.target, rec, { dayId }, (c) => {
      close();
      // On insère le commentaire sans reconstruire la page (la position de lecture est conservée)
      const day = D.days.find((x) => x.id === dayId); const sec = day && $(`#day-${day.day_date} .day-comments`);
      if (sec) { $(".day-comment-btn", sec).insertAdjacentHTML("beforebegin", commentHtml(c)); bindBigAudio(sec); }
    }); };
  }

  async function submitComment(form, rec, { mediaId, dayId }, onDone) {
    if (preview) return toast("Aperçu : le message n'est pas envoyé.", "info", 4500);
    const author = form.author.value.trim(), body = form.body.value.trim(), blob = rec.getBlob();
    if (!author) return toast("Indiquez votre prénom", "error");
    if (!body && !blob) return toast("Écrivez ou enregistrez un message", "error");
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const audioPath = blob ? await API.uploadAnonAudio(D.trip.id, blob, CV.audioExt(blob.type)) : null;
      const c = await API.addSharedComment(token, mediaId, dayId, author, body, audioPath);
      D.comments.push(c);
      try { localStorage.setItem(NAME_KEY, author); } catch { }
      form.body.value = ""; toast("Merci pour votre message !", "ok");
      onDone(c);
    } catch (err) { toast(friendly(err), "error", 5000); }
    btn.disabled = false;
  }

  load();
})();
