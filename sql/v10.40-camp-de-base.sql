-- ============================================================================
--  Bonvoyage v10.40 — « Notre camp de base » (sujet #38, premier lot)
--
--  Le camp de base, c'est l'endroit où l'on dort. Il n'est PAS un arrêt :
--  un arrêt appartient à une journée, alors qu'une nuit sert à DEUX journées —
--  elle ferme celle qui s'achève et ouvre celle qui suit. Et tant qu'on n'en
--  marque pas un autre, c'est le même qui vaut : trois nuits au même endroit,
--  un seul geste.
--
--  C'est pour cela qu'il sort des catégories d'arrêt (elles passent de onze à
--  dix) et devient un objet du voyage, dans sa table.
--
--  À exécuter dans Supabase → SQL Editor, APRÈS v10.8-arrets.sql.
--  Le script est rejouable : on peut le lancer deux fois sans casse.
--
--  ⚠️ Ce lot ne touche PAS get_shared_trip : les camps ne sont pas encore
--  renvoyés aux proches. C'est le lot suivant (v10.41) qui ouvre cette porte,
--  avec sa règle d'étanchéité (un camp ne sort que si une journée visible s'en
--  sert). La version de get_shared_trip qui fait foi reste celle de
--  v10.36-images.sql.
-- ============================================================================

-- ---------- La table ----------
-- Calquée sur day_stops pour les tampons et la sécurité, mais attachée au
-- VOYAGE et à une NUIT, pas à une journée.
--
-- night_date = la nuit qui suit la journée marquée. Elle peut précéder le
-- premier jour du voyage : c'est ainsi que se pose le point de départ (Paris),
-- sans journée fantôme et sans une ligne de code de plus.
--
-- user_id   = le propriétaire du voyage     }  posés par le trigger
-- author_id = qui a marqué ce camp          }  stamp_contribution, jamais par l'app
create table if not exists public.trip_camps (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  night_date date not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  author_id  uuid references auth.users(id) on delete set null,
  lat        double precision not null,
  lng        double precision not null,
  name       text not null default '',
  address    text not null default '',       -- l'adresse, quand OpenStreetMap la donne ou que Sophie l'écrit
  transport  text,                           -- le moyen pour PARTIR du camp ; comme media.transport, sans contrainte
  osm_type   text,                           -- 'node' | 'way' | 'relation', quand le lieu vient d'OpenStreetMap
  osm_id     bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trip_camps_trip_idx on public.trip_camps(trip_id, night_date);

-- UN SEUL camp par nuit. C'est cette ligne qui rend le doublon impossible par
-- construction plutôt que par vigilance — et c'est elle qui permet à la règle
-- de reconduction de ne jamais avoir à départager deux camps le même soir.
alter table public.trip_camps drop constraint if exists trip_camps_one_per_night;
alter table public.trip_camps add constraint trip_camps_one_per_night
  unique (trip_id, night_date);

-- ---------- Les deux tampons ----------
drop trigger if exists trip_camps_stamp on public.trip_camps;
create trigger trip_camps_stamp before insert or update on public.trip_camps
  for each row execute function public.stamp_contribution();

drop trigger if exists trip_camps_touch on public.trip_camps;
create trigger trip_camps_touch before update on public.trip_camps
  for each row execute function public.touch_updated_at();

-- ---------- Sécurité ----------
-- Mot pour mot la règle des arrêts : tout membre lit et marque ; on ne corrige
-- et n'efface que ce qu'on a soi-même ajouté, sauf le propriétaire du carnet.
-- Toujours par is_member / is_trip_owner : une politique qui interrogerait
-- trip_members directement s'appellerait elle-même.
alter table public.trip_camps enable row level security;
grant select, insert, update, delete on public.trip_camps to authenticated;

drop policy if exists "trip_camps read members"           on public.trip_camps;
drop policy if exists "trip_camps insert members"         on public.trip_camps;
drop policy if exists "trip_camps update author or owner" on public.trip_camps;
drop policy if exists "trip_camps delete author or owner" on public.trip_camps;
create policy "trip_camps read members" on public.trip_camps
  for select using (public.is_member(trip_id));
create policy "trip_camps insert members" on public.trip_camps
  for insert with check (public.is_member(trip_id));
create policy "trip_camps update author or owner" on public.trip_camps
  for update using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)))
  with check (public.is_member(trip_id));
create policy "trip_camps delete author or owner" on public.trip_camps
  for delete using (public.is_member(trip_id)
                    and (author_id = auth.uid() or public.is_trip_owner(trip_id)));

-- ---------- Un arrêt peut porter un changement de moyen ----------
-- Le cas qui l'exige : la photo 2 porte « voiture », le PARKING porte « à pied »,
-- la photo 3 suit. Sans cela, l'arc de voiture va jusqu'à la porte du musée.
-- Posée maintenant, lue par le tracé au lot suivant. Pas de contrainte : c'est
-- exactement ce que font déjà media.transport et days.transport.
alter table public.day_stops add column if not exists transport text;

-- ============================================================================
--  La reprise des arrêts « camp » déjà posés
--
--  ⚠️ Cet ordre n'est pas négociable : la contrainte à dix catégories REFUSE de
--  s'appliquer tant qu'une seule ligne porte encore 'camp'. Si des arrêts
--  « Notre camp de base » existent, ils deviennent donc de vrais camps AVANT,
--  et rien n'est perdu.
--
--  distinct on : s'il y en avait deux le même soir, on garde le premier du fil
--  (sort_order, puis date de création) — l'unicité par nuit l'exige.
-- ============================================================================
insert into public.trip_camps (trip_id, night_date, user_id, author_id, lat, lng, name, osm_type, osm_id)
select distinct on (s.trip_id, s.day_date)
       s.trip_id, s.day_date, s.user_id, s.author_id, s.lat, s.lng,
       coalesce(nullif(s.name, ''), 'Notre camp de base'), s.osm_type, s.osm_id
  from public.day_stops s
 where s.category = 'camp'
 order by s.trip_id, s.day_date, s.sort_order, s.created_at
    on conflict (trip_id, night_date) do nothing;

delete from public.day_stops where category = 'camp';

-- ---------- Les catégories passent de onze à dix ----------
-- Ce sont les mots de Sophie, et « Notre camp de base » n'en fait plus partie :
-- il a sa table. Ne pas en inventer une onzième.
alter table public.day_stops drop constraint if exists day_stops_category_chk;
alter table public.day_stops add constraint day_stops_category_chk
  check (category in ('monument', 'musee', 'parc', 'vue', 'resto',
                      'boutique', 'marche', 'attraction', 'streetart', 'autre'));

-- ============================================================================
--  Fin ✔
--  Vérification rapide, à coller dans le SQL Editor si tu veux voir le résultat :
--    select count(*) from public.trip_camps;
--    select count(*) from public.day_stops where category = 'camp';   -- doit valoir 0
-- ============================================================================
