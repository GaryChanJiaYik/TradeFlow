-- TradeFlow — Step 1 Row Level Security
-- Every user-owned table is restricted to auth.uid() = user_id (or = id for
-- profiles). instruments is readable by any authenticated user; writes are
-- left to the service role only (the service role key bypasses RLS
-- entirely in Supabase, so no explicit write policy is needed for it — and
-- none is added for authenticated users, since Step 1 has no client-side
-- instrument writes).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert/delete policy for profiles: rows are created by the
-- handle_new_user trigger (security definer) and cascade-deleted with the
-- auth.users row, never directly by client code.

-- ---------------------------------------------------------------------------
-- instruments — readable by any authenticated user, writable only by the
-- service role (starting Step 2; unused in Step 1).
-- ---------------------------------------------------------------------------
alter table public.instruments enable row level security;

create policy "instruments_select_authenticated"
  on public.instruments for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- price_alerts
-- ---------------------------------------------------------------------------
alter table public.price_alerts enable row level security;

create policy "price_alerts_select_own"
  on public.price_alerts for select
  to authenticated
  using (auth.uid() = user_id);

create policy "price_alerts_insert_own"
  on public.price_alerts for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "price_alerts_update_own"
  on public.price_alerts for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "price_alerts_delete_own"
  on public.price_alerts for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- graph_reminders
-- ---------------------------------------------------------------------------
alter table public.graph_reminders enable row level security;

create policy "graph_reminders_select_own"
  on public.graph_reminders for select
  to authenticated
  using (auth.uid() = user_id);

create policy "graph_reminders_insert_own"
  on public.graph_reminders for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "graph_reminders_update_own"
  on public.graph_reminders for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "graph_reminders_delete_own"
  on public.graph_reminders for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;

create policy "devices_select_own"
  on public.devices for select
  to authenticated
  using (auth.uid() = user_id);

create policy "devices_insert_own"
  on public.devices for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "devices_update_own"
  on public.devices for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "devices_delete_own"
  on public.devices for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- notification_log — user can read their own log; writes happen via the
-- service role only (Step 2 notification dispatch), so no client insert/
-- update/delete policy is added.
-- ---------------------------------------------------------------------------
alter table public.notification_log enable row level security;

create policy "notification_log_select_own"
  on public.notification_log for select
  to authenticated
  using (auth.uid() = user_id);
