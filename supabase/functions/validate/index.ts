// Supabase Edge Function: validate + record a Taken Kings leaderboard run.
//
// Flow: client POSTs { version, name, run }. We fetch the *exact deployed* chess.js
// for that version, re-simulate the run headlessly (the real game logic — no trust in
// the client's claimed score), then insert the authoritative score via the service_role
// key, which bypasses RLS. Clients cannot write to `scores` directly (no RLS policy), so
// this validating function is the only path in.
//
// Env (auto-provided to Supabase Edge Functions): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy as a PUBLIC function (no JWT verification) — the anti-cheat is the re-simulation.
//
// Single self-contained file so it can be pasted straight into the Supabase dashboard.

// ─────────────────────────────────────────────────────────────────────────────
// Headless engine: load the real chess.js with minimal browser stubs.
// The game runs in `_instant` mode (no DOM/audio/animation/timers), so only load-time
// browser APIs need stubbing. Leaving AudioContext undefined self-disables audio; a
// never-resolving document.fonts.load skips sprite loading. Reusing the exact client
// code guarantees the server's recomputed score matches the client's.

const noop = () => {};

function makeCtx(): any {
  const gradient = { addColorStop() {} };
  return new Proxy({} as any, {
    get(t, p) {
      if (p === "measureText") return () => ({ width: 0 });
      if (p === "getImageData") return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => gradient;
      if (p in t) return (t as any)[p];
      return noop;
    },
    set(t, p, v) { (t as any)[p] = v; return true; },
  });
}

function makeCanvas(): any {
  const c: any = { width: 0, height: 0, style: {}, addEventListener: noop, removeEventListener: noop };
  c.getContext = () => makeCtx();
  c.getBoundingClientRect = () => ({ left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height });
  return c;
}

function installStubs() {
  const g = globalThis as any;
  if (g.__tkStubsInstalled) return;
  g.__tkStubsInstalled = true;
  const board = makeCanvas();
  g.window = g;
  g.document = {
    getElementById: () => board,
    createElement: () => makeCanvas(),
    addEventListener: noop,
    removeEventListener: noop,
    hidden: false,
    fonts: { load: () => new Promise(() => {}) }, // never resolves -> loadSprites skipped
  };
  g.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = noop;
  if (typeof g.addEventListener !== "function") g.addEventListener = noop;
  if (typeof g.removeEventListener !== "function") g.removeEventListener = noop;
  g.Image = class {
    onload: unknown = null;
    onerror: unknown = null;
    complete = false;
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    #src = "";
    set src(v: string) { this.#src = v; }
    get src() { return this.#src; }
    addEventListener() {}
    removeEventListener() {}
  };
  // AudioContext/webkitAudioContext intentionally left undefined so _loadSfx() bails.
}

export interface RunRecord {
  seed: number;
  classic: boolean;
  timed?: boolean;
  secs?: number;
  inputs: Array<Record<string, unknown>>;
  blackMoves?: number[]; // v644+: recorded Black minimax moves (from*64+to, -1 = no move)
}

export interface Engine {
  replayRun: (run: RunRecord, opts?: { spotRate?: number; spotSeed?: number }) => { score: number; gameOver: boolean; spotFail?: boolean };
  VERSION: string;
}

// Load chess.js in a fresh function scope (not global eval) so its top-level const/let
// stay local — re-loadable per version. Browser globals resolve to the stubs. An
// appended `return` hands back the symbols we need from that same scope.
export function loadEngine(chessSource: string): Engine {
  installStubs();
  const factory = new Function(
    chessSource + "\n;return { replayRun: (r, o) => _replayRun(r, o), get VERSION(){ return VERSION; } };\n",
  );
  return factory() as Engine;
}

// Fraction of recorded Black turns to recompute-and-verify against minimax. A hacked client that
// makes Black throw the game to inflate the score must match the true AI move on every turn it can't
// predict will be checked — so even ~10% catches meaningful cheating with high probability while
// keeping re-sim ~10x cheaper than full recompute (the whole point: 100+ king runs fit one call).
const SPOT_CHECK_RATE = 0.1;
// Absolute ceiling on spot-checked turns per run. Late-game minimax recomputes are the expensive
// part of validation — on very long runs a flat 10% can still blow the worker's CPU budget
// (Griffindohr's 30-king run drew a 546 before succeeding on retry). Capping the COUNT bounds the
// worst case while keeping the per-turn catch probability meaningful; the seeded selection already
// prevents resubmit-until-lucky, so a smaller sample on long runs doesn't open a cheap cheat.
const SPOT_CHECK_MAX_TURNS = 20;
// Effective rate for a run with n recorded Black turns.
function spotRateFor(n: number): number {
  return n > 0 ? Math.min(SPOT_CHECK_RATE, SPOT_CHECK_MAX_TURNS / n) : SPOT_CHECK_RATE;
}

// Seed for the spot-check turn selection: SHA-256(server secret + the run's semantic content).
// Deterministic per run — a rejected cheater who hits Retry gets the SAME turns re-checked, so
// resubmitting until the tampered turns dodge the sample doesn't work. Salted with a server secret —
// the engine code is public, so an unsalted hash would let a cheater precompute exactly which turns
// get checked and tamper only the rest. Only semantic fields are hashed (seed + blackMoves): fields
// the validator ignores (liveScore, r/h breadcrumbs) can't be tweaked to reroll the subset, and any
// change to blackMoves itself reshuffles the subset unpredictably while also changing the replay.
async function spotSeedFor(run: RunRecord): Promise<number> {
  const salt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "tk-spot-salt";
  const data = new TextEncoder().encode(`${salt}|${run.seed}|${(run.blackMoves ?? []).join(",")}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new DataView(digest).getUint32(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP handler.

const GAME_BASE = "https://madkraken.github.io/taken-kings";
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const engines = new Map<string, Engine>(); // one per version, cached across warm invocations

// Fetch the EXACT engine version the client played on. Two sources:
//  1. jsDelivr at the immutable git tag (v626, v627, …) — works for ANY released version,
//     so a player whose cached client is a version or two behind the latest deploy can
//     still submit (GitHub Pages ignores the ?v= query and only ever serves the newest file,
//     which used to reject every submission from a stale session as "version mismatch").
//  2. GitHub Pages — fallback for the current deployment (covers a release whose tag
//     hasn't been pushed/propagated yet).
async function fetchEngineSource(v: string): Promise<string> {
  const urls = [
    `https://cdn.jsdelivr.net/gh/MadKraken/taken-kings@v${v}/chess.js`,
    `${GAME_BASE}/chess.js?v=${v}`,
  ];
  let lastErr = "no source";
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) { lastErr = `fetch ${res.status}`; continue; }
      const src = await res.text();
      // Cheap pre-check before evaluating ~300KB of JS: does this file claim the right version?
      const m = src.match(/^const VERSION = "(\d+)"/);
      if (!m || m[1] !== v) { lastErr = `version mismatch (served ${m?.[1] ?? "?"}, requested ${v})`; continue; }
      return src;
    } catch (e) { lastErr = (e as Error).message; }
  }
  throw new Error(lastErr);
}

