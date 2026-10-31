-- Countdown cloud sync: one JSON row per user.
-- Run once in Supabase → SQL Editor.

create table if not exists public.countdown_state (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.countdown_state enable row level security;

drop policy if exists "own row only" on public.countdown_state;
create policy "own row only" on public.countdown_state
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
