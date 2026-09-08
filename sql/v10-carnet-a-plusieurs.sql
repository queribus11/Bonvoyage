-- ============================================================================
--  Bonvoyage v10 — « le carnet à plusieurs » + liens de partage nominatifs
--  À coller dans : Supabase > SQL Editor > New query > Run
--  Sans risque, relançable autant de fois que nécessaire.
--
--  Ce script fait cinq choses :
--    1. il ouvre chaque voyage à plusieurs auteurs (table trip_members) ;
--    2. il signe chaque contribution (colonnes author_id) ;
--    3. il réécrit TOUTES les politiques de sécurité : « je suis membre de ce
--       voyage » remplace « je suis le propriétaire de la ligne » ;
--    4. il ajoute le mot du jour vocal et le carnet de bord privé ;
--    5. il ajoute les liens de partage nominatifs et révocables pour les proches.
--
--  ⚠️  Le point 3 est le seul endroit du projet où une erreur ferait fuiter un
--      carnet. Le plan de test à exécuter juste après est dans MISE-A-JOUR-v10.md.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
--  0. Petits utilitaires
-- ============================================================================

-- Convertit un segment de chemin en uuid sans jamais lever d'erreur (utilisé par
-- les politiques du bucket "media", où le chemin est du texte libre).
create or replace function public.uuid_or_null(s text)
returns uuid language plpgsql immutable as $$
begin return s::uuid; exception when others then return null; end;
$$;

-- ============================================================================
--  1. Les membres d'un voyage
-- ============================================================================

