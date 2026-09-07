-- ============================================================
--  Carnet de Voyage — schéma de base de données Supabase
--  À coller tel quel dans : Supabase > SQL Editor > New query > Run
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Tables ----------

create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  subtitle    text default '',
  description text default '',
  start_date  date,
  end_date    date,
  cover_path  text,
  share_token text unique not null default encode(gen_random_bytes(12), 'hex'),
  is_shared   boolean not null default true,
  allow_comments boolean not null default true,
  publish_mode text not null default 'manual',   -- 'manual' : journée visible une fois publiée | 'live' : tout visible en direct
  comments_seen_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.days (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  day_date  date not null,
  title     text default '',
  story     text default '',
  audio_path text,                         -- récit audio de la journée
  published boolean not null default false,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (trip_id, day_date)
);

-- Une trace = une liste de points [{lat,lng,alt,t}] stockée en JSON
-- (beaucoup plus léger qu'une ligne par point)
create table if not exists public.tracks (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  day_date  date,
  name      text default '',
  source    text not null default 'gps',   -- 'gps' | 'gpx' | 'manual'
  points    jsonb not null default '[]'::jsonb,
  distance_m integer default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id        uuid primary key default gen_random_uuid(),
  trip_id   uuid not null references public.trips(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  day_date  date,
  kind      text not null default 'photo',  -- 'photo' | 'video'
  path      text not null,                  -- chemin dans le bucket "media"
  thumb_path text,
  lat       double precision,
  lng       double precision,
  taken_at  timestamptz,
  caption   text default '',
  audio_path text,                          -- commentaire audio du propriétaire sur la photo
  sort_order integer default 0,
  created_at timestamptz not null default now()
);

-- Commentaires laissés par les proches sur la page partagée (ou par toi)
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  media_id   uuid references public.media(id) on delete cascade,
  day_id     uuid references public.days(id) on delete cascade,
  author     text not null,
  body       text not null default '',
  audio_path text,                          -- commentaire vocal
  created_at timestamptz not null default now()
);

-- Si tu avais déjà exécuté une version précédente de ce script, ces lignes ajoutent les colonnes manquantes
alter table public.trips    add column if not exists publish_mode text not null default 'manual';
alter table public.trips    add column if not exists comments_seen_at timestamptz not null default now();
alter table public.days     add column if not exists audio_path text;
alter table public.days     add column if not exists published boolean not null default false;
alter table public.days     add column if not exists published_at timestamptz;
alter table public.days     add column if not exists updated_at timestamptz not null default now();
alter table public.media    add column if not exists audio_path text;
alter table public.comments add column if not exists audio_path text;
alter table public.comments alter column body set default '';
-- v8 : nom du lieu de la journée (commune, pays), rempli automatiquement par l'app
alter table public.days     add column if not exists place text;
-- v8.3 : moyen de locomotion pour arriver à une photo (walk, bike, car, bus, train, boat, plane)
alter table public.media    add column if not exists transport text;
-- v8.8 : vitesse du survol choisie par le propriétaire (0.5 lent · 1 normal · 2 rapide)
alter table public.trips    add column if not exists replay_speed real not null default 1;
-- v9 : moyen de locomotion de la journée (walk, bike, car, bus, train, boat, kayak, plane, moto)
alter table public.days     add column if not exists transport text;
-- v5 : un téléphone peut suivre plusieurs voyages
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'push_subscriptions_endpoint_key') then
    alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_key;
    alter table public.push_subscriptions add constraint push_subscriptions_trip_endpoint_key unique (trip_id, endpoint);
  end if;
exception when undefined_table then null; end $$;

create index if not exists days_trip_idx    on public.days(trip_id);
create index if not exists tracks_trip_idx  on public.tracks(trip_id);
create index if not exists media_trip_idx   on public.media(trip_id);
create index if not exists comments_trip_idx on public.comments(trip_id);
create index if not exists trips_token_idx  on public.trips(share_token);

-- ---------- Sécurité (RLS) : chacun ne voit que ses propres voyages ----------

alter table public.trips    enable row level security;
alter table public.days     enable row level security;
alter table public.tracks   enable row level security;
alter table public.media    enable row level security;
alter table public.comments enable row level security;

drop policy if exists "trips owner" on public.trips;
create policy "trips owner" on public.trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "days owner" on public.days;
create policy "days owner" on public.days
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tracks owner" on public.tracks;
create policy "tracks owner" on public.tracks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "media owner" on public.media;
create policy "media owner" on public.media
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Le propriétaire du voyage voit / modère les commentaires
drop policy if exists "comments owner" on public.comments;
create policy "comments owner" on public.comments
  for all using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

