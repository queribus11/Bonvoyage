// ============================================================
//  Fonction Supabase "notify" : envoie une notification aux proches abonnés
//  À déployer via Supabase > Edge Functions > Deploy a new function > "Via Editor"
//  Nom de la fonction : notify
//  Secrets à définir (Edge Functions > Secrets) : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // Client "utilisateur" : vérifie que la personne connectée est bien propriétaire du voyage
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Non connecté" }, 401);

    const { trip_id, title, body, url } = await req.json();
    const { data: trip } = await userClient.from("trips").select("id,title").eq("id", trip_id).single();
    if (!trip) return json({ error: "Voyage introuvable ou pas à toi" }, 403);

    // Client "admin" pour lire les abonnements (jamais exposé au navigateur)
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: subs } = await admin.from("push_subscriptions").select("id,subscription").eq("trip_id", trip_id);
    if (!subs || subs.length === 0) return json({ sent: 0, total: 0 });

    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@example.com",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );
    const payload = JSON.stringify({ title: String(title || trip.title).slice(0, 80), body: String(body || "").slice(0, 200), url: String(url || "") });

    let sent = 0; const dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification(s.subscription, payload, { TTL: 86400 }); sent++; }
      catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) dead.push(s.id); }
    }));
    // Nettoie les abonnements expirés (téléphone changé, notifications désactivées…)
    if (dead.length) await admin.from("push_subscriptions").delete().in("id", dead);

    return json({ sent, total: subs.length, removed: dead.length });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