create table if not exists public.trip_members (
  trip_id          uuid not null references public.trips(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             text not null default 'author',    -- 'owner' | 'author'
  display_name     text not null default '',          -- le prénom affiché sur les pastilles
  color            text not null default '#0D8FE0',   -- couleur de la pastille
  comments_seen_at timestamptz not null default now(),-- badge « nouveaux commentaires », par personne
  activity_seen_at timestamptz not null default now(),-- badge « nouveautés des co-auteurs », par personne
  joined_at        timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create index if not exists trip_members_user_idx on public.trip_members(user_id);

-- « Suis-je membre de ce voyage ? » et « en suis-je le propriétaire ? »
-- security definer + stable : ces deux fonctions lisent les tables SANS repasser
-- par les politiques, ce qui évite toute récursion (une politique qui s'appelle
-- elle-même est l'erreur classique de ce genre de migration).
create or replace function public.is_member(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trip_members m
                 where m.trip_id = p_trip and m.user_id = auth.uid());
$$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.trips t
                 where t.id = p_trip and t.user_id = auth.uid());
$$;

grant execute on function public.is_member(uuid)     to authenticated;
grant execute on function public.is_trip_owner(uuid) to authenticated;

-- Les voyages qui existent déjà : leur propriétaire devient membre « owner ».
insert into public.trip_members (trip_id, user_id, role, display_name, comments_seen_at)
select t.id, t.user_id, 'owner',
       coalesce(split_part((select u.email from auth.users u where u.id = t.user_id), '@', 1), ''),
       t.comments_seen_at
from public.trips t
on conflict (trip_id, user_id) do nothing;

-- Tout nouveau voyage inscrit automatiquement son propriétaire comme membre.
create or replace function public.trips_add_owner_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (new.id, new.user_id, 'owner',
          coalesce(split_part((select u.email from auth.users u where u.id = new.user_id), '@', 1), ''))
  on conflict (trip_id, user_id) do nothing;
  return new;
end; $$;

drop trigger if exists trips_owner_member on public.trips;
create trigger trips_owner_member after insert on public.trips
  for each row execute function public.trips_add_owner_member();

-- Garde-fous : personne d'autre que le propriétaire ne change un rôle,
-- et le propriétaire ne peut pas se retirer lui-même du voyage.
create or replace function public.guard_member_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    if not public.is_trip_owner(new.trip_id) then
      new.role := old.role;                       -- un membre ne se promeut pas
      new.trip_id := old.trip_id;
      new.user_id := old.user_id;
    end if;
    return new;
  else
    -- Le « exists » est important : quand on supprime le voyage entier, la
    -- cascade passe ici alors que la ligne trips a déjà disparu — il ne faut
    -- pas bloquer la suppression du voyage.
    if old.role = 'owner' and exists (select 1 from public.trips where id = old.trip_id) then
      raise exception 'Le propriétaire du voyage ne peut pas être retiré des membres';
    end if;
    return old;
  end if;
end; $$;

drop trigger if exists trip_members_guard_upd on public.trip_members;
create trigger trip_members_guard_upd before update on public.trip_members
  for each row execute function public.guard_member_row();
drop trigger if exists trip_members_guard_del on public.trip_members;
create trigger trip_members_guard_del before delete on public.trip_members
  for each row execute function public.guard_member_row();

-- ============================================================================
--  2. La signature des contributions
-- ============================================================================
-- Règle de lecture des deux colonnes, à garder en tête pour tout le reste :
--   user_id   = le PROPRIÉTAIRE du voyage (inchangé : tout le code v9 continue de marcher)
--   author_id = QUI a ajouté cette ligne  (nouveau : c'est lui qui peut la modifier)

alter table public.days     add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.tracks   add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.media    add column if not exists author_id uuid references auth.users(id) on delete set null;
alter table public.comments add column if not exists author_id uuid references auth.users(id) on delete set null;

-- Les lignes déjà en base sont signées par le propriétaire du voyage.
update public.days   set author_id = user_id where author_id is null;
update public.tracks set author_id = user_id where author_id is null;
update public.media  set author_id = user_id where author_id is null;

create index if not exists days_author_idx   on public.days(author_id);
create index if not exists media_author_idx  on public.media(author_id);
create index if not exists tracks_author_idx on public.tracks(author_id);

-- Le tampon : l'app n'a plus à envoyer user_id ni author_id, la base les pose
-- elle-même — et interdit de les changer après coup.
create or replace function public.stamp_contribution()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if TG_OP = 'INSERT' then
    select t.user_id into v_owner from public.trips t where t.id = new.trip_id;
    new.user_id   := v_owner;
    new.author_id := coalesce(auth.uid(), new.author_id, v_owner);
  else
    new.user_id   := old.user_id;
    new.author_id := old.author_id;
  end if;
  return new;
end; $$;

drop trigger if exists days_stamp   on public.days;
drop trigger if exists tracks_stamp on public.tracks;
drop trigger if exists media_stamp  on public.media;
create trigger days_stamp   before insert or update on public.days   for each row execute function public.stamp_contribution();
create trigger tracks_stamp before insert or update on public.tracks for each row execute function public.stamp_contribution();
create trigger media_stamp  before insert or update on public.media  for each row execute function public.stamp_contribution();

-- Le commentaire laissé depuis l'app est signé ; celui d'un proche sans compte
-- garde author_id à null (auth.uid() vaut null pour un visiteur anonyme).
create or replace function public.stamp_comment_author()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then new.author_id := auth.uid();
  else new.author_id := old.author_id; end if;
  return new;
end; $$;

drop trigger if exists comments_stamp on public.comments;
create trigger comments_stamp before insert or update on public.comments
  for each row execute function public.stamp_comment_author();

-- ============================================================================
--  3. Les contributions personnelles à une journée
-- ============================================================================
-- Trois tables sur le même modèle, et la même règle : une ligne par personne et
-- par journée, chacun n'écrit et n'efface que la sienne.
--
--   day_stories → le récit écrit d'un CO-AUTEUR.
--       Le récit de la personne qui a créé la journée reste, lui, dans
--       days.story : rien ne bouge pour un carnet écrit à une seule main, et
--       c'est ce qui garantit qu'un voyage en solo est identique à la v9.
--   day_notes   → le carnet de bord privé, un mot par personne, jamais renvoyé
--       aux proches.
--   day_voices  → le mot du jour vocal, trente secondes.

create table if not exists public.day_stories (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  day_id     uuid not null references public.days(id) on delete cascade,
  day_date   date not null,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_id, author_id)
);
create index if not exists day_stories_trip_idx on public.day_stories(trip_id);

create table if not exists public.day_notes (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  day_id     uuid not null references public.days(id) on delete cascade,
  day_date   date not null,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (day_id, author_id)
);
create index if not exists day_notes_trip_idx on public.day_notes(trip_id);

drop trigger if exists day_stories_touch on public.day_stories;
create trigger day_stories_touch before update on public.day_stories
  for each row execute function public.touch_updated_at();
drop trigger if exists day_notes_touch on public.day_notes;
create trigger day_notes_touch before update on public.day_notes
  for each row execute function public.touch_updated_at();

create table if not exists public.day_voices (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  day_id     uuid not null references public.days(id) on delete cascade,
  day_date   date not null,
  author_id  uuid not null references auth.users(id) on delete cascade,
  audio_path text not null,
  seconds    integer not null default 0,
  created_at timestamptz not null default now(),
  unique (day_id, author_id)
);
create index if not exists day_voices_trip_idx on public.day_voices(trip_id);

-- ============================================================================
--  4. Inviter un co-auteur : un lien nominatif, à usage unique
-- ============================================================================

create table if not exists public.trip_invites (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  token       text unique not null default encode(gen_random_bytes(16), 'hex'),
  label       text not null default '',              -- « Paul », « Mamie »…
  role        text not null default 'author',
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '30 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked     boolean not null default false
);
create index if not exists trip_invites_trip_idx on public.trip_invites(trip_id);

-- Ce que voit l'invité avant de créer son compte : le titre du voyage et son
-- prénom. Rien d'autre ne sort de la base tant qu'il n'a pas rejoint.
create or replace function public.peek_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.trip_invites%rowtype; t public.trips%rowtype;
begin
  select * into i from public.trip_invites where token = p_token;
  if not found       then return jsonb_build_object('valid', false, 'reason', 'inconnue'); end if;
  if i.revoked       then return jsonb_build_object('valid', false, 'reason', 'annulée'); end if;
  if i.accepted_at is not null then return jsonb_build_object('valid', false, 'reason', 'déjà utilisée'); end if;
  if i.expires_at < now()      then return jsonb_build_object('valid', false, 'reason', 'expirée'); end if;
  select * into t from public.trips where id = i.trip_id;
  return jsonb_build_object(
    'valid', true, 'label', i.label,
    'trip_title', t.title, 'trip_subtitle', coalesce(t.subtitle, ''),
    'inviter', coalesce((select m.display_name from public.trip_members m
                         where m.trip_id = t.id and m.user_id = t.user_id), ''));
end; $$;

-- Cas d'une personne DÉJÀ connectée (elle a un compte Bonvoyage) : elle rejoint
-- sans passer par la fonction Edge.
create or replace function public.accept_invite(p_token text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i public.trip_invites%rowtype; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Connexion requise'; end if;
  select * into i from public.trip_invites where token = p_token for update;
  if not found or i.revoked or i.accepted_at is not null or i.expires_at < now() then
    raise exception 'Invitation invalide, déjà utilisée ou expirée';
  end if;
  insert into public.trip_members (trip_id, user_id, role, display_name)
  values (i.trip_id, uid, i.role,
          coalesce(nullif(trim(coalesce(p_display_name, '')), ''), nullif(i.label, ''),
                   split_part((select u.email from auth.users u where u.id = uid), '@', 1)))
  on conflict (trip_id, user_id) do nothing;
  update public.trip_invites set accepted_at = now(), accepted_by = uid where id = i.id;
  return jsonb_build_object('trip_id', i.trip_id);
end; $$;

grant execute on function public.peek_invite(text)          to anon, authenticated;
grant execute on function public.accept_invite(text, text)  to authenticated;

-- ============================================================================
--  5. Les liens de partage nominatifs et révocables (pour les proches)
-- ============================================================================
-- Un lien par personne. Le lien général de la v9 (trips.share_token) continue de
-- fonctionner à l'identique : les liens déjà envoyés ne cassent pas.

create table if not exists public.share_links (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  token        text unique not null default encode(gen_random_bytes(12), 'hex'),
  label        text not null default '',        -- « Mamie », « Paul »…
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  opens        integer not null default 0
);
create index if not exists share_links_trip_idx  on public.share_links(trip_id);
create index if not exists share_links_token_idx on public.share_links(token);

-- Résout un jeton — nominatif OU général — vers un voyage.
-- p_stamp = true : on note l'ouverture (une seule fois, à l'ouverture de la page).
create or replace function public.trip_for_token(p_token text, p_stamp boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_trip uuid;
begin
  select l.trip_id into v_trip
  from public.share_links l join public.trips t on t.id = l.trip_id
  where l.token = p_token and l.is_active = true and t.is_shared = true;

  if found then
    if p_stamp then
      update public.share_links
         set opens = opens + 1, last_seen_at = now()
       where token = p_token;
    end if;
    return v_trip;
  end if;

  select t.id into v_trip from public.trips t
   where t.share_token = p_token and t.is_shared = true;
  return v_trip;   -- null si le jeton ne vaut rien
end; $$;

grant execute on function public.trip_for_token(text, boolean) to anon, authenticated;

-- ============================================================================
--  6. Sécurité (RLS) — le cœur de la migration
-- ============================================================================

alter table public.trips              enable row level security;
alter table public.days               enable row level security;
alter table public.tracks             enable row level security;
alter table public.media              enable row level security;
alter table public.comments           enable row level security;
alter table public.trip_members       enable row level security;
alter table public.trip_invites       enable row level security;
alter table public.day_stories        enable row level security;
alter table public.day_notes          enable row level security;
alter table public.day_voices         enable row level security;
alter table public.share_links        enable row level security;
alter table public.push_subscriptions enable row level security;

grant select, insert, update, delete on public.trip_members, public.trip_invites,
      public.day_stories, public.day_notes, public.day_voices, public.share_links to authenticated;

-- ---------- trips ----------
-- Lecture : tout membre. Écriture et suppression : le propriétaire seul.
-- Le « auth.uid() = user_id » du select n'est pas redondant : au moment où un
-- voyage vient d'être créé, la ligne de membre n'existe pas encore quand
-- PostgREST renvoie la ligne insérée.
drop policy if exists "trips owner"         on public.trips;
drop policy if exists "trips read members"  on public.trips;
drop policy if exists "trips insert own"    on public.trips;
drop policy if exists "trips update owner"  on public.trips;
drop policy if exists "trips delete owner"  on public.trips;
create policy "trips read members" on public.trips
  for select using (auth.uid() = user_id or public.is_member(id));
create policy "trips insert own" on public.trips
  for insert with check (auth.uid() = user_id);
create policy "trips update owner" on public.trips
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "trips delete owner" on public.trips
  for delete using (auth.uid() = user_id);

-- ---------- days ----------
-- Règle de Sophie, à la lettre : chacun ne modifie que ce qu'il a lui-même
-- ajouté — et elle, propriétaire du carnet, peut tout corriger.
-- Une journée appartient donc à qui l'a créée : son titre, son récit, son
-- audio, son lieu, sa publication. Les autres n'y ajoutent pas en écrasant :
-- ils ajoutent À CÔTÉ, chacun avec sa ligne (day_stories, day_notes,
-- day_voices, media, tracks). C'est le chœur, sans que personne ne puisse
-- effacer le souvenir d'un autre par maladresse.
drop policy if exists "days owner"                on public.days;
drop policy if exists "days read members"         on public.days;
drop policy if exists "days insert members"       on public.days;
drop policy if exists "days update members"       on public.days;
drop policy if exists "days update author or owner" on public.days;
drop policy if exists "days delete author or owner" on public.days;
create policy "days read members" on public.days
  for select using (public.is_member(trip_id));
create policy "days insert members" on public.days
  for insert with check (public.is_member(trip_id));
create policy "days update author or owner" on public.days
  for update using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.is_member(trip_id));
create policy "days delete author or owner" on public.days
  for delete using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)));

