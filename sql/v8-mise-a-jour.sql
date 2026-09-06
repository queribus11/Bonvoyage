-- Bonvoyage v8 — mise à jour de la base (à coller dans Supabase > SQL Editor > Run)
-- Ajoute le nom du lieu des journées et l'expose sur la page des proches.
-- Sans risque : peut être relancé. Équivalent à relancer tout schema.sql.
alter table public.days add column if not exists place text;
create or replace function public.get_shared_trip(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  vis date[];
  result jsonb;
begin
  select * into t from public.trips where share_token = token and is_shared = true;
  if not found then
    return null;
  end if;

  -- En mode 'manual', seules les journées publiées (et leurs traces, photos, commentaires) sont visibles
  if t.publish_mode = 'live' then
    select coalesce(array_agg(distinct d), '{}') into vis from (
      select day_date d from public.days where trip_id = t.id
      union select day_date from public.tracks where trip_id = t.id and day_date is not null
      union select day_date from public.media where trip_id = t.id and day_date is not null) x;
  else
    select coalesce(array_agg(day_date), '{}') into vis from public.days where trip_id = t.id and published = true;
  end if;

  select jsonb_build_object(
    'trip', jsonb_build_object(
      'id', t.id, 'title', t.title, 'subtitle', t.subtitle, 'description', t.description,
      'start_date', t.start_date, 'end_date', t.end_date, 'cover_path', t.cover_path,
      'allow_comments', t.allow_comments, 'publish_mode', t.publish_mode
    ),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day_date', d.day_date, 'title', d.title, 'story', d.story, 'audio_path', d.audio_path, 'place', d.place,
        'published_at', coalesce(d.published_at, d.created_at), 'updated_at', d.updated_at)
        order by d.day_date) from public.days d where d.trip_id = t.id and d.day_date = any(vis)), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', tr.id, 'day_date', tr.day_date, 'name', tr.name, 'source', tr.source,
        'points', tr.points, 'distance_m', tr.distance_m, 'created_at', tr.created_at)
        order by tr.created_at) from public.tracks tr where tr.trip_id = t.id and tr.day_date = any(vis)), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'day_date', m.day_date, 'kind', m.kind, 'path', m.path, 'thumb_path', m.thumb_path,
        'lat', m.lat, 'lng', m.lng, 'taken_at', m.taken_at, 'caption', m.caption, 'audio_path', m.audio_path,
        'sort_order', m.sort_order, 'created_at', m.created_at)
        order by m.taken_at nulls last, m.created_at) from public.media m where m.trip_id = t.id and m.day_date = any(vis)), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'media_id', c.media_id, 'day_id', c.day_id, 'author', c.author,
        'body', c.body, 'audio_path', c.audio_path, 'created_at', c.created_at)
        order by c.created_at) from public.comments c where c.trip_id = t.id
          and (c.media_id is null or c.media_id in (select id from public.media where trip_id = t.id and day_date = any(vis)))
          and (c.day_id is null or c.day_id in (select id from public.days where trip_id = t.id and day_date = any(vis)))), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

drop function if exists public.add_shared_comment(text, uuid, uuid, text, text);
