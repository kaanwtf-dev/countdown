-- Countdown cloud sync: one JSON row per user.
-- Lives in the shared "Task Conquest" Supabase project; same logins work for both apps.

create table if not exists public.countdown_state (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.countdown_state enable row level security;

create policy "own row only" on public.countdown_state
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
