---
name: shopping
description: Read and update the shared household shopping list — the same list the phone app shows. Use when asked to add something to the shopping list, see what's on it, tick something off, or clear out what's already been bought. Triggers on "shopping list", "add to the list", "what do we need", "we're out of X", "put X on the list".
---

# Shopping list

Reads and writes the household shopping list that both phones use. Changes made
here show up on the phones within about 20 seconds, and merge correctly even if
a phone was offline when you made them.

## Finding the script

`shopping.sh` sits next to this file. **Always invoke it by full path**, never
as `./shopping.sh` — this skill is usually active while the user has some
unrelated project open, so the working directory is rarely the skill directory.

Whichever of these exists is the one to use:

```bash
~/.claude/skills/shopping/shopping.sh     # installed for the whole machine
.claude/skills/shopping/shopping.sh       # only when the todo repo is open
```

The commands below are written as `shopping.sh` for brevity. Substitute the
full path when you actually run them.

## The one rule: act on ids, never on text

`list` returns every item with its `id`. Match what the user meant **yourself**,
from that output, then pass the `id` to the command. Do not try to make the
script search by name — it deliberately cannot.

This is what lets you handle "get rid of the milk" when the item is actually
"semi-skimmed milk", or a name in Hebrew, or a typo.

## Commands

```bash
shopping.sh list          # still to buy — JSON, includes ids
shopping.sh all           # also shows ticked-off and deleted items
shopping.sh add "Milk"    # add one item
shopping.sh done <id>     # tick off
shopping.sh undone <id>   # put back on the list
shopping.sh remove <id>   # delete
shopping.sh clear-done    # delete everything already ticked off
```

## How to use it

**Showing the list** — run `list` and render it as a readable list for the user,
not raw JSON. Mention the count. If it's empty, say so plainly.

**Adding** — one `add` per item. For "we need milk, eggs and bread" run it three
times. Check `list` first if there's any chance it's already there, and say so
rather than adding a duplicate.

**Ticking off or removing** — run `list`, find the item, use its id. If two
items could plausibly match, ask which they meant instead of guessing. If
nothing matches, say so rather than adding it.

**After changing anything**, briefly confirm what you did. No need to re-print
the whole list unless asked.

## Setup, once per Mac

The list code is the password to the list, so it lives in the keychain and
never in this repository:

```bash
security add-generic-password -U -s shopping-list -a "$USER" -w
```

Paste the shared code at the prompt and press return. Both people use the
identical code.

If the script reports no code in the keychain, show the user that command —
do not ask them to paste the code into the chat, and never write it into a
file in this repo.

## Overrides

| Variable | Purpose |
|---|---|
| `SHOPPING_KEYCHAIN_SERVICE` | keychain service name (default `shopping-list`) |
| `SHOPPING_KEYCHAIN_ACCOUNT` | keychain account (default `$USER`) |
| `SHOPPING_LIST_CODE` | use this code instead of the keychain — for testing |
| `SHOPPING_URL`, `SHOPPING_ANON_KEY` | point at a different Supabase project |

## Notes

- `remove` and `clear-done` write a "deleted" marker rather than dropping the
  row. That is deliberate: it is how the deletion reaches a phone that was
  offline. A real `DELETE` would let that phone re-upload its stale copy.
- Timestamps are milliseconds, matching the app, so edits from here merge with
  phone edits by the same last-write-wins rule.
