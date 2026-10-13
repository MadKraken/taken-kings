# Keeping Taken Kings alive without a maintainer

Written 2026-10-13, after the leaderboard went down. The Supabase project had paused from five
weeks of inactivity; the game itself was fine the whole time. This is what is mortal, what is not,
and what has been done about it.

## What each piece actually depends on

| Piece | Hosted by | Dies when | Unattended lifespan |
|---|---|---|---|
| The game — HTML, JS, sprites, audio | GitHub Pages | the repo or account goes | effectively indefinite |
| Engine at a version tag (for re-simulation) | jsDelivr, from git tags | GitHub goes | indefinite |
| Leaderboard reads (saved board) | GitHub Pages, `leaderboard-snapshot.json` | the repo goes | indefinite |
| Player's own bests | the player's browser (`localStorage`) | they clear site data | indefinite |
| **Leaderboard writes + validation** | **Supabase free tier** | **~7 days with no activity** | **~1 week** |

There is no custom domain anywhere, so nothing expires through an unpaid renewal — the usual way a
hobby project dies. Only the write path is genuinely mortal, because accepting writes needs an
account that somebody owns.

## What happens when Supabase finally goes

Nothing breaks. The game is playable, and:

- The **Leaderboard screen** falls back to `leaderboard-snapshot.json`, committed in this repo and
  served next to the game, and says so with the date it was taken.
- If even that is missing, it shows the player's **local bests** instead, under "Leaderboard
  offline". Not an error — the game is fine, only the global board is away.
- **Submitting** reports "Leaderboard offline — saved locally", because by then the score is
  already in that player's local bests.

So the hall of fame stays readable forever and the score chase keeps working. What is lost is new
global rankings, which genuinely cannot survive without a backend.

## The snapshot workflow

`.github/workflows/leaderboard-snapshot.yml` runs Mon and Thu and does three jobs at once:

1. **Backup.** The scores exist only in Supabase otherwise. The snapshot is the only copy in version
   control, and it is what the game falls back to.
2. **Supabase keep-alive.** Reading the table is activity, and twice a week (max 4-day gap) keeps
   the ~7-day pause fuse from ever burning down. This is why it runs twice a week rather than
   weekly; the data rarely changes that fast.
3. **GitHub schedule keep-alive — best effort, see below.**

It needs no secrets: the publishable key is read-only under RLS and is already public in `chess.js`.

## The 60-day question, honestly

**Documented and certain.** GitHub's docs state: "In a public repository, scheduled workflows are
automatically disabled when no repository activity has occurred in 60 days." This repo is public,
so the rule applies. A disabled schedule can be re-enabled from the Actions tab.

**Not documented.** GitHub does not define "repository activity" anywhere in that page.

**Community evidence, which conflicts.** Reports say a commit to the default branch resets the
timer, and that hitting the API alone does *not*. Whether a commit pushed with the built-in
`GITHUB_TOKEN` counts is unverified — one informal report says yes, nothing authoritative confirms
it. Relevant data point: `GITHUB_TOKEN` pushes are documented *not* to trigger other workflow runs,
so GitHub does treat them differently from human pushes in at least one place.

**A caution.** The best-known third-party keepalive action
(`gautamkrishnar/keepalive-workflow`) is now unavailable: GitHub has disabled it for a terms of
service violation. The reason is not stated and may be unrelated, but it is a reason not to lean on
third-party keepalive tooling, and a reason not to commit meaningless churn purely to game the
timer. The snapshot commit here is real data — it is the backup, and its timestamp is shown to
players on the offline board — rather than a dummy heartbeat.

**Therefore.** Treat the GitHub keep-alive as a bonus, not a guarantee. If bot commits do count,
the schedule sustains itself indefinitely. If they do not, it stops roughly 60 days after the last
human push, Supabase pauses about a week later, and the game degrades to the saved board — which is
exactly what the fallback is for.

**To make it certain**, have the workflow push with a personal access token instead of
`GITHUB_TOKEN`. A commit authored by a real account is unambiguously repository activity. The cost
is a long-lived secret in the repo, so it is a deliberate trade rather than an obvious win.

**To verify empirically**, check whether the workflow is still enabled about 60 days after the last
human push. GitHub emails the repo owner before disabling a schedule, so it is detectable rather
than silent.

## If the project is ever gone for good

The game is a self-contained folder: `index.html`, `chess.js`, `sprites/`, `sounds/`, `music/`,
`fonts/`. Anyone can host it on any static host, or open it locally. Worth uploading a copy
somewhere durable (itch.io, the Internet Archive) if it should outlast the GitHub account too.

## Rebuilding the backend from scratch

Everything needed is in version control:

- `supabase/leaderboard_schema.sql` — table, indexes, the `(board, seed)` dedup unique, RLS
- `supabase/functions/validate/index.ts` — the whole validator
- `supabase/functions/validate/DEPLOY.md` — deploy steps
- `leaderboard-snapshot.json` — the data, to re-import

A new project means a new ref, so update `SUPABASE_URL` in `chess.js`, the URLs in `DEPLOY.md` and
`taken_kings.md`, and either name the new function `bright-task` or update `LB_SUBMIT_URL`.