-- ---------- Partage public par lien secret ----------
-- Les proches n'ont pas de compte : ils passent par ces deux fonctions,
-- qui n'exposent QUE le voyage correspondant au jeton secret.

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
      'allow_comments', t.allow_comments, 'publish_mode', t.publish_mode, 'replay_speed', t.replay_speed
    ),
    'days', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'day_date', d.day_date, 'title', d.title, 'story', d.story, 'audio_path', d.audio_path, 'place', d.place, 'transport', d.transport,
        'published_at', coalesce(d.published_at, d.created_at), 'updated_at', d.updated_at)
        order by d.day_date) from public.days d where d.trip_id = t.id and d.day_date = any(vis)), '[]'::jsonb),
    'tracks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', tr.id, 'day_date', tr.day_date, 'name', tr.name, 'source', tr.source,
        'points', tr.points, 'distance_m', tr.distance_m, 'created_at', tr.created_at)
        order by tr.created_at) from public.tracks tr where tr.trip_id = t.id and tr.day_date = any(vis)), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(jsonb_build_object(
        'id', m.id, 'day_date', m.day_date, 'kind', m.kind, 'path', m.path, 'thumb_path', m.thumb_path,
        'lat', m.lat, 'lng', m.lng, 'taken_at', m.taken_at, 'caption', m.caption, 'audio_path', m.audio_path, 'transport', m.transport,
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
create or replace function public.add_shared_comment(token text, p_media_id uuid, p_day_id uuid, p_author text, p_body text, p_audio_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  c public.comments%rowtype;
begin
  select * into t from public.trips where share_token = token and is_shared = true and allow_comments = true;
  if not found then
    raise exception 'Voyage introuvable ou commentaires désactivés';
  end if;
  if length(trim(p_author)) = 0 or (length(trim(coalesce(p_body, ''))) = 0 and p_audio_path is null) then
    raise exception 'Prénom et message (écrit ou vocal) obligatoires';
  end if;
  if p_audio_path is not null and p_audio_path not like 'comments/' || t.id::text || '/%' then
    raise exception 'Fichier audio invalide';
  end if;
  if length(p_body) > 2000 or length(p_author) > 60 then
    raise exception 'Message trop long';
  end if;
  if p_media_id is not null and not exists (select 1 from public.media where id = p_media_id and trip_id = t.id) then
    raise exception 'Photo introuvable';
  end if;
  if p_day_id is not null and not exists (select 1 from public.days where id = p_day_id and trip_id = t.id) then
    raise exception 'Journée introuvable';
  end if;

  insert into public.comments (trip_id, media_id, day_id, author, body, audio_path)
  values (t.id, p_media_id, p_day_id, trim(p_author), trim(coalesce(p_body, '')), p_audio_path)
  returning * into c;

  return to_jsonb(c);
end;
$$;

grant execute on function public.get_shared_trip(text) to anon, authenticated;
grant execute on function public.add_shared_comment(text, uuid, uuid, text, text, text) to anon, authenticated;

-- ---------- Notifications aux proches (Web Push) ----------
-- Un proche appuie sur « Me prévenir » : son téléphone fournit une adresse d'abonnement,
-- stockée ici. Aucune donnée personnelle (ni nom, ni email).

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  endpoint   text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  unique (trip_id, endpoint)          -- un même téléphone peut suivre plusieurs voyages
);
create index if not exists push_trip_idx on public.push_subscriptions(trip_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists "push owner" on public.push_subscriptions;
create policy "push owner" on public.push_subscriptions
  for select using (exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid()));

create or replace function public.subscribe_push(token text, sub jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare t public.trips%rowtype;
begin
  select * into t from public.trips where share_token = token and is_shared = true;
  if not found then raise exception 'Voyage introuvable'; end if;
  if sub->>'endpoint' is null or length(sub->>'endpoint') > 2000 then raise exception 'Abonnement invalide'; end if;
  insert into public.push_subscriptions (trip_id, endpoint, subscription)
  values (t.id, sub->>'endpoint', sub)
  on conflict (trip_id, endpoint) do update set subscription = excluded.subscription;
end; $$;

create or replace function public.unsubscribe_push(token text, p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions ps using public.trips t
  where ps.trip_id = t.id and t.share_token = token and ps.endpoint = p_endpoint;
end; $$;

grant execute on function public.subscribe_push(text, jsonb) to anon, authenticated;
grant execute on function public.unsubscribe_push(text, text) to anon, authenticated;

-- ---------- Stockage des photos / vidéos ----------
-- Bucket public en lecture (les proches voient les photos via le lien),
-- écriture réservée au propriétaire dans son propre dossier <user_id>/...

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "media public read" on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media owner write" on storage.objects;
create policy "media owner write" on storage.objects
  for insert with check (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "media owner update" on storage.objects;
create policy "media owner update" on storage.objects
  for update using (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "media owner delete" on storage.objects;
create policy "media owner delete" on storage.objects
  for delete using (bucket_id = 'media' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------- Bucket "voice" : messages vocaux des proches (sans compte) ----------
-- Séparé du bucket photos, limité à l'audio et à 5 Mo par fichier, dossier comments/<id du voyage>/
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', true, 5242880, array['audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/webm','audio/ogg','audio/mpeg','audio/wav'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice public read" on storage.objects;
create policy "voice public read" on storage.objects
  for select using (bucket_id = 'voice');

drop policy if exists "voice anon insert" on storage.objects;
create policy "voice anon insert" on storage.objects
  for insert with check (bucket_id = 'voice' and (storage.foldername(name))[1] = 'comments'
    and exists (select 1 from public.trips t where t.id::text = (storage.foldername(name))[2] and t.is_shared = true and t.allow_comments = true));

drop policy if exists "voice owner delete" on storage.objects;
create policy "voice owner delete" on storage.objects
  for delete using (bucket_id = 'voice' and (storage.foldername(name))[1] = 'comments'
    and exists (select 1 from public.trips t where t.id::text = (storage.foldername(name))[2] and t.user_id = auth.uid()));

-- ---------- Petit utilitaire : updated_at automatique ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists days_touch on public.days;
create trigger days_touch before update on public.days
  for each row execute function public.touch_updated_at();

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();

-- Fin ✔
