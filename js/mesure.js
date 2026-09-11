// ============================================================
//  TEMPORAIRE — l'enregistreur des photos du survol (#37).
//  Ne sert QU'À essai-mesure.html. Il ne modifie rien : il regarde, pour chaque journée,
//  combien de photos situées existent dans le carnet, combien de pastilles la carte a
//  posées, et combien sont réellement visibles. À supprimer dès la cause trouvée.
// ============================================================
(function () {
  const M = () => { try { return (window.BVMAP && BVMAP.maps && BVMAP.maps[0]) || null; } catch { return null; } };
  const par = {};            // iso -> { situees, pastilles, vues, revelees, grappes }
  let titres = {};

  function releve() {
    const m = M(); if (!m || !m.data) return;
    const D = m.data;
    if (!Object.keys(titres).length) {
      for (const j of D.days || []) titres[j.day_date] = j.title || "";
    }
    // ce que le carnet contient, une fois pour toutes
    for (const md of D.media || []) {
      const iso = md.day_date; if (!iso) continue;
      par[iso] = par[iso] || { situees: 0, total: 0, pastilles: 0, vues: 0, revelees: 0, grappes: 0 };
      if (par[iso].fige) continue;
    }
    for (const iso of Object.keys(par)) par[iso].fige = true;
    for (const iso of new Set((D.media || []).map((x) => x.day_date).filter(Boolean))) {
      const p = par[iso] || (par[iso] = { situees: 0, total: 0, pastilles: 0, vues: 0, revelees: 0, grappes: 0 });
      p.total = (D.media || []).filter((x) => x.day_date === iso).length;
      p.situees = (D.media || []).filter((x) => x.day_date === iso && x.lat != null).length;
    }
    // ce que la carte montre à cet instant
    const vus = {}, posees = {};
    for (const e of document.querySelectorAll(".bv-photo")) {
      const iso = e.dataset.day; if (!iso) continue;
      posees[iso] = (posees[iso] || 0) + 1;
      if (!e.classList.contains("hidden")) vus[iso] = (vus[iso] || 0) + 1;
    }
    for (const iso of Object.keys(par)) {
      par[iso].pastilles = Math.max(par[iso].pastilles, posees[iso] || 0);
      par[iso].vues = Math.max(par[iso].vues, vus[iso] || 0);
      if (m.revealed) {
        const n = (m.data.media || []).filter((x) => x.day_date === iso && m.revealed.has(x.id)).length;
        par[iso].revelees = Math.max(par[iso].revelees, n);
      }
    }
    const g = document.querySelectorAll(".bv-photo.cluster").length;
    if (m.replaying && g) par.__grappes = Math.max(par.__grappes || 0, g);
  }

  const num = (iso) => { const m = M(); const t = m && m.data && m.data.trip && m.data.trip.start_date;
    if (!t || !iso) return null;
    return Math.round((new Date(iso) - new Date(t)) / 86400000) + 1; };

  function texte(brut) {
    const m = M();
    const l = ["Bonvoyage v" + (window.BV_VERSION || "?") + " — relevé du " + new Date().toLocaleString("fr-FR"),
               "survol : " + (m && m.replaying ? "en cours" : "arrêté")
               + (par.__grappes ? " · grappes vues pendant le survol : " + par.__grappes : ""),
               "(laisse le survol aller jusqu'au bout : une journée ne compte qu'une fois jouée)"];
    const isos = Object.keys(par).filter((k) => k !== "__grappes").sort();
    for (const iso of isos) {
      const p = par[iso], n = num(iso);
      const manque = p.situees > 0 && p.vues < p.situees;
      const t = "jour " + (n || "?") + " · " + p.situees + " situées sur " + p.total
        + " · pastilles " + p.pastilles + " · VUES " + p.vues + " · révélées " + p.revelees;
      l.push(brut ? "  " + t : '<div class="rel' + (manque ? " mauvais" : "") + '">' + t + "</div>");
    }
    if (!isos.length) l.push(brut ? "  (rien encore)" : '<div class="rel">(rien encore)</div>');
    return brut ? l.join("\n") : l[0] + "<br>" + l[1] + "<br>" + l[2] + l.slice(3).join("");
  }

  const bas = document.createElement("div");
  bas.id = "mesure"; bas.className = "replie";
  bas.innerHTML = '<div id="mesure-tirette">▲ relevé des photos — toucher pour ouvrir</div>' +
    '<div id="mesure-court"></div><div id="mesure-texte"></div>' +
    '<div id="mesure-btns"><button id="mesure-copier">Copier le relevé</button>' +
    '<button id="mesure-vider">Effacer</button></div>';
  const css = document.createElement("style");
  css.textContent = `
    #mesure { position: fixed; left: 0; right: 0; bottom: 0; z-index: 9999;
      background: rgba(10,16,24,.93); color: #fff; border-top: 1px solid rgba(255,255,255,.2);
      font: 11.5px/1.4 ui-monospace, Menlo, monospace; padding: 6px 10px calc(8px + env(safe-area-inset-bottom, 0px));
      max-height: 56vh; overflow: auto; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
    #mesure .rel { margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,.12); }
    #mesure .mauvais { color: #FF6B6B; font-weight: 700; }
    #mesure-tirette { font: 600 12px/1.2 -apple-system, system-ui, sans-serif; opacity: .8; padding: 5px 0; text-align: center; }
    #mesure.replie #mesure-texte, #mesure.replie #mesure-btns { display: none; }
    #mesure-court { font: 600 12px/1.4 ui-monospace, Menlo, monospace; text-align: center; padding-bottom: 3px; }
    #mesure-btns { display: flex; gap: 8px; margin-top: 8px; }
    #mesure-btns button { flex: 1; min-height: 40px; border-radius: 10px; border: 1px solid rgba(255,255,255,.28);
      background: rgba(255,255,255,.08); color: #fff; font: 600 13px/1 -apple-system, system-ui, sans-serif; }
    body { padding-bottom: 92px; }`;

  function affiche() {
    const a = document.getElementById("mesure-texte"); if (a) a.innerHTML = texte(false);
    const c = document.getElementById("mesure-court");
    if (c) { const m = M();
      const isos = Object.keys(par).filter((k) => k !== "__grappes");
      const manquants = isos.filter((i) => par[i].situees > 0 && par[i].vues < par[i].situees).length;
      c.innerHTML = "v" + (window.BV_VERSION || "?") + " · " + isos.length + " journées · "
        + (manquants ? '<span class="mauvais">' + manquants + " avec des photos jamais vues</span>" : "toutes vues")
        + (m && m.replaying ? " · survol en cours" : ""); }
  }
  function pose() {
    if (!document.body) return setTimeout(pose, 30);
    document.head.appendChild(css); document.body.appendChild(bas);
    document.getElementById("mesure-tirette").onclick = () => {
      const r = bas.classList.toggle("replie");
      document.getElementById("mesure-tirette").textContent = r ? "▲ relevé des photos — toucher pour ouvrir" : "▼ toucher pour replier";
      affiche();
    };
    document.getElementById("mesure-vider").onclick = () => { for (const k of Object.keys(par)) delete par[k]; affiche(); };
    document.getElementById("mesure-copier").onclick = () => {
      const t = texte(true);
      try { navigator.clipboard.writeText(t); } catch { }
      const z = document.createElement("textarea"); z.value = t; document.body.appendChild(z); z.select();
      try { document.execCommand("copy"); } catch { } z.remove();
      const c = document.getElementById("mesure-copier"); c.textContent = "Copié ✓";
      setTimeout(() => { c.textContent = "Copier le relevé"; }, 1600);
    };
    setInterval(() => { releve(); affiche(); }, 500);
    affiche();
  }
  pose();
})();
