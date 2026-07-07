// Headless Taken Kings engine for Deno.
//
// Loads the real chess.js with minimal browser stubs and exposes replayRun() for
// server-side score validation. The game logic runs in `_instant` mode (no DOM,
// audio, animation, or timers), so only *load-time* browser APIs need stubbing —
// gameplay itself never touches them. Reusing the exact client code guarantees the
// server's recomputed score matches the client's.

const noop = () => {};

// A canvas 2D context whose methods are no-ops. measureText/getImageData/gradients
// return sane shapes so any stray load-time draw code doesn't throw.
function makeCtx(): any {
  const gradient = { addColorStop() {} };
  return new Proxy({} as any, {
    get(t, p) {
      if (p === "measureText") return () => ({ width: 0 });
      if (p === "getImageData") return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => gradient;
      if (p in t) return (t as any)[p];
      return noop; // any other 2D-context method
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

export function installStubs() {
  const g = globalThis as any;
  const board = makeCanvas();
  g.window = g;
  g.document = {
    getElementById: () => board,
    createElement: () => makeCanvas(),
    addEventListener: noop,
    removeEventListener: noop,
    hidden: false,
    // never-resolving so chess.js's font-gated loadSprites() is skipped entirely
    fonts: { load: () => new Promise(() => {}) },
  };
  g.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = noop;
  // Image: sprites never actually load (onload never fires), so the game stays in its
  // sprite-less state — fine, because _instant re-sim never draws.
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
  if (typeof g.addEventListener !== "function") g.addEventListener = noop;
  if (typeof g.removeEventListener !== "function") g.removeEventListener = noop;
  // Intentionally leave AudioContext/webkitAudioContext undefined so _loadSfx() bails
  // immediately (no audio fetches, no context). performance/setTimeout are native in Deno.
}

export interface RunRecord {
  seed: number;
  classic: boolean;
  timed?: boolean;
  secs?: number;
  inputs: Array<Record<string, unknown>>;
}

export interface Engine {
  replayRun: (run: RunRecord) => { score: number; gameOver: boolean };
  VERSION: string;
}

// Evaluate chess.js in the global scope with stubs in place, then read back the
// symbols we need via an appended shim that shares the script's lexical scope.
export function loadEngine(chessSource: string): Engine {
  installStubs();
  const shim = "\n;globalThis.__TK = { replayRun: (r) => _replayRun(r), get VERSION(){ return VERSION; } };\n";
  (0, eval)(chessSource + shim);
  return (globalThis as any).__TK as Engine;
}
