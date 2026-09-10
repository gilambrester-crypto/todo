-- Lock this database to a single shopping list.
--
-- WHY
-- The publishable key is public — it ships inside the app. The policy in
-- schema.sql checks that the x-list-key header matches the row's list_id,
-- which stops a stranger reading YOUR list, but it does not stop them
-- inventing a list of their own: send `x-list-key: anything` and insert rows
-- with list_id = 'anything', and the policy is satisfied. Your project then
-- hosts their data, on your quota.
--
-- This constraint closes that. Only one list_id may exist in the table, so
-- any row for a different list is rejected outright, whatever headers the
-- request carries.
--
-- HOW TO RUN
-- Paste into the Supabase SQL Editor, replace the placeholder below with your
-- real shared list code, and Run.
--
-- Keep the code out of this file when committing. It is the password to the
-- list, this repository is public, and git history is permanent.

alter table public.items
  drop constraint if exists items_single_list;

alter table public.items
  add constraint items_single_list
  check (list_id = 'PASTE-YOUR-LIST-CODE-HERE');


-- Optional extra: cap how much a single row can hold, so that someone who
-- does learn the code cannot quietly park megabytes in your project.

alter table public.items
  drop constraint if exists items_text_length;

alter table public.items
  add constraint items_text_length
  check (char_length(text) <= 200);


-- To rotate the list code later, run this file again with the new value.
-- Existing rows must already match, so change the code on both phones and
-- clear out the old list first:
--
--   delete from public.items where list_id = 'the-old-code';
