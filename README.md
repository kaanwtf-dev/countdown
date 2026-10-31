# Countdown

A countdown app that can skip days. Seconds, minutes, hours and days are always
shown large; years, months and weeks can be switched on. Every countdown tracks
two totals at once:

- **Counted** — the big clock. Skipped days contribute nothing; on a skipped day
  the clock parks and a badge says when it restarts.
- **Full time** — the plain wall clock, where every calendar day counts.

Live at **https://kaanwtf-dev.github.io/countdown/** (GitHub Pages, no build step).

Sign in (☁︎ button) and your countdowns are stored in **Supabase** — clear your
cookies, switch phones, log back in and everything is still there. Signed out,
it works exactly like before and saves to this device only. It also works
offline and syncs when the connection comes back.

On a phone: *Share → Add to Home Screen* (iOS) or *Install app* (Android/Chrome)
and it runs full-screen like a native app.

## Setting up cloud sync (once)

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. **SQL Editor** → paste and run [`supabase/schema.sql`](supabase/schema.sql).
   It creates one table with row-level security: each user can only read/write
   their own row.
3. **Authentication → Sign In / Providers → Email**: keep it enabled. Turn off
   *Confirm email* if you don't want a confirmation step on sign-up.
4. **Authentication → URL Configuration**: set *Site URL* to
   `https://kaanwtf-dev.github.io/countdown/` (used by confirmation and
   password-reset emails).
5. **Project Settings → API**: copy the *Project URL* and the *anon / publishable*
   key into [`config.js`](config.js), commit, push. (Both are meant to be public.
   Never put the `service_role` key in there.)

### How sync works

`localStorage` is still the working copy, so the app is instant and works
offline. On sign-in, on every change, when the tab regains focus and once a
minute, the app pulls your row from Supabase, merges it and writes back only if
something changed:

- each countdown carries an `updatedAt` — the newer edit wins
- deleted countdowns are remembered (`deleted`), so a delete on one device sticks everywhere
- a fresh device (or one whose cookies were just cleared) never overwrites the cloud —
  it downloads it; countdowns you made there before signing in get merged in

## Deploying

Pushing to `main` deploys via GitHub Pages (*Settings → Pages → Deploy from a
branch → `main` / root*). After changing any file, bump `VERSION` in `sw.js` so
installed copies pick up the new version.

## Using it

| Control | What it does |
| --- | --- |
| `＋` | New countdown |
| `⚙︎` | Edit the current one — name, icon, accent colour, target, skip rules |
| `⋯` | Duplicate, export/import JSON, restore the school preset |
| Tabs | Switch between countdowns |

Skip rules come in two forms: **weekdays** (e.g. every Sat + Sun) and **date
ranges** (holidays, breaks — leave the end date the same for a single day).

## The bundled countdown

**Last Day of School — Thursday, May 27, 2027**, built from the *SCUSD 2026-27
Traditional Student Attendance Calendar* (updated 1-13-2026).

The skip list was read out of the PDF's own colour data rather than typed by
hand:

| In the PDF | Meaning | In the app |
| --- | --- | --- |
| Red day numbers | Weekends + days outside the school year | Sat/Sun rule + `Summer break` range |
| Purple cell fill | Non-school weekdays (holidays, breaks) | One range each, tagged purple |
| Yellow cell + `*` | First day (Aug 11, 2026) / last day (May 27, 2027) | Start / target |

It reproduces the per-month totals printed on the calendar exactly:

```
Aug 15 · Sep 21 · Oct 21 · Nov 15 · Dec 14
Jan 18 · Feb 18 · Mar 17 · Apr 22 · May 19   =  180 school days
```

Two things are assumptions rather than data, and both are editable in `⚙︎`:

- The **3:00 PM** end time on the last day — the calendar only gives the date.
- Holiday **names**. The PDF colours the days but never labels them, so the
  names are inferred from the dates (`Fall holiday` = Oct 12, `Lincoln Day` =
  Feb 8). The dates themselves are straight from the document.

## Files

```
index.html            markup
styles.css            styling, dark + light, phone layout
app.js                counting engine, rendering, editor, local storage
sync.js               Supabase sign-in + cloud sync/merge
config.js             your Supabase URL + anon key
presets.js            the SCUSD 2026-27 calendar data
sw.js                 offline cache (PWA)
manifest.webmanifest  home-screen app metadata
icons/                app icons
supabase/schema.sql   database table + security policy
```

### How the counting works

`countedMsBetween(a, b)` walks day by day and adds only the slice of each day
that survives the skip rules, so a Friday-3pm-to-Monday-3pm span over a skipped
weekend is 24 counted hours, not 72.

Years and months are walked on the real calendar — one "month" means one
calendar month's worth of *counted* days, whatever that happens to be — so the
breakdown stays honest even when most of a month is skipped.
