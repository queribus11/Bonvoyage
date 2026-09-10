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

  let D = null, map = null, drawn = null, dayFilter = null, stopDay = null, lastVisit = 0, introDone = false, introStarted = false, replayWanted = false, stuck = false;
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
    // #37 · « Du nouveau » quittait la carte pour ne pas rester posé dessus en permanence :
    // il descend en tête du récit, sur une ligne discrète, une seule fois par page.
    const newsLine = newDays.length
      ? `<div class="news-line"><i></i>Du nouveau depuis ta dernière visite : ${newDays.map((iso) => { const n = dayNumber(D.trip, iso); return `<a href="#day-${iso}">${n ? "Jour " + n : CV.fmtDateShort(iso)}</a>`; }).join(", ")}</div>`
      : "";
    root.innerHTML = `
      ${preview ? previewBarHtml() : ""}
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
      <div id="map-sentinel" aria-hidden="true"></div>
      <div class="share-map-wrap" id="map-wrap"><div id="share-map"></div>
        <div class="map-caption" id="map-caption" hidden></div>
        <div class="map-rail"><button type="button" class="map-btn" id="map-expand" title="Plein écran" aria-label="Afficher la carte en plein écran">${ic("expand")}</button>${canReplay ? `<button type="button" class="map-btn" id="map-replay" title="Suivre cette journée" aria-label="Suivre cette journée sur la carte">${ic("play")}</button>` : ""}<button type="button" class="map-btn" id="map-layers" title="Fonds de carte" aria-label="Choisir le fond de carte" aria-expanded="false">${ic("layers")}</button></div>
        <div class="replay-overlay" id="replay-overlay" hidden><div class="caption" id="replay-caption"></div><div class="replay-ctls"><button class="btn sm" id="replay-pause" title="Pause">${ic("pause", "sm")}</button><button class="btn sm" id="replay-next" title="Journée suivante">${ic("chevron-right", "sm")} Suivant</button><button class="btn sm" id="replay-stop">${ic("stop", "sm")} Retour au récit</button></div></div></div>
      <main class="story">
        ${newsLine}
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
    // #37 · Dans la page : un doigt fait défiler la page, le pincement zoome la carte, pas
    // de rotation. En plein écran : tout est manipulable. Les « gestes coopératifs » de
    // MapLibre et leur message « deux doigts pour bouger la carte » ne servent plus.
    map = BVMAP.create("share-map", { globe: true, terrain: false, controlsPos: "top-right", reading: true });
    BVMAP.setPageGestures(map, true);
    const setBig = (big) => {
      const w = $("#map-wrap"); w.classList.toggle("big", big);
      // #37 · Une infobulle ne s'affiche JAMAIS sur un écran tactile : le bouton qui fait
      // SORTIR porte donc un mot lisible. Les deux autres peuvent rester muets.
      const eb = $("#map-expand");
      eb.innerHTML = big ? `${ic("close")}<span class="lbl">Retour au récit</span>` : ic("expand");
      eb.classList.toggle("wide", big);
      eb.title = big ? "Réduire la carte" : "Plein écran";
      eb.setAttribute("aria-label", big ? "Réduire la carte" : "Afficher la carte en plein écran");
      BVMAP.setPageGestures(map, !big);
      document.body.classList.toggle("map-big", big);
      setTimeout(() => { BVMAP.resize(map); if (!map.replaying && introDone && drawn && drawn.bounds) BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 14 }); }, 250);
    };
    $("#map-expand").onclick = () => setBig(!$("#map-wrap").classList.contains("big"));
    const startReplay = (only = null) => {
      if (!drawn || map.replaying) return;
      if (dayFilter && !only) { dayFilter = null; draw(false); refreshCaption(); }
      if (only && dayFilter !== only) { dayFilter = only; draw(false); refreshCaption(); }
      const wasBig = $("#map-wrap").classList.contains("big");
      if (isMobile()) setBig(true);
      $("#map-wrap").scrollIntoView({ behavior: "smooth", block: "center" });
      const go = () => {
        $("#replay-overlay").hidden = false; $("#replay-next").hidden = !!only;
        const pauseBtn = $("#replay-pause"); pauseBtn.innerHTML = ic("pause", "sm"); pauseBtn.title = "Pause";
        BVMAP.replay(map, D, {
          dayList: days, only, speed: +D.trip.replay_speed || 1, dayNumber: (iso) => dayNumber(D.trip, iso),
          onPause: (p) => { pauseBtn.innerHTML = p ? ic("play", "sm") : ic("pause", "sm"); pauseBtn.title = p ? "Reprendre" : "Pause"; },
          // #37 · Le cartouche du survol parle la même langue que la légende de la carte :
          // le disque de couleur du jour, le nom fort, le nom discret. Les chiffres passent
          // sur une seconde ligne dans la même bulle. Sans titre, la commune passe en gras ;
          // sans chiffres, la seconde ligne n'existe pas.
          onDay: (iso, info) => {
            const d = D.days.find((x) => x.day_date === iso) || {};
            const strong = d.title || d.place || (info.n ? "Jour " + info.n : fmtDate(iso, false));
            const light = d.title && d.place ? d.place : "";
            const meta = [info.km ? fmtDistance(info.km * 1000) : "", info.photos ? `${info.photos} photo${info.photos > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
            $("#replay-caption").innerHTML = `<div class="line">${info.n ? `<i class="num" style="background:${CV.colorForDay(days, iso)}">${info.n}</i>` : ""}<b>${esc(strong)}</b>${light ? `<span>${esc(light)}</span>` : ""}</div>${meta ? `<div class="meta">${esc(meta)}</div>` : ""}`;
          },
          onDone: () => {
            $("#replay-overlay").hidden = true;
            if (isMobile() && !wasBig) setBig(false);   // on ne laisse personne enfermé dans la carte plein écran
            if (!only) showRecap();
          },
        });
      };
      if (introDone) setTimeout(go, isMobile() ? 400 : 700); else replayWanted = only || true;
    };
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
    // #37 · Le ▶ du rail joue LA JOURNÉE QU'ON EST EN TRAIN DE LIRE (il remplace le bouton
    // « Suivre cette journée » qui le doublait sous la carte). Tant qu'aucune journée n'est
    // lue, il joue tout le voyage — comme le bouton du haut de page.
    const mr = $("#map-replay"); if (mr) mr.onclick = () => startReplay(dayFilter || followDay || null);
    // #37 · La carte n'a qu'UNE SEULE zone de contrôles. Les quatre onglets de fond et le
    // zoom + / − viennent se ranger SOUS le rail, dans la même colonne : plus rien ne peut
    // recouvrir la légende ni la mention Esri. On garde les deux rangées telles quelles, on
    // ne fait que les déplacer, puis les montrer et les cacher.
    const rail = $(".map-rail");
    const layersRow = $("#share-map .bv-layers"), zoomRow = $("#share-map .maplibregl-ctrl-group");
    if (rail && layersRow) rail.appendChild(layersRow);
    if (rail && zoomRow) rail.appendChild(zoomRow);
    const ml = $("#map-layers");
    if (ml) ml.onclick = () => {
      const on = !$("#map-wrap").classList.contains("show-layers");
      $("#map-wrap").classList.toggle("show-layers", on);
      ml.classList.toggle("on", on);
      ml.setAttribute("aria-expanded", on ? "true" : "false");
    };
    draw(false);
    // Intro : le globe tourne vers le voyage quand la carte arrive à l'écran (une seule fois)
    const runIntro = () => {
      if (introStarted) return; introStarted = true;
      const done = () => { introDone = true; schedule(); if (replayWanted) { const w = replayWanted; replayWanted = false; startReplay(w === true ? null : w); } };
      if (BVMAP.reducedMotion()) { if (drawn && drawn.bounds) BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 13, animate: false }); done(); }
      else BVMAP.intro(map, drawn && drawn.bounds, done);
    };
    if ("IntersectionObserver" in window) {
      const mo = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { runIntro(); mo.disconnect(); } }, { threshold: .35 });
      mo.observe($("#map-wrap"));
    } else runIntro();
    bindBigAudio(root);
    $$(".gallery figure, .day-lead", root).forEach((f) => f.onclick = () => viewer(D.media.find((m) => m.id === f.dataset.id)));
    $$(".day-comment-btn", root).forEach((b) => b.onclick = () => commentForm({ dayId: b.dataset.day }));
    $$(".day-section .kicker", root).forEach((k) => k.onclick = () => { if (map.replaying) return; dayFilter = dayFilter === k.dataset.iso ? null : k.dataset.iso; draw(introDone); refreshCaption(); showMap(); });
    // Toucher un arrêt recentre la carte dessus — même geste que le clic sur une journée
    $$(".stop-trail li", root).forEach((li) => li.onclick = () => {
      if (map.replaying) return;
      const st = (D.stops || []).find((x) => x.id === li.dataset.stop);
      if (!st) return;
      const iso = st.day_date;
      if (dayFilter !== iso) { dayFilter = iso; draw(false); refreshCaption(); }
      showMap();
      setTimeout(() => { BVMAP.goTo(map, st.lat, st.lng); BVMAP.ping(map, st.lat, st.lng); }, 420);
    });

    // #8 · La carte suit la lecture : elle se colle en haut et se recadre toute seule
    mediaById = new Map(D.media.map((m) => [m.id, m]));
    map.map.on("movestart", (e) => { if (e && e.originalEvent) touchedAt = Date.now(); });   // le proche manipule la carte : on le laisse tranquille
    armSticky();
    armFollow();
    refreshCaption();
    let resizeT = 0;
    window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(armFollow, 300); }, { passive: true });
  }

  // Le fil des arrêts d'une journée (#5) : sous les statistiques, au-dessus des photos.
  // Aucun arrêt → rien du tout : pas de cadre vide, pas de titre orphelin.
  function stopsOf(iso) {
    return (D.stops || []).filter((x) => x.day_date === iso)
      .sort((a, b) => (a.at_time || "").localeCompare(b.at_time || "") || ((a.sort_order || 0) - (b.sort_order || 0)));
  }
  function stopTrailHtml(iso) {
    const list = stopsOf(iso);
    if (!list.length) return "";
    const picto = (c) => (window.BV_STOP_PICTOS && (BV_STOP_PICTOS[c] || BV_STOP_PICTOS.autre)) || "";
    return `<ol class="stop-trail">${list.map((st) => `<li data-stop="${st.id}" title="Voir sur la carte">
      <span class="pic">${picto(st.category)}</span>
      <span class="txt"><span class="nm">${esc(st.name)}</span>
        <span class="meta">${esc(CV.stopCategoryLabel(st.category))}</span>
        ${st.note ? `<span class="note">${esc(st.note)}</span>` : ""}</span>
      ${st.at_time ? `<span class="hr">${CV.fmtTime(st.at_time)}</span>` : ""}</li>`).join("")}</ol>`;
  }

  function daySection(iso, days) {
    const d = D.days.find((x) => x.day_date === iso) || {};
    const n = dayNumber(D.trip, iso);
    const media = D.media.filter((m) => m.day_date === iso);
    const km = D.tracks.filter((x) => x.day_date === iso).reduce((a, x) => a + (x.distance_m || 0), 0);
    const comments = D.comments.filter((c) => c.day_id && c.day_id === d.id);
    const color = CV.colorForDay(days, iso);
    const st = CV.dayStats(D.tracks.filter((x) => x.day_date === iso));
    // #37 · La première photo sort de la grille : pleine largeur, avec sa légende
    // manuscrite en dessous. Les autres restent dans la grille, bord à bord.
    const lead = media.find((m) => m.kind === "photo") || null;
    const rest = lead ? media.filter((m) => m !== lead) : media;
    // La distance est passée sur la ligne de date : elle ne s'affiche plus deux fois.
    const chips = [st.duration_s ? `${ic("clock", "sm")} ${CV.fmtDuration(st.duration_s)}` : "", st.hasAlt && st.gain ? `↗ ${st.gain} m` : "", st.hasAlt && st.maxAlt != null ? `⛰ ${st.maxAlt} m` : "", media.length ? `${ic("camera", "sm")} ${media.length}` : ""].filter(Boolean);
    const mark = isNew(d.published_at) ? `<span class="new-mark">nouveau</span>` : "";
    const pill = MEMBERS.pill(d.author_id);
    // Le titre de repli « Jour n » a disparu : la carte le dit déjà, juste au-dessus.
    // Le récit n'affiche que le VRAI titre de la journée — et rien quand elle n'en a pas.
    return `<section class="day-section" data-iso="${iso}" id="day-${iso}">
      <div class="kicker" data-iso="${iso}" title="Voir cette journée sur la carte"><span class="dot" style="background:${color}"></span>${fmtDate(iso)}${km ? ` · ${fmtDistance(km)}` : ""}${d.title ? "" : mark + pill}</div>
      ${d.title ? `<h2>${esc(d.title)}${mark}${pill}</h2>` : ""}
      ${lead ? `<figure class="day-lead" data-id="${lead.id}"${lead.lat != null ? " data-geo" : ""}>
        ${MEMBERS.dot(lead.author_id)}
        <img src="${API.publicUrl(lead.path)}" alt="${esc(lead.caption)}" loading="lazy">
        ${lead.caption ? `<figcaption>${lead.transport && BVMAP.MODES[lead.transport] ? BVMAP.MODES[lead.transport].icon + " " : ""}${lead.audio_path ? "🎙 " : ""}${esc(lead.caption)}</figcaption>` : ""}</figure>` : ""}
      ${rest.length ? `<div class="gallery">${rest.map((m) => `<figure data-id="${m.id}"${m.lat != null ? " data-geo" : ""} class="${D.comments.some((c) => c.media_id === m.id) ? "has-comments" : ""}${isNew(m.created_at) ? " is-new" : ""}">
          ${MEMBERS.dot(m.author_id)}
          ${m.kind === "video" && !m.thumb_path ? `<video src="${API.publicUrl(m.path)}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${thumb(m)}" alt="${esc(m.caption)}" loading="lazy">`}
          ${m.caption || m.kind === "video" || m.audio_path || m.transport ? `<figcaption>${m.transport && BVMAP.MODES[m.transport] ? BVMAP.MODES[m.transport].icon + " " : ""}${m.kind === "video" ? "▶ " : ""}${m.audio_path ? "🎙 " : ""}${esc(m.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : ""}
      ${d.place || chips.length ? `<div class="step-card"><div class="step-inner">${d.place ? `<div class="place">${ic("pin", "sm")} ${esc(d.place)}</div>` : ""}${chips.length ? `<div class="chips">${chips.map((c) => `<span>${c}</span>`).join("")}</div>` : ""}</div></div>` : ""}
      ${st.hasAlt && st.profile.length > 2 ? `<div class="profile-wrap">${CV.profileSvg(st.profile, color)}<div class="small muted">Profil d'altitude · ${st.minAlt} → ${st.maxAlt} m</div></div>` : ""}
      ${stopTrailHtml(iso)}
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
    showStopsFor(dayFilter || stopDay);
    if (fit && drawn.bounds) BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 14 });
  }
  // Les pictos des arrêts se posent sur la trace de LA journée qu'on est en train de
  // lire — ils suivent le défilement du récit. Toute la carte d'un coup serait illisible
  // sur un long voyage, et une journée sans arrêt ne montre rien de nouveau.
  function showStopsFor(iso) {
    stopDay = iso || null;
    BVMAP.drawStopMarkers(map, D, {
      dayFilter: stopDay,
      onStopClick: (st) => { $(`#day-${st.day_date}`)?.scrollIntoView({ behavior: "smooth" }); },
    });
  }
  // #37 · Le recadrage sur la journée qu'on vient d'atteindre, au tempo des journées
  // (réglage « D », choisi au doigt). Retourne la durée employée : celui qui appelle doit
  // savoir combien de temps la carte est occupée, pour ne pas enchaîner par-dessus.
  function highlight(iso, calm) {
    if (!introDone || map.replaying) return 0;
    const trs = D.tracks.filter((t) => t.day_date === iso), ms = D.media.filter((m) => m.day_date === iso && m.lat != null);
    const pts = [...trs.flatMap((t) => t.points.filter((p) => p && p.lat != null)), ...ms];
    const b = BVMAP.boundsOf(pts);
    showStopsFor(iso);
    if (!b) return 0;
    if (calm) { BVMAP.fitBounds(map, b, { padding: 48, maxZoom: 13, duration: 0, keepPitch: true }); return 0; }
    return BVMAP.flyToDay(map, b, { padding: 48, maxZoom: 13, keepPitch: true });
  }

  // ---------- #8 · La carte suit la lecture ----------
  // Deux façons de faire : « photo » — la carte se pose sur le lieu de la photo qu'on
  // regarde (Polarsteps) — ou « jour » — elle se recadre sur la journée qu'on lit
  // (FindPenguins). Rien ne bouge tant que l'intro n'est pas finie, pendant le survol,
  // quand le proche a choisi une journée lui-même, ni pendant qu'il manipule la carte.
  // Et si le carnet n'a aucune photo située ni aucune trace, rien ne s'arme : pas de
  // contenu, pas de bloc.
  //
  // Sophie a d'abord choisi « jour » (v10.12), puis rejugé « photo » sur son vrai carnet
  // d'Écosse : c'est « photo » que voient les proches depuis la v10.13, sans rien ajouter
  // au lien. `&suivi=jour` et `&suivi=off` restent l'aiguilleur de retour arrière.
  const FOLLOW_MODES = ["photo", "jour", "off"], FOLLOW_DEFAULT = "photo";
  const askedMode = (params.get("suivi") || "").toLowerCase();
  const followMode = FOLLOW_MODES.includes(askedMode) ? askedMode : FOLLOW_DEFAULT;
  const seenDays = new Set(), seenShots = new Set();
  let dayIO = null, shotIO = null, followDay = null, followShot = null, touchedAt = 0, tickReq = 0, sizeReq = 0, mediaById = new Map();
  // #37 · UN SEUL MOUVEMENT À LA FOIS. `applyFollow` est rappelée à CHAQUE IMAGE du
  // défilement. Ce repère dit jusqu'à quand la carte est occupée — il est posé par LES DEUX
  // mouvements du suivi : le recadrage d'une journée et le vol vers une photo.
  // Mesuré sur la vraie page, avec un défilement de lecture ordinaire (v10.20) : un
  // recadrage démarrait par-dessus un autre, et un recadrage coupait le vol vers une photo
  // au bout de 0,9 s. La caméra repartait chaque fois d'un mouvement déjà lancé — d'où la
  // brusquerie et l'accélération, qu'aucun réglage de durée ne pouvait corriger.
  // En v10.18 ce repère ne protégeait que le vol vers la photo ; il protège désormais tout.
  let busyUntil = 0, waitReq = 0;
  // Le temps de respiration entre le recadrage d'une journée et le vol vers sa photo.
  const PAUSE_MS = 300;
  // Occupée : on ne démarre rien, et on repasse à la fin. Au retour, `applyFollow` regarde
  // où en est VRAIMENT la lecture — si trois journées ont défilé, la carte va à la bonne,
  // elle ne rejoue pas la file d'attente.
  function laterOn() {
    clearTimeout(waitReq);
    waitReq = setTimeout(schedule, Math.max(60, busyUntil - Date.now() + 120));
  }

  const canFollow = () => !!D && (D.media.some((m) => m.lat != null) || D.tracks.some((t) => (t.points || []).length));
  // Un carnet sans aucune photo située retombe sur le suivi par journée, comme avant.
  const photoFollow = () => followMode === "photo" && !!D && D.media.some((m) => m.lat != null);

  // #37 · Une photo prise loin de tout le reste de la journée — à la maison avant le départ,
  // ou mal située par le téléphone — n'emmène pas la carte avec elle. On mesure sa distance
  // à sa plus proche voisine du jour (autre photo située, ou point de trace) : au-delà de
  // 8 km ET de quatre fois l'écart habituel de la journée, la carte reste sur la journée
  // entière. Une journée de 300 km de route n'est pas gênée : ses photos y sont régulièrement
  // espacées. La trace est échantillonnée (120 points au plus) : mesurer point à point
  // gèlerait la page sur une trace GPS d'une journée entière.
  const LONELY_M = 8000, LONELY_RATIO = 4;
  const lonelyById = new Map(), daySampleCache = new Map();
  function daySample(iso) {
    if (daySampleCache.has(iso)) return daySampleCache.get(iso);
    const photos = D.media.filter((m) => m.day_date === iso && m.lat != null).map((m) => ({ lat: m.lat, lng: m.lng, id: m.id }));
    const line = [];
    for (const t of D.tracks) {
      if (t.day_date !== iso) continue;
      const ps = (t.points || []).filter((p) => p && p.lat != null);
      const step = Math.max(1, Math.ceil(ps.length / 120));
      for (let i = 0; i < ps.length; i += step) line.push({ lat: ps[i].lat, lng: ps[i].lng });
    }
    const v = { photos, all: photos.concat(line) };
    daySampleCache.set(iso, v);
    return v;
  }
  function nearestOther(pts, p, skipId) {
    let best = Infinity;
    for (const q of pts) { if (skipId && q.id === skipId) continue; const dd = CV.haversine(p, q); if (dd < best) best = dd; }
    return best;
  }
  function isLonely(m) {
    if (lonelyById.has(m.id)) return lonelyById.get(m.id);
    const { photos, all } = daySample(m.day_date);
    let out = false;
    if (all.length >= 2) {
      const d0 = nearestOther(all, { lat: m.lat, lng: m.lng }, m.id);
      const gaps = photos.filter((p) => p.id !== m.id).map((p) => nearestOther(all, p, p.id)).filter((x) => isFinite(x)).sort((a, b) => a - b);
      const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
      out = isFinite(d0) && d0 > LONELY_M && d0 > LONELY_RATIO * usual;
    }
    lonelyById.set(m.id, out);
    return out;
  }
  // Collée, la carte est déjà sous les yeux : inutile de remonter la page jusqu'à elle.
  function showMap() { if (!stuck) $("#map-wrap")?.scrollIntoView({ behavior: "smooth", block: "center" }); }

  // La ligne de lecture : le milieu de ce qui reste visible SOUS la carte collée.
  function readLine() {
    const w = $("#map-wrap");
    const top = stuck && w ? Math.max(0, w.getBoundingClientRect().bottom) : 0;
    return top + (innerHeight - top) / 2;
  }
  // Une bande fine autour de cette ligne : c'est elle que les blocs du récit traversent.
  function bandMargin() {
    const t = Math.min(88, Math.max(6, Math.round(readLine() / innerHeight * 100) - 6));
    return `-${t}% 0px -${Math.max(0, 100 - t - 12)}% 0px`;
  }
  function nearestToLine(set) {
    const line = readLine();
    let best = null, bd = Infinity;
    for (const el of set) { const r = el.getBoundingClientRect(); const d = Math.abs((r.top + r.bottom) / 2 - line); if (d < bd) { bd = d; best = el; } }
    return best;
  }
  function schedule() { if (!tickReq) tickReq = requestAnimationFrame(() => { tickReq = 0; applyFollow(); }); }

  // Pendant que la carte change de hauteur, MapLibre doit refaire sa toile.
  // Et ce n'est qu'une fois la hauteur stabilisée qu'on sait où passe la ligne de
  // lecture : les observateurs se reposent à la fin, pas pendant.
  function keepSize(done) {
    cancelAnimationFrame(sizeReq);
    const t0 = performance.now();
    const step = () => {
      BVMAP.resize(map);
      if (performance.now() - t0 < 700) { sizeReq = requestAnimationFrame(step); return; }
      sizeReq = 0; if (done) done();
    };
    sizeReq = requestAnimationFrame(step);
  }
  function armSticky() {
    const sen = $("#map-sentinel"), wrap = $("#map-wrap");
    if (!sen || !wrap || !("IntersectionObserver" in window)) return;
    // Rien à suivre (aucune photo située, aucune trace) : la carte ne se colle pas
    // et le carnet reste exactement comme avant. Pas de contenu, pas de bloc.
    if (followMode === "off" || !canFollow()) return;
    new IntersectionObserver((entries) => {
      for (const e of entries) {
        const on = !e.isIntersecting && e.boundingClientRect.top <= 0;
        if (on === stuck) continue;
        stuck = on;
        wrap.classList.toggle("stuck", on);
        document.body.classList.toggle("map-stuck", on);
        keepSize(armFollow);   // la ligne de lecture a bougé avec la hauteur de la carte
      }
    }, { rootMargin: "-8px 0px 0px 0px", threshold: 0 }).observe(sen);
  }

  function armFollow() {
    if (!("IntersectionObserver" in window) || followMode === "off" || !canFollow()) return;
    if (dayIO) dayIO.disconnect();
    if (shotIO) shotIO.disconnect();
    seenDays.clear(); seenShots.clear();
    const rootMargin = bandMargin();
    dayIO = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? seenDays.add(e.target) : seenDays.delete(e.target); schedule(); }, { rootMargin });
    $$(".day-section", root).forEach((s) => dayIO.observe(s));
    if (!photoFollow()) return;
    shotIO = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? seenShots.add(e.target) : seenShots.delete(e.target); schedule(); }, { rootMargin });
    $$(".gallery figure[data-geo], .day-lead[data-geo]", root).forEach((f) => shotIO.observe(f));
  }

  function applyFollow() {
    if (followMode === "off" || !canFollow()) return;
    if (!introDone || map.replaying || dayFilter) { followDay = null; followShot = null; return; }
    if (document.visibilityState === "hidden") return;
    if (Date.now() - touchedAt < 6000) return;
    const sec = nearestToLine(seenDays);
    const iso = sec ? sec.dataset.iso : null;
    const calm = BVMAP.reducedMotion();
    // Remonté au-dessus du récit : la carte remontre tout le voyage.
    if (!iso) {
      const first = $(".day-section", root);
      if (!followDay || !first || first.getBoundingClientRect().top < innerHeight) return;
      if (Date.now() < busyUntil) { laterOn(); return; }
      followDay = null; followShot = null;
      BVMAP.focusMedia(map, null); refreshCaption();
      // Même remède ici : remonter au-dessus du récit peut traverser tout le pays, et
      // 1,2 s y était aussi brutal que sur le passage d'une journée à l'autre.
      if (drawn && drawn.bounds) {
        if (calm) { BVMAP.fitBounds(map, drawn.bounds, { padding: 40, maxZoom: 14, duration: 0 }); busyUntil = 0; }
        else busyUntil = Date.now() + BVMAP.flyToDay(map, drawn.bounds, { padding: 40, maxZoom: 14 });
      }
      return;
    }
    // Nouvelle journée : on montre d'abord la journée entière — on voit où l'on est.
    if (followDay !== iso) {
      // La carte est encore en mouvement : on ne coupe pas, on y va à la fin.
      if (Date.now() < busyUntil) { laterOn(); return; }
      followDay = iso; followShot = null;
      BVMAP.focusMedia(map, null);
      refreshCaption();
      const ms = highlight(iso, calm);
      // La carte reste occupée le temps du recadrage ET de la respiration qui suit : c'est
      // ce qui garantit que le vol vers la photo part d'une carte immobile.
      busyUntil = Date.now() + ms + (ms ? PAUSE_MS : 0);
      if (photoFollow()) setTimeout(schedule, calm ? 60 : ms + PAUSE_MS);
      return;
    }
    if (!photoFollow()) return;
    // Le mouvement en cours va jusqu'au bout : on ne le coupe pas. `followShot` n'est pas
    // consommé ici, donc le vol vers la photo aura bien lieu ensuite — au rendez-vous déjà
    // pris, ou au repassage que `laterOn` programme.
    if (Date.now() < busyUntil) { laterOn(); return; }
    const fig = nearestToLine(seenShots);
    const m = fig ? mediaById.get(fig.dataset.id) : null;
    if (!m || m.lat == null || m.day_date !== iso || followShot === m.id) return;
    // #37 · Un petit déplacement glisse, un grand fait monter la caméra avant de redescendre :
    // traverser dix kilomètres au ras du sol donnait la nausée. C'est `goTo` qui décide.
    followShot = m.id;
    if (isLonely(m)) return;   // photo perdue au loin : la carte reste sur la journée
    BVMAP.focusMedia(map, m.id);
    refreshCaption(m);
    busyUntil = Date.now() + BVMAP.goTo(map, m.lat, m.lng);
  }

  // La pastille qui dit ce que la carte montre. Rien à dire → pas de pastille.
  function refreshCaption(m) {
    const el = $("#map-caption"); if (!el) return;
    const iso = dayFilter || followDay;
    BVMAP.setActiveDay(map, iso);   // c'est elle qui garde sa couleur sur le tracé
    // Le ▶ du rail dit ce qu'il va jouer : la journée qu'on lit, ou tout le voyage.
    const mr = $("#map-replay");
    if (mr) { const lbl = iso ? "Suivre cette journée" : "Suivre le parcours"; mr.title = lbl; mr.setAttribute("aria-label", lbl + " sur la carte"); }
    const html = followMode === "off" || !canFollow() ? "" : (iso ? dayLabel(iso, m) : `<b>Tout le voyage</b>`);
    el.innerHTML = html; el.hidden = !html;
  }
  // #37 · Le numéro du jour dans un disque de couleur, puis LE LIEU de la photo qu'on
  // regarde : le nom de l'arrêt (#5) auquel elle appartient, précédé de la commune.
  // Jamais la légende écrite sous la photo : elle est déjà là, et peut faire trois lignes.
  function stopOfMedia(m) {
    if (!m || !m.id) return null;
    return (D.stops || []).find((x) => x.day_date === m.day_date && (x.media_ids || []).includes(m.id)) || null;
  }
  function dayLabel(iso, m) {
    const d = D.days.find((x) => x.day_date === iso) || {};
    const n = dayNumber(D.trip, iso);
    const st = stopOfMedia(m);
    const commune = d.place || "", precis = (st && st.name) || "";
    const strong = commune || precis || (n ? "" : CV.fmtDateShort(iso));
    const light = commune && precis ? precis : "";
    return `${n ? `<i class="num" style="background:${CV.colorForDay(dayList(), iso)}">${n}</i>` : ""}${strong ? `<b>${esc(strong)}</b>` : ""}${light ? `<span>${esc(light)}</span>` : ""}`;
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

  // ---------- Visionneuse plein écran ----------
  // #1 · La photo prend tout l'écran sur fond sombre : on glisse pour passer à la
  // suivante (dans la journée), on pince pour agrandir, on tire vers le bas — ou on
  // appuie sur le bouton retour du téléphone — pour refermer. Les mots des proches
  // attendent dans un tiroir qu'on fait monter.
  let lbOpen = false;   // une seule visionneuse à la fois

  // Un audio lancé depuis la visionneuse continuerait de jouer après la fermeture :
  // le lecteur « gros bouton » garde son son hors du DOM. On appuie donc sur Pause.
  function hushAudio(root) {
    root.querySelectorAll(".big-audio button").forEach((b) => {
      const u = b.querySelector("svg use");
      if (u && u.getAttribute("href") === "#i-pause") b.click();
    });
  }

  function viewer(m) {
    if (!m || lbOpen) return;
    lbOpen = true;

    // La série, c'est la journée d'où l'on part (une photo sans journée reste seule).
    let list = m.day_date ? D.media.filter((x) => x.day_date === m.day_date) : [];
    if (!list.includes(m)) list = [m];
    let i = list.indexOf(m);
    const dayN = m.day_date ? dayNumber(D.trip, m.day_date) : 0;

    const back = document.createElement("div");
    back.className = "bv-lb";
    back.innerHTML = `<div class="bv-lb-stage" id="lb-stage"><div class="bv-lb-frame" id="lb-frame"></div></div>
      <div class="bv-lb-top">
        <span class="bv-lb-count" id="lb-count"></span>
        <button type="button" class="bv-lb-btn" id="lb-close" title="Fermer" aria-label="Fermer la photo">${ic("close")}</button>
      </div>
      <button type="button" class="bv-lb-nav prev" id="lb-prev" title="Photo précédente" aria-label="Photo précédente">${ic("chevron-left")}</button>
      <button type="button" class="bv-lb-nav next" id="lb-next" title="Photo suivante" aria-label="Photo suivante">${ic("chevron-right")}</button>
      <div class="bv-lb-foot" id="lb-foot"></div>
      <div class="bv-lb-sheet" id="lb-sheet"><button type="button" class="bv-lb-grip" id="lb-sheet-close" aria-label="Fermer les mots"></button><div class="bv-lb-sheet-body" id="lb-sheet-body"></div></div>`;
    $("#modal-host").appendChild(back);
    document.body.classList.add("lb-open");

    const stage = $("#lb-stage", back), frame = $("#lb-frame", back), foot = $("#lb-foot", back);
    const sheet = $("#lb-sheet", back), sheetBody = $("#lb-sheet-body", back);
    const cur = () => list[i];

    // ----- Bouton retour du téléphone : il referme la visionneuse, il ne quitte pas la page
    let pushed = false, closing = false;
    try { history.pushState({ bvlb: 1 }, "", location.href); pushed = true; } catch { }

    function close(fromBack) {
      if (closing) return;
      closing = true; lbOpen = false;
      hushAudio(back); if (rec) { rec.stop(); rec = null; }
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.classList.remove("lb-open");
      back.classList.add("is-out");
      setTimeout(() => back.remove(), 200);
      if (!fromBack && pushed) history.back();
    }
    const onPop = () => close(true);
    window.addEventListener("popstate", onPop);

    // ----- Agrandissement et déplacement de la photo
    let scale = 1, tx = 0, ty = 0;
    const zoomable = () => cur().kind !== "video";
    function apply(anim) {
      frame.style.transition = anim ? "transform .24s cubic-bezier(.22,.61,.36,1)" : "none";
      frame.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      back.classList.toggle("is-zoomed", scale > 1.02);
    }
    function bounds() {
      const el = frame.firstElementChild;
      const bw = stage.clientWidth, bh = stage.clientHeight;
      const nw = (el && (el.naturalWidth || el.videoWidth)) || bw, nh = (el && (el.naturalHeight || el.videoHeight)) || bh;
      let w = bw, h = bw * nh / nw;
      if (h > bh) { h = bh; w = bh * nw / nh; }
      return { x: Math.max(0, (w * scale - bw) / 2), y: Math.max(0, (h * scale - bh) / 2) };
    }
    function clamp() {
      const b = bounds();
      tx = Math.min(b.x, Math.max(-b.x, tx)); ty = Math.min(b.y, Math.max(-b.y, ty));
    }
    function centre() {
      const r = stage.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    function zoomAt(pt) {
      if (!zoomable()) return;
      const c = centre();
      if (scale > 1.02) { scale = 1; tx = 0; ty = 0; }
      else { const s = 2.5; tx = -(pt.clientX - c.x) * (s - 1); ty = -(pt.clientY - c.y) * (s - 1); scale = s; clamp(); }
      apply(true);
    }

    // ----- Les gestes
    let g = null, lastTap = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    stage.addEventListener("touchstart", (e) => {
      // Sur une vidéo, on laisse les commandes de lecture tranquilles
      if (sheetOpen || (cur().kind === "video" && e.target.tagName === "VIDEO")) { g = null; return; }
      if (e.touches.length === 2 && zoomable()) {
        g = { mode: "pinch", d0: dist(e.touches) || 1, s0: scale, m0: mid(e.touches), x0: tx, y0: ty, c: centre() };
      } else if (e.touches.length === 1) {
        g = { mode: scale > 1.02 ? "pan" : "?", x: e.touches[0].clientX, y: e.touches[0].clientY, x0: tx, y0: ty, t: Date.now(), moved: 0 };
      }
    }, { passive: true });

    stage.addEventListener("touchmove", (e) => {
      if (!g) return;
      if (g.mode === "pinch" && e.touches.length === 2) {
        e.preventDefault();
        const m1 = mid(e.touches);
        scale = Math.min(4, Math.max(1, g.s0 * dist(e.touches) / g.d0));
        tx = (m1.x - g.c.x) - scale * ((g.m0.x - g.c.x) - g.x0) / g.s0;
        ty = (m1.y - g.c.y) - scale * ((g.m0.y - g.c.y) - g.y0) / g.s0;
        clamp(); apply(false);
        return;
      }
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - g.x, dy = e.touches[0].clientY - g.y;
      g.moved = Math.max(g.moved, Math.hypot(dx, dy));
      if (g.mode === "?" && g.moved > 8) g.mode = Math.abs(dx) > Math.abs(dy) ? "swipe" : "drag";
      if (g.mode === "pan") { e.preventDefault(); tx = g.x0 + dx; ty = g.y0 + dy; clamp(); apply(false); }
      else if (g.mode === "swipe") {
        e.preventDefault();
        const bord = (dx > 0 && i === 0) || (dx < 0 && i === list.length - 1);
        tx = dx * (bord ? .28 : 1); apply(false);
      } else if (g.mode === "drag") {
        e.preventDefault();
        ty = dy; back.style.setProperty("--lb-dim", String(Math.max(.3, 1 - Math.abs(dy) / 420)));
        apply(false);
      }
    }, { passive: false });

    stage.addEventListener("touchend", (e) => {
      if (!g) return;
      if (e.touches.length) { g = null; return; }   // il reste un doigt : on repart proprement
      const gg = g; g = null;
      if (gg.mode === "pinch") { if (scale < 1.05) { scale = 1; tx = 0; ty = 0; } clamp(); apply(true); return; }
      // Un doigt posé sans bouger reste une tape, même sur une photo agrandie :
      // sans cela, le double-tape ne rendrait plus la taille normale et le proche
      // resterait prisonnier de l'agrandissement.
      const tape = gg.moved < 10 && Date.now() - gg.t < 400;
      if (gg.mode === "pan" && !tape) { clamp(); apply(true); return; }
      if (gg.mode === "swipe") {
        const dx = tx; tx = 0; apply(true);
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        return;
      }
      if (gg.mode === "drag") {
        const dy = ty;
        if (dy > 90) return close();
        ty = 0; back.style.removeProperty("--lb-dim"); apply(true);
        if (dy < -60) openSheet();
        return;
      }
      // Tape simple : la légende s'efface et revient. Double-tape : on agrandit.
      if (tape) {
        const now = Date.now();
        if (now - lastTap < 300) { lastTap = 0; zoomAt(e.changedTouches[0]); }
        else { lastTap = now; setTimeout(() => { if (lastTap === now) { lastTap = 0; back.classList.toggle("chrome-off"); } }, 300); }
      }
    });
    // Safari : sans cela, le pincer agrandit la page entière au lieu de la photo
    ["gesturestart", "gesturechange"].forEach((n) => stage.addEventListener(n, (e) => e.preventDefault()));
    stage.addEventListener("click", () => { if (sheetOpen) closeSheet(); });

    // ----- Le tiroir des mots
    let sheetOpen = false, rec = null;
    const commentsOf = (x) => D.comments.filter((c) => c.media_id === x.id);
    function openSheet() {
      if (!sheet.dataset.has) return;
      sheetOpen = true; back.classList.remove("chrome-off"); back.classList.add("sheet-on");
      const cf = $("#cf", sheet);
      if (cf && !rec) {
        rec = CV.audioRecorder($("#cf-rec", cf), { label: "Enregistrer un message vocal", maxSeconds: 120 });
        bindNotMe(cf);
        cf.onsubmit = (e) => {
          e.preventDefault();
          submitComment(cf, rec, { mediaId: cur().id }, (c) => {
            $("#lb-clist", sheet).insertAdjacentHTML("beforeend", commentHtml(c));
            bindBigAudio(sheet); rec.reset(); renderFoot();
          });
        };
      }
    }
    function closeSheet() {
      sheetOpen = false; back.classList.remove("sheet-on");
      if (rec) { rec.stop(); rec = null; }
    }

    // ----- Ce qui s'affiche autour de la photo (rien de vide : chaque bloc n'existe
    //       que s'il a quelque chose à dire — pastille d'auteur comprise)
    function renderFoot() {
      const m2 = cur(), n = commentsOf(m2).length;
      const when = [m2.day_date ? fmtDate(m2.day_date) : "", m2.taken_at ? CV.fmtTime(m2.taken_at) : ""].filter(Boolean).join(" · ");
      const pill = MEMBERS.pill(m2.author_id);
      const tab = n ? `${ic("message", "sm")} ${n} mot${n > 1 ? "s" : ""}`
        : (D.trip.allow_comments ? `${ic("message", "sm")} Laisser un mot` : "");
      const audio = m2.audio_path ? bigAudio(API.publicUrl(m2.audio_path), "Écouter le commentaire", true) : "";
      const tabBtn = tab ? `<button type="button" class="bv-lb-tab" id="lb-tab">${tab}</button>` : "";
      foot.innerHTML = `${m2.caption ? `<div class="bv-lb-caption">${esc(m2.caption)}</div>` : ""}
        ${when || pill ? `<div class="bv-lb-meta">${when ? `<span>${when}</span>` : ""}${pill}</div>` : ""}
        ${audio || tabBtn ? `<div class="bv-lb-actions">${audio}${tabBtn}</div>` : ""}`;
      bindBigAudio(foot);
      const tb = $("#lb-tab", foot); if (tb) tb.onclick = openSheet;
      sheet.dataset.has = tab ? "1" : "";
    }
    function renderSheet() {
      const m2 = cur(), cs = commentsOf(m2);
      sheetBody.innerHTML = `<h3>${cs.length ? `${cs.length} mot${cs.length > 1 ? "s" : ""} sur cette photo` : "Aucun mot pour l'instant"}</h3>
        <div id="lb-clist">${cs.map(commentHtml).join("") || (D.trip.allow_comments ? `<p class="muted small">Soyez le premier à laisser un mot !</p>` : "")}</div>
        ${D.trip.allow_comments ? commentFormHtml() : ""}`;
      bindBigAudio(sheetBody);
    }

    function show(dir) {
      const m2 = cur();
      hushAudio(back); closeSheet();
      scale = 1; ty = 0; tx = dir ? dir * stage.clientWidth : 0;
      apply(false);
      frame.innerHTML = m2.kind === "video"
        ? `<video src="${API.publicUrl(m2.path)}" controls playsinline autoplay></video>`
        : `<img src="${API.publicUrl(m2.path)}" alt="${esc(m2.caption || "Photo du voyage")}">`;
      requestAnimationFrame(() => { tx = 0; apply(!!dir); });
      $("#lb-count", back).textContent = `${dayN ? `Jour ${dayN} · ` : ""}${i + 1} / ${list.length}`;
      $("#lb-prev", back).disabled = i <= 0;
      $("#lb-next", back).disabled = i >= list.length - 1;
      back.classList.toggle("is-video", m2.kind === "video");
      renderFoot(); renderSheet();
    }
    function go(dir) {
      const n = i + dir;
      if (n < 0 || n >= list.length) return;
      i = n; show(dir);
    }

    $("#lb-close", back).onclick = () => close();
    $("#lb-prev", back).onclick = () => go(-1);
    $("#lb-next", back).onclick = () => go(1);
    $("#lb-sheet-close", back).onclick = closeSheet;
    const onKey = (e) => {
      if (e.key === "Escape") { sheetOpen ? closeSheet() : close(); }
      if (e.key === "ArrowLeft" && !sheetOpen) go(-1);
      if (e.key === "ArrowRight" && !sheetOpen) go(1);
    };
    document.addEventListener("keydown", onKey);
    show(0);
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
