# FitTrack

A personal daily macro & fitness tracker. One codebase runs as a **desktop app**
(Windows, via Electron), a **mobile app** (installed to your phone's home screen
as a PWA), and a **web app** — all signed into one account, all kept in sync.

Everything here runs on free tiers: GitHub Pages for hosting, Supabase for the
account and database.

---

## How it fits together

```
index.html ──┬─> Electron  ──> FitTrack.exe        (desktop)
             ├─> build.js  ──> GitHub Pages        (web + installable mobile PWA)
             └─> sync.js   ──> Supabase (Postgres) (account + cross-device sync)
```

The app UI lives in `index.html`, with shared nutrition logic in `food-model.js`
and the visual theme in `theme.css`. `build.js` precompiles the JSX
with esbuild so the browser never has to load a 3MB Babel compiler — which is
the difference between an instant load and a two-second white screen on a phone.

### Live and dev

Both environments deploy to the same Pages site:

| | URL | Branch | Data |
|---|---|---|---|
| **Live** | `/` | `main` | your real data |
| **Dev** | `/dev/` | `dev` | a separate sandbox |

They share one Supabase project but write to different rows (an `env` column),
so **nothing you do in dev can touch your live data**. The dev build is
unmistakable: a purple banner across the top and a violet accent colour.

Switching:

- **In the app** — the sync pill in the top bar → *Switch to Dev / Live*
- **On desktop** — <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>
- **Directly** — just open the `/dev/` URL

To test against realistic data, sign in on the dev build and use
**Copy live data into dev**. The copy only ever runs in that direction.

---

## First-time setup

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project (the
   free tier is enough — this app stores a few hundred KB).
2. Open **SQL Editor**, paste in [`supabase/schema.sql`](supabase/schema.sql),
   and run it.
3. Go to **Project Settings → Data API** and copy the **Project URL** and the
   **anon / public** key.
4. Paste both into [`config.js`](config.js), then commit.

> **Is it safe to commit that key to a public repo?** Yes. The anon key is a
> public client key by design and grants nothing on its own — every row is
> gated by Row Level Security to the signed-in user who owns it. Never commit
> the `service_role` key, which does bypass RLS.

By default Supabase emails a confirmation link on sign-up. To skip that for a
single-user app, turn off **Authentication → Sign In / Providers → Confirm
email**.

### 2. Turn on GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Push to `main` and the workflow in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) publishes both
environments. Your app lands at `https://<username>.github.io/FitTrack/`.

Create a `dev` branch when you want dev to diverge from live. Until then, `/dev/`
is built from `main` so it is never a 404.

### 3. Install it

**Phone (iOS)** — open the URL in Safari (it must be Safari), then Share →
*Add to Home Screen*.

**Phone (Android)** — open in Chrome, then menu → *Install app*.

**Desktop** — either install the PWA from Chrome/Edge, or build the native app:

```bash
npm install
npm run build:desktop     # -> dist/
```

To make the desktop app update itself whenever you push, set `APP_URL` in
`config.js` to your Pages URL. It then loads the deployed build instead of its
bundled copy, and you never reinstall.

---

## Everyday workflow

```bash
npm start              # desktop app, live environment
npm run start:dev      # desktop app, dev environment

npm run build:pages    # build both environments into dist-pages/
npm run serve          # serve that build, incl. on your LAN for phone testing
```

Ship a change:

```bash
git checkout dev
# ...edit index.html...
git commit -am "try something"
git push                       # -> deploys to /dev/ only

git checkout main && git merge dev && git push   # -> goes live
```

### Other commands

| Command | What it does |
|---|---|
| `npm run vendor` | refresh `lib/` from `node_modules` |
| `npm run icons` | regenerate the PWA icons |
| `npm run build:web` | build the live environment only |
| `npm run build:web:dev` | build the dev environment only |

---

## How sync works

The app is **local-first**. Every write hits `localStorage` immediately and the
UI never waits on the network; cloud pushes are debounced ~1s in the background.
Changes from another device arrive over Supabase realtime, usually within a
second.

Storage is five JSON blobs — `ft_profile`, `ft_days`, `ft_library`,
`ft_weight_logs`, `ft_sleep_logs` — kept in one key/value table.

**Conflicts.** Merges are structural during both initial pulls and realtime
updates:

