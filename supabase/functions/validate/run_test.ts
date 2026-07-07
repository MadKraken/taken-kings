// Local Phase-3b test: load chess.js headlessly under Deno, re-simulate a run
// captured from the browser, and print the recomputed score.
//
//   deno run --allow-read run_test.ts <run.json>
//
// <run.json> is { run: {seed,classic,timed,secs,inputs}, live: {score,gameOver} }
// as dumped from the browser. Exit code 0 iff the recomputed result matches `live`.

import { loadEngine } from "./engine.ts";

const chessPath = new URL("../../../chess.js", import.meta.url);
const src = await Deno.readTextFile(chessPath);

const runPath = Deno.args[0] ?? "run.json";
const payload = JSON.parse(await Deno.readTextFile(runPath));
const run = payload.run ?? payload;
const live = payload.live ?? null;

console.error("[test] loading engine…");
const TK = loadEngine(src);
console.error("[test] engine loaded, VERSION=", TK.VERSION, "— replaying…");
const res = TK.replayRun(run);
console.error("[test] replay done");

const match = live ? res.score === live.score && res.gameOver === live.gameOver : null;
console.log(JSON.stringify({ version: TK.VERSION, inputs: run.inputs.length, replay: res, live, MATCH: match }, null, 2));
// chess.js leaves a background timer running (wind ambiance / merchant reroll); force a
// clean exit rather than letting Deno wait on the lingering event loop.
Deno.exit(match === false ? 1 : 0);
