// ============================================================
//  TEMPORAIRE — l'enregistreur et les trois façons de passer d'une journée à l'autre (#37).
//  Ne sert QU'À essai-mesure.html. Il n'écrit rien dans l'application : il écoute la carte,
//  et il remplace `BVMAP.flyToDay` (le recadrage d'une journée EN LISANT) le temps de l'essai.
//  À supprimer, avec la page d'essai, dès que le réglage est choisi.
// ============================================================
(function () {
  if (!window.maplibregl) return;
  const P = maplibregl.Map.prototype;
  const s1 = (x) => (x / 1000).toFixed(1).replace(".", ",");
  const n1 = (x) => x.toFixed(1).replace(".", ",");
  const LS = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
               set: (k, v) => { try { localStorage.setItem(k, v); } catch { } } };

  let carte = null, dansFit = false, ouvert = null, releves = [], lie = false;
  let dernierY = 0, dernierT = 0, vitesseDefile = 0;
  let reglage = LS.get("bv_essai_passage") || "B";
  // Les deux limites de confort, tirées du survol que Sophie accepte (relevé du 11/09 sur
  // son iPhone : 3,6 crans en 8,5 s, et 1,0 écran/s au sol).
  const TAUX_Z = .42, TAUX_X = 1.0, FACTEUR = 1.6, T_MIN = 3000, T_MAX = 9000;

  // ---------- le défilement : sa vitesse à l'instant où un mouvement démarre ----------
  addEventListener("scroll", () => {
    const t = performance.now(), y = scrollY;
    if (dernierT) { const dt = t - dernierT; if (dt > 0) vitesseDefile = Math.abs(y - dernierY) / dt * 1000; }
    dernierY = y; dernierT = t;
  }, { passive: true });
  setInterval(() => { if (performance.now() - dernierT > 120) vitesseDefile = 0; }, 60);

  // ---------- les images, le recul, la vitesse apparente ----------
  let derniereImage = performance.now();
  (function boucle() {
    const t = performance.now(), ecart = t - derniereImage;
    derniereImage = t;
    if (ouvert && carte) {
      ouvert.images++;
      if (ecart > ouvert.pire) ouvert.pire = ecart;
      if (ecart > 50) ouvert.trous++;
      try {
        const c = carte.getCenter(), z = carte.getZoom();
        ouvert.zMin = Math.min(ouvert.zMin, z); ouvert.zMax = Math.max(ouvert.zMax, z);
        if (ouvert.avant) {
          const r = Math.PI / 180, R = 6371000;
          const dLat = (c.lat - ouvert.avant.lat) * r, dLng = (c.lng - ouvert.avant.lng) * r;
          const s = Math.sin(dLat / 2) ** 2 + Math.cos(c.lat * r) * Math.cos(ouvert.avant.lat * r) * Math.sin(dLng / 2) ** 2;
          const m = 2 * R * Math.asin(Math.sqrt(s));
          const ech = 156543.03 * Math.cos(c.lat * r) / Math.pow(2, z);
          const larg = carte.getContainer().clientWidth || 440;
          // un saut instantané n'est pas une vitesse : on l'ignore
          if (ecart > 0 && ecart < 200) ouvert.vitesse = Math.max(ouvert.vitesse, (m / ech) / larg / (ecart / 1000));
        }
        ouvert.avant = { lat: c.lat, lng: c.lng };
      } catch { }
    }
    requestAnimationFrame(boucle);
  })();

  function ferme() {
    if (!ouvert) return;
    ouvert.duree = performance.now() - ouvert.t0;
    ouvert.parSeconde = ouvert.duree > 0 ? ouvert.images / (ouvert.duree / 1000) : 0;
    releves.push(ouvert); if (releves.length > 6) releves.shift();
    ouvert = null;
    affiche();
  }
  function ouvre(quoi, o, bougeait, force) {
    ferme();
    let z = 0; try { z = carte.getZoom(); } catch { }
    ouvert = { quoi, t0: performance.now(), demande: o && o.duration, zDepart: z, zMin: z, zMax: z,
               images: 0, pire: 0, trous: 0, vitesse: 0, coupe: bougeait,
               defile: Math.round(vitesseDefile), avant: null, force: !!force };
    affiche();
  }

  for (const nom of ["flyTo", "easeTo", "fitBounds"]) {
    const vrai = P[nom];
    P[nom] = function (...a) {
      carte = this;
      if (!lie) { lie = true; this.on("moveend", () => { if (!ouvert || !ouvert.force) ferme(); }); }
      const o = nom === "fitBounds" ? a[1] : a[0];
      // Pendant un passage de journée, tous les mouvements appartiennent à CE passage :
      // on ne les compte pas à part, sinon le relevé serait illisible.
      if (!(nom === "flyTo" && dansFit) && !(ouvert && ouvert.force)) {
        let bougeait = false; try { bougeait = this.isMoving(); } catch { }
        ouvre(nom === "fitBounds" ? "recadrage" : (o && o.curve === 1.3 ? "photo" : "carte"), o, bougeait);
      }
      if (nom === "fitBounds") { dansFit = true; try { return vrai.apply(this, a); } finally { dansFit = false; } }
      return vrai.apply(this, a);
    };
  }

  // ---------- le voile, pour les façons qui tournent la page ----------
  let voileEl = null;
  function voile(o) {
    if (!voileEl) {
      const w = document.getElementById("map-wrap"); if (!w) return;
      voileEl = document.createElement("div");
      voileEl.style.cssText = "position:absolute;inset:0;z-index:30;background:#0E1620;opacity:0;pointer-events:none;transition:opacity .2s linear";
      w.appendChild(voileEl);
    }
    voileEl.style.opacity = o;
  }

  // ---------- les trois façons de passer d'une journée à l'autre ----------
  // On remplace le seul point d'entrée du recadrage EN LISANT. Le survol, lui, ne passe
  // pas par là : il garde son tempo, celui que Sophie a gardé.
  function poseVariantes() {
    if (!window.BVMAP || BVMAP.__essai) return;
    BVMAP.__essai = true;
    const vrai = BVMAP.flyToDay;
    BVMAP.flyToDay = function (M, bounds, opts = {}) {
      if (!bounds) return 0;
      carte = M.map;
      let bougeait = false; try { bougeait = M.map.isMoving(); } catch { }
      if (reglage === "B") {                       // ce qui est en ligne : un vol de 4 s
        ouvre("passage B", { duration: 4000 }, bougeait, true);
        const ms = vrai(M, bounds, opts);
        setTimeout(ferme, ms + 60);
        return ms;
      }
      const map = M.map, pad = opts.padding == null ? 48 : opts.padding, zMax = opts.maxZoom || 13;
      let cam = null; try { cam = map.cameraForBounds(bounds, { padding: pad, maxZoom: zMax }); } catch { }
      const cible = cam ? [cam.center.lng, cam.center.lat]
                        : [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
      const zFin = cam ? Math.min(cam.zoom, zMax) : map.getZoom();
      const garde = { pitch: map.getPitch(), bearing: map.getBearing() };
      if (reglage === "C") {                       // d'un coup, comme on tourne la page
        const ms = 900;
        ouvre("passage C", { duration: ms }, bougeait, true);
        voile(1);
        setTimeout(() => { if (ouvert) ouvert.saut = true; map.jumpTo({ center: cible, zoom: zFin, ...garde }); voile(0); }, 240);
        setTimeout(ferme, ms);
        return ms;
      }
      if (reglage === "E") {
        // E · UN VRAI VOL, mais dont le PLONGEON est bridé.
        // MapLibre sait le faire : `minZoom` fixe le zoom au sommet du vol — mais il est
        // IGNORÉ si on lui donne aussi `curve`, ce que l'application fait toujours. D'où
        // un plongeon jamais maîtrisé jusqu'ici.
        // Le plongeon et la durée sont déduits des DEUX limites que Sophie accepte déjà sur
        // le survol, mesurées sur son iPhone : 0,42 cran de zoom par seconde en descente,
        // et 1,0 largeur d'écran par seconde au sol. On cherche le plongeon qui satisfait
        // les deux dans le temps le plus court : plonger moins oblige à filer plus vite au
        // sol, plonger plus coûte du temps en descente. Il y a un creux entre les deux.
        const zDep = map.getZoom();
        const ecrans = (() => {
          try {
            const el = M.container, w = el.clientWidth || 1, h = el.clientHeight || 1;
            const q = map.project(cible);
            return Math.max(.2, Math.hypot(q.x - w / 2, q.y - h / 2) / w);
          } catch { return 1; }
        })();
        let mieux = null;
        for (let d = 1; d <= 5.01; d += .25) {
          const t = Math.max(d / TAUX_Z, (ecrans / Math.pow(2, d)) * FACTEUR / TAUX_X) * 1000;
          if (!mieux || t < mieux.t) mieux = { d, t };
        }
        const ms = Math.max(T_MIN, Math.min(T_MAX, mieux.t));
        ouvre("passage E", { duration: ms }, bougeait, true);
        const sommet = Math.max(0, Math.min(zDep, zFin) - mieux.d);
        map.flyTo({ center: cible, zoom: zFin, minZoom: sommet, duration: ms, ...garde });
        setTimeout(ferme, ms + 60);
        return ms;
      }
      // D : reculer sur place, tourner la page, se poser — aucun plongeon
      const ms = 2700;
      ouvre("passage D", { duration: ms }, bougeait, true);
      const haut = Math.max(zFin - .4, map.getZoom() - 2.2);
      map.easeTo({ zoom: haut, duration: 1000 });
      setTimeout(() => voile(1), 1000);
      setTimeout(() => { if (ouvert) ouvert.saut = true; map.jumpTo({ center: cible, zoom: haut, ...garde }); voile(0); }, 1240);
      setTimeout(() => { map.easeTo({ center: cible, zoom: zFin, duration: 1100 }); }, 1480);
      setTimeout(ferme, ms);
      return ms;
    };
  }
  const guette = setInterval(poseVariantes, 40); poseVariantes();
  setTimeout(() => clearInterval(guette), 20000);

  // ---------- le tableau de bord ----------
  const bas = document.createElement("div");
  bas.id = "mesure";
  bas.className = "replie";
  bas.innerHTML =
    '<div id="mesure-tirette">▲ relevé — toucher pour ouvrir</div>' +
    '<div id="mesure-court"></div>' +
    '<div id="mesure-texte">Fais défiler du jour 3 au jour 4.</div>' +
    '<div id="mesure-choix"><span>façon de passer :</span>' +
      '<button data-r="B">B</button><button data-r="C">C</button>' +
      '<button data-r="D">D</button><button data-r="E">E</button></div>' +
    '<div id="mesure-btns"><button id="mesure-copier">Copier le relevé</button>' +
    '<button id="mesure-vider">Effacer</button></div>';
  const css = document.createElement("style");
  css.textContent = `
    #mesure { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
      background: rgba(10,16,24,.92); color: #fff; border-top: 1px solid rgba(255,255,255,.2);
      font: 12px/1.35 ui-monospace, Menlo, monospace; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
      max-height: 52vh; overflow: auto; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
    #mesure .mauvais { color: #FF6B6B; font-weight: 700; }
    #mesure .bon { color: #86EFAC; font-weight: 700; }
    #mesure .rel { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.12); }
    #mesure-tirette { font: 600 12px/1.2 -apple-system, system-ui, sans-serif; opacity: .8;
      padding: 6px 0; text-align: center; }
    #mesure.replie { max-height: none; }
    #mesure.replie #mesure-texte, #mesure.replie #mesure-btns { display: none; }
    #mesure-court { font: 600 12px/1.3 ui-monospace, Menlo, monospace; text-align: center; padding-bottom: 4px; }
    #mesure-choix { display: flex; align-items: center; gap: 6px; margin-top: 8px;
      font: 600 12px/1 -apple-system, system-ui, sans-serif; }
    #mesure-choix span { opacity: .75; }
    #mesure-choix button { flex: 1; min-height: 44px; border-radius: 12px; font: 800 17px/1 inherit;
      border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.08); color: #fff; }
    #mesure-choix button.on { background: #F97316; border-color: #F97316; }
    #mesure-btns { display: flex; gap: 8px; margin-top: 8px; }
    #mesure-btns button { flex: 1; min-height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,.28);
      background: rgba(255,255,255,.08); color: #fff; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
    body { padding-bottom: 150px; }`;

  function pose() {
    if (!document.body) return setTimeout(pose, 30);
    document.head.appendChild(css); document.body.appendChild(bas);
    document.getElementById("mesure-tirette").onclick = () => {
      const r = bas.classList.toggle("replie");
      document.getElementById("mesure-tirette").textContent =
        r ? "▲ relevé — toucher pour ouvrir" : "▼ toucher pour replier";
      affiche();
    };
    document.getElementById("mesure-vider").onclick = () => { releves = []; affiche(); };
    for (const b of bas.querySelectorAll("#mesure-choix button")) b.onclick = () => {
      reglage = b.dataset.r; LS.set("bv_essai_passage", reglage); affiche();
    };
    document.getElementById("mesure-copier").onclick = () => {
      const t = texte(true);
      try { navigator.clipboard.writeText(t); } catch { }
      const z = document.createElement("textarea");
      z.value = t; document.body.appendChild(z); z.select();
      try { document.execCommand("copy"); } catch { }
      z.remove();
      const c = document.getElementById("mesure-copier");
      c.textContent = "Copié ✓";
      setTimeout(() => { c.textContent = "Copier le relevé"; }, 1600);
    };
    affiche();
  }
  pose();

  // Déclarées en `function` : le tableau de bord s'affiche avant d'arriver ici.
  function saccade(r) { return r.parSeconde < 40 || r.pire > 60; }
  function estPassage(r) { return r.quoi.indexOf("passage") === 0; }
  function ligne(r, brut) {
    const m = (t, mauvais) => (brut || !mauvais) ? t : '<span class="mauvais">' + t + "</span>";
    const a = r.quoi + " " + s1(r.duree) + " s · " + m(Math.round(r.parSeconde) + " img/s", saccade(r))
      + " · pire trou " + m(Math.round(r.pire) + " ms", r.pire > 60);
    const recul = r.zDepart - r.zMin;
    const b2 = "RECUL " + m(n1(recul) + " crans", estPassage(r) && recul > 2.5)
      + " · " + m(n1(r.duree > 0 ? recul / (r.duree / 1000) : 0) + " cran/s", estPassage(r) && recul / (r.duree / 1000) > .55)
      + (r.saut ? " · saut de page" : " · vitesse " + n1(r.vitesse) + " écr/s") + " · départ z" + n1(r.zDepart)
      + (r.coupe ? m(" COUPE", true) : "") + " · défilement " + r.defile + " px/s";
    return brut ? a + "\n   " + b2 : '<div class="rel">' + a + "<br>" + b2 + "</div>";
  }
  function verdict(brut) {
    const j = releves.filter(estPassage);
    if (!j.length) return brut ? "réglage " + reglage + " — aucun passage encore"
                               : "réglage <b>" + reglage + "</b> — aucun passage encore";
    const d = j[j.length - 1], recul = d.zDepart - d.zMin, taux = d.duree > 0 ? recul / (d.duree / 1000) : 0;
    const bon = taux <= .55;
    const t = "réglage " + reglage + " · recul " + n1(recul) + " crans en " + s1(d.duree)
      + " s = " + n1(taux) + " cran/s " + (bon ? "✓" : "✗ (le survol accepté : 0,4)");
    return brut ? t : '<div class="' + (bon ? "bon" : "mauvais") + '">' + t + "</div>";
  }
  function texte(brut) {
    const l = ["Bonvoyage v" + (window.BV_VERSION || "?") + " — " + new Date().toLocaleString("fr-FR")];
    l.push(verdict(brut));
    if (ouvert) l.push(brut ? "en cours…" : '<div class="rel">en cours…</div>');
    for (const r of [...releves].reverse()) l.push(ligne(r, brut));
    return l.join(brut ? "\n" : "");
  }
  function affiche() {
    const el = document.getElementById("mesure-texte");
    if (el) el.innerHTML = texte(false);
    const c = document.getElementById("mesure-court");
    if (c) c.innerHTML = verdict(false);
    for (const b of bas.querySelectorAll("#mesure-choix button")) b.classList.toggle("on", b.dataset.r === reglage);
  }
})();