async function getEngine(version: string): Promise<Engine> {
  const v = String(version).replace(/[^0-9]/g, ""); // digits only — goes into a URL
  if (!v) throw new Error("bad version");
  const cached = engines.get(v);
  if (cached) return cached;
  const eng = loadEngine(await fetchEngineSource(v));
  if (eng.VERSION !== v) throw new Error(`version mismatch (served ${eng.VERSION}, requested ${v})`);
  engines.set(v, eng);
  return eng;
}

// Board is derived server-side from the run, never trusted from the client. Only
// untimed and the 15s timer are leaderboard-eligible.
function boardFor(run: RunRecord): string | null {
  if (!run.timed) return "hs_untimed";
  if (run.timed && Number(run.secs) === 15) return "hs_15s";
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "bad JSON" }, 400); }

  const version = String(payload?.version ?? "");
  const name = String(payload?.name ?? "").trim().slice(0, 20);
  const run = payload?.run as RunRecord;

  if (!name) return json({ ok: false, error: "name required" }, 400);
  if (!run || typeof run !== "object" || !Array.isArray(run.inputs) || typeof run.seed !== "number") {
    return json({ ok: false, error: "bad run" }, 400);
  }
  if (run.inputs.length > 5000) return json({ ok: false, error: "run too long" }, 400);
  // Byte cap too — the whole run is stored as jsonb, and the input-count cap alone
  // wouldn't stop oversized junk fields from bloating the table. 512KB: the r/h diagnostic
  // breadcrumbs (v626/v633) add ~55 bytes per input, so a maximal run brushes 256KB.
  if (JSON.stringify(run).length > 524288) return json({ ok: false, error: "run too large" }, 400);

  const board = boardFor(run);
  if (!board) return json({ ok: false, error: "run mode not eligible" }, 400);

  let engine: Engine;
  try { engine = await getEngine(version); }
  catch (e) { return json({ ok: false, error: "engine load: " + (e as Error).message }, 400); }

  // v644+ runs carry recorded Black moves → re-sim applies them (cheap) with a random spot-check.
  // Legacy runs (no blackMoves) fall back to full recompute inside the engine (may be slow/time out,
  // handled separately). spotRate is harmless (0 effective) when there are no recorded moves.
  let result: { score: number; gameOver: boolean; spotFail?: boolean };
  try { result = engine.replayRun(run, { spotRate: spotRateFor((run.blackMoves ?? []).length), spotSeed: await spotSeedFor(run) }); }
  catch (e) { return json({ ok: false, error: "resim failed: " + (e as Error).message }, 400); }
  // A recorded Black move disagreed with what the AI would actually play → tampered run, reject.
  if (result.spotFail) return json({ ok: false, ranked: false, error: "spot-check failed" }, 400);

  const value = result.score | 0;
  if (value < 1) return json({ ok: true, ranked: false, reason: "score too low", value });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server not configured" }, 500);

  const insert = await fetch(`${SUPABASE_URL}/rest/v1/scores`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "content-type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ board, name, value, seed: run.seed, run }),
  });
  // Unique (board, seed) → a resubmission of the same run conflicts. Report it as a
  // duplicate rather than an error (idempotent: the score is already on the board).
  if (insert.status === 409) return json({ ok: true, ranked: true, duplicate: true, board, value });
  if (!insert.ok) {
    return json({ ok: false, error: `insert failed (${insert.status}): ${(await insert.text()).slice(0, 200)}` }, 500);
  }

  return json({ ok: true, ranked: true, board, value });
}

if (import.meta.main) Deno.serve(handler);
