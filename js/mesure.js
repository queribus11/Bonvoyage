// ============================================================
//  TEMPORAIRE — l'enregistreur du survol (#37). Ne sert QU'À essai-mesure.html.
//  Il ne modifie rien : il écoute la carte, les pastilles photo et les réglages du
//  téléphone, et affiche un relevé que Sophie peut copier.
//  À supprimer avec la page d'essai dès que la cause est trouvée.
// ============================================================
(function () {
  if (!window.maplibregl) return;
  const P = maplibregl.Map.prototype;
  const s1 = (x) => (x / 1000).toFixed(1).replace(".", ",");
  const n1 = (x) => x.toFixed(1).replace(".", ",");
  const dit = (q) => { try { return window.matchMedia && window.matchMedia(q).matches; } catch { return false; } };

  // LA question : si le téléphone demande de réduire les animations, TOUTES les animations
  // de la carte sont annulées — sauf une, la seule marquée « essentielle ». Les pages
  // d'essai, elles, forçaient les animations : d'où l'écart entre l'essai et l'application.
  const calme = dit("(prefers-reduced-motion: reduce)");

  let carte = null, log = [], ouvert = null, t0 = Date.now();
  const M = () => { try { return (window.BVMAP && BVMAP.maps && BVMAP.maps[0]) || null; } catch { return null; } };

  for (const nom of ["flyTo", "easeTo", "fitBounds", "jumpTo"]) {
    const vrai = P[nom];
    P[nom] = function (...a) {
      carte = this;
      const o = nom === "fitBounds" ? a[1] : a[0];
      if (nom !== "jumpTo") {                       // jumpTo : la marche du personnage, trop bavard
        let bougeait = false; try { bougeait = this.isMoving(); } catch { }
        let z = null; try { z = +this.getZoom().toFixed(2); } catch { }
        ouvert = { t: Date.now() - t0, quoi: nom, coupe: bougeait, demande: o && o.duration,
                   courbe: o && o.curve, zDepart: z, zMin: z, reel: 0, debut: performance.now() };
        log.push(ouvert); if (log.length > 14) log.shift();
      }
      return vrai.apply(this, a);
    };
  }
  // La durée RÉELLE et le plongeon réel, image par image
  (function boucle() {
    if (ouvert && carte) {
      try {
        const z = carte.getZoom();
        if (z < ouvert.zMin) ouvert.zMin = z;
        if (carte.isMoving()) ouvert.reel = Math.round(performance.now() - ouvert.debut);
        else if (ouvert.reel) ouvert = null;
      } catch { }
    }
    requestAnimationFrame(boucle);
  })();

  const compte = () => {
    const m = M();
    return {
      total: document.querySelectorAll(".bv-photo").length,
      vues: document.querySelectorAll(".bv-photo:not(.hidden)").length,
      grappes: document.querySelectorAll(".bv-photo.cluster").length,
      masquees: (() => { const e = document.querySelector(".bv-photo");
        return e ? getComputedStyle(e).display === "none" : null; })(),
      survol: !!(m && m.replaying),
      ensemble: !!(m && m.overview),
      classe: !!document.querySelector(".bv-overview"),
      reperes: m && m.markers ? m.markers.size : null,
      revelees: m && m.revealed ? m.revealed.size : null,
    };
  };

  // ---------- le tableau de bord ----------
  const bas = document.createElement("div");
  bas.id = "mesure"; bas.className = "replie";
  bas.innerHTML = '<div id="mesure-tirette">▲ relevé — toucher pour ouvrir</div>' +
    '<div id="mesure-court"></div><div id="mesure-texte"></div>' +
    '<div id="mesure-btns"><button id="mesure-copier">Copier le relevé</button>' +
    '<button id="mesure-vider">Effacer</button></div>';
  const css = document.createElement("style");
  css.textContent = `
    #mesure { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
      background: rgba(10,16,24,.93); color: #fff; border-top: 1px solid rgba(255,255,255,.2);
      font: 11.5px/1.35 ui-monospace, Menlo, monospace; padding: 6px 10px calc(8px + env(safe-area-inset-bottom, 0px));
      max-height: 56vh; overflow: auto; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
    #mesure .mauvais { color: #FF6B6B; font-weight: 700; }
    #mesure .bon { color: #86EFAC; font-weight: 700; }
    #mesure .rel { margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(255,255,255,.12); }
    #mesure-tirette { font: 600 12px/1.2 -apple-system, system-ui, sans-serif; opacity: .8; padding: 5px 0; text-align: center; }
    #mesure.replie #mesure-texte, #mesure.replie #mesure-btns { display: none; }
    #mesure-court { font: 600 12px/1.4 ui-monospace, Menlo, monospace; text-align: center; padding-bottom: 3px; }
    #mesure-btns { display: flex; gap: 8px; margin-top: 8px; }
    #mesure-btns button { flex: 1; min-height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,.28);
      background: rgba(255,255,255,.08); color: #fff; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
    body { padding-bottom: 92px; }`;

  function ligne(l, brut) {
    const m = (t, mauvais) => (brut || !mauvais) ? t : '<span class="mauvais">' + t + "</span>";
    const recul = l.zDepart != null && l.zMin != null ? l.zDepart - l.zMin : 0;
    const a = l.quoi + " · demandé " + (l.demande ? s1(l.demande) + " s" : "—")
      + " · réel " + m(s1(l.reel) + " s", l.demande > 400 && l.reel < 300)
      + (l.coupe ? m(" · COUPE", true) : "");
    const b2 = "départ z" + (l.zDepart == null ? "?" : n1(l.zDepart))
      + " · recul " + n1(recul) + (l.courbe ? " · courbe " + l.courbe : "");
    return brut ? "  " + a + "\n     " + b2 : '<div class="rel">' + a + "<br>" + b2 + "</div>";
  }
  function verdict(brut) {
    const c = compte();
    const t = "v" + (window.BV_VERSION || "?") + " · animations réduites : "
      + (calme ? "OUI" : "non")
      + " · photos " + c.vues + "/" + c.total + (c.grappes ? " (grappes " + c.grappes + ")" : "")
      + (c.survol ? " · SURVOL" : "") + (c.ensemble || c.classe ? " · VUE D'ENSEMBLE" : "");
    return brut ? t : '<div class="' + (calme ? "mauvais" : "bon") + '">' + t + "</div>";
  }
  function texte(brut) {
    const c = compte();
    const l = [verdict(brut),
      (brut ? "  " : '<div class="rel">') + "repères " + c.reperes + " · révélées " + c.revelees
        + " · masquées par le style : " + (c.masquees === null ? "—" : c.masquees ? "OUI" : "non")
        + (brut ? "" : "</div>")];
    for (const x of [...log].reverse()) l.push(ligne(x, brut));
    return brut ? "Bonvoyage — relevé du " + new Date().toLocaleString("fr-FR") + "\n" + l.join("\n") : l.join("");
  }
  function affiche() {
    const a = document.getElementById("mesure-texte"); if (a) a.innerHTML = texte(false);
    const b2 = document.getElementById("mesure-court"); if (b2) b2.innerHTML = verdict(false);
  }
  function pose() {
    if (!document.body) return setTimeout(pose, 30);
    document.head.appendChild(css); document.body.appendChild(bas);
    document.getElementById("mesure-tirette").onclick = () => {
      const r = bas.classList.toggle("replie");
      document.getElementById("mesure-tirette").textContent = r ? "▲ relevé — toucher pour ouvrir" : "▼ toucher pour replier";
      affiche();
    };
    document.getElementById("mesure-vider").onclick = () => { log = []; t0 = Date.now(); affiche(); };
    document.getElementById("mesure-copier").onclick = () => {
      const t = texte(true);
      try { navigator.clipboard.writeText(t); } catch { }
      const z = document.createElement("textarea"); z.value = t; document.body.appendChild(z); z.select();
      try { document.execCommand("copy"); } catch { } z.remove();
      const c = document.getElementById("mesure-copier"); c.textContent = "Copié ✓";
      setTimeout(() => { c.textContent = "Copier le relevé"; }, 1600);
    };
    setInterval(affiche, 700);
    affiche();
  }
  pose();
})();
