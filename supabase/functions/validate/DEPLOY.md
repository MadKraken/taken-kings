# Deploying the leaderboard Edge Function

This function re-simulates each submitted run with the real `chess.js` and inserts the
authoritative score via the service_role key (the only path past RLS). It also moderates
submitted names.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-provided** to Edge Functions —
you do **not** paste any secret key anywhere.

## ⚠️ Read this first: the function is called `bright-task`

The function's **display name** is "validate", but its **URL slug is `bright-task`** — Supabase
locks the slug at creation and it cannot be renamed. The game calls:

```
https://froggegesqnoznvenoyt.supabase.co/functions/v1/bright-task
```

(see `LB_SUBMIT_URL` in `chess.js`). **This is an UPDATE to that existing function — do not create
a new one.** Deploying to a function named `validate` produces a live endpoint that no client ever
calls, so nothing changes and the old code keeps running.

## Option A — Supabase dashboard (no CLI needed)

1. Dashboard → project `froggegesqnoznvenoyt` → **Edge Functions**.
2. Open the **existing** function (listed as "validate", slug `bright-task`). Do **not** click
   "Deploy a new function".
3. Select all in the editor and replace it with the entire contents of `index.ts` (it is one
   self-contained file — no imports to resolve).
4. Confirm **"Verify JWT" is OFF**. The leaderboard endpoint is public; the anti-cheat is the
   re-simulation, not auth. With JWT on, every browser POST is rejected.
5. **Deploy**, and wait for the status to go green.

## Option B — Supabase CLI

The local folder is `supabase/functions/validate/`, but the deploy target is the `bright-task`
slug, so the folder must be named to match. Easiest is to copy it:

```bash
supabase login                       # paste an access token from the dashboard
supabase link --project-ref froggegesqnoznvenoyt
mkdir -p supabase/functions/bright-task
cp supabase/functions/validate/index.ts supabase/functions/bright-task/index.ts
supabase functions deploy bright-task --no-verify-jwt
```

## Verify after deploy

Two checks — one that a good submission still works, one that the new name filter is live.

**1. Name moderation is active** (no run needed; it rejects before any re-sim):

```bash
curl -sS -X POST https://froggegesqnoznvenoyt.supabase.co/functions/v1/bright-task \
  -H 'content-type: application/json' \
  --data '{"version":"701","name":"sh1t","run":{"seed":1,"classic":false,"timed":false,"secs":15,"inputs":[]}}'
```

Expected **after** deploy: `{"ok":false,"error":"Name not allowed — pick another"}`

Expected **before** deploy (verified against the live endpoint on 2026-08-02):
`{"ok":true,"ranked":false,"reason":"score too low","value":0}` — the empty run is valid, it just
scores 0. So that response means the **old code is still live**; the name check runs before the
re-sim and would have short-circuited it.

**2. An innocent name still gets through the name check** (proves no over-blocking):

```bash
curl -sS -X POST https://froggegesqnoznvenoyt.supabase.co/functions/v1/bright-task \
  -H 'content-type: application/json' \
  --data '{"version":"701","name":"Black Knight","run":{"seed":1,"classic":false,"timed":false,"secs":15,"inputs":[]}}'
```

Expected: `{"ok":true,"ranked":false,"reason":"score too low","value":0}` — it got **past** the name
check and re-simmed the deliberately empty run. Anything mentioning "Name not allowed" here is a
false positive and should be reported.

**3. Real end-to-end**: play a short run in the game and submit normally. A `version mismatch`
means the game version isn't tagged yet (see the auto-tag workflow in `.github/workflows/`).

## Local testing (already wired)

- `deno check index.ts` — typecheck.
- `deno test --allow-read --allow-net name_test.ts` — name moderation: innocent names
  (Scunthorpe, Assassin, "Black Knight", …) must pass; profanity and evasions must block.
- `deno run --allow-read run_test.ts run.json` — re-sim a captured run against local chess.js.
- `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-read --allow-net --allow-env test_handler.ts run.json 590`
  — full handler path; with the publishable key as the service stand-in the insert is
  correctly RLS-rejected, proving only service_role can write.
