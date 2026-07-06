# Taken Kings — Project Notes

A single-file HTML5 Canvas chess-variant game. Waves of enemy pieces enter from
the top of the board; you shove them off the far edge ("Field Advance") to score.
Runs in any modern browser; deployed via GitHub Pages.

---

## Codebase layout

- **`chess.js`** — the entire game (~6000+ lines): rendering, input, AI (minimax),
  animations, sound engine, shop/inventory, wave generation. No build step.
- **`index.html`** — thin shell: canvas + `<script src="chess.js?v=NNN">`. Has
  no-cache meta tags.
- **`sounds/Used Sounds/`** — curated, committed game SFX (mono 96 kbps MP3s).
- **`sounds/Available Sounds/`** — raw sound packs (~452 WAVs, ~179 MB).
  **Gitignored / dev-only — never committed or deployed.**
- **`fonts/canterbury/Canterbury.ttf`** — display font.

## Working conventions (important)

- **Never `git push` unless the user explicitly says "Push."**
- Every change bumps `const VERSION` in `chess.js` **and** `chess.js?v=NNN` in
  `index.html` (cache-busting; keep them in sync).
- **Sound wiring rule:** only hook `playSfx()` at *real-only* code sites (UI
  handlers, animation callbacks). **Never inside `makeMove` / `applyShieldBounceState`**
  directly — those run inside minimax `withState` simulation and would fire
  hundreds of times per turn. (The chest hook in `makeMove` is gated on the
  `visual` flag.)
- Convert audio with: `ffmpeg -y -i in.WAV -ac 1 -ar 44100 -b:a 96k out.mp3`,
  named `<name>_1.mp3` (variant index). Registered in `SFX_DEFS` (name→variant
  count) and `SFX_VOLUME` (name→volume).

## Sound engine

Web Audio API (`AudioContext({ latencyHint: 'interactive' })`); decoded
`AudioBuffer`s in `_sfxBuffers`; each `playSfx(name)` spins up a fresh
BufferSource + GainNode (near-zero latency, natural overlap). First-gesture
unlock for mobile autoplay policy. **iOS Safari fix (v534):** the unlock
(`_sfxUnlockCtx`) starts a 1-sample silent buffer *inside* the user gesture —
`resume()` alone is not enough on Safari. `toggleSfxMute()` persists to
localStorage (`tk_sfx_muted`).

## Wave / difficulty logic

- Each **Field Advance** increments `spawnCount` by 1.
- **Piece count per wave** — `generateWave(count)`:
  `n = count===1 ? 1 : min(2 + floor((count-2)/5), 7)`.
  So: wave 1 → 1 piece; +1 every 5 waves from 2; capped at 7 (from wave 27).
  One slot is always a King.
- **Piece-type odds** — `_randomEnemyPiece(waveCount)` (v535): odds **ramp with
  wave number** from Pawn-heavy toward Queen-heavy. `t = clamp((wave-1)/29, 0, 1)`
  lerps Queen weight 100→1000 and Pawn weight 800→40; Rook/Bishop/Knight ~flat.
  Result: Queen share ~7% (wave 1) → ~66% (wave 30+). Checkers Man/King stay
  fixed (10 / 1 weight) ≈ 0.66% / 0.066%. Checkers pieces on light squares
  convert to Pawn (they must spawn on dark squares).

## Deployment (GitHub Pages)

- Repo: `MadKraken/taken-kings` → https://madkraken.github.io/taken-kings/
- Auto-builds on push. Builds **sometimes hang or hit transient
  "Deployment failed, try again later"** GitHub-side errors (not our code).
  - Check: `gh api repos/MadKraken/taken-kings/pages/builds/latest`
  - Failed Actions runs: `gh run list --repo MadKraken/taken-kings`
  - Re-run: `gh run rerun <id> --repo MadKraken/taken-kings --failed`
  - Avoid spamming `gh api -X POST .../pages/builds` — it can cancel the
    in-flight Actions workflow.
- Browser caching can make a push look "not applied" — hard-refresh
  (Ctrl+Shift+R). Verify what's actually live:
  `curl -s "https://madkraken.github.io/taken-kings/index.html?cb=$(date +%s)" | grep -o 'chess.js?v=[0-9]*'`

---

## Packaging / distribution (future)

Wrapping = bundling the HTML/JS/canvas with an embedded web renderer so it
launches as a native-feeling app (no browser chrome). It still runs on a
browser *engine* (webview) under the hood.

- **Desktop — Tauri**: uses the OS's built-in webview (WebView2/WebKit).
  Tiny installer (~3–10 MB). Lightest option for a single-file canvas game.
- **Desktop — Electron**: bundles its own Chromium (~100–150 MB). Heavier, but
  identical behavior on every machine (no reliance on the user's webview
  runtime).
- **Mobile — Capacitor**: wraps web files in a native shell around the platform
  webview (WKWebView / Android WebView) → real App Store / Play Store listings.

### Steam
- **Viable and friendly** — Valve doesn't reject "just a webview" apps (unlike
  Apple). If it launches as a binary, it qualifies. Many shipped Steam games are
  Electron/web-wrapped.
- **Prefer Electron over Tauri for Steam**: bundled Chromium = consistent
  behavior on every player's PC (no "missing WebView2" black-screen support
  tickets). Worth the extra size for a paid title.
- **Costs/steps**: $100 Steam Direct fee per app (recoupable); build with
  Electron; upload depots via SteamPipe (`steamcmd`). Steam takes 30% (→25% after
  $10M, →20% after $50M). Light review (does it launch, matches store page).
- **Optional Steamworks integration** (achievements, cloud saves, overlay,
  trading cards) via a bridge like `greenworks` or `steamworks.js`. Not required
  to launch.
- Nice-to-haves Steam players expect: gamepad support (new work), fullscreen/
  windowed toggle, multiple resolutions (canvas already scales via
  `max-width:100vw`).

### Prereqs before wrapping / selling
- Game must be **fully self-contained/offline** — all assets loaded by relative
  path (already true); nothing depending on being served from the Pages URL. The
  `?v=VERSION` cache-busting is harmless but moot once bundled.
- The Safari/webview audio unlock (v534) matters even more inside WKWebView.

### Legal / licensing (not legal advice)
- **Code**: Anthropic's Commercial Terms assign output ownership to the user; no
  restriction on commercial use. Caveat: purely AI-generated code may not be
  independently copyrightable in the US (affects stopping copycats, not
  publishing). Game *mechanics/rules* aren't copyrightable anyway.
- **Real exposure = third-party assets** that get committed & redistributed:
  - **Sound packs** — verify the source pack's license allows commercial use
    **and** redistribution (MP3s are committed to a public repo).
  - **Canterbury font** — check its EULA permits web embedding/redistribution.
  - Any sprites/art — confirm origin/license.
- **TODO before public/paid release:** confirm sound-pack + font licenses.
