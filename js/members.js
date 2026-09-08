// ============================================================
//  Bonvoyage — le carnet à plusieurs (v10)
//  Tout ce qui touche aux co-auteurs vit ici : la liste des compagnons, les
//  pastilles de signature, l'écran « Qui a accès » (co-auteurs + liens des
//  proches), le mot du jour vocal, et l'écran d'arrivée d'un invité.
//
//  Ce fichier ne connaît ni la carte ni le panneau : il rend du HTML et
//  branche des boutons. app.js et share.js l'appellent, jamais l'inverse.
// ============================================================
(function () {
  const CVx = window.CV || {};
  const esc = CVx.esc || ((s) => String(s == null ? "" : s));
  const ic = CVx.ic || (() => "");
  const toast = CVx.toast || (() => {});
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const COLORS = ["#0D8FE0", "#F97316", "#7CB518", "#F5B301", "#3AA0F5", "#5E6142"];

  // L'équipage du voyage courant, sous une forme unique quelle que soit la
  // source : trip_members (côté app) ou D.authors (côté proches).
  let crew = [];      // [{ id, name, color, role }]
  let meId = null;

  function normalise(row) {
    return {
      id: row.id || row.user_id,
      name: (row.name != null ? row.name : row.display_name) || "",
      color: row.color || COLORS[0],
      role: row.role || "author",
    };
  }

  const M = {
    COLORS,

    setCrew(list, myId) {
      crew = (list || []).map(normalise);
      if (myId !== undefined) meId = myId;
      return crew;
    },
    crew() { return crew; },
    me() { return crew.find((c) => c.id === meId) || null; },
    meId() { return meId; },
    isOwner() { const m = M.me(); return !!m && m.role === "owner"; },
    // Plusieurs personnes écrivent-elles vraiment dans ce carnet ?
    isShared() { return crew.length > 1; },
    get(id) { return crew.find((c) => c.id === id) || null; },
    name(id) { const c = M.get(id); return c ? c.name : ""; },
    color(id) { const c = M.get(id); return c ? c.color : "var(--muted)"; },
    initial(id) { const n = M.name(id).trim(); return n ? n.charAt(0).toUpperCase() : "?"; },

    // Une pastille discrète — un prénom, pas un bandeau.
    // Rien ne s'affiche quand le carnet n'a qu'un auteur : le solo reste sobre.
    pill(id, opts = {}) {
      if (!id) return "";
      if (!opts.force && !M.isShared()) return "";
      const c = M.get(id);
      if (!c || !c.name) return "";
      const cls = "author-pill" + (opts.small ? " sm" : "") + (opts.solid ? " solid" : "");
      return `<span class="${cls}" style="--pill:${esc(c.color)}" title="${esc(c.name)}"><i></i>${esc(c.name)}</span>`;
    },
    // Juste le rond coloré, pour les vignettes photo où le prénom ne tient pas
    dot(id, opts = {}) {
      if (!id || (!opts.force && !M.isShared())) return "";
      const c = M.get(id);
      if (!c || !c.name) return "";
      return `<span class="author-dot" style="background:${esc(c.color)}" title="${esc(c.name)}">${esc(M.initial(id))}</span>`;
    },
    // « Sophie, Paul et Léa » — la ligne d'équipage en haut du carnet des proches
    crewLine() {
      const names = crew.filter((c) => c.name).map((c) => c.name);
      if (names.length < 2) return "";
      const last = names.pop();
      return `${names.join(", ")} et ${last}`;
    },

    // ------------------------------------------------------------------
    //  Écran « Qui a accès » : les co-auteurs, puis les proches qui ont un lien
    // ------------------------------------------------------------------
    // ctx = { trip, user, openModal, confirm, toast, shareBase, onChange }
    async openAccess(ctx) {
      const t = ctx.trip;
      const m = ctx.openModal(`<div class="modal-head"><div class="grow"><div class="kicker">${esc(t.title)}</div><h2>Qui a accès</h2></div>
          <button type="button" class="btn icon ghost" data-close title="Fermer">${ic("close")}</button></div>
        <div class="access-tabs">
          <button class="active" data-pane="crew">Co-auteurs</button>
          <button data-pane="links">Liens des proches</button>
        </div>
        <div id="pane-crew" class="access-pane"><div class="spinner"></div></div>
        <div id="pane-links" class="access-pane" hidden><div class="spinner"></div></div>`, { wide: true });

      $$(".access-tabs button", m.el).forEach((b) => b.onclick = () => {
        $$(".access-tabs button", m.el).forEach((x) => x.classList.toggle("active", x === b));
        $("#pane-crew", m.el).hidden = b.dataset.pane !== "crew";
        $("#pane-links", m.el).hidden = b.dataset.pane !== "links";
      });

      await renderCrewPane($("#pane-crew", m.el), ctx);
      renderLinksPane($("#pane-links", m.el), ctx);
      return m;
    },

    // ------------------------------------------------------------------
    //  Les contributions signées : récits des co-auteurs, carnet de bord, mots du jour
    // ------------------------------------------------------------------
    //  Un seul rendu pour les trois, et une règle simple qui tient tout le
    //  « carnet à plusieurs » : PAS DE CONTENU, PAS DE BLOC. Sur un voyage
    //  écrit à une seule main, aucune de ces zones n'existe — le carnet est
    //  exactement celui de la v9.
    //  opts = { label, icon, cls, render(item), canDelete(item), when }
    signedList(items, opts = {}) {
      const list = (items || []).filter(Boolean);
      if (!list.length) return "";
      return `<div class="signed-list${opts.cls ? " " + opts.cls : ""}">
        ${opts.label ? `<div class="kicker">${opts.icon || ""} ${esc(opts.label)}</div>` : ""}
        ${list.map((it) => `<div class="signed" data-id="${esc(it.id)}">
          <span class="author-dot" style="background:${esc(M.color(it.author_id))}">${esc(M.initial(it.author_id))}</span>
          <div class="grow" style="min-width:0">
            <b>${esc(M.name(it.author_id) || "Un compagnon")}</b>${opts.when && it.updated_at ? `<span class="when">${new Date(it.updated_at).toLocaleDateString("fr-FR")}</span>` : ""}
            ${opts.render ? opts.render(it) : ""}</div>
          ${opts.canDelete && opts.canDelete(it) ? `<button type="button" class="btn icon sm ghost sig-del" title="Effacer">${ic("trash", "sm")}</button>` : ""}
        </div>`).join("")}
      </div>`;
    },
  };

  // ---------------------------------------------------------------------
  //  Panneau « Co-auteurs »
  // ---------------------------------------------------------------------
  async function renderCrewPane(pane, ctx) {
    const t = ctx.trip, owner = M.isOwner();
    let members = [], invites = [];
    try {
      members = await ctx.api.listMembers(t.id);
      if (owner) invites = await ctx.api.listInvites(t.id);
    } catch (e) { pane.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; return; }
    M.setCrew(members, ctx.user.id);

    const pending = invites.filter((i) => !i.revoked && !i.accepted_at && new Date(i.expires_at) > new Date());

    pane.innerHTML = `
      <p class="small muted">Chacun ajoute ce qu'il veut — journées, photos, récit, mot du jour.
      Chacun ne modifie et n'efface que ce qu'il a lui-même ajouté${owner ? ", et toi tu peux tout corriger et tout retirer" : ""}.</p>

      <div class="member-list">${members.map((r) => {
        const c = normalise(r);
        const isMe = c.id === ctx.user.id;
        return `<div class="member" data-user="${esc(c.id)}">
          <span class="author-dot big" style="background:${esc(c.color)}">${esc((c.name || "?").charAt(0).toUpperCase())}</span>
          <div class="grow" style="min-width:0">
            <b>${esc(c.name || "sans prénom")}${isMe ? " (toi)" : ""}</b>
            <span class="small muted">${c.role === "owner" ? "propriétaire du carnet" : "co-auteur"} · depuis le ${new Date(r.joined_at).toLocaleDateString("fr-FR")}</span>
          </div>
          ${isMe ? `<button type="button" class="btn sm ghost m-edit" title="Changer mon prénom et ma couleur">${ic("edit", "sm")}</button>` : ""}
          ${owner && !isMe ? `<button type="button" class="btn sm ghost danger m-del" title="Retirer du voyage">${ic("close", "sm")}</button>` : ""}
        </div>`; }).join("")}
      </div>

      ${owner ? `
      <div class="field" style="margin-top:18px">
        <label>Inviter quelqu'un</label>
        <div class="row"><input id="inv-label" placeholder="Son prénom : Paul, Léa…" maxlength="40" class="grow">
          <button type="button" class="btn primary sm" id="inv-add">${ic("plus", "sm")} Créer le lien</button></div>
        <p class="help">Tu obtiens un lien à lui envoyer. Il choisit son mot de passe en l'ouvrant : son compte se crée à ce moment-là, et seulement pour ce voyage. Le lien ne sert qu'une fois et expire au bout de 30 jours.</p>
      </div>
      ${pending.length ? `<div class="kicker" style="margin-top:6px">Invitations en attente</div>
        <div class="member-list">${pending.map((i) => `<div class="member invite" data-invite="${esc(i.id)}">
          <span class="author-dot big pending">✉︎</span>
          <div class="grow" style="min-width:0"><b>${esc(i.label || "sans nom")}</b>
            <span class="small muted">créée le ${new Date(i.created_at).toLocaleDateString("fr-FR")} · expire le ${new Date(i.expires_at).toLocaleDateString("fr-FR")}</span></div>
          <button type="button" class="btn sm ghost i-send" title="Envoyer le message d'invitation">${ic("send", "sm")}</button>
          <button type="button" class="btn sm ghost i-copy" title="Copier uniquement l'adresse du lien">Copier le lien</button>
          <button type="button" class="btn sm ghost danger i-del" title="Annuler l'invitation">${ic("close", "sm")}</button>
        </div>`).join("")}</div>` : ""}` : ""}`;

    // Mon prénom et ma couleur
    const ed = $(".m-edit", pane);
    if (ed) ed.onclick = () => editMe(ctx, pane);

    // Retirer un co-auteur
    $$(".m-del", pane).forEach((b) => b.onclick = async () => {
      const id = b.closest(".member").dataset.user;
      const who = M.name(id) || "cette personne";
      if (!(await ctx.confirm(`Retirer ${who} de ce voyage ? Ses photos, son récit et sa voix restent dans le carnet : c'est le souvenir commun, il ne s'efface pas avec elle.`, "Retirer"))) return;
      try { await ctx.api.removeMember(ctx.trip.id, id); toast(`${who} n'a plus accès à ce carnet`, "ok"); await renderCrewPane(pane, ctx); ctx.onChange && ctx.onChange(); }
      catch (e) { toast(e.message, "error"); }
    });

    // Créer une invitation
    const add = $("#inv-add", pane);
    if (add) add.onclick = async () => {
      const label = $("#inv-label", pane).value.trim();
      if (!label) return toast("Écris d'abord son prénom", "error");
      add.disabled = true;
      try {
        await ctx.api.createInvite(ctx.trip.id, label);
        await renderCrewPane(pane, ctx);
        toast(`Invitation créée pour ${label} — « Envoyer » pour le message tout prêt, « Copier le lien » pour l'adresse seule`, "ok", 7000);
      } catch (e) { toast(e.message, "error", 6000); }
      add.disabled = false;
    };

    // Copier / annuler une invitation
    $$(".i-send", pane).forEach((b) => b.onclick = () => {
      const i = pending.find((x) => x.id === b.closest(".member").dataset.invite);
      sendInvite(i, i.label, ctx);
    });
    // « Copier le lien » copie l'ADRESSE SEULE : collée dans une barre d'adresse, une phrase
    // entière serait prise pour une recherche.
    $$(".i-copy", pane).forEach((b) => b.onclick = async () => {
      const i = pending.find((x) => x.id === b.closest(".member").dataset.invite);
      const url = inviteUrl(ctx, i.token);
      try { await navigator.clipboard.writeText(url); toast("Adresse du lien copiée", "ok"); }
      catch { toast(url, "info", 10000); }
    });
    $$(".i-del", pane).forEach((b) => b.onclick = async () => {
      const i = pending.find((x) => x.id === b.closest(".member").dataset.invite);
      if (!(await ctx.confirm(`Annuler l'invitation de ${i.label || "cette personne"} ? Le lien déjà envoyé ne marchera plus.`, "Annuler l'invitation"))) return;
      try { await ctx.api.revokeInvite(i.id); await renderCrewPane(pane, ctx); toast("Invitation annulée", "ok"); }
      catch (e) { toast(e.message, "error"); }
    });
  }

  function inviteUrl(ctx, token) {
    const base = location.href.split("#")[0].split("?")[0].replace(/index\.html$/, "");
    return `${base}index.html?join=${token}`;
  }

  // Le message tout prêt, pour WhatsApp ou un SMS — pas pour une barre d'adresse.
  async function sendInvite(inv, label, ctx) {
    const url = inviteUrl(ctx, inv.token);
    const text = `${label ? label + ", " : ""}je t'ouvre mon carnet de voyage « ${ctx.trip.title} » : tes photos et tes mots y auront leur place à côté des miens. Ouvre ce lien pour rejoindre : ${url}`;
    if (navigator.share) {
      try { await navigator.share({ title: ctx.trip.title, text }); return; } catch { /* annulé */ }
    }
    try { await navigator.clipboard.writeText(text); toast("Message d'invitation copié — colle-le dans WhatsApp, SMS ou email", "ok", 6000); }
    catch { toast(url, "info", 10000); }
  }

  function editMe(ctx, pane) {
    const me = M.me() || { name: "", color: COLORS[0] };
    const m = ctx.openModal(`<h2>Comment tu apparais</h2>
      <p class="small muted">Ce prénom et cette couleur signent tes photos et ton récit, dans l'app et sur la page de tes proches.</p>
      <form id="f">
        <div class="field"><label>Prénom</label><input name="display_name" maxlength="40" required value="${esc(me.name)}" placeholder="Sophie"></div>
        <div class="field"><label>Couleur de ma pastille</label>
          <div class="color-picker" id="cp">${COLORS.map((c) => `<button type="button" class="swatch-btn${c === me.color ? " active" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}
            <input type="hidden" name="color" value="${esc(me.color)}"></div></div>
        <div class="actions"><button type="button" class="btn ghost" data-close>Annuler</button><span class="grow"></span><button class="btn primary" type="submit">Enregistrer</button></div>
      </form>`);
    const f = $("#f", m.el);
    $$("#cp .swatch-btn", m.el).forEach((b) => b.onclick = () => {
      $$("#cp .swatch-btn", m.el).forEach((x) => x.classList.toggle("active", x === b));
      f.color.value = b.dataset.color;
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      try {
        await ctx.api.updateMember(ctx.trip.id, ctx.user.id, { display_name: fd.display_name.trim(), color: fd.color });
        m.close(); toast("C'est noté", "ok");
        await renderCrewPane(pane, ctx); ctx.onChange && ctx.onChange();
      } catch (err) { toast(err.message, "error"); }
    };
  }

  // ---------------------------------------------------------------------
  //  Panneau « Liens des proches » — nominatifs et révocables
  // ---------------------------------------------------------------------
  async function renderLinksPane(pane, ctx) {
    const t = ctx.trip;
    if (!M.isOwner()) { pane.innerHTML = `<p class="small muted">Seul le propriétaire du carnet gère les liens envoyés aux proches.</p>`; return; }
    let links = [];
    try { links = await ctx.api.listShareLinks(t.id); } catch (e) { pane.innerHTML = `<p class="small muted">${esc(e.message)}</p>`; return; }
    const active = links.filter((l) => l.is_active);
    const cut = links.filter((l) => !l.is_active);
    const url = (l) => `${ctx.shareBase}?t=${l.token}`;

    pane.innerHTML = `
      <p class="small muted">Un lien par personne : tu vois qui a ouvert le carnet et quand, et tu peux couper un lien sans toucher aux autres.
      Le lien général que tu as déjà envoyé continue de fonctionner.</p>

      <div class="field">
        <div class="row"><input id="lk-label" placeholder="Pour qui ? Mamie, Paul…" maxlength="40" class="grow">
          <button type="button" class="btn primary sm" id="lk-add">${ic("plus", "sm")} Créer un lien</button></div>
      </div>

      ${active.length ? `<div class="member-list">${active.map((l) => `<div class="member" data-link="${esc(l.id)}">
        <span class="author-dot big" style="background:var(--azur)">${esc((l.label || "?").charAt(0).toUpperCase())}</span>
        <div class="grow" style="min-width:0"><b>${esc(l.label || "sans nom")}</b>
          <span class="small muted">${l.opens ? `${l.opens} ouverture${l.opens > 1 ? "s" : ""} · dernière le ${new Date(l.last_seen_at).toLocaleDateString("fr-FR")}` : "jamais ouvert"}</span></div>
        <button type="button" class="btn sm ghost lk-copy">Copier</button>
        <button type="button" class="btn sm ghost lk-renew" title="Couper l'ancien et en créer un nouveau">${ic("sparkle", "sm")}</button>
        <button type="button" class="btn sm ghost danger lk-cut" title="Couper ce lien">${ic("close", "sm")}</button>
      </div>`).join("")}</div>` : `<p class="help">Aucun lien nominatif pour l'instant.</p>`}

      ${cut.length ? `<details style="margin-top:14px"><summary class="small muted">${cut.length} lien${cut.length > 1 ? "s" : ""} coupé${cut.length > 1 ? "s" : ""}</summary>
        <div class="member-list">${cut.map((l) => `<div class="member muted" data-link="${esc(l.id)}">
          <span class="author-dot big pending">✕</span>
          <div class="grow" style="min-width:0"><b>${esc(l.label || "sans nom")}</b><span class="small muted">coupé · ${l.opens} ouverture${l.opens > 1 ? "s" : ""}</span></div>
          <button type="button" class="btn sm ghost danger lk-del" title="Effacer de la liste">${ic("trash", "sm")}</button>
        </div>`).join("")}</div></details>` : ""}`;

    $("#lk-add", pane).onclick = async () => {
      const label = $("#lk-label", pane).value.trim();
      if (!label) return toast("Écris d'abord pour qui", "error");
      try { const l = await ctx.api.createShareLink(t.id, label); await copyLink(l, url(l), ctx); renderLinksPane(pane, ctx); }
      catch (e) { toast(e.message, "error"); }
    };
    const find = (b) => links.find((l) => l.id === b.closest(".member").dataset.link);
    $$(".lk-copy", pane).forEach((b) => b.onclick = () => { const l = find(b); copyLink(l, url(l), ctx); });
    $$(".lk-renew", pane).forEach((b) => b.onclick = async () => {
      const l = find(b);
      if (!(await ctx.confirm(`Créer un nouveau lien pour ${l.label} ? L'ancien cessera de fonctionner définitivement.`, "Nouveau lien"))) return;
      try { const n = await ctx.api.renewShareLink(l); await copyLink(n, url(n), ctx); renderLinksPane(pane, ctx); }
      catch (e) { toast(e.message, "error"); }
    });
    $$(".lk-cut", pane).forEach((b) => b.onclick = async () => {
      const l = find(b);
      if (!(await ctx.confirm(`Couper le lien de ${l.label} ? Le carnet ne s'ouvrira plus pour cette personne.`, "Couper"))) return;
      try { await ctx.api.setShareLinkActive(l.id, false); renderLinksPane(pane, ctx); toast("Lien coupé", "ok"); }
      catch (e) { toast(e.message, "error"); }
    });
    $$(".lk-del", pane).forEach((b) => b.onclick = async () => {
      const l = find(b);
      if (!(await ctx.confirm(`Effacer définitivement ce lien de la liste ?`))) return;
      try { await ctx.api.deleteShareLink(l.id); renderLinksPane(pane, ctx); }
      catch (e) { toast(e.message, "error"); }
    });
  }

  async function copyLink(l, url, ctx) {
    const text = `Suis notre voyage « ${ctx.trip.title} » : ${url}`;
    if (navigator.share) { try { await navigator.share({ title: ctx.trip.title, text, url }); return; } catch { } }
    try { await navigator.clipboard.writeText(url); toast(`Lien de ${l.label || "partage"} copié`, "ok"); }
    catch { toast(url, "info", 10000); }
  }

  // ---------------------------------------------------------------------
  //  L'arrivée d'un invité : index.html?join=<jeton>
  // ---------------------------------------------------------------------
  // ctx = { api, onJoined(tripId), onCancel() }
  M.joinScreen = async function (token, ctx) {
    const box = $("#join-body");
    if (!box) return;
    box.innerHTML = `<div class="spinner"></div>`;
    let info = null;
    try { info = await ctx.api.peekInvite(token); } catch (e) { info = { valid: false, reason: e.message }; }

    if (!info || !info.valid) {
      box.innerHTML = `<div class="card"><h2>Cette invitation n'est plus valable</h2>
        <p class="small muted">Raison : ${esc((info && info.reason) || "inconnue")}.
        Demande à la personne qui t'a invité(e) de te renvoyer un lien.</p>
        <div class="actions"><button class="btn" id="j-back">Retour</button></div></div>`;
      $("#j-back", box).onclick = () => ctx.onCancel();
      return;
    }

    const already = await ctx.api.getUser();

    box.innerHTML = `<div class="card join-card">
      <div class="kicker">${esc(info.inviter ? info.inviter + " t'invite" : "Tu es invité(e)")}</div>
      <h2>${esc(info.trip_title)}</h2>
      ${info.trip_subtitle ? `<p class="small muted">${esc(info.trip_subtitle)}</p>` : ""}
      <p style="margin:14px 0">Tu ne reçois pas seulement le carnet : <b>tu l'écris aussi</b>.
      Tes photos, ton récit et ton mot du jour s'y ajouteront à côté de ceux des autres, chacun signé de son prénom.</p>

      ${already ? `<p class="small muted">Tu es déjà connecté(e). Un clic et c'est fait.</p>
        <div class="actions"><button class="btn ghost" id="j-cancel">Plus tard</button><span class="grow"></span>
          <button class="btn primary" id="j-accept">Rejoindre le carnet</button></div>`
      : `<form id="jf">
        <div class="field"><label>Ton prénom (celui qui signera tes photos)</label>
          <input name="display_name" required maxlength="40" value="${esc(info.label || "")}" placeholder="Paul"></div>
        <div class="field"><label>Ton email</label><input type="email" name="email" required autocomplete="email" placeholder="toi@exemple.fr"></div>
        <div class="field"><label>Un mot de passe (6 caractères minimum)</label>
          <input type="password" name="password" required minlength="6" autocomplete="new-password"></div>
        <p class="help">Ce compte ne sert qu'à ce carnet. Aucune confirmation par email à attendre.</p>
        <div class="actions"><button type="button" class="btn ghost" id="j-cancel">Plus tard</button><span class="grow"></span>
          <button class="btn primary" type="submit" id="j-submit">Rejoindre le carnet</button></div></form>`}
    </div>`;

    const cancel = $("#j-cancel", box); if (cancel) cancel.onclick = () => ctx.onCancel();

    const accept = $("#j-accept", box);
    if (accept) accept.onclick = async () => {
      accept.disabled = true;
      try { const r = await ctx.api.acceptInvite(token, null); toast("Bienvenue à bord !", "ok"); ctx.onJoined(r.trip_id); }
      catch (e) { toast(e.message, "error", 6000); accept.disabled = false; }
    };

    const jf = $("#jf", box);
    if (jf) jf.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#j-submit", box); btn.disabled = true; btn.textContent = "…";
      const fd = Object.fromEntries(new FormData(jf));
      try {
        const r = await ctx.api.joinTrip(token, fd.email.trim(), fd.password, fd.display_name.trim());
        // Le compte vient d'être créé côté serveur : on ouvre la session ici.
        await ctx.api.signIn(fd.email.trim(), fd.password);
        toast("Bienvenue à bord !", "ok", 5000);
        ctx.onJoined(r.trip_id);
      } catch (err) {
        toast(err.message, "error", 8000);
        btn.disabled = false; btn.textContent = "Rejoindre le carnet";
      }
    };
  };

  window.MEMBERS = M;
})();
