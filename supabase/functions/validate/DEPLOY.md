# Deploying the `validate` Edge Function

This function re-simulates each submitted run with the real `chess.js` and inserts the
authoritative score via the service_role key (the only path past RLS).

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-provided** to Edge Functions —
you do **not** paste any secret key anywhere.

## Option A — Supabase dashboard (no CLI needed)

1. Dashboard → project `froggegesqnoznvenoyt` → **Edge Functions** → **Deploy a new function**.
2. Name it exactly **`validate`**.
3. Paste the entire contents of **`index.ts`** into the editor (it's a single self-contained file).
4. **Turn OFF "Verify JWT" / "Enforce JWT"** for this function — the leaderboard endpoint is
   public (the anti-cheat is the re-simulation, not auth). Without this, browser POSTs are rejected.
5. Deploy.

Endpoint: `https://froggegesqnoznvenoyt.supabase.co/functions/v1/validate`

## Option B — Supabase CLI

```
supabase login                       # paste an access token from the dashboard
supabase link --project-ref froggegesqnoznvenoyt
supabase functions deploy validate --no-verify-jwt
```

## Verify after deploy

```
curl -sS -X POST https://froggegesqnoznvenoyt.supabase.co/functions/v1/validate \
  -H 'content-type: application/json' \
  --data @<(jq -c '{version:"590", name:"DeployTest", run:.run}' run.json)
```

Expected: `{"ok":true,"ranked":true,"board":"hs_untimed","value":2}` — and the row appears
on the Untimed board. A `409/duplicate` never happens (no unique constraint yet); a
`version mismatch` means the live game version ≠ the one in the request.

## Local testing (already wired)

- `deno run --allow-read run_test.ts run.json` — re-sim a captured run against local chess.js.
- `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… deno run --allow-read --allow-net --allow-env test_handler.ts run.json 590`
  — full handler path; with the publishable key as the service stand-in the insert is
  correctly RLS-rejected, proving only service_role can write.