-- ---------- tracks ----------
drop policy if exists "tracks owner"                on public.tracks;
drop policy if exists "tracks read members"         on public.tracks;
drop policy if exists "tracks insert members"       on public.tracks;
drop policy if exists "tracks update author or owner" on public.tracks;
drop policy if exists "tracks delete author or owner" on public.tracks;
create policy "tracks read members" on public.tracks
  for select using (public.is_member(trip_id));
create policy "tracks insert members" on public.tracks
  for insert with check (public.is_member(trip_id));
create policy "tracks update author or owner" on public.tracks
  for update using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.is_member(trip_id));
create policy "tracks delete author or owner" on public.tracks
  for delete using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)));

-- ---------- media ----------
drop policy if exists "media owner"                on public.media;
drop policy if exists "media read members"         on public.media;
drop policy if exists "media insert members"       on public.media;
drop policy if exists "media update author or owner" on public.media;
drop policy if exists "media delete author or owner" on public.media;
create policy "media read members" on public.media
  for select using (public.is_member(trip_id));
create policy "media insert members" on public.media
  for insert with check (public.is_member(trip_id));
create policy "media update author or owner" on public.media
  for update using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.is_member(trip_id));
create policy "media delete author or owner" on public.media
  for delete using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)));

-- ---------- comments ----------
-- Tout membre lit et répond ; on ne supprime que ses propres mots, sauf le
-- propriétaire qui modère tout (y compris les messages des proches).
drop policy if exists "comments owner"                on public.comments;
drop policy if exists "comments read members"         on public.comments;
drop policy if exists "comments insert members"       on public.comments;
drop policy if exists "comments update owner"         on public.comments;
drop policy if exists "comments delete author or owner" on public.comments;
create policy "comments read members" on public.comments
  for select using (public.is_member(trip_id));
