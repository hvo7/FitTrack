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

The app is a single self-contained `index.html`. `build.js` precompiles the JSX
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

**Conflicts.** Naive last-write-wins would quietly lose data when you log
breakfast on your phone and dinner on your desktop before either syncs. So
merges are structural instead:

- `ft_days` merges per date — different days from both devices all survive; the
  same day edited on both falls back to whichever was written later
- the library and log arrays merge by `id`
- `ft_profile` is a small blob, so newest wins

Writes are held back until the first pull has reconciled with the server, so a
device that has been closed for a while cannot overwrite newer work on startup.
If that pull fails the app stays local-only and retries with a backoff, rather
than pushing a stale view of the world.

**With no Supabase configured**, all of this is inert: FitTrack behaves exactly
as it did before, saving to that one device.

---

## Layout

```
index.html                    the whole app (edit this)
config.js                     Supabase URL + anon key + deployed URL
sync.js                       cloud sync, auth, environment handling
main.js                       Electron shell
build.js                      JSX precompile + PWA bundling
public/                       manifest, service worker, icons
supabase/schema.sql           run once in the SQL editor
tools/                        icon generator, page assembler, dev server
.github/workflows/deploy.yml  builds both environments, publishes to Pages
```
