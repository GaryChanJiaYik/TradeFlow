-- TradeFlow — Step 1 schema
-- See handoff/ARCHITECT-BRIEF.md ("Step 1 — Decisions") for the source of these
-- table/column choices. Enums are expressed as CHECK constraints so they stay
-- in lockstep with the literal-union types in packages/types and the zod
-- schemas in packages/validation without needing ALTER TYPE migrations later.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — 1:1 metadata for a Supabase auth user. auth.users is the source
-- of truth for identity/credentials; we never create our own users table.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();

-- Auto-provision a profile row whenever a new Supabase auth user is created,
-- so the app never has to remember to do it (and RLS on profiles always has
-- a matching row to enforce against).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- instruments — tradable symbols. last_price/last_price_at hold the most
-- recent tick and serve as the "previous price" input for alert-engine
-- crossing comparisons (Step 2 writes them). No separate price-ticks table
-- for V1.
-- ---------------------------------------------------------------------------
create table public.instruments (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  name text not null,
  asset_type text not null check (asset_type in ('metal', 'forex', 'index', 'crypto')),
  enabled boolean not null default true,
  last_price numeric,
  last_price_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.instruments (symbol, name, asset_type, enabled)
values ('XAUUSD', 'Gold', 'metal', true);

-- ---------------------------------------------------------------------------
-- price_alerts
-- ---------------------------------------------------------------------------
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.instruments (id) on delete restrict,
  target_price numeric not null check (target_price > 0),
  direction text not null check (direction in ('CROSS_UP', 'CROSS_DOWN', 'CROSS_BOTH')),
  trigger_mode text not null check (trigger_mode in ('ONCE', 'EVERY_TIME')),
  expiration_at timestamptz,
  message text,
  enabled boolean not null default true,
  last_triggered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index price_alerts_user_id_idx on public.price_alerts (user_id);
create index price_alerts_instrument_id_idx on public.price_alerts (instrument_id);

create trigger price_alerts_set_updated_at
  before update on public.price_alerts
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- graph_reminders
-- ---------------------------------------------------------------------------
create table public.graph_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  instrument_id uuid not null references public.instruments (id) on delete restrict,
  timeframe text not null check (timeframe in ('15m', '1H', '4H', '1D')),
  description text,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  next_trigger_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index graph_reminders_user_id_idx on public.graph_reminders (user_id);
create index graph_reminders_instrument_id_idx on public.graph_reminders (instrument_id);

create trigger graph_reminders_set_updated_at
  before update on public.graph_reminders
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- devices — subscription will hold a Web Push PushSubscription JSON object
-- starting Step 2 (not an FCM/Expo token).
-- ---------------------------------------------------------------------------
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('web', 'ios', 'android')),
  subscription jsonb,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index devices_user_id_idx on public.devices (user_id);

create trigger devices_set_updated_at
  before update on public.devices
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_log
-- ---------------------------------------------------------------------------
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid references public.devices (id) on delete set null,
  event_type text not null check (event_type in ('PRICE_ALERT', 'GRAPH_REMINDER')),
  title text not null,
  message text not null,
  status text not null check (status in ('SENT', 'FAILED', 'PENDING')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_log_user_id_idx on public.notification_log (user_id);
create index notification_log_device_id_idx on public.notification_log (device_id);
