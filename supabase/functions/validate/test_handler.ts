// Local end-to-end test of the Edge Function handler (no Supabase CLI needed).
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run --allow-read --allow-net --allow-env test_handler.ts [run.json] [version]
//
// With the *publishable* key as SERVICE_ROLE stand-in the insert is correctly rejected
// by RLS — proving the fetch→re-sim→insert path is wired and only service_role can write.
// With the real service_role key it inserts for real.

import { handler } from "./index.ts";

const runFile = Deno.args[0] ?? "run.json";
const version = Deno.args[1] ?? "590";
const payload = JSON.parse(await Deno.readTextFile(runFile));

const body = { version, name: "TestBot", run: payload.run };
const req = new Request("http://local/validate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const res = await handler(req);
console.log("status:", res.status);
console.log("body:  ", await res.text());
Deno.exit(0);
