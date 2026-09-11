// ============================================================
//  #45 · ENREGISTREUR — ce que l'œil traverse pendant le survol. TEMPORAIRE.
//  `mesure-valdo.html` est `share.html` au caractère près, plus ce seul fichier.
//  Il NE CHANGE RIEN : il regarde où est Valdo et à quel zoom, dix fois par seconde,
//  et il compte les largeurs de carte réellement parcourues. Aucun réglage n'est touché.
//  À retirer une fois la mesure faite.
// ============================================================
(() => {
  const R = 6371000, rad = Math.PI / 180;
  const dist = (a, b) => {
    const x = (b.lat - a.lat) * rad, y = (b.lng - a.lng) * rad;
    const s = Math.sin(x / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(y / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  const carte = () => document.querySelector("#share-map canvas");
  const largeur = () => { const c = carte(); return c ? c.getBoundingClientRect().width : 0; };
  // Une largeur de carte, en mètres, au zoom et à la latitude où l'on est
  const metresParEcran = (z, lat) => 156543.03392 * Math.cos(lat * rad) / Math.pow(2, z) * largeur();

  const jours = [];
  let cur = null, prev = null, prevT = 0;

  function tic() {
    const M = window.BVMAP && BVMAP.maps && BVMAP.maps[0];
    const w = document.querySelector(".bv-walker");
    if (!M || !M.replaying || !w || !w.classList.contains("walking")) { prev = null; return; }
    const nom = (document.querySelector("#replay-caption b") || {}).textContent || "?";
    const meta = (document.querySelector("#replay-caption .meta") || {}).textContent || "";
    if (largeur() < 50) { prev = null; return; }   // pas de carte mesurable : on ne compte rien
    const r = w.getBoundingClientRect();
    let pt; try { pt = M.map.unproject([r.left + r.width / 2, r.bottom]); } catch { return; }
    const p = { lat: pt.lat, lng: pt.lng }, z = M.map.getZoom(), t = performance.now();
    if (!cur || cur.nom !== nom) {
      // « km » n'est écrit dans le cartouche que pour une journée à trace relevée :
      // son absence dit que le chemin est estimé d'après les photos.
      cur = { nom, trace: /km/.test(meta), ecrans: 0, metres: 0, t0: t, t1: t,
              z0: z, z1: z, pics: [], fenetre: [] };
      jours.push(cur); prev = null;
    }
    if (prev) {
      const d = dist(prev, p), L = metresParEcran(z, p.lat);
      if (d < 100000 && L > 0) {
        const e = d / L;
        cur.ecrans += e; cur.metres += d;
        // vitesse instantanée lissée sur une seconde glissante
        cur.fenetre.push({ t, e });
        while (cur.fenetre.length && t - cur.fenetre[0].t > 1000) cur.fenetre.shift();
        const dt = (t - cur.fenetre[0].t) / 1000;
        if (dt > .5) {
          const v = cur.fenetre.reduce((a, x) => a + x.e, 0) / dt;
          cur.pics.push({ t: t - cur.t0, v });
        }
      }
    }
    cur.t1 = t; cur.z1 = z; prev = p; prevT = t;
  }
  setInterval(tic, 100);

  // ---------- L'habillage : au-dessus de tout, et qui n'avale aucun appui à côté ----------
  const css = `
  .m45 { position: fixed; left: 8px; right: 8px; top: calc(6px + env(safe-area-inset-top)); z-index: 9999;
         font: 500 12px/1.4 system-ui, -apple-system, sans-serif; color: #fff; pointer-events: none; }
  .m45 .txt { padding: 8px 10px; border-radius: 10px; background: rgba(14,20,28,.86);
              -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); pointer-events: auto; }
  .m45 button { pointer-events: auto; margin-top: 6px; width: 100%; min-height: 44px; border-radius: 12px;
                border: 1px solid rgba(255,255,255,.28); background: rgba(14,20,28,.86); color: #fff;
                font: 600 14px/1 system-ui, sans-serif; }
  .m45 .n { font-variant-numeric: tabular-nums; }
  `;
  const el = document.createElement("div");
  el.className = "m45";
  el.innerHTML = `<style>${css}</style>
    <div class="txt"><b>Enregistreur #45</b> — lance « Suivre le parcours », laisse-le aller au bout,
    puis copie le relevé.<div class="n" id="m45-vu" style="margin-top:5px;opacity:.85"></div></div>
    <button type="button" id="m45-cop">Copier le relevé</button>`;
  const pose = () => document.body.appendChild(el);
  document.addEventListener("DOMContentLoaded", pose);
  if (document.readyState !== "loading") pose();

  setInterval(() => {
    const v = el.querySelector("#m45-vu"); if (!v) return;
    if (!cur) { v.textContent = `carte ${Math.round(largeur())} points · v${window.BV_VERSION || "?"}`; return; }
    const s = (cur.t1 - cur.t0) / 1000;
    v.textContent = `${cur.nom} · ${cur.ecrans.toFixed(2)} écrans en ${s.toFixed(1)} s · ${(s ? cur.ecrans / s : 0).toFixed(3)} écran/s`;
  }, 300);

  const lignes = () => {
    const out = [`Bonvoyage — enregistreur #45 · v${window.BV_VERSION || "?"} · ${new Date().toLocaleString("fr-FR")}`,
                 `carte ${Math.round(largeur())} points de large`];
    for (const j of jours) {
      const s = (j.t1 - j.t0) / 1000;
      if (s < 2) continue;
      const moy = j.ecrans / s;
      const debut = j.pics.filter((x) => x.t < 2000).map((x) => x.v);
      const max = j.pics.length ? Math.max(...j.pics.map((x) => x.v)) : 0;
      const tMax = j.pics.length ? j.pics[j.pics.map((x) => x.v).indexOf(max)].t / 1000 : 0;
      out.push(`${j.nom} · ${(j.metres / 1000).toFixed(1)} km · ${j.trace ? "trace relevée" : "chemin estimé"}`
        + ` · zoom ${j.z0.toFixed(1)} → ${j.z1.toFixed(1)}`
        + ` · ${j.ecrans.toFixed(2)} écrans en ${s.toFixed(1)} s`
        + ` · moyenne ${moy.toFixed(3)} écran/s`
        + ` · début ${(debut.length ? Math.max(...debut) : 0).toFixed(3)}`
        + ` · pointe ${max.toFixed(3)} à ${tMax.toFixed(1)} s`);
    }
    const v = jours.filter((j) => (j.t1 - j.t0) > 2000).map((j) => j.ecrans / ((j.t1 - j.t0) / 1000));
    if (v.length > 1) out.push(`écart de vitesse moyenne entre journées : de 1 à ${(Math.max(...v) / Math.min(...v)).toFixed(2)}`);
    return out.join("\n");
  };

  // Lisible aussi depuis un banc de vérification.
  window.__M45 = { jours, releve: () => lignes() };

  el.addEventListener("click", (ev) => {
    if (!ev.target.closest("#m45-cop")) return;
    const b = ev.target.closest("button"), t = lignes();
    const fini = () => { b.textContent = "Relevé copié — colle-le dans la conversation"; setTimeout(() => { b.textContent = "Copier le relevé"; }, 5000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(fini, () => alert(t));
    else alert(t);
  });
})();
