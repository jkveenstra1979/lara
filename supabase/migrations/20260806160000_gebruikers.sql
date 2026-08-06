-- LARA Areas — gebruikers en rollen
--
-- Twee rollen, één verschil: een `admin` beheert gebruikers, een `user` niet.
-- Aan de gegevens zelf — importeren, selecteren, nummeren, exporteren — mag
-- iedereen die is ingelogd evenveel doen. Dat blijft zoals het was.
--
-- Dit vervangt de eerdere keuze "geen rollenstelsel". De aanleiding is
-- praktisch: iemand moet accounts kunnen aanmaken zonder in het Supabase-
-- dashboard te hoeven.

create type public.gebruiker_rol as enum ('admin', 'user');

create table public.gebruikers (
  -- on delete cascade: een account verwijderen verwijdert het profiel mee.
  -- Er hangt geen geschiedenis aan die bewaard moet blijven; wie wat heeft
  -- geïmporteerd staat als losse uuid in datasets.uploaded_by.
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  naam       text,
  rol        public.gebruiker_rol not null default 'user',
  created_at timestamptz not null default now(),
  last_seen  timestamptz
);

-- ------------------------------------------------------------- koppeling ----

-- Een account in auth.users krijgt automatisch een profiel. Zonder deze trigger
-- zou een gebruiker die via het dashboard is aangemaakt nergens in de
-- applicatie bestaan.
create or replace function public.nieuwe_gebruiker()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.gebruikers (id, email, naam)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'naam', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger op_nieuwe_auth_gebruiker
  after insert on auth.users
  for each row execute function public.nieuwe_gebruiker();

-- Bestaande accounts inhalen. De eerste gebruiker wordt admin: anders kan
-- niemand ooit een tweede admin aanwijzen.
insert into public.gebruikers (id, email, created_at)
select id, email, created_at from auth.users
on conflict (id) do nothing;

update public.gebruikers
set rol = 'admin'
where id = (select id from public.gebruikers order by created_at limit 1);

-- ---------------------------------------------------------------- rechten ----

-- SECURITY DEFINER omdat de policies op public.gebruikers deze functie zelf
-- aanroepen; zonder definer geeft dat een lus.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gebruikers
    where id = auth.uid() and rol = 'admin'
  );
$$;

alter table public.gebruikers enable row level security;

-- Iedereen die is ingelogd ziet wie er nog meer zijn. Dat is geen geheim en het
-- scheelt een aparte weergave voor "wie heeft dit geïmporteerd".
create policy "ingelogd mag gebruikers zien"
  on public.gebruikers for select to authenticated
  using (true);

-- Je eigen naam bijwerken mag altijd; je eigen rol niet — anders kan iedereen
-- zichzelf tot admin maken. Dat wordt afgedwongen met een aparte controle.
create policy "eigen profiel bijwerken"
  on public.gebruikers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and rol = (select rol from public.gebruikers where id = auth.uid()));

create policy "admin mag gebruikers beheren"
  on public.gebruikers for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "admin mag gebruikers verwijderen"
  on public.gebruikers for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

grant select, update on public.gebruikers to authenticated;

comment on table public.gebruikers is
  'Profiel bij een account in auth.users. Twee rollen: admin beheert gebruikers, user niet. Aan de luchtruimgegevens mag iedereen evenveel doen.';

-- ------------------------------------------------------------ uitnodigen ----

-- Uitnodigen zonder e-mailserver: de beheerder maakt een uitnodiging aan en
-- stuurt de link zelf door. Patroon overgenomen uit AeroDB-Feature-Handbook,
-- waar dezelfde afweging speelde.
--
-- Het account ontstaat pas bij het accepteren. Een uitnodiging die blijft
-- liggen levert dus geen half account op, en je ziet in de lijst wie er nog
-- moet reageren.
create table public.uitnodigingen (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  rol        public.gebruiker_rol not null default 'user',
  naam       text,
  -- 64 hex-tekens uit twee uuids. Niet te raden, en anders dan
  -- gen_random_bytes() heeft dit geen pgcrypto nodig — gen_random_uuid() zit
  -- sinds Postgres 13 in de kern, dus de migratie draait overal gelijk.
  token      text not null unique
             default replace(gen_random_uuid()::text, '-', '') ||
                     replace(gen_random_uuid()::text, '-', ''),
  invited_by uuid references public.gebruikers (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index uitnodigingen_email_idx on public.uitnodigingen (email);
create index uitnodigingen_token_idx on public.uitnodigingen (token);

alter table public.uitnodigingen enable row level security;

-- Alleen een beheerder ziet en beheert uitnodigingen. Het accepteren gebeurt
-- met de service-role-sleutel, want de ontvanger is per definitie nog niet
-- ingelogd — die kan hier dus niets.
create policy "admin beheert uitnodigingen"
  on public.uitnodigingen for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.uitnodigingen to authenticated;

comment on table public.uitnodigingen is
  'Uitnodiging met een token; de beheerder stuurt de link zelf door. Er is geen SMTP gekoppeld. Het account ontstaat pas bij accepteren.';
