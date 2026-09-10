-- Shopping list — Supabase setup.
--
-- Paste this whole file into your Supabase project's SQL Editor and run it.
-- (Supabase dashboard -> SQL Editor -> New query -> paste -> Run.)

create table if not exists public.items (
  id          uuid    primary key,
  list_id     text    not null,
  text        text    not null default '',
  done        boolean not null default false,
  deleted     boolean not null default false,
  created_at  bigint  not null,   -- milliseconds since the epoch, set by the phone
  updated_at  bigint  not null    -- drives last-write-wins merging
);

create index if not exists items_list_id_idx on public.items (list_id);

alter table public.items enable row level security;


-- Access control
-- --------------
-- The anon key is public: it ships inside the app, so anyone who views the
-- source has it. The policy below therefore grants nothing on its own — a
-- request must ALSO send an `x-list-key` header matching the row's list_id.
-- That header is your shared list code, and the app sends it on every call.
--
-- Net effect: knowing the anon key is not enough. You need the list code too.

drop policy if exists "access rows matching the list key" on public.items;

create policy "access rows matching the list key"
  on public.items
  for all
  to anon
  using      (list_id = current_setting('request.headers', true)::json ->> 'x-list-key')
  with check (list_id = current_setting('request.headers', true)::json ->> 'x-list-key');


-- Housekeeping (optional)
-- -----------------------
-- Deleted items are kept as tombstones so the deletion can reach the other
-- phone. The app forgets them locally after 30 days; this clears the server
-- side. Run it whenever you feel like it, or schedule it with pg_cron.

-- delete from public.items
--  where deleted
--    and updated_at < (extract(epoch from now()) * 1000)::bigint - 30 * 24 * 60 * 60 * 1000;


-- Fallback
-- --------
-- If "Test connection" in the app reports 401/403 even though the key and list
-- code are right, your project may be stripping the custom header. In that
-- case swap the policy above for this looser one, which lets anyone holding
-- the anon key read every list. Only reasonable for a private hobby project.

-- drop policy if exists "access rows matching the list key" on public.items;
-- create policy "anon may read and write"
--   on public.items for all to anon using (true) with check (true);
