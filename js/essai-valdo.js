// ============================================================
//  #45 · PAGE D'ESSAI — la vitesse de Valdo pendant le survol. TEMPORAIRE.
//  Cette page EST la vraie page du proche : `essai-valdo.html` est `share.html`
//  au caractère près, plus ce seul fichier. Même carte, même taille, même chaîne
//  de mouvements, vrai carnet chargé par le jeton du lien de partage.
//  Elle remplace UNIQUEMENT le cadrage et la durée de la traversée d'une journée,
//  par le point d'essai `BV_ESSAI45` de js/map.js. À retirer avec la page.
// ============================================================
(() => {
  const CLE = "bv_essai45";
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },      // Safari privé bloque le stockage
    set(k, v) { try { localStorage.setItem(k, v); } catch { } },
  };

  // ---------- Ce que l'œil traverse : une largeur de CARTE, en mètres ----------
  // La bonne référence n'est pas la fenêtre mais la SURFACE OÙ LE SURVOL SE JOUE : la toile
  // de la carte. `window.innerWidth` peut valoir autre chose que la largeur de l'appareil —
  // un agrandissement du texte dans les réglages d'iOS, un agrandissement de la page dans
  // Safari, un aperçu à l'intérieur d'une autre application. Un de ces cas a fait relever
  // 375 sur un appareil de 440, et j'en ai tiré une conclusion fausse sur l'écran de Sophie.
  const LARGEUR_PX = () => {
    const c = document.querySelector("#share-map canvas") || document.querySelector("#share-map");
    const w = c ? Math.round(c.getBoundingClientRect().width) : 0;
    return w > 200 ? w : Math.max(320, window.innerWidth || 440);
  };
  // Les quatre nombres que demande Sophie, plus celui qui sert vraiment au calcul.
  const nombres = () => {
    const vv = window.visualViewport;
    const c = document.querySelector("#share-map canvas");
    return `innerWidth ${window.innerWidth} · screen.width ${screen.width} · visualViewport `
      + `${vv ? Math.round(vv.width) : "absent"} · devicePixelRatio ${window.devicePixelRatio} `
      + `· carte ${c ? Math.round(c.getBoundingClientRect().width) : "?"}`;
  };
  const metresParEcran = (z, lat) => 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z) * LARGEUR_PX();
  // Le zoom qu'il faut pour qu'une journée de `m` mètres occupe exactement `n` écrans
  const zoomPour = (m, n, lat) => Math.log2(156543.03392 * Math.cos(lat * Math.PI / 180) * LARGEUR_PX() * n / m);

  // La caméra prend le zoom de la journée sur les deux premières secondes de la marche.
  // Quand un réglage change ce zoom, ce recul peut dépasser ce que Sophie accepte — mesuré
  // sur son iPhone : 0,42 cran/s au survol qu'elle a validé, contre 1,22 cran/s jugé
  // inconfortable. On allonge donc cette prise pour rester à 0,65 cran/s au pire, la valeur
  // que donne déjà le réglage en ligne. Sinon elle jugerait la vitesse de Valdo à travers
  // un mouvement de caméra qui n'a rien à voir avec la question posée.
  const CRANS_PAR_S = 0.65;
  const priseDuZoom = (zDepart, zArrivee) =>
    Math.max(2000, Math.min(6000, Math.abs(zArrivee - zDepart) / CRANS_PAR_S * 1000));

  // ---------- Les quatre réglages ----------
  // A, B et C font TOUS avancer Valdo à vitesse constante d'une journée à l'autre :
  // la durée se calcule sur les écrans à traverser, plus jamais sur les kilomètres.
  // Ils ne diffèrent que par le cadrage (donc par la durée totale du voyage).
  const ECRANS = 3.5;              // B et C : chaque journée occupe ce nombre d'écrans
  const REGLAGES = {
    A: {
      nom: "A · vitesse égale, cadrage d'aujourd'hui", v: 0.175,
      note: "Les longues journées durent bien plus longtemps.",
      calc(e) { const L = metresParEcran(e.zoom, e.lat); const n = e.realTotal / L;
                return { zoom: e.zoom, duration: Math.max(5000, n / this.v * 1000) / e.speed, ecrans: n }; },
    },
    B: {
      nom: "B · vitesse égale, cadrage adapté", v: 0.175,
      note: "Chaque journée dure 20 s : le voyage dure comme aujourd'hui.",
      calc(e) { const z = zoomPour(e.realTotal, ECRANS, e.lat) - (e.est ? 1.4 : 0);
                return { zoom: z, duration: ECRANS / this.v * 1000 / e.speed, ecrans: ECRANS,
                         pose: priseDuZoom(e.zoomDepart, z) }; },
    },
    C: {
      nom: "C · comme B, mais plus calme", v: 0.13,
      note: "Chaque journée dure 27 s.",
      calc(e) { const z = zoomPour(e.realTotal, ECRANS, e.lat) - (e.est ? 1.4 : 0);
                return { zoom: z, duration: ECRANS / this.v * 1000 / e.speed, ecrans: ECRANS,
                         pose: priseDuZoom(e.zoomDepart, z) }; },
    },
    D: {
      nom: "D · comme en ligne aujourd'hui", v: null,
      note: "Le réglage que tu as sous les yeux — pour comparer.",
      calc(e) { const L = metresParEcran(e.zoom, e.lat); return { ecrans: e.realTotal / L }; },
    },
  };

  let choix = REGLAGES[LS.get(CLE)] ? LS.get(CLE) : "B";
  const releve = [];

  // ---------- Le point d'essai appelé par le survol, une fois par journée ----------
  // Le relevé est aussi lisible depuis un banc de vérification.
  window.BV_ESSAI45_RELEVE = releve;
  window.BV_ESSAI45 = (e) => {
    const r = REGLAGES[choix].calc(e);
    const duree = (r.duration != null ? r.duration : e.duration) / 1000;
    const zoom = r.zoom != null ? r.zoom : e.zoom;
    const n = r.ecrans;
    const prise = (r.pose != null ? r.pose : 2000) / 1000;
    const crans = Math.abs(zoom - e.zoomDepart) / prise;
    const ligne = { jour: e.iso, km: e.km, zoom, ecrans: n, duree, vitesse: n / duree, prise, crans };
    releve.push(ligne);
    montre(ligne);
    return choix === "D" ? null : { zoom: r.zoom, duration: r.duration };
  };

  // ---------- L'habillage de l'essai : au-dessus de tout, y compris du survol ----------
  const css = `
  /* Le bandeau ne doit RIEN avaler à côté de ses propres boutons : seul ce qu'il dessine
     reçoit le doigt, le reste laisse passer vers la carte et vers le survol. */
  .e45 { position: fixed; left: 8px; right: 8px; top: calc(6px + env(safe-area-inset-top)); z-index: 9999;
         font: 500 12px/1.35 system-ui, -apple-system, sans-serif; color: #fff; pointer-events: none; }
  .e45 button, .e45 .txt { pointer-events: auto; }
  .e45 .bar { display: flex; gap: 6px; }
  .e45 button { flex: 1; min-height: 46px; border: 1px solid rgba(255,255,255,.28); border-radius: 12px;
                background: rgba(14,20,28,.82); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
                color: #fff; font: 700 17px/1 system-ui, sans-serif; }
  .e45 button.on { background: #F97316; border-color: #F97316; }
  .e45 .txt { margin-top: 5px; padding: 7px 10px; border-radius: 10px; background: rgba(14,20,28,.82);
              -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  .e45 .txt b { font-weight: 700; }
  .e45 .mes { margin-top: 4px; font-variant-numeric: tabular-nums; opacity: .95; }
  .e45 .cop { margin-top: 5px; min-height: 40px; width: 100%; font: 600 13px/1 system-ui, sans-serif; }
  `;
  const el = document.createElement("div");
  el.className = "e45";
  el.innerHTML = `<style>${css}</style>
    <div class="bar">${Object.keys(REGLAGES).map((k) => `<button type="button" data-k="${k}">${k}</button>`).join("")}</div>
    <div class="txt"><div id="e45-nom"></div><div id="e45-note" style="opacity:.8"></div><div class="mes" id="e45-mes">Lance « Suivre le parcours » pour juger.</div><div class="mes" id="e45-ecran" style="opacity:.75"></div></div>
    <button type="button" class="cop" id="e45-cop">Copier le relevé</button>`;
  const pose = () => {
    document.body.appendChild(el); majBoutons();
    const maj = () => { el.querySelector("#e45-ecran").textContent = nombres(); };
    maj(); setTimeout(maj, 2500); setTimeout(maj, 6000);   // la carte n'a sa taille qu'après coup
    window.addEventListener("resize", maj);
  };

  function majBoutons() {
    for (const b of el.querySelectorAll("button[data-k]")) b.classList.toggle("on", b.dataset.k === choix);
    el.querySelector("#e45-nom").innerHTML = `<b>${REGLAGES[choix].nom}</b>`;
    el.querySelector("#e45-note").textContent = REGLAGES[choix].note;
  }
  function montre(l) {
    el.querySelector("#e45-mes").textContent =
      `${l.jour} · ${l.km.toFixed(1)} km · zoom ${l.zoom.toFixed(1)} · ${l.ecrans.toFixed(2)} écrans en ${l.duree.toFixed(1)} s → ${l.vitesse.toFixed(3)} écran/s`;
  }

  document.addEventListener("DOMContentLoaded", pose);
  if (document.readyState !== "loading") pose();

  el.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.k) {
      choix = b.dataset.k; LS.set(CLE, choix); releve.length = 0; majBoutons();
      el.querySelector("#e45-mes").textContent = "Réglage pris à partir de la journée suivante — relance le survol.";
      return;
    }
    if (b.id === "e45-cop") {
      const t = [`Bonvoyage — essai #45 · réglage ${choix} · ${new Date().toLocaleString("fr-FR")}`,
                 nombres()]
        .concat(releve.map((l) => `${l.jour} · ${l.km.toFixed(1)} km · zoom ${l.zoom.toFixed(1)} · ${l.ecrans.toFixed(2)} écrans · ${l.duree.toFixed(1)} s · ${l.vitesse.toFixed(3)} écran/s`))
        .join("\n");
      const fini = () => { b.textContent = "Relevé copié — colle-le dans la conversation"; setTimeout(() => { b.textContent = "Copier le relevé"; }, 4000); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(fini, () => alert(t));
      else alert(t);
    }
  });
})();
