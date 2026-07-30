-- FitTrack — database schema.
-- Paste this whole file into the Supabase SQL Editor and run it once.
--
-- The app stores five JSON blobs (profile, days, food library, weight logs,
-- sleep logs). Rather than model each one as its own table, they live in a
-- single key/value table. That keeps the client trivially simple and means
-- adding a new tracked field later is a client-side change only.
--
-- `env` separates the live app from the dev build so testing can never touch
-- real data.

create table if not exists public.fittrack_state (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  env        text        not null check (env in ('live', 'dev')),
  key        text        not null,
  value      jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, env, key)
);

-- Row Level Security is what makes it safe to ship the anon key in a public
-- repo: every statement is scoped to the signed-in user's own rows.
alter table public.fittrack_state enable row level security;

drop policy if exists "users manage their own state" on public.fittrack_state;
create policy "users manage their own state"
  on public.fittrack_state
  for all
  to authenticated
  using      (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Push changes to other signed-in devices instead of making them poll.
-- Guarded so the whole file stays safe to re-run.
do $$
begin
  alter publication supabase_realtime add table public.fittrack_state;
exception
  when duplicate_object then null;
end
$$;

-- Realtime respects RLS, but only once the table is told to send old records
-- for the filter to match on deletes.
alter table public.fittrack_state replica identity full;
