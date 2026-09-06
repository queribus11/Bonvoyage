// ============================================================
//  Bonvoyage v8 — carte immersive
//  MapLibre GL · satellite (Esri) · relief 3D (tuiles d'altitude AWS) · globe · photos sur la carte · survol du voyage
//  Aucune clé d'accès nécessaire.
// ============================================================
window.BVMAP = (() => {
  const cfg = window.CARNET_CONFIG || {};
  const STYLE_KEY = "bv_map_base", TERRAIN_KEY = "bv_map_3d";
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };

  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const maps = [];   // cartes créées (utile pour le diagnostic : BVMAP.maps[0].map)
  const BASES = {
    satellite: { label: "Satellite", short: "Sat." },
    relief:    { label: "Relief",    short: "Relief" },
    plan:      { label: "Plan",      short: "Plan" },
  };
  const LEGACY = { voyager: "satellite", positron: "plan", osm: "plan", outdoors: "relief", hybrid: "satellite" };   // « voyager » était l'ancien défaut : on passe au satellite
  const DAY_COLORS = ["#F97316", "#0D8FE0", "#7CB518", "#F5B301", "#3AA0F5", "#9ACD1E", "#E05A8A", "#8B5CF6", "#F97316", "#0D8FE0"];

  function defaultBase() {
    const saved = LS.get(STYLE_KEY);
    if (saved && BASES[saved]) return saved;
    const c = cfg.MAP_STYLE || "satellite";
    return BASES[c] ? c : (LEGACY[c] || "satellite");
  }

  // ---------- Style MapLibre : toutes les sources, la visibilité fait le choix du fond ----------
  function buildStyle(base, dark) {
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
        photos:   { type: "geojson", data: empty(), cluster: true, clusterRadius: 46, clusterMaxZoom: 17 },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": dark ? "#0E1620" : "#DCEBF7" } },
        { id: "b-esri", type: "raster", source: "esri", layout: vis("satellite"), paint: { "raster-fade-duration": 200 } },
        { id: "b-esri-roads", type: "raster", source: "esriroads", layout: vis("satellite"), paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 6, 0, 9, .8], "raster-fade-duration": 200 } },
        { id: "b-esri-ref", type: "raster", source: "esriref", layout: vis("satellite"), paint: { "raster-fade-duration": 200 } },
        { id: "b-topo", type: "raster", source: "topo", layout: vis("relief"), paint: dark ? { "raster-brightness-max": .8, "raster-saturation": -.2 } : {} },
        { id: "b-osm", type: "raster", source: "osm", layout: vis("plan"), paint: dark ? { "raster-brightness-max": .72, "raster-saturation": -.35, "raster-contrast": .1 } : {} },
        { id: "b-hill", type: "hillshade", source: "demhill", layout: vis("plan"), paint: { "hillshade-exaggeration": .35, "hillshade-shadow-color": "#123F66", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#123F66" } },
        { id: "track-halo", type: "line", source: "tracks", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 6, 14, 12], "line-opacity": .35, "line-blur": 3 } },
        { id: "track-edge", type: "line", source: "tracks", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4.5, 14, 7], "line-opacity": .9 } },
        { id: "track-line", type: "line", source: "tracks", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 4.5], "line-opacity": 1 } },
        { id: "progress-halo", type: "line", source: "progress", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 14, "line-opacity": .45, "line-blur": 4 } },
        { id: "progress-line", type: "line", source: "progress", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": 5 } },
        { id: "dots", type: "circle", source: "dots", paint: { "circle-radius": 6, "circle-color": ["get", "color"], "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 } },
        // Source « photos » : les vignettes sont des éléments HTML (voir syncPhotoMarkers) ; ce calque invisible sert au regroupement
        { id: "photos-hidden", type: "circle", source: "photos", paint: { "circle-radius": 0, "circle-opacity": 0 } },
      ],
    };
  }
  function empty() { return { type: "FeatureCollection", features: [] }; }

  function colorForDay(dayList, iso) {
    const i = dayList.indexOf(iso);
    return DAY_COLORS[(i < 0 ? 0 : i) % DAY_COLORS.length];
  }

  // ---------- Création ----------
  // opts : { cooperative (page des proches : deux doigts pour bouger la carte), terrain (3D au départ), globe (zoom monde au départ), controlsPos }
  function create(el, opts = {}) {
    const container = typeof el === "string" ? document.getElementById(el) : el;
    const isDark = () => !!(window.THEME && THEME.isDark());
    const M = { base: defaultBase(), terrain: false, ready: false, markers: new Map(), dayMarkers: [], me: null, data: null, drawOpts: {}, replaying: false, container };

    const map = new maplibregl.Map({
      container, style: buildStyle(M.base, isDark()),
      center: [2.5, 46.6], zoom: opts.globe ? 1.4 : 4.6, pitch: 0, bearing: 0,
      maxPitch: 72, attributionControl: false, cooperativeGestures: !!opts.cooperative,
      dragRotate: true, touchPitch: true, fadeDuration: 150, hash: false,
    });
    M.map = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), opts.controlsPos || "bottom-right");
    map.on("load", () => {
      M.ready = true;
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
  // data : { tracks, media } · options : { dayList, dayFilter, thumbUrl(m), onMediaClick(m), onTrackClick(tr), onDayClick(iso), dayNumber(iso) }
  function draw(M, data, options = {}) {
    M.data = data; M.drawOpts = options;
    if (!M.ready) { M.pendingDraw = { data, options }; return { bounds: computeBounds(data, options.dayFilter), dayList: dayListOf(data, options) }; }
    const map = M.map, { tracks = [], media = [] } = data;
    const dayList = dayListOf(data, options), filter = options.dayFilter;
    const lines = [], dots = [], photos = [];
    for (const tr of tracks) {
      if (filter && tr.day_date !== filter) continue;
      const pts = (tr.points || []).filter((p) => p && p.lat != null && p.lng != null);
      const color = colorForDay(dayList, tr.day_date);
      if (pts.length >= 2) lines.push({ type: "Feature", properties: { id: tr.id, color, day: tr.day_date || "" }, geometry: { type: "LineString", coordinates: pts.map((p) => [p.lng, p.lat]) } });
      else if (pts.length === 1) dots.push({ type: "Feature", properties: { id: tr.id, color }, geometry: { type: "Point", coordinates: [pts[0].lng, pts[0].lat] } });
    }
    for (const m of media) {
      if (filter && m.day_date !== filter) continue;
      if (m.lat == null || m.lng == null) continue;
      photos.push({ type: "Feature", properties: { id: m.id }, geometry: { type: "Point", coordinates: [m.lng, m.lat] } });
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
    for (const mk of M.markers.values()) mk.marker.remove(); M.markers.clear();
    syncPhotoMarkers(M);
    return { bounds: computeBounds(data, filter), dayList };
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
      const el = document.createElement("div"); el.className = "bv-day"; el.style.background = colorForDay(dayList, iso); el.textContent = n || "•";
      el.title = iso;
      el.addEventListener("click", (e) => { e.stopPropagation(); if (options.onDayClick) options.onDayClick(iso); });
      const mk = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(M.map);
      M.dayMarkers.push(mk);
    });
  }

  // Vignettes photos (HTML) et grappes, calées sur la source « photos » regroupée par MapLibre
  function syncPhotoMarkers(M) {
    if (!M.ready || !M.mediaById) return;
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
        el.className = "bv-photo" + (M.replaying ? " hidden" : "");
        if (p.cluster) {
          el.classList.add("cluster");
          el.innerHTML = `<img alt=""><span class="n">${p.point_count_abbreviated}</span>`;
          src.getClusterLeaves(p.cluster_id, 1, 0).then((leaves) => { const m = leaves && leaves[0] && M.mediaById.get(leaves[0].properties.id); const img = el.querySelector("img"); if (m && img) img.src = thumbOf(M, m); }).catch(() => { });
          el.addEventListener("click", (e) => { e.stopPropagation(); src.getClusterExpansionZoom(p.cluster_id).then((z) => map.easeTo({ center: [lng, lat], zoom: Math.min(z + .3, 18), duration: 600 })).catch(() => { }); });
        } else {
          const m = M.mediaById.get(p.id); if (!m) continue;
          el.innerHTML = `<img alt="" src="${thumbOf(M, m)}">${m.kind === "video" ? '<span class="play">▶</span>' : ""}`;
          el.addEventListener("click", (e) => { e.stopPropagation(); if (M.drawOpts.onMediaClick) M.drawOpts.onMediaClick(m); });
          el.dataset.id = m.id; el.dataset.day = m.day_date || "";
        }
        entry = { marker: new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map), el };
        M.markers.set(key, entry);
      }
    }
    for (const [key, entry] of M.markers) if (!seen.has(key)) { entry.marker.remove(); M.markers.delete(key); }
  }
  function thumbOf(M, m) { return M.drawOpts.thumbUrl ? M.drawOpts.thumbUrl(m) : ""; }

  // ---------- Caméra et utilitaires ----------
  function fitBounds(M, bounds, opts = {}) {
    if (!bounds) return;
    const pad = opts.padding == null ? 48 : opts.padding;
    const same = bounds[0][0] === bounds[1][0] && bounds[0][1] === bounds[1][1];
    if (same) { M.map[opts.animate === false ? "jumpTo" : "easeTo"]({ center: bounds[0], zoom: Math.min(opts.maxZoom || 15, 14), duration: opts.duration ?? 800 }); return; }
    M.map.fitBounds(bounds, { padding: pad, maxZoom: opts.maxZoom || 15, duration: opts.animate === false ? 0 : (opts.duration ?? 900), pitch: opts.keepPitch ? M.map.getPitch() : (M.terrain ? Math.min(M.map.getPitch(), 45) : 0), bearing: opts.keepPitch ? M.map.getBearing() : 0 });
  }
  function flyToBounds(M, bounds, opts = {}) { fitBounds(M, bounds, { ...opts, duration: opts.duration ?? 1400 }); }
  function setView(M, lat, lng, zoom) { M.map.jumpTo({ center: [lng, lat], zoom: zoom ?? M.map.getZoom() }); }
  function easeTo(M, lat, lng, zoom) { M.map.easeTo({ center: [lng, lat], zoom: zoom ?? M.map.getZoom(), duration: 700 }); }
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
  // options : { dayList, dayNumber(iso), onDay(iso, info), onDone(), speedKmh }
  function replay(M, data, options = {}) {
    if (!M.ready || M.replaying) return;
    const map = M.map, dayList = options.dayList || dayListOf(data, {});
    const days = dayList.map((iso) => {
      const trs = (data.tracks || []).filter((t) => t.day_date === iso && (t.points || []).length >= 2).slice().sort((a, b) => (a.points[0].t || 0) - (b.points[0].t || 0));
      const coords = trs.flatMap((t) => t.points.filter((p) => p && p.lat != null).map((p) => [p.lng, p.lat]));
      const photos = (data.media || []).filter((m) => m.day_date === iso && m.lat != null);
      return { iso, coords, photos, color: colorForDay(dayList, iso), km: trs.reduce((a, t) => a + (t.distance_m || 0), 0) / 1000 };
    }).filter((d) => d.coords.length >= 2 || d.photos.length);
    if (!days.length) return;

    const wasTerrain = M.terrain, wasBase = M.base;
    M.replaying = true; M.container.classList.add("replaying");
    if (!M.terrain) setTerrain(M, true, false);
    map.setPaintProperty("track-line", "line-opacity", .25); map.setPaintProperty("track-halo", "line-opacity", .1); map.setPaintProperty("track-edge", "line-opacity", .25);
    for (const mk of M.dayMarkers) mk.getElement().classList.add("hidden");
    for (const e of M.markers.values()) e.el.classList.add("hidden");

    let stopped = false, raf = 0;
    const reveal = (m) => { for (const e of M.markers.values()) if (e.el.dataset.id === m.id || e.el.classList.contains("cluster")) { e.el.classList.remove("hidden"); e.el.classList.add("pop"); } };
    const revealDay = (iso) => { for (const e of M.markers.values()) if (e.el.dataset.day === iso || e.el.classList.contains("cluster")) e.el.classList.remove("hidden"); };
    const finish = () => {
      stopped = true; cancelAnimationFrame(raf);
      M.replaying = false; M.container.classList.remove("replaying");
      map.getSource("progress").setData(empty());
      map.setPaintProperty("track-line", "line-opacity", 1); map.setPaintProperty("track-halo", "line-opacity", .35); map.setPaintProperty("track-edge", "line-opacity", .9);
      for (const mk of M.dayMarkers) mk.getElement().classList.remove("hidden");
      for (const e of M.markers.values()) e.el.classList.remove("hidden", "pop");
      if (!wasTerrain) setTerrain(M, false, true);
      if (wasBase !== M.base) setBase(M, wasBase);
      const b = computeBounds(data, null); if (b) fitBounds(M, b, { maxZoom: 13, duration: 1600 });
      if (options.onDone) options.onDone();
    };
    M.stopReplay = finish;

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const moveEnd = () => new Promise((r) => map.once("moveend", r));

    (async () => {
      for (let di = 0; di < days.length && !stopped; di++) {
        const d = days[di];
        const n = options.dayNumber ? options.dayNumber(d.iso) : di + 1;
        if (options.onDay) options.onDay(d.iso, { n, km: d.km, photos: d.photos.length });
        for (const mk of M.dayMarkers) if (mk.getElement().title === d.iso) mk.getElement().classList.remove("hidden");

        if (d.coords.length < 2) {
          // Journée sans trace : on survole ses photos
          const b = boundsOf(d.photos); if (b) { fitBounds(M, b, { maxZoom: 14, duration: 1800, keepPitch: true }); await moveEnd(); }
          d.photos.forEach((m, i) => setTimeout(() => reveal(m), i * 350)); revealDay(d.iso);
          await wait(Math.min(4000, 1500 + d.photos.length * 400)); continue;
        }
        // Cumul des distances le long du tracé
        const cum = [0]; for (let i = 1; i < d.coords.length; i++) cum.push(cum[i - 1] + dist(d.coords[i - 1], d.coords[i]));
        const total = cum[cum.length - 1];
        const zoom = total < 12000 ? 14.2 : total < 40000 ? 13 : total < 120000 ? 11.8 : 10.5;
        const duration = Math.max(4000, Math.min(16000, total / 1000 * 450));
        // Position de la caméra sur le départ
        const bearing0 = heading(d.coords[0], d.coords[Math.min(5, d.coords.length - 1)]);
        map.easeTo({ center: d.coords[0], zoom, pitch: 60, bearing: bearing0, duration: 1800, easing: (t) => 1 - Math.pow(1 - t, 2) });
        await moveEnd(); if (stopped) return;

        // Photos ordonnées par distance le long du tracé
        const photoAt = d.photos.map((m) => ({ m, at: nearestDist(d.coords, cum, [m.lng, m.lat]) })).sort((a, b) => a.at - b.at);
        let pi = 0, seg = 1, bearing = bearing0;
        const t0 = performance.now();
        await new Promise((resolve) => {
          const frame = (now) => {
            if (stopped) return resolve();
            const p = Math.min(1, (now - t0) / duration), e = p < .1 ? p * p * 50 : p; // léger démarrage en douceur
            const target = e * total;
            while (seg < cum.length - 1 && cum[seg] < target) seg++;
            const a = d.coords[seg - 1], b = d.coords[seg], f = cum[seg] === cum[seg - 1] ? 0 : (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1]);
            const cur = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            const line = d.coords.slice(0, seg).concat([cur]);
            map.getSource("progress").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { color: d.color }, geometry: { type: "LineString", coordinates: line } }] });
            const look = d.coords[Math.min(seg + 8, d.coords.length - 1)];
            bearing = lerpAngle(bearing, heading(cur, look), .04);
            map.jumpTo({ center: cur, bearing, zoom: map.getZoom(), pitch: map.getPitch() });
            while (pi < photoAt.length && photoAt[pi].at <= target) { reveal(photoAt[pi].m); pi++; }
            if (p < 1) raf = requestAnimationFrame(frame); else resolve();
          };
          raf = requestAnimationFrame(frame);
        });
        if (stopped) return;
        while (pi < photoAt.length) { reveal(photoAt[pi].m); pi++; } revealDay(d.iso);
        // La journée est dessinée : elle rejoint le tracé complet
        map.setPaintProperty("track-line", "line-opacity", ["case", ["==", ["get", "day"], d.iso], 1, .25]);
        await wait(1200);
      }
      if (!stopped) { await wait(600); finish(); }
    })();
  }
  function dist(a, b) { const R = 6371000, dLat = (b[1] - a[1]) * Math.PI / 180, dLng = (b[0] - a[0]) * Math.PI / 180, s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
  function heading(a, b) { const y = Math.sin((b[0] - a[0]) * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180), x = Math.cos(a[1] * Math.PI / 180) * Math.sin(b[1] * Math.PI / 180) - Math.sin(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.cos((b[0] - a[0]) * Math.PI / 180); return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
  function lerpAngle(a, b, t) { let d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; }
  function nearestDist(coords, cum, p) { let best = 0, bd = Infinity; for (let i = 0; i < coords.length; i++) { const dd = dist(coords[i], p); if (dd < bd) { bd = dd; best = i; } } return cum[best]; }

  return { maps, create, draw, fitBounds, flyToBounds, setView, easeTo, getZoom, resize, onClick, setCursor, setCooperative, showMe, meLngLat, ping, setBase, setTerrain, intro, replay, colorForDay, computeBounds, boundsOf, BASES, DAY_COLORS };
})();
