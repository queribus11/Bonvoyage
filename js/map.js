// ============================================================
//  Bonvoyage v8 — carte immersive
//  MapLibre GL · satellite (Esri) · relief 3D (tuiles d'altitude AWS) · globe · photos sur la carte · survol du voyage
//  Aucune clé d'accès nécessaire.
// ============================================================
window.BV_VERSION = "10.33";
window.BVMAP = (() => {
  const cfg = window.CARNET_CONFIG || {};
  const STYLE_KEY = "bv_map_base", TERRAIN_KEY = "bv_map_3d", SPEED_KEY = "bv_replay_speed";
  const SPEEDS = [{ k: .5, icon: "🐢", label: "lent" }, { k: 1, icon: "▶", label: "normal" }, { k: 2, icon: "🐇", label: "rapide" }];
  const isPhone = () => window.matchMedia("(max-width: 640px)").matches;
  function replaySpeed() { const v = parseFloat(LS.get(SPEED_KEY)); return SPEEDS.some((s) => s.k === v) ? v : (isPhone() ? .5 : 1); }   // sur téléphone : lent par défaut
  function cycleSpeed() { const i = SPEEDS.findIndex((s) => s.k === replaySpeed()); const n = SPEEDS[(i + 1) % SPEEDS.length]; LS.set(SPEED_KEY, n.k); return n; }
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };

  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const maps = [];   // cartes créées (utile pour le diagnostic : BVMAP.maps[0].map)
  const BASES = {
    satellite: { label: "Satellite", short: "Sat." },
    relief:    { label: "Relief",    short: "Relief" },
    plan:      { label: "Plan",      short: "Plan" },
  };
  const LEGACY = { voyager: "satellite", positron: "plan", osm: "plan", outdoors: "relief", hybrid: "satellite" };   // « voyager » était l'ancien défaut : on passe au satellite
  // Moyens de locomotion : icône, vitesse relative pendant le survol, tracé (route OSRM, arc, ligne droite)
  const MODES = {
    walk:  { label: "à pied",     icon: "🚶", speed: 1,   path: "straight" },
    bike:  { label: "à vélo",     icon: "🚲", speed: 1.2, path: "road" },
    car:   { label: "en voiture", icon: "🚗", speed: 1.5, path: "road" },
    bus:   { label: "en bus",     icon: "🚌", speed: 1.4, path: "road" },
    train: { label: "en train",   icon: "🚆", speed: 1.6, path: "straight" },
    boat:  { label: "en bateau",  icon: "⛵", speed: 1.2, path: "straight" },
    kayak: { label: "en kayak",   icon: "🛶", speed: 1.1, path: "straight" },
    plane: { label: "en avion",   icon: "✈️", speed: 2.2, path: "arc" },
    moto:  { label: "en moto",    icon: "🛵", speed: 1.5, path: "road" },
  };

  const DAY_COLORS = ["#F97316", "#0D8FE0", "#7CB518", "#F5B301", "#3AA0F5", "#9ACD1E", "#E05A8A", "#8B5CF6", "#F97316", "#0D8FE0"];

  function defaultBase() {
    const saved = LS.get(STYLE_KEY);
    if (saved && BASES[saved]) return saved;
    const c = cfg.MAP_STYLE || "satellite";
    return BASES[c] ? c : (LEGACY[c] || "satellite");
  }

  // ---------- Style MapLibre : toutes les sources, la visibilité fait le choix du fond ----------
  function buildStyle(base, dark, reading) {
    const vis = (b) => ({ visibility: base === b ? "visible" : "none" });
    return {
      version: 8,
      projection: { type: "globe" },
      sky: { "sky-color": "#8FC6F5", "horizon-color": "#DCEBF7", "fog-color": "#ffffff", "sky-horizon-blend": .6, "horizon-fog-blend": .6, "fog-ground-blend": .7, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 10, 1, 12, 0] },
      light: { anchor: "viewport", color: "#fff", intensity: .35, position: [1.15, 210, 30] },
      sources: {
        esri:   { type: "raster", tiles: [ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19, attribution: 'Imagerie © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics' },
        esriref:{ type: "raster", tiles: [ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19 },
        esriroads:{ type: "raster", tiles: [ESRI + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}"], tileSize: 256, maxzoom: 19 },
        osm:    { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
        topo:   { type: "raster", tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 17, attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' },
        dem:    { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15, attribution: 'Relief : <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen / AWS</a>' },
        demhill: { type: "raster-dem", tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], encoding: "terrarium", tileSize: 256, maxzoom: 15 },
        tracks:   { type: "geojson", data: empty(), lineMetrics: true },
        dots:     { type: "geojson", data: empty() },
        progress: { type: "geojson", data: empty() },
        photos:   { type: "geojson", data: empty(), ...GROUPES },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": dark ? "#0E1620" : "#DCEBF7" } },
        { id: "b-esri", type: "raster", source: "esri", layout: vis("satellite"), paint: { "raster-fade-duration": 200 } },
        { id: "b-esri-roads", type: "raster", source: "esriroads", layout: vis("satellite"), paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 9, .8], "raster-fade-duration": 200 } },
        { id: "b-esri-ref", type: "raster", source: "esriref", layout: vis("satellite"), paint: { "raster-fade-duration": 200 } },
        { id: "b-topo", type: "raster", source: "topo", layout: vis("relief"), paint: dark ? { "raster-brightness-max": .8, "raster-saturation": -.2 } : {} },
        { id: "b-osm", type: "raster", source: "osm", layout: vis("plan"), paint: dark ? { "raster-brightness-max": .72, "raster-saturation": -.35, "raster-contrast": .1 } : {} },
        { id: "b-hill", type: "hillshade", source: "demhill", layout: vis("plan"), paint: { "hillshade-exaggeration": .35, "hillshade-shadow-color": "#123F66", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#123F66" } },
        ...trackLayers(reading),
        { id: "progress-halo", type: "line", source: "progress", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": .9 } },
        { id: "progress-line", type: "line", source: "progress", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5 } },
        { id: "dots", type: "circle", source: "dots", paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } },
        // Source « photos » : les vignettes sont des éléments HTML (voir syncPhotoMarkers) ; ce calque invisible sert au regroupement
        { id: "photos-hidden", type: "circle", source: "photos", paint: { "circle-radius": 0, "circle-opacity": 0 } },
      ],
    };
  }
  function empty() { return { type: "FeatureCollection", features: [] }; }

  // #37 · Deux habillages de trace. Dans l'app, celui d'origine. Sur la page des proches,
  // la hiérarchie est renversée : jusqu'ici l'itinéraire ESTIMÉ était dessiné plus gros
  // (3,5 → 5,5 px, halo blanc flou de 12 px à 45 %) que la vraie trace (2,5 → 4,5 px) —
  // la ligne la moins sûre était la plus voyante de la carte. Désormais : la journée qu'on
  // lit garde sa couleur, plus fine, posée sur un liseré SOMBRE ; les autres reculent en
  // blanc fin. La distinction pointillé (estimé) / trait plein (vraie trace) reste des deux
  // côtés : c'est une vraie information.
  const READ = { w: 3.2, otherW: 1.8, otherOp: .34, edge: "rgba(8,14,20,.40)", edgeW: 6 };
  const DASH = [1.6, 1.4];
  // Le regroupement des vignettes photo, au même endroit pour tout le monde : il est coupé
  // le temps du survol (voir `replay`) et remis à la fin.
  const GROUPES = { cluster: true, clusterRadius: 46, clusterMaxZoom: 17 };
  // Le pointillé est exprimé en multiples de la largeur du trait : pour que le liseré
  // sombre suive exactement les tirets de la couleur, son motif est mis à l'échelle.
  const DASH_EDGE = [DASH[0] * READ.w / READ.edgeW, DASH[1] * READ.w / READ.edgeW];
  function trackLayers(reading) {
    if (!reading) return [
      { id: "track-dash-edge", type: "line", source: "tracks", filter: ["==", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 8, 14, 12], "line-opacity": .45, "line-blur": 4 } },
      { id: "track-dash", type: "line", source: "tracks", filter: ["==", ["get", "dash"], true], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 14, 5.5], "line-dasharray": DASH, "line-opacity": 1 } },
      { id: "track-halo", type: "line", source: "tracks", filter: ["!=", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12], "line-opacity": .35, "line-blur": 3 } },
      { id: "track-edge", type: "line", source: "tracks", filter: ["!=", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 14, 7], "line-opacity": .9 } },
      { id: "track-line", type: "line", source: "tracks", filter: ["!=", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 4.5], "line-opacity": 1 } },
    ];
    return [
      { id: "track-dash-edge", type: "line", source: "tracks", filter: ["==", ["get", "dash"], true], layout: { "line-join": "round" }, paint: { "line-color": READ.edge, "line-width": READ.edgeW, "line-dasharray": DASH_EDGE, "line-opacity": 1 } },
      { id: "track-dash", type: "line", source: "tracks", filter: ["==", ["get", "dash"], true], layout: { "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": READ.w, "line-dasharray": DASH, "line-opacity": 1 } },
      { id: "track-halo", type: "line", source: "tracks", filter: ["!=", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 0, "line-opacity": 0 } },
      { id: "track-edge", type: "line", source: "tracks", filter: ["!=", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": READ.edge, "line-width": READ.edgeW, "line-opacity": 1 } },
      { id: "track-line", type: "line", source: "tracks", filter: ["!=", ["get", "dash"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": READ.w, "line-opacity": 1 } },
    ];
  }
  // #42 · LA JOURNÉE IMMOBILE : le tracé du jour porté plus franchement, les autres
  // journées réduites à un repère blanc discret qui sert seulement à situer.
  const OVER = { w: 3.6, edge: "rgba(6,12,20,.55)", edgeW: 9, otherW: 2.6, otherOp: .5 };
  const OVER_DASH_EDGE = [DASH[0] * OVER.w / OVER.edgeW, DASH[1] * OVER.w / OVER.edgeW];
  // Sans journée en cours (vue de tout le voyage), toutes gardent leur couleur.
  function applyTrackStyle(M) {
    if (!M.reading || !M.ready) return;
    const map = M.map, iso = M.activeDay || null, V = M.overview ? OVER : READ;
    const pick = (a, b) => (iso ? ["case", ["==", ["get", "day"], iso], a, b] : a);
    for (const id of ["track-line", "track-dash"]) {
      map.setPaintProperty(id, "line-color", pick(["get", "color"], "#ffffff"));
      map.setPaintProperty(id, "line-width", pick(V.w, V.otherW));
      map.setPaintProperty(id, "line-opacity", pick(1, V.otherOp));
    }
    for (const id of ["track-edge", "track-dash-edge"]) {
      map.setPaintProperty(id, "line-color", V.edge);   // la vue d'ensemble a son propre liseré
      map.setPaintProperty(id, "line-width", pick(V.edgeW, 0));
      map.setPaintProperty(id, "line-opacity", 1);
    }
    if (M.overview) map.setPaintProperty("track-dash-edge", "line-dasharray", OVER_DASH_EDGE);
    else map.setPaintProperty("track-dash-edge", "line-dasharray", DASH_EDGE);
    map.setPaintProperty("track-halo", "line-opacity", 0);
  }
  // ---------- #42 · La journée immobile ----------
  // Un état plein écran où l'on ne voit QUE la forme d'un jour : son tracé porté, les autres
  // journées en blanc discret pour situer, un cercle creux au départ, un cercle plein à
  // l'arrivée, et leur nom s'il y en a un. Aucune pastille photo, aucun arrêt, aucun numéro
  // de jour : ce qui est caché ici l'est par la classe `bv-overview` posée sur la carte.
  function nearestStopName(data, iso, pt, maxM) {
    let best = null, bd = Infinity;
    for (const st of data.stops || []) {
      if (st.day_date !== iso || st.lat == null || st.lng == null || !st.name) continue;
      const d = dist([st.lng, st.lat], pt);
      if (d < bd) { bd = d; best = st; }
    }
    return best && bd <= maxM ? best.name : null;
  }
  function clearEnds(M) {
    for (const mk of M.endMarkers || []) mk.remove();
    M.endMarkers = [];
  }
  // L'étiquette se pose au-dessus du point, sauf si elle sortirait par le haut : le bouton
  // de sortie et celui du survol y vivent. Elle ne descend jamais sous la barre du bas.
  function overviewEnds(M, iso, opts = {}) {
    clearEnds(M);
    const data = M.data; if (!data || !iso) return { depart: null, arrivee: null };
    const { coords } = dayPath(data, iso);
    if (!coords || coords.length < 2) return { depart: null, arrivee: null };
    const liste = (M.drawOpts && M.drawOpts.dayList) || dayListOf(data, M.drawOpts || {});
    const couleur = colorForDay(liste, iso);
    const bas = opts.bottom == null ? 150 : opts.bottom, haut = opts.top == null ? 64 : opts.top;
    const pose = (pt, genre, mot) => {
      const el = document.createElement("div");
      el.className = "bv-bout " + genre;
      el.style.setProperty("--c", couleur);
      M.endMarkers.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(pt).addTo(M.map));
      const nom = nearestStopName(data, iso, pt, 300);
      if (!nom) return null;
      let q = { x: 0, y: 0 }; try { q = M.map.project(pt); } catch { }
      const h = M.container.clientHeight || 956, w = M.container.clientWidth || 440;
      // Au-dessus du point par défaut ; en dessous si elle sortirait par le haut, où vivent
      // les deux boutons. Et accrochée par son côté quand le point est près d'un bord :
      // centrée, l'étiquette dépasserait de l'écran et se ferait couper.
      const dessous = q.y < haut + 76 || (genre === "depart" && q.y < h - bas - 60);
      const cote = q.x < w * .34 ? "-left" : q.x > w * .66 ? "-right" : "";
      const lab = document.createElement("div");
      lab.className = "bv-bout-nom";
      lab.innerHTML = '<span></span><b></b>';
      lab.querySelector("span").textContent = mot;
      lab.querySelector("b").textContent = nom;
      M.endMarkers.push(new maplibregl.Marker({
        element: lab, anchor: (dessous ? "top" : "bottom") + cote,
        offset: [cote === "-left" ? 10 : cote === "-right" ? -10 : 0, dessous ? 15 : -15],
      }).setLngLat(pt).addTo(M.map));
      return nom;
    };
    const depart = pose(coords[0], "depart", "départ");
    const arrivee = pose(coords[coords.length - 1], "arrivee", "arrivée");
    return { depart, arrivee };
  }
  // Entrer ou sortir de l'état. Retourne les deux noms trouvés, pour la barre du bas.
  function setOverview(M, on, iso, opts = {}) {
    M.overview = !!on;
    M.container.classList.toggle("bv-overview", !!on);
    clearTimeout(M.endsTimer);            // un replacement d'étiquettes en attente ne survit pas au changement d'état
    if (on) { M.activeDay = iso || null; applyTrackStyle(M); syncPhotoMarkers(M); return overviewEnds(M, iso, opts); }
    clearEnds(M);
    applyTrackStyle(M);
    syncPhotoMarkers(M);
    return { depart: null, arrivee: null };
  }
  // Le cadrage d'une journée dans cet état, au tempo que Sophie a validé au doigt pour les
  // photos (2 s + 2 s par largeur d'écran, plafond 5,5 s), avec départ et arrivée adoucis.
  // `opts.animate === false` : le cadrage se pose d'un coup, sans aucun mouvement.
  function flyOverview(M, bounds, opts = {}) {
    if (!bounds) return 0;
    clearTimeout(M.endsTimer);
    const lng = (bounds[0][0] + bounds[1][0]) / 2, lat = (bounds[0][1] + bounds[1][1]) / 2;
    const ms = (opts.animate === false || reducedMotion()) ? 0
      : Math.min(FLY_MAX_MS, FLY_BASE_MS + FLY_PER_SCREEN_MS * screensAway(M, lat, lng));
    fitBounds(M, bounds, {
      ...opts, duration: ms, curve: ms ? FLY_CURVE : undefined,
      easing: ms ? ((t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)) : undefined,
    });
    // Les étiquettes se replacent une fois la caméra arrivée — et seulement si l'on est ENCORE
    // dans l'état : la garde se vérifie à l'exécution, pas au moment de programmer. Sans cela,
    // un minuteur de cinq secondes rallumait les cercles en plein survol.
    M.endsTimer = setTimeout(() => { if (M.overview && M.activeDay) overviewEnds(M, M.activeDay, opts); }, ms + 40);
    return ms;
  }

  // La journée qu'on est en train de lire : c'est la seule à garder sa couleur.
  function setActiveDay(M, iso) {
    iso = iso || null;
    if (M.activeDay === iso) return;
    M.activeDay = iso;
    if (!M.replaying) applyTrackStyle(M);
  }

  function colorForDay(dayList, iso) {
    const i = dayList.indexOf(iso);
    return DAY_COLORS[(i < 0 ? 0 : i) % DAY_COLORS.length];
  }

  // ---------- Création ----------
  // opts : { cooperative (page des proches : deux doigts pour bouger la carte), terrain (3D au départ), globe (zoom monde au départ), controlsPos, reading (#37 : l'habillage de la page des proches) }
  function create(el, opts = {}) {
    const container = typeof el === "string" ? document.getElementById(el) : el;
    const isDark = () => !!(window.THEME && THEME.isDark());
    const M = { base: defaultBase(), terrain: false, ready: false, markers: new Map(), dayMarkers: [], stopMarkers: [], me: null, data: null, drawOpts: {}, replaying: false, reading: !!opts.reading, activeDay: null, container };

    const map = new maplibregl.Map({
      container, style: buildStyle(M.base, isDark(), M.reading),
      center: [2.5, 46.6], zoom: opts.globe ? 1.4 : 4.6, pitch: 0, bearing: 0,
      maxPitch: 72, attributionControl: false, cooperativeGestures: !!opts.cooperative,
      dragRotate: true, touchPitch: true, fadeDuration: 150, hash: false,
      locale: { "NavigationControl.ZoomIn": "Zoom avant", "NavigationControl.ZoomOut": "Zoom arrière", "NavigationControl.ResetBearing": "Remettre le nord en haut", "AttributionControl.ToggleAttribution": "Crédits des cartes", "CooperativeGesturesHandler.WindowsHelpText": "Ctrl + molette pour zoomer la carte", "CooperativeGesturesHandler.MacHelpText": "⌘ + molette pour zoomer la carte", "CooperativeGesturesHandler.MobileHelpText": "Deux doigts pour bouger la carte" },
    });
    M.map = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: !isPhone(), visualizePitch: true }), opts.controlsPos || "bottom-right");
    map.on("load", () => {
      M.ready = true;
      applyTrackStyle(M);
      if (M.pendingDraw) { draw(M, M.pendingDraw.data, M.pendingDraw.options); M.pendingDraw = null; }
      const want3d = opts.terrain != null ? opts.terrain : LS.get(TERRAIN_KEY) === "1";
      if (want3d && !opts.globe) setTerrain(M, true, false);
      updateSwitcher(M);
    });
    map.on("error", (e) => { if (e && e.error && !/tile/i.test(String(e.error.message || ""))) console.warn("Carte :", e.error.message || e.error); });

    // Vignettes photos : synchronisées à chaque mouvement
    map.on("move", () => syncPhotoMarkers(M));
    map.on("moveend", () => syncPhotoMarkers(M));
    map.on("sourcedata", (e) => { if (e.sourceId === "photos" && e.isSourceLoaded) syncPhotoMarkers(M); });

    document.addEventListener("themechange", () => { const d = isDark(); map.setPaintProperty("bg", "background-color", d ? "#0E1620" : "#DCEBF7"); applyDark(M, d); });

    buildSwitcher(M, opts);
    maps.push(M);
    return M;
  }
  function applyDark(M, dark) {
    const map = M.map; if (!M.ready) return;
    map.setPaintProperty("b-osm", "raster-brightness-max", dark ? .72 : 1);
    map.setPaintProperty("b-osm", "raster-saturation", dark ? -.35 : 0);
    map.setPaintProperty("b-topo", "raster-brightness-max", dark ? .8 : 1);
  }

  // ---------- Fond de carte et relief ----------
  function setBase(M, base) {
    if (!BASES[base]) return;
    M.base = base; LS.set(STYLE_KEY, base);
    if (!M.ready) return;
    const map = M.map, show = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    show("b-esri", base === "satellite"); show("b-esri-roads", base === "satellite"); show("b-esri-ref", base === "satellite");
    show("b-topo", base === "relief"); show("b-osm", base === "plan"); show("b-hill", base === "plan");
    updateSwitcher(M);
  }
  function setTerrain(M, on, animate = true) {
    M.terrain = !!on; LS.set(TERRAIN_KEY, on ? "1" : "0");
    if (!M.ready) return;
    const map = M.map;
    if (on) {
      // Le relief 3D se dessine sur la projection plane ; le globe reste pour les vues d'ensemble
      map.setProjection({ type: "mercator" });
      map.setTerrain({ source: "dem", exaggeration: 1.3 });
      if (animate && map.getPitch() < 25) map.easeTo({ pitch: 58, duration: 900 });
    } else {
      map.setTerrain(null);
      map.setProjection({ type: "globe" });
      if (animate && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 700 });
    }
    updateSwitcher(M);
  }

  // Sélecteur de fond + bouton 3D (verre dépoli), posé dans le conteneur de la carte
  function buildSwitcher(M, opts) {
    const wrap = document.createElement("div");
    wrap.className = "bv-layers" + (opts.switcherClass ? " " + opts.switcherClass : "");
    wrap.innerHTML = Object.entries(BASES).map(([k, b]) => `<button type="button" data-base="${k}" title="${b.label}">${b.short}</button>`).join("") + `<button type="button" data-3d="1" title="Relief en 3D">3D</button>`;
    wrap.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.base) setBase(M, b.dataset.base); else setTerrain(M, !M.terrain);
    });
    M.container.appendChild(wrap); M.switcher = wrap;
    updateSwitcher(M);
  }
  function updateSwitcher(M) {
    if (!M.switcher) return;
    M.switcher.querySelectorAll("[data-base]").forEach((b) => b.classList.toggle("active", b.dataset.base === M.base));
    const t = M.switcher.querySelector("[data-3d]"); if (t) t.classList.toggle("active", M.terrain);
  }

  // ---------- Dessin du voyage ----------
  // data : { tracks, media, stops } · options : { dayList, dayFilter, thumbUrl(m), onMediaClick(m), onTrackClick(tr), onDayClick(iso), onStopClick(s), dayNumber(iso) }
  function draw(M, data, options = {}) {
    M.data = data; M.drawOpts = options;
    // Pas de redessin pendant un survol (il effacerait les vignettes révélées) : on l'applique à la fin
    if (!M.ready || M.replaying) { M.pendingDraw = { data, options }; return { bounds: computeBounds(data, options.dayFilter), dayList: dayListOf(data, options) }; }
    const map = M.map, { tracks = [], media = [] } = data;
    const dayList = dayListOf(data, options), filter = options.dayFilter;
    const lines = [], dots = [], photos = [];
    for (const tr of tracks) {
      if (filter && tr.day_date !== filter) continue;
      const pts = (tr.points || []).filter((p) => p && p.lat != null && p.lng != null);
      const color = colorForDay(dayList, tr.day_date);
      if (pts.length >= 2) lines.push({ type: "Feature", properties: { id: tr.id, color, day: tr.day_date || "", dash: tr.source === "route" }, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } });
      else if (pts.length === 1) dots.push({ type: "Feature", properties: { id: tr.id, color }, geometry: { type: "Point", coordinates: [pts[0].lng, pts[0].lat] } });
    }
    for (const m of media) {
      if (filter && m.day_date !== filter) continue;
      if (m.lat == null || m.lng == null) continue;
      photos.push({ type: "Feature", properties: { id: m.id }, geometry: { type: "Point", coordinates: [m.lng, m.lat] } });
    }
    // Journées sans trace : on relie les photos dans l'ordre de l'heure (trajet estimé, en pointillés)
    for (const iso of dayList) {
      if (filter && iso !== filter) continue;
      if (lines.some((l) => l.properties.day === iso && !l.properties.dash)) continue;
      if (tracks.some((t) => t.day_date === iso && t.source === "route" && (t.points || []).length >= 2)) continue;
      const legs = estimatedLegs(data, iso);
      if (legs && !M._roadRedraw) { const missing = applyRoads(legs, () => { M._roadRedraw = false; if (M.data && !M.replaying) draw(M, M.data, M.drawOpts); }); if (missing) M._roadRedraw = true; }
      if (legs) legs.forEach((l, i) => lines.push({ type: "Feature", properties: { id: `est-${iso}-${i}`, color: colorForDay(dayList, iso), day: iso, dash: true, est: true, mode: l.mode || "" }, geometry: { type: "LineString", coordinates: l.coords } }));
    }
    map.getSource("tracks").setData({ type: "FeatureCollection", features: lines });
    map.getSource("dots").setData({ type: "FeatureCollection", features: dots });
    map.getSource("photos").setData({ type: "FeatureCollection", features: photos });
    M.mediaById = new Map(media.map((m) => [m.id, m]));
    M.trackById = new Map(tracks.map((t) => [t.id, t]));
    if (!M._trackClickBound) {
      M._trackClickBound = true;
      map.on("click", "track-line", (e) => { const f = e.features && e.features[0]; if (f && M.drawOpts.onTrackClick) { e.preventDefault(); M.drawOpts.onTrackClick(M.trackById.get(f.properties.id)); } });
      map.on("mouseenter", "track-line", () => map.getCanvas().style.cursor = "pointer");
      map.on("mouseleave", "track-line", () => map.getCanvas().style.cursor = "");
    }
    drawDayMarkers(M, data, dayList, options);
    drawStopMarkers(M, data, options);
    for (const mk of M.markers.values()) mk.marker.remove(); M.markers.clear();
    syncPhotoMarkers(M);
    return { bounds: computeBounds(data, filter), dayList };
  }
  // #42 · Le chemin d'une journée : la trace relevée si elle existe, sinon les tronçons
  // estimés entre les photos. `est` dit lequel des deux — c'est ce qui décide des pointillés.
  // (Le survol construit la même chose, il s'en sert aussi : une seule vérité.)
  function dayPath(data, iso) {
    const trs = (data.tracks || []).filter((t) => t.day_date === iso && (t.points || []).length >= 2)
      .slice().sort((a, b) => (a.points[0].t || 0) - (b.points[0].t || 0));
    let coords = trs.flatMap((t) => t.points.filter((p) => p && p.lat != null).map((p) => [p.lng, p.lat]));
    if (coords.length >= 2) return { coords, est: false, legs: null, tracks: trs };
    const legs = estimatedLegs(data, iso), e = legs ? pathFromLegs(legs) : null;
    return e ? { coords: e, est: true, legs, tracks: trs } : { coords, est: false, legs, tracks: trs };
  }
  // Photos géolocalisées d'une journée, dans l'ordre de l'heure
  function dayPhotosSorted(media, iso) {
    return (media || []).filter((m) => m.day_date === iso && m.lat != null && m.lng != null)
      .slice().sort((a, b) => (a.taken_at || a.created_at || "").localeCompare(b.taken_at || b.created_at || ""));
  }
  // Moyen de locomotion de la journée (réglage de la journée), sinon null
  function dayTransport(data, iso) { const d = (data.days || []).find((x) => x.day_date === iso); return d && d.transport && MODES[d.transport] ? d.transport : null; }
  // Tronçons estimés d'une journée : de photo en photo. Mode = celui de la journée, changé « à partir de » toute photo
  // qui en précise un ; sans rien, l'app devine (plus de 2,5 km = voiture par la route, sinon à pied). Fonction pure (aucune requête).
  function estimatedLegs(data, iso) {
    const ph = dayPhotosSorted(data.media, iso);
    const legs = []; let mode = dayTransport(data, iso);
    for (let i = 1; i < ph.length; i++) {
      const a = ph[i - 1], b = ph[i];
      if (a.transport && MODES[a.transport]) mode = a.transport;   // « à partir de cette photo, je voyage… »
      if (a.lng === b.lng && a.lat === b.lat) continue;
      const A = [a.lng, a.lat], B = [b.lng, b.lat];
      let m = mode, auto = false;
      if (!m) { m = dist(A, B) > 2500 ? "car" : "walk"; auto = true; }
      const leg = { from: a, to: b, mode: m, auto, coords: MODES[m].path === "arc" ? arc(A, B) : [A, B], road: false };
      if (MODES[m].path === "road") { const known = roadKnown(A, B); if (known) { leg.coords = known; leg.road = true; } }
      legs.push(leg);
    }
    return legs.length ? legs : null;
  }
  // Tronçons mis bout à bout → coordonnées avec le mode de chaque segment
  function pathFromLegs(legs) {
    const coords = [], modes = [];
    for (const l of legs) for (let i = 0; i < l.coords.length; i++) { const c = l.coords[i]; const last = coords[coords.length - 1]; if (last && last[0] === c[0] && last[1] === c[1]) continue; coords.push(c); modes.push(l.mode); }
    return coords.length >= 2 ? Object.assign(coords, { modes }) : null;
  }
  // Routes (OSRM, serveur public de démonstration) : cache local « bv_roads » borné (≈ 400 Ko), échecs mémorisés 24 h
  let roadCache = null;
  function roads() { if (!roadCache) { try { roadCache = JSON.parse(localStorage.getItem("bv_roads") || "{}"); } catch { roadCache = {}; } } return roadCache; }
  function saveRoads() { try { const c = roads(); let s = JSON.stringify(c); if (s.length > 400000) { const ks = Object.keys(c); for (const k of ks.slice(0, Math.ceil(ks.length / 3))) delete c[k]; s = JSON.stringify(c); } localStorage.setItem("bv_roads", s); } catch { } }
  function roadKey(A, B) { return `${A[0].toFixed(4)},${A[1].toFixed(4)}>${B[0].toFixed(4)},${B[1].toFixed(4)}`; }
  function roadKnown(A, B) { const v = roads()[roadKey(A, B)]; return Array.isArray(v) ? v : null; }
  const roadPending = new Map();
  function fetchRoad(A, B) {
    const key = roadKey(A, B), c = roads();
    if (Array.isArray(c[key])) return Promise.resolve(c[key]);
    if (c[key] && c[key].fail && Date.now() - c[key].fail < 86400000) return Promise.reject(new Error("no route (cached)"));
    if (roadPending.has(key)) return roadPending.get(key);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), 8000);
    const p = fetch(`https://router.project-osrm.org/route/v1/driving/${A[0].toFixed(5)},${A[1].toFixed(5)};${B[0].toFixed(5)},${B[1].toFixed(5)}?overview=full&geometries=geojson`, ctrl ? { signal: ctrl.signal } : {})
      .then((r) => r.json()).then((j) => {
        if (j.code !== "Ok" || !j.routes || !j.routes[0]) throw new Error("no route");
        const coords = j.routes[0].geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]);
        c[key] = coords; saveRoads(); return coords;
      }).catch((e) => { c[key] = { fail: Date.now() }; saveRoads(); throw e; })
      .finally(() => { if (timer) clearTimeout(timer); roadPending.delete(key); });
    roadPending.set(key, p); return p;
  }
  // Applique les routes connues aux tronçons ; lance les recherches manquantes et prévient quand l'une arrive
  function applyRoads(legs, onReady) {
    let missing = 0;
    for (const l of legs) {
      if (!MODES[l.mode] || MODES[l.mode].path !== "road") continue;
      const A = [l.from.lng, l.from.lat], B = [l.to.lng, l.to.lat], known = roadKnown(A, B);
      if (known) { l.coords = known; l.road = true; }
      else { missing++; if (onReady) fetchRoad(A, B).then(() => onReady()).catch(() => { }); }
    }
    return missing;
  }
  // Arc « vol d'avion » entre deux points (courbe bombée, 24 points)
  function arc(A, B, n = 24) {
    const d = dist(A, B), bulge = Math.min(.25, d / 4000000 + .04);
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = B[0] - A[0], dy = B[1] - A[1];
    const cx = mx - dy * bulge * 2, cy = my + dx * bulge * 2;  // point de contrôle perpendiculaire
    const out = [];
    for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * A[0] + 2 * u * t * cx + t * t * B[0], u * u * A[1] + 2 * u * t * cy + t * t * B[1]]); }
    return out;
  }
  function dayListOf(data, options) {
    if (options.dayList) return options.dayList;
    return [...new Set([...(data.tracks || []).map((t) => t.day_date), ...(data.media || []).map((m) => m.day_date)].filter(Boolean))].sort();
  }
  // Bornes [[lngMin,latMin],[lngMax,latMax]] ou null
  function computeBounds(data, filter) {
    let b = null;
    const ext = (lng, lat) => { if (!b) b = [[lng, lat], [lng, lat]]; else { b[0][0] = Math.min(b[0][0], lng); b[0][1] = Math.min(b[0][1], lat); b[1][0] = Math.max(b[1][0], lng); b[1][1] = Math.max(b[1][1], lat); } };
    for (const tr of data.tracks || []) { if (filter && tr.day_date !== filter) continue; for (const p of tr.points || []) if (p && p.lat != null) ext(p.lng, p.lat); }
    for (const m of data.media || []) { if (filter && m.day_date !== filter) continue; if (m.lat != null && m.lng != null) ext(m.lng, m.lat); }
    // Un arrêt posé loin de la trace ne doit pas tomber hors cadre
    for (const st of data.stops || []) { if (filter && st.day_date !== filter) continue; if (st.lat != null && st.lng != null) ext(st.lng, st.lat); }
    return b;
  }
  function boundsOf(points) { let b = null; for (const p of points) { if (!b) b = [[p.lng, p.lat], [p.lng, p.lat]]; else { b[0][0] = Math.min(b[0][0], p.lng); b[0][1] = Math.min(b[0][1], p.lat); b[1][0] = Math.max(b[1][0], p.lng); b[1][1] = Math.max(b[1][1], p.lat); } } return b; }

  // Point de départ de chaque journée (première trace, sinon première photo)
  function dayStart(data, iso) {
    const trs = (data.tracks || []).filter((t) => t.day_date === iso && (t.points || []).length);
    if (trs.length) { const t = trs.slice().sort((a, b) => (a.points[0].t || 0) - (b.points[0].t || 0))[0]; return { lat: t.points[0].lat, lng: t.points[0].lng }; }
    const m = (data.media || []).find((x) => x.day_date === iso && x.lat != null);
    return m ? { lat: m.lat, lng: m.lng } : null;
  }
  function drawDayMarkers(M, data, dayList, options) {
    for (const mk of M.dayMarkers) mk.remove(); M.dayMarkers = [];
    if (options.noDayMarkers) return;
    dayList.forEach((iso) => {
      if (options.dayFilter && options.dayFilter !== iso) return;
      const p = dayStart(data, iso); if (!p) return;
      const n = options.dayNumber ? options.dayNumber(iso) : (dayList.indexOf(iso) + 1);
      const el = document.createElement("div"); el.className = "bv-day"; el.innerHTML = `<span class="in" style="background:${colorForDay(dayList, iso)}">${n ? `J${n}` : iso.slice(8, 10) + "/" + iso.slice(5, 7)}</span>`; el.title = iso; el.setAttribute("aria-label", n ? `Jour ${n}` : iso);
      el.addEventListener("click", (e) => { e.stopPropagation(); if (options.onDayClick) options.onDayClick(iso); });
      const mk = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(M.map);
      M.dayMarkers.push(mk);
    });
  }

  // Les arrêts de la journée (#5) : un picto posé sur la trace.
  // Ils n'apparaissent QUE lorsqu'une journée est ouverte (dayFilter) : la vue de
  // tout le voyage ne gagne aucun dessin nouveau — c'est le choix de Sophie.
  function drawStopMarkers(M, data, options) {
    for (const mk of M.stopMarkers) mk.remove(); M.stopMarkers = [];
    const filter = options.dayFilter;
    if (!filter || options.noStops) return;
    for (const st of data.stops || []) {
      if (st.day_date !== filter || st.lat == null || st.lng == null) continue;
      const el = document.createElement("div"); el.className = "bv-stop";
      const picto = (window.BV_STOP_PICTOS && (BV_STOP_PICTOS[st.category] || BV_STOP_PICTOS.autre)) || "";
      el.innerHTML = `<span class="in">${picto}</span>`;
      el.title = st.name || "Arrêt"; el.setAttribute("aria-label", st.name || "Arrêt");
      el.addEventListener("click", (e) => { e.stopPropagation(); if (options.onStopClick) options.onStopClick(st); });
      M.stopMarkers.push(new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([st.lng, st.lat]).addTo(M.map));
    }
  }

  // Vignettes photos (HTML) et grappes, calées sur la source « photos » regroupée par MapLibre
  function syncPhotoMarkers(M) {
    if (!M.ready || !M.mediaById) return;
    // #42 · Dans la journée immobile, aucune pastille photo : on les retire pour de bon
    // plutôt que de les cacher, sinon elles se repositionnent à chaque image pour rien.
    if (M.overview) { for (const e of M.markers.values()) e.marker.remove(); M.markers.clear(); return; }
    const map = M.map, src = map.getSource("photos"); if (!src) return;
    let feats = [];
    try { feats = map.querySourceFeatures("photos"); } catch { return; }
    const seen = new Set();
    for (const f of feats) {
      const p = f.properties, key = p.cluster ? "c" + p.cluster_id : "m" + p.id;
      if (seen.has(key)) continue; seen.add(key);
      const [lng, lat] = f.geometry.coordinates;
      let entry = M.markers.get(key);
      if (!entry) {
        const el = document.createElement("div");
        el.className = "bv-photo" + (M.replaying && !(M.revealed && !p.cluster && M.revealed.has(p.id)) ? " hidden" : "");
        if (p.cluster) {
          el.classList.add("cluster");
          el.innerHTML = `<div class="in"><img alt=""></div>`; el.title = `${p.point_count} photos`;
          src.getClusterLeaves(p.cluster_id, 1, 0).then((leaves) => { const m = leaves && leaves[0] && M.mediaById.get(leaves[0].properties.id); const img = el.querySelector("img"); if (m && img) img.src = thumbOf(M, m); }).catch(() => { });
          el.addEventListener("click", (e) => { e.stopPropagation(); src.getClusterExpansionZoom(p.cluster_id).then((z) => map.easeTo({ center: [lng, lat], zoom: Math.min(z + .3, 18), duration: 600 })).catch(() => { }); });
        } else {
          const m = M.mediaById.get(p.id); if (!m) continue;
          el.innerHTML = `<div class="in"><img alt="" src="${thumbOf(M, m)}">${m.kind === "video" ? '<span class="play">▶</span>' : ""}${m.transport && MODES[m.transport] ? `<span class="mode" title="Arrivée ${MODES[m.transport].label}">${MODES[m.transport].icon}</span>` : ""}</div>`;
          el.addEventListener("click", (e) => { e.stopPropagation(); if (M.drawOpts.onMediaClick) M.drawOpts.onMediaClick(m); });
          el.dataset.id = m.id; el.dataset.day = m.day_date || "";
          if (M.focusId && m.id === M.focusId) el.classList.add("is-focus");   // vignette recréée pendant un déplacement : elle reste en avant
        }
        entry = { marker: new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map), el };
        M.markers.set(key, entry);
      }
    }
    for (const [key, entry] of M.markers) if (!seen.has(key)) { entry.marker.remove(); M.markers.delete(key); }
  }
  function thumbOf(M, m) { return M.drawOpts.thumbUrl ? M.drawOpts.thumbUrl(m) : ""; }
  // #8 · La vignette de la photo qu'on est en train de lire passe en avant sur la carte.
  // C'est ce qui relie ce qu'on voit dans le récit à l'endroit où c'était.
  function focusMedia(M, id) {
    id = id || null;
    if (M.focusId === id) return;
    M.focusId = id;
    for (const e of M.markers.values()) e.el.classList.toggle("is-focus", !!id && e.el.dataset.id === id);
  }

  // ---------- Caméra et utilitaires ----------
  function fitBounds(M, bounds, opts = {}) {
    if (!bounds) return;
    // #42 · Les marges peuvent différer d'un côté à l'autre : la barre du bas de la journée
    // immobile ne doit jamais recouvrir le tracé.
    const pad = opts.padding == null ? 48 : opts.padding;
    const same = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
    if (same) { M.map[opts.animate === false ? "jumpTo" : "easeTo"]({ center: bounds[0], zoom: Math.min(opts.maxZoom || 15, 14), duration: opts.duration ?? 800 }); return; }
    const o = { padding: pad, maxZoom: opts.maxZoom || 15, duration: opts.animate === false ? 0 : (opts.duration ?? 900), pitch: opts.keepPitch ? M.map.getPitch() : (M.terrain ? Math.min(M.map.getPitch(), 45) : 0), bearing: opts.keepPitch ? M.map.getBearing() : 0 };
    if (opts.curve) o.curve = opts.curve;   // jamais `undefined` : MapLibre en ferait un calcul impossible
    if (opts.easing) o.easing = opts.easing;
    M.map.fitBounds(bounds, o);
  }
  function flyToBounds(M, bounds, opts = {}) { fitBounds(M, bounds, { ...opts, duration: opts.duration ?? 1400 }); }
  function setView(M, lat, lng, zoom) { M.map.jumpTo({ center: [lng, lat], zoom: zoom ?? M.map.getZoom() }); }
  function easeTo(M, lat, lng, zoom) { M.map.easeTo({ center: [lng, lat], zoom: zoom ?? M.map.getZoom(), duration: 700 }); }
  // #37 · Aller d'un lieu à l'autre sans donner la nausée.
  // Ce qui compte n'est PAS la distance au sol mais LA DISTANCE À L'ÉCRAN : huit cents
  // mètres à fort zoom traversent trois écrans, à faible zoom ils ne bougent presque rien.
  // Un seuil en mètres était donc la mauvaise mesure — il a disparu. On projette le point
  // d'arrivée à l'écran, on mesure sa distance au centre en pixels, on divise par la largeur
  // de la carte : c'est le nombre d'écrans à traverser, au zoom courant.
  // `flyTo` sert TOUT LE TEMPS : sa courbe est presque plate sur un petit déplacement, et
  // prend de l'altitude sur un grand. Le zoom d'arrivée est borné des deux côtés, pour qu'il
  // ne reste jamais collé au précédent quand on était au ras du sol.
  // Chiffres choisis par Sophie AU DOIGT, sur une page d'essai à quatre réglages (v10.16),
  // après trois tentatives devinées qui ont toutes raté. C'est le réglage « D ».
  // Le coupable principal n'était pas la durée mais LE RECUL : une courbe de 1,6 fait
  // s'éloigner la caméra puis se rapprocher, et tout ce mouvement devait tenir dans moins
  // d'une seconde. Courbe ramenée à 1,3, et durées triplées.
  // Ne pas re-régler ces cinq nombres sans le lui redemander au doigt.
  const FLY_ZOOM_MAX = 15, FLY_ZOOM_MIN = 12.5, FLY_CURVE = 1.3;
  const FLY_BASE_MS = 2000, FLY_PER_SCREEN_MS = 2000, FLY_MAX_MS = 5500;
  // #37 · Passer d'une JOURNÉE à l'autre PENDANT LE SURVOL : c'est `goTo`, la fonction du
  // récit, appelée telle quelle (voir `replay`). Il n'existe plus de tempo propre au survol —
  // les quatre nombres du réglage « A » de la v10.19 ont disparu avec lui.
  // #37 · Passer d'une JOURNÉE à l'autre EN LISANT — réglage « B », choisi au doigt par
  // Sophie (v10.19). Un seul vol, plus court, qui prend beaucoup moins d'altitude.
  // Pourquoi la loi par largeurs d'écran a disparu ici : en lisant, la carte est au zoom 12,5
  // (goTo ne rapproche jamais, le recadrage plafonne à 13), et à ce zoom la journée suivante
  // est TOUJOURS à plus de trois écrans — la durée butait donc en permanence sur les 8,5 s.
  // Ce n'était plus un réglage, c'était un seul chiffre. Et ce qui donnait la nausée n'était
  // pas la durée mais LE RECUL : courbe ramenée de 1,5 à 1,1.
  // Ne pas re-régler ces deux nombres sans le lui redemander au doigt.
  const READ_DAY_MS = 4000, READ_DAY_CURVE = 1.1;
  // Le recadrage sur une journée entière en lisant. Retourne la durée employée : l'appelant
  // en a besoin pour ne pas enchaîner un autre mouvement par-dessus celui-ci.
  function flyToDay(M, bounds, opts = {}) {
    if (!bounds) return 0;
    const ms = reducedMotion() ? 0 : READ_DAY_MS;
    fitBounds(M, bounds, { ...opts, duration: ms, curve: READ_DAY_CURVE });
    return ms;
  }
  function screensAway(M, lat, lng) {
    const el = M.container, w = el.clientWidth || 1, h = el.clientHeight || 1;
    let p; try { p = M.map.project([lng, lat]); } catch { return 0; }
    return Math.hypot(p.x - w / 2, p.y - h / 2) / w;
  }
  // Retourne la durée employée : l'appelant en a besoin pour savoir jusqu'à quand la carte
  // est occupée, et ne pas lancer un autre mouvement par-dessus celui-ci.
  function goTo(M, lat, lng) {
    const map = M.map;
    const zoom = Math.min(Math.max(map.getZoom(), FLY_ZOOM_MIN), FLY_ZOOM_MAX);
    if (reducedMotion()) { map.jumpTo({ center: [lng, lat], zoom }); return 0; }   // pas de vol du tout
    const ms = Math.min(FLY_MAX_MS, FLY_BASE_MS + FLY_PER_SCREEN_MS * screensAway(M, lat, lng));
    map.flyTo({ center: [lng, lat], zoom, curve: FLY_CURVE, duration: ms });
    return ms;
  }

  // #37 · Les gestes, réglés un par un plutôt que tout coupé d'un coup.
  // La feuille de style de MapLibre le dit : pincement allumé + déplacement à un doigt
  // éteint donne `touch-action: pan-x pan-y`, c'est-à-dire que LE NAVIGATEUR REPREND LE
  // DÉFILEMENT À UN DOIGT pendant que MapLibre garde le pincement. Les deux allumés donnent
  // `touch-action: none` — la page ne défile plus, et c'est ce qui obligeait aux « gestes
  // coopératifs » et à leur message. Ils ne servent plus.
  // Dans la page : un doigt fait défiler, le pincement zoome, pas de rotation ni de bascule,
  // et la molette fait défiler la page. En plein écran : tout est manipulable.
  function setPageGestures(M, inPage) {
    const map = M.map, on = (h, yes) => { try { yes ? h.enable() : h.disable(); } catch { } };
    try { map.cooperativeGestures.disable(); } catch { }
    on(map.dragPan, !inPage);
    on(map.dragRotate, !inPage);
    on(map.touchPitch, !inPage);
    on(map.scrollZoom, !inPage);
    on(map.touchZoomRotate, true);   // le pincement zoome toujours, dans la page comme en plein écran
    try { inPage ? map.touchZoomRotate.disableRotation() : map.touchZoomRotate.enableRotation(); } catch { }
  }
  function getZoom(M) { return M.map.getZoom(); }
  function resize(M) { try { M.map.resize(); } catch { } }
  function onClick(M, cb) { M.map.on("click", (e) => { if (e.defaultPrevented) return; cb({ lat: e.lngLat.lat, lng: e.lngLat.lng }); }); }
  function setCursor(M, c) { M.map.getCanvas().style.cursor = c || ""; }
  function setCooperative(M, on) { try { on ? M.map.cooperativeGestures.enable() : M.map.cooperativeGestures.disable(); } catch { } }

  function showMe(M, lat, lng) {
    if (!M.me) { const el = document.createElement("div"); el.className = "me-marker"; M.me = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(M.map); }
    else M.me.setLngLat([lng, lat]);
  }
  function meLngLat(M) { return M.me ? M.me.getLngLat() : null; }
  function ping(M, lat, lng) {
    const el = document.createElement("div"); el.className = "ping";
    const mk = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(M.map);
    setTimeout(() => mk.remove(), 900);
  }

  // ---------- Intro : le globe tourne vers le voyage, puis zoom sur le parcours ----------
  function intro(M, bounds, done) {
    if (!bounds) { if (done) done(); return; }
    const run = () => {
      const map = M.map;
      const c = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
      map.setProjection({ type: "globe" });
      map.jumpTo({ center: [c[0] - 110, Math.max(-40, Math.min(40, c[1] * .4))], zoom: 1.2, pitch: 0, bearing: 0 });
      map.easeTo({ center: c, zoom: 2.4, duration: 2600, easing: (t) => 1 - Math.pow(1 - t, 2.2) });
      map.once("moveend", () => {
        map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 2400, essential: true, curve: 1.3 });
        map.once("moveend", () => { if (LS.get(TERRAIN_KEY) === "1") setTerrain(M, true, true); if (done) done(); });
      });
    };
    if (M.ready) run(); else M.map.once("load", run);
  }

  // ---------- Survol du voyage : la caméra suit le parcours, l'itinéraire se dessine, les photos apparaissent ----------
  // options : { dayList, only (iso), speed (nombre ou fonction), dayNumber(iso), onDay(iso, info), onDone(), onPause(paused) }
  // Retourne un contrôleur { stop, pause, resume, next, paused } (aussi dans M.replayCtl ; M.stopReplay = stop).
  const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function replay(M, data, options = {}) {
    if (!M.ready || M.replaying) return null;
    const map = M.map, dayList = options.dayList || dayListOf(data, {});
    const ctl = { stopped: false, paused: false, skip: false, stop: null, pause: null, resume: null, next: null };
    M.replaying = true; M.replayCtl = ctl; M.stopReplay = () => ctl.stop();
    ctl.pause = () => { if (!ctl.paused) { ctl.paused = true; wEl && wEl.classList.remove("walking"); if (options.onPause) options.onPause(true); } };
    ctl.resume = () => { if (ctl.paused) { ctl.paused = false; wEl && wEl.classList.add("walking"); if (options.onPause) options.onPause(false); } };
    ctl.next = () => { ctl.skip = true; ctl.paused = false; };

    // Journées à jouer : trace réelle (GPS, GPX, itinéraire enregistré) sinon tronçons estimés entre les photos
    const days = dayList.filter((iso) => !options.only || iso === options.only).map((iso) => {
      const chemin = dayPath(data, iso), trs = chemin.tracks;
      let coords = chemin.coords;
      const photos = (data.media || []).filter((m) => m.day_date === iso && m.lat != null);
      let est = chemin.est, modes = null, legs = chemin.legs;
      if (est) { modes = coords.modes; }
      else if (coords.length >= 2) {
        const dayMode = dayTransport(data, iso);
        const ph = dayPhotosSorted(data.media, iso).filter((m) => m.transport && MODES[m.transport]);
        modes = new Array(coords.length).fill(dayMode);
        if (ph.length) { let cur = dayMode, pi = 0; const at = ph.map((m) => ({ i: nearestIndex(coords, [m.lng, m.lat]), mode: m.transport })).sort((a, b) => a.i - b.i); for (let i = 0; i < coords.length; i++) { while (pi < at.length && at[pi].i <= i) { cur = at[pi].mode; pi++; } modes[i] = cur; } }
        if (!modes.some(Boolean)) modes = null;
      }
      return { iso, coords, modes, legs, photos, est, color: colorForDay(dayList, iso), km: est ? 0 : trs.reduce((a, t) => a + (t.distance_m || 0), 0) / 1000 };
    }).filter((d) => d.coords.length >= 2 || d.photos.length);
    if (!days.length) { M.replaying = false; return null; }

    const wasTerrain = M.terrain, wasBase = M.base, calm = reducedMotion();
    M.container.classList.add("replaying"); M.container.parentElement && M.container.parentElement.classList.add("replaying");
    // Le survol respecte le bouton 3D : relief seulement s'il est activé (et jamais sur téléphone, où il décale le personnage par rapport au tracé)
    if (isPhone() || !M.terrain || calm) { if (M.terrain) setTerrain(M, false, false); map.setProjection({ type: "mercator" }); }
    map.setPaintProperty("track-line", "line-opacity", .25); map.setPaintProperty("track-halo", "line-opacity", .1); map.setPaintProperty("track-edge", "line-opacity", .25);
    M.revealed = new Set();
    // #37 · PENDANT LE SURVOL, AUCUN REGROUPEMENT. Une photo avalée par une grappe ne peut
    // jamais être révélée : `reveal` cherche une pastille portant l'identifiant de la photo,
    // or une grappe n'en porte pas — et une grappe reste cachée tout le survol. D'où des
    // photos qui n'apparaissaient « que de temps en temps, sur certains jours » : celles qui,
    // ce jour-là, se trouvaient assez isolées pour ne pas être regroupées.
    try { map.getSource("photos").setClusterOptions({ cluster: false }); } catch { }
    for (const mk of M.dayMarkers) mk.getElement().classList.add("hidden");
    for (const mk of M.stopMarkers) mk.getElement().classList.add("hidden");
    for (const e of M.markers.values()) e.el.classList.add("hidden");
    // Valdo (ou son véhicule) avance sur le trajet
    const wEl = document.createElement("div"); wEl.className = "bv-walker"; wEl.innerHTML = '<div class="in"></div>';
    const wIn = wEl.querySelector(".in");
    const walker = new maplibregl.Marker({ element: wEl, anchor: "bottom" });
    let curMode = "?";
    const walkTo = (c, bearing, mode) => {
      if (!walker._map) walker.setLngLat(c).addTo(map); else walker.setLngLat(c);
      wEl.classList.toggle("west", bearing > 180);
      const m = mode && MODES[mode] ? mode : "walk";
      if (m !== curMode) { curMode = m; wIn.innerHTML = (window.BV_PICTOS && BV_PICTOS[m]) || (window.BV_PICTOS && BV_PICTOS.walk) || '<img src="icons/valdo.svg" alt="">'; wEl.dataset.mode = m; }
    };
    try { map.resize(); } catch { }
    let raf = 0;
    const reveal = (m) => { M.revealed.add(m.id); for (const e of M.markers.values()) if (e.el.dataset.id === m.id) { e.el.classList.remove("hidden"); e.el.classList.add("pop"); } };
    const revealDay = (iso) => { for (const m of (data.media || [])) if (m.day_date === iso) M.revealed.add(m.id); for (const e of M.markers.values()) if (e.el.dataset.day === iso) e.el.classList.remove("hidden"); syncPhotoMarkers(M); };
    const finish = () => {
      if (ctl.stopped) return; ctl.stopped = true; cancelAnimationFrame(raf);
      M.replaying = false; M.replayCtl = null; M.container.classList.remove("replaying"); M.container.parentElement && M.container.parentElement.classList.remove("replaying");
      map.getSource("progress").setData(empty()); walker.remove(); M.revealed = null;
      try { map.getSource("photos").setClusterOptions(GROUPES); } catch { }   // les grappes reviennent
      if (M.reading) applyTrackStyle(M);
      else { map.setPaintProperty("track-line", "line-opacity", 1); map.setPaintProperty("track-halo", "line-opacity", .35); map.setPaintProperty("track-edge", "line-opacity", .9); }
      for (const mk of M.dayMarkers) mk.getElement().classList.remove("hidden");
      for (const mk of M.stopMarkers) mk.getElement().classList.remove("hidden");
      for (const e of M.markers.values()) e.el.classList.remove("hidden", "pop");
      if (wasTerrain !== M.terrain) setTerrain(M, wasTerrain, true); else if (!wasTerrain) map.setProjection({ type: "globe" });
      try { map.resize(); } catch { }
      if (wasBase !== M.base) setBase(M, wasBase);
      if (M.pendingDraw) { const p = M.pendingDraw; M.pendingDraw = null; draw(M, p.data, p.options); }
      const b = computeBounds(data, options.only || null); if (b) fitBounds(M, b, { maxZoom: options.only ? 14 : 13, duration: calm ? 0 : 1600 });
      if (options.onDone) options.onDone();
    };
    ctl.stop = finish;

    const wait = (ms) => new Promise((r) => { const t0 = performance.now(); const tick = () => { if (ctl.stopped || ctl.skip) return r(); if (!ctl.paused && performance.now() - t0 >= ms) return r(); setTimeout(tick, 60); }; tick(); });
    const moveEnd = () => new Promise((r) => { let done = false; const f = () => { if (!done) { done = true; r(); } }; map.once("moveend", f); setTimeout(f, 12000); });
    const speedOf = () => { const v = typeof options.speed === "function" ? options.speed() : options.speed; return SPEEDS.some((s) => s.k === v) ? v : replaySpeed(); };
    const ease = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    (async () => {
      // Routes manquantes des tronçons voiture / bus / vélo / moto : on les attend un peu (5 s max), en restant interrompable
      const waits = [];
      for (const d of days) if (d.legs) for (const l of d.legs) if (MODES[l.mode] && MODES[l.mode].path === "road" && !l.road) waits.push(fetchRoad([l.from.lng, l.from.lat], [l.to.lng, l.to.lat]).catch(() => null));
      if (waits.length) {
        await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 5000))]);
        if (ctl.stopped) return;
        for (const d of days) if (d.legs) { applyRoads(d.legs, null); const e = pathFromLegs(d.legs); if (e) { d.coords = e; d.modes = e.modes; } }
      }
      for (let di = 0; di < days.length && !ctl.stopped; di++) {
        const d = days[di]; ctl.skip = false;
        const n = options.dayNumber ? options.dayNumber(d.iso) : di + 1;
        if (options.onDay) options.onDay(d.iso, { n, km: d.km, photos: d.photos.length, index: di, count: days.length });
        for (const mk of M.dayMarkers) if (mk.getElement().title === d.iso) mk.getElement().classList.remove("hidden");

        if (d.coords.length < 2) {
          // Journée sans trace : on survole ses photos
          const b = boundsOf(d.photos); if (b) { fitBounds(M, b, { maxZoom: 14, duration: calm ? 0 : 1800, keepPitch: true }); await moveEnd(); }
          d.photos.forEach((m, i) => setTimeout(() => { if (!ctl.stopped) reveal(m); }, i * 350)); revealDay(d.iso);
          await wait(Math.min(4000, 1500 + d.photos.length * 400)); continue;
        }
        // Cumul des distances le long du tracé, pondéré par la vitesse du moyen de locomotion
        const speedAt = (i) => { const m = d.modes && d.modes[i]; return m && MODES[m] ? MODES[m].speed : 1; };
        const cum = [0]; for (let i = 1; i < d.coords.length; i++) cum.push(cum[i - 1] + dist(d.coords[i - 1], d.coords[i]) / speedAt(i));
        const total = cum[cum.length - 1];
        const realTotal = d.coords.reduce((a, c, i) => i ? a + dist(d.coords[i - 1], c) : 0, 0);
        // #45 · TOUTES LES JOURNÉES VONT À LA MÊME VITESSE.
        // Ce qui compte n'est ni le temps ni les kilomètres, c'est CE QUE L'ŒIL TRAVERSE.
        // Avant : 2,5 s par km, plafonnées à 20 s. Le plafond était atteint dès 8 km à pied et
        // 12 km en voiture, donc presque toutes les journées duraient pareil et la vitesse
        // devenait proportionnelle à la longueur ; le zoom, lui, était un escalier à quatre
        // marches qui compensait par sauts. Mesuré sur le carnet d'Écosse de Sophie :
        // de 0,112 à 0,603 écran par seconde selon la journée, soit DE 1 À 5,4.
        // Maintenant : chaque journée occupe le MÊME NOMBRE DE LARGEURS D'ÉCRAN — c'est le zoom
        // qui s'y adapte, en pente et non plus par marches — et se parcourt à vitesse constante.
        // 0,26 écran/s est le réglage C de la page d'essai, choisi au doigt par Sophie sur son
        // carnet d'Écosse le 11/09/2026. La largeur vient de la CARTE, pas de la fenêtre.
        const ECRANS = 3.5, ECRANS_PAR_S = .26;
        const largeurPx = Math.max(200, map.getContainer().clientWidth || 440);
        const lat0 = d.coords[0][1];
        // Pas de recul supplémentaire pour un chemin estimé : l'ancien escalier en ajoutait
        // 1,4 cran, ce qui montrait ces journées 2,6 fois plus loin — elles ne traversaient
        // alors que 1,33 écran au lieu de 3,5, donc allaient 2,6 fois moins vite que les
        // autres. Mesuré chez Sophie : toutes ses journées sont dans ce cas. L'égalité des
        // vitesses passe avant le cadrage plus large des pointillés.
        let zoom = realTotal > 0
          ? Math.log2(156543.03392 * Math.cos(lat0 * Math.PI / 180) * largeurPx * ECRANS / realTotal)
          : 14;
        zoom = Math.min(17, Math.max(3, zoom));
        const speed = speedOf();
        const duration = ECRANS / ECRANS_PAR_S * 1000 / speed;
        const pitch = calm ? 0 : (isPhone() ? 35 : (d.est ? 40 : 45));
        // Approche : depuis là où est la caméra (fin de la veille) jusqu'au départ du jour, en douceur
        if (calm) { const b = boundsOf(d.coords.map((c) => ({ lng: c[0], lat: c[1] }))); map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0, pitch: 0, bearing: 0 }); }
        else {
          // #37 · EXACTEMENT LE MÊME MOUVEMENT QUE DANS LE RÉCIT — demande de Sophie (v10.26).
          // Dans le récit, passer d'une journée à l'autre c'est un ARC : la caméra dézoome,
          // traverse, et rezoome au même niveau. Mesuré sur le même carnet : creux de 2,69
          // crans côté récit, 0,10 côté survol — ce dernier était donc à plat, et c'est
          // justement ce que Sophie ne veut pas.
          // La cause : `goTo` vole à zoom CONSTANT (il le borne entre 12,5 et 15 et n'en
          // change pas), ce qui donne un arc symétrique et creusé. L'approche du survol, elle,
          // visait le zoom de la journée — une arrivée à un zoom différent aplatit l'arc.
          // Elle vole donc maintenant à zoom constant, comme `goTo`, sans inclinaison ni
          // rotation ; le zoom de la journée et l'inclinaison se prennent ENSUITE, pendant la
          // marche, progressivement — là où l'œil est déjà en mouvement.
          // Littéralement la fonction du récit : aucune divergence possible, ni aujourd'hui
          // ni plus tard. Si un jour le vol du récit change, celui du survol change avec lui.
          goTo(M, d.coords[0][1], d.coords[0][0]);
          await moveEnd();
          // #45 · LE RECUL SE FAIT AVANT LE PREMIER PAS, CARTE IMMOBILE.
          // Il se prenait pendant la marche : tant qu'il n'était pas fini, le sol défilait à
          // une échelle qui n'était pas la sienne. Mesuré sur l'iPhone de Sophie (v10.32) :
          // une pointe à 1,405 écran par seconde au démarrage d'une longue journée, contre
          // 0,26 choisi — cinq fois trop. La caméra recule donc seule, sans avancer, à
          // 0,65 cran par seconde (le rythme qu'elle accepte), puis Valdo part à la bonne
          // vitesse dès le premier pas. L'arc entre journées, lui, n'est pas touché.
          const zAvant = map.getZoom();
          const reculMs = Math.min(6000, Math.abs(zoom - zAvant) / .65 * 1000);
          if (reculMs > 80) { map.easeTo({ zoom, pitch, duration: reculMs, essential: true }); await moveEnd(); }
        }
        if (ctl.stopped) return;
        walkTo(d.coords[0], 0, d.modes ? d.modes[1] : null); wEl.classList.add("walking");

        const photoAt = d.photos.map((m) => ({ m, at: nearestDist(d.coords, cum, [m.lng, m.lat]) })).sort((a, b) => a.at - b.at);
        let pi = 0, seg = 1, bearing = calm ? 0 : map.getBearing(), lastT = performance.now(), elapsed = 0;
        // L'inclinaison, le zoom et l'orientation de la journée se prennent au début de la
        // marche : la caméra bouge déjà, rien ne s'y voit comme un à-coup — au lieu d'être
        // imposés d'un bloc pendant l'approche.
        // #45 · Le zoom et l'inclinaison sont désormais pris AVANT le premier pas (voir le
        // recul ci-dessus) : `zDepart` vaut donc déjà `zoom` et cette reprise ne fait plus
        // rien pour eux. Elle reste là comme filet, au cas où le recul aurait été interrompu.
        // Ne pas y remettre la prise du zoom : c'est ce qui faisait démarrer les longues
        // journées cinq fois trop vite (mesuré chez Sophie, v10.32 : pointe à 1,405 écran/s).
        const zDepart = map.getZoom(), pDepart = map.getPitch();
        const POSE_MS = Math.max(1200, Math.min(6000, Math.abs(zoom - zDepart) / .65 * 1000));
        let pose = 0;
        await new Promise((resolve) => {
          const frame = (now) => {
            if (ctl.stopped) return resolve();
            const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
            if (ctl.paused) { raf = requestAnimationFrame(frame); return; }
            elapsed += dt * 1000;
            const p = ctl.skip ? 1 : Math.min(1, elapsed / duration), ea = .12;
            const e = (p < ea ? p * p / (2 * ea) : p - ea / 2) / (1 - ea / 2);
            const target = e * total;
            while (seg < cum.length - 1 && cum[seg] < target) seg++;
            const a = d.coords[seg - 1], b = d.coords[seg], f = cum[seg] === cum[seg - 1] ? 0 : (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1]);
            const cur = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            map.getSource("progress").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { color: d.color }, geometry: { type: "LineString", coordinates: d.coords.slice(0, seg).concat([cur]) } }] });
            if (!calm) {
              // Regard loin devant (≈ 1/6 du tracé), rotation limitée à 6°/s : caméra posée
              const look = d.coords[Math.min(seg + Math.max(8, Math.floor(d.coords.length / 6)), d.coords.length - 1)];
              const want = dist(cur, look) > 150 ? heading(cur, look) : bearing;
              const delta = ((want - bearing + 540) % 360) - 180;
              bearing = (bearing + Math.max(-6 * dt, Math.min(6 * dt, delta * dt * 1.2)) + 360) % 360;
              pose = Math.min(1, pose + dt * 1000 / POSE_MS);
              const k = pose < .5 ? 2 * pose * pose : 1 - Math.pow(-2 * pose + 2, 2) / 2;
              map.jumpTo({ center: cur, bearing,
                           zoom: zDepart + (zoom - zDepart) * k,
                           pitch: pDepart + (pitch - pDepart) * k });
            }
            walkTo(cur, heading(a, b), d.modes ? d.modes[seg] : null);
            while (pi < photoAt.length && photoAt[pi].at <= target) { reveal(photoAt[pi].m); pi++; }
            if (p < 1) raf = requestAnimationFrame(frame); else resolve();
          };
          raf = requestAnimationFrame(frame);
        });
        if (ctl.stopped) return;
        while (pi < photoAt.length) { reveal(photoAt[pi].m); pi++; } revealDay(d.iso);
        wEl.classList.remove("walking");
        map.setPaintProperty("track-line", "line-opacity", ["case", ["==", ["get", "day"], d.iso], 1, .25]);
        await wait(1200);
      }
      if (!ctl.stopped) { await wait(500); finish(); }
    })();
    return ctl;
  }
  function dist(a, b) { const R = 6371000, dLat = (b[1] - a[1]) * Math.PI / 180, dLng = (b[0] - a[0]) * Math.PI / 180, s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
  function heading(a, b) { const y = Math.sin((b[0] - a[0]) * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180), x = Math.cos(a[1] * Math.PI / 180) * Math.sin(b[1] * Math.PI / 180) - Math.sin(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.cos((b[0] - a[0]) * Math.PI / 180); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function lerpAngle(a, b, t) { let d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; }
  function nearestIndex(coords, p) { let best = 0, bd = Infinity; for (let i = 0; i < coords.length; i++) { const dd = dist(coords[i], p); if (dd < bd) { bd = dd; best = i; } } return best; }
  function nearestDist(coords, cum, p) { let best = 0, bd = Infinity; for (let i = 0; i < coords.length; i++) { const dd = dist(coords[i], p); if (dd < bd) { bd = dd; best = i; } } return cum[best]; }

  return { MODES, SPEEDS, replaySpeed, cycleSpeed, arc, estimatedLegs, pathFromLegs, dayTransport, dayPhotosSorted, reducedMotion, maps, create, draw, drawStopMarkers, focusMedia, setActiveDay, fitBounds, flyToBounds, setView, easeTo, goTo, flyToDay, flyOverview, setOverview, dayPath, setPageGestures, getZoom, resize, onClick, setCursor, setCooperative, showMe, meLngLat, ping, setBase, setTerrain, intro, replay, colorForDay, computeBounds, boundsOf, BASES, DAY_COLORS };
})();
