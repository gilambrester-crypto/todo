# Shopping List

A shared shopping list for two phones that keeps working with no signal.

Everything you type is saved on the phone **first**, so the app is instant and
fully usable in airplane mode, in a basement supermarket, or on a plane. When a
phone next gets signal it quietly reconciles with the other one. Nobody has to
press "sync", and neither phone is "the main one".

- Add, rename, tick off and delete items
- Ticked items drop into an "In the basket" section you can clear in one tap
- Installs to the home screen like a normal app
- No accounts, no login, no ads
- About 700 lines of plain HTML, CSS and JavaScript — no build step, no framework

---

## 1. Try it right now

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. It works immediately, saving to that browser only.
Sharing between phones is step 3.

## 2. Put it on the web

The phones need a URL to load the app from. Any static host works; GitHub Pages
is free and this repo is already set up for it:

1. Push this branch to GitHub.
2. Repo **Settings → Pages → Source → GitHub Actions**.
3. The included workflow publishes on every push to the default branch.

Your app lands at `https://<your-username>.github.io/<repo>/`.

> It must be served over **https** (or `localhost`). Phones refuse to install a
> home-screen app or run a service worker over plain http, so offline mode would
> silently not work.

## 3. Turn on sharing

This is the only fiddly part, and you only do it once.

**a. Make a free Supabase project** at <https://supabase.com> — no card needed.

**b. Create the table.** In your project: **SQL Editor → New query**. Paste the
whole of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.

**c. Pick a shared list code.** Any long random string. Both phones must use the
identical one. Generate a good one with:

```bash
node -e "console.log(crypto.randomUUID())"
```

**d. Fill in the settings.** In Supabase, **Project Settings → API** gives you
the **Project URL** and the publishable (anon) key. These two go in
[`config.js`](config.js) and can be committed safely — see below.

**The list code does not go in `config.js`.** Type it into the app's ⚙ Settings
screen on each phone instead. It stays in that phone's local storage and never
reaches the repository.

Tap **Test connection** to confirm it worked before you rely on it.

## 4. Install on both phones

Open the URL on each phone, then:

- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*

Launch it from the home-screen icon at least once while online, so the app files
get cached. After that it opens with no signal at all.

---

## How the offline sync works

Each item carries a timestamp and a "deleted" marker rather than being removed
outright. When two phones reconnect:

- the newer edit to an item wins;
- if both edited in the same millisecond, both phones compare the item's
  contents using the identical rule, so they independently reach the same
  answer;
- deletions travel as tombstones, so a deleted item can't be resurrected by the
  other phone's stale copy;
- whichever phone holds the agreed winner re-uploads it, so the two can never
  settle into permanently disagreeing.

The practical upshot: you can both shop offline in different aisles and nothing
gets lost. The one genuinely ambiguous case — you rename an item to one thing
while your husband renames it to another, in the same instant — resolves to one
of the two names on both phones rather than silently splitting into two lists.

## A note on privacy

The list code is what protects your list, so it is worth being precise about
which values are secret and which are not:

| Value | Safe to commit? | Why |
|---|---|---|
| Project URL | Yes | Every request the app makes reveals it. |
| Publishable / anon key | Yes | Built to ship in browsers. Alone it grants nothing. |
| **List code** | **No** | The policy in `schema.sql` checks it, so it *is* the password. |

Serving this app from GitHub Pages for free means the repository is public, so
anything committed is readable by anyone who finds it. Keep the list code out
of `config.js` and put it in each phone's Settings screen. Make it long and
random — `node -e "console.log(crypto.randomUUID())"` — rather than a word you
invent.

**If a list code ever does get committed, changing the file is not enough.** Git
keeps history, so the old code stays readable in the repo forever. Pick a new
code, enter it on both phones, and clear out the old list in Supabase:

```sql
delete from public.items where list_id = 'the-old-code';
```

There is no password reset. If you both forget the code, the list is
unreachable; just pick a new one.

## Adding things from your Mac

There is a Claude Code skill in `.claude/skills/shopping/` that reads and writes
the same list, so you can say "put milk on the shopping list" in a terminal and
have it appear on both phones.

Set it up once per Mac by putting the shared code in the keychain:

```bash
security add-generic-password -U -s shopping-list -a "$USER" -w
```

Paste the code at the prompt. The skill reads it from there, so the code stays
out of this repository.

To use it from any directory rather than just this repo, copy the folder:

```bash
cp -R .claude/skills/shopping ~/.claude/skills/
```

The script works on its own too:

```bash
.claude/skills/shopping/shopping.sh list
.claude/skills/shopping/shopping.sh add "Olive oil"
```

## Locking the database to one list

`supabase/schema.sql` stops a stranger reading your list, but not from creating
a list of their own in your project — the publishable key is public, and the
policy only checks that the header matches the row. `supabase/lock-to-one-list.sql`
closes that with a constraint pinning `list_id` to a single value. Run it once,
substituting your real code. Recommended.

## Running the tests

The merge logic is what stops the two phones drifting apart, so it's tested by
simulating two phones going offline, making conflicting edits, and reconnecting:

```bash
npm test
```

## Files

| File | What it does |
|---|---|
| `index.html` | The whole UI |
| `styles.css` | Styling, light + dark, sized for thumbs |
| `app.js` | Wiring: rendering, input, sync scheduling |
| `store.js` | Local storage and the merge rules |
| `sync.js` | Talking to Supabase |
| `sw.js` | Service worker — the offline part |
| `config.js` | Your Supabase settings |
| `supabase/schema.sql` | Database table and access policy |
| `supabase/lock-to-one-list.sql` | Pins the database to your one list |
| `.claude/skills/shopping/` | Claude Code skill for using the list from a Mac |
