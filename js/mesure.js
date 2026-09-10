// ============================================================
//  TEMPORAIRE — l'enregistreur (#37). Ne sert QUE à essai-mesure.html.
//  Il ne modifie rien : il écoute la carte et le défilement, et affiche un relevé.
//  À supprimer, avec la page d'essai, dès que la cause est trouvée.
// ============================================================
(function () {
  if (!window.maplibregl) return;
  const P = maplibregl.Map.prototype;
  const s1 = (x) => (x / 1000).toFixed(1).replace(".", ",");
  const n1 = (x) => x.toFixed(1).replace(".", ",");

  let carte = null, dansFit = false, ouvert = null, releves = [], lie = false;
  let dernierY = 0, dernierT = 0, vitesseDefile = 0;

  // ---------- le défilement : sa vitesse à l'instant où un mouvement démarre ----------
  addEventListener("scroll", () => {
    const t = performance.now(), y = scrollY;
    if (dernierT) { const dt = t - dernierT; if (dt > 0) vitesseDefile = Math.abs(y - dernierY) / dt * 1000; }
    dernierY = y; dernierT = t;
  }, { passive: true });
  // Sans nouvel événement pendant 120 ms, le doigt et l'inertie sont finis.
  setInterval(() => { if (performance.now() - dernierT > 120) vitesseDefile = 0; }, 60);

  // ---------- les images : c'est là qu'une saccade se voit ----------
  let derniereImage = performance.now();
  (function boucle() {
    const t = performance.now(), ecart = t - derniereImage;
    derniereImage = t;
    if (ouvert) {
      ouvert.images++;
      if (ecart > ouvert.pire) ouvert.pire = ecart;
      if (ecart > 50) ouvert.trous++;                 // une image sautée se voit à l'œil
      try {
        const c = carte.getCenter(), z = carte.getZoom();
        ouvert.zMin = Math.min(ouvert.zMin, z); ouvert.zMax = Math.max(ouvert.zMax, z);
        if (ouvert.avant) {
          const r = Math.PI / 180, R = 6371000;
          const dLat = (c.lat - ouvert.avant.lat) * r, dLng = (c.lng - ouvert.avant.lng) * r;
          const s = Math.sin(dLat / 2) ** 2 + Math.cos(c.lat * r) * Math.cos(ouvert.avant.lat * r) * Math.sin(dLng / 2) ** 2;
          const m = 2 * R * Math.asin(Math.sqrt(s));
          const ech = 156543.03 * Math.cos(c.lat * r) / Math.pow(2, z);       // mètres par point
          const larg = (carte.getContainer().clientWidth || 440);
          if (ecart > 0) ouvert.vitesse = Math.max(ouvert.vitesse, (m / ech) / larg / (ecart / 1000));
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

  function ouvre(quoi, o, bougeait) {
    ferme();
    let z = 0; try { z = carte.getZoom(); } catch { }
    ouvert = { quoi, t0: performance.now(), demande: o && o.duration, courbe: o && o.curve,
               zDepart: z, zMin: z, zMax: z, images: 0, pire: 0, trous: 0, vitesse: 0,
               coupe: bougeait, defile: Math.round(vitesseDefile), avant: null };
    affiche();
  }

  for (const nom of ["flyTo", "easeTo", "fitBounds"]) {
    const vrai = P[nom];
    P[nom] = function (...a) {
      carte = this;
      if (!lie) { lie = true; this.on("moveend", ferme); }
      const o = nom === "fitBounds" ? a[1] : a[0];
      const interne = nom === "flyTo" && dansFit;
      if (!interne) {
        let bougeait = false; try { bougeait = this.isMoving(); } catch { }
        ouvre(nom === "fitBounds" ? "journée" : (o && o.curve === 1.3 ? "photo" : "carte"), o, bougeait);
      }
      if (nom === "fitBounds") { dansFit = true; try { return vrai.apply(this, a); } finally { dansFit = false; } }
      return vrai.apply(this, a);
    };
  }

  // ---------- le tableau de bord ----------
  const bas = document.createElement("div");
  bas.id = "mesure";
  // Replié par défaut : la lecture doit se passer dans les conditions habituelles, ce n'est
  // pas un panneau qui doit manger la moitié de l'écran pendant qu'elle fait défiler.
  bas.className = "replie";
  bas.innerHTML = '<div id="mesure-tirette">▲ relevé — toucher pour ouvrir</div>' +
    '<div id="mesure-texte">Fais défiler du jour 3 au jour 4.</div>' +
    '<div id="mesure-btns"><button id="mesure-copier">Copier le relevé</button>' +
    '<button id="mesure-vider">Effacer</button></div>';
  const css = document.createElement("style");
  css.textContent = `
    #mesure { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
      background: rgba(10,16,24,.92); color: #fff; border-top: 1px solid rgba(255,255,255,.2);
      font: 12px/1.35 ui-monospace, Menlo, monospace; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
      max-height: 42vh; overflow: auto; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
    #mesure b { color: #F97316; }
    #mesure .mauvais { color: #FF6B6B; font-weight: 700; }
    #mesure .bon { color: #86EFAC; font-weight: 700; }
    #mesure .rel { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.12); }
    #mesure-tirette { font: 600 12px/1.2 -apple-system, system-ui, sans-serif; opacity: .8;
      padding: 6px 0; text-align: center; }
    #mesure.replie { max-height: none; }
    #mesure.replie #mesure-texte, #mesure.replie #mesure-btns { display: none; }
    #mesure.replie #mesure-court { display: block; }
    #mesure-court { display: none; font: 600 12px/1.3 ui-monospace, Menlo, monospace;
      text-align: center; padding-bottom: 4px; }
    #mesure-btns { display: flex; gap: 8px; margin-top: 6px; }
    #mesure-btns button { flex: 1; min-height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,.28);
      background: rgba(255,255,255,.08); color: #fff; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
    body { padding-bottom: 96px; }`;
  function pose() {
    if (!document.body) return setTimeout(pose, 30);
    document.head.appendChild(css); document.body.appendChild(bas);
    const court = document.createElement("div");
    court.id = "mesure-court"; bas.appendChild(court);
    document.getElementById("mesure-tirette").onclick = () => {
      const r = bas.classList.toggle("replie");
      document.getElementById("mesure-tirette").textContent =
        r ? "▲ relevé — toucher pour ouvrir" : "▼ toucher pour replier";
      affiche();
    };
    document.getElementById("mesure-vider").onclick = () => { releves = []; affiche(); };
    document.getElementById("mesure-copier").onclick = () => {
      const t = texte(true);
      try { navigator.clipboard.writeText(t); } catch { }
      const z = document.createElement("textarea");
      z.value = t; document.body.appendChild(z); z.select();
      try { document.execCommand("copy"); } catch { }
      z.remove();
      document.getElementById("mesure-copier").textContent = "Copié ✓";
      setTimeout(() => { document.getElementById("mesure-copier").textContent = "Copier le relevé"; }, 1600);
    };
    affiche();
  }
  pose();

  const saccade = (r) => r.parSeconde < 40 || r.pire > 60;
  function ligne(r, brut) {
    const m = (t, mauvais) => (brut || !mauvais) ? t : '<span class="mauvais">' + t + "</span>";
    const a = r.quoi + " " + s1(r.duree) + " s (demandé " + (r.demande ? s1(r.demande) : "?") + ") · "
      + m(Math.round(r.parSeconde) + " img/s", saccade(r)) + " · pire trou "
      + m(Math.round(r.pire) + " ms", r.pire > 60) + " · " + r.trous + " sautées";
    const b2 = "départ z" + n1(r.zDepart) + (r.coupe ? m(" COUPE UN MOUVEMENT", true) : " immobile")
      + " · vitesse " + n1(r.vitesse) + " écr/s · recul " + n1(r.zDepart - r.zMin)
      + " · défilement " + r.defile + " px/s";
    return brut ? a + "\n   " + b2 : '<div class="rel">' + a + "<br>" + b2 + "</div>";
  }
  function verdict(brut) {
    const j = releves.filter((r) => r.quoi === "journée");
    if (!j.length) return "";
    const mauvais = j.filter(saccade).length;
    const t = mauvais ? "SACCADE : " + mauvais + " passage" + (mauvais > 1 ? "s" : "") + " sur " + j.length
                      : "fluide : " + j.length + " passage" + (j.length > 1 ? "s" : "");
    return brut ? t : '<div class="' + (mauvais ? "mauvais" : "bon") + '">' + t + "</div>";
  }
  function texte(brut) {
    const l = ["Bonvoyage v" + (window.BV_VERSION || "?") + " — " + new Date().toLocaleString("fr-FR")];
    const v = verdict(brut); if (v) l.push(v);
    if (ouvert) l.push(brut ? "en cours…" : '<div class="rel">en cours…</div>');
    for (const r of [...releves].reverse()) l.push(ligne(r, brut));
    if (releves.length === 0 && !ouvert) l.push("Fais défiler du jour 3 au jour 4.");
    return l.join(brut ? "\n" : "");
  }
  function affiche() {
    const el = document.getElementById("mesure-texte");
    if (el) el.innerHTML = texte(false);
    const c = document.getElementById("mesure-court");
    if (c) {
      const j = releves.filter((r) => r.quoi === "journée");
      c.innerHTML = verdict(false) || (ouvert ? "en cours…" : "aucun passage encore");
    }
  }
})();