- `ft_days` merges per date, then meals and workouts by ID. Per-entry revisions
  decide conflicts between edited logs; deleted logs carry tombstones.
- Food records merge by stable ID and per-food `updatedAt`. Archive/restore is
  an edit, so an older copy does not resurrect archived foods.
- Weight and sleep arrays merge by ID; single-valued day fields use day recency.
- `ft_profile` is a small blob, so newest wins

Writes are held back until the first pull has reconciled with the server, so a
device that has been closed for a while cannot overwrite newer work on startup.
If that pull fails the app stays local-only and retries with a backoff, rather
than pushing a stale view of the world.

Failed pushes remain queued for reconciliation and retry. Unchanged saves do
not rewrite local storage or update timestamps.

**With no Supabase configured**, all of this is inert: FitTrack behaves exactly
as it did before, saving to that one device.

---

## Layout

```
index.html                    app views, forms and React state
food-model.js                 unit conversion, food identity and nutrition resolution
theme.css                     slate / blue theme and responsive home screen
config.js                     Supabase URL + anon key + deployed URL
sync.js                       cloud sync, auth, environment handling
main.js                       Electron shell
build.js                      JSX precompile + PWA bundling
public/                       manifest, service worker, icons
supabase/schema.sql           run once in the SQL editor
tools/                        icon generator, page assembler, dev server
.github/workflows/deploy.yml  builds both environments, publishes to Pages
```

## Food database and logging

- Use **Food database → New food** to enter nutrition for a label amount,
  such as **30 g**. Add equivalents for that same amount, such as **2 slices**
  or **1 scoop**. Weight units and US volume units convert within their own
  families automatically. Converting between weight, volume, and pieces
  requires an explicit food-specific equivalent.
- **Log food** offers recent foods and remembers the last amount used. Switching
  units preserves the amount eaten; editing the quantity changes the portion.
  A serving means the complete label amount (except when the label itself is
  expressed as multiple servings).
- Each saved-food log stores a `foodId`, `quantity`, and `unit`, plus a nutrition
  snapshot. Displayed nutrition is derived from the current food definition,
  using a single indexed pass through the diary. Changing a food's macros,
  label amount, or name updates all linked historical totals immediately.
  Diary dates and recorded quantities stay unchanged; no bulk history rewrite
  is needed for each database correction.
- The food editor previews the number of linked logs and days affected. It
  prevents removing conversions still used by those logs. For example, when
  changing a gram-based label to pieces, keep a gram equivalent for old logs.
- **Archive** removes a food from normal search while preserving its record and
  history. Enable **Archived** to restore it. Log deletion has an **Undo** action.
- Duplicate food names and invalid amounts/macros are rejected. Use distinct
  names for different brands or preparations. One-time entries can be saved
  without adding to the database and retain their own nutrition.

Existing logs are linked automatically only when their normalized food name
matches exactly one database record and their recorded amount can be converted.
Ambiguous or unparseable entries keep their saved nutrition and show as
unlinked. Edit one and choose **Link to a saved food**, then review the amount.
An unavailable record or conversion displays a review message and the stored
snapshot instead of guessing. Archived records continue to resolve normally.

All devices need the updated app to display derived historical nutrition.
This change keeps the existing Supabase schema and local storage keys; no SQL
migration is required. Sync merges are client-side and are not a transactional
multi-user database protocol.

### Mobile updates

The installed phone app uses the GitHub Pages release. Open it while online to
get the latest version. If an update notice appears, finish the current entry
and choose **Reload app**. Closing and reopening the app also loads the latest
published screen. Keep the existing home-screen installation so its local data
and sign-in remain available.

App scripts and styles have versioned URLs, and live/dev offline caches are
isolated. A new offline bundle activates only after its required files download
successfully. `node tests/pwa-smoke.cjs` checks updates, offline reload/logging,
and separate live/dev caches after `npm run build:pages`.

### Verification commands

`npm test` runs unit and sync regression tests. `npm run build:pages` builds the
live and dev bundles. With Playwright and a Chromium browser installed,
`node tests/browser-smoke.cjs` runs isolated browser checks against `dist-web`;
set `PLAYWRIGHT_CHANNEL` to change its default browser (`msedge`). It uses
synthetic local data with cloud configuration disabled, and checks logging,
unit conversion, historical corrections, reload, archive/restore, undo, food
creation, and responsive layouts.
