// ============================================================
//  Couche d'accès aux données (Supabase)
//  Tout ce qui parle à la base de données ou au stockage passe par ici.
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
      const [trip, days, tracks, media, comments] = await Promise.all([
        unwrap(await sb().from("trips").select("*").eq("id", id).single()),
        unwrap(await sb().from("days").select("*").eq("trip_id", id).order("day_date").range(0, 999)),
        unwrap(await sb().from("tracks").select("*").eq("trip_id", id).order("created_at").range(0, 999)),
        unwrap(await sb().from("media").select("*").eq("trip_id", id).order("taken_at", { ascending: true, nullsFirst: false }).range(0, 4999)),
        unwrap(await sb().from("comments").select("*").eq("trip_id", id).order("created_at").range(0, 4999)),
      ]);
      return { trip, days, tracks, media, comments };
    },

    // ---------- Journées ----------
    async upsertDay(user, tripId, dayDate, fields) {
      return unwrap(await sb().from("days")
        .upsert({ trip_id: tripId, user_id: user.id, day_date: dayDate, ...fields }, { onConflict: "trip_id,day_date" })
        .select().single());
    },
    async deleteDay(id) {
      unwrap(await sb().from("days").delete().eq("id", id));
    },

    // ---------- Traces GPS ----------
    async createTrack(user, tripId, fields) {
      return unwrap(await sb().from("tracks").insert({ ...fields, trip_id: tripId, user_id: user.id }).select().single());
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
    async uploadFile(user, tripId, blob, ext) {
      const name = `${user.id}/${tripId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      unwrap(await sb().storage.from("media").upload(name, blob, { contentType: blob.type, upsert: false }));
      return name;
    },
    async createMedia(user, tripId, fields) {
      return unwrap(await sb().from("media").insert({ ...fields, trip_id: tripId, user_id: user.id }).select().single());
    },
    async updateMedia(id, fields) {
      return unwrap(await sb().from("media").update(fields).eq("id", id).select().single());
    },
    async deleteMedia(m) {
      unwrap(await sb().from("media").delete().eq("id", m.id));
      await this.removeFiles([m.path, m.thumb_path, m.audio_path]).catch(() => {});
    },

    // ---------- Commentaires (côté propriétaire) ----------
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