create policy "comments insert members" on public.comments
  for insert with check (public.is_member(trip_id));
create policy "comments update owner" on public.comments
  for update using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));
create policy "comments delete author or owner" on public.comments
  for delete using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)));

-- ---------- trip_members ----------
-- Chacun voit la liste des compagnons de ses voyages, change SON prénom et SA
-- pastille, et peut quitter le voyage. Le propriétaire ajoute et retire.
drop policy if exists "members read"   on public.trip_members;
drop policy if exists "members insert" on public.trip_members;
drop policy if exists "members update" on public.trip_members;
drop policy if exists "members delete" on public.trip_members;
create policy "members read" on public.trip_members
  for select using (public.is_member(trip_id));
create policy "members insert" on public.trip_members
  for insert with check (public.is_trip_owner(trip_id));
create policy "members update" on public.trip_members
  for update using (public.is_trip_owner(trip_id) or user_id = auth.uid())
  with check (public.is_trip_owner(trip_id) or user_id = auth.uid());
create policy "members delete" on public.trip_members
  for delete using (public.is_trip_owner(trip_id) or user_id = auth.uid());

-- ---------- trip_invites ----------
drop policy if exists "invites owner" on public.trip_invites;
create policy "invites owner" on public.trip_invites
  for all using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

-- ---------- share_links ----------
drop policy if exists "share links owner" on public.share_links;
create policy "share links owner" on public.share_links
  for all using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

