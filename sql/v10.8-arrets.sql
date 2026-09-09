-- ============================================================================
--  Bonvoyage v10.8 — les arrêts d'une journée (sujet #5)
--
--  Un arrêt, c'est un lieu qu'on a vécu : un musée, un restaurant, un point de
--  vue. Il se pose LE SOIR, dans la fiche de la journée — soit à partir d'un
--  groupe de photos, soit en touchant la carte. Il ne remplace rien : ni la
--  balise (qui dessine un chemin), ni la photo, ni le récit.
--
--  À exécuter dans Supabase → SQL Editor, APRÈS v10-carnet-a-plusieurs.sql.
--  Le script est rejouable : on peut le lancer deux fois sans casse.
-- ============================================================================

-- ---------- La table ----------
-- Calquée sur `media` (une chose posée sur la carte, à une date), et non sur
-- day_stories : il y a plusieurs arrêts par journée, donc aucune contrainte
-- d'unicité — et aucun plafond.
--
-- user_id  = le propriétaire du voyage        }  posés par le trigger
-- author_id = qui a ajouté cet arrêt          }  stamp_contribution, jamais par l'app
create table if not exists public.day_stops (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  day_date   date not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  author_id  uuid references auth.users(id) on delete set null,
  lat        double precision not null,
  lng        double precision not null,
  at_time    timestamptz,                       -- l'heure de la (première) photo ; vide s'il n'y en a pas
  name       text not null default '',
  category   text not null default 'autre',     -- une des onze catégories, voir plus bas
  note       text not null default '',
  media_ids  uuid[] not null default '{}',      -- les photos du groupe, quand l'arrêt vient d'elles
  osm_type   text,                              -- 'node' | 'way' | 'relation'
  osm_id     bigint,                            -- pour ne jamais reproposer un lieu déjà retenu
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists day_stops_trip_idx on public.day_stops(trip_id);
create index if not exists day_stops_day_idx  on public.day_stops(trip_id, day_date);

-- Les onze catégories, ce sont les mots de Sophie — pas un de plus.
-- « camp » = « Notre camp de base », là où on loge.
alter table public.day_stops drop constraint if exists day_stops_category_chk;
alter table public.day_stops add constraint day_stops_category_chk
  check (category in ('monument', 'musee', 'parc', 'vue', 'resto',
                      'boutique', 'marche', 'attraction', 'streetart', 'camp', 'autre'));

-- ---------- Les deux tampons ----------
-- stamp_contribution exige les colonnes user_id ET author_id : c'est pour ça
-- qu'elles sont toutes les deux là (day_stories, elle, n'a pas de user_id).
drop trigger if exists day_stops_stamp on public.day_stops;
create trigger day_stops_stamp before insert or update on public.day_stops
  for each row execute function public.stamp_contribution();

drop trigger if exists day_stops_touch on public.day_stops;
create trigger day_stops_touch before update on public.day_stops
  for each row execute function public.touch_updated_at();

-- ---------- Sécurité ----------
alter table public.day_stops enable row level security;
grant select, insert, update, delete on public.day_stops to authenticated;

-- Même règle que les photos : tout membre lit et pose ; on ne corrige et
-- n'efface que ce qu'on a soi-même ajouté, sauf le propriétaire du carnet.
-- (Toujours par is_member / is_trip_owner : une politique qui interrogerait
-- trip_members directement s'appellerait elle-même.)
drop policy if exists "day_stops read members"          on public.day_stops;
drop policy if exists "day_stops insert members"        on public.day_stops;
drop policy if exists "day_stops update author or owner" on public.day_stops;
drop policy if exists "day_stops delete author or owner" on public.day_stops;
create policy "day_stops read members" on public.day_stops
  for select using (public.is_member(trip_id));
create policy "day_stops insert members" on public.day_stops
  for insert with check (public.is_member(trip_id));
create policy "day_stops update author or owner" on public.day_stops
  for update using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.is_member(trip_id));
create policy "day_stops delete author or owner" on public.day_stops
  for delete using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)));

-- ============================================================================
--  La porte des proches : get_shared_trip renvoie désormais les arrêts.
--  Recopie intégrale de la version v10, avec la seule clé 'stops' en plus —
--  filtrée par `vis` comme tout le reste, sans quoi un arrêt d'une journée
--  encore en brouillon fuirait dans le carnet publié.
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
        'id', m.id, 'day_date', m.day_date, 'kind', m.kind, 'path', m.path, 'thumb_path', m.thumb_path,
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
