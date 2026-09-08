// ============================================================
//  Couche d'accès aux données (Supabase)
//  Tout ce qui parle à la base de données ou au stockage passe par ici.
//  v10 : le carnet à plusieurs — membres, invitations, mots du jour,
//        liens de partage nominatifs.
// ============================================================
(function () {
  const cfg = window.CARNET_CONFIG || {};

  function isConfigured() {
    return cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes("xxxxxxxx") && !cfg.SUPABASE_ANON_KEY.includes("colle-ici");
  }

  let client = null;
  function sb() {
    if (!client) {
      if (!window.supabase) throw new Error("Bibliothèque Supabase non chargée (pas de connexion internet ?)");
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    }
    return client;
  }

  function unwrap({ data, error }) {
    if (error) throw new Error(error.message || String(error));
    return data;
  }

  const api = {
    isConfigured,

    // ---------- Authentification ----------
    async getUser() {
      const { data } = await sb().auth.getSession();
      return data.session ? data.session.user : null;
    },
    onAuthChange(cb) {
      sb().auth.onAuthStateChange((_evt, session) => cb(session ? session.user : null));
    },
    async signUp(email, password) {
      return unwrap(await sb().auth.signUp({ email, password }));
    },
    async signIn(email, password) {
      return unwrap(await sb().auth.signInWithPassword({ email, password }));
    },
    async resetPassword(email) {
      return unwrap(await sb().auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
    },
    async updatePassword(password) {
      return unwrap(await sb().auth.updateUser({ password }));
    },
    async signOut() {
      await sb().auth.signOut();
    },

    // ---------- Voyages ----------
    async listTrips() {
      return unwrap(await sb().from("trips").select("*").order("start_date", { ascending: false, nullsFirst: false }));
    },
    async createTrip(user, fields) {
      return unwrap(await sb().from("trips").insert({ ...fields, user_id: user.id }).select().single());
    },
    async updateTrip(id, fields) {
      return unwrap(await sb().from("trips").update(fields).eq("id", id).select().single());
    },
    async deleteTrip(id) {
      unwrap(await sb().from("trips").delete().eq("id", id));
    },
    async loadTrip(id) {
      const [trip, days, tracks, media, comments, members, voices, stories, notes] = await Promise.all([
        unwrap(await sb().from("trips").select("*").eq("id", id).single()),
        unwrap(await sb().from("days").select("*").eq("trip_id", id).order("day_date").range(0, 999)),
        unwrap(await sb().from("tracks").select("*").eq("trip_id", id).order("created_at").range(0, 999)),
        unwrap(await sb().from("media").select("*").eq("trip_id", id).order("taken_at", { ascending: true, nullsFirst: false }).range(0, 4999)),
        unwrap(await sb().from("comments").select("*").eq("trip_id", id).order("created_at").range(0, 4999)),
        unwrap(await sb().from("trip_members").select("*").eq("trip_id", id).order("joined_at")),
        unwrap(await sb().from("day_voices").select("*").eq("trip_id", id).order("created_at").range(0, 999)),
        unwrap(await sb().from("day_stories").select("*").eq("trip_id", id).order("created_at").range(0, 999)),
        unwrap(await sb().from("day_notes").select("*").eq("trip_id", id).order("created_at").range(0, 999)),
      ]);
      return { trip, days, tracks, media, comments, members, voices, stories, notes };
    },

    // ---------- Journées ----------
    // v10 : user_id et author_id sont posés par la base (trigger stamp_contribution).
    // On ne les envoie plus : c'est ce qui empêche un co-auteur de s'attribuer
    // la ligne d'un autre, et ce qui garde days.user_id = propriétaire du voyage.
    async upsertDay(user, tripId, dayDate, fields) {
      return unwrap(await sb().from("days")
        .upsert({ trip_id: tripId, day_date: dayDate, ...fields }, { onConflict: "trip_id,day_date" })
        .select().single());
    },
    async getDay(tripId, dayDate) {
      const { data, error } = await sb().from("days").select("*").eq("trip_id", tripId).eq("day_date", dayDate).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async deleteDay(id) {
      unwrap(await sb().from("days").delete().eq("id", id));
    },

    // ---------- Traces GPS ----------
    async createTrack(user, tripId, fields) {
      return unwrap(await sb().from("tracks").insert({ ...fields, trip_id: tripId }).select().single());
    },
    async updateTrack(id, fields) {
      return unwrap(await sb().from("tracks").update(fields).eq("id", id).select().single());
    },
    async deleteTrack(id) {
      unwrap(await sb().from("tracks").delete().eq("id", id));
    },

    // ---------- Photos / vidéos ----------
    // Les vocaux des proches vivent dans un bucket séparé "voice" (audio seulement, 5 Mo max)
    bucketOf(path) { return path && path.startsWith("comments/") ? "voice" : "media"; },
    publicUrl(path) {
      if (!path) return "";
      return sb().storage.from(this.bucketOf(path)).getPublicUrl(path).data.publicUrl;
    },
    // Commentaire vocal d'un proche (sans compte) : dossier comments/<id du voyage>/
    async uploadAnonAudio(tripId, blob, ext) {
      const name = `comments/${tripId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      unwrap(await sb().storage.from("voice").upload(name, blob, { contentType: blob.type || "audio/webm", upsert: false }));
      return name;
    },
    async removeFiles(paths) {
      for (const bucket of ["media", "voice"]) {
        const ps = paths.filter((p) => p && this.bucketOf(p) === bucket);
        if (ps.length) await sb().storage.from(bucket).remove(ps);
      }
    },
    // Chaque auteur écrit dans SON dossier <user_id>/<trip_id>/… : c'est ce que
    // vérifient les politiques du bucket, en plus de l'appartenance au voyage.
    async uploadFile(user, tripId, blob, ext) {
      const name = `${user.id}/${tripId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      unwrap(await sb().storage.from("media").upload(name, blob, { contentType: blob.type, upsert: false }));
      return name;
    },
    async createMedia(user, tripId, fields) {
      return unwrap(await sb().from("media").insert({ ...fields, trip_id: tripId }).select().single());
    },
    async updateMedia(id, fields) {
      return unwrap(await sb().from("media").update(fields).eq("id", id).select().single());
    },
    async deleteMedia(m) {
      unwrap(await sb().from("media").delete().eq("id", m.id));
      await this.removeFiles([m.path, m.thumb_path, m.audio_path]).catch(() => {});
    },

    // ---------- Commentaires (côté propriétaire et co-auteurs) ----------
    async deleteComment(c) {
      unwrap(await sb().from("comments").delete().eq("id", c.id));
      if (c.audio_path) await this.removeFiles([c.audio_path]).catch(() => {});
    },
    // Tous les commentaires de tous mes voyages (pour les badges "nouveaux")
    async listAllComments() {
      return unwrap(await sb().from("comments").select("trip_id,created_at"));
    },
    async addOwnerComment(tripId, fields) {
      return unwrap(await sb().from("comments").insert({ ...fields, trip_id: tripId }).select().single());
    },

    // ---------- Le carnet à plusieurs : les membres ----------
    async listMembers(tripId) {
      return unwrap(await sb().from("trip_members").select("*").eq("trip_id", tripId).order("joined_at"));
    },
    // Mes adhésions à tous mes voyages : sert aux badges de la liste des voyages
    // (chacun a désormais son propre repère « déjà vu »).
    async listMyMemberships() {
      const u = await this.getUser();
      if (!u) return [];
      return unwrap(await sb().from("trip_members").select("*").eq("user_id", u.id));
    },
    async updateMember(tripId, userId, fields) {
      return unwrap(await sb().from("trip_members").update(fields).eq("trip_id", tripId).eq("user_id", userId).select().single());
    },
    async removeMember(tripId, userId) {
      unwrap(await sb().from("trip_members").delete().eq("trip_id", tripId).eq("user_id", userId));
    },
    async markSeen(tripId, field) {   // field = "comments_seen_at" | "activity_seen_at"
      const u = await this.getUser();
      if (!u) return;
      const { error } = await sb().from("trip_members")
        .update({ [field]: new Date().toISOString() }).eq("trip_id", tripId).eq("user_id", u.id);
      if (error) throw new Error(error.message);
    },

    // ---------- Le carnet à plusieurs : les invitations ----------
    async listInvites(tripId) {
      return unwrap(await sb().from("trip_invites").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }));
    },
    async createInvite(tripId, label) {
      const u = await this.getUser();
      return unwrap(await sb().from("trip_invites").insert({ trip_id: tripId, label: label || "", created_by: u.id }).select().single());
    },
    async revokeInvite(id) {
      unwrap(await sb().from("trip_invites").update({ revoked: true }).eq("id", id));
    },
    // Ce que voit l'invité avant de créer son compte (aucun compte requis)
    async peekInvite(token) {
      return unwrap(await sb().rpc("peek_invite", { p_token: token }));
    },
    // Rejoindre quand on a déjà un compte et qu'on est connecté
    async acceptInvite(token, displayName) {
      return unwrap(await sb().rpc("accept_invite", { p_token: token, p_display_name: displayName || null }));
    },
    // Rejoindre en créant son compte : passe par la fonction Edge (clé de service)
    async joinTrip(token, email, password, displayName) {
      const { data, error } = await sb().functions.invoke("join-trip", {
        body: { token, email, password, display_name: displayName || null },
      });
      if (error) {
        let msg = error.message || "Invitation impossible";
        try { const j = await error.context?.json?.(); if (j && j.error) msg = j.error; } catch { }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },

    // ---------- Le récit d'un co-auteur et le carnet de bord ----------
    // Même forme pour les deux tables : une ligne par personne et par journée.
    // Un corps vide efface la ligne — on ne laisse pas traîner de contribution
    // fantôme qui ferait apparaître un bloc vide dans le carnet.
    async saveDayText(table, tripId, dayId, dayDate, authorId, body, existing) {
      const txt = (body || "").trim();
      if (!txt) {
        if (existing) unwrap(await sb().from(table).delete().eq("id", existing.id));
        return null;
      }
      return unwrap(await sb().from(table)
        .upsert({ trip_id: tripId, day_id: dayId, day_date: dayDate, author_id: authorId, body: txt },
                { onConflict: "day_id,author_id" })
        .select().single());
    },
    saveDayStory(tripId, dayId, dayDate, authorId, body, existing) {
      return this.saveDayText("day_stories", tripId, dayId, dayDate, authorId, body, existing);
    },
    saveDayNote(tripId, dayId, dayDate, authorId, body, existing) {
      return this.saveDayText("day_notes", tripId, dayId, dayDate, authorId, body, existing);
    },
    async deleteDayText(table, id) {
      unwrap(await sb().from(table).delete().eq("id", id));
    },

    // ---------- Le mot du jour vocal ----------
    async upsertDayVoice(tripId, dayId, dayDate, authorId, audioPath, seconds) {
      return unwrap(await sb().from("day_voices")
        .upsert({ trip_id: tripId, day_id: dayId, day_date: dayDate, author_id: authorId, audio_path: audioPath, seconds: seconds || 0 },
                { onConflict: "day_id,author_id" })
        .select().single());
    },
    async deleteDayVoice(v) {
      unwrap(await sb().from("day_voices").delete().eq("id", v.id));
      if (v.audio_path) await this.removeFiles([v.audio_path]).catch(() => {});
    },

    // ---------- Liens de partage nominatifs (pour les proches) ----------
    async listShareLinks(tripId) {
      return unwrap(await sb().from("share_links").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }));
    },
    async createShareLink(tripId, label) {
      return unwrap(await sb().from("share_links").insert({ trip_id: tripId, label: label || "" }).select().single());
    },
    async setShareLinkActive(id, active) {
      return unwrap(await sb().from("share_links").update({ is_active: active }).eq("id", id).select().single());
    },
    // « Nouveau lien » : l'ancien meurt définitivement, on en crée un autre au même nom
    async renewShareLink(link) {
      await this.setShareLinkActive(link.id, false);
      return this.createShareLink(link.trip_id, link.label);
    },
    async deleteShareLink(id) {
      unwrap(await sb().from("share_links").delete().eq("id", id));
    },

    // ---------- Notifications ----------
    async subscribePush(token, subscription) {
      unwrap(await sb().rpc("subscribe_push", { token, sub: subscription }));
    },
    async unsubscribePush(token, endpoint) {
      unwrap(await sb().rpc("unsubscribe_push", { token, p_endpoint: endpoint }));
    },
    async countPushSubscriptions(tripId) {
      const { count, error } = await sb().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
      if (error) throw new Error(error.message);
      return count || 0;
    },
    async notify(tripId, title, body, url) {
      const { data, error } = await sb().functions.invoke("notify", { body: { trip_id: tripId, title, body, url } });
      if (error) {
        let msg = error.message || "Fonction notify indisponible";
        try { const j = await error.context?.json?.(); if (j && j.error) msg = j.error; } catch { }
        throw new Error(msg);
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },

    // ---------- Partage public (sans compte) ----------
    async getSharedTrip(token) {
      return unwrap(await sb().rpc("get_shared_trip", { token }));
    },
    async addSharedComment(token, mediaId, dayId, author, body, audioPath) {
      return unwrap(await sb().rpc("add_shared_comment", {
        token, p_media_id: mediaId || null, p_day_id: dayId || null, p_author: author, p_body: body || "", p_audio_path: audioPath || null,
      }));
    },
  };

  window.API = window.API_OVERRIDE || api;
})();