-- ---------- day_stories · day_notes · day_voices ----------
-- Les trois contributions personnelles, exactement la même règle : tout membre
-- lit tout le monde, chacun n'écrit que sa propre ligne et n'efface que la
-- sienne — le propriétaire pouvant faire le ménage.
do $$
declare tbl text;
begin
  foreach tbl in array array['day_stories', 'day_notes', 'day_voices'] loop
    execute format('drop policy if exists "%s read"   on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s insert" on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s update" on public.%I', tbl, tbl);
    execute format('drop policy if exists "%s delete" on public.%I', tbl, tbl);
    execute format('create policy "%s read" on public.%I for select using (public.is_member(trip_id))', tbl, tbl);
    execute format('create policy "%s insert" on public.%I for insert with check (public.is_member(trip_id) and author_id = auth.uid())', tbl, tbl);
    execute format('create policy "%s update" on public.%I for update using (author_id = auth.uid()) with check (author_id = auth.uid())', tbl, tbl);
    execute format('create policy "%s delete" on public.%I for delete using (author_id = auth.uid() or public.is_trip_owner(trip_id))', tbl, tbl);
  end loop;
end $$;
-- Anciennes politiques de la première écriture de la v10, si elle a été jouée
drop policy if exists "voices read"   on public.day_voices;
drop policy if exists "voices insert" on public.day_voices;
drop policy if exists "voices update" on public.day_voices;
drop policy if exists "voices delete" on public.day_voices;

-- ---------- push_subscriptions ----------
drop policy if exists "push owner" on public.push_subscriptions;
create policy "push owner" on public.push_subscriptions
  for select using (public.is_member(trip_id));

