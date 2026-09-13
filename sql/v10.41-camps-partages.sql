-- ============================================================================
--  Bonvoyage v10.41 — les camps de base arrivent chez les proches (sujet #38)
--
--  La v10.40 a posé « Notre camp de base » dans l'atelier. Ce script ouvre la
--  porte des proches : get_shared_trip renvoie désormais les camps, et la page
--  de partage les dessine comme les arrêts.
--
--  🔴 L'ÉTANCHÉITÉ, et c'est tout l'objet de ce fichier : un camp couvre
--  PLUSIEURS journées, dont certaines peuvent être encore en brouillon. Il ne
--  sort donc que si une journée VISIBLE s'en sert :
--     · soit sa nuit est elle-même une journée visible (il la ferme) ;
--     · soit il est le dernier camp marqué avant une journée visible (il l'ouvre).
--  Le reste du filtrage ne change pas : c'est le même tableau `vis`.
--
--  Recopie intégrale de la version v10.36 (celle qui fait foi), avec la seule
--  clé 'camps' en plus. Rien d'autre n'est touché.
--
--  ✅ CE SCRIPT N'ENLÈVE RIEN : il ajoute une clé, il ne retire aucune valeur
--  permise. Il peut donc être exécuté AVANT ou APRÈS la mise en ligne de la
--  v10.41, sans aucune fenêtre de casse — contrairement à celui de la v10.40,
--  qui retirait « camp » des catégories et devait, lui, passer avec le code.
--
--  À exécuter dans Supabase → SQL Editor, APRÈS v10.40-camp-de-base.sql.
--  Le script est rejouable : on peut le lancer deux fois sans casse.
-- ============================================================================

create or replace function public.get_shared_trip(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  v_trip uuid;
  vis date[];
  result jsonb;
begin
  v_trip := public.trip_for_token(token, true);
  if v_trip is null then return null; end if;
  select * into t from public.trips where id = v_trip;
  if not found then return null; end if;

  -- En mode 'manual', seules les journées publiées (et leurs traces, photos,
  -- arrêts, voix et commentaires) sont visibles.
  if t.publish_mode = 'live' then
    select coalesce(array_agg(distinct d), '{}') into vis from (
      select day_date d from public.days where trip_id = t.id
      union select day_date from public.tracks where trip_id = t.id and day_date is not null
      union select day_date from public.media  where trip_id = t.id and day_date is not null) x;
  else
    select coalesce(array_agg(day_date), '{}') into vis
      from public.days where trip_id = t.id and published = true;
  end if;

  select jsonb_build_object(
    'trip', jsonb_build_object(
      'id', t.id, 'title', t.title, 'subtitle', t.subtitle, 'description', t.description,
      'start_date', t.start_date, 'end_date', t.end_date, 'cover_path', t.cover_path,
      'allow_comments', t.allow_comments, 'publish_mode', t.publish_mode, 'replay_speed', t.replay_speed
    ),
    -- Les compagnons de voyage : juste de quoi afficher une pastille.
    -- Aucun email, aucune donnée de compte ne sort d'ici.
    'authors', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.user_id, 'name', m.display_name, 'color', m.color, 'role', m.role)
        order by (m.role = 'owner') desc, m.joined_at)
        from public.trip_members m where m.trip_id = t.id and m.display_name <> ''), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day_date', d.day_date, 'title', d.title, 'story', d.story,
        'audio_path', d.audio_path, 'place', d.place, 'transport', d.transport,
        'author_id', d.author_id,
        'published_at', coalesce(d.published_at, d.created_at), 'updated_at', d.updated_at)
        order by d.day_date) from public.days d
        where d.trip_id = t.id and d.day_date = any(vis)), '[]'::jsonb),
    -- Les récits des co-auteurs, qui viennent après celui de l'auteur de la journée.
    -- (day_notes — le carnet de bord — n'apparaît volontairement nulle part ici.)
    'stories', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'day_id', s.day_id, 'day_date', s.day_date, 'author_id', s.author_id,
        'body', s.body, 'created_at', s.created_at, 'updated_at', s.updated_at)
        order by s.created_at) from public.day_stories s
        where s.trip_id = t.id and s.day_date = any(vis) and coalesce(s.body, '') <> ''), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', tr.id, 'day_date', tr.day_date, 'name', tr.name, 'source', tr.source,
        'points', tr.points, 'distance_m', tr.distance_m, 'author_id', tr.author_id,
        'created_at', tr.created_at)
        order by tr.created_at) from public.tracks tr
        where tr.trip_id = t.id and tr.day_date = any(vis)), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'day_date', m.day_date, 'kind', m.kind, 'path', m.path,
        'grid_path', m.grid_path, 'thumb_path', m.thumb_path,
        'lat', m.lat, 'lng', m.lng, 'taken_at', m.taken_at, 'caption', m.caption,
        'audio_path', m.audio_path, 'transport', m.transport, 'author_id', m.author_id,
        'sort_order', m.sort_order, 'created_at', m.created_at)
        order by m.taken_at nulls last, m.created_at) from public.media m
        where m.trip_id = t.id and m.day_date = any(vis)), '[]'::jsonb),
    -- v10.8 · les arrêts : le fil de la journée, sous les statistiques.
    -- Un arrêt sans nom n'a rien à dire à personne : il ne sort pas.
    'stops', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'day_date', p.day_date, 'lat', p.lat, 'lng', p.lng,
        'at_time', p.at_time, 'name', p.name, 'category', p.category, 'note', p.note,
        'media_ids', p.media_ids, 'author_id', p.author_id,
        'sort_order', p.sort_order, 'created_at', p.created_at)
        order by p.at_time nulls last, p.sort_order, p.created_at) from public.day_stops p
        where p.trip_id = t.id and p.day_date = any(vis) and coalesce(p.name, '') <> ''), '[]'::jsonb),
    'voices', coalesce((select jsonb_agg(jsonb_build_object(
        'id', v.id, 'day_id', v.day_id, 'day_date', v.day_date, 'author_id', v.author_id,
        'audio_path', v.audio_path, 'seconds', v.seconds, 'created_at', v.created_at)
        order by v.created_at) from public.day_voices v
        where v.trip_id = t.id and v.day_date = any(vis)), '[]'::jsonb),
    -- v10.41 · #38 · Les camps de base. ÉTANCHÉITÉ : un camp couvre plusieurs journées,
    -- dont certaines peuvent être encore en brouillon. Il ne sort donc QUE si une journée
    -- visible s'en sert — soit qu'il la ferme (sa nuit EST cette journée), soit qu'il
    -- l'ouvre (c'est le dernier camp marqué avant elle). Même `vis` que tout le reste,
    -- aucun chemin parallèle.
    'camps', coalesce((select jsonb_agg(jsonb_build_object(
        'id', k.id, 'night_date', k.night_date, 'lat', k.lat, 'lng', k.lng,
        'name', k.name, 'address', k.address, 'transport', k.transport,
        'author_id', k.author_id, 'created_at', k.created_at)
        order by k.night_date) from public.trip_camps k
        where k.trip_id = t.id
          and exists (select 1 from unnest(vis) as u(jour)
                      where k.night_date = u.jour
                         or k.night_date = (select max(k2.night_date) from public.trip_camps k2
                                            where k2.trip_id = t.id and k2.night_date < u.jour))), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'media_id', c.media_id, 'day_id', c.day_id, 'author', c.author,
        'body', c.body, 'audio_path', c.audio_path, 'created_at', c.created_at)
        order by c.created_at) from public.comments c where c.trip_id = t.id
          and (c.media_id is null or c.media_id in (select id from public.media where trip_id = t.id and day_date = any(vis)))
          and (c.day_id   is null or c.day_id   in (select id from public.days  where trip_id = t.id and day_date = any(vis)))), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_shared_trip(text) to anon, authenticated;

-- ============================================================================
--  Fin ✔
--  Vérification rapide, si tu veux voir le résultat :
--    select jsonb_array_length(public.get_shared_trip('<ton jeton de partage>') -> 'camps');
-- ============================================================================
