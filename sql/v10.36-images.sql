-- ============================================================================
--  Bonvoyage v10.36 — les images à la bonne taille (sujet #1, lot 3)
--
--  Jusqu'ici l'app fabriquait DEUX fichiers par photo : un grand (1600 px) et
--  une vignette (320 px). La même vignette servait à tout — et elle servait mal :
--
--    · une tuile de la grille du récit fait 655 pixels réels sur l'iPhone de
--      Sophie : la vignette de 320 y était étirée du double, d'où le flou ;
--    · une pastille photo posée sur la carte n'en fait que 146 : la même
--      vignette de 320 y apportait près de cinq fois trop de pixels, chargés
--      et décodés pour rien — en 4G, chez les proches, c'est ce qui coûte.
--
--  Depuis la v10.36 il y a donc TROIS fichiers, chacun calé sur un usage mesuré :
--
--    path        1600 px   l'affichage : photo phare et plein écran   (inchangé)
--    grid_path    768 px   les tuiles de la grille et la couverture de journée
--    thumb_path   192 px   les pastilles de la carte et les petites vignettes
--
--  Ce script ne fait que DEUX choses : ajouter la colonne grid_path, et faire
--  en sorte que la porte de partage la renvoie — sans quoi les proches ne la
--  verraient jamais, et la grille resterait floue pour eux seuls.
--
--  À exécuter dans Supabase → SQL Editor, APRÈS v10.8-arrets.sql.
--  Le script est rejouable : on peut le lancer deux fois sans casse.
--
--  Rien ne presse et rien ne casse : tant qu'il n'est pas passé, l'app continue
--  de fonctionner. Les photos partent sans vignette de grille (l'app le détecte
--  et réessaie sans elle), et l'affichage retombe sur l'ancienne vignette.
-- ============================================================================

-- ---------- La colonne ----------
-- Les photos déjà en ligne la laissent vide : elles retombent alors sur
-- thumb_path et s'affichent exactement comme avant ce script. Aucun rattrapage
-- n'est nécessaire pour que le carnet continue de marcher.
alter table public.media add column if not exists grid_path text;

-- ---------- La porte de partage ----------
-- Reprise à l'identique de v10.8-arrets.sql : seule la ligne 'grid_path' est
-- nouvelle dans le bloc `media`. Tout le reste — le filtrage par `vis`, les
-- arrêts, les voix, les récits des co-auteurs — est inchangé.

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
-- ============================================================================