-- ============================================================================
--  7. Stockage — le point d'attention du brief
-- ============================================================================
-- Chaque auteur continue d'écrire dans SON dossier : <user_id>/<trip_id>/…
-- La nouveauté est la deuxième condition : ce dossier doit correspondre à un
-- voyage dont on est membre. Et le propriétaire du voyage peut faire le ménage
-- dans les fichiers de ses co-auteurs (sinon il ne pourrait pas retirer une photo).

insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "media public read"  on storage.objects;
create policy "media public read" on storage.objects
  for select using (bucket_id = 'media');

drop policy if exists "media owner write"  on storage.objects;
drop policy if exists "media owner update" on storage.objects;
drop policy if exists "media owner delete" on storage.objects;
drop policy if exists "media member write"  on storage.objects;
drop policy if exists "media member update" on storage.objects;
drop policy if exists "media member delete" on storage.objects;

create policy "media member write" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and auth.uid()::text = (storage.foldername(name))[1]
    and public.is_member(public.uuid_or_null((storage.foldername(name))[2]))
  );

create policy "media member update" on storage.objects
  for update using (
    bucket_id = 'media'
    and (auth.uid()::text = (storage.foldername(name))[1]
         or public.is_trip_owner(public.uuid_or_null((storage.foldername(name))[2])))
  );

create policy "media member delete" on storage.objects
  for delete using (
    bucket_id = 'media'
    and (auth.uid()::text = (storage.foldername(name))[1]
         or public.is_trip_owner(public.uuid_or_null((storage.foldername(name))[2])))
  );

-- Bucket "voice" (messages vocaux des proches sans compte) : inchangé côté
-- dépôt, la suppression reste au propriétaire du voyage — c'est de la modération.
drop policy if exists "voice anon insert" on storage.objects;
create policy "voice anon insert" on storage.objects
  for insert with check (bucket_id = 'voice' and (storage.foldername(name))[1] = 'comments'
    and exists (select 1 from public.trips t
                where t.id::text = (storage.foldername(name))[2]
                  and t.is_shared = true and t.allow_comments = true));

-- ============================================================================
--  8. La page des proches — à deux voix, et avec les liens nominatifs
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
  -- voix et commentaires) sont visibles.
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

-- Les trois autres portes des proches acceptent désormais un lien nominatif.
drop function if exists public.add_shared_comment(text, uuid, uuid, text, text);
create or replace function public.add_shared_comment(token text, p_media_id uuid, p_day_id uuid, p_author text, p_body text, p_audio_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.trips%rowtype;
  v_trip uuid;
  c public.comments%rowtype;
begin
  v_trip := public.trip_for_token(token, false);
  if v_trip is null then raise exception 'Voyage introuvable'; end if;
  select * into t from public.trips where id = v_trip and allow_comments = true;
  if not found then raise exception 'Commentaires désactivés'; end if;
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

create or replace function public.subscribe_push(token text, sub jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid;
begin
  v_trip := public.trip_for_token(token, false);
  if v_trip is null then raise exception 'Voyage introuvable'; end if;
  if sub->>'endpoint' is null or length(sub->>'endpoint') > 2000 then raise exception 'Abonnement invalide'; end if;
  insert into public.push_subscriptions (trip_id, endpoint, subscription)
  values (v_trip, sub->>'endpoint', sub)
  on conflict (trip_id, endpoint) do update set subscription = excluded.subscription;
end; $$;

create or replace function public.unsubscribe_push(token text, p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid;
begin
  v_trip := public.trip_for_token(token, false);
  if v_trip is null then return; end if;
  delete from public.push_subscriptions where trip_id = v_trip and endpoint = p_endpoint;
end; $$;

grant execute on function public.get_shared_trip(text) to anon, authenticated;
grant execute on function public.add_shared_comment(text, uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.subscribe_push(text, jsonb) to anon, authenticated;
grant execute on function public.unsubscribe_push(text, text) to anon, authenticated;

-- ============================================================================
--  Fin ✔   Enchaîner avec le plan de test de MISE-A-JOUR-v10.md, §« Étanchéité ».
-- ============================================================================
