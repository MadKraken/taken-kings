const VERSION = "679";
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

// ─── Sound effects ──────────────────────────────────────────────────────────
// Curated MP3s live in "sounds/Used Sounds/" as <name>_1..3.mp3. Each play picks a
// random variant so repeated actions don't get grating.
const SFX_DEFS = { move: 1, horse: 1, whinny: 1, draw: 1, water: 1, capture: 1, queencap: 1, rookcap: 1, anvil: 1, punch: 1, shield: 1, chest: 1, pickup: 1, buy: 1, sell: 1, shopopen: 1, button: 1, spell: 1, teleport: 1, clone: 1, whoosh: 1, torch: 1, thud: 1, recruit: 1, boom1: 1, boom2: 1, crunch: 1, over1: 1, over2: 1, body: 1, man: 1, loot: 1, wind: 1 };
const SFX_VOLUME = { move: 0.30, horse: 0.4, whinny: 0.45, draw: 0.5, water: 0.5, capture: 0.55, queencap: 0.6, rookcap: 0.6, anvil: 0.5, punch: 0.5, shield: 0.55, chest: 0.6, pickup: 0.6, buy: 0.65, sell: 0.65, shopopen: 0.6, button: 0.5, spell: 0.6, teleport: 0.6, clone: 0.6, whoosh: 0.5, torch: 0.6, thud: 0.6, recruit: 0.6, boom1: 0.6, boom2: 0.6, crunch: 0.6, over1: 0.65, over2: 0.65, body: 0.5, man: 0.5, loot: 0.6 };
// Selecting a piece: sword draw for all except Checkers pieces; Knights also whinny.
function playSelectSfx(piece) {
  if (piece !== CHECKERS && piece !== CHECKERS_KING) playSfx('draw');
  if (piece === KNIGHT) playSfx('whinny');
}
// Move sound: landing on a River square splashes; Knights clop; everyone else footsteps.
function playMoveSfx(piece, destIdx) {
  if (destIdx != null && specialSpaces[idx(0, Math.floor(destIdx / 8))]?.type === 'river') { playSfx('water'); return; }
  playSfx(piece === KNIGHT ? 'horse' : 'move');
}
const SFX_PATH = "sounds/Used%20Sounds/";
// Web Audio: decode each clip to an AudioBuffer once, then play via a BufferSource for
// near-zero-latency, overlapping playback (HTMLAudio.play() re-buffers and lags ~50-150ms).
let _sfxCtx = null;
const _sfxBuffers = {}; // name -> [AudioBuffer, ...]
let _sfxMuted = false;
let _sfxUnlocked = false;

function _loadSfx() {
  try { _sfxMuted = localStorage.getItem('tk_sfx_muted') === '1'; } catch (e) {}
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  // 'interactive' requests the lowest output latency the platform allows (mobile defaults are laggy).
  try { _sfxCtx = new AC({ latencyHint: 'interactive' }); } catch (e) { _sfxCtx = new AC(); }
  for (const [name, count] of Object.entries(SFX_DEFS)) {
    _sfxBuffers[name] = [];
    for (let i = 1; i <= count; i++) {
      // cache: 'no-store' — Safari's disk cache can serve audio responses that
      // decodeAudioData rejects (works on first load of a new ?v URL, then
      // silent on every refresh). Files are tiny; always fetch fresh.
      fetch(`${SFX_PATH}${name}_${i}.mp3?v=${VERSION}`, { cache: 'no-store' })
        .then(r => r.arrayBuffer())
        .then(ab => _sfxCtx.decodeAudioData(ab))
        .then(buf => { _sfxBuffers[name].push(buf); })
        .catch(() => {});
    }
  }
  // Unlock/resume the audio context on the first user gesture (mobile autoplay policy).
  const unlock = () => {
    _sfxUnlockCtx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('touchstart', unlock);
  window.addEventListener('keydown', unlock);
  // Background music has its OWN autoplay gate, separate from the AudioContext: on Android the first
  // gesture unlocks the context (so SFX play) but the media element's play() is still refused. A
  // one-shot start would give up after that single refusal — music then only appeared once a
  // minimize/refocus re-triggered play via the visibility hook. So retry on every gesture (pointer,
  // touch, click, key) until playback actually starts, then stop listening.
  const _MUSIC_GESTURES = ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click', 'keydown'];
  const startMusic = () => {
    _playMusic().then(ok => { if (ok) for (const ev of _MUSIC_GESTURES) window.removeEventListener(ev, startMusic); });
  };
  for (const ev of _MUSIC_GESTURES) window.addEventListener(ev, startMusic);
  // Silence audio (esp. the looping wind) when the app is backgrounded / the
  // phone sleeps; resume on return. Mobile browsers otherwise keep the
  // AudioContext running in the background.
  const onVisibility = () => {
    if (document.hidden) {
      _pauseMusic();
      if (_sfxCtx && _sfxCtx.state === 'running') _sfxCtx.suspend();
    } else {
      if (_musicStarted && !_sfxMuted) _playMusic();
      if (_sfxCtx && _sfxUnlocked && !_sfxMuted && _sfxCtx.state === 'suspended') _sfxCtx.resume();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onVisibility);
}

// iOS Safari only truly unlocks the AudioContext if a buffer is STARTED during
// the user gesture — resume() alone is not enough. Play a 1-sample silent buffer.
function _sfxUnlockCtx() {
  _sfxUnlocked = true;
  if (!_sfxCtx) return;
  if (_sfxCtx.state === 'suspended') _sfxCtx.resume();
  try {
    const b = _sfxCtx.createBuffer(1, 1, 22050);
    const s = _sfxCtx.createBufferSource();
    s.buffer = b;
    s.connect(_sfxCtx.destination);
    s.start(0);
  } catch (e) {}
}

function playSfx(name) {
  if (_instant) return; // headless re-sim: no audio
  if (_sfxMuted || !_sfxUnlocked || !_sfxCtx) return;
  const bufs = _sfxBuffers[name];
  if (!bufs || !bufs.length) return;
  if (_sfxCtx.state === 'suspended') _sfxCtx.resume();
  const src = _sfxCtx.createBufferSource();
  src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  const g = _sfxCtx.createGain();
  g.gain.value = SFX_VOLUME[name] ?? 0.5;
  src.connect(g); g.connect(_sfxCtx.destination);
  src.start(0);
}

function toggleSfxMute() {
  _sfxMuted = !_sfxMuted;
  try { localStorage.setItem('tk_sfx_muted', _sfxMuted ? '1' : '0'); } catch (e) {}
  if (_sfxMuted) _pauseMusic(); else if (_sfxUnlocked) _playMusic(); // music follows the mute toggle
  return _sfxMuted;
}

// ─── Looping ambiance (wind) ─────────────────────────────────────────────────
let _windLoop = null; // { src, gain } while playing
const WIND_VOLUME = 0.5; // half volume
function startWindLoop(fadeSec = 3) {
  if (_windLoop || !_sfxCtx || _sfxMuted || !_sfxUnlocked) return;
  const bufs = _sfxBuffers.wind;
  if (!bufs || !bufs.length) return;
  if (_sfxCtx.state === 'suspended') _sfxCtx.resume();
  const src = _sfxCtx.createBufferSource();
  src.buffer = bufs[0];
  src.loop = true;
  const g = _sfxCtx.createGain();
  const now = _sfxCtx.currentTime;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(WIND_VOLUME, now + fadeSec);
  src.connect(g); g.connect(_sfxCtx.destination);
  src.start(0);
  _windLoop = { src, gain: g };
}
function stopWindLoop(fadeSec = 2) {
  if (!_windLoop || !_sfxCtx) return;
  const { src, gain } = _windLoop;
  const now = _sfxCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
  try { src.stop(now + fadeSec + 0.1); } catch (e) {}
  _windLoop = null;
}
// Fade the wind in when the board has no active Black pieces (preview row doesn't count).
function updateWindAmbiance() {
  if (typeof gamePhase !== 'undefined' && gamePhase !== 'playing') return;
  for (let i = 0; i < 64; i++) if (sides[i] === B) return; // a Black piece is present → no wind
  startWindLoop();
}

// ─── Background music ────────────────────────────────────────────────────────
// The main theme streams on loop for the whole session (a lightweight <audio>
// element, not a decoded Web Audio buffer — the track is minutes long). Browsers
// block audible autoplay until a user gesture, so it starts on the first touch of
// the title screen (the same unlock hook that wakes the SFX context). Honors the
// SFX mute flag and pauses while the app is backgrounded.
let _musicEl = null;
let _musicStarted = false; // has playback ever begun (so visibility can resume it)
const MUSIC_VOLUME = 0.4;
// Attempt to start/resume the loop. Returns a promise resolving true if it's now playing, false if it
// was blocked/muted/unavailable — never rejects, so every caller (gesture retry, visibility, mute) is
// safe. Only the gesture-retry path inspects the result.
function _playMusic() {
  if (_instant || _sfxMuted) return Promise.resolve(false);
  if (!_musicEl) {
    try {
      _musicEl = new Audio(`music/main_theme.mp3?v=${VERSION}`);
      _musicEl.loop = true;
      _musicEl.preload = 'auto';
      _musicEl.volume = MUSIC_VOLUME;
    } catch (e) { _musicEl = null; return Promise.resolve(false); }
  }
  return Promise.resolve(_musicEl.play()).then(() => { _musicStarted = true; return true; }, () => false);
}
function _pauseMusic() {
  if (_musicEl) { try { _musicEl.pause(); } catch (e) {} }
}
_loadSfx();

const TILE = 120;
const MARGIN = 60;
const LOGO_H = 160;
const PREVIEW_H = 40;
const BOARD_PX = TILE * 8;
const INV_COLS = 8, INV_ROWS = 1, INV_SLOT = TILE, INV_PAD = 0;
const INV_W = BOARD_PX;
canvas.width = MARGIN + BOARD_PX + MARGIN;
canvas.height = 1920;
const INV_X = MARGIN;

const LIGHT = "#edcea0";
const DARK = "#b5855a";
const SEL_COLOR = "rgba(50,120,200,0.5)";
const MOVE_COLOR = "rgba(100,180,60,0.55)";
const LEAP_BTN_COLOR = "#2a6e3f";
const LEAP_BTN_DISABLED = "#555";

const NONE = 0, PAWN = 1, ROOK = 2, KNIGHT = 3, BISHOP = 4, QUEEN = 5, KING = 6, CHEST = 7, CHECKERS = 8, CHECKERS_KING = 9;
const W = 1, B = 2, N = 3;
const GRAVE_TYPES = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, CHECKERS, CHECKERS_KING];

const PIECE_NAMES = { [PAWN]: "pawn", [ROOK]: "rook", [KNIGHT]: "knight", [BISHOP]: "bishop", [QUEEN]: "queen", [KING]: "king", [CHECKERS]: "checkers", [CHECKERS_KING]: "checkers_king" };
const SIDE_PREFIX = { [W]: "w", [B]: "b", [N]: "n" };
const spriteImages = {};
let spritesLoaded = false;
let _continued = false; // player pressed Continue on the loading screen (also unlocks audio)
let _loadCount = 0, _loadTotal = 0;
let _splashRafId = null;

const SIDE_TINT = { [B]: 'rgb(40,30,80)', [N]: 'rgb(140,140,140)' };

// Animated idle sprite metadata
const ANIM_PIECE_NAMES = { [PAWN]: 'Pawn', [ROOK]: 'Rook', [KNIGHT]: 'Knight', [BISHOP]: 'Bishop', [QUEEN]: 'Queen', [KING]: 'King' };
const ANIM_FRAME_COUNTS = {
  idle:   { [PAWN]: 3, [ROOK]: 3, [KNIGHT]: 3, [BISHOP]: 3, [QUEEN]: 3, [KING]: 3 },
  active: { [PAWN]: 3, [ROOK]: 3, [KNIGHT]: 3, [BISHOP]: 3, [QUEEN]: 4, [KING]: 3 },
};
let _idleAnimFrame = 0;
let _idleAnimRafId = null;
let _idleAnimLastMs = 0;
const IDLE_ANIM_MS = 180;
function _idleAnimTick(now) {
  if (now - _idleAnimLastMs >= IDLE_ANIM_MS) { _idleAnimFrame++; _idleAnimLastMs = now; draw(); }
  _idleAnimRafId = requestAnimationFrame(_idleAnimTick);
}
function startIdleAnim() {
  if (_idleAnimRafId) return;
  _idleAnimLastMs = performance.now();
  _idleAnimRafId = requestAnimationFrame(_idleAnimTick);
}

// ─── Capture screen-shake ────────────────────────────────────────────────────
// On a taking: the board briefly jiggles left/right and resting pieces do a little hop.
let _captureShakeStart = 0;
let _captureShakeRaf = null;
const CAPTURE_SHAKE_DUR = 300;
function triggerCaptureShake() {
  _captureShakeStart = performance.now();
  if (_captureShakeRaf) return;
  const tick = () => {
    if (!_captureShakeStart || (performance.now() - _captureShakeStart) >= CAPTURE_SHAKE_DUR) {
      _captureShakeStart = 0; _captureShakeRaf = null; draw(); return; // final frame settles to rest
    }
    draw();
    _captureShakeRaf = requestAnimationFrame(tick);
  };
  _captureShakeRaf = requestAnimationFrame(tick);
}
function _captureShakeX() {
  if (!_captureShakeStart) return 0;
  const t = (performance.now() - _captureShakeStart) / CAPTURE_SHAKE_DUR;
  if (t >= 1) return 0;
  return Math.sin(t * Math.PI * 6) * 6 * (1 - t); // ~3 decaying left-right oscillations, ~6px
}
// Per-piece hop: each piece pops up once with a slight per-square stagger, so it reads as
// pieces hopping (not a uniform board bob). Returns a negative (upward) y offset.
function _pieceHopAt(i) {
  if (!_captureShakeStart) return 0;
  const HOP_DUR = 200;
  const stagger = ((i * 97) % 100) / 100 * 90; // 0..90ms stagger per square
  const le = (performance.now() - _captureShakeStart) - stagger;
  if (le <= 0 || le >= HOP_DUR) return 0;
  return -Math.sin(le / HOP_DUR * Math.PI) * 6; // ~6px hop up and back down
}

// Mobile browsers throttle/stop requestAnimationFrame while backgrounded and can drop the last
// rendered frame or evict decoded image data on resume — leaving pieces up but effect badges/
// sprites blank until the next paint. On return to foreground, revive the idle loop and force an
// immediate full repaint so all state (which is still in memory) re-renders. (State lives only in
// JS memory — no reload/persistence — so this is purely a rendering refresh.)
function _onBecomeVisible() {
  if (typeof document !== 'undefined' && document.hidden) return;
  _idleAnimLastMs = performance.now();
  if (!_idleAnimRafId) _idleAnimRafId = requestAnimationFrame(_idleAnimTick);
  if (typeof draw === 'function' && spritesLoaded) draw();
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', _onBecomeVisible);
if (typeof window !== 'undefined') { window.addEventListener('pageshow', _onBecomeVisible); window.addEventListener('focus', _onBecomeVisible); }

// Strip the white background from a PNG via edge-flood-fill, preserving white fills
// inside black outline boundaries. Called once per frame at load time.
function _makeTransparentBg(img) {
  const oc = document.createElement('canvas');
  const w = img.naturalWidth, h = img.naturalHeight;
  oc.width = w; oc.height = h;
  const oc2 = oc.getContext('2d');
  oc2.drawImage(img, 0, 0);
  const d = oc2.getImageData(0, 0, w, h);
  const px = d.data;
  const isNearWhite = i => px[i] > 220 && px[i+1] > 220 && px[i+2] > 220;
  // BFS from all near-white edge pixels outward — only background pixels are reachable.
  const visited = new Uint8Array(w * h);
  const queue = [];
  const seed = pi => { if (!visited[pi] && isNearWhite(pi * 4)) { visited[pi] = 1; queue.push(pi); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { seed(y * w); seed(y * w + w - 1); }
  let head = 0;
  while (head < queue.length) {
    const pi = queue[head++];
    px[pi * 4 + 3] = 0;
    const x = pi % w, y = (pi / w) | 0;
    if (x > 0)     seed(pi - 1);
    if (x < w - 1) seed(pi + 1);
    if (y > 0)     seed(pi - w);
    if (y < h - 1) seed(pi + w);
  }
  oc2.putImageData(d, 0, 0);
  // Find the lowest row that contains non-transparent pixels (content bottom).
  let contentBottom = h - 1;
  outer: for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 0) { contentBottom = y; break outer; }
    }
  }
  oc._contentBottom = contentBottom;
  return oc;
}

// Bake a tinted offscreen canvas from a sprite. Called once per side+piece, result cached.
function _makeTinted(img, color) {
  const w = img.width || img.naturalWidth || 256;
  const h = img.height || img.naturalHeight || 256;
  const oc = document.createElement('canvas');
  oc.width = w; oc.height = h;
  const oc2 = oc.getContext('2d');
  oc2.drawImage(img, 0, 0, w, h);
  oc2.globalCompositeOperation = 'multiply';
  oc2.fillStyle = color;
  oc2.fillRect(0, 0, w, h);
  oc2.globalCompositeOperation = 'destination-in';
  oc2.drawImage(img, 0, 0, w, h);
  return oc;
}

// Draws any piece sprite, tinting for B/N sides using the W sprite as base.
// Tinted canvases are lazily baked and cached in spriteImages on first use.
// isActive: true to show the Active Idle animation frame (e.g. piece is selected).
const PIECE_SCALE = { [PAWN]: 0.9, [KNIGHT]: 1.2 };
function _drawPieceSprite(ctx, side, piece, dx, dy, dw, dh, isActive = false, halfSpeed = false, forceStatic = false) {
  // Animated sprite path
  if (!forceStatic && ANIM_PIECE_NAMES[piece]) {
    const state = isActive ? 'active' : 'idle';
    const nFrames = ANIM_FRAME_COUNTS[state][piece];
    const animTick = halfSpeed ? Math.floor(_idleAnimFrame / 2) : _idleAnimFrame;
    const queenActive = (piece === QUEEN && isActive);
    let frame;
    if (queenActive || nFrames <= 1) {
      frame = (animTick % nFrames) + 1;
    } else {
      const cycleLen = (nFrames - 1) * 2;
      const pos = animTick % cycleLen;
      frame = (pos < nFrames ? pos : cycleLen - pos) + 1;
    }
    const baseKey = `anim_${state}_${piece}_${frame}`;
    let animImg = spriteImages[baseKey];
    if (animImg) {
      if (side !== W) {
        const tintKey = `${baseKey}_t${side}`;
        if (!spriteImages[tintKey]) spriteImages[tintKey] = _makeTinted(animImg, SIDE_TINT[side]);
        animImg = spriteImages[tintKey];
      }
      const aw = animImg.width, ah = animImg.height;
      // Apply per-piece scale (Pawn shrinks, Knight enlarges) then scale by width.
      const psc = PIECE_SCALE[piece];
      if (psc) { dx += dw * (1 - psc) / 2; dw *= psc; }
      const scale = dw / aw;
      const fw = dw, fh = ah * scale;
      const feetY = (animImg._contentBottom ?? ah - 1) * scale;
      ctx.drawImage(animImg, dx, dy + dh - feetY, fw, fh);
      return;
    }
  }
  // Static sprite fallback
  const wImg = spriteImages[`${W}_${piece}`];
  if (!wImg || !wImg.complete) return;
  const sc = PIECE_SCALE[piece];
  if (sc) { dx += dw * (1 - sc) / 2; dy += dh * (1 - sc); dw *= sc; dh *= sc; }
  if (side === W) { ctx.drawImage(wImg, dx, dy, dw, dh); return; }
  const key = `${side}_${piece}`;
  if (!spriteImages[key]) spriteImages[key] = _makeTinted(wImg, SIDE_TINT[side]);
  ctx.drawImage(spriteImages[key], dx, dy, dw, dh);
}

// _drawTinted for callers that pass an img directly (fly/void-death animations).
function _drawTinted(ctx, img, side, dx, dy, dw, dh) {
  for (const p of [PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING, CHECKERS, CHECKERS_KING]) {
    if (spriteImages[`${W}_${p}`] === img) { _drawPieceSprite(ctx, side, p, dx, dy, dw, dh); return; }
  }
  // Fallback: bake inline (should rarely happen)
  ctx.drawImage(_makeTinted(img, SIDE_TINT[side]), 0, 0, 256, 256, dx, dy, dw, dh);
}

function _drawSplash() {
  const W2 = canvas.width, H2 = canvas.height;
  ctx.clearRect(0, 0, W2, H2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, W2, H2);
  const cx = W2 / 2, cy = H2 * 0.38;
  // Logo if available
  const logo = spriteImages['logo'];
  if (logo && logo.complete && logo.naturalWidth > 0) {
    const lw = Math.min(W2 * 0.55, 340), lh = lw * (logo.naturalHeight / logo.naturalWidth);
    ctx.drawImage(logo, cx - lw / 2, cy - lh / 2 - 60, lw, lh);
  } else {
    ctx.fillStyle = '#c8a060';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Taken Kings', cx, cy - 40);
  }
  // Progress bar
  const barW = Math.min(W2 * 0.55, 340), barH = 18, barX = cx - barW / 2, barY = cy + 80;
  const pct = _loadTotal > 0 ? _loadCount / _loadTotal : 0;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, barH / 2); ctx.fill();
  if (pct > 0) {
    ctx.fillStyle = '#c8a060';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW * pct, barH, barH / 2); ctx.fill();
  }
  // Status label beneath the bar
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(spritesLoaded ? 'Loading Complete' : 'Loading…', cx, barY + barH + 16);
  ctx.textBaseline = 'alphabetic';
  if (spritesLoaded) {
    // Continue button below the label (its tap unlocks audio per browser autoplay policy).
    const r = _continueBtnRect();
    ctx.fillStyle = '#2a6e3f';
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 12); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '48px Canterbury';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Continue', r.x + r.w / 2, r.y + r.h / 2 + 2);
    return; // static frame, no rAF
  }
  _splashRafId = requestAnimationFrame(_drawSplash);
}

function _continueBtnRect() {
  const W2 = canvas.width, H2 = canvas.height;
  const w = Math.min(W2 * 0.5, 320), h = 84;
  return { x: (W2 - w) / 2, y: H2 * 0.38 + 172, w, h }; // below the "Loading Complete" label
}

// --- Start-screen video: a looping attract clip shown once loading completes; tapping it
// unlocks audio and enters the main menu. Falls back to the on-canvas "Continue" button if the
// video fails.
let _startVideo = null;
function _createStartVideo() {
  if (_startVideo) return;
  try {
    const wrap = document.getElementById('game-wrap');
    if (!wrap || typeof wrap.appendChild !== 'function') return;
    const v = document.createElement('video');
    if (!v || typeof v.play !== 'function') return; // headless stub — bail
    v.src = 'start_screen_2_1080.mp4';
    v.loop = true; v.muted = true; v.defaultMuted = true; v.autoplay = false;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('preload', 'auto');
    v.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; pointer-events:none; background:#1a1a2e; display:none; z-index:5;';
    v.addEventListener('error', () => { v.style.display = 'none'; }); // fall back to the Continue button
    wrap.appendChild(v);
    _startVideo = v;
    v.load(); // begin buffering during sprite load so it's ready the instant loading completes
  } catch (e) {}
}
function _showStartScreen() { // attract video ON TOP of the canvas (covers the splash / fallback)
  if (_continued) return;
  if (!_startVideo) _createStartVideo();
  if (!_startVideo) return;
  _startVideo.style.display = 'block';
  try { _startVideo.currentTime = 0; } catch (e) {}
  const p = _startVideo.play(); if (p && p.catch) p.catch(() => {});
}
function _hideStartScreen() {
  if (!_startVideo) return;
  try { _startVideo.pause(); } catch (e) {}
  _startVideo.style.display = 'none';
}

// --- Menu background: the gameplay ground texture, slowly scrolling up. It backs the main menu
// and the Achievements / Leaderboard screens. Pressing Play freezes the scroll; the frozen
// offset carries into drawBackground so it becomes the static gameplay background with no jump.
let _menuScrollY = 0;
let _menuScrollLastMs = 0;
let _menuBgRaf = null;
const MENU_SCROLL_PXPS = 33; // slow upward drift, px/sec
function _menuBgActive() {
  if (!spritesLoaded || !_continued) return false;      // start screen shows the video, not the ground
  return mainMenuOpen || achievementsOpen || leaderboardOpen;
}
function _menuBgTick(now) {
  if (!_menuBgActive()) { _menuBgRaf = null; _menuScrollLastMs = 0; return; }
  if (_menuScrollLastMs) _menuScrollY -= MENU_SCROLL_PXPS * (now - _menuScrollLastMs) / 1000;
  _menuScrollLastMs = now;
  if (!_menuTransition) draw(); // during the entry transition, _menuTransitionTick drives drawing
  _menuBgRaf = requestAnimationFrame(_menuBgTick);
}
function startMenuBg() {
  if (_menuBgRaf) return;
  _menuScrollLastMs = performance.now();
  _menuBgRaf = requestAnimationFrame(_menuBgTick);
}
// Pressing Play: instead of freezing the scroll dead, let it coast to a stop over a short window
// (velocity eased to 0). drawBackground reads _menuScrollY, so the setup/gameplay ground glides.
let _menuDecelRaf = null;
const _MENU_DECEL_MS = 750;
function _startMenuDecel() {
  if (_menuBgRaf) { cancelAnimationFrame(_menuBgRaf); _menuBgRaf = null; _menuScrollLastMs = 0; }
  if (_menuDecelRaf) cancelAnimationFrame(_menuDecelRaf);
  const t0 = performance.now();
  let last = t0;
  const v0 = -MENU_SCROLL_PXPS; // current velocity, px/sec (scroll decrements)
  const tick = (now) => {
    const el = now - t0, dt = now - last; last = now;
    if (el >= _MENU_DECEL_MS) { _menuDecelRaf = null; draw(); return; }
    const v = v0 * (1 - el / _MENU_DECEL_MS) * (1 - el / _MENU_DECEL_MS); // quadratic ease-out to 0
    _menuScrollY += v * dt / 1000;
    draw();
    _menuDecelRaf = requestAnimationFrame(tick);
  };
  _menuDecelRaf = requestAnimationFrame(tick);
}
// Tiled ground background used by the menu screens. `scrim` (0..1) darkens it for legibility.
function drawScrollingGround(scrim) {
  ctx.fillStyle = "#1a1a2e"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const groundEl = spriteImages["ground"];
  if (groundEl && groundEl.complete && groundEl.naturalWidth > 0) {
    const gw = groundEl.naturalWidth, gh = groundEl.naturalHeight;
    const scale = canvas.width / gw, tileH = gh * scale;
    const startY = -((_menuScrollY % tileH) + tileH) % tileH;
    for (let ty = startY; ty < canvas.height; ty += tileH) ctx.drawImage(groundEl, 0, ty, canvas.width, tileH);
  }
  if (scrim) { ctx.fillStyle = `rgba(12,12,30,${scrim})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
}

// On-canvas start-screen fallback (drawn under the video; visible only if the video fails).
function drawStartScreen() {
  drawScrollingGround(0.28);
  const W2 = canvas.width, H2 = canvas.height, cx = W2 / 2, cy = H2 * 0.38;
  const logo = spriteImages['logo'];
  if (logo && logo.complete && logo.naturalWidth > 0) {
    const lw = Math.min(W2 * 0.62, 440), lh = lw * (logo.naturalHeight / logo.naturalWidth);
    ctx.drawImage(logo, cx - lw / 2, cy - lh / 2 - 40, lw, lh);
  } else {
    ctx.fillStyle = '#c8a060'; ctx.font = '76px Canterbury'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Taken Kings', cx, cy - 40);
  }
  drawUIButton(_continueBtnRect(), { color: '#2a6e3f', label: 'Continue', radius: 12, font: '48px Canterbury', stroke: 'rgba(255,255,255,0.35)', dy: 2 });
  ctx.textBaseline = 'alphabetic';
}

// Tapping the start screen: unlock audio + enter the main menu. White-circle "iris" transition
// from the tap point: grow to swallow the screen in white, then fade out to reveal the main menu
// (with its scrolling-ground background). The video frame is snapshotted first (it's an HTML
// overlay above the canvas), then hidden so the whole transition renders on the canvas.
let _menuTransition = null;
const _MENU_GROW_MS = 240, _MENU_FADE_MS = 320;
function _menuTransitionTick() {
  if (!_menuTransition) return;
  const t = _menuTransition, el = performance.now() - t.startMs;
  if (el < _MENU_GROW_MS) {
    ctx.drawImage(t.snap, 0, 0);                        // the frozen start-screen frame
    const r = t.maxR * easeOut(el / _MENU_GROW_MS);     // grow the white circle to fill the screen
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
    requestAnimationFrame(_menuTransitionTick);
  } else if (el < _MENU_GROW_MS + _MENU_FADE_MS) {
    draw();                                             // the main menu (scrolling ground + buttons)
    const p = (el - _MENU_GROW_MS) / _MENU_FADE_MS;
    ctx.save();
    ctx.globalAlpha = 1 - easeOut(p);                   // fade the full-screen white out to the menu
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    requestAnimationFrame(_menuTransitionTick);
  } else {
    _menuTransition = null;
    startMenuBg();                                      // now begin the continuous ground scroll
    draw();
  }
}

function _doContinue(tapX, tapY) {
  if (_continued || !spritesLoaded) return;
  _continued = true;
  mainMenuOpen = true; // the start screen leads into the main menu (Play / Achievements / Leaderboard)
  _sfxUnlockCtx();
  playSfx('button');
  // Freeze the current start-screen frame onto an offscreen canvas, then hide the video so the
  // whole transition renders on the game canvas.
  const snap = document.createElement('canvas');
  snap.width = canvas.width; snap.height = canvas.height;
  const sctx = snap.getContext('2d');
  sctx.fillStyle = '#1a1a2e'; sctx.fillRect(0, 0, snap.width, snap.height);
  try { if (_startVideo && _startVideo.readyState >= 2) sctx.drawImage(_startVideo, 0, 0, snap.width, snap.height); } catch (e) {}
  _hideStartScreen();
  const x = (tapX != null && !isNaN(tapX)) ? tapX : canvas.width / 2;
  const y = (tapY != null && !isNaN(tapY)) ? tapY : canvas.height / 2;
  const maxR = Math.hypot(Math.max(x, canvas.width - x), Math.max(y, canvas.height - y)); // reach the farthest corner
  _menuTransition = { x, y, maxR, snap, startMs: performance.now() };
  requestAnimationFrame(_menuTransitionTick);
}

function loadSprites() {
  const spriteList = [
    ['logo',            'sprites/logo_2.png?v=1'],
    [`${W}_${PAWN}`,    'sprites/pawn.png'],
    [`${W}_${KING}`,    'sprites/king.png'],
    [`${W}_${QUEEN}`,   'sprites/Queen.png'],
    [`${W}_${KNIGHT}`,  'sprites/knight.png'],
    [`${W}_${BISHOP}`,  'sprites/bishop_1.png'],
    [`${W}_${ROOK}`,    'sprites/rook.png'],
    [`${W}_${CHECKERS}`, `sprites/w_${PIECE_NAMES[CHECKERS]}.svg`],
    [`${W}_${CHECKERS_KING}`, `sprites/w_${PIECE_NAMES[CHECKERS_KING]}.svg`],
    ['chest',           'sprites/chest.svg'],
    ['item_teleporter', 'sprites/item_teleporter.svg'],
    ['item_cloner',     'sprites/item_cloner.svg'],
    ['item_upgrader',   'sprites/item_upgrader.svg?v=2'],
    ['item_bomb',       'sprites/item_bomb.svg'],
    ['item_sword',      'sprites/item_sword.svg'],
    ['item_boots',      'sprites/item_boots.svg'],
    ['explosion',       'sprites/explosion.svg'],
    ['ground',          'sprites/Ground.png'],
    ['merchant',        'sprites/merchant.svg'],
    ['king_profile',    'sprites/king_profile.png'],
  ];
  // Conquest animation frames — loaded here so the splash covers them
  for (let ci = 0; ci < CONQUEST_FRAME_COUNT; ci++) {
    spriteList.push([`conquest_${ci}`, `animations/begin conquest frames/Begin Conquest -${ci}.png`]);
  }

  // Animated idle/active-idle frames
  const ANIM_BASE = "sprites/1 Package (ActiveIdle sprites)/1 Package (Active_Idle sprites)";
  for (const [piece, pieceName] of Object.entries(ANIM_PIECE_NAMES)) {
    for (const [stateKey, stateName] of [['idle', 'Idle'], ['active', 'Active Idle']]) {
      const nFrames = ANIM_FRAME_COUNTS[stateKey][piece];
      for (let f = 1; f <= nFrames; f++) {
        const key = `anim_${stateKey}_${piece}_${f}`;
        const rawPath = `${ANIM_BASE}/${pieceName}/Animations/${stateName}/${pieceName} ${stateName} ${f}.png`;
        const src = rawPath.split('/').map(s => encodeURIComponent(s)).join('/');
        spriteList.push([key, src, true]);
      }
    }
  }

  _loadTotal = spriteList.length;
  _loadCount = 0;
  const done = (key, img, processed) => {
    if (key.startsWith('conquest_')) {
      const ci = parseInt(key.slice(9));
      if (!isNaN(ci)) _conquestFrames[ci] = img;
    } else {
      if (key === 'logo') spriteImages['logo'] = img;
      spriteImages[key] = processed ?? img;
    }
    _loadCount++;
    if (_loadCount >= _loadTotal && !spritesLoaded) {
      spritesLoaded = true;
      _conquestFramesReady = true;
      if (_splashRafId) { cancelAnimationFrame(_splashRafId); _splashRafId = null; }
      _showStartScreen(); // attract-loop video over the canvas; tap enters the menu
      draw();             // draws the Continue-button fallback beneath (covered by the video if it plays)
    }
  };
  for (const [key, src, needsBg] of spriteList) {
    const img = new Image();
    let _tries = 0;
    img.onload = () => done(key, img, needsBg ? _makeTransparentBg(img) : null);
    // Retry a failed fetch (cache-busted) before giving up — a cold first load of a new version pulls
    // ~90 large conquest frames at once and an individual request can drop under memory/network
    // pressure. Without the retry that frame becomes null, and the intro used to freeze on it.
    img.onerror = () => {
      if (_tries < 2) { _tries++; img.src = src + (src.includes('?') ? '&' : '?') + 'retry=' + _tries; }
      else done(key, null, null);
    };
    img.src = src;
  }
}

let board = new Array(64).fill(NONE);
let sides = new Array(64).fill(0);
let health = new Array(64).fill(1);
let selected = -1;
let validMoves = [];
let _inspectIdx = -1; // last square the player tapped this turn — drawn as a marker ring (render-only)
let _inspectPreviewCol = -1; // last preview-row (fog) column the player tapped — its own marker ring (render-only)
let _checkersChainIdx = -1; // board index of White Checkers Man mid chain-jump; -1 if not in chain
let _bloodthirstyIdx = -1;  // board index of Bloodthirsty piece mid extra-move; -1 if not active
let _bloodthirstyUsed = false; // true if BT extra move already granted this turn (no chaining)
function _resetTurnState() { _speedIdx = -1; _speedMovesUsed = 0; _bloodthirstyIdx = -1; _bloodthirstyUsed = false; }
let turn = W;
let lastActingSide = B; // tracks who made the last actual move; used by manual field advance
let gameOver = false;
let gameMsg = "";
let score = 0;
let gold = 0;
let _lostWhiteThisRun = false; // any White piece died this run (for the "no losses" achievement)
let _runStartMs = 0;           // wall-clock start of the current run (for timed achievements)
let _king20TakenBy = NONE;     // piece type that captured the 20th Black King (0 if not via a direct capture)
let _recruitedCManThisRun = false;  // recruited a Grey Checkers Man this run
let _recruitedCKingThisRun = false; // recruited a Grey Checkers King this run
let _maxGoldThisRun = 0;            // high-water mark of gold held this run
let _usedItemThisRun = false;       // consumed any inventory item this run (for the no-item achievement)
let _startedClassic = false;        // this run began from the Classic setup
let _startCounts = {};              // White piece-type counts at run start (for "starting with N of X")
let _had4KingsAt25 = false;         // had ≥4 White Kings on the team when the 25th Black King fell
let _timedOutThisRun = false;       // a turn ran out of time this run (for the no-timeout achievement)
// Per-White-turn counters (reset at the end of each White turn):
let _turnKingsTaken = 0;            // Black Kings taken this turn (any means)
let _turnActorTakes = 0;            // Black warriors taken by the single acting White piece this turn
let _turnActorType = NONE;          // type of that acting piece
let _turnActorBuffed = false;       // was it Fast (speed>1) or Bloodthirsty on its first take
let _turnBombKills = 0;             // Black warriors killed by a Bomb this turn
let _turnBombFromInv = false;       // a Bomb used from inventory this turn
let _turnBombFromSquare = false;    // a Bomb triggered by moving onto a board Bomb square this turn
let _turnSells = 0;                 // items sold this turn
let _bombSource = '';               // 'inv' | 'square' — source of the currently-detonating bomb
let _turnRecruited = false;         // recruited a Grey this turn (for the 3-in-a-row streak)
let _turnFastBounced = new Set();   // squares a Fast White piece bounced off (shield-damaged) this turn
// Event flags / streaks (per run unless noted):
let _tookShieldedKingWithSword = false; // 30
let _pushedBlackIntoVoidByWater = false; // 28
let _pushedBlackIntoBombByWater = false; // 29
let _waterShoveActive = false;      // a water-wave shove is currently applying (attributes shoves to a Water piece)
let _tookShieldedWithDoubleHit = false; // 40
let _recruitedWithCKing = false;    // 33
let _recruitStreak = 0;             // consecutive turns recruiting a Grey (32)
let _bombStreak = 0;                // consecutive turns taking ≥1 Black with a Bomb (49)
let _flawlessAdvances = 0;          // consecutive Field Advances with no King taken / White lost (50)
let _lastAdvanceScore = 0;          // score at the previous Field Advance (50)
let _whiteLostSinceAdvance = false; // a White piece died since the previous Field Advance (50)

function _resetTurnCounters() {
  _turnKingsTaken = 0; _turnActorTakes = 0; _turnActorType = NONE; _turnActorBuffed = false;
  _turnBombKills = 0; _turnBombFromInv = false; _turnBombFromSquare = false; _turnSells = 0;
  _turnRecruited = false; _turnFastBounced = new Set();
}
// White's turn is over (via move, Team Advance, or Field Advance): fold this turn's
// activity into the streak trackers, then clear the per-turn counters.
function _turnBoundaryUpdate() {
  _recruitStreak = _turnRecruited ? _recruitStreak + 1 : 0;
  _bombStreak = _turnBombKills > 0 ? _bombStreak + 1 : 0;
  _resetTurnCounters();
  _rngEpochBump(); // re-anchor the RNG to this turn's substream (before the Black/neutral/spawn rolls)
}
// Record a Black warrior taken by the acting White piece (called real-only from makeMove).
function _trackWhiteTake(pieceMoved, fromI, capturedPiece) {
  if (_turnActorTakes === 0) { _turnActorType = pieceMoved; _turnActorBuffed = (speeds[fromI] > 1) || !!(statuses[fromI] & STATUS_BLOODTHIRSTY); }
  _turnActorTakes++;
  if (capturedPiece === KING || capturedPiece === CHECKERS_KING) _turnKingsTaken++;
  // The King praises the taker (non-King victims only — King takes belong to the tookKing lines).
  else if (_KING_CAP_KEY[pieceMoved]) _kingQueue(_KING_CAP_KEY[pieceMoved]);
}
let spawnCount = 1;
let leapCount = 0;
let nextWave = []; // array of {x, piece} for preview
let nextBonuses = []; // [{type:'chest'|'item'|'void'|'block'|'grey'|'river', col, ...}]
let positionHistory = []; // track board states to detect repetition
let replaySnapshots = [];
let replayMode = false;
let replayIdx = 0;
let replayAutoPlay = false;
let replayAutoTimer = null;
let _replayAnimBuffer = [];
let _replayTransitions = [];
const ITEM_NONE = 0;
const ITEM_TELEPORTER = 4, ITEM_CLONER = 6, ITEM_SHIELD = 7, ITEM_BOMB = 8, ITEM_REWINDER = 9;
const ITEM_PROMOTER_BASE = 100; // encoded: base + to (ROOK/KNIGHT/BISHOP/QUEEN/9=wild); always promotes a Pawn
const PROMOTER_WILD = 9;
function isPromoterItem(item) { return item >= ITEM_PROMOTER_BASE && item < 200; }
function promoterTo(item) { return item - ITEM_PROMOTER_BASE; }
function makePromoterItem(to) { return ITEM_PROMOTER_BASE + to; }
const ITEM_PROMOTER_WILD = makePromoterItem(PROMOTER_WILD);

// Elemental system — bitmask flags, stackable per piece
const ELEM_FIRE  = 1;
const ELEM_WATER = 2;
const ELEM_EARTH = 4;
const ELEM_AIR   = 8;

// Status bitmask flags (separate from elements)
const STATUS_BLOODTHIRSTY = 1;
const ELEM_ALL   = [ELEM_FIRE, ELEM_WATER, ELEM_EARTH, ELEM_AIR];
const ELEM_COLORS = { [ELEM_FIRE]: '#ff4400', [ELEM_WATER]: '#22aaff', [ELEM_EARTH]: '#886600', [ELEM_AIR]: '#aaeeff' };
const ELEM_NAMES  = { [ELEM_FIRE]: 'Fire', [ELEM_WATER]: 'Water', [ELEM_EARTH]: 'Earth', [ELEM_AIR]: 'Air' };
// Elementalizer items: base=200, specific = base+flag, mystery = base+0
const ITEM_ELEM_MYSTERY = 200;
const ITEM_ELEM_FIRE    = 200 + ELEM_FIRE;   // 201
const ITEM_ELEM_WATER   = 200 + ELEM_WATER;  // 202
const ITEM_ELEM_EARTH   = 200 + ELEM_EARTH;  // 204
const ITEM_ELEM_AIR     = 200 + ELEM_AIR;    // 208
function isElementalizerItem(item) { return item >= 200 && item <= 215; }
function elemFromItem(item, rng = true) {
  const flag = item - 200;
  return flag === 0 ? (rng ? ELEM_ALL[randInt(4)] : ELEM_FIRE) : flag;
}
function elementizerItemName(item) {
  if (item === ITEM_ELEM_MYSTERY) return 'Mystery Essence';
  return ELEM_NAMES[item - 200] + ' Essence';
}

const ITEM_VAMPIRE_FANG = 300;
const ITEM_SWORD = 301;
const ITEM_BOOTS = 302;

const ITEM_NAMES = {
  [ITEM_TELEPORTER]: "Teleporter", [ITEM_CLONER]: "Cloner", [ITEM_SHIELD]: "Shield", [ITEM_BOMB]: "Bomb", [ITEM_REWINDER]: "Rewinder",
  [ITEM_VAMPIRE_FANG]: "Vampire Fang", [ITEM_SWORD]: "Mighty Blade", [ITEM_BOOTS]: "Fast Boots"
};
function itemName(item) {
  if (isPromoterItem(item)) return promoterTo(item) === PROMOTER_WILD ? "Mystery Promoter" : `Promoter to ${(PIECE_NAMES[promoterTo(item)] || "?")[0].toUpperCase() + (PIECE_NAMES[promoterTo(item)] || "?").slice(1)}`;
  if (isElementalizerItem(item)) return elementizerItemName(item);
  return ITEM_NAMES[item] || "?";
}
let inventory = new Array(INV_COLS * INV_ROWS).fill(ITEM_NONE);
let dragSlot = -1, dragX = 0, dragY = 0, dragOverTrash = false, dragConsumed = false;
let _pendingDrag = null; // { slot, startX, startY, startMs } — promoted to dragSlot after threshold
let playerDead = {}, enemyDead = {}, flyAnims = [], itemFlyAnims = [], itemFlySlots = new Set();
let chestSpaces = new Set(); // floor-marker chests — coexist with any board piece
let shieldPops = [];
let warnFlashRunning = false;
let voidPulseRunning = false;
let chestBobRunning = false;
let voidDeathAnim = null; // {items:[{cx,cy,piece,side}], startMs, onDone}
let explosionAnim = null; // {cx, cy, startMs}
let waveAnim = null; // {squares:[idx...], startMs, dur, onDone} — water wave sweep
let pendingCaptures = {}; // boardIdx -> {piece, side} — removed from board but still rendered until hop arrives
let piecePromoterMode = false;
let piecePromoterTo = NONE;
let teleporterMode = false;
let teleporterSelected = -1;
let bombMode = false;
let bombHoverIdx = -1;
let clonerMode = false;
let clonerSelected = -1;
let shieldMode = false;
let shiftCountdown = 10;
let itemSpaces = new Array(64).fill(ITEM_NONE);
let _shadowSpaces = new Map(); // idx → item (shadow shown, item falls next end-of-round)
let effectOrders = Array.from({length: 64}, () => []); // per-square ordered list of effect keys
let _skyDropAnims = []; // {item, i, startMs, dur} — items falling from sky

let activeItemSpaceIdx = -1; // item space currently pending interactive resolution
let pendingItemQueue = []; // {item, i} pairs queued after a Team Advance
let specialSpaces = new Array(64).fill(null); // {type:'void'|'block'|'river', ...}
let shopMode = false;
let shopOffers = []; // items shown in merchant shop dialog
let shopOnDone = null; // callback after shop closes (null for merchant — doesn't consume turn)
let merchantIdx = -1; // board position of Merchant NPC (-1 = not on board)
let merchantOffers = []; // 3 items; all rerolled every field advance
let merchantSold = [false, false, false]; // sold state per slot; persists until the next field advance
const MERCHANT_REROLL_CYCLE = 1; // field advances the wares hold before a full reroll (1 = every advance)
let merchantRerollCountdown = MERCHANT_REROLL_CYCLE; // advances remaining until wares reroll
let merchantQueued = false; // merchant is waiting in the fog preview row
let merchantQueuedCol = -1; // which column he'll enter from
let merchantPendingRespawn = false; // pushed into void mid-play; re-queue on next field advance
let elements = new Array(64).fill(0); // elemental bitmask per board square, travels with piece
let statuses = new Array(64).fill(0); // status bitmask per board square (e.g. STATUS_BLOODTHIRSTY)
let attacks = new Array(64).fill(1);  // attack power per board square; starts at 1, Attack Up adds +1
let speeds = new Array(64).fill(1);   // move count per turn; starts at 1, Speed Up adds +1
let burning = new Array(64).fill(0);  // rounds a piece has left before it burns up (0 = not on fire). Set to
                                      // 3 when a piece crosses opposing fire; ticks down once per round; a
                                      // crossed river extinguishes it. Travels with the piece.
let fireSquares = new Map(); // Map<boardIdx, {side, age}> — fire trail; ignites opposing pieces that cross it
let waterTrails = new Map(); // Map<boardIdx, {dx, dy, side, age}> — directional river trail a Water Warrior leaves in its wake; flows once per round (applyRiverFlow), pushes occupants one step, douses fire, ages out over 2 rounds
let elementizerMode = false;
let elementizerElem = 0; // resolved element flag for current elementalizer activation
let elementizerMystery = false; // true if the active elementalizer is Mystery (resolve on apply, not on activate)
let vampireFangMode = false;
let swordMode = false;
let speedMode = false;
let _speedIdx = -1;       // board index of piece currently in a speed multi-move sequence
let _speedMovesUsed = 0;  // extra speed moves used so far this turn

const ITEM_SPRITE_KEYS = {
  [ITEM_TELEPORTER]: "item_teleporter",
  [ITEM_CLONER]: "item_cloner",
  [ITEM_SHIELD]: "item_upgrader",
  [ITEM_BOMB]: "item_bomb",
  [ITEM_SWORD]: "item_sword",
  [ITEM_BOOTS]: "item_boots"
};
const _PROMOTER_TO_PRICE = { [ROOK]: 25, [KNIGHT]: 20, [BISHOP]: 20, [QUEEN]: 30, [PROMOTER_WILD]: 15 };
function itemPrice(item) {
  if (isPromoterItem(item)) return _PROMOTER_TO_PRICE[promoterTo(item)] || 20;
  return ITEM_PRICES[item] || 0;
}
const ITEM_PRICES = {
  [ITEM_TELEPORTER]: 30,
  [ITEM_CLONER]: 45,
  [ITEM_SHIELD]: 20,
  [ITEM_BOMB]: 35,
  [ITEM_REWINDER]: 50,
  [ITEM_ELEM_FIRE]: 25, [ITEM_ELEM_WATER]: 25, [ITEM_ELEM_EARTH]: 25, [ITEM_ELEM_AIR]: 25,
  [ITEM_ELEM_MYSTERY]: 20,
  [ITEM_VAMPIRE_FANG]: 60,
  [ITEM_SWORD]: 20,
  [ITEM_BOOTS]: 40,
};

let wkMoved = false;
let wraMoved = false, wrhMoved = false;
let epTarget = -1;
let aiThinking = false;

const AI_DEPTH = 3;   // iterative-deepening ceiling for Black's search
const HINT_DEPTH = 5;
// Hard node budget for Black's search. aiBestMove runs iterative deepening (search depth 1, then 2,
// … up to AI_DEPTH) sharing ONE budget across all depths; when it's exhausted mid-depth the search
// stops and Black plays the best move from the deepest FULLY-completed depth. This bounds a turn by
// the number of positions examined regardless of the pieces involved — a board full of phasing Air
// sliders explodes the branching factor, which the old Bmoves×Wmoves depth heuristic under-counted
// (few Black pieces kept the product low, so it stayed at depth 3 and searched a ~200-wide White
// layer twice → multi-second freezes). The budget is deterministic (fixed traversal order + fixed
// count), so live play and headless re-simulation examine the same nodes and choose the same move.
const AI_NODE_BUDGET = 20000; // total ceiling; because the search is sliced across frames (below), a
                              // big budget buys deeper play WITHOUT freezing — it just spreads over
                              // more frames. Pathological boards abort here and play best-so-far.
// Yield granularity: the search generator pauses every AI_SLICE_NODES nodes so the frame pump can
// check its time budget. Live play runs slices until ~AI_FRAME_MS of wall time has elapsed, then
// yields to requestAnimationFrame so the render loop paints — the enemy "thinks" without freezing.
// This adapts to device speed (a fast machine packs more slices per frame → quicker think; a slow
// one does fewer → still smooth). Re-sim ignores both and runs every slice back-to-back.
const AI_SLICE_NODES = 300;
const AI_FRAME_MS = 8;
let _aiNodesLeft = Infinity; // remaining budget during an aiBestMove search (Infinity = uncapped, e.g. hint search)
let _aiAborted = false;      // set true when the budget runs out mid-depth (that depth's result is discarded)
const PIECE_VALUE = { [NONE]: 0, [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 20000, [CHEST]: 0, [CHECKERS]: 150, [CHECKERS_KING]: 300 };
const GOLD_VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 15, [CHEST]: 0, [NONE]: 0, [CHECKERS]: 2, [CHECKERS_KING]: 30};
const SPAWN_PIECES = [PAWN, ROOK, KNIGHT, BISHOP, QUEEN];

const ANIM_MS = 180;
let anim = null; // {pieces:[{toIdx,fromCX,fromCY,toCX,toCY,piece,side,hlth}], boardDy, startMs, onDone}

function idx(x, y) { return y * 8 + x; }
function xy(i) { return [i % 8, Math.floor(i / 8)]; }
function inB(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8; }
function piece(x, y) { return inB(x, y) ? board[idx(x, y)] : NONE; }
function side(x, y) { return inB(x, y) ? sides[idx(x, y)] : 0; }
function set(x, y, p, s) { board[idx(x, y)] = p; sides[idx(x, y)] = s; }
function enemy(s) { return s === W ? B : W; }
function clearSquare(i) { board[i] = NONE; sides[i] = 0; health[i] = 1; elements[i] = 0; statuses[i] = 0; attacks[i] = 1; speeds[i] = 1; burning[i] = 0; effectOrders[i] = []; }
function copyPiece(src, dst) { board[dst] = board[src]; sides[dst] = sides[src]; health[dst] = health[src]; elements[dst] = elements[src]; statuses[dst] = statuses[src]; attacks[dst] = attacks[src]; speeds[dst] = speeds[src]; burning[dst] = burning[src]; effectOrders[dst] = [...effectOrders[src]]; }

// ─── Board-rebuild helpers ────────────────────────────────────────────────────
// The advance/shift operations (Team Advance, Field Advance, and their AI
// simulations) rebuild the per-square attribute arrays from scratch. These
// centralize that pattern. If a new per-square array is added, update these
// alongside _squareArrays.
// withOrders=false skips effectOrders (AI sims don't need the badge lists;
// withState save/restore covers them anyway).
function _blankSquares(withOrders = true) {
  return {
    board: new Array(64).fill(NONE), sides: new Array(64).fill(0),
    health: new Array(64).fill(1), elements: new Array(64).fill(0),
    statuses: new Array(64).fill(0), attacks: new Array(64).fill(1),
    speeds: new Array(64).fill(1), burning: new Array(64).fill(0),
    effectOrders: withOrders ? Array.from({ length: 64 }, () => []) : null,
  };
}
// Copy live square i's piece attributes into slot ni of a _blankSquares() set.
function _copySquareTo(n, i, ni) {
  n.board[ni] = board[i]; n.sides[ni] = sides[i]; n.health[ni] = health[i];
  n.elements[ni] = elements[i]; n.statuses[ni] = statuses[i];
  n.attacks[ni] = attacks[i]; n.speeds[ni] = speeds[i]; n.burning[ni] = burning[i];
  if (n.effectOrders) n.effectOrders[ni] = [...effectOrders[i]];
}
// Commit a _blankSquares() set into the live arrays.
function _commitSquares(n) {
  board.splice(0, 64, ...n.board); sides.splice(0, 64, ...n.sides);
  health.splice(0, 64, ...n.health); elements.splice(0, 64, ...n.elements);
  statuses.splice(0, 64, ...n.statuses); attacks.splice(0, 64, ...n.attacks);
  speeds.splice(0, 64, ...n.speeds); burning.splice(0, 64, ...n.burning);
  if (n.effectOrders) for (let i = 0; i < 64; i++) effectOrders[i] = n.effectOrders[i];
}
function _grantEffect(i, eff) { if (!effectOrders[i].includes(eff) && effectOrders[i].length < 3) effectOrders[i].push(eff); }
function _removeEffect(i, eff) { const k = effectOrders[i].indexOf(eff); if (k >= 0) effectOrders[i].splice(k, 1); }
function movePiece(src, dst) { copyPiece(src, dst); clearSquare(src); }

// Element flag → effect-badge key.
const _ELEM_BADGE = { [ELEM_FIRE]: 'fire', [ELEM_WATER]: 'water', [ELEM_EARTH]: 'earth', [ELEM_AIR]: 'air' };

// Board cell index under canvas coords, or -1 if off-board.
function cellIdxFromCoords(cx, cy) {
  const gx = Math.floor((cx - MARGIN) / TILE), gy = Math.floor((cy - BOARD_Y - MARGIN) / TILE);
  return inB(gx, gy) ? idx(gx, gy) : -1;
}

// Promote the pawn at i to a promoter item's target (rolling for wild).
function _promotePawnTo(item, i) {
  board[i] = promoterTo(item) === PROMOTER_WILD ? _rollWildTo() : promoterTo(item);
}

// Apply an elementalizer item to i: resolve element (mystery→random), OR-in flag + badge.
function _applyElementItem(item, i) {
  const elem = item === ITEM_ELEM_MYSTERY ? ELEM_ALL[randInt(4)] : elemFromItem(item, false);
  elements[i] |= elem;
  _grantEffect(i, _ELEM_BADGE[elem]);
  playSfx('spell'); // item grants a piece an effect
}

// Apply a stat-buff item (Shield/Sword/Boots/Fang) effect to i. Idempotent.
function _applyStatEffect(item, i) {
  switch (item) {
    case ITEM_SHIELD:       if (health[i] < 2)  { health[i] = 2;  _grantEffect(i, 'hlt'); } break;
    case ITEM_SWORD:        if (attacks[i] < 2) { attacks[i] = 2; _grantEffect(i, 'atk'); } break;
    case ITEM_BOOTS:        if (speeds[i] < 2)  { speeds[i] = 2;  _grantEffect(i, 'spd'); } break;
    case ITEM_VAMPIRE_FANG: statuses[i] |= STATUS_BLOODTHIRSTY;   _grantEffect(i, 'bt');  break;
  }
  playSfx('spell'); // item grants a piece an effect
}

// ─── Seeded RNG (deterministic gameplay for replay validation) ────────────────
// All GAMEPLAY randomness flows through _rng() (via randInt/shuffle and a few
// direct call sites), seeded once per run. Given the same seed + input log, a run
// reproduces bit-for-bit — the basis for server-side score validation.
// (Purely cosmetic randomness — e.g. SFX variant pick — stays on Math.random.)
let _rngState = 1;   // mulberry32 state
let _runSeed = 0;    // the seed this run was started from (recorded with the run)
let _replayInputs = []; // ordered log of the run's player inputs (for re-simulation)
let _autoPlayUsedThisRun = false; // auto-play engaged this run -> run is not leaderboard-eligible
let _instant = false; // headless re-sim: skip animations/audio/rendering/timers, run the turn flow synchronously
// Recorded Black minimax moves. Re-simulating a whole game is expensive ONLY because Black's main
// move is recomputed via minimax every turn; everything else (Black's greedy Speed/Bloodthirsty/chain
// extras, greys, merchant, spawns) is cheap and reproduces deterministically from the positional
// RNG. So we record just that one move per Black turn and, in re-sim, apply it instead of searching —
// turning verification into a cheap synchronous replay. A random fraction of turns are still
// recomputed and compared (spot-check) to catch a hacked client that made Black throw the game.
let _blackMoveLog = [];      // live: this run's recorded main Black moves (encoded from*64+to, -1 = no move)
let _replayBlack = null;     // re-sim: recorded log to apply (null => recompute Black, e.g. legacy runs)
let _replayBlackIdx = 0;
let _replaySpotRate = 0;     // re-sim: fraction of Black turns to recompute-and-verify (server sets ~0.1)
let _replaySpotFail = false; // re-sim: a spot-checked move disagreed with the recorded one -> reject
let _replaySpotRand = Math.random; // re-sim: spot-selection source. The server passes opts.spotSeed —
// derived from a SERVER SECRET + the run's semantic content — making the checked subset (a) fixed per
// run, so a rejected cheater can't just resubmit until the tampered turns dodge the sample, and
// (b) unpredictable to the client, so a cheater can't precompute which turns are safe to tamper.
function _encodeMove(m) { return m ? (m[0] * 64 + m[1]) : -1; }
function _decodeMove(c) { return c < 0 ? null : [(c / 64) | 0, c % 64]; }
// The one expensive Black decision per turn (full minimax at aiPlay). Live records it; re-sim replays
// the recorded move (cheap), recomputing only on spot-check turns to verify it matches.
// Compute Black's main move. `onDone(move)` is invoked when ready; in live play the underlying search
// is frame-sliced (non-blocking) and onDone fires later, while re-sim resolves synchronously (onDone,
// if given, is called inline). The recorded move is logged here so it's identical to a server recompute.
function _blackMainMove(onDone) {
  if (_replayBlack) {
    const rec = _replayBlackIdx < _replayBlack.length ? _replayBlack[_replayBlackIdx] : -1;
    _replayBlackIdx++;
    let m;
    if (_replaySpotRate > 0 && _replaySpotRand() < _replaySpotRate) { // spot-check: seeded server-side, stream-neutral
      m = aiBestMove();
      if (_encodeMove(m) !== rec) _replaySpotFail = true; // authoritative recompute (identical to rec when honest)
    } else {
      m = _decodeMove(rec);
    }
    return onDone ? onDone(m) : m;
  }
  const finish = (m) => {
    if (gamePhase === 'playing' && !replayMode && !_instant) _blackMoveLog.push(_encodeMove(m));
    return onDone ? onDone(m) : m;
  };
  if (onDone && !_instant) { aiBestMove(finish); return; } // live: frame-sliced, finish fires when done
  return finish(aiBestMove());                              // synchronous (re-sim / no callback)
}
// Log one player action into the run's input log. Only during real play (not replay,
// not the setup screen, not headless re-sim). The server replays these against a
// seed-reproduced world; everything else (AI moves, spawns, auto-advances, greys,
// merchant) is derived.
// `r` (RNG state at log time) is a diagnostic breadcrumb: the validator ignores it, but if a
// run ever re-simulates to a different score, comparing each input's recorded r against the
// re-sim's r pinpoints the exact input where live and replay diverged.
// `h` is a full game-state hash (board + every per-square aux array + key scalars): the r
// breadcrumb alone can't distinguish state divergences that consume equal RNG draws (seen in
// the 13-vs-5 mismatch, where live and re-sim boards split with identical RNG trails).
function _stateHash() {
  let h = 0x811c9dc5 | 0; // FNV-1a over the sim-relevant state
  const mix = (v) => { h = (h ^ (v | 0)) | 0; h = Math.imul(h, 0x01000193); };
  for (let i = 0; i < 64; i++) { mix(board[i]); mix(sides[i]); mix(health[i]); mix(elements[i]); mix(statuses[i]); mix(attacks[i]); mix(speeds[i]); mix(itemSpaces[i]); }
  for (let i = 0; i < inventory.length; i++) mix(inventory[i]);
  mix(score); mix(gold); mix(spawnCount); mix(leapCount); mix(shiftCountdown); mix(merchantIdx); mix(positionHistory.length); mix(_rngEpoch);
  return h | 0;
}
function _logInput(a) { if (gamePhase === 'playing' && !replayMode && !_instant) { a.r = _rngState; a.h = _stateHash(); _replayInputs.push(a); } }
// Log an item use (inventory or board-space). `slot` = inventory._activeSlot, or -1 when
// the item came from a board square (fromSpace) — the server derives the item variant from
// inventory[slot] / the board-space item, and re-rolls any mystery/wild via the seeded RNG.
// `tg` = array of target squares, or null for a cancel. Inventory cancels are no-ops for the
// validator (it never enters the mode), so only board-space cancels are logged.
function _logItemUse(slot, fromSpace, tg) {
  if (tg === null && !fromSpace) return;
  _logInput({ t: 'it', s: (slot === undefined ? -1 : slot), tg: tg });
}
// Run generation token: bumped on every board reset. Async turn-flow callbacks (AI thinking
// timeout, animation onDone chains, turn timer, bomb chains, sky drops) capture the generation
// when scheduled and abort if a new run started in the meantime. Without this, restarting
// during a pending callback lets the OLD game's callback fire into the NEW game — consuming
// seeded RNG / mutating state that the input log can't reproduce, so the server's re-simulated
// score diverges from what the player saw (the "mobile high-score mismatch" bug: mobile players
// chain games in one session, so stale callbacks from the previous game were common).
let _runGen = 0;
// Positional RNG: instead of one master stream advancing for the whole game (where a single stray
// draw shifts every downstream spawn forever — the root of the live-vs-resim divergences), the
// stream is RE-ANCHORED once per turn to hash(masterSeed, turnEpoch). Turn N's randomness is a pure
// function of (seed, N), so a stray/extra draw can only corrupt the turn it happens in — the next
// turn re-anchors clean. _rngEpoch is bumped exactly once per turn boundary (see _turnBoundaryUpdate),
// which runs identically in live play and headless re-sim, so both reproduce the same substreams.
let _rngEpoch = 0;
function _mixSeed(seed, epoch) {
  // splitmix32-style: fold seed + epoch into a fresh, well-distributed 32-bit state
  let h = ((seed >>> 0) ^ Math.imul((epoch + 1) | 0, 0x9E3779B9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = (h ^ (h >>> 15)) >>> 0;
  return h || 1;
}
function _seedRng(seed) { _runSeed = seed >>> 0; _rngState = _runSeed || 1; _rngEpoch = 0; }
// Advance to the next turn's substream. Called once per real White-turn boundary.
function _rngEpochBump() { _rngEpoch = (_rngEpoch + 1) | 0; _rngState = _mixSeed(_runSeed, _rngEpoch); }
function _rng() {
  // mulberry32 — fast, well-distributed 32-bit PRNG
  _rngState = (_rngState + 0x6D2B79F5) | 0;
  let t = _rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function _freshSeed() { return (Math.floor(Math.random() * 0x100000000)) >>> 0; } // unpredictable per-run seed
_seedRng(_freshSeed()); // seed at load so anything before a setup still has a stream

function randInt(n) { return Math.floor(_rng() * n); }
// Deterministic, STREAM-NEUTRAL pick among equal-valued options (AI tie-breaks). Derived from the
// board + turn epoch (both identical in live and re-sim) — never advances the gameplay stream, so the
// AI's move choice can't perturb spawns, and recomputing Black vs. replaying recorded Black moves stay
// RNG-equivalent. Position-dependent (not _rngState-dependent) so a stray draw can't change the pick.
function _detPick(n) {
  if (n <= 1) return 0;
  let h = (_rngEpoch + 1) | 0;
  for (let i = 0; i < 64; i++) h = Math.imul(h ^ (board[i] | (sides[i] << 4)), 0x01000193);
  return ((h ^ (h >>> 15)) >>> 0) % n;
}

// Begin a new run's setup: pick a fresh seed and clear the input log, THEN run the
// deterministic setup. The validator instead calls _seedRng(recordedSeed) + the same
// setup fn to reproduce the identical starting board.
function _beginSetup(setupFn) { _runGen++; _seedRng(_freshSeed()); _replayInputs = []; _blackMoveLog = []; _autoPlayUsedThisRun = false; _lbSubmitState = 'idle'; _lbSubmitMsg = ''; _lbSubmitWarn = false; setupFn(); }

// --- Headless re-simulation (Phase 3): replay a recorded run's input log against a
// seed-reproduced world and return the authoritative result. Runs synchronously in
// `_instant` mode (animations skipped, setTimeout run inline, no rendering/audio/timers),
// reusing the exact live game logic so the validator matches the client bit-for-bit.
function _sqCenter(i) { return [MARGIN + (i % 8) * TILE + TILE / 2, BOARD_Y + MARGIN + Math.floor(i / 8) * TILE + TILE / 2]; }
function _invSlotCenter(s) {
  const c = s % INV_COLS, r = Math.floor(s / INV_COLS), invY = INV_PANEL_TOP + 50;
  return [INV_X + INV_PAD + c * (INV_SLOT + INV_PAD) + INV_SLOT / 2, invY + INV_PAD + r * (INV_SLOT + INV_PAD) + INV_SLOT / 2];
}
// Dispatch a target click to whichever item mode is currently active (mirrors the live
// canvas-click dispatch). i<0 sends an off-board coordinate to cancel the mode.
function _clickActiveItem(i) {
  const [cx, cy] = i >= 0 ? _sqCenter(i) : [-1000, -1000];
  if (piecePromoterMode) return handlePiecePromoterClick(cx, cy);
  if (shieldMode)        return handleShieldClick(cx, cy);
  if (bombMode)          return handleBombClick(cx, cy);
  if (clonerMode)        return handleClonerClick(cx, cy);
  if (teleporterMode)    return handleTeleporterClick(cx, cy);
  if (elementizerMode)   return handleElementizerClick(cx, cy);
  if (vampireFangMode)   return handleVampireFangClick(cx, cy);
  if (swordMode)         return handleSwordClick(cx, cy);
  if (speedMode)         return handleSpeedClick(cx, cy);
}
// Buy-button center for shop offer index i (mirrors handleShopClick's card geometry).
function _shopBuyCenter(i) {
  const dlgW = 820, dlgH = 500, dlgX = (canvas.width - 820) / 2, dlgY = (canvas.height - 500) / 2;
  const cardW = 220, cardGap = 20, cardH = 300;
  const cardsStartX = dlgX + (dlgW - 3 * cardW - 2 * cardGap) / 2, cardsY = dlgY + 120;
  const cardX = cardsStartX + i * (cardW + cardGap);
  const btnX = cardX + 14, btnY = cardsY + cardH - 54, btnW = cardW - 28, btnH = 44;
  return [btnX + btnW / 2, btnY + btnH / 2];
}

// Apply one logged input, mirroring the live click paths.
function _applyReplayInput(a) {
  // The shop is a modal that suspends the turn flow; the player closes it (not a logged
  // input) before their next non-shop action — do the same so the turn resumes/ends.
  if (shopMode && a.t !== 'buy' && a.t !== 'sell') closeShop();
  switch (a.t) {
    case 'm': {
      // Click the origin ONLY if it isn't already selected. During a Speed/Bloodthirsty extra
      // move (or a Checkers chain) the piece is pre-selected — live, the player taps just the
      // destination. Blindly re-clicking the origin here hit the "tap the selected piece = pass"
      // branch, silently ending the turn and desyncing every replay containing a Speed second
      // move (the root cause of the live-vs-server score mismatches in runs 13-16).
      if (selected !== a.f) { const [fx, fy] = _sqCenter(a.f); handleBoardClick(fx, fy); }
      const [tx, ty] = _sqCenter(a.to); handleBoardClick(tx, ty); break;
    }
    case 'ta': teamAdvance(); break;
    case 'fa': fieldAdvance(true); break;
    case 'p':
      if (_speedIdx >= 0) { _speedIdx = -1; _speedMovesUsed = 0; selected = -1; validMoves = []; endWhiteTurn(); }
      else if (_bloodthirstyIdx >= 0) { _bloodthirstyIdx = -1; _bloodthirstyUsed = false; selected = -1; validMoves = []; endWhiteTurn(); }
      break;
    case 'buy': { const [bx, by] = _shopBuyCenter(a.i); handleShopClick(bx, by); break; }
    case 'sell': { sellConfirmSlot = a.s; const g = _sellConfirmGeom(); handleSellConfirmClick(g.yesX + g.btnW / 2, g.btnY + g.btnH / 2); break; }
    case 'it': {
      if (a.s >= 0) { const [sx, sy] = _invSlotCenter(a.s); handleInventoryClick(sx, sy); } // enter the item's mode
      if (a.tg) for (const t of a.tg) _clickActiveItem(t);  // apply to each target square
      else _clickActiveItem(-1);                            // board-space cancel
      break;
    }
    case 'rw': { const rs = inventory.indexOf(ITEM_REWINDER); if (rs >= 0) { const [sx, sy] = _invSlotCenter(rs); handleInventoryClick(sx, sy); } break; }
    case 'to': // turn timer expired — mirror the onExpire body
      _timedOutThisRun = true; selected = -1; validMoves = []; endWhiteTurn(); break;
    case 'rwa': _rewinderOfferAccept(); break;  // accepted the Rewinder save offer
    case 'rwd': _rewinderOfferDecline(); break; // declined — game over stands
    case 'ic': cancelItemMode(); break;         // Cancel button (no-op unless a mode is active)
    case 'tr': // Trash button / drag-to-trash — destroy the item, clear any active mode
      if (a.s >= 0) inventory._activeSlot = a.s;
      trashActiveItem(); break;
    default: break;
  }
}

// run = { seed, classic, timed, secs, inputs:[...], blackMoves?:[...] } -> { score, gameOver, spotFail }
// opts.spotRate (0..1): fraction of recorded Black turns to recompute-and-verify (server anti-cheat).
// If run.blackMoves is absent (legacy run), Black is recomputed every turn (the old, costly path).
function _replayRun(run, opts) {
  const _savedTimeout = window.setTimeout, _savedRAF = window.requestAnimationFrame;
  const _prevInstant = _instant, _prevTimed = timedMode, _prevSecs = timedModeSecs;
  const _prevBlack = _replayBlack, _prevIdx = _replayBlackIdx, _prevRate = _replaySpotRate, _prevFail = _replaySpotFail, _prevSpotRand = _replaySpotRand;
  try {
    window.setTimeout = (fn) => { if (typeof fn === 'function') fn(); return 0; }; // run deferred turn-flow steps inline
    window.requestAnimationFrame = () => 0;                                        // skip all cosmetic frames
    _instant = true;
    _replayBlack = Array.isArray(run.blackMoves) ? run.blackMoves : null; // apply recorded Black moves when present
    _replayBlackIdx = 0; _replaySpotRate = (opts && opts.spotRate) || 0; _replaySpotFail = false;
    if (opts && opts.spotSeed != null) { // deterministic spot selection (own mulberry32; never touches the gameplay stream)
      let s = opts.spotSeed >>> 0;
      _replaySpotRand = () => { s = (s + 0x6D2B79F5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    } else _replaySpotRand = Math.random;
    initBoard();                                        // full state reset
    timedMode = !!run.timed; if (run.secs) timedModeSecs = run.secs;
    _seedRng(run.seed >>> 0);
    (run.classic ? classicSetup : rollSetup)();         // reproduce the exact starting board from the seed
    gamePhase = 'playing'; gameOver = false; aiThinking = false; shopMode = false; replayMode = false;
    _resetTurnState(); _resetTurnCounters();
    startGame(); turn = W;
    for (const a of run.inputs) { if (gameOver) break; _applyReplayInput(a); }
    if (shopMode && !gameOver) closeShop(); // finalize a run that ended with the shop open
    return { score, gameOver, spotFail: _replaySpotFail };
  } finally {
    _instant = _prevInstant; timedMode = _prevTimed; timedModeSecs = _prevSecs;
    _replayBlack = _prevBlack; _replayBlackIdx = _prevIdx; _replaySpotRate = _prevRate; _replaySpotFail = _prevFail; _replaySpotRand = _prevSpotRand;
    window.setTimeout = _savedTimeout; window.requestAnimationFrame = _savedRAF;
  }
}

function startFlyAnim(piece, side, sx, sy, tx, ty, onDone) {
  if (_instant) { if (onDone) onDone(); return; } // headless re-sim: run the completion (graveyard counts) now
  if (!replayMode) {
    _replayAnimBuffer.push({ type: 'fly', piece, side, sx, sy, tx, ty });
  }
  flyAnims.push({ piece, side, sx, sy, tx, ty, startMs: performance.now(), dur: 600, onDone });
  if (flyAnims.length === 1) requestAnimationFrame(_flyTick);
}

function startCaptureAnim(piece, side, sx, sy) {
  const isPlayer = side === W;
  if (isPlayer && !replayMode) { _lostWhiteThisRun = true; _whiteLostSinceAdvance = true; } // a White Warrior fell (capture / field advance / bomb); replayed falls don't count
  const pool = isPlayer ? playerDead : enemyDead;
  // No graveyard panels anymore — fling the fallen piece up and off the board, into the ether, where
  // it spins away and fades. (pool still counts the fall for achievements/stats.)
  const tgx = sx + (sx < MARGIN + BOARD_PX / 2 ? -1 : 1) * (TILE * 1.5);
  startFlyAnim(piece, side, sx, sy, tgx, BOARD_Y - TILE * 3, () => { pool[piece] = (pool[piece] || 0) + 1; playSfx('body'); if (side === B) playSfx('loot'); });
}

function _warnFlashTick() {
  draw();
  if (shiftCountdown === 1) {
    requestAnimationFrame(_warnFlashTick);
  } else {
    warnFlashRunning = false;
  }
}

function _voidPulseTick() {
  draw();
  if (specialSpaces.some(sp => sp?.type === 'void')) {
    requestAnimationFrame(_voidPulseTick);
  } else {
    voidPulseRunning = false;
  }
}

function _chestBobTick() {
  draw();
  if (itemSpaces.some(v => v !== ITEM_NONE) || nextBonuses.some(b => b.type === 'item') || _shadowSpaces.size > 0) {
    requestAnimationFrame(_chestBobTick);
  } else {
    chestBobRunning = false;
  }
}

const VOID_DEATH_MS = 600;
function startVoidDeath(cx, cy, piece, side, onDone) {
  if (side === W && piece) { _lostWhiteThisRun = true; _whiteLostSinceAdvance = true; _kingSayVoidDeath(piece); } // a White Warrior fell into the void
  // Headless re-sim: no animation — run the continuation NOW. Without this the rAF tick never
  // fires (rAF is a no-op headless), the onDone chain dies, and the sim's turn stalls forever
  // while live play continues — desyncing every run whose turn routed through a void death
  // (root cause of the run-16 live-vs-server mismatch at the Team Advance into a void).
  if (_instant) { if (onDone) onDone(); return; }
  if (piece && piece !== QUEEN) playSfx('man'); // male piece screams falling into the void (Queen doesn't)
  voidDeathAnim = { cx, cy, piece, side, startMs: performance.now(), onDone };
  requestAnimationFrame(_voidDeathTick);
}
function _voidDeathTick() {
  if (!voidDeathAnim) return;
  const t = Math.min(1, (performance.now() - voidDeathAnim.startMs) / VOID_DEATH_MS);
  draw();
  if (t >= 1) {
    const cb = voidDeathAnim.onDone;
    voidDeathAnim = null;
    if (cb) cb();
  } else {
    requestAnimationFrame(_voidDeathTick);
  }
}

const EXPLOSION_MS = 450;
function startExplosion(cx, cy) {
  if (!replayMode) _replayAnimBuffer.push({ type: 'explosion', cx, cy }); // so the blast replays during Last Move
  playSfx('boom1'); playSfx('boom2'); // explosion: two spell layers at once
  explosionAnim = { cx, cy, startMs: performance.now() };
  requestAnimationFrame(_explosionTick);
}
function _explosionTick() {
  if (!explosionAnim) return;
  draw();
  if (performance.now() - explosionAnim.startMs >= EXPLOSION_MS) {
    explosionAnim = null;
  } else {
    requestAnimationFrame(_explosionTick);
  }
}

// Flame-engulf death when a burning piece's timer runs out. Non-blocking cosmetic overlay (the piece
// is already removed from the board by _burnUp) — several can play at once. Skipped in re-sim/replay.
const FIRE_DEATH_MS = 680;
let fireDeaths = []; // [{cx, cy, piece, side, startMs}]
function startFireDeath(cx, cy, piece, side) {
  if (_instant || replayMode) return; // headless/replay: the death is already applied, no animation
  playSfx('torch'); if (piece && piece !== QUEEN) playSfx('man'); // whoosh of flame + a scream (Queen doesn't)
  fireDeaths.push({ cx, cy, piece, side, startMs: performance.now() });
  if (fireDeaths.length === 1) requestAnimationFrame(_fireDeathTick);
}
function _fireDeathTick() {
  draw();
  const now = performance.now();
  fireDeaths = fireDeaths.filter(fd => now - fd.startMs < FIRE_DEATH_MS);
  if (fireDeaths.length > 0) requestAnimationFrame(_fireDeathTick);
}

function startShieldPop(cx, cy) {
  shieldPops.push({ cx, cy, startMs: performance.now(), dur: 350 });
  if (flyAnims.length === 0 && shieldPops.length === 1) requestAnimationFrame(_flyTick);
}

function _flyTick() {
  const now = performance.now();
  for (let i = flyAnims.length - 1; i >= 0; i--) {
    if (now - flyAnims[i].startMs >= flyAnims[i].dur) {
      if (flyAnims[i].onDone) flyAnims[i].onDone();
      flyAnims.splice(i, 1);
    }
  }
  for (let i = itemFlyAnims.length - 1; i >= 0; i--) {
    if (now - itemFlyAnims[i].startMs >= itemFlyAnims[i].dur) { itemFlySlots.delete(itemFlyAnims[i].slotIdx); itemFlyAnims.splice(i, 1); }
  }
  for (let i = shieldPops.length - 1; i >= 0; i--) {
    if (now - shieldPops[i].startMs >= shieldPops[i].dur) shieldPops.splice(i, 1);
  }
  for (let i = _skyDropAnims.length - 1; i >= 0; i--) {
    if (now - _skyDropAnims[i].startMs >= _skyDropAnims[i].dur) {
      _landSkyDrop(_skyDropAnims[i]);
      _skyDropAnims.splice(i, 1);
    }
  }
  draw();
  if (flyAnims.length > 0 || itemFlyAnims.length > 0 || shieldPops.length > 0 || _skyDropAnims.length > 0) requestAnimationFrame(_flyTick);
}

// Land a single sky-dropped item at its target square: apply to a piece there, else drop as an item space.
function _landSkyDrop(f) {
  playSfx('thud'); // sky-dropped item hits the ground
  if (board[f.i] !== NONE) {
    if (sides[f.i] === W) {
      activateItemSpace(f.item, f.i); // proper activation on White piece — instant or interactive mode
      // Don't call endWhiteTurn; stat boosts are a bonus, interactive modes persist to White's turn
    } else {
      _applyItemAuto(f.item, f.i); // Black/Grey — auto-apply only
    }
  } else if (itemSpaces[f.i] === ITEM_NONE) {
    itemSpaces[f.i] = f.item;
  }
}

// Force any still-airborne sky-drops to land immediately (deterministic — used before snapshotting
// so a Rewinder can't restore a turn-start state that's missing an item still mid-animation).
function _resolveAllSkyDrops() {
  while (_skyDropAnims.length) _landSkyDrop(_skyDropAnims.pop());
}

// shoveParams: { isKnight, toI } for Knight; { isKnight: false, dx, dy, toI } for sliders
function startWaveAnim(squares, shoveParams, onDone) {
  if (!replayMode) {
    _replayAnimBuffer.push({
      type: 'wave',
      ..._snapReplayCommon(),
      squares: [...squares],
      shoveParams: {...shoveParams},
    });
  }
  // A Water Warrior's wave douses any fire on the squares it sweeps across.
  for (const si of squares) fireSquares.delete(si);
  const sp = shoveParams;
  // squareToK: board-index → position in the wave sweep (used to time visual releases)
  const squareToK = new Map();
  squares.forEach((si, k) => squareToK.set(si, k));

  // drawAt: Map<newBoardIdx, {cx, cy, releaseK}>
  // While active, the piece at newBoardIdx is drawn at (cx,cy) instead of its real square.
  // Released (deleted) when the wave head reaches releaseK.
  const drawAt = new Map();

  _waterShoveActive = true; // shoves below are from a Water piece's wave
  if (sp.isKnight) {
    const [tx, ty] = xy(sp.toI);
    for (const ni of squares) {
      if (ni === sp.toI) continue;
      if (board[ni] === NONE && ni !== merchantIdx) continue;
      const [nx, ny] = xy(ni);
      const sdx = nx - tx, sdy = ny - ty;
      const releaseK = squareToK.get(ni) ?? 0;
      const destX = nx + (sdx > 0 ? 1 : sdx < 0 ? -1 : 0);
      const destY = ny + (sdy > 0 ? 1 : sdy < 0 ? -1 : 0);
      if (!inB(destX, destY)) continue;
      const destI = idx(destX, destY);
      // Only set drawAt if the shove would actually succeed (destination unoccupied)
      if (board[destI] !== NONE && destI !== merchantIdx) continue;
      const voidDeath = isVoidSpace(destI)
        ? { p: board[ni], s: sides[ni], cx: MARGIN + destX * TILE + TILE / 2, cy: BOARD_Y + MARGIN + destY * TILE + TILE / 2 }
        : null;
      drawAt.set(voidDeath ? ni : destI, { cx: MARGIN + nx * TILE, cy: MARGIN + ny * TILE, releaseK, voidDeath });
      const _shoveResult = shovePiece(ni, sdx, sdy);
      if (_shoveResult?.merchantVoid) {
        const vdcx = MARGIN + destX * TILE + TILE / 2, vdcy = BOARD_Y + MARGIN + destY * TILE + TILE / 2;
        drawAt.set(_shoveResult.oldIdx, { cx: MARGIN + nx * TILE, cy: MARGIN + ny * TILE, releaseK, merchantVoidDeath: { cx: vdcx, cy: vdcy } });
      }
    }
  } else {
    // Pass 1: determine which pieces can move (far-to-near, chain-aware)
    const willShove = new Set();
    for (let i = squares.length - 1; i >= 0; i--) {
      const ni = squares[i];
      if (ni === sp.toI) continue;
      if (board[ni] === NONE && ni !== merchantIdx) continue;
      const [nx, ny] = xy(ni);
      const destX = nx + sp.dx, destY = ny + sp.dy;
      if (!inB(destX, destY) || isBlockSpace(idx(destX, destY))) continue;
      const destI = idx(destX, destY);
      if (board[destI] === NONE && destI !== merchantIdx || willShove.has(destI)) {
        willShove.add(ni);
      }
    }
    // Pass 2: record old visual positions and apply shoves far-to-near
    for (let i = squares.length - 1; i >= 0; i--) {
      const ni = squares[i];
      if (!willShove.has(ni)) continue;
      const [nx, ny] = xy(ni);
      const destX = nx + sp.dx, destY = ny + sp.dy;
      const destI = idx(destX, destY);
      const releaseK = squareToK.get(ni) ?? 0;
      // If dest is a void, store piece info for void death animation on wave release
      const voidDeath = isVoidSpace(destI)
        ? { p: board[ni], s: sides[ni], cx: MARGIN + destX * TILE + TILE / 2, cy: BOARD_Y + MARGIN + destY * TILE + TILE / 2 }
        : null;
      // For void-bound pieces, key drawAt by srcI (board is NONE at destI after shove)
      drawAt.set(voidDeath ? ni : destI, { cx: MARGIN + nx * TILE, cy: MARGIN + ny * TILE, releaseK, voidDeath });
      const _shoveResult = shovePiece(ni, sp.dx, sp.dy);
      // Merchant pushed into void: add a drawAt entry for his ghost + void death
      if (_shoveResult?.merchantVoid) {
        const vdcx = MARGIN + destX * TILE + TILE / 2, vdcy = BOARD_Y + MARGIN + destY * TILE + TILE / 2;
        drawAt.set(_shoveResult.oldIdx, { cx: MARGIN + nx * TILE, cy: MARGIN + ny * TILE, releaseK, merchantVoidDeath: { cx: vdcx, cy: vdcy } });
      }
    }
  }

  _waterShoveActive = false;
  if (_instant) { if (onDone) onDone(); return; } // headless re-sim: shove state already applied, skip the animation
  waveAnim = { squares, shoveParams, drawAt, lastHead: -1, startMs: performance.now(), dur: 500, onDone, gen: _runGen };
  requestAnimationFrame(_waveTick);
}

function _waveTick() {
  if (!waveAnim) return;
  if (waveAnim.gen !== _runGen) { waveAnim = null; return; } // stale wave from a previous run — drop it
  const t = Math.min(1, (performance.now() - waveAnim.startMs) / waveAnim.dur);
  const head = Math.floor(t * waveAnim.squares.length);
  // Release visual overrides as the wave front passes each square
  for (let k = waveAnim.lastHead + 1; k <= head && k < waveAnim.squares.length; k++) {
    for (const [boardI, ov] of waveAnim.drawAt) {
      if (ov.releaseK <= k) {
        waveAnim.drawAt.delete(boardI);
        if (ov.voidDeath) {
          const { p, s, cx: vcx, cy: vcy } = ov.voidDeath;
          startVoidDeath(vcx, vcy, p, s, null);
        }
        if (ov.merchantVoidDeath) {
          startVoidDeath(ov.merchantVoidDeath.cx, ov.merchantVoidDeath.cy, null, null, null);
        }
      }
    }
    waveAnim.lastHead = k;
  }
  draw();
  if (t >= 1) {
    const cb = waveAnim.onDone;
    waveAnim = null;
    if (cb) cb();
  } else {
    requestAnimationFrame(_waveTick);
  }
}

function _waveLineSqFromMove(fromI, toI, p) {
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  if (p === KNIGHT) {
    const sq = [toI];
    for (let dy2 = -1; dy2 <= 1; dy2++) for (let dx2 = -1; dx2 <= 1; dx2++) {
      if (dx2 === 0 && dy2 === 0) continue;
      if (inB(tx + dx2, ty + dy2)) sq.push(idx(tx + dx2, ty + dy2));
    }
    return { squares: sq, shoveParams: { isKnight: true, toI } };
  }
  const dx = tx === fx ? 0 : (tx > fx ? 1 : -1);
  const dy = ty === fy ? 0 : (ty > fy ? 1 : -1);
  // Start from the board edge behind the piece's origin, sweep to the edge past destination
  let sx = fx, sy = fy;
  while (inB(sx - dx, sy - dy)) { sx -= dx; sy -= dy; }
  const sq = [];
  let cx = sx, cy = sy;
  while (inB(cx, cy)) { sq.push(idx(cx, cy)); cx += dx; cy += dy; }
  return { squares: sq, shoveParams: { isKnight: false, dx, dy, toI } };
}

// Stone-block tile palettes. `temp` is the permanent stone palette blue-filtered (R/B channels
// swapped) so a temporary Earth block reads at a glance as different from permanent rock.
const _BLOCK_PALETTE = {
  perm: { base: "#1e1a16", top: "#c8b890", bot: "#2e2418", left: "#908068", right: "#403428", face: "#786450", hi: "#a09070", sh: "#3e3028" },
  temp: { base: "#161a1e", top: "#90b8c8", bot: "#18242e", left: "#688090", right: "#283440", face: "#506478", hi: "#7090a0", sh: "#28303e" },
};
function drawBlockTile(gctx, tx, ty, tileSize, temp = false) {
  const c = temp ? _BLOCK_PALETTE.temp : _BLOCK_PALETTE.perm;
  const bev = tileSize * 0.22;
  gctx.save();
  // Outer dark edge / base
  gctx.fillStyle = c.base;
  gctx.fillRect(tx, ty, tileSize, tileSize);
  // Top bevel â€" lit from above
  gctx.fillStyle = c.top;
  gctx.beginPath();
  gctx.moveTo(tx, ty); gctx.lineTo(tx + tileSize, ty);
  gctx.lineTo(tx + tileSize - bev, ty + bev); gctx.lineTo(tx + bev, ty + bev);
  gctx.closePath(); gctx.fill();
  // Bottom bevel â€" deep shadow
  gctx.fillStyle = c.bot;
  gctx.beginPath();
  gctx.moveTo(tx, ty + tileSize); gctx.lineTo(tx + tileSize, ty + tileSize);
  gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.lineTo(tx + bev, ty + tileSize - bev);
  gctx.closePath(); gctx.fill();
  // Left bevel â€" half-lit
  gctx.fillStyle = c.left;
  gctx.beginPath();
  gctx.moveTo(tx, ty); gctx.lineTo(tx, ty + tileSize);
  gctx.lineTo(tx + bev, ty + tileSize - bev); gctx.lineTo(tx + bev, ty + bev);
  gctx.closePath(); gctx.fill();
  // Right bevel â€" shadow side
  gctx.fillStyle = c.right;
  gctx.beginPath();
  gctx.moveTo(tx + tileSize, ty); gctx.lineTo(tx + tileSize, ty + tileSize);
  gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.lineTo(tx + tileSize - bev, ty + bev);
  gctx.closePath(); gctx.fill();
  // Center face
  gctx.fillStyle = c.face;
  gctx.fillRect(tx + bev, ty + bev, tileSize - bev * 2, tileSize - bev * 2);
  // Inner highlight lines (top-left edge of center)
  gctx.strokeStyle = c.hi; gctx.lineWidth = 1.5;
  gctx.beginPath(); gctx.moveTo(tx + bev, ty + bev); gctx.lineTo(tx + tileSize - bev, ty + bev); gctx.stroke();
  gctx.beginPath(); gctx.moveTo(tx + bev, ty + bev); gctx.lineTo(tx + bev, ty + tileSize - bev); gctx.stroke();
  // Inner shadow lines (bottom-right edge of center)
  gctx.strokeStyle = c.sh; gctx.lineWidth = 1.5;
  gctx.beginPath(); gctx.moveTo(tx + tileSize - bev, ty + bev); gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.stroke();
  gctx.beginPath(); gctx.moveTo(tx + bev, ty + tileSize - bev); gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.stroke();
  gctx.restore();
}

// Animated flames covering a fire-trail square. `side` tints them: Black-laid fire (dangerous to the
// player) burns orange; White-laid fire (safe — only opposing pieces ignite) burns blue. Phase is
// offset by tile position so neighbouring fires flicker independently.
function _drawFireTile(gctx, dx, dy, side) {
  const t = performance.now() / 130 + dx * 0.7 + dy * 0.4;
  const flick = 0.55 + 0.25 * Math.sin(t) + 0.12 * Math.sin(t * 2.7);
  const blue = side === W;
  gctx.save();
  // Flat tinted wash (no per-frame gradient — that was the frame-rate killer with long trails).
  gctx.fillStyle = blue ? `rgba(55,140,255,${(0.2 + 0.12 * flick).toFixed(2)})` : `rgba(255,105,10,${(0.2 + 0.12 * flick).toFixed(2)})`;
  gctx.fillRect(dx, dy, TILE, TILE);
  const base = dy + TILE * 0.9;
  for (let k = 0; k < 4; k++) {
    const fx = dx + TILE * 0.22 + k * TILE * 0.19;
    const h = TILE * (0.2 + 0.14 * Math.sin(t * 1.9 + k * 1.7));
    const g = 140 + Math.floor(70 * flick);
    gctx.fillStyle = blue ? `rgba(70,${g + 40},255,0.82)` : `rgba(255,${g},20,0.82)`;
    gctx.beginPath();
    gctx.moveTo(fx - TILE * 0.055, base);
    gctx.quadraticCurveTo(fx - TILE * 0.06, base - h * 0.6, fx, base - h);
    gctx.quadraticCurveTo(fx + TILE * 0.06, base - h * 0.6, fx + TILE * 0.055, base);
    gctx.closePath(); gctx.fill();
  }
  gctx.restore();
}

// Burning overlay for an on-fire piece: a flickering orange aura, licking flames along the base, and
// a small badge with the rounds it has left before it burns up (unless it crosses water first).
function _drawBurningOverlay(gctx, dx, dy, rounds) {
  const t = performance.now() / 130;
  const flick = 0.55 + 0.25 * Math.sin(t) + 0.12 * Math.sin(t * 2.7);
  gctx.save();
  // Flat tinted wash (no per-frame gradient).
  gctx.fillStyle = `rgba(255,120,10,${(0.16 + 0.14 * flick).toFixed(2)})`;
  gctx.fillRect(dx, dy, TILE, TILE);
  // licking flames along the bottom edge
  const base = dy + TILE * 0.92;
  for (let k = 0; k < 3; k++) {
    const fx = dx + TILE * 0.3 + k * TILE * 0.2;
    const h = TILE * (0.18 + 0.1 * Math.sin(t * 1.9 + k * 1.7));
    gctx.fillStyle = `rgba(255,${140 + Math.floor(70 * flick)},20,0.9)`;
    gctx.beginPath();
    gctx.moveTo(fx - TILE * 0.05, base);
    gctx.quadraticCurveTo(fx - TILE * 0.06, base - h * 0.6, fx, base - h);
    gctx.quadraticCurveTo(fx + TILE * 0.06, base - h * 0.6, fx + TILE * 0.05, base);
    gctx.closePath(); gctx.fill();
  }
  // rounds-left badge, top-right
  const bx = dx + TILE - 13, by = dy + 13;
  gctx.fillStyle = 'rgba(30,6,0,0.85)';
  gctx.beginPath(); gctx.arc(bx, by, 10, 0, Math.PI * 2); gctx.fill();
  gctx.strokeStyle = 'rgba(255,140,0,0.9)'; gctx.lineWidth = 1.5;
  gctx.beginPath(); gctx.arc(bx, by, 10, 0, Math.PI * 2); gctx.stroke();
  gctx.fillStyle = '#ffd24a'; gctx.font = 'bold 15px sans-serif'; gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
  gctx.fillText(String(rounds), bx, by + 1);
  gctx.restore();
}

function drawShopTile(gctx, tx, ty, tileSize) {
  const cx = tx + tileSize / 2, cy = ty + tileSize / 2;
  const sz = tileSize * 0.60;

  // Building body
  const bW = sz * 0.88, bH = sz * 0.54;
  const bX = cx - bW / 2, bY = cy - sz * 0.04;
  gctx.fillStyle = "rgba(220,185,110,0.95)";
  gctx.fillRect(bX, bY, bW, bH);

  // Awning â€" mostly above bY, small overlap into building top
  const aW = sz, aH = sz * 0.19;
  const aX = cx - aW / 2, aY = bY - aH * 0.6;
  // awning bottom = aY + aH = bY + aH*0.4 = bY + sz*0.076
  gctx.fillStyle = "#c03030";
  gctx.beginPath();
  gctx.moveTo(aX, aY);
  gctx.lineTo(aX + aW, aY);
  gctx.lineTo(aX + aW * 0.87, aY + aH);
  gctx.lineTo(aX + aW * 0.13, aY + aH);
  gctx.closePath();
  gctx.fill();

  // Small scalloped bottom â€" scallops bottom â‰ˆ bY + sz*0.111
  const scR = sz * 0.035;
  gctx.fillStyle = "#901a1a";
  const scInner = aW * 0.74, scCount = 5;
  for (let k = 0; k < scCount; k++) {
    const scX = aX + aW * 0.13 + scInner * (k + 0.5) / scCount;
    gctx.beginPath();
    gctx.arc(scX, aY + aH, scR, 0, Math.PI);
    gctx.fill();
  }

  // Door â€" top at bY + sz*0.292, leaving room for windows above it
  const dW = bW * 0.28, dH = bH * 0.46;
  gctx.fillStyle = "rgba(90,50,18,0.9)";
  gctx.beginPath();
  gctx.roundRect(cx - dW / 2, bY + bH - dH, dW, dH, 2);
  gctx.fill();

  // Windows â€" explicitly placed between scallops bottom (sz*0.111) and door top (sz*0.292)
  gctx.fillStyle = "rgba(180,230,255,0.78)";
  const wW = bW * 0.22, wH = sz * 0.13, wY = bY + sz * 0.14;
  gctx.fillRect(bX + bW * 0.06, wY, wW, wH);
  gctx.fillRect(bX + bW - bW * 0.06 - wW, wY, wW, wH);
}

function easeOut(t) { return 1 - (1 - t) * (1 - t); }

// Board-state fields shared by every _replayAnimBuffer entry (Last Move / Replay playback).
// One source of truth so anim & wave snapshots can't drift apart field-by-field.
function _snapReplayCommon() {
  return {
    board: [...board], sides: [...sides], health: [...health],
    elements: [...elements], statuses: [...statuses], attacks: [...attacks], speeds: [...speeds], burning: [...burning],
    effectOrders: effectOrders.map(a => [...a]),
    specialSpaces: specialSpaces.map(s => s ? JSON.parse(JSON.stringify(s)) : null),
    itemSpaces: [...itemSpaces],
    inventory: [...inventory],
    score, gold, leapCount, shiftCountdown, merchantIdx,
    playerDead: {...playerDead}, enemyDead: {...enemyDead},
    fireSquares: [...fireSquares].map(([k, v]) => [k, { ...v }]),
    waterTrails: [...waterTrails].map(([k, v]) => [k, { ...v }]),
    nextWave: nextWave.map(w => ({...w})), nextBonuses: nextBonuses.map(b => ({...b})),
  };
}

function startAnim(pieces, boardDy, onDone, exitRow) {
  if (_instant) { if (onDone) onDone(); return; } // headless re-sim: skip the animation, run its completion now
  if (!replayMode) {
    _replayAnimBuffer.push({
      type: 'anim',
      ..._snapReplayCommon(),
      chestSpaces: [...chestSpaces],
      pieces: pieces.map(p => ({...p})),
      boardDy: boardDy || 0,
      exitRow: exitRow ? exitRow.map(r => ({...r})) : null,
      pendingItemFlies: _pendingCaptureAnims.filter(c => c.type === 'item').map(c => ({...c})),
      pendingShopFlies: [..._pendingShopFlies],
    });
    _pendingShopFlies = [];
  }
  const animDur = _miniReplayActive ? ANIM_MS * 2 : ANIM_MS;
  anim = { pieces, boardDy, startMs: performance.now(), dur: animDur, onDone, exitRow: exitRow || null, gen: _runGen };
  requestAnimationFrame(_animTick);
}

function _animTick() {
  if (!anim) return;
  if (anim.gen !== _runGen) { anim = null; return; } // stale animation from a previous run — drop it (and its onDone chain)
  draw();
  if ((performance.now() - anim.startMs) < anim.dur) {
    requestAnimationFrame(_animTick);
  } else {
    const done = anim.onDone;
    anim = null;
    if (done) done();
  }
}

function _rollWildTo() {
  const r = randInt(30);
  if (r < 8)  return ROOK;
  if (r < 14) return KNIGHT;
  if (r < 20) return BISHOP;
  if (r < 24) return QUEEN;
  if (r < 27) return KING;
  return CHECKERS;
}

function _randomPromoterItem() {
  const pool = [ROOK, ROOK, KNIGHT, KNIGHT, BISHOP, BISHOP, QUEEN, PROMOTER_WILD];
  const pick = pool[randInt(pool.length)];
  return pick === PROMOTER_WILD ? ITEM_PROMOTER_WILD : makePromoterItem(pick);
}

// Field-item pool (wave bonuses, chests, sky drops, starting inventory).
// Rewinder is intentionally excluded — it is merchant-only, never a field drop.
function _randomItem() {
  const r = randInt(8);
  if (r === 0) return ITEM_TELEPORTER;
  if (r === 1) return ITEM_CLONER;
  if (r === 2) return ITEM_SHIELD;
  if (r === 3) return ITEM_BOMB;
  if (r === 4) return ITEM_VAMPIRE_FANG;
  if (r === 5) return ITEM_SWORD;
  if (r === 6) return ITEM_BOOTS;
  return _randomElementalizerItem();
}

function _randomElementalizerItem() {
  const pool = [ITEM_ELEM_FIRE, ITEM_ELEM_WATER, ITEM_ELEM_EARTH, ITEM_ELEM_AIR, ITEM_ELEM_MYSTERY];
  return pool[randInt(pool.length)];
}

function _randomShopItem() {
  const r = randInt(9);
  if (r === 0) return _randomPromoterItem(); // includes Wild via pool
  if (r === 1) return ITEM_TELEPORTER;
  if (r === 2) return ITEM_CLONER;
  if (r === 3) return ITEM_SHIELD;
  if (r === 4) return ITEM_BOMB;
  if (r === 5) return ITEM_REWINDER;
  if (r === 6) return ITEM_VAMPIRE_FANG;
  if (r === 7) return ITEM_SWORD;
  if (r === 8) return ITEM_BOOTS;
  return _randomElementalizerItem();
}

function addToInventory(item) {
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i] === ITEM_NONE) { inventory[i] = item; return i; }
  }
  return -1; // full
}

function findInventorySlot() {
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i] === ITEM_NONE) return i;
  }
  return -1;
}

function startItemFlyAnim(item, fromX, fromY, slotIdx, skipAdd = false) {
  if (slotIdx < 0) return;
  if (!skipAdd) addToInventory(item);
  itemFlySlots.add(slotIdx);
  const c = slotIdx % INV_COLS, r = Math.floor(slotIdx / INV_COLS);
  const invY = INV_PANEL_TOP + 50;
  const tx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD) + INV_SLOT / 2;
  const ty = invY + INV_PAD + r * (INV_SLOT + INV_PAD) + INV_SLOT / 2;
  itemFlyAnims.push({ item, slotIdx, sx: fromX, sy: fromY, tx, ty, startMs: performance.now(), dur: 275 });
  if (flyAnims.length === 0 && itemFlyAnims.length === 1 && shieldPops.length === 0) requestAnimationFrame(_flyTick);
}

function removeFromInventory(slot) {
  const item = inventory[slot];
  inventory[slot] = ITEM_NONE;
  if (item !== ITEM_NONE) _usedItemThisRun = true; // consumed an inventory item (for the no-item achievement)
  return item;
}

function boardHash() {
  let h = "";
  for (let i = 0; i < 64; i++) h += board[i] + "," + sides[i] + ";";
  return h;
}

function recordPosition() {
  positionHistory.push(boardHash());
}

// Serialize the full live game state into a snapshot object (same shape applyReplaySnapshot restores).
// Split out of takeReplaySnapshot so a caller can capture "now" without pushing a turn snapshot —
// used by Last Move to preserve state across a non-destructive review.
function _buildReplaySnapshot() {
  return {
    board: [...board], sides: [...sides], health: [...health],
    specialSpaces: specialSpaces.map(s => s ? JSON.parse(JSON.stringify(s)) : null),
    itemSpaces: [...itemSpaces], chestSpaces: [...chestSpaces],
    shadowSpaces: [..._shadowSpaces],
    inventory: [...inventory],
    score, gold, turn,
    playerDead: {...playerDead}, enemyDead: {...enemyDead},
    spawnCount, leapCount, shiftCountdown, merchantIdx, merchantQueued, merchantQueuedCol,
    elements: [...elements], statuses: [...statuses], attacks: [...attacks], speeds: [...speeds], burning: [...burning],
    fireSquares: [...fireSquares].map(([k, v]) => [k, { ...v }]),
    waterTrails: [...waterTrails].map(([k, v]) => [k, { ...v }]),
    effectOrders: effectOrders.map(a => [...a]),
    nextWave: nextWave.map(w => ({...w})), nextBonuses: nextBonuses.map(b => ({...b}))
  };
}
function takeReplaySnapshot() {
  _replayTransitions.push([..._replayAnimBuffer]);
  _replayAnimBuffer = [];
  replaySnapshots.push(_buildReplaySnapshot());
}

function applyReplaySnapshot(snap) {
  board.splice(0, 64, ...snap.board);
  sides.splice(0, 64, ...snap.sides);
  health.splice(0, 64, ...snap.health);
  specialSpaces.splice(0, 64, ...snap.specialSpaces.map(s => s ? JSON.parse(JSON.stringify(s)) : null));
  itemSpaces.splice(0, 64, ...snap.itemSpaces);
  inventory.splice(0, inventory.length, ...snap.inventory);
  score = snap.score; gold = snap.gold; turn = snap.turn;
  playerDead = {...snap.playerDead}; enemyDead = {...snap.enemyDead};
  spawnCount = snap.spawnCount; leapCount = snap.leapCount;
  shiftCountdown = snap.shiftCountdown; merchantIdx = snap.merchantIdx ?? -1;
  if (snap.merchantQueued !== undefined) { merchantQueued = snap.merchantQueued; merchantQueuedCol = snap.merchantQueuedCol ?? -1; }
  if (snap.elements) elements.splice(0, 64, ...snap.elements); else elements.fill(0);
  if (snap.statuses) statuses.splice(0, 64, ...snap.statuses); else statuses.fill(0);
  if (snap.attacks) attacks.splice(0, 64, ...snap.attacks); else attacks.fill(1);
  if (snap.speeds) speeds.splice(0, 64, ...snap.speeds); else speeds.fill(1);
  if (snap.burning) burning.splice(0, 64, ...snap.burning); else burning.fill(0);
  fireSquares = snap.fireSquares ? new Map(snap.fireSquares.map(([k, v]) => [k, { ...v }])) : new Map();
  waterTrails = snap.waterTrails ? new Map(snap.waterTrails.map(([k, v]) => [k, { ...v }])) : new Map();
  chestSpaces = snap.chestSpaces ? new Set(snap.chestSpaces) : new Set();
  _shadowSpaces = snap.shadowSpaces ? new Map(snap.shadowSpaces) : new Map();
  if (snap.effectOrders) { for (let i = 0; i < 64; i++) effectOrders[i] = snap.effectOrders[i] ? [...snap.effectOrders[i]] : []; } else { for (let i = 0; i < 64; i++) effectOrders[i] = []; }
  if (snap.nextWave) nextWave = snap.nextWave.map(w => ({...w}));
  if (snap.nextBonuses) nextBonuses = snap.nextBonuses.map(b => ({...b}));
}

function enterReplay() {
  if (replaySnapshots.length === 0) return;
  replayMode = true;
  replayIdx = 0;
  replayAutoPlay = false;
  if (replayAutoTimer) { clearTimeout(replayAutoTimer); replayAutoTimer = null; }
  gameOver = false;
  applyReplaySnapshot(replaySnapshots[replayIdx]);
  draw();
}

function exitReplay() {
  replayMode = false;
  replayAutoPlay = false;
  if (replayAutoTimer) { clearTimeout(replayAutoTimer); replayAutoTimer = null; }
  gameOver = true;
  const last = replaySnapshots[replaySnapshots.length - 1];
  if (last) applyReplaySnapshot(last);
  draw();
}

// Reproduce the key audio cue for one replay transition event, mirroring the
// sounds the live game plays for the same action. (playSfx self-gates on mute.)
function _replaySfx(ev) {
  if (ev.type === 'fly') { // a captured piece flying to the graveyard
    const p = ev.piece;
    if (p === QUEEN) playSfx('queencap');
    else if (p === ROOK) { playSfx('rookcap'); playSfx('anvil'); }
    else { playSfx('capture'); playSfx('punch'); }
    playSfx('body'); if (ev.side === B) playSfx('loot');
    return;
  }
  if (ev.type === 'wave') { playSfx('water'); return; }
  if (ev.exitRow) { // Field Advance
    playSfx('whoosh');
    if (ev.exitRow.some(r => r.piece && r.piece !== NONE)) playSfx('crunch');
    return;
  }
  const first = ev.pieces && ev.pieces[0]; // ordinary piece move
  if (first) playSfx(first.piece === KNIGHT ? 'horse' : 'move');
}

function _playReplayTransition(snapIdx, onDone) {
  const events = _replayTransitions[snapIdx] || [];
  let ei = 0;
  const playNext = () => {
    // Fire all consecutive fly / explosion events (fire-and-forget, no waiting)
    while (ei < events.length && (events[ei].type === 'fly' || events[ei].type === 'explosion')) {
      const ev = events[ei++];
      if (ev.type === 'explosion') { startExplosion(ev.cx, ev.cy); continue; }
      _replaySfx(ev);
      startFlyAnim(ev.piece, ev.side, ev.sx, ev.sy, ev.tx, ev.ty, null);
    }
    if (ei >= events.length) {
      applyReplaySnapshot(replaySnapshots[snapIdx]);
      onDone();
      return;
    }
    const ev = events[ei++];
    board.splice(0, 64, ...ev.board);
    sides.splice(0, 64, ...ev.sides);
    health.splice(0, 64, ...ev.health);
    specialSpaces.splice(0, 64, ...ev.specialSpaces);
    itemSpaces.splice(0, 64, ...ev.itemSpaces);
    inventory.splice(0, inventory.length, ...ev.inventory);
    score = ev.score; gold = ev.gold; leapCount = ev.leapCount; shiftCountdown = ev.shiftCountdown;
    merchantIdx = ev.merchantIdx ?? -1;
    playerDead = {...ev.playerDead}; enemyDead = {...ev.enemyDead};
    if (ev.elements) elements.splice(0, 64, ...ev.elements); else elements.fill(0);
    if (ev.statuses) statuses.splice(0, 64, ...ev.statuses); else statuses.fill(0);
    if (ev.attacks) attacks.splice(0, 64, ...ev.attacks); else attacks.fill(1);
    if (ev.speeds) speeds.splice(0, 64, ...ev.speeds); else speeds.fill(1);
    if (ev.burning) burning.splice(0, 64, ...ev.burning); else burning.fill(0);
    if (ev.effectOrders) for (let i = 0; i < 64; i++) effectOrders[i] = ev.effectOrders[i] ? [...ev.effectOrders[i]] : []; // badges follow the piece mid-transition (older buffers lack this -> keep current)
    fireSquares = ev.fireSquares ? new Map(ev.fireSquares.map(([k, v]) => [k, { ...v }])) : new Map();
    waterTrails = ev.waterTrails ? new Map(ev.waterTrails.map(([k, v]) => [k, { ...v }])) : new Map();
    if (ev.nextWave) nextWave = ev.nextWave.map(w => ({...w}));
    if (ev.nextBonuses) nextBonuses = ev.nextBonuses.map(b => ({...b}));
    if (ev.chestSpaces) chestSpaces = new Set(ev.chestSpaces);
    if (ev.pendingShopFlies) {
      for (const f of ev.pendingShopFlies) startItemFlyAnim(f.item, f.sx, f.sy, f.slotIdx, true);
    }
    const evOnDone = () => {
      if (ev.pendingItemFlies) {
        for (const f of ev.pendingItemFlies) startItemFlyAnim(f.item, f.sx, f.sy, findInventorySlot());
      }
      playNext();
    };
    _replaySfx(ev);
    if (ev.type === 'wave') {
      startWaveAnim(ev.squares, {...ev.shoveParams}, evOnDone);
    } else {
      startAnim(ev.pieces, ev.boardDy, evOnDone, ev.exitRow || undefined);
    }
  };
  playNext();
}

function stepReplay(delta) {
  if (anim) return;
  const newIdx = Math.max(0, Math.min(replaySnapshots.length - 1, replayIdx + delta));
  if (newIdx === replayIdx) return;
  replayIdx = newIdx;
  if (delta < 0) {
    applyReplaySnapshot(replaySnapshots[replayIdx]);
    draw();
  } else {
    _playReplayTransition(replayIdx, () => draw());
  }
}

function _tickAutoPlay() {
  if (!replayAutoPlay || !replayMode) return;
  if (replayIdx >= replaySnapshots.length - 1) {
    replayAutoPlay = false;
    replayAutoTimer = null;
    draw();
    return;
  }
  replayIdx++;
  _playReplayTransition(replayIdx, () => {
    draw();
    if (replayAutoPlay && replayMode) _tickAutoPlay();
  });
}

function toggleReplayAutoPlay() {
  if (anim && !replayAutoPlay) return; // block starting while animating, but allow pausing
  replayAutoPlay = !replayAutoPlay;
  if (replayAutoTimer) { clearTimeout(replayAutoTimer); replayAutoTimer = null; }
  if (replayAutoPlay) _tickAutoPlay();
  draw();
}

function countPosition(hash) {
  let c = 0;
  for (const h of positionHistory) if (h === hash) c++;
  return c;
}

function generateWave(count) {
  // count=1 â†’ 1 piece (opening row); countâ‰¥2 â†’ starts at 2, +1 every 5 rows, max 7
  const n = count === 1 ? 1 : Math.min(2 + Math.floor((count - 2) / 5), 7);
  const cols = [];
  while (cols.length < n) {
    const c = randInt(8);
    if (!cols.includes(c)) cols.push(c);
  }
  // 1% chance the guaranteed King is a Checkers King (must land on a dark square)
  const kingPiece = (randInt(100) === 0 && isDarkSquare(cols[0], 0)) ? CHECKERS_KING : KING;
  const wave = [{x: cols[0], piece: kingPiece}];
  for (let i = 1; i < cols.length; i++) {
    let piece = _randomEnemyPiece(count);
    // Checkers pieces must spawn on dark squares (pieces enter at row 0)
    if ((piece === CHECKERS || piece === CHECKERS_KING) && !isDarkSquare(cols[i], 0)) piece = PAWN;
    wave.push({x: cols[i], piece});
  }
  // Pre-roll each piece's spawn effects now so the preview row can show them; they're applied
  // (not re-rolled) when the wave lands. count == the waveCount the spawn would roll under.
  for (const w of wave) w.eff = _rollEffectSet(count);
  return wave;
}

function isDarkSquare(x, y) { return (x + y) % 2 === 1; }

// Roll bonuses (chest / obstacle / Grey) into the empty columns of an incoming wave.
// Obstacles ramp with depth: at wave 1 an empty column has the baseline 1-in-12
// chance of any bonus (of which 1/3 is an obstacle → 2.78% obstacle); by wave 40
// every empty column on an obstacle-row is a guaranteed obstacle, no chests/greys.
// Obstacles are gated to alternating waves so two obstacle-rows never spawn back to
// back — since all rows scroll down uniformly, that guarantees a clear row between
// every obstacle row, so obstacles can never wall the player off into a Field Advance.
function generateRowBonuses(wave, waveCount = spawnCount + 1) {
  const waveCols = new Set(wave.map(w => w.x));
  const bonuses = [];
  const t = Math.max(0, Math.min(1, (waveCount - 1) / 39)); // 0 at wave 1 → 1 at wave 40+
  // River-row chance ramps with depth: 1/32 (~3.1%) at wave 1 → 1/5 (20%) at wave 40+.
  const pRiver = (1 / 32) + (0.2 - 1 / 32) * t;
  if (_rng() < pRiver) {
    const dx = randInt(2) === 0 ? -1 : 1;
    for (let x = 0; x < 8; x++) bonuses.push({ type: 'river', col: x, dx });
    return bonuses; // river replaces all other bonuses for this row
  }
  const obstacleRow = (waveCount % 2 === 1); // only odd waves may spawn obstacles
  const pBonus = (1 / 12) + (1 - 1 / 12) * t;   // chance an empty column rolls anything: 1/12 → 1
  // Type weights lerp from baseline [chest1, void1, block1, grey1.5] toward obstacle-only.
  // On non-obstacle rows the void/block weight is zeroed (keeps the every-other-row guarantee).
  // Grey weight dialed back 50% (was 3) — Greys spawn about half as often.
  const wChest = 1 - t, wGrey = 1.5 * (1 - t);
  const wVoid = obstacleRow ? (1 + 2 * t) : 0, wBlock = obstacleRow ? (1 + 2 * t) : 0;
  const wTotal = wChest + wGrey + wVoid + wBlock;
  for (let x = 0; x < 8; x++) {
    if (waveCols.has(x)) continue;
    if (wTotal <= 0) continue;           // late-game non-obstacle row: nothing left to spawn
    if (_rng() >= pBonus) continue;
    let r = _rng() * wTotal, type;
    if ((r -= wVoid) < 0) type = 'void';
    else if ((r -= wBlock) < 0) type = 'block';
    else if ((r -= wChest) < 0) type = 'chest';
    else type = 'grey';
    if (type === 'void' || type === 'block') {
      bonuses.push({ type, col: x });
    } else if (type === 'chest') {
      bonuses.push({ type: 'chest', col: x });
    } else {
      let greyPiece = _randomSetupPiece();
      // Checkers pieces must spawn on dark squares (greys enter at row 0)
      if ((greyPiece === CHECKERS || greyPiece === CHECKERS_KING) && !isDarkSquare(x, 0)) greyPiece = PAWN;
      bonuses.push({ type: 'grey', col: x, piece: greyPiece, eff: _rollEffectSet(waveCount) });
    }
  }
  return bonuses;
}

// Roll a set of spawn effects (does NOT touch the board). Effects are pre-rolled at wave
// generation so the preview row can show them, then applied (not re-rolled) at spawn.
// Per-roll chance ramps with wave: 6.25% at wave 1 → 50% at wave 30, then holds. Up to 3
// distinct effects. Pool: Attack+1, Health+1, Speed+1, Bloodthirsty, Fire, Water, Earth, Air.
function _rollEffectSet(waveCount = spawnCount) {
  const t = Math.max(0, Math.min(1, (waveCount - 1) / 29));
  const p = 0.0625 + (0.5 - 0.0625) * t;
  let pool = ['atk', 'hlth', 'spd', 'bt', 'fire', 'water', 'earth', 'air'];
  const eff = { effects: [], element: 0, status: 0, atk: 1, hlth: 1, spd: 1 };
  let count = 0;
  while (count < 3 && _rng() < p && pool.length > 0) {
    const pick = pool[randInt(pool.length)];
    pool = pool.filter(x => x !== pick);
    if (pick === 'atk')        { eff.atk = 2;  eff.effects.push('atk'); }
    else if (pick === 'hlth')  { eff.hlth = 2; eff.effects.push('hlt'); }
    else if (pick === 'spd')   { eff.spd = 2;  eff.effects.push('spd'); }
    else if (pick === 'bt')    { eff.status |= STATUS_BLOODTHIRSTY; eff.effects.push('bt'); }
    else if (pick === 'fire')  { eff.element |= ELEM_FIRE;  eff.effects.push('fire'); }
    else if (pick === 'water') { eff.element |= ELEM_WATER; eff.effects.push('water'); }
    else if (pick === 'earth') { eff.element |= ELEM_EARTH; eff.effects.push('earth'); }
    else if (pick === 'air')   { eff.element |= ELEM_AIR;   eff.effects.push('air'); }
    count++;
  }
  return eff;
}
// Apply a pre-rolled effect set to board square i (consumes no RNG).
function _applyEffectSet(i, eff) {
  if (!eff) return;
  attacks[i] = eff.atk; health[i] = eff.hlth; speeds[i] = eff.spd;
  elements[i] |= eff.element; statuses[i] |= eff.status;
  for (const e of eff.effects) _grantEffect(i, e);
}
// Roll + apply in one step, for direct placements that have no preview (opening board).
function _rollSpawnEffects(i, waveCount = spawnCount) { _applyEffectSet(i, _rollEffectSet(waveCount)); }

function applyRiverFlow(onDone) {
  const animPieces = [];
  for (let y = 0; y < 8; y++) {
    const cell = specialSpaces[idx(0, y)];
    if (!cell || cell.type !== 'river') continue;
    const dx = cell.dx;
    // Process columns from downstream end first to avoid blocking chain
    const cols = dx === 1 ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    for (const x of cols) {
      const i = idx(x, y);
      const nx = x + dx;
      if (!inB(nx, y)) continue;
      const di = idx(nx, y);
      if (isBlockSpace(di)) continue;
      // Move piece/chest
      if (board[i] !== NONE) {
        if (elements[i] & ELEM_WATER) continue; // Water pieces still resist the current; Earth no longer does
        if (board[di] !== NONE || di === merchantIdx) continue;
        {
          animPieces.push({ fromCX: MARGIN + x * TILE, fromCY: BOARD_Y + MARGIN + y * TILE, toCX: MARGIN + nx * TILE, toCY: BOARD_Y + MARGIN + y * TILE, toIdx: di, piece: board[i], side: sides[i], hlth: health[i], atk: attacks[i], spd: speeds[i] });
          movePiece(i, di);
          // Pushed onto an item space — activate it (e.g. a Bomb detonates on whoever
          // the river shoves onto it), same as a piece landing on the item by moving.
          if (itemSpaces[di] !== ITEM_NONE) _applyItemAuto(itemSpaces[di], di);
          _igniteOnLand(di); // river pushed the piece onto enemy fire → it catches fire
        }
        continue;
      }
      // Move merchant
      if (i === merchantIdx && board[di] === NONE) {
        animPieces.push({ fromCX: MARGIN + x * TILE, fromCY: BOARD_Y + MARGIN + y * TILE, toCX: MARGIN + nx * TILE, toCY: BOARD_Y + MARGIN + y * TILE, toIdx: di, spriteKey: 'merchant' });
        merchantIdx = di; continue;
      }
      // Drift item space. If the current carries it into a piece standing downstream, that piece
      // takes the item on contact — the mirror of the branch above where the river pushes a piece
      // onto an item. Without this the item slides UNDER the piece and sits there inert (nothing
      // re-activates an item beneath a stationary piece until a Team Advance pass — Griffindohr's
      // King straddled a Water Elementalizer for a full turn with no effect). Merchant squares
      // block the drift instead (he holds no items).
      if (itemSpaces[i] !== ITEM_NONE && itemSpaces[di] === ITEM_NONE && di !== merchantIdx) {
        const _drift = itemSpaces[i];
        itemSpaces[i] = ITEM_NONE;
        if (board[di] !== NONE) _applyItemAuto(_drift, di);
        else itemSpaces[di] = _drift;
      }
    }
  }
  // Water-trail currents: per-cell directional rivers left by Water Warriors flow one step this round,
  // just like the spawn bands above. Grouped by direction and processed downstream-first so a pushed
  // piece isn't swept twice within a group; _sweptTo guards across groups (a piece pushed onto a trail
  // cell of a DIFFERENT direction must not be pushed again this round — one river push per round, same
  // as the spawn bands). shovePiece applies each move (and its void/bomb/item/ignite side effects, plus
  // the Riptide/Flushed take flags via _waterShoveActive). Water pieces resist their own current.
  // (Band→trail chaining can't happen: trails are never laid on spawn-river rows.)
  _waterShoveActive = true;
  const _dirGroups = new Map(); // "dx,dy" -> [boardIdx,...]
  for (const [i, w] of waterTrails) {
    const k = w.dx + ',' + w.dy;
    (_dirGroups.get(k) || _dirGroups.set(k, []).get(k)).push(i);
  }
  const _sweptTo = new Set(); // squares a piece was pushed TO this flow — not pushed again
  for (const [k, cells] of _dirGroups) {
    const [wdx, wdy] = k.split(',').map(Number);
    const proj = (i) => (i % 8) * wdx + ((i / 8) | 0) * wdy;
    cells.sort((a, b) => proj(b) - proj(a)); // downstream end first
    for (const i of cells) {
      if (_sweptTo.has(i)) continue; // occupant already took its one push this round
      const isMerchant = i === merchantIdx && board[i] === NONE;
      if (board[i] === NONE && !isMerchant) continue;
      if (board[i] !== NONE && (elements[i] & ELEM_WATER)) continue; // Water pieces hold against the current
      const [x, y] = xy(i);
      const nx = x + wdx, ny = y + wdy;
      if (!inB(nx, ny)) continue;
      const di = idx(nx, ny);
      if (isBlockSpace(di) || board[di] !== NONE || di === merchantIdx) continue; // hard stop
      if (isVoidSpace(di)) {
        // Swept into a Void: shovePiece resolves the death; play the fall (startVoidDeath also
        // sets the White-loss achievement flags, in live play and re-sim alike).
        if (!isMerchant) startVoidDeath(MARGIN + nx * TILE + TILE / 2, BOARD_Y + MARGIN + ny * TILE + TILE / 2, board[i], sides[i], null);
      } else {
        const base = { fromCX: MARGIN + x * TILE, fromCY: BOARD_Y + MARGIN + y * TILE, toCX: MARGIN + nx * TILE, toCY: BOARD_Y + MARGIN + ny * TILE, toIdx: di };
        animPieces.push(isMerchant ? { ...base, spriteKey: 'merchant' }
          : { ...base, piece: board[i], side: sides[i], hlth: health[i], atk: attacks[i], spd: speeds[i] });
      }
      shovePiece(i, wdx, wdy);
      _sweptTo.add(di);
    }
  }
  _waterShoveActive = false;
  if (animPieces.length > 0) {
    startAnim(animPieces, 0, onDone);
  } else {
    if (onDone) onDone();
  }
}

function placeWave(row, wave) {
  for (const w of wave) {
    set(w.x, row, w.piece, B);
    _applyEffectSet(idx(w.x, row), w.eff);
  }
}

let firstMoveMade = false;
let resignConfirm = false;
let _faConfirm = false;     // showing the "Field Advance will crush your Warriors" confirm dialog
// True if a manual Field Advance would destroy a White piece on the bottom row (crushed by the field).
function _faWillCrushWhite() { for (let x = 0; x < 8; x++) if (sides[idx(x, 7)] === W) return true; return false; }
let sellMode = false;       // Merchant sell flow: player is choosing an inventory item to sell
let sellConfirmSlot = -1;   // inventory slot pending sell confirmation; -1 = none
// Sell value: half the item's buy price (min 1 for priced items).
function sellValue(item) { const p = itemPrice(item); return p > 0 ? Math.max(1, Math.floor(p / 2)) : 0; }
let _rewinderSaveOffer = false; // true when King dies but player has a Rewinder
let testMode = false;
let gamePhase = 'setup'; // 'setup' | 'playing'
let _miniReplayActive = false;
let _pendingCaptureAnims = []; // queued by makeMove, drained in startAnim onDone
// Append stationary ghost entries for each pending captured piece into an anim array.
function _appendCaptureGhosts(animArr) {
  for (const c of _pendingCaptureAnims) {
    if (c.type === 'item') continue;
    const [bx, by] = xy(c.boardIdx);
    const cx = MARGIN + bx * TILE, cy = BOARD_Y + MARGIN + by * TILE;
    animArr.push({ toIdx: c.boardIdx, fromCX: cx, fromCY: cy, toCX: cx, toCY: cy, piece: c.piece, side: c.side, hlth: c.hlth, atk: c.atk ?? 1, spd: c.spd ?? 1 });
  }
}
// Animate a move. If `legs` is a multi-square Air path (from _airMoveLegs), the mover (animPieces[0])
// hops square-by-square through each waypoint — first hop, then second, in succession — while every
// other entry (capture ghosts, castle rooks) is held stationary across all legs. Otherwise it's one
// ordinary startAnim. onDone runs exactly once, after the final hop. In headless re-sim (_instant),
// startAnim completes synchronously, so this collapses to the same result as a single call.
function _startMoveAnim(animPieces, legs, onDone) {
  if (!legs || legs.length < 2) { startAnim(animPieces, 0, onDone); return; }
  const mover = animPieces[0], others = animPieces.slice(1);
  const pts = [[mover.fromCX, mover.fromCY]]; // origin, then each waypoint (tile top-left, matching startAnim coords)
  for (const li of legs) pts.push([MARGIN + (li % 8) * TILE, BOARD_Y + MARGIN + Math.floor(li / 8) * TILE]);
  const runLeg = (k) => {
    const m = { ...mover, fromCX: pts[k][0], fromCY: pts[k][1], toCX: pts[k + 1][0], toCY: pts[k + 1][1] };
    startAnim([m, ...others], 0, () => { if (k + 2 < pts.length) runLeg(k + 1); else onDone(); });
  };
  runLeg(0);
}

// Fire off capture/item animations for all pending entries and clear the queue.
function _drainCaptureAnims() {
  let _tookPiece = false;
  for (const c of _pendingCaptureAnims) {
    if (c.type === 'item') startItemFlyAnim(c.item, c.sx, c.sy, findInventorySlot());
    else { startCaptureAnim(c.piece, c.side, c.sx, c.sy); _tookPiece = true; }
  }
  _pendingCaptureAnims = [];
  if (_tookPiece) triggerCaptureShake(); // shake on contact, when the attacker lands on the taken piece
}
let _pendingShopFlies = []; // queued by handleShopClick, attached to next startAnim replayAnimBuffer event
let _turnStartSnapIndices = []; // snapshot index at start of each White turn, for Rewinder
let timedMode = false;
let timedModeSecs = 15; // 15s is the only timed option
let _timerEnd = 0;        // Date.now() when White's turn expires (0 = not running)
let _timerDisplay = 0;    // last computed seconds-left value; frozen when timer stops
let _timerRafId = null;   // rAF handle for clock-redraw loop
let _timerTimeoutId = null;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function initBoard() {
  _runGen++;             // invalidate any pending async callbacks from the previous run
  anim = null; waveAnim = null; aiThinking = false;
  board.fill(NONE); sides.fill(0);
  spawnCount = 1;
  leapCount = 0;
  stopWindLoop(0);
  stopWhiteTurnTimer();
  _turnStartSnapIndices = [];
  selected = -1; validMoves = []; turn = W;
  resignConfirm = false; _faConfirm = false;
  gameOver = false; gameMsg = ""; score = 0; gold = 0;
  firstMoveMade = false; positionHistory = []; testMode = false;
  replaySnapshots = []; replayMode = false; replayIdx = 0; replayAutoPlay = false;
  if (replayAutoTimer) { clearTimeout(replayAutoTimer); replayAutoTimer = null; }
  _replayAnimBuffer = []; _replayTransitions = [];
  inventory.fill(ITEM_NONE); piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false; teleporterSelected = -1; clonerMode = false; clonerSelected = -1; shieldMode = false; bombMode = false; bombHoverIdx = -1; speedMode = false; _inspectIdx = -1; _inspectPreviewCol = -1; _resetTurnState();
  playerDead = {}; enemyDead = {}; flyAnims = []; itemFlyAnims = []; itemFlySlots = new Set(); shieldPops = [];
  _lostWhiteThisRun = false; _king20TakenBy = NONE;
  _recruitedCManThisRun = false; _recruitedCKingThisRun = false; _maxGoldThisRun = 0;
  _usedItemThisRun = false; _had4KingsAt25 = false; _timedOutThisRun = false; _startCounts = {};
  _tookShieldedKingWithSword = false; _pushedBlackIntoVoidByWater = false; _pushedBlackIntoBombByWater = false;
  _tookShieldedWithDoubleHit = false; _recruitedWithCKing = false; _recruitStreak = 0; _bombStreak = 0;
  _flawlessAdvances = 0; _lastAdvanceScore = 0; _whiteLostSinceAdvance = false;
  _resetTurnCounters();
  chestSpaces = new Set();
  _rewinderSaveOffer = false;
  if (_lbNameInput) { _lbNameInput.onblur = null; _lbNameInput.onkeydown = null; _lbNameInput.style.display = 'none'; } // hide the name field on Start Over
  if (_lbNameBtn) { _lbNameBtn.onpointerdown = null; _lbNameBtn.onclick = null; _lbNameBtn.style.display = 'none'; }     // …and its Submit button
  mainMenuOpen = false; // Start Over / new run lands on the setup screen (menu-bg scroll stops on its own)
  health.fill(1); shiftCountdown = 10;
  itemSpaces.fill(ITEM_NONE);
  _shadowSpaces = new Map(); _skyDropAnims = [];
  for (let i = 0; i < 64; i++) effectOrders[i] = [];
  pendingItemQueue = [];
  specialSpaces.fill(null);
  merchantIdx = -1; merchantOffers = []; merchantSold = [false, false, false];
  merchantRerollCountdown = MERCHANT_REROLL_CYCLE;
  merchantQueued = false; merchantQueuedCol = -1; merchantPendingRespawn = false;
  sellMode = false; sellConfirmSlot = -1;
  elements.fill(0); speeds.fill(1); burning.fill(0); fireSquares = new Map(); waterTrails = new Map(); elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  wkMoved = false; wraMoved = false; wrhMoved = false;
  epTarget = -1;
  gamePhase = 'setup';
  _beginSetup(classicSetup); // default the setup screen to Classic; the player can switch to Roll
}

function _randomSetupPiece() {
  // Weights: King 100, Queen 100, Pawn 800, Rook 200, Bishop 200, Knight 200, Checkers Man 10, Checkers King 1 = 1611
  const r = randInt(1611);
  if (r < 100)  return KING;
  if (r < 200)  return QUEEN;
  if (r < 1000) return PAWN;
  if (r < 1200) return ROOK;
  if (r < 1400) return BISHOP;
  if (r < 1600) return KNIGHT;
  if (r < 1610) return CHECKERS;
  return CHECKERS_KING;
}

function _randomEnemyPiece(waveCount = spawnCount) {
  // Difficulty ramp: odds shift from Pawn-heavy (early) toward Queen-heavy (late).
  // t = 0 at wave 1 → 1 at wave 30 (and stays 1 after). At wave 1 the weights
  // mirror White's setup; by wave 30 Queens dominate (~65%).
  const t = Math.max(0, Math.min(1, (waveCount - 1) / 29));
  const lerp = (a, b) => a + (b - a) * t;
  const w = [
    [QUEEN,        lerp(100, 1000)],
    [PAWN,         lerp(800,   40)],
    [ROOK,         lerp(200,  160)],
    [BISHOP,       lerp(200,  150)],
    [KNIGHT,       lerp(200,  150)],
    [CHECKERS,     10],
    [CHECKERS_KING, 1],
  ];
  const total = w.reduce((s, [, wt]) => s + wt, 0);
  let r = _rng() * total;
  for (const [piece, wt] of w) { if ((r -= wt) < 0) return piece; }
  return PAWN;
}

function rollSetup() {
  _startedClassic = false;
  // Clear all pieces and regenerate enemy wave
  board.fill(NONE); sides.fill(0); health.fill(1); elements.fill(0); statuses.fill(0); attacks.fill(1); speeds.fill(1); burning.fill(0);
  for (let i = 0; i < 64; i++) effectOrders[i] = [];
  spawnCount = 1;
  const firstWave = generateWave(spawnCount);
  placeWave(0, firstWave);
  nextWave = generateWave(spawnCount + 1);
  nextBonuses = generateRowBonuses(nextWave);

  // Place guaranteed King at a random position in rows 6–7; 1% chance it's a Checkers King
  const positions = [];
  for (let y = 6; y <= 7; y++) for (let x = 0; x < 8; x++) positions.push({ x, y });
  shuffle(positions);
  const startKing = (randInt(100) === 0 && isDarkSquare(positions[0].x, positions[0].y)) ? CHECKERS_KING : KING;
  set(positions[0].x, positions[0].y, startKing, W);
  _rollSpawnEffects(idx(positions[0].x, positions[0].y));

  // Queen is guaranteed; remaining 14 slots random
  set(positions[1].x, positions[1].y, QUEEN, W);
  _rollSpawnEffects(idx(positions[1].x, positions[1].y));
  for (let i = 2; i < 16; i++) {
    let p;
    // Weights: King 11, Queen 100, Pawn 800, Rook 200, Bishop 200, Knight 200, Checkers Man 10, Checkers King 1 = 1522
    const r = randInt(1522);
    if      (r < 11)   p = KING;
    else if (r < 111)  p = QUEEN;
    else if (r < 911)  p = PAWN;
    else if (r < 1111) p = ROOK;
    else if (r < 1311) p = BISHOP;
    else if (r < 1511) p = KNIGHT;
    else if (r < 1521) p = CHECKERS;
    else               p = CHECKERS_KING;
    // Checkers pieces must start on dark squares
    if ((p === CHECKERS || p === CHECKERS_KING) && !isDarkSquare(positions[i].x, positions[i].y)) p = PAWN;
    set(positions[i].x, positions[i].y, p, W);
    _rollSpawnEffects(idx(positions[i].x, positions[i].y));
  }

  // Starting inventory: guaranteed 1 item, then 1/8 chance of each additional
  inventory.fill(ITEM_NONE);
  let _invSlot = 0;
  do { if (_invSlot < inventory.length) inventory[_invSlot++] = _randomItem(); } while (randInt(8) === 0);


}

function classicSetup() {
  _startedClassic = true;
  board.fill(NONE); sides.fill(0); health.fill(1); elements.fill(0); statuses.fill(0); attacks.fill(1); speeds.fill(1); burning.fill(0);
  spawnCount = 1;
  const firstWave = generateWave(spawnCount);
  placeWave(0, firstWave);
  nextWave = generateWave(spawnCount + 1);
  nextBonuses = generateRowBonuses(nextWave);
  const backRank = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
  for (let x = 0; x < 8; x++) {
    set(x, 7, backRank[x], W);
    set(x, 6, PAWN, W);
  }
  inventory.fill(ITEM_NONE);
}

function startGame() {
  gamePhase = 'playing';
  _runStartMs = performance.now(); // start the run clock (for timed achievements)
  _startCounts = {};               // tally White's starting army by piece type
  for (let i = 0; i < 64; i++) if (sides[i] === W) _startCounts[board[i]] = (_startCounts[board[i]] || 0) + 1;
  takeReplaySnapshot();
  _turnStartSnapIndices.push(replaySnapshots.length - 1);
  _kingTurnNum = 0; _kingLastMovedType = NONE;   // fresh run — the next White turns are #1, #2 for the King's early lines
  _kingCand = []; for (const k in _kingFirsts) delete _kingFirsts[k]; // clear queued comments + one-shot flags
  _kingSay('start');
  draw();
  startWhiteTurnTimer();
}

function startWhiteTurnTimer() {
  if (!timedMode || gameOver || replayMode || _instant) return;
  stopWhiteTurnTimer();
  _timerDisplay = timedModeSecs;
  _timerEnd = Date.now() + timedModeSecs * 1000;
  // rAF loop keeps the clock display in sync — but only redraws when the displayed second
  // actually changes (piece/idle animations drive their own draws), sparing a full-canvas
  // repaint at 60fps for a value that ticks once per second.
  let _lastShownSec = -1;
  const tick = () => {
    if (!_timerRafId) return;
    const secsLeft = Math.max(0, Math.ceil((_timerEnd - Date.now()) / 1000));
    if (secsLeft !== _lastShownSec && !anim && flyAnims.length === 0) { _lastShownSec = secsLeft; draw(); }
    _timerRafId = requestAnimationFrame(tick);
  };
  _timerRafId = requestAnimationFrame(tick);
  // setTimeout fires when time is up; retries if blocked by animation/shop
  const _gen = _runGen; // a stale timer must never time out a NEW run's turn
  const onExpire = () => {
    if (_gen !== _runGen) return;
    if (!timedMode || turn !== W || gameOver || gamePhase !== 'playing') return;
    if (anim || waveAnim || _skyDropAnims.length > 0 || isItemActive() || shopMode || replayMode) {
      _timerTimeoutId = setTimeout(onExpire, 100); // never time out mid-pipeline — same idle rule as taps
      return;
    }
    stopWhiteTurnTimer();
    _logInput({ t: 'to' }); // timeout ends the turn — a real state change the validator must replay
    _timedOutThisRun = true; // a turn ran out of time (for the no-timeout achievement)
    selected = -1; validMoves = [];
    endWhiteTurn();
  };
  _timerTimeoutId = setTimeout(onExpire, timedModeSecs * 1000);
}

function stopWhiteTurnTimer() {
  if (_timerEnd > 0) _timerDisplay = Math.max(0, Math.ceil((_timerEnd - Date.now()) / 1000));
  if (_timerRafId) { cancelAnimationFrame(_timerRafId); _timerRafId = null; }
  if (_timerTimeoutId) { clearTimeout(_timerTimeoutId); _timerTimeoutId = null; }
  _timerEnd = 0;
}

const CONQUEST_FPS = 30;
const CONQUEST_FRAME_COUNT = 94;
const _conquestFrames = new Array(CONQUEST_FRAME_COUNT).fill(null).map(() => new Image());
let _conquestFramesReady = false;

// Conquest frames are now loaded as part of loadSprites so the splash covers them.

let _conquestGifActive = false;
let _conquestStartMs = 0;
let _conquestCurrentFrame = 0;
let _conquestStallStart = 0;              // when we began waiting on a not-yet-ready frame (0 = not waiting)
const CONQUEST_MAX_STALL_MS = 700;        // hard cap: a cosmetic intro must NEVER freeze the game on a slow/failed frame

function playConquestGif() {
  _conquestGifActive = true;
  _conquestCurrentFrame = 0;
  _conquestStallStart = 0;
  // Just start the loop — _conquestTick handles frame readiness (waiting up to the stall cap, and
  // skipping a null/errored frame). Dereferencing _conquestFrames[0] here would itself throw if
  // frame 0's load errored on a cold first-load.
  _conquestStartMs = performance.now();
  requestAnimationFrame(_conquestTick);
}

function _conquestTick() {
  if (!_conquestGifActive) return;
  const now = performance.now();
  const elapsed = now - _conquestStartMs;
  const targetFrame = Math.min(Math.floor(elapsed / 1000 * CONQUEST_FPS), CONQUEST_FRAME_COUNT - 1);
  const fr = _conquestFrames[targetFrame];
  // A frame still decoding → wait, but CAP the wait so it can't hang. A null frame (its load errored —
  // common on a cold first load of a new version, when the 94 large frames download under memory
  // pressure) is never waited on; the draw simply skips it. The old code did an unguarded
  // `_conquestFrames[targetFrame].complete`, which threw a TypeError on a null frame and froze the
  // rAF loop mid-animation (the "hangs in the latter half, only on a fresh version" bug).
  if (fr && !fr.complete) {
    if (!_conquestStallStart) _conquestStallStart = now;
    if (now - _conquestStallStart < CONQUEST_MAX_STALL_MS) {
      _conquestStartMs = now - (targetFrame / CONQUEST_FPS * 1000);
      requestAnimationFrame(_conquestTick);
      return;
    }
    // waited past the cap — skip ahead rather than freeze
  }
  _conquestStallStart = 0;
  _conquestCurrentFrame = targetFrame;
  draw();
  if (_conquestCurrentFrame >= CONQUEST_FRAME_COUNT - 1) {
    _conquestGifActive = false;
    startGame();
  } else {
    requestAnimationFrame(_conquestTick);
  }
}



function greyMovesFor(i) {
  const [x, y] = xy(i);
  const p = board[i];
  const isEarth = !!(elements[i] & ELEM_EARTH); // Earth Greys may also land on (destroy) a block
  const moves = [];
  const canLand = (nx, ny) => inB(nx, ny) && board[idx(nx, ny)] === NONE && idx(nx, ny) !== merchantIdx && !isVoidSpace(idx(nx, ny)) && (isEarth || !isBlockSpace(idx(nx, ny)));
  if (p === PAWN) {
    if (canLand(x, y - 1)) moves.push(idx(x, y - 1));
    if (canLand(x, y + 1)) moves.push(idx(x, y + 1));
  } else if (p === CHECKERS || p === CHECKERS_KING) {
    for (const [dx, dy] of [[1,1],[1,-1],[-1,1],[-1,-1]])
      if (canLand(x + dx, y + dy)) moves.push(idx(x + dx, y + dy));
  } else if (p === KNIGHT) {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]])
      if (canLand(x + dx, y + dy)) moves.push(idx(x + dx, y + dy));
  } else if (p === KING) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (canLand(x + dx, y + dy)) moves.push(idx(x + dx, y + dy));
    }
  } else {
    let dirs;
    if (p === ROOK) dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    else if (p === BISHOP) dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    else dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    for (const [dx, dy] of dirs) {
      let nx = x + dx, ny = y + dy;
      while (inB(nx, ny) && board[idx(nx, ny)] === NONE && !isVoidSpace(idx(nx, ny))) {
        const bi = idx(nx, ny);
        if (isBlockSpace(bi)) { if (isEarth) moves.push(bi); break; } // Earth Grey may land on the block, not slide past
        moves.push(bi);
        nx += dx; ny += dy;
      }
    }
  }
  return moves;
}

function greyPlay(onDone) {
  _ageTrails(N); // Greys' own trails (blocks/fire) age as their next turn begins (before any early-out)
  const greys = [];
  for (let i = 0; i < 64; i++) if (sides[i] === N) greys.push(i);
  if (greys.length === 0) { onDone(); return; }
  shuffle(greys);
  const _gen = _runGen;
  const doNext = (ni) => {
    if (_gen !== _runGen) return; // stale chain from a previous run
    if (ni >= greys.length) { onDone(); return; }
    const i = greys[ni];
    if (sides[i] !== N) { doNext(ni + 1); return; }
    const moves = greyMovesFor(i);
    if (moves.length === 0) { doNext(ni + 1); return; }
    const dest = moves[randInt(moves.length)];
    const [fx, fy] = xy(i), [tx, ty] = xy(dest);
    const p = board[i], h = health[i];
    movePiece(i, dest); // preserves statuses/elements/attacks/speeds/effectOrders (e.g. Bloodthirsty)
    if (elements[dest] & ELEM_EARTH) _applyEarthLanding(i, dest, N, true); // Earth Grey: destroy a block landed on, else drop a temp block along its move direction
    if (itemSpaces[dest] !== ITEM_NONE) _applyItemAuto(itemSpaces[dest], dest);
    _igniteFromCrossing(i, dest); // a Grey that crossed opposing fire catches fire
    startAnim([{
      toIdx: dest,
      fromCX: MARGIN + fx * TILE, fromCY: BOARD_Y + MARGIN + fy * TILE,
      toCX: MARGIN + tx * TILE, toCY: BOARD_Y + MARGIN + ty * TILE,
      piece: p, side: N, hlth: h
    }], 0, () => doNext(ni + 1));
  };
  doNext(0);
}

function slidingMoves(moves, x, y, dirs, s, isEarth = false) {
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (inB(nx, ny)) {
      if (side(nx, ny) === s) break;
      const ni = idx(nx, ny);
      if (sides[ni] === N) { if (s === W) moves.push(ni); break; } // White captures a Grey (Kings recruit); a Grey stops all sliders either way
      // Earth moves THROUGH blocks (perm or temp) — it can land on one (destroying it) or slide past;
      // a plain slider is stopped by the block.
      if (isBlockSpace(ni)) { if (isEarth) { moves.push(ni); nx += dx; ny += dy; continue; } break; }
      // Fire no longer blocks movement — a piece slides straight through it and catches fire on the
      // way (handled by _igniteFromCrossing after the move); it just can't be *set* on a river.
      const isVoid = specialSpaces[ni]?.type === 'void';
      if (!isVoid) moves.push(ni);
      if (piece(nx, ny) !== NONE) break;
      nx += dx; ny += dy;
    }
  }
}

// Air variant: pass through pieces/obstacles, land on any reachable vacant square
function airSlidingMoves(moves, x, y, dirs, s, isEarth = false) {
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (inB(nx, ny)) {
      const ni = idx(nx, ny);
      // Air moves THROUGH all blocks (perm or temp) — it flies over one and lands beyond; it can't
      // land ON a block (a solid tile) unless it's also Earth, which destroys it on landing.
      if (isBlockSpace(ni)) { if (isEarth) moves.push(ni); nx += dx; ny += dy; continue; }
      if (isVoidSpace(ni)) { nx += dx; ny += dy; continue; } // fly OVER the void — can't land on it (matches normal sliders)
      const occ = sides[ni];
      if (occ === s) { nx += dx; ny += dy; continue; } // fly through own pieces
      if (occ === N) { if (s === W) moves.push(ni); nx += dx; ny += dy; continue; } // White can capture a Grey; both sides still fly over it
      moves.push(ni); // vacant or capturable enemy square
      if (board[ni] !== NONE) { nx += dx; ny += dy; continue; } // fly through enemy pieces too
      nx += dx; ny += dy;
    }
  }
}


function isVoidSpace(i) { return specialSpaces[i]?.type === 'void'; }
function isBlockSpace(i) { return specialSpaces[i]?.type === 'block'; }
// Rivers are ROW bands: they render (see "River rows") and flow (applyRiverFlow) by the whole
// row, keyed off column 0. Per-cell river checks must match, or a "zombie" river cell — one left
// in a row whose column 0 is no longer a river (partial band from scrolling) — renders as dry land
// yet still silently douses fire. So river-ness is a property of the row, not the individual cell.
function isRiverSpace(i) { return specialSpaces[((i / 8) | 0) * 8]?.type === 'river'; }
function canLandEmpty(i) { return board[i] === NONE && !isVoidSpace(i) && !isBlockSpace(i); }
// Earth-aware landing test: an Earth warrior may also end on a block square (destroying it).
function canLandEarth(i, isEarth) { return board[i] === NONE && !isVoidSpace(i) && (isEarth || !isBlockSpace(i)); }

// Adds a 2-square checkers jump-capture to moves[]. Bounds checked by caller.
function _checkersAddJumpSlide(moves, midI, landI, s, isEarth = false) {
  if (sides[midI] !== 0 && sides[midI] !== s && (sides[midI] !== N || s === W)
      && board[midI] !== NONE && canLandEarth(landI, isEarth)) {
    moves.push(landI); // jump-capture an enemy, or (White only) a Grey
  }
}

function pseudoMoves(x, y) {
  const moves = [];
  const p = piece(x, y), s = side(x, y), e = enemy(s);
  const isAir = !!(elements[idx(x, y)] & ELEM_AIR); // Air phases through pieces/obstacles (sliders); it grants NO extended range
  const isEarth = !!(elements[idx(x, y)] & ELEM_EARTH); // Earth warriors may land on (and destroy) block squares
  if (p === PAWN) {
    const dir = s === W ? -1 : 1;
    const startY   = s === W ? 6 : 0;
    const fwdRange = 1;
    const maxFwd   = 2; // extra distance available from starting row
    const capRange = 1;
    // Forward steps — path must be clear
    const steps = y === startY ? maxFwd : fwdRange;
    for (let step = 1; step <= steps; step++) {
      const ny = y + dir * step;
      if (!inB(x, ny)) break;
      const ni = idx(x, ny);
      if (ni === merchantIdx || isVoidSpace(ni)) break;
      // Earth/Air pawns move through blocks; Earth may also land on one (destroying it); a plain pawn stops.
      if (isBlockSpace(ni)) { if (isEarth) moves.push(ni); if (isEarth || isAir) continue; break; }
      if (piece(x, ny) !== NONE) break;
      moves.push(ni);
      // Fire no longer stops the pawn's march — it steps through and catches fire on the way.
    }
    // Diagonal captures — can reach up to capRange squares; stop on any occupied square
    for (const dx of [-1, 1]) {
      for (let step = 1; step <= capRange; step++) {
        const nx = x + dx * step, ny = y + dir * step;
        if (!inB(nx, ny)) break;
        const ni = idx(nx, ny);
        if (isVoidSpace(ni) || isBlockSpace(ni)) break;
        if (s === W) {
          if (side(nx, ny) === e || sides[ni] === N) { moves.push(ni); break; } // capture an enemy, or kill a Grey
          if (ni === epTarget || ni === merchantIdx) { moves.push(ni); break; }
        } else {
          if (side(nx, ny) === e) { moves.push(ni); break; }
        }
        if (piece(nx, ny) !== NONE) break; // own piece or (for Black) a Grey blocks further diagonal
      }
    }
  } else if (p === CHECKERS) {
    const dir = s === W ? -1 : 1;
    for (const dx of [-1, 1]) {
      const nx = x + dx, ny = y + dir;
      const ni = inB(nx, ny) ? idx(nx, ny) : -1;
      if (ni >= 0 && canLandEarth(ni, isEarth)) moves.push(ni);
      const jx = x + 2*dx, jy = y + 2*dir;
      if (ni >= 0 && inB(jx, jy)) _checkersAddJumpSlide(moves, ni, idx(jx, jy), s, isEarth);
    }
  } else if (p === CHECKERS_KING) {
    for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const nx = x + dx, ny = y + dy;
      const ni = inB(nx, ny) ? idx(nx, ny) : -1;
      if (ni >= 0 && !isVoidSpace(ni) && (canLandEarth(ni, isEarth) || sides[ni] === N))
        moves.push(ni);
      const jx = x + 2*dx, jy = y + 2*dy;
      if (ni >= 0 && inB(jx, jy)) _checkersAddJumpSlide(moves, ni, idx(jx, jy), s, isEarth);
    }
  } else if (p === KNIGHT) {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const nx = x + dx, ny = y + dy;
      // A White Knight may land on a Grey (to kill it); Black still treats Greys as impassable.
      if (inB(nx, ny) && side(nx, ny) !== s && (sides[idx(nx, ny)] !== N || s === W) && !isVoidSpace(idx(nx, ny)) && (isEarth || !isBlockSpace(idx(nx, ny)))) moves.push(idx(nx, ny));
    }
  } else if (p === BISHOP) {
    const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    if (isAir) airSlidingMoves(moves, x, y, dirs, s, isEarth); else slidingMoves(moves, x, y, dirs, s, isEarth);
  } else if (p === ROOK) {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    if (isAir) airSlidingMoves(moves, x, y, dirs, s, isEarth); else slidingMoves(moves, x, y, dirs, s, isEarth);
  } else if (p === QUEEN) {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    if (isAir) airSlidingMoves(moves, x, y, dirs, s, isEarth); else slidingMoves(moves, x, y, dirs, s, isEarth);
  } else if (p === KING) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && sides[idx(nx, ny)] === N) && !isVoidSpace(idx(nx, ny)) && (isEarth || !isBlockSpace(idx(nx, ny)))) {
        moves.push(idx(nx, ny));
      }
    }
    if (s === W && !wkMoved && !isAttacked(x, y, s)) {
      if (!wrhMoved && piece(5,7)===NONE && piece(6,7)===NONE && !isAttacked(5,7,s) && !isAttacked(6,7,s))
        moves.push(idx(6, 7));
      if (!wraMoved && piece(3,7)===NONE && piece(2,7)===NONE && piece(1,7)===NONE && !isAttacked(3,7,s) && !isAttacked(2,7,s))
        moves.push(idx(2, 7));
    }
  }
  return moves;
}

// --- Elemental effect functions ---

function applyFireTrail(fromI, toI, p, s) {
  const _lay = (i) => { if (!isRiverSpace(i) && !waterTrails.has(i)) fireSquares.set(i, { side: s, age: 0 }); }; // water can't be set on fire (spawn river or trail current) — and water laid over fire douses it, so water wins both ways
  _lay(fromI);
  _lay(toI); // destination also burns
  // Checkers pieces don't touch intermediate squares (they jump over them), and Knights have no path
  if (p === KNIGHT || p === CHECKERS || p === CHECKERS_KING) return;
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const dx = tx === fx ? 0 : (tx > fx ? 1 : -1);
  const dy = ty === fy ? 0 : (ty > fy ? 1 : -1);
  let cx = fx + dx, cy = fy + dy;
  while (cx !== tx || cy !== ty) { _lay(idx(cx, cy)); cx += dx; cy += dy; }
}

// A Water Warrior leaves a directional river current in its wake: every square it started on and slid
// THROUGH (not the landing — it stands there) becomes a river pointing the move direction. Those
// currents flow once per round (applyRiverFlow) like spawn-rivers, pushing occupants one step, and age
// out over two rounds (_ageTrails). Laying a current also douses any fire on the square. Jumpers have no
// path, so they only lay their origin. Skips walls, voids, and spawn-river rows (which flow row-wide).
function applyWaterTrail(fromI, toI, p, s) {
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const dx = tx === fx ? 0 : (tx > fx ? 1 : -1);
  const dy = ty === fy ? 0 : (ty > fy ? 1 : -1);
  const _lay = (i) => {
    if (isBlockSpace(i) || isVoidSpace(i) || isRiverSpace(i)) return;
    waterTrails.set(i, { dx, dy, side: s, age: 0 });
    fireSquares.delete(i);            // water douses fire on the square
    if (burning[i] > 0) burning[i] = 0; // and puts out any piece standing there
  };
  _lay(fromI);
  if (p === KNIGHT || p === CHECKERS || p === CHECKERS_KING) return; // jumpers: origin-only (no slid-through path)
  let cx = fx + dx, cy = fy + dy;
  while (cx !== tx || cy !== ty) { _lay(idx(cx, cy)); cx += dx; cy += dy; }
}

function _shoveMerchant(dx, dy) {
  const [mx, my] = xy(merchantIdx);
  const nx = mx + dx, ny = my + dy;
  if (!inB(nx, ny) || isBlockSpace(idx(nx, ny))) return null;
  const destI = idx(nx, ny);
  if (board[destI] !== NONE || destI === merchantIdx) return null;
  if (isVoidSpace(destI)) {
    const oldIdx = merchantIdx;
    merchantIdx = -1;
    merchantPendingRespawn = true;
    return { merchantVoid: true, oldIdx, destI };
  }
  merchantIdx = destI;
  return null;
}

function shovePiece(srcI, dx, dy) {
  // Merchant is tracked separately from board[]
  if (srcI === merchantIdx) return _shoveMerchant(dx, dy);
  if (board[srcI] === NONE) return;
  const [nx, ny] = xy(srcI);
  const ndx = nx + dx, ndy = ny + dy;
  if (!inB(ndx, ndy) || isBlockSpace(idx(ndx, ndy))) return; // hard stop at edge/block
  const destI = idx(ndx, ndy);
  if (board[destI] !== NONE || destI === merchantIdx) return; // occupied: blocked
  if (isVoidSpace(destI)) {
    const p = board[srcI], s = sides[srcI];
    if ((p === KING || p === CHECKERS_KING) && s === W) _triggerGameOver(`Game Over! Score: ${score}`);
    if (s === B) { if (p === KING || p === CHECKERS_KING) score++; gold += GOLD_VALUE[p] ?? 0; enemyDead[p] = (enemyDead[p] || 0) + 1; }
    if (s === B && _waterShoveActive && !replayMode) _pushedBlackIntoVoidByWater = true; // pushed a Black into a Void with a Water piece
    clearSquare(srcI);
    return;
  }
  const _shovedSide = sides[srcI];
  const _destBomb = itemSpaces[destI] === ITEM_BOMB;
  movePiece(srcI, destI);
  // Pushed onto an item space (e.g. a Bomb) — activate it, same as landing there by
  // moving. NOT during replay: recorded frames already contain the detonation's
  // outcome, and re-running it live leaks side effects (merchant respawn, game over,
  // graveyard counts landing after the snapshot restore).
  if (itemSpaces[destI] !== ITEM_NONE && !replayMode) {
    if (_destBomb && _shovedSide === B && _waterShoveActive) _pushedBlackIntoBombByWater = true;
    _applyItemAuto(itemSpaces[destI], destI);
  }
  if (!replayMode) _igniteOnLand(destI); // shoved onto enemy fire → catches fire
}

// A piece that moved fromI→toI catches fire if its path crossed OPPOSING fire (set burning=3), and
// is extinguished if its path crossed a river/water (burning=0) — later wins, so a move that crosses
// fire then water ends up safe. Fire & Water warriors never burn. Runs in BOTH real play and minimax
// (burning is rolled back by saveState), so the AI treats crossing fire as the delayed loss it is.
// A death itself is resolved later by the once-per-round _burnTick, not here.
function _igniteFromCrossing(fromI, toI) {
  if (board[toI] === NONE) return;
  const s = sides[toI];
  if (elements[toI] & (ELEM_FIRE | ELEM_WATER)) { burning[toI] = 0; return; } // immune — never on fire
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  // Squares newly ENTERED this move (never the origin). A straight slide walks its whole path; a
  // jump/teleport (non-straight, or from===to) only touches the landing square. Jumpers leap OVER
  // their midpoint (same rule as applyFireTrail lays by), so they too are landing-square-only.
  const lp = board[toI];
  const isJumper = lp === KNIGHT || lp === CHECKERS || lp === CHECKERS_KING;
  const path = [];
  if (!isJumper && fromI !== toI && (dx === 0 || dy === 0 || Math.abs(tx - fx) === Math.abs(ty - fy))) {
    let cx = fx + dx, cy = fy + dy;
    while (true) { path.push(idx(cx, cy)); if (cx === tx && cy === ty) break; cx += dx; cy += dy; }
  } else {
    path.push(toI);
  }
  let burn = burning[toI]; // any fire it was already carrying
  for (const sq of path) {
    const f = fireSquares.get(sq);
    if (f && f.side !== s) burn = 3;                    // crossed opposing fire → ignite
    if (isRiverSpace(sq) || waterTrails.has(sq)) burn = 0;  // crossed water (spawn river or trail current) → extinguished
  }
  burning[toI] = burn;
}
// Land-only ignite for relocations without a slide path (shove, teleport, clone, river-push).
function _igniteOnLand(i) { _igniteFromCrossing(i, i); }
// Resolve one round of burning: every on-fire piece ticks down; a piece that reaches 0 burns up.
// Real-only (called once per round at the turn hand-back), so score/gold/graveyard/Game-Over are safe.
function _burnTick() {
  for (let i = 0; i < 64; i++) {
    if (burning[i] <= 0 || board[i] === NONE) continue;
    if (--burning[i] <= 0) { burning[i] = 0; _burnUp(i); }
  }
}
function _burnUp(i) {
  const p = board[i], s = sides[i];
  const [bx, by] = xy(i);
  startFireDeath(MARGIN + bx * TILE + TILE / 2, BOARD_Y + MARGIN + by * TILE + TILE / 2, p, s); // flame-engulf animation (live only)
  if ((p === KING || p === CHECKERS_KING) && s === B) score++;
  if (s === B) { gold += GOLD_VALUE[p] ?? 0; enemyDead[p] = (enemyDead[p] || 0) + 1; }
  if (s === W) { _lostWhiteThisRun = true; _whiteLostSinceAdvance = true; } // a White Warrior burned to death
  clearSquare(i);
  if ((p === KING || p === CHECKERS_KING) && s === W && countKings(W) === 0) _triggerGameOver(`Game Over! Score: ${score}`);
}

function isAttacked(tx, ty, bySide) {
  const att = enemy(bySide);
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== att) continue;
    const [ax, ay] = xy(i);
    const p = board[i];
    if (p === PAWN) {
      const dir = att === W ? -1 : 1;
      if (ay + dir === ty && (ax - 1 === tx || ax + 1 === tx)) return true;
    } else if (p === CHECKERS) {
      const dir = att === W ? -1 : 1;
      if (ay + dir === ty && (ax - 1 === tx || ax + 1 === tx)) return true;
    } else if (p === KNIGHT) {
      for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]])
        if (ax + dx === tx && ay + dy === ty) return true;
    } else if (p === KING) {
      if (Math.abs(ax - tx) <= 1 && Math.abs(ay - ty) <= 1) return true;
    } else {
      let dirs;
      if (p === BISHOP) dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
      else if (p === ROOK) dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      else dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      // A slider's attack reach must match its movement (pseudoMoves): Air phases through pieces AND
      // blocks; Earth phases through blocks (but stops at pieces); a plain slider stops at either.
      const isAir = !!(elements[i] & ELEM_AIR);
      const isEarth = !!(elements[i] & ELEM_EARTH);
      for (const [dx, dy] of dirs) {
        let nx = ax + dx, ny = ay + dy;
        while (inB(nx, ny)) {
          if (nx === tx && ny === ty) return true;
          if (!isAir) {
            const bi = idx(nx, ny);
            if (isBlockSpace(bi) && !isEarth) break; // a block stops a non-Earth, non-Air slider
            if (board[bi] !== NONE) break;           // any piece stops a non-Air slider
          }
          nx += dx; ny += dy;
        }
      }
    }
  }
  return false;
}

function legalMoves(x, y) {
  // White has no check restriction — all pseudo-legal moves are legal.
  // For Black: only the King itself is restricted from moving into check.
  // Non-King Black pieces move freely; only the Black King is check-filtered here.
  const s = side(x, y);
  if (s === W) return pseudoMoves(x, y);
  const movingPiece = board[idx(x, y)];
  if (movingPiece !== KING) return pseudoMoves(x, y);
  // Black King: filter out moves that land on a square attacked by White,
  // EXCEPT capturing a White King — that wins instantly (or bounces off its shield),
  // so it must never be filtered even when the King's square is defended.
  const fromI = idx(x, y);
  // NOTE (by design): a Grey blocking a White slider's ray DOES count as cover here, even though
  // greyPlay runs right after Black's move and the Grey may wander off and expose the King. The
  // Grey opening that line is a deliberate opportunity for the player, not an AI blind spot.
  return pseudoMoves(x, y).filter(m => {
    if ((board[m] === KING || board[m] === CHECKERS_KING) && sides[m] === W) return true; // taking a White King wins/bounces — never filter
    const [nx, ny] = xy(m);
    // Test the square with the move SIMULATED: vacating the origin can open a slider's line onto m —
    // a King sliding along a checking rook's own ray must stay illegal (its body was the blocker).
    // Checking the un-simulated board misses that. Mutate/restore in place — no RNG or other state
    // touched, so it stays cheap enough for the minimax hot path.
    const kp = board[fromI], ksd = sides[fromI], cp = board[m], csd = sides[m];
    board[m] = kp; sides[m] = ksd; board[fromI] = NONE; sides[fromI] = 0;
    const attacked = isAttacked(nx, ny, B);
    board[fromI] = kp; sides[fromI] = ksd; board[m] = cp; sides[m] = csd;
    return !attacked;
  });
}

// Applies shield-bounce state for atkI→defI (must already satisfy health[defI]>1 check).
// Returns { mode:'attacker-bounce', bounceI } (Earth no longer "bonks" — it bounces like any attacker).
function applyShieldBounceState(atkI, defI, p) {
  health[defI]--;
  if (health[defI] < 2) _removeEffect(defI, 'hlt'); // shield consumed — drop the badge
  const bounceI = calcBouncePos(atkI, defI, p);
  if (bounceI !== atkI) {
    if (isVoidSpace(bounceI)) {
      // The attacker bounced onto a Void — it perishes there rather than surviving on it. score/gold
      // are rolled back by saveState during minimax (so lookahead values it correctly); the graveyard
      // tally, Game Over (a White King lost), and the fall animation are real-only, done by the
      // caller via result.voidDeath.
      const bp = board[atkI], bs = sides[atkI];
      if (bs === B && (bp === KING || bp === CHECKERS_KING)) score++; // a Black King lost to the void still counts
      if (bs === B) gold += GOLD_VALUE[bp] ?? 0;
      clearSquare(atkI);
      return { mode: 'attacker-bounce', bounceI, voidDeath: true, deadPiece: bp, deadSide: bs };
    }
    movePiece(atkI, bounceI);
  }
  return { mode: 'attacker-bounce', bounceI };
}

function calcBouncePos(fromI, toI, p) {
  if (p === ROOK || p === BISHOP || p === QUEEN) {
    const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
    const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    let lastEmpty = fromI;
    let cx = fx + dx, cy = fy + dy;
    while (cx !== tx || cy !== ty) {
      if (board[idx(cx, cy)] === NONE) lastEmpty = idx(cx, cy);
      cx += dx; cy += dy;
    }
    return lastEmpty;
  }
  return fromI;
}

function makeMove(fromI, toI, visual = false) {
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const p = board[fromI], s = sides[fromI];
  if (visual && s === W) {
    _kingLastMovedType = p; // remember the player's most-recently-moved piece (for the King's line)
    if (p === CHECKERS) _kingQueueFirst('firstWCheckersMove');           // first time fielding the strange folk
    else if (p === CHECKERS_KING) _kingQueueFirst('firstWCheckersKingMove');
  }
  const captured = board[toI];
  const capSide = sides[toI];
  // (Fire no longer clears on a fresh move — it ages out over two rounds via _ageTrails.)

  // Checkers / Checkers King jump: leaps 2 diagonally — remove the piece in the middle square (only if it's an enemy, not an Air slide)
  if ((p === CHECKERS || p === CHECKERS_KING) && Math.abs(tx - fx) === 2 && Math.abs(ty - fy) === 2) {
    const midI = idx((fx + tx) / 2, (fy + ty) / 2);
    const capPiece = board[midI], capSide = sides[midI], capHlth = health[midI];
    if (capPiece !== NONE && capSide !== s && (capSide !== N || s === W)) { // White may also jump-kill a Grey
      if (visual) { playSfx('capture'); playSfx('punch'); _pendingCaptureAnims.push({ piece: capPiece, side: capSide, hlth: capHlth, atk: attacks[midI], spd: speeds[midI], boardIdx: midI, sx: MARGIN + ((fx+tx)/2)*TILE + TILE/2, sy: BOARD_Y + MARGIN + ((fy+ty)/2)*TILE + TILE/2 }); }
      if (s === W) gold += (capSide === N ? Math.floor((GOLD_VALUE[capPiece] ?? 0) / 2) : (GOLD_VALUE[capPiece] ?? 0)); // Grey kills pay half
      if ((capPiece === KING || capPiece === CHECKERS_KING) && s === W && capSide === B) { score += 1; if (visual && score === 20) _king20TakenBy = p; if (visual && score === 25) _had4KingsAt25 = countKings(W) >= 4; } // a Grey King gives gold but no point
      if (visual && s === W && capSide === B) _trackWhiteTake(p, fromI, capPiece); // per-turn take tracking (Black takes only)
      else if (visual && s === W && capSide === N) _kingQueue('killGrey'); // struck down a Grey
      board[midI] = NONE; sides[midI] = 0; health[midI] = 1;
    }
  }

  // White piece attacks a Grey: King (or Checkers King) recruits it; all others kill it (half gold)
  if (s === W && sides[toI] === N) {
    if (p === KING || p === CHECKERS_KING) {
      if (visual && _KING_RECRUIT_KEY[board[toI]]) _kingQueue(_KING_RECRUIT_KEY[board[toI]]); // the King welcomes the convert
      sides[toI] = W;
      const bounceI = calcBouncePos(fromI, toI, p);
      if (bounceI !== fromI) {
        copyPiece(fromI, bounceI); sides[bounceI] = W;
        clearSquare(fromI);
      }
      return;
    }
    // non-King: fall through to normal capture logic
  }

  // Bounce: attacker hits a piece with more health than attacker's attack power
  if (sides[toI] !== s && sides[toI] !== N && health[toI] > attacks[fromI]) {
    applyShieldBounceState(fromI, toI, p);
    return;
  }

  if (visual && captured !== NONE && capSide !== s) {
    // Queen and Rook takes get their own sound; everyone else the slide+punch. Fires at move start.
    if (p === QUEEN) playSfx('queencap');
    else if (p === ROOK) { playSfx('rookcap'); playSfx('anvil'); }
    else { playSfx('capture'); playSfx('punch'); }
    _pendingCaptureAnims.push({ piece: captured, side: capSide, hlth: health[toI], atk: attacks[toI], spd: speeds[toI], boardIdx: toI, sx: MARGIN + tx * TILE + TILE / 2, sy: BOARD_Y + MARGIN + ty * TILE + TILE / 2 });
  }

  if (captured !== NONE && sides[toI] !== s && s === W) {
    gold += (capSide === N ? Math.floor((GOLD_VALUE[captured] ?? 0) / 2) : (GOLD_VALUE[captured] ?? 0)); // killing a Grey pays half its Black gold value
  }
  if ((captured === KING || captured === CHECKERS_KING) && capSide === B && s === W) { // a Grey King gives gold but no point (capSide===B only)
    score += 1;
    if (visual && score === 20) _king20TakenBy = p; // record the piece that took the 20th King
    if (visual && score === 25) _had4KingsAt25 = countKings(W) >= 4; // team size at the 25th King
  }
  if (visual && s === W && captured !== NONE && capSide === B) {
    _trackWhiteTake(p, fromI, captured); // per-turn take tracking
    // Shielded King (health≥2) captured (only possible with attack≥2 = a Sworded warrior)
    if ((captured === KING || captured === CHECKERS_KING) && health[toI] >= 2) _tookShieldedKingWithSword = true;
    // A Fast warrior finished off a shielded Black piece it had bounced off earlier this turn
    if (_turnFastBounced.has(toI)) _tookShieldedWithDoubleHit = true;
  } else if (visual && s === W && captured !== NONE && capSide === N) _kingQueue('killGrey'); // struck down a Grey
  if (chestSpaces.has(toI) && s === W) {
    chestSpaces.delete(toI);
    const _chestItem = _randomItem();
    if (visual) {
      playSfx('chest'); playSfx('pickup');
      _pendingCaptureAnims.push({ type: 'item', item: _chestItem, sx: MARGIN + tx * TILE + TILE / 2, sy: BOARD_Y + MARGIN + ty * TILE + TILE / 2 });
    } else {
      addToInventory(_chestItem);
    }
  }

  if (p === KING && s === W) {
    // A genuine castle: the King's first move, two squares horizontally along its home rank, with
    // the matching corner Rook still present and unmoved. These home-rank + rook-present guards
    // matter now that an Air King can also move two squares in any direction — without them a
    // 2-square Air-King move (horizontal OR diagonal, both give |tx-fx|===2) would be misread as a
    // castle and spawn a phantom rook / wipe a corner square.
    const isCastleMove = !wkMoved && fx === 4 && fy === 7 && ty === 7 &&
      ((tx === 6 && !wrhMoved && board[idx(7, 7)] === ROOK && sides[idx(7, 7)] === W) ||
       (tx === 2 && !wraMoved && board[idx(0, 7)] === ROOK && sides[idx(0, 7)] === W));
    wkMoved = true;
    if (isCastleMove) {
      if (tx > fx) { set(5, fy, ROOK, s); set(7, fy, NONE, 0); }
      else { set(3, fy, ROOK, s); set(0, fy, NONE, 0); }
    }
  }
  if (p === ROOK && s === W) {
    if (fromI === idx(0,7)) wraMoved = true;
    if (fromI === idx(7,7)) wrhMoved = true;
  }

  if (p === PAWN && toI === epTarget) {
    const capY = ty + (s === W ? 1 : -1);
    const epI = idx(tx, capY);
    const epPiece = piece(tx, capY);
    const epSide = side(tx, capY);
    if (visual && epPiece !== NONE) {
      _pendingCaptureAnims.push({ piece: epPiece, side: epSide, hlth: health[epI], atk: attacks[epI], spd: speeds[epI], boardIdx: epI, sx: MARGIN + tx * TILE + TILE / 2, sy: BOARD_Y + MARGIN + capY * TILE + TILE / 2 });
    }
    if (epPiece === KING && s === W) score += 1;
    if (s === W) gold += GOLD_VALUE[epPiece] ?? 0;
    elements[idx(tx, capY)] = 0; // clear elements of en-passant captured square
    set(tx, capY, NONE, 0);
  }

  epTarget = -1;
  if (p === PAWN && Math.abs(ty - fy) === 2) {
    epTarget = idx(fx, (fy + ty) / 2);
  }

  const movedHealth = health[fromI];
  const movedElem = elements[fromI];
  const movedStatus = statuses[fromI];
  const movedAtk = attacks[fromI];
  const movedSpd = speeds[fromI];
  const movedBurn = burning[fromI];
  let landPiece = p;
  // Checkers Man promotion: reaches the far back rank
  if (p === CHECKERS && ((s === W && ty === 0) || (s === B && ty === 7))) landPiece = CHECKERS_KING;
  board[toI] = landPiece; sides[toI] = s; health[toI] = movedHealth;
  elements[toI] = movedElem; statuses[toI] = movedStatus; attacks[toI] = movedAtk; speeds[toI] = movedSpd;
  burning[toI] = movedBurn;
  effectOrders[toI] = [...effectOrders[fromI]];
  clearSquare(fromI);
  if (movedElem & ELEM_EARTH) _applyEarthLanding(fromI, toI, s, visual); // Earth: destroy a block landed on, else drop a temp block along the move direction
  _igniteFromCrossing(fromI, toI); // catch fire crossing opposing fire (or extinguish on a river) — real + sim (rolled back in sim)

  // Ground items (sky drops): in simulation, bank the item so the search values
  // landing on item squares (via the inventory eval term). Real pickups run
  // through activateItemSpace in the click/AI flow instead.
  if (!visual && s === W && itemSpaces[toI] !== ITEM_NONE && canItemAffectPiece(itemSpaces[toI], toI)) {
    addToInventory(itemSpaces[toI]);
    itemSpaces[toI] = ITEM_NONE;
  } else if (!visual && s !== W && itemSpaces[toI] === ITEM_BOMB) {
    // Black/Grey auto-detonates a field bomb on landing — model the blast so minimax
    // sees the loss (the moved piece dies) and avoids stepping on bombs.
    _simDetonate(toI);
  }
}

// Earth landing: if the warrior ended on a Block square, destroy it (no temp block spawns then).
// Otherwise drop a Temporary Block on the vacant square CONTINUING the piece's movement — one step
// past the landing square along the move's direction (the sign of each axis). Moving up puts the
// wall above, down below, sideways beside, diagonals diagonal — and a Knight's L (e.g. +1,-2 →
// +1,-1) lands its wall on the approximate diagonal. Temp blocks obstruct exactly like normal
// blocks and age out over two of their owner's turns (see _ageTrails). The spawn is a
// real-move effect (visual): it runs identically in live play and headless re-sim — which drive every
// real move through makeMove(visual=true) — but is kept out of minimax so lookahead stays cheap. The
// block-destruction runs in sim too (it changes legality), which is why saveState covers specialSpaces.
function _applyEarthLanding(fromI, landI, side, visual) {
  if (isBlockSpace(landI)) specialSpaces[landI] = null; // Earth destroys the block it lands on (also in sim: changes legality)
  if (!visual) return;                                  // the block TRAIL below is a real-move effect only
  // Lay a temporary block on every vacant square the warrior slid THROUGH — the trail it leaves
  // behind (its origin + the squares between), never the landing square where it now stands. Like
  // the Fire trail: a straight slide fills its whole path; a Knight jumps, so it only marks its origin.
  const [fx, fy] = xy(fromI), [tx, ty] = xy(landI);
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  const _lay = (i) => {
    if (i === landI || board[i] !== NONE || specialSpaces[i] || i === merchantIdx) return; // vacant squares only
    specialSpaces[i] = { type: 'block', temp: true, owner: side, age: 0 };
  };
  _lay(fromI);
  // Jumpers leave no mid-path trail (same rule as applyFireTrail): a Knight has no path, and a
  // Checkers jump leaps OVER its square — without this a jump would wall the captured piece's
  // square. board[landI] is the piece that just landed (a Checkers promoted on landing is a
  // Checkers King — also excluded).
  const lp = board[landI];
  if (lp === KNIGHT || lp === CHECKERS || lp === CHECKERS_KING) return;
  const straightLine = (dx !== 0 || dy !== 0) && (dx === 0 || dy === 0 || Math.abs(tx - fx) === Math.abs(ty - fy));
  if (straightLine) {
    let cx = fx + dx, cy = fy + dy;
    while (cx !== tx || cy !== ty) { _lay(idx(cx, cy)); cx += dx; cy += dy; }
  }
}
// Age the trails a side laid — its temporary Earth blocks AND its Fire — called right before that
// side acts again. Each survives TWO of the owner's turns (age 0 when laid, cleared once it reaches
// age 2), so the owner gets a turn to make use of its own trail. Deterministic (live + re-sim).
function _ageTrails(side) {
  for (let i = 0; i < 64; i++) {
    const sp = specialSpaces[i];
    if (sp && sp.type === 'block' && sp.temp && sp.owner === side) {
      sp.age = (sp.age || 0) + 1;
      if (sp.age >= 2) specialSpaces[i] = null;
    }
  }
  for (const [i, f] of [...fireSquares]) {
    if (f.side !== side) continue;
    if (++f.age >= 2) fireSquares.delete(i);
  }
  for (const [i, w] of [...waterTrails]) {
    if (w.side !== side) continue;
    if (++w.age >= 2) waterTrails.delete(i);
  }
}

function endWhiteTurn() {
  _inspectIdx = -1; _inspectPreviewCol = -1; // the tap-marker rings are a player-turn thing; clear as control leaves the player
  // If a Speed piece has remaining extra moves, show them before actually ending the turn
  if (_speedIdx >= 0) {
    const [_spx, _spy] = xy(_speedIdx);
    const _spMoves = legalMoves(_spx, _spy);
    if (_spMoves.length > 0) {
      selected = _speedIdx; validMoves = _spMoves;
      draw(); return;
    }
    _resetTurnState();
  }
  stopWhiteTurnTimer();
  lastActingSide = W;
  _turnBoundaryUpdate(); // fold this turn's activity into streaks, clear per-turn counters
  shiftCountdown--;
  if (shiftCountdown <= 0) {
    _kingQueueFirst('firstAutoAdvance'); // first countdown-forced advance (before fieldAdvance's flush)
    fieldAdvance(); // auto-advance ends the turn AND counts it (via fieldAdvance's _kingCountTurn)
  } else {
    _kingCountTurn(); // a normal turn ended here (also the tail of a Team Advance)
    updateWindAmbiance(); // fade wind in if the player just cleared the board of Black pieces
    turn = B;
    draw();
    if (!gameOver) aiPlay();
  }
}

// --- Team Leap & Pitch Shift ---

function isItemActive() {
  return piecePromoterMode || teleporterMode || clonerMode || shieldMode || bombMode || elementizerMode || vampireFangMode || swordMode || speedMode;
}

function cancelItemMode() {
  // If the active mode came from a board item space (a Team-Advance landing queued it),
  // canceling must still drain pendingItemQueue — otherwise the items behind it (e.g. a Bomb
  // another piece landed on) silently evaporate and the turn never ends. Mirrors the cancel
  // paths inside the per-item click handlers.
  const fromSpace = activeItemSpaceIdx >= 0;
  activeItemSpaceIdx = -1;
  piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false;
  clonerMode = false; shieldMode = false; bombMode = false; bombHoverIdx = -1;
  elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  vampireFangMode = false; swordMode = false; speedMode = false;
  teleporterSelected = -1; clonerSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  if (fromSpace) { processNextQueuedItem(); } else { draw(); }
}

function trashActiveItem() {
  if (inventory._activeSlot !== undefined) {
    removeFromInventory(inventory._activeSlot);
    delete inventory._activeSlot;
  }
  const fromSpace = activeItemSpaceIdx >= 0; // same queue-drain duty as cancelItemMode above
  activeItemSpaceIdx = -1;
  piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false;
  clonerMode = false; shieldMode = false; bombMode = false; bombHoverIdx = -1;
  elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  teleporterSelected = -1; clonerSelected = -1;
  if (fromSpace) { processNextQueuedItem(); } else { draw(); }
}

function canTeamLeap() {
  if (gameOver || turn !== W || aiThinking) return false;
  for (let x = 0; x < 8; x++) {
    const occupied = new Set();
    for (let y = 0; y < 8; y++) {
      if (sides[idx(x, y)] === B || sides[idx(x, y)] === N) occupied.add(y);
      if (merchantIdx >= 0 && idx(x, y) === merchantIdx) occupied.add(y);
    }
    for (let y = 0; y < 8; y++) {
      if (sides[idx(x, y)] !== W) continue;
      if (y === 0 || occupied.has(y - 1) || isBlockSpace(idx(x, y - 1))) { occupied.add(y); }
      else { return true; }
    }
  }
  return false;
}

function teamAdvance() {
  if (gameOver || turn !== W || aiThinking || anim || waveAnim) return;
  _logInput({ t: 'ta' });
  _kingLastMovedType = NONE; // an Advance moved no single piece — the King's line falls back to random
  _turnBoundaryUpdate(); // Team Advance ends the White turn — update streaks, clear per-turn counters
  _resetTurnState(); // Team Advance ends the turn — forfeit any pending Speed/Bloodthirsty extra move
  playSfx('torch');  // Team Advance

  // Per-column blocking: a white piece can't move if the row above is occupied
  // by an enemy, or by a white piece that itself can't move.
  const canMoveUp = new Array(64).fill(false);
  for (let x = 0; x < 8; x++) {
    const occupied = new Set();
    for (let y = 0; y < 8; y++) {
      if (sides[idx(x, y)] === B || sides[idx(x, y)] === N) occupied.add(y);
      if (merchantIdx >= 0 && idx(x, y) === merchantIdx) occupied.add(y);
    }
    for (let y = 0; y < 8; y++) {
      if (sides[idx(x, y)] !== W) continue;
      if (y === 0 || occupied.has(y - 1) || isBlockSpace(idx(x, y - 1))) {
        occupied.add(y); // stays, blocks pieces below
      } else {
        canMoveUp[idx(x, y)] = true;
        occupied.add(y - 1); // destination claimed
      }
    }
  }

  // Capture animation info before board update
  const leapAnimPieces = [];
  for (let i = 0; i < 64; i++) {
    if (!canMoveUp[i]) continue;
    const [ax, ay] = xy(i);
    leapAnimPieces.push({
      toIdx: idx(ax, ay - 1),
      fromCX: MARGIN + ax * TILE, fromCY: BOARD_Y + MARGIN + ay * TILE,
      toCX: MARGIN + ax * TILE, toCY: BOARD_Y + MARGIN + (ay - 1) * TILE,
      piece: board[i], side: sides[i], hlth: health[i], atk: attacks[i], spd: speeds[i]
    });
  }

  // Track enemy captures from team advance
  for (let i = 0; i < 64; i++) {
    if (!canMoveUp[i]) continue;
    const [ax2, ay2] = xy(i);
    const ni2 = idx(ax2, ay2 - 1);
    if (sides[ni2] === B && board[ni2] !== NONE) {
      const capPiece = board[ni2];
      startCaptureAnim(capPiece, B, MARGIN + ax2 * TILE + TILE / 2, BOARD_Y + MARGIN + (ay2 - 1) * TILE + TILE / 2);
    }
  }

  const nsq = _blankSquares();

  // Enemies stay
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) _copySquareTo(nsq, i, i);
  }

  // Move white pieces that can, leave the rest in place
  let _leapVoidDeath = null; // {cx, cy, piece, side} if a piece falls into void
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    if (canMoveUp[i]) {
      const [x, y] = xy(i);
      const ni = idx(x, y - 1);
      if (isVoidSpace(ni)) {
        // piece falls into void — don't place it
        if (board[i] === KING || board[i] === CHECKERS_KING) _triggerGameOver(`Game Over! Score: ${score}`);
        _leapVoidDeath = { cx: MARGIN + x * TILE + TILE / 2, cy: BOARD_Y + MARGIN + (y - 1) * TILE + TILE / 2, piece: board[i], side: W };
      } else {
        if (chestSpaces.has(ni)) { chestSpaces.delete(ni); playSfx('chest'); playSfx('pickup'); _pendingCaptureAnims.push({ type: 'item', item: _randomItem(), sx: MARGIN + x * TILE + TILE / 2, sy: BOARD_Y + MARGIN + (y - 1) * TILE + TILE / 2 }); }
        _copySquareTo(nsq, i, ni);
      }
    } else {
      _copySquareTo(nsq, i, i);
    }
  }

  _commitSquares(nsq);

  // Advancing onto live opposing fire ignites — fire persists across turns now, so a Team Advance
  // step is a landing like any other (land-only: each piece entered exactly one new square).
  for (let i = 0; i < 64; i++) {
    if (!canMoveUp[i]) continue;
    const [ax3, ay3] = xy(i);
    _igniteOnLand(idx(ax3, ay3 - 1));
  }

  epTarget = -1;
  selected = -1;
  validMoves = [];
  wkMoved = true; wraMoved = true; wrhMoved = true;
  firstMoveMade = true;
  recordPosition();
  startAnim(leapAnimPieces, 0, () => {
    _drainCaptureAnims();
    if (_leapVoidDeath) {
      startVoidDeath(_leapVoidDeath.cx, _leapVoidDeath.cy, _leapVoidDeath.piece, _leapVoidDeath.side, applySpacesAfterAdvance);
    } else {
      applySpacesAfterAdvance();
    }
  });
}

function canPitchShift() {
  if (gameOver || turn !== W || aiThinking) return false;
  return true;
}

// Field Advance is always available on White's turn — even when a White piece sits on the bottom
// row and will be crushed by the advancing field (that's the player's call to make). If the crushed
// piece is the White King, fieldAdvance's completion triggers Game Over. (The AI eval that also
// calls this reads the loss correctly: simulateLeap destroys row-7 White pieces in its lookahead.)
function canManualPitchShift() {
  return canPitchShift();
}

function _placeChestBonus(col) {
  const ci = idx(col, 0);
  if (sides[ci] === W) {
    // White piece already here — award item immediately instead of placing chest
    const _ci = _randomItem();
    const [_cx, _cy] = xy(ci);
    startItemFlyAnim(_ci, MARGIN + _cx * TILE + TILE / 2, BOARD_Y + MARGIN + _cy * TILE + TILE / 2, findInventorySlot());
  } else if (sides[ci] === B || sides[ci] === N) {
    // Enemy/Grey already here (a remapped wave piece slipped in) — never bury a chest under it.
  } else {
    chestSpaces.add(ci);
  }
}

function fieldAdvance(playerTriggered = false) {
  if (!canPitchShift() || anim || waveAnim) return;
  if (playerTriggered) _logInput({ t: 'fa' });
  // Flawless-survival streak: count consecutive advances during which no Black King
  // was taken and no White Warrior was lost (the interval since the previous advance).
  if (score === _lastAdvanceScore && !_whiteLostSinceAdvance) _flawlessAdvances++;
  else _flawlessAdvances = 0;
  _lastAdvanceScore = score; _whiteLostSinceAdvance = false;
  _kingLastMovedType = NONE; // an Advance moved no single piece — the King's line falls back to random
  _kingQueueFirst('firstFieldAdvance'); // the run's first advance — before the count/flush below
  _turnBoundaryUpdate(); // Field Advance ends the White turn — update streaks, clear per-turn counters
  _kingCountTurn(); // Field Advance is its own turn end (doesn't route through endWhiteTurn)
  _resetTurnState(); // Field Advance ends the turn — forfeit any pending Speed/Bloodthirsty extra move
  stopWindLoop();     // a new wave is incoming — fade the calm wind back out
  playSfx('whoosh');  // Field Advance

  // Capture the bottom row before it's destroyed so animation can slide it out.
  const exitRow = [];
  for (let x = 0; x < 8; x++) {
    const i = idx(x, 7);
    exitRow.push({ x, piece: board[i], side: sides[i], hlth: health[i], atk: attacks[i], spd: speeds[i] });
  }
  // If merchant is on row 7 he slides off with the exit row
  const merchantAtRow7 = merchantIdx >= 0 && xy(merchantIdx)[1] === 7;
  if (merchantAtRow7) exitRow[xy(merchantIdx)[0]].merchant = true;

  // If merchant was queued in the fog preview, he enters the board this advance
  const merchantEntersThisWave = merchantQueued;
  const merchantEnterCol = merchantQueuedCol;
  if (merchantQueued) { merchantQueued = false; merchantQueuedCol = -1; }

  // Everything shifts down one row; row 7 is destroyed (including white pieces).
  const nsq = _blankSquares();

  let _fieldTook = false;
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) { // destroyed
      if (!_fieldTook) { playSfx('crunch'); _fieldTook = true; } // Field Advance takes units
      if (playerTriggered && sides[i] === B && (board[i] === KING || board[i] === CHECKERS_KING)) score++;
      startCaptureAnim(board[i], sides[i], MARGIN + x * TILE + TILE / 2, BOARD_Y + MARGIN + y * TILE + TILE / 2);
      continue;
    }
    _copySquareTo(nsq, i, idx(x, y + 1));
  }

  _commitSquares(nsq);

  // Scroll special spaces down
  const newSpecialSpaces = new Array(64).fill(null);
  for (let i = 0; i < 64; i++) {
    if (!specialSpaces[i]) continue;
    const [x, y] = xy(i);
    if (y === 7) continue;
    newSpecialSpaces[idx(x, y + 1)] = specialSpaces[i];
  }
  for (const b of nextBonuses) {
    if (b.type === 'void') newSpecialSpaces[idx(b.col, 0)] = { type: 'void' };
    if (b.type === 'block') newSpecialSpaces[idx(b.col, 0)] = { type: 'block' };
    if (b.type === 'river') newSpecialSpaces[idx(b.col, 0)] = { type: 'river', dx: b.dx };
  }
  specialSpaces.splice(0, 64, ...newSpecialSpaces);

  // Non-row-7 merchant: shift down with everything else
  if (!merchantAtRow7 && merchantIdx >= 0) {
    const [mmx, mmy] = xy(merchantIdx);
    merchantIdx = idx(mmx, mmy + 1);
    if (isVoidSpace(merchantIdx)) respawnMerchant();
  }

  // Scroll item spaces down
  const newItemSpaces = new Array(64).fill(ITEM_NONE);
  for (let i = 0; i < 64; i++) {
    if (itemSpaces[i] === ITEM_NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) continue;
    newItemSpaces[idx(x, y + 1)] = itemSpaces[i];
  }
  for (const b of nextBonuses) {
    if (b.type === 'item') newItemSpaces[idx(b.col, 0)] = b.item;
  }
  itemSpaces.splice(0, 64, ...newItemSpaces);

  // Shift shadow spaces and in-flight sky drops down one row
  const newShadowSpaces = new Map();
  for (const [i, item] of _shadowSpaces) {
    const [x, y] = xy(i);
    if (y < 7) newShadowSpaces.set(idx(x, y + 1), item);
  }
  _shadowSpaces = newShadowSpaces;
  for (const f of _skyDropAnims) {
    const [x, y] = xy(f.i);
    if (y < 7) f.i = idx(x, y + 1);
  }

  // Shift fire squares down one row; drop any that fall off row 7 or land on a river (rivers can't burn)
  const newFireSquares = new Map();
  for (const [fi, fs] of fireSquares) {
    const [fx, fy] = xy(fi);
    if (fy >= 7) continue;
    const di = idx(fx, fy + 1);
    if (!isRiverSpace(di)) newFireSquares.set(di, fs);
  }
  fireSquares = newFireSquares;

  // Shift water-trail currents down one row; drop any off row 7 or onto a wall/hole/spawn-river
  const newWaterTrails = new Map();
  for (const [wi, w] of waterTrails) {
    const [wx, wy] = xy(wi);
    if (wy >= 7) continue;
    const di = idx(wx, wy + 1);
    if (!isBlockSpace(di) && !isVoidSpace(di) && !isRiverSpace(di)) newWaterTrails.set(di, w);
  }
  waterTrails = newWaterTrails;

  // Shift chest spaces down one row, drop any that fall off row 7
  const newChestSpaces = new Set();
  for (const ci of chestSpaces) {
    const [cx2, cy2] = xy(ci);
    if (cy2 < 7) newChestSpaces.add(idx(cx2, cy2 + 1));
  }
  chestSpaces = newChestSpaces;

  spawnCount++;
  leapCount++;

  // Queue merchant to enter with the 3rd wave (after 2nd advance)
  if (spawnCount === 3 && merchantIdx < 0 && !merchantQueued && !merchantAtRow7) {
    merchantQueued = true;
    merchantQueuedCol = randInt(8);
  }

  if (merchantAtRow7) {
    // Merchant slides off bottom; queue him in the fog preview row for the NEXT advance
    merchantIdx = -1;
    merchantQueued = true;
    merchantQueuedCol = randInt(8);
    // Normal wave placement this advance
    for (const w of nextWave) {
      if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue;
      if (chestSpaces.has(idx(w.x, 0))) continue;
      set(w.x, 0, w.piece, B); _applyEffectSet(idx(w.x, 0), w.eff);
    }
    for (const b of nextBonuses) {
      if (b.type === 'chest') _placeChestBonus(b.col);
      if (b.type === 'grey') { set(b.col, 0, b.piece, N); _applyEffectSet(idx(b.col, 0), b.eff); }
    }
  } else if (merchantEntersThisWave) {
    // Merchant slides in from fog preview: place pieces at their previewed positions
    merchantIdx = idx(merchantEnterCol, 0);
    merchantOffers = [_randomShopItem(), _randomShopItem(), _randomShopItem()];
    merchantSold = [false, false, false];
    merchantRerollCountdown = MERCHANT_REROLL_CYCLE;
    for (const w of nextWave) {
      if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue;
      if (chestSpaces.has(idx(w.x, 0))) continue;
      set(w.x, 0, w.piece, B); _applyEffectSet(idx(w.x, 0), w.eff);
    }
    for (const b of nextBonuses) {
      if (b.col === merchantEnterCol) continue;
      if (b.type === 'chest') _placeChestBonus(b.col);
      if (b.type === 'grey') { set(b.col, 0, b.piece, N); _applyEffectSet(idx(b.col, 0), b.eff); }
    }
  } else {
    // Normal advance: wave works around merchant's current position
    for (const w of nextWave) {
      if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue;
      if (idx(w.x, 0) === merchantIdx) continue;
      if (chestSpaces.has(idx(w.x, 0))) continue;
      set(w.x, 0, w.piece, B); _applyEffectSet(idx(w.x, 0), w.eff);
    }
    for (const b of nextBonuses) {
      if (idx(b.col, 0) === merchantIdx) continue;
      if (b.type === 'chest') _placeChestBonus(b.col);
      if (b.type === 'grey') { set(b.col, 0, b.piece, N); _applyEffectSet(idx(b.col, 0), b.eff); }
    }
  }

  epTarget = -1;
  selected = -1;
  validMoves = [];
  firstMoveMade = true;
  shiftCountdown = 10;
  recordPosition();

  // Defer nextWave/nextBonuses update until after animation so the fog keeps showing
  // the incoming row during the slide, rather than instantly flipping to the next preview.
  nextWave = generateWave(spawnCount + 1);
  nextBonuses = generateRowBonuses(nextWave);
  // If merchant was void-killed mid-play, queue him now so he appears in the next preview
  if (merchantPendingRespawn && merchantIdx < 0 && !merchantQueued) {
    merchantPendingRespawn = false;
    merchantQueued = true;
    merchantQueuedCol = randInt(8);
  }
  // If merchant is queued, pre-remap any wave piece that conflicts with his column
  // so the preview already shows final spawn positions. The new column must avoid BONUS
  // columns too — remapping onto one buried a chest under the relocated pawn (chest bonuses
  // only special-case White occupants), and could likewise overwrite the piece with a Grey
  // or drop it onto a fresh void. Falls back to the bonus-blind pick only if every clean
  // column is taken (then the bonus at the collision column is dropped instead).
  if (merchantQueued && merchantQueuedCol >= 0) {
    const usedCols = new Set(nextWave.map(w => w.x).filter(x => x !== merchantQueuedCol));
    const bonusCols = new Set(nextBonuses.map(b => b.col));
    for (const w of nextWave) {
      if (w.x === merchantQueuedCol) {
        const ok = (x, blind) => x !== merchantQueuedCol && !usedCols.has(x) && (blind || !bonusCols.has(x)) && specialSpaces[idx(x, 0)]?.type !== 'block';
        let picked = -1;
        for (let x = 0; x < 8 && picked < 0; x++) if (ok(x, false)) picked = x;
        for (let x = 0; x < 8 && picked < 0; x++) if (ok(x, true)) picked = x;
        if (picked >= 0) {
          usedCols.add(picked); w.x = picked;
          if (bonusCols.has(picked)) nextBonuses = nextBonuses.filter(b => b.col !== picked); // blind fallback: the piece wins, the bonus is dropped
        }
      }
    }
    nextBonuses = nextBonuses.filter(b => b.col !== merchantQueuedCol);
  }
  // Merchant wares hold unchanged for MERCHANT_REROLL_CYCLE field advances (sold items stay sold),
  // then all three reroll at once and sold state resets.
  if (merchantIdx >= 0 && merchantOffers.length) {
    merchantRerollCountdown--;
    if (merchantRerollCountdown <= 0) {
      merchantOffers = [_randomShopItem(), _randomShopItem(), _randomShopItem()];
      merchantSold = [false, false, false];
      merchantRerollCountdown = MERCHANT_REROLL_CYCLE;
    }
  }
  startAnim([], -TILE, () => {
    // The advancing field may have crushed the White King on the bottom row — end the run now
    // (or offer the Rewinder) instead of continuing with no King. Mirrors the Team Advance path.
    checkWhiteKingAlive();
    if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
    if (!playerTriggered) {
      // Auto-advance: White just spent their move triggering the countdown, so Black goes next.
      turn = B;
      draw();
      if (!gameOver) aiPlay();
    } else {
      // Manual advance: hand off to Black if White acted last, otherwise stay on White.
      if (lastActingSide === W) {
        turn = B;
        draw();
        if (!gameOver) aiPlay();
      } else {
        draw();
      }
    }
  }, exitRow);
}

// --- AI ---

// Per-square flat arrays — add new ones here and save/restore picks them up automatically.
const _squareArrays = () => [board, sides, health, elements, statuses, attacks, speeds, burning];

function saveState() {
  return {
    squares: _squareArrays().map(a => [...a]),
    effectOrders: effectOrders.map(a => [...a]),
    epTarget, wkMoved, wraMoved, wrhMoved, score, gold,
    inventory: [...inventory],
    spawnCount, nextBonuses: nextBonuses.map(b => ({...b})), nextWave: nextWave.map(w => ({...w})),
    histLen: positionHistory.length, shiftCountdown,
    chestSpaces: new Set(chestSpaces),
    itemSpaces: [...itemSpaces],
    specialSpaces: specialSpaces.map(s => s ? {...s} : null), // Earth destroys blocks in sim — must roll back
    merchantIdx, merchantQueued, merchantQueuedCol,
    rngState: _rngState, rngEpoch: _rngEpoch, // minimax lookahead must NOT perturb the real RNG stream/epoch
  };
}

function restoreState(st) {
  _squareArrays().forEach((a, idx) => a.splice(0, 64, ...st.squares[idx]));
  for (let i = 0; i < 64; i++) effectOrders[i] = st.effectOrders ? [...st.effectOrders[i]] : [];
  epTarget = st.epTarget;
  wkMoved = st.wkMoved; wraMoved = st.wraMoved; wrhMoved = st.wrhMoved;
  score = st.score; gold = st.gold; inventory.splice(0, inventory.length, ...st.inventory);
  spawnCount = st.spawnCount; nextBonuses = st.nextBonuses.map(b => ({...b}));
  nextWave = st.nextWave;
  positionHistory.length = st.histLen;
  shiftCountdown = st.shiftCountdown;
  if (st.chestSpaces) chestSpaces = new Set(st.chestSpaces);
  if (st.itemSpaces) itemSpaces.splice(0, 64, ...st.itemSpaces);
  if (st.specialSpaces) specialSpaces.splice(0, 64, ...st.specialSpaces.map(s => s ? {...s} : null));
  if (st.merchantIdx !== undefined) merchantIdx = st.merchantIdx;
  if (st.merchantQueued !== undefined) { merchantQueued = st.merchantQueued; merchantQueuedCol = st.merchantQueuedCol; }
  if (st.rngState !== undefined) _rngState = st.rngState; // roll back RNG consumed during lookahead
  if (st.rngEpoch !== undefined) _rngEpoch = st.rngEpoch;
}

function withState(fn) { const st = saveState(); try { return fn(); } finally { restoreState(st); } }

// Simulate a Team Advance (White pieces each move up 1 row) for AI evaluation.
// Mirrors teamAdvance: enemies/merchant/blocks block, voids kill the mover.
function simulateTeamAdvance() {
  const nsq = _blankSquares(false);
  // Enemies stay in place
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) _copySquareTo(nsq, i, i);
  }
  // White pieces try to move up (y-1); blocked by occupied squares, merchant, or row 0
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const [x, y] = xy(i);
    const ni = idx(x, y - 1);
    if (y === 0 || isBlockSpace(ni) || ni === merchantIdx || nsq.board[ni] !== NONE) {
      _copySquareTo(nsq, i, i);
    } else if (isVoidSpace(ni)) {
      // piece falls into the void and dies — don't place it (a dead King is
      // caught by minimax's findKing check, so the search avoids this)
    } else {
      _copySquareTo(nsq, i, ni);
    }
  }
  _commitSquares(nsq);
}

function simulateLeap(scoring = true) {
  // Simulates fieldAdvance for AI lookahead: everything shifts down, row 7 destroyed.
  // scoring=true models a player-triggered advance (scores Black Kings pushed off
  // row 7); scoring=false models the countdown-forced auto-advance (no scoring).
  const nsq = _blankSquares(false);
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) {
      if (scoring && sides[i] === B && (board[i] === KING || board[i] === CHECKERS_KING)) score++;
      continue;
    }
    _copySquareTo(nsq, i, idx(x, y + 1));
  }
  _commitSquares(nsq);
  spawnCount++;
  for (const w of nextWave) { if (!chestSpaces.has(idx(w.x, 0))) set(w.x, 0, w.piece, B); _applyEffectSet(idx(w.x, 0), w.eff); }
  for (const b of nextBonuses) {
    if (b.type === 'chest') chestSpaces.add(idx(b.col, 0));
    if (b.type === 'grey') { set(b.col, 0, b.piece, N); _applyEffectSet(idx(b.col, 0), b.eff); }
  }
  nextWave = generateWave(spawnCount + 1);
  nextBonuses = generateRowBonuses(nextWave);
  epTarget = -1;
}

function allLegalMovesForSide(s) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== s) continue;
    const [x, y] = xy(i);
    for (const to of legalMoves(x, y)) {
      if (s === B && to === merchantIdx) continue; // enemies cannot target the merchant
      moves.push([i, to]);
    }
  }
  return moves;
}

const PIECE_SURVIVAL_BONUS = 15; // flat bonus per white piece alive — prioritizes attrition over trades

function evaluate() {
  let val = 0;
  let whiteKing = false;
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const v = PIECE_VALUE[board[i]];
    const shields = health[i] - 1;
    const effectiveV = shields > 0 ? v * (1 + 0.5 * shields) : v;
    if (sides[i] === W) {
      val += effectiveV + PIECE_SURVIVAL_BONUS;
      // Mild advance shaping: reward forward progress so quiet positions still
      // drift toward the enemy instead of shuffling (small vs. piece values).
      if (board[i] !== KING && board[i] !== CHECKERS_KING) val += (7 - Math.floor(i / 8)) * 2;
      if (board[i] === KING || board[i] === CHECKERS_KING) whiteKing = true; // a Checkers King counts — without this eval collapses to -99999 and Black moves randomly
    } else {
      val -= effectiveV;
    }
    if (burning[i] > 0) { // on fire → likely to burn up; discount its value toward 0 as the timer runs down
      const lost = effectiveV * (4 - burning[i]) / 3; // rounds 3→2→1 : lose 1/3, 2/3, all of it
      val += (sides[i] === W) ? -lost : lost;
    }
  }
  if (!whiteKing) return -99999;
  // Taken Kings is the win condition — value it directly, not just as the
  // material of the removed King. Lets the search see that scoring (incl. field
  // advancing enemy Kings off row 7) is progress toward winning, not just a trade.
  val += score * 4000;
  // Items are worth having: makes the search value chest pickups and shop buys.
  for (let k = 0; k < inventory.length; k++) if (inventory[k] !== ITEM_NONE) val += 60;
  // Penalize white pieces on y=7 when field auto-advance is imminent (they'll be destroyed)
  if (shiftCountdown <= 3) {
    for (let x = 0; x < 8; x++) {
      const i = idx(x, 7);
      if (sides[i] === W) val -= PIECE_VALUE[board[i]] * (4 - shiftCountdown) * 0.8;
    }
  }
  // Penalize repeated positions — both sides should avoid loops
  const reps = countPosition(boardHash());
  if (reps >= 2) val -= 5000;
  else if (reps >= 1) val -= 1000;
  return val;
}

// Extra follow-up moves the piece now at `toI` earns this turn: Speed (speeds-1) plus a
// Bloodthirsty bonus move if the move that landed there was a capture.
function _extraMoveBudget(toI, wasCapture) {
  const spd = speeds[toI] > 1 ? speeds[toI] - 1 : 0;
  const bt = (wasCapture && (statuses[toI] & STATUS_BLOODTHIRSTY)) ? 1 : 0;
  return spd + bt;
}

// After the moving side's piece reaches `pieceI` with `extra` follow-up moves available, let that
// side optionally chain more moves with the same piece before the turn passes to the opponent.
// This models multi-move turns (Speed / Bloodthirsty) inside the search — for both sides.
function _turnContinuation(pieceI, extra, depth, alpha, beta, moverIsMax) {
  let best = minimax(depth - 1, alpha, beta, !moverIsMax); // option: end the turn now
  const s = moverIsMax ? W : B;
  if (extra <= 0 || board[pieceI] === NONE || sides[pieceI] !== s) return best;
  if (moverIsMax) { if (best >= beta) return best; alpha = Math.max(alpha, best); }
  else           { if (best <= alpha) return best; beta = Math.min(beta, best); }
  const [px, py] = xy(pieceI);
  for (const to of legalMoves(px, py)) {
    if (s === B && to === merchantIdx) continue;
    const val = withState(() => {
      makeMove(pieceI, to); recordPosition();
      return _turnContinuation(to, extra - 1, depth, alpha, beta, moverIsMax);
    });
    if (_aiAborted) break; // over budget — stop chaining extra moves
    if (moverIsMax) { best = Math.max(best, val); if (best >= beta) break; alpha = Math.max(alpha, best); }
    else           { best = Math.min(best, val); if (best <= alpha) break; beta = Math.min(beta, best); }
  }
  return best;
}

function minimax(depth, alpha, beta, maximizing) {
  // Hard node cap (see AI_NODE_BUDGET): each minimax call is one examined position. When the budget
  // runs out, bail cheaply (return a static eval) and flag the abort so the root discards this depth.
  if (_aiAborted) return evaluate();
  if (_aiNodesLeft-- <= 0) { _aiAborted = true; return evaluate(); }
  // Dead White king ends the search immediately, scored more negative the
  // sooner it happens (higher remaining depth) — so Black prefers the fastest
  // kill instead of treating "win now" and "win eventually" as equal ties.
  if (findKing(W)[0] < 0) return -(99999 + depth);
  if (depth === 0) return evaluate();

  const s = maximizing ? W : B;
  const moves = allLegalMovesForSide(s);

  if (moves.length === 0) {
    if (s === W) {
      if (isCheckmated(W)) return -99999;
      return 0;
    }
    return evaluate();
  }

  if (maximizing) {
    let best = -Infinity;
    for (const [from, to] of moves) {
      const val = withState(() => {
        const wasCap = sides[to] === B;
        makeMove(from, to); recordPosition();
        return _turnContinuation(to, _extraMoveBudget(to, wasCap), depth, alpha, beta, true);
      });
      if (_aiAborted) break; // over budget — stop iterating (this subtree's result is discarded upstream)
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    // Field advance is always a White option in the search
    if (!_aiAborted) {
      const val = withState(() => { simulateLeap(); recordPosition(); return minimax(depth - 1, alpha, beta, false); });
      best = Math.max(best, val);
    }
    return best;
  } else {
    let best = Infinity;
    for (const [from, to] of moves) {
      const val = withState(() => {
        const wasCap = sides[to] === W;
        makeMove(from, to); recordPosition();
        return _turnContinuation(to, _extraMoveBudget(to, wasCap), depth, alpha, beta, false);
      });
      if (_aiAborted) break; // over budget — stop iterating
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function allPseudoMovesForSide(s) {
  const moves = [];
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== s) continue;
    const [x, y] = xy(i);
    for (const to of pseudoMoves(x, y)) {
      if (s === B && to === merchantIdx) continue;
      moves.push([i, to]);
    }
  }
  return moves;
}

// Iterative-deepening root search as a generator: it `yield`s at frame boundaries (every
// AI_SLICE_NODES nodes) so the caller can pump it across animation frames without freezing the UI.
// Searches depth 1, then 2, … up to AI_DEPTH sharing one node budget; the generator's return value
// is Black's chosen move (deepest depth that finished within budget). Pure/deterministic — the same
// nodes are examined whether pumped in one synchronous loop (re-sim) or across frames (live play).
function* _blackSearchGen(moves) {
  _aiNodesLeft = AI_NODE_BUDGET;
  _aiAborted = false;
  let chosen = moves[_detPick(moves.length)]; // safety fallback if even depth 1 can't finish
  for (let depth = 1; depth <= AI_DEPTH; depth++) {
    let bestScore = Infinity;
    let bestMoves = [];
    let aborted = false;
    let sliceStart = _aiNodesLeft;
    for (const [from, to] of moves) {
      const val = withState(() => {
        const wasCap = sides[to] === W;
        makeMove(from, to); recordPosition();
        return _turnContinuation(to, _extraMoveBudget(to, wasCap), depth, -Infinity, Infinity, false);
      });
      if (_aiAborted) { aborted = true; break; } // total budget ran out mid-depth — discard this depth
      if (val < bestScore) { bestScore = val; bestMoves = [[from, to]]; }
      else if (val === bestScore) bestMoves.push([from, to]);
      if (sliceStart - _aiNodesLeft >= AI_SLICE_NODES) { yield; sliceStart = _aiNodesLeft; } // frame boundary (board is at root here)
    }
    if (aborted) break;                          // keep the previous (deepest complete) depth's choice
    chosen = bestMoves[_detPick(bestMoves.length)];
    if (_aiNodesLeft <= 0) break;                // budget exactly spent at a clean depth boundary
  }
  return chosen;
}

// Best Black move. If `onDone` is given AND we're in live play, the search runs frame-sliced (pumped
// by requestAnimationFrame) and calls onDone(move) when finished — the game stays responsive while the
// enemy thinks. Otherwise (no callback, or headless re-sim) it runs synchronously and returns the move.
// it must be in check AND no Black move leaves it safe.
function aiBestMove(onDone) {
  // Lift the cap AND clear the abort flag for later searches that share minimax (hint/auto-play's
  // playerBestMove) — a lingering _aiAborted=true would make them return static evals instantly.
  const done = (mv) => { _aiNodesLeft = Infinity; _aiAborted = false; if (onDone) onDone(mv); return mv; };
  // If checkmated (no legal moves), fall back to pseudo-legal so the enemy is never paralyzed
  let moves = allLegalMovesForSide(B);
  if (moves.length === 0) {
    // No legal move: Kings FREEZE. Only non-King pieces may take a forced pseudo-legal move — a King
    // may no longer move here (previously it could, even capturing a White piece while staying in
    // danger). If nothing else can move either, Black passes (moves stays empty -> return null below).
    moves = allPseudoMovesForSide(B).filter(([from]) => board[from] !== KING && board[from] !== CHECKERS_KING);
    // Desperate: if any of these forced moves lands on a White piece, restrict to those so Black at
    // least takes a White piece down with it.
    const captures = moves.filter(([, to]) => sides[to] === W);
    if (captures.length > 0) moves = captures;
  }
  if (moves.length === 0) return done(null);
  // Compelled: any move that directly attacks a white King (kill or damage) must be taken
  const kingAttacks = moves.filter(([, to]) => (board[to] === KING || board[to] === CHECKERS_KING) && sides[to] === W);
  if (kingAttacks.length > 0) return done(kingAttacks[_detPick(kingAttacks.length)]);
  // Also compelled: Checkers jumps whose chain will reach a White King
  const chainKingAttacks = moves.filter(([from, to]) => {
    if ((board[from] !== CHECKERS && board[from] !== CHECKERS_KING) || Math.abs(xy(to)[0] - xy(from)[0]) !== 2) return false;
    return withState(() => { makeMove(from, to); return _checkersChainCanKillKing(to); });
  });
  if (chainKingAttacks.length > 0) return done(chainKingAttacks[_detPick(chainKingAttacks.length)]);
  const gen = _blackSearchGen(moves);
  if (!onDone || _instant) { let r; do { r = gen.next(); } while (!r.done); return done(r.value); } // synchronous
  // Live: run slices until this frame's time budget is used, then paint and continue next frame.
  const _gen0 = _runGen; // if a new run starts mid-think (Start Over), kill the stale pump — its moves
                         // belong to the old board, and letting it run would corrupt the budget globals
                         // for (and interleave garbage searches with) the new run's own Black search.
  const pump = () => {
    if (_runGen !== _gen0) { _aiNodesLeft = Infinity; _aiAborted = false; return; } // stale — stop silently
    const t0 = performance.now();
    let r;
    do { r = gen.next(); } while (!r.done && performance.now() - t0 < AI_FRAME_MS);
    if (r.done) done(r.value); else requestAnimationFrame(pump);
  };
  pump();
}

let hintMove = null; // {from, to} or "leap"

// Best White piece-move by minimax. Returns { move: [from,to]|null, score }.
// forcedAdvance=true folds a non-scoring auto-advance in after the move (used by
// auto-play when the countdown will force the field to advance this turn), so the
// move value reflects the incoming preview wave the player can't avoid.
function playerBestMove(depth = HINT_DEPTH, forcedAdvance = false) {
  const moves = allLegalMovesForSide(W);
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const [from, to] of moves) {
    const captureBonus = (board[to] !== NONE && sides[to] !== W) ? PIECE_VALUE[board[to]] : 0;
    const val = withState(() => {
      const wasCap = sides[to] === B;
      makeMove(from, to);      if (forcedAdvance) { simulateLeap(false); recordPosition(); return minimax(depth - 1, -Infinity, Infinity, false); }
      recordPosition();
      return _turnContinuation(to, _extraMoveBudget(to, wasCap), depth, -Infinity, Infinity, true);
    }) + captureBonus;
    if (val > bestScore) {
      bestScore = val;
      bestMoves = [[from, to]];
    } else if (val === bestScore) {
      bestMoves.push([from, to]);
    }
  }
  return { move: bestMoves.length > 0 ? bestMoves[_detPick(bestMoves.length)] : null, score: bestScore };
}

function showHint() {
  if (gameOver || turn !== W || aiThinking) return;
  _autoPlayUsedThisRun = true; // hint consumes RNG the input log can't reproduce -> run not leaderboard-eligible
  aiThinking = true;
  draw();
  const _gen = _runGen;
  setTimeout(() => {
    if (_gen !== _runGen) return;
    hintMove = playerBestMove().move;
    aiThinking = false;
    if (hintMove === "leap") {
      // Flash the leap button
      selected = -1;
      validMoves = [];
    } else if (hintMove) {
      selected = hintMove[0];
      validMoves = [hintMove[1]];
    }
    draw();
  }, 50);
}

function isCheckmated(s) {
  if (s === W) {
    if (countKings(W) !== 1) return false;
    const [kx, ky] = findKing(W);
    if (kx < 0) return false;
    // Only instant game over when last king is health 1 and can't escape check
    if (health[idx(kx, ky)] > 1) return false;
    if (!isAttacked(kx, ky, W)) return false;
    return allLegalMovesForSide(W).length === 0;
  }
  const [kx, ky] = findKing(s);
  if (kx < 0) return true;
  if (!isAttacked(kx, ky, s)) return false;
  return allLegalMovesForSide(s).length === 0;
}

const AI_MOVE_DELAY_MS = 250; // enemy "thinking" pause before Black moves (live only; _instant re-sim runs it inline)
function aiPlay() {
  if (gameOver || turn !== B) return;
  aiThinking = true;
  draw();
  const _gen = _runGen; // abort if a new run starts while "thinking"
  setTimeout(() => {
    if (_gen !== _runGen) return;                              // stale — a new run owns the board now
    if (gameOver || turn !== B) { aiThinking = false; draw(); return; }
    _ageTrails(B); // Black's own trails (blocks/fire) age as its next turn begins
    _blackMainMove((move) => {
    if (_gen !== _runGen) return; // a new run began while the enemy was thinking (async) — abandon
    if (move) {
      lastActingSide = B;
      const [mfx, mfy] = xy(move[0]), [mtx, mty] = xy(move[1]);
      const mFromCX = MARGIN + mfx * TILE, mFromCY = BOARD_Y + MARGIN + mfy * TILE;
      const mToCX = MARGIN + mtx * TILE, mToCY = BOARD_Y + MARGIN + mty * TILE;
      const _aiFinish = () => {
        if (countKings(W) === 0) _triggerGameOver(`Game Over! Score: ${score}`);
        else if (isCheckmated(W)) _triggerGameOver(`Checkmate! Score: ${score}`);
        if (gameOver || _rewinderSaveOffer) { aiThinking = false; takeReplaySnapshot(); draw(); return; }
        greyPlay(() => {
          merchantPlay(() => {
            applyRiverFlow(() => {
              _doSkyDropPhase(() => {
                turn = W;
                aiThinking = false;
                _ageTrails(W);  // White's trails (blocks/fire) age as its next turn begins
                _burnTick();    // a full round elapsed — burning pieces tick down (and may burn up)
                if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
                _kingOnPlayerTurn(); // the King reacts to the enemy phase (sightings, shadows, danger)
                takeReplaySnapshot();
                _turnStartSnapIndices.push(replaySnapshots.length - 1);
                draw();
                startWhiteTurnTimer();
              });
            });
          });
        });
      };

      // Shield bounce: attacker slides in, then bounces back
      if (sides[move[0]] === B && sides[move[1]] === W && health[move[1]] > attacks[move[0]]) {
        playSfx('shield'); // shield block sound at attack start (pop stays on impact)
        const attackPiece = board[move[0]], attackHlth = health[move[0]];
        const wasLastShield = health[move[1]] === 2;
        const hitCX = mToCX + TILE / 2, hitCY = mToCY + TILE / 2;
        // Phase 1: slide attacker toward defender's square
        startAnim([{ toIdx: move[0], fromCX: mFromCX, fromCY: mFromCY, toCX: mToCX, toCY: mToCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
          const result = applyShieldBounceState(move[0], move[1], attackPiece);
          if (move[1] === merchantIdx) respawnMerchant();
          recordPosition();
          if (wasLastShield) startShieldPop(hitCX, hitCY); // shield blocks on impact (sound + pop)
          {
            // Animate attacker sliding back
            const [bx, by] = xy(result.bounceI);
            const bounceCX = MARGIN + bx * TILE, bounceCY = BOARD_Y + MARGIN + by * TILE;
            startAnim([{ toIdx: result.bounceI, fromCX: mToCX, fromCY: mToCY, toCX: bounceCX, toCY: bounceCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
              if (result.voidDeath) { // bounced into a Void — it fell in and perished
                enemyDead[result.deadPiece] = (enemyDead[result.deadPiece] || 0) + 1;
                startVoidDeath(bounceCX + TILE / 2, bounceCY + TILE / 2, attackPiece, B, _aiFinish);
              } else {
                _aiSpeedContinue(result.bounceI, 0, _aiFinish); // attacker bounced back — may still have Speed moves
              }
            });
          }
        });
      } else {
        const _aiFromElems = elements[move[0]], _aiFromPiece0 = board[move[0]], _aiFromSide0 = sides[move[0]];
        // Capture detection (before the move): a White target, or a checkers jump over a piece.
        const _aiWasCapture = sides[move[1]] === W
          || ((_aiFromPiece0 === CHECKERS || _aiFromPiece0 === CHECKERS_KING) && Math.abs(mtx - mfx) === 2);
        const _aiLegs = null; // Air moves are single-hop now (phasing sliders slide straight; no extended range)
        makeMove(move[0], move[1], true);
        if (_aiFromElems & ELEM_FIRE) applyFireTrail(move[0], move[1], _aiFromPiece0, _aiFromSide0);
        if (_aiFromElems & ELEM_WATER) applyWaterTrail(move[0], move[1], _aiFromPiece0, _aiFromSide0);
        if (move[1] === merchantIdx) respawnMerchant();
        const _aiPiece0 = board[move[1]], _aiSide0 = sides[move[1]], _aiHlth0 = health[move[1]];
        const _aiIsCheckersJump = (_aiPiece0 === CHECKERS || _aiPiece0 === CHECKERS_KING) && Math.abs(mtx - mfx) === 2;
        const _aiAnimPieces = [{
          toIdx: move[1],
          fromCX: mFromCX, fromCY: mFromCY, toCX: mToCX, toCY: mToCY,
          piece: _aiPiece0, side: _aiSide0, hlth: _aiHlth0, atk: attacks[move[1]], spd: speeds[move[1]],
          arc: _aiIsCheckersJump ? TILE * 1.5 : 0
        }];
        _appendCaptureGhosts(_aiAnimPieces);
        playMoveSfx(_aiPiece0, move[1]);
        _startMoveAnim(_aiAnimPieces, _aiLegs, () => {
          _drainCaptureAnims();
          if (board[move[1]] !== NONE && itemSpaces[move[1]] !== ITEM_NONE) _applyItemAuto(itemSpaces[move[1]], move[1]);
          recordPosition();
          const _aiAfterLand = () => _aiTryChainJump(move[1], _aiIsCheckersJump, () =>
            _aiBloodthirstyContinue(move[1], _aiWasCapture, (btDest) => _aiSpeedContinue(btDest, 0, _aiFinish)));
          if (isVoidSpace(move[1]) && _aiPiece0 !== NONE) {
            const [vx, vy] = xy(move[1]);
            startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _aiPiece0, _aiSide0, _aiAfterLand);
          } else { _aiAfterLand(); }
        });
      }
    } else {
      // No Black moves — pass through to greyPlay/merchantPlay
      if (countKings(W) === 0) _triggerGameOver(`Game Over! Score: ${score}`);
      else if (isCheckmated(W)) _triggerGameOver(`Checkmate! Score: ${score}`);
      if (gameOver || _rewinderSaveOffer) { aiThinking = false; takeReplaySnapshot(); draw(); return; }
      greyPlay(() => {
        merchantPlay(() => {
          applyRiverFlow(() => {
            _doSkyDropPhase(() => {
              turn = W;
              aiThinking = false;
              _ageTrails(W);  // White's trails (blocks/fire) age as its next turn begins
              _burnTick();    // a full round elapsed — burning pieces tick down (and may burn up)
              if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
              _kingOnPlayerTurn(); // the King reacts to the enemy phase (sightings, shadows, danger)
              takeReplaySnapshot();
              _turnStartSnapIndices.push(replaySnapshots.length - 1);
              draw();
              startWhiteTurnTimer();
            });
          });
        });
      });
    }
    }); // end _blackMainMove callback
  }, AI_MOVE_DELAY_MS);
}

function findKing(s) {
  for (let i = 0; i < 64; i++) if ((board[i] === KING || board[i] === CHECKERS_KING) && sides[i] === s) return xy(i);
  return [-1, -1];
}

function _checkersChainCanKillKing(i) {
  const jumps = _checkersJumpsFrom(i);
  for (const jd of jumps) {
    const [ix, iy] = xy(i), [jx, jy] = xy(jd);
    const midI = idx((ix + jx) >> 1, (iy + jy) >> 1);
    if (board[midI] === KING) return true;
    if (withState(() => { makeMove(i, jd); return _checkersChainCanKillKing(jd); })) return true;
  }
  return false;
}

function _checkersJumpsFrom(i) {
  const [x, y] = xy(i);
  const s = sides[i];
  const p = board[i];
  if (!s) return [];
  const dirs = (p === CHECKERS_KING)
    ? [[-1,-1],[1,-1],[-1,1],[1,1]]
    : (s === W ? [[-1,-1],[1,-1]] : [[-1,1],[1,1]]);
  const jumps = [];
  for (const [dx, dy] of dirs) {
    const nx = x + dx, ny = y + dy;
    const jx = x + 2 * dx, jy = y + 2 * dy;
    if (inB(nx, ny) && inB(jx, jy)) {
      const midI = idx(nx, ny), landI = idx(jx, jy);
      const midSide = sides[midI];
      if (midSide !== 0 && midSide !== s && midSide !== N && board[midI] !== NONE && canLandEmpty(landI))
        jumps.push(landI);
    }
  }
  return jumps;
}

// Perform one greedy extra move for the Black piece at `dest` (capture > advance toward White),
// animating it. Calls onDone(newIdx) once resolved, or onDone(dest) if the piece has no move.
function _aiExtraMove(dest, onDone) {
  const [dx, dy] = xy(dest);
  const pMoves = legalMoves(dx, dy);
  if (pMoves.length === 0) { onDone(dest); return; }
  // Pick greedily: King capture > best capture by value > advance (higher y = closer to White's back rank)
  let best = pMoves[0], bestScore = -Infinity;
  for (const m of pMoves) {
    let s;
    if (sides[m] === W && (board[m] === KING || board[m] === CHECKERS_KING)) s = 1e9;
    else if (board[m] !== NONE && sides[m] === W) s = 1000 + (PIECE_VALUE[board[m]] || 0);
    else s = xy(m)[1];
    if (s > bestScore) { bestScore = s; best = m; }
  }
  const [fx, fy] = xy(dest), [tx, ty] = xy(best);
  const fromCX = MARGIN + fx * TILE, fromCY = BOARD_Y + MARGIN + fy * TILE;
  const toCX = MARGIN + tx * TILE, toCY = BOARD_Y + MARGIN + ty * TILE;
  const elems = elements[dest], piece0 = board[dest], side0 = sides[dest];
  makeMove(dest, best, true);
  if (elems & ELEM_FIRE) applyFireTrail(dest, best, piece0, side0);
  if (elems & ELEM_WATER) applyWaterTrail(dest, best, piece0, side0);
  const p0 = board[best], s0 = sides[best], h0 = health[best];
  const anims = [{ toIdx: best, fromCX, fromCY, toCX, toCY, piece: p0, side: s0, hlth: h0, atk: attacks[best], spd: speeds[best] }];
  _appendCaptureGhosts(anims);
  startAnim(anims, 0, () => {
    _drainCaptureAnims();
    if (board[best] !== NONE && itemSpaces[best] !== ITEM_NONE) _applyItemAuto(itemSpaces[best], best);
    recordPosition();
    onDone(best);
  });
}

// Speed Up: a Black piece with speeds>1 takes up to speeds-1 extra moves.
function _aiSpeedContinue(dest, movesUsed, onDone) {
  if (board[dest] === NONE || sides[dest] !== B || speeds[dest] <= 1 || movesUsed >= speeds[dest] - 1) { onDone(); return; }
  _aiExtraMove(dest, (newDest) => _aiSpeedContinue(newDest, movesUsed + 1, onDone));
}

// Bloodthirsty: a Black piece that just captured takes one extra move (mirrors the player rule).
// Passes the piece's resulting index to onDone so any Speed moves continue from the right square.
function _aiBloodthirstyContinue(dest, wasCapture, onDone) {
  if (!wasCapture || board[dest] === NONE || sides[dest] !== B || !(statuses[dest] & STATUS_BLOODTHIRSTY)) { onDone(dest); return; }
  _aiExtraMove(dest, (newDest) => onDone(newDest));
}

function _aiTryChainJump(landI, wasJump, onDone) {
  if (!wasJump || (board[landI] !== CHECKERS && board[landI] !== CHECKERS_KING) || sides[landI] !== B) { onDone(); return; }
  const chainJumps = _checkersJumpsFrom(landI);
  if (chainJumps.length === 0) { onDone(); return; }
  // Pick the chain jump that captures the highest-value piece
  let nextTo = chainJumps[0], bestCapVal = -1;
  const [lx, ly] = xy(landI);
  for (const jd of chainJumps) {
    const [jx, jy] = xy(jd);
    const capVal = PIECE_VALUE[board[idx((lx + jx) >> 1, (ly + jy) >> 1)]] ?? 0;
    if (capVal > bestCapVal) { bestCapVal = capVal; nextTo = jd; }
  }
  const [fx, fy] = xy(landI), [tx, ty] = xy(nextTo);
  const fromCX = MARGIN + fx * TILE, fromCY = BOARD_Y + MARGIN + fy * TILE;
  const toCX = MARGIN + tx * TILE, toCY = BOARD_Y + MARGIN + ty * TILE;
  const chainElems = elements[landI], chainPiece0 = board[landI], chainSide0 = sides[landI];
  makeMove(landI, nextTo, true);
  if (chainElems & ELEM_FIRE) applyFireTrail(landI, nextTo, chainPiece0, chainSide0);
  if (chainElems & ELEM_WATER) applyWaterTrail(landI, nextTo, chainPiece0, chainSide0);
  const cp0 = board[nextTo], cs0 = sides[nextTo], ch0 = health[nextTo];
  const chainAnims = [{ toIdx: nextTo, fromCX, fromCY, toCX, toCY, piece: cp0, side: cs0, hlth: ch0, atk: attacks[nextTo], spd: speeds[nextTo], arc: TILE * 1.5 }];
  _appendCaptureGhosts(chainAnims);
  startAnim(chainAnims, 0, () => {
    _drainCaptureAnims();
    recordPosition();
    _aiTryChainJump(nextTo, true, onDone);
  });
}

function adjacentClonerDests(i) {
  const [x, y] = xy(i);
  const dests = [];
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const nx = x + dx, ny = y + dy;
    if (inB(nx, ny) && board[idx(nx, ny)] === NONE) dests.push(idx(nx, ny));
  }
  return dests;
}

// Auto-teleport: move the piece at i to a random safe empty square (used when a Teleporter
// item lands on / is triggered by a Grey or Black piece — mirrors the player's teleport).
function _autoTeleport(i) {
  const dests = [];
  for (let j = 0; j < 64; j++) {
    if (board[j] !== NONE || j === i) continue;
    if (j === merchantIdx || isVoidSpace(j) || isBlockSpace(j)) continue;
    dests.push(j);
  }
  if (dests.length === 0) return;
  playSfx('teleport');
  const _tDest = dests[randInt(dests.length)];
  movePiece(i, _tDest); // preserves side/stats/effects
  _igniteOnLand(_tDest); // teleported onto enemy fire — catches fire
}

// Auto-clone: drop a same-side copy of the piece at i onto a random adjacent empty square.
function _autoClone(i) {
  const dests = adjacentClonerDests(i).filter(j => j !== merchantIdx && !isVoidSpace(j) && !isBlockSpace(j));
  if (dests.length === 0) return;
  playSfx('clone');
  const _cDest = dests[randInt(dests.length)];
  copyPiece(i, _cDest); // clone keeps the same side/stats/effects
  _igniteOnLand(_cDest); // clone dropped onto enemy fire — catches fire
}

function countKings(s) {
  let n = 0;
  for (let i = 0; i < 64; i++) if ((board[i] === KING || board[i] === CHECKERS_KING) && sides[i] === s) n++;
  return n;
}

function _hasRewinder() {
  return inventory.indexOf(ITEM_REWINDER) >= 0 && _turnStartSnapIndices.length >= 2;
}

function _triggerGameOver(msg) {
  if (_hasRewinder()) {
    _rewinderSaveOffer = true;
    gameMsg = msg;
  } else {
    gameOver = true;
    gameMsg = msg;
    stopWindLoop(0); // silence the ambient wind loop on Game Over
    playSfx('over1'); playSfx('over2'); // Game Over
  }
}

function checkWhiteKingAlive() {
  const [kx, ky] = findKing(W);
  if (kx < 0) _triggerGameOver(`Game Over! Score: ${score}`);
}

function canItemAffectPiece(item, i) {
  const p = board[i];
  if (isPromoterItem(item)) { return p === PAWN && sides[i] === W; }
  switch (item) {
    case ITEM_SHIELD: return health[i] < 2;
    case ITEM_TELEPORTER: return true;
    case ITEM_CLONER: return adjacentClonerDests(i).length > 0;
    case ITEM_BOMB: return true;
    case ITEM_VAMPIRE_FANG: return !(statuses[i] & STATUS_BLOODTHIRSTY);
    case ITEM_SWORD: return attacks[i] < 2;
    case ITEM_BOOTS: return speeds[i] < 2;
    default: if (isElementalizerItem(item)) return true; return false;
  }
}

// Auto-apply an item to any piece (used for Black/Grey landings). Teleporter/Cloner auto-trigger
// (random teleport / adjacent clone); a Promoter only affects a Pawn; unhandled items consume silently.
function _applyItemAuto(item, i) {
  itemSpaces[i] = ITEM_NONE;
  switch (item) {
    case ITEM_BOMB: detonateBomb(i); break;
    case ITEM_SHIELD: case ITEM_SWORD: case ITEM_BOOTS: case ITEM_VAMPIRE_FANG:
      _applyStatEffect(item, i); break;
    case ITEM_TELEPORTER: _autoTeleport(i); break;
    case ITEM_CLONER: _autoClone(i); break;
    default:
      if (isElementalizerItem(item)) _applyElementItem(item, i);
      else if (isPromoterItem(item) && board[i] === PAWN) _promotePawnTo(item, i);
      break;
  }
}

// At end-of-round: convert pending shadows to real item spaces (with fall animation),
// then roll new shadows on vacant squares.
function _doSkyDropPhase(onDone) {
  let hasDrops = false;
  for (const [i, item] of _shadowSpaces) {
    if (itemSpaces[i] === ITEM_NONE && !isVoidSpace(i) && !isBlockSpace(i)) {
      // Don't place in itemSpaces yet — _flyTick will land it when animation finishes
      _skyDropAnims.push({ item, i, startMs: performance.now(), dur: 380 });
      hasDrops = true;
    }
  }
  _shadowSpaces.clear();
  // 1/5 chance to place a shadow; reroll on success to stack additional drops.
  const _sdCandidates = [];
  for (let i = 0; i < 64; i++) {
    if (board[i] !== NONE) continue;
    if (itemSpaces[i] !== ITEM_NONE) continue;
    if (_shadowSpaces.has(i)) continue;
    if (isVoidSpace(i) || isBlockSpace(i)) continue;
    _sdCandidates.push(i);
  }
  for (let k = _sdCandidates.length - 1; k > 0; k--) { const j = randInt(k + 1); [_sdCandidates[k], _sdCandidates[j]] = [_sdCandidates[j], _sdCandidates[k]]; }
  let _sdci = 0;
  while (_sdci < _sdCandidates.length && randInt(10) === 0) {
    _shadowSpaces.set(_sdCandidates[_sdci++], _randomItem());
  }
  if (_sdci > 0) _kingQueueFirst('firstShadow');   // the run's first looming shadow
  if (hasDrops) _kingQueueFirst('firstItemFall');  // the run's first item actually falling
  if (hasDrops) {
    if (flyAnims.length === 0 && itemFlyAnims.length === 0 && shieldPops.length === 0 && _skyDropAnims.length === 1) requestAnimationFrame(_flyTick);
    // Land all drops deterministically before onDone (which snapshots the turn start), so the
    // snapshot never misses an item that's still mid-animation — otherwise a later Rewinder loses it.
    const _gen = _runGen;
    setTimeout(() => { if (_gen !== _runGen) return; _resolveAllSkyDrops(); onDone(); }, 420);
  } else {
    onDone();
  }
}

function detonateBomb(centerI, _alreadyDetonated) {
  const detonated = _alreadyDetonated || new Set();
  detonated.add(centerI);
  const [gx, gy] = xy(centerI);
  startExplosion(MARGIN + gx * TILE + TILE / 2, BOARD_Y + MARGIN + gy * TILE + TILE / 2);
  const chainBombs = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = gx + dx, ny = gy + dy;
    if (!inB(nx, ny)) continue;
    const i = idx(nx, ny);
    if (itemSpaces[i] === ITEM_BOMB && !detonated.has(i)) chainBombs.push(i);
    if (board[i] !== NONE) {
      const _bp = board[i], _bs = sides[i];
      if (_bs === W && (_bp === KING || _bp === CHECKERS_KING)) _triggerGameOver(`Game Over! Score: ${score}`);
      else if (_bs === W) _kingQueue('bombDeath'); // a White Warrior lost to the Bomb
      if (_bs === B && (_bp === KING || _bp === CHECKERS_KING)) { score++; if (!replayMode) _turnKingsTaken++; }
      if (_bs === B) {
        gold += GOLD_VALUE[_bp] ?? 0;
        if (!replayMode) { // replayed explosions must not pollute live achievement counters
          _turnBombKills++; // Black warrior killed by a Bomb this turn
          if (_bombSource === 'inv') _turnBombFromInv = true;
          else if (_bombSource === 'square') _turnBombFromSquare = true;
        }
      }
      startCaptureAnim(_bp, _bs, MARGIN + nx * TILE + TILE / 2, BOARD_Y + MARGIN + ny * TILE + TILE / 2);
      board[i] = NONE; sides[i] = 0; health[i] = 1;
    }
    if (specialSpaces[i]?.type === 'block') specialSpaces[i] = null;
    if (i === merchantIdx) { merchantIdx = -1; merchantPendingRespawn = true; } // bomb'd Merchant returns on the next wave (like a void death)
    itemSpaces[i] = ITEM_NONE;
  }
  const _gen = _runGen;
  for (const bi of chainBombs) {
    setTimeout(() => { if (_gen !== _runGen) return; detonateBomb(bi, detonated); }, 350);
  }
}

// Silent bomb blast for AI lookahead (minimax). Mirrors detonateBomb's material/score effects
// with no animation, sound, achievement, timer, or merchant/block side effects — so it only
// touches state covered by saveState/restoreState and is safe inside withState. Chains iteratively.
function _simDetonate(centerI) {
  const detonated = new Set();
  const stack = [centerI];
  while (stack.length) {
    const ci = stack.pop();
    if (detonated.has(ci)) continue;
    detonated.add(ci);
    const [gx, gy] = xy(ci);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, ny = gy + dy;
      if (!inB(nx, ny)) continue;
      const i = idx(nx, ny);
      if (itemSpaces[i] === ITEM_BOMB && !detonated.has(i)) stack.push(i);
      if (board[i] !== NONE) {
        const _bp = board[i], _bs = sides[i];
        if (_bs === B && (_bp === KING || _bp === CHECKERS_KING)) score++;
        if (_bs === B) gold += GOLD_VALUE[_bp] ?? 0;
        clearSquare(i);
      }
      if (i === merchantIdx) merchantIdx = -1; // (merchantPendingRespawn isn't in saveState — leave it)
      itemSpaces[i] = ITEM_NONE;
    }
  }
}

// Activate an item space on square i. Auto-items apply immediately and return true (done).
// Interactive items enter the appropriate mode with piece pre-selected and return false (pending).
// Caller must call endWhiteTurn() only when this returns true.
function activateItemSpace(item, i) {
  activeItemSpaceIdx = i;
  itemSpaces[i] = ITEM_NONE;
  switch (item) {
    case ITEM_SHIELD: case ITEM_VAMPIRE_FANG: case ITEM_SWORD: case ITEM_BOOTS:
      _applyStatEffect(item, i);
      activeItemSpaceIdx = -1;
      return true;
    default:
      if (isPromoterItem(item)) {
        piecePromoterMode = true; piecePromoterTo = promoterTo(item);
        draw(); return false;
      }
      if (isElementalizerItem(item)) {
        // Auto-apply to the piece that landed on the space — no interactive selection needed
        _applyElementItem(item, i);
        activeItemSpaceIdx = -1;
        return true;
      }
    case ITEM_TELEPORTER:
      // Piece pre-selected; player chooses destination.
      teleporterSelected = i;
      teleporterMode = true;
      draw();
      return false;
    case ITEM_CLONER:
      // Piece pre-selected; player chooses adjacent destination.
      clonerSelected = i;
      clonerMode = true;
      draw();
      return false;
    case ITEM_BOMB:
      _bombSource = 'square'; // triggered by a piece moving onto a board Bomb square
      detonateBomb(i);
      activeItemSpaceIdx = -1;
      return true;
  }
  activeItemSpaceIdx = -1;
  return true;
}

// Only auto-applies instant items (Upgrader/KingPromoter) during Team Leap.
// Interactive items are left on the board until a regular move triggers them.
// Called after item interaction completes; drains queue or ends turn.
function processNextQueuedItem() {
  activeItemSpaceIdx = -1;
  if (pendingItemQueue.length === 0) { endWhiteTurn(); return; }
  const { item, i } = pendingItemQueue.shift();
  const done = activateItemSpace(item, i);
  if (done) processNextQueuedItem();
}

function closeShop() {
  shopMode = false;
  sellMode = false; sellConfirmSlot = -1;
  const done = shopOnDone;
  shopOnDone = null;
  if (done) done();
}

function openMerchantShop(onDone) {
  shopOffers = merchantOffers;
  shopMode = true;
  sellMode = true; // selling is always available while the shop is open (inventory stays active)
  sellConfirmSlot = -1;
  shopOnDone = onDone || null;
  playSfx('shopopen'); // Merchant dialogue appears
  _kingSayShop();      // first-open intro, then rotating chatter
  draw();
}

function respawnMerchant() {
  const empty = [];
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE && i !== merchantIdx && Math.floor(i / 8) !== 0) empty.push(i);
  }
  merchantIdx = empty.length > 0 ? empty[randInt(empty.length)] : -1;
}

function _placeMerchant() {
  const empty = [];
  for (let i = 0; i < 64; i++) if (board[i] === NONE && Math.floor(i / 8) !== 0) empty.push(i);
  merchantIdx = empty.length > 0 ? empty[randInt(empty.length)] : -1;
  merchantOffers = [_randomShopItem(), _randomShopItem(), _randomShopItem()];
  merchantSold = [false, false, false];
  merchantRerollCountdown = MERCHANT_REROLL_CYCLE;
}

function merchantPlay(onDone) {
  if (merchantIdx < 0 || gameOver) { onDone(); return; }
  const [mx, my] = xy(merchantIdx);
  const moves = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = mx + dx, ny = my + dy;
      if (!inB(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (board[ni] !== NONE) continue;
      if (isBlockSpace(ni)) continue;
      if (isVoidSpace(ni)) continue;
      moves.push(ni);
    }
  }
  if (moves.length === 0) { onDone(); return; }
  const dest = moves[randInt(moves.length)];
  const fromCX = MARGIN + mx * TILE, fromCY = BOARD_Y + MARGIN + my * TILE;
  const toCX = MARGIN + (dest % 8) * TILE, toCY = BOARD_Y + MARGIN + Math.floor(dest / 8) * TILE;
  merchantIdx = dest;
  if (isVoidSpace(merchantIdx)) { respawnMerchant(); onDone(); return; }
  startAnim([{ toIdx: dest, fromCX, fromCY, toCX, toCY, spriteKey: "merchant" }], 0, onDone);
}

// After a Team Advance, apply item spaces.
function applySpacesAfterAdvance() {
  checkWhiteKingAlive();
  if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
  _applySpacesAfterAdvancePass2();
}

function _applySpacesAfterAdvancePass2() {
  // Pass 2: item spaces â€" instant items applied now, interactive items queued.
  pendingItemQueue = [];
  for (let i = 0; i < 64; i++) {
    const item = itemSpaces[i];
    if (item === ITEM_NONE || sides[i] !== W || !canItemAffectPiece(item, i)) continue;
    if (item === ITEM_SHIELD) { _applyStatEffect(ITEM_SHIELD, i); itemSpaces[i] = ITEM_NONE; }
    else if (isPromoterItem(item)) { _promotePawnTo(item, i); itemSpaces[i] = ITEM_NONE; }
    else { pendingItemQueue.push({ item, i }); itemSpaces[i] = ITEM_NONE; }
  }

  processNextQueuedItem();
}


// --- Leap button geometry ---
const BOARD_Y = LOGO_H + PREVIEW_H;
const INV_PANEL_TOP = BOARD_Y + MARGIN + BOARD_PX + 70;
const INV_PANEL_BOTTOM = INV_PANEL_TOP + INV_ROWS * (INV_SLOT + INV_PAD) + INV_PAD + 58;
const BTN_Y = INV_PANEL_BOTTOM + 20;
const BTN_GAP = 8;
const LEAP_BTN = { x: MARGIN, y: BTN_Y, w: BOARD_PX / 2 - BTN_GAP / 2, h: 60 };
const PITCH_BTN = { x: MARGIN + BOARD_PX / 2 + BTN_GAP / 2, y: BTN_Y, w: BOARD_PX / 2 - BTN_GAP / 2, h: 60 };
// Setup buttons laid out in three rows: [Classic | Roll] / [Untimed | Timed] / [Go].
const _SETUP_BTN_W = Math.floor((BOARD_PX - BTN_GAP) / 2);      // left column of each pair
const _SETUP_BTN_W2 = BOARD_PX - _SETUP_BTN_W - BTN_GAP;         // right column takes the remainder (exact fit)
const _SETUP_ROW2_Y = BTN_Y + 68;
const _SETUP_ROW3_Y = _SETUP_ROW2_Y + 68;
const CLASSIC_BTN    = { x: MARGIN, y: BTN_Y, w: _SETUP_BTN_W, h: 60 };
const SETUP_ROLL_BTN = { x: MARGIN + _SETUP_BTN_W + BTN_GAP, y: BTN_Y, w: _SETUP_BTN_W2, h: 60 };
const UNTIMED_BTN    = { x: MARGIN, y: _SETUP_ROW2_Y, w: _SETUP_BTN_W, h: 60 };
const TIMED_BTN      = { x: MARGIN + _SETUP_BTN_W + BTN_GAP, y: _SETUP_ROW2_Y, w: _SETUP_BTN_W2, h: 60 };
const SETUP_GO_BTN   = { x: MARGIN, y: _SETUP_ROW3_Y, w: BOARD_PX, h: 60 };
const COUNTDOWN_Y = BTN_Y + 60 + 46;
const GRAVE_Y = COUNTDOWN_Y + 100;
const GRAVE_H = 150;
const GRAVE_W = Math.floor(BOARD_PX / 2) - 8;
const PLAYER_GRAVE_X = MARGIN;
const ENEMY_GRAVE_X = MARGIN + Math.floor(BOARD_PX / 2) + 8;
const RESIGN_BTN = { x: MARGIN + BOARD_PX / 2 - 80, y: GRAVE_Y + GRAVE_H + 8, w: 160, h: 60 };
const LAST_MOVE_BTN = { x: RESIGN_BTN.x + RESIGN_BTN.w + 16, y: RESIGN_BTN.y, w: 280, h: 60 };
const SIDE_BTN_Y = GRAVE_Y + GRAVE_H + 74;
const HINT_BTN = { x: INV_X, y: SIDE_BTN_Y, w: INV_W, h: 36 };

// --- Achievements screen geometry ---
// The achievements grid reuses the board's exact geometry (8×8 equal cells).
const ACH_GRID_X = MARGIN, ACH_GRID_Y = BOARD_Y + MARGIN;
const ACH_MENU_BTN = { x: MARGIN + BOARD_PX / 2 - 150, y: GRAVE_Y, w: 300, h: 60 }; // on the setup menu
const ACH_LABEL_Y = BOARD_Y + MARGIN + BOARD_PX + 24;                              // label under the grid
const ACH_BACK_BTN  = { x: MARGIN + BOARD_PX / 2 - 110, y: ACH_LABEL_Y + 150, w: 220, h: 64 }; // centered under the label
// Clear sits at the distant bottom of the screen, away from Back (computed from canvas height).
function _achClearBtnRect() { const w = 200, h = 56; return { x: MARGIN + BOARD_PX / 2 - w / 2, y: canvas.height - h - 30, w, h }; }
// Centered confirm dialog for Clear Achievements.
function _achClearDlgRects() {
  const w = Math.min(BOARD_PX, 520), h = 220, x = MARGIN + (BOARD_PX - w) / 2, y = ACH_GRID_Y + (BOARD_PX - h) / 2;
  const bw = 150, bh = 64, by = y + h - bh - 24, gap = 40;
  return {
    box: { x, y, w, h },
    yes: { x: x + w / 2 - bw - gap / 2, y: by, w: bw, h: bh },
    no:  { x: x + w / 2 + gap / 2,       y: by, w: bw, h: bh },
  };
}

// Setup screen: a Back button (to the main menu) sits where the old Achievements/Leaderboard
// buttons were — those now live on the main menu instead.
const SETUP_BACK_BTN = { x: MARGIN + BOARD_PX / 2 - 130, y: GRAVE_Y + 20, w: 260, h: 60 };

// --- Leaderboard screen geometry ---
const LB_MENU_BTN = { x: MARGIN + BOARD_PX / 2 - 150, y: GRAVE_Y + 70, w: 300, h: 60 }; // setup menu, below Achievements
const LB_TAB_H = 60, LB_TAB_GAP = 14, LB_TABS_Y = BOARD_Y + MARGIN;
// Single row of tab buttons, one per board (order matches LB_BOARDS).
function _lbTabRects() {
  const n = LB_BOARDS.length, w = (BOARD_PX - LB_TAB_GAP * (n - 1)) / n;
  return LB_BOARDS.map((b, i) => ({ key: b.key, x: MARGIN + i * (w + LB_TAB_GAP), y: LB_TABS_Y, w, h: LB_TAB_H }));
}
const LB_TABS_BOTTOM = LB_TABS_Y + LB_TAB_H; // single row
const LB_LIST_TOP = LB_TABS_BOTTOM + 74; // gap below the tab buttons
const LB_ROW_H = 56, LB_MAX_ROWS = 15;
const LB_BACK_BTN    = { x: MARGIN + BOARD_PX / 2 - 230, y: ACH_LABEL_Y + 150, w: 220, h: 64 };
const LB_REFRESH_BTN = { x: MARGIN + BOARD_PX / 2 + 10,  y: ACH_LABEL_Y + 150, w: 220, h: 64 };

// --- Draw ---

function drawBackground(_fieldAnim, _animT) {
// Ground texture — tiles vertically, scrolls with the field
const groundEl = spriteImages["ground"];
if (groundEl && groundEl.complete && groundEl.naturalWidth > 0) {
  const gw = groundEl.naturalWidth, gh = groundEl.naturalHeight;
  const scale = canvas.width / gw;
  const tileH = gh * scale;
  const animScrollDy = _fieldAnim ? -anim.boardDy * (1 - _animT) : 0;
  // + _menuScrollY: carry the (now-frozen) menu scroll phase into gameplay so Play doesn't jump.
  const rawOffset = -leapCount * TILE + animScrollDy + _menuScrollY;
  const startY = -((rawOffset % tileH) + tileH) % tileH;
  for (let ty = startY; ty < canvas.height; ty += tileH) {
    ctx.drawImage(groundEl, 0, ty, canvas.width, tileH);
  }
}

// Stats â€" right side
{
  ctx.font = "42px Canterbury";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#fff";
  ctx.fillText(`Taken Kings: ${score}`, MARGIN + BOARD_PX, LOGO_H * 0.35);
  ctx.fillText(`Gold: ${gold}`, MARGIN + BOARD_PX, LOGO_H * 0.70);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
}

// Turn timer — centered above the board
if (timedMode && !replayMode && gamePhase === 'playing' && !gameOver) {
  const secsLeft = _timerEnd > 0 ? Math.max(0, Math.ceil((_timerEnd - Date.now()) / 1000)) : _timerDisplay;
  if (_timerEnd > 0) _timerDisplay = secsLeft; // keep display in sync while running
  const urgent = secsLeft <= 10;
  const mins = Math.floor(secsLeft / 60), secs = secsLeft % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`;
  ctx.font = "52px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 8; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = urgent ? "#ff4444" : "#ffffff";
  ctx.fillText(`⏱ ${timeStr}`, MARGIN + BOARD_PX / 2, LOGO_H / 2);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
}
}

function drawBoardArea(_animT, _animToSet, _fieldAnim) {
ctx.save();
ctx.translate(0, BOARD_Y);

// Labels
ctx.font = "42px Canterbury";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.shadowColor = "rgba(0,0,0,0.9)";
ctx.shadowBlur = 6;
ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
ctx.fillStyle = "#fff";
for (let i = 0; i < 8; i++) {
  ctx.fillText("abcdefgh"[i], MARGIN + i * TILE + TILE / 2, MARGIN + BOARD_PX + 36);
  ctx.fillText(8 + leapCount - i, MARGIN - 26, MARGIN + i * TILE + TILE / 2);
}
ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

// During Field Advance animation: clip to the fog row and below so content above the fog
// stays invisible (darkness), while the incoming row slides through the fog into the board.
if (_fieldAnim) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(-MARGIN, MARGIN - TILE, canvas.width + MARGIN * 2, BOARD_PX + TILE);
  ctx.clip();
  ctx.translate(0, anim.boardDy * (1 - _animT));
}

// Board squares (live rows 0-7) — semi-transparent so ground shows through
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
  const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
  if ((x + y) % 2 !== 0) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(px, py, TILE, TILE); }
}

// Flash red fog on bottom row when field advance is 1 turn away
if (shiftCountdown === 1 && !anim) {
  const pulse = 0.18 + 0.22 * Math.abs(Math.sin(performance.now() / 250));
  ctx.fillStyle = `rgba(220,30,30,${pulse.toFixed(3)})`;
  ctx.fillRect(MARGIN, MARGIN + 7 * TILE, 8 * TILE, TILE);
  if (!warnFlashRunning) { warnFlashRunning = true; requestAnimationFrame(_warnFlashTick); }
}

// Preview row â€" always drawn one row above the live board, scrolls with the board.
// In normal play: shows nextWave (the upcoming row) underneath the fog overlay.
// During Field Advance: nextWave is already updated to wave B, so wave B sits here;
// the -TILE shift places it above the clip boundary at t=0 and slides it into the
// fog position by t=1, while wave A (board row 0) slides out of fog into the live board.
for (let x = 0; x < 8; x++) {
  if ((x + 1) % 2 !== 0) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(MARGIN + x * TILE, MARGIN - TILE, TILE, TILE); }
}
const prevPad = 6;
for (const w of nextWave) {
  _drawPieceSprite(ctx, B, w.piece, MARGIN + w.x * TILE + prevPad, MARGIN - TILE + prevPad, TILE - prevPad * 2, TILE - prevPad * 2, false, true);
  if (w.eff && w.eff.effects.length) _drawPieceEffectIcons(ctx, MARGIN + w.x * TILE, MARGIN - TILE, w.eff.effects);
}
for (const b of nextBonuses) {
  const bpx = MARGIN + b.col * TILE, bpy = MARGIN - TILE;
  if (b.type === 'chest') {
    const bimg = spriteImages["chest"];
    if (bimg && bimg.complete) ctx.drawImage(bimg, bpx + prevPad, bpy + prevPad, TILE - prevPad * 2, TILE - prevPad * 2);
  } else if (b.type === 'item') {
    const iimg = spriteImages[ITEM_SPRITE_KEYS[b.item]];
    if (iimg && iimg.complete) {
      ctx.fillStyle = "rgba(255,220,80,0.22)";
      ctx.fillRect(bpx, bpy, TILE, TILE);
      const sz2 = TILE * 0.7, off2 = (TILE - sz2) / 2;
      const bob2 = Math.sin(performance.now() * 0.002 + b.col * 0.7) * 6;
      const shadowAlpha2 = 0.3 - 0.1 * ((bob2 + 6) / 12);
      ctx.save();
      ctx.globalAlpha = shadowAlpha2;
      ctx.beginPath();
      ctx.ellipse(bpx + TILE / 2, bpy + TILE - 10, sz2 * 0.35, 5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#000"; ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 0.9;
      ctx.drawImage(iimg, bpx + off2, bpy + off2 + bob2, sz2, sz2);
      ctx.globalAlpha = 1.0;
    }
  } else if (b.type === 'void') {
    const vcx = bpx + TILE / 2, vcy = bpy + TILE / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(vcx, vcy, TILE * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "#000000"; ctx.fill();
    ctx.strokeStyle = "rgba(140,0,220,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(vcx, vcy, TILE * 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else if (b.type === 'river' && b.col === 0) {
    // Draw the full river row in the preview once (triggered by col===0 entry)
    ctx.save();
    ctx.fillStyle = 'rgba(40,160,220,0.22)';
    ctx.fillRect(MARGIN, MARGIN - TILE, 8 * TILE, TILE);
    for (let rx = 0; rx < 8; rx++) {
      const rcx = MARGIN + rx * TILE + TILE / 2, rcy = MARGIN - TILE + TILE / 2;
      const aLen = TILE * 0.28, rdx = b.dx;
      ctx.strokeStyle = 'rgba(100,210,255,0.7)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(rcx - rdx * aLen * 0.6, rcy); ctx.lineTo(rcx + rdx * aLen, rcy); ctx.stroke();
      ctx.fillStyle = 'rgba(100,210,255,0.7)';
      ctx.save(); ctx.translate(rcx + rdx * aLen, rcy); ctx.rotate(rdx > 0 ? 0 : Math.PI);
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-11,-5); ctx.lineTo(-11,5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  } else if (b.type === 'block') {
    drawBlockTile(ctx, bpx, bpy, TILE);
  } else if (b.type === 'grey') {
    {
      _drawPieceSprite(ctx, N, b.piece, bpx + prevPad, bpy + prevPad, TILE - prevPad * 2, TILE - prevPad * 2, false, true);
      if (b.eff && b.eff.effects.length) _drawPieceEffectIcons(ctx, bpx, bpy, b.eff.effects);
    }
  }
}
// Queued merchant shown in the preview/fog row
if (merchantQueued && merchantQueuedCol >= 0) {
  const mImg = spriteImages["merchant"];
  const mpx = MARGIN + merchantQueuedCol * TILE;
  const mpy = MARGIN - TILE;
  if (mImg && mImg.complete) ctx.drawImage(mImg, mpx + prevPad, mpy + prevPad, TILE - prevPad * 2, TILE - prevPad * 2);
}

// Exit row â€" only during Field Advance animation. Drawn at y=8 (one below the live board)
// so it starts at its original position and slides down behind the bottom border.
if (_fieldAnim && anim.exitRow) {
  const erPad = 6;
  for (let x = 0; x < 8; x++) {
    if ((x + 8) % 2 !== 0) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(MARGIN + x * TILE, MARGIN + BOARD_PX, TILE, TILE); }
  }
  for (const ep of anim.exitRow) {
    if (ep.merchant) {
      const mImg = spriteImages["merchant"];
      if (mImg && mImg.complete) ctx.drawImage(mImg, MARGIN + ep.x * TILE + erPad, MARGIN + BOARD_PX + erPad, TILE - erPad * 2, TILE - erPad * 2);
    }
    if (ep.piece === NONE) continue;
    const ekey = ep.piece === CHEST ? "chest" : `${ep.side}_${ep.piece}`;
    const eimg = spriteImages[ekey];
    if (eimg && eimg.complete)
      ctx.drawImage(eimg, MARGIN + ep.x * TILE + erPad, MARGIN + BOARD_PX + erPad, TILE - erPad * 2, TILE - erPad * 2);
    if (ep.side === W) _drawPieceBadges(ctx, MARGIN + ep.x * TILE, MARGIN + BOARD_PX, ep.hlth, ep.atk ?? 1, ep.spd ?? 1, 30);
  }
}

// Selected
if (selected >= 0) {
  const [sx, sy] = xy(selected);
  ctx.fillStyle = SEL_COLOR;
  ctx.fillRect(MARGIN + sx * TILE, MARGIN + sy * TILE, TILE, TILE);
}

// Valid moves
for (const m of validMoves) {
  const [mx, my] = xy(m);
  ctx.fillStyle = MOVE_COLOR;
  ctx.fillRect(MARGIN + mx * TILE, MARGIN + my * TILE, TILE, TILE);
}
// (The tap-marker ring for _inspectIdx is drawn near the end of this function, on TOP of every board
//  element — Blocks, pieces, items, terrain — so the frame is never hidden. The fog-cell ring is in
//  drawFogWindow(), after the fog wash.)

// Chest spaces (floor markers — rendered before pieces so pieces show on top)
{ const _cp = 6;
  for (const ci of chestSpaces) {
    const [cx2, cy2] = xy(ci);
    const img = spriteImages["chest"];
    if (img && img.complete) {
      ctx.drawImage(img, MARGIN + cx2 * TILE + _cp, MARGIN + cy2 * TILE + _cp, TILE - _cp * 2, TILE - _cp * 2);
    }
  }
}

// Sky-drop shadows (pulsing oval preview before item falls)
for (const [i] of _shadowSpaces) {
  const [x, y] = xy(i);
  const scx = MARGIN + x * TILE + TILE / 2;
  const scy = MARGIN + y * TILE + TILE / 2;
  const pulse = 0.45 + 0.2 * Math.sin(performance.now() * 0.003 + i);
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(scx, scy, TILE * 0.32, TILE * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Item spaces (rendered before pieces so pieces show on top)
for (let i = 0; i < 64; i++) {
  if (itemSpaces[i] === ITEM_NONE) continue;
  const [x, y] = xy(i);
  const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
  const itemHere = itemSpaces[i];
  const key = ITEM_SPRITE_KEYS[itemHere];
  const img = spriteImages[key];
  const sz = TILE * 0.7;
  const offX = (TILE - sz) / 2;
  const baseOffY = (TILE - sz) / 2;
  const bob = Math.sin(performance.now() * 0.002 + i * 0.7) * 6;
  const _drawBoardItemShadow = () => {
    const shadowAlpha = 0.3 - 0.1 * ((bob + 6) / 12);
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.beginPath();
    ctx.ellipse(px + TILE / 2, py + TILE - 10, sz * 0.35, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000"; ctx.fill();
    ctx.restore();
  };
  if (img && img.complete) {
    _drawBoardItemShadow();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, px + offX, py + baseOffY + bob, sz, sz);
    ctx.globalAlpha = 1.0;
  } else if (isElementalizerItem(itemHere)) {
    const elem = elemFromItem(itemHere, false);
    const color = itemHere === ITEM_ELEM_MYSTERY ? '#cc88ff' : ELEM_COLORS[elem];
    const letter = itemHere === ITEM_ELEM_MYSTERY ? '?' : ELEM_NAMES[elem][0];
    const r = sz / 2;
    const cx2 = px + TILE / 2, cy2 = py + baseOffY + bob + r;
    _drawBoardItemShadow();
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(sz * 0.55)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    ctx.fillText(letter, cx2, cy2);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1.0;
  } else {
    _drawBoardItemShadow();
    ctx.globalAlpha = 0.9;
    _drawItemInSlot(ctx, itemHere, px + offX, py + baseOffY + bob, sz);
    ctx.globalAlpha = 1.0;
  }
}



// Sky-drop falling animations
if (_skyDropAnims.length > 0) {
  const _sdNow = performance.now();
  const _sdSz = TILE * 0.7;
  for (const f of _skyDropAnims) {
    const t = Math.min(1, (_sdNow - f.startMs) / f.dur);
    const ease = t * t; // ease-in (accelerating fall)
    const [x, y] = xy(f.i);
    const destY = MARGIN + y * TILE + (TILE - _sdSz) / 2;
    const drawY = -TILE * 2 + (destY - (-TILE * 2)) * ease;
    const drawX = MARGIN + x * TILE + (TILE - _sdSz) / 2;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 4);
    _drawItemInSlot(ctx, f.item, drawX, drawY, _sdSz);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// Void spaces
let hasVoid = false;
for (let i = 0; i < 64; i++) {
  const sp = specialSpaces[i];
  if (!sp || sp.type !== 'void') continue;
  hasVoid = true;
  const [x, y] = xy(i);
  const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
  const cx = px + TILE / 2, cy = py + TILE / 2;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.36, 0, Math.PI * 2);
  ctx.fillStyle = "#000000"; ctx.fill();
  const pulse = 0.45 + 0.25 * Math.abs(Math.sin(performance.now() / 700 + i));
  ctx.strokeStyle = `rgba(140,0,220,${pulse.toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, TILE * 0.36, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
if (hasVoid && !voidPulseRunning && !anim) { voidPulseRunning = true; requestAnimationFrame(_voidPulseTick); }
const hasItemSpace = itemSpaces.some(v => v !== ITEM_NONE) || nextBonuses.some(b => b.type === 'item') || _shadowSpaces.size > 0;
if (hasItemSpace && !chestBobRunning && !anim) { chestBobRunning = true; requestAnimationFrame(_chestBobTick); }

// River rows
for (let y = 0; y < 8; y++) {
  const cell = specialSpaces[idx(0, y)];
  if (!cell || cell.type !== 'river') continue;
  const dx = cell.dx;
  const py = MARGIN + y * TILE;
  ctx.save();
  ctx.fillStyle = 'rgba(40,160,220,0.22)';
  ctx.fillRect(MARGIN, py, 8 * TILE, TILE);
  // Arrow in each cell
  for (let x = 0; x < 8; x++) {
    const cx2 = MARGIN + x * TILE + TILE / 2, cy2 = py + TILE / 2;
    const aLen = TILE * 0.28;
    const tx2 = cx2 + dx * aLen, ty2 = cy2;
    const bx2 = cx2 - dx * aLen * 0.6, by2 = cy2;
    ctx.strokeStyle = 'rgba(100,210,255,0.7)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(tx2, ty2); ctx.stroke();
    ctx.fillStyle = 'rgba(100,210,255,0.7)';
    ctx.save(); ctx.translate(tx2, ty2); ctx.rotate(dx > 0 ? 0 : Math.PI);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-11,-5); ctx.lineTo(-11,5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Water-trail currents: per-cell directional rivers a Water Warrior leaves in its wake. Unlike the
// row-wide spawn bands above, each cell carries its own (dx,dy), so the arrow rotates to the flow
// direction (diagonals included). Dims as it nears expiry. Static fill — no per-frame gradient.
for (const [i, w] of waterTrails) {
  const [wtx, wty] = xy(i);
  const px = MARGIN + wtx * TILE, py = MARGIN + wty * TILE;
  const fade = w.age >= 1 ? 0.55 : 1;
  ctx.save();
  ctx.fillStyle = `rgba(40,160,220,${(0.2 * fade).toFixed(2)})`;
  ctx.fillRect(px, py, TILE, TILE);
  ctx.translate(px + TILE / 2, py + TILE / 2);
  ctx.rotate(Math.atan2(w.dy, w.dx));
  const aLen = TILE * 0.28;
  ctx.strokeStyle = `rgba(120,220,255,${(0.75 * fade).toFixed(2)})`; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-aLen * 0.6, 0); ctx.lineTo(aLen, 0); ctx.stroke();
  ctx.fillStyle = `rgba(120,220,255,${(0.75 * fade).toFixed(2)})`;
  ctx.beginPath(); ctx.moveTo(aLen, 0); ctx.lineTo(aLen - 11, -5); ctx.lineTo(aLen - 11, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// Block spaces
for (let i = 0; i < 64; i++) {
  const sp = specialSpaces[i];
  if (!sp || sp.type !== 'block') continue;
  const [x, y] = xy(i);
  drawBlockTile(ctx, MARGIN + x * TILE, MARGIN + y * TILE, TILE, !!sp.temp);
}

// Water wave animation overlay
if (waveAnim) {
  const t = Math.min(1, (performance.now() - waveAnim.startMs) / waveAnim.dur);
  const sq = waveAnim.squares;
  const head = t * sq.length;
  for (let k = 0; k < sq.length; k++) {
    const dist = head - k;
    if (dist < 0 || dist > 3) continue;
    const alpha = dist < 1 ? dist * 0.7 : (3 - dist) / 2 * 0.7;
    const [wx, wy] = xy(sq[k]);
    ctx.fillStyle = `rgba(34,170,255,${alpha.toFixed(2)})`;
    ctx.fillRect(MARGIN + wx * TILE, MARGIN + wy * TILE, TILE, TILE);
  }
}

// Fire squares: animated flames. Black-laid fire (dangerous to White) burns orange; White-laid fire
// (safe for the player — only opposing pieces catch fire) burns blue, so the player reads it as safe.
for (const [fi, f] of fireSquares) {
  const [fx, fy] = xy(fi);
  _drawFireTile(ctx, MARGIN + fx * TILE, MARGIN + fy * TILE, f.side);
}

// Pieces and chests
const pad = 6;
for (let i = 0; i < 64; i++) {
  if (board[i] === NONE) continue;
  if (_animToSet.has(i)) continue; // drawn by animation overlay at interpolated position
  const [x, y] = xy(i);
  // If a wave visual override exists, draw at the old position until the wave reaches it
  const _waveOv = waveAnim?.drawAt?.get(i);
  const _drawX = _waveOv ? _waveOv.cx : MARGIN + x * TILE;
  const _drawY = (_waveOv ? _waveOv.cy : MARGIN + y * TILE) + _pieceHopAt(i); // + per-piece hop during capture shake
  const _isActivePiece = (i === selected);
  _drawPieceSprite(ctx, sides[i], board[i], _drawX + pad, _drawY + pad, TILE - pad * 2, TILE - pad * 2, _isActivePiece);
  _drawPieceEffectIcons(ctx, _drawX, _drawY, effectOrders[i]);
  if (burning[i] > 0) _drawBurningOverlay(ctx, _drawX, _drawY, burning[i]); // on fire — flames + rounds-left badge
}

// Draw ghost sprites for void-bound wave pieces (already removed from board)
if (waveAnim?.drawAt) {
  const pad2 = 6;
  for (const [boardI, ov] of waveAnim.drawAt) {
    if (ov.voidDeath && board[boardI] === NONE) {
      _drawPieceSprite(ctx, ov.voidDeath.s, ov.voidDeath.p, ov.cx + pad2, ov.cy + pad2, TILE - pad2 * 2, TILE - pad2 * 2);
    }
    if (ov.merchantVoidDeath && merchantIdx < 0) {
      const mImg = spriteImages["merchant"];
      if (mImg && mImg.complete) ctx.drawImage(mImg, ov.cx + pad2, ov.cy + pad2, TILE - pad2 * 2, TILE - pad2 * 2);
    }
  }
}

// Merchant NPC sprite (suppressed when animating — anim overlay draws him)
if (merchantIdx >= 0 && !_animToSet.has(merchantIdx)) {
  const [mx, my] = xy(merchantIdx);
  const mImg = spriteImages["merchant"];
  if (mImg && mImg.complete) ctx.drawImage(mImg, MARGIN + mx * TILE + pad, MARGIN + my * TILE + pad, TILE - pad * 2, TILE - pad * 2);
}

// Pending captures: pieces removed from board but not yet visually taken (waiting for hop anim)
for (const [idxStr, cap] of Object.entries(pendingCaptures)) {
  const i = Number(idxStr);
  const [x, y] = xy(i);
  _drawPieceSprite(ctx, cap.side, cap.piece, MARGIN + x * TILE + pad, MARGIN + y * TILE + pad, TILE - pad * 2, TILE - pad * 2);
}

// Piece promoter highlight
if (piecePromoterMode) {
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W && board[i] === PAWN) {
      const [px, py] = xy(i);
      ctx.fillStyle = "rgba(200,150,50,0.5)";
      ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
    }
  }
}

// Cloner highlight
if (clonerMode) {
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const [px, py] = xy(i);
    if (clonerSelected < 0) {
      if (adjacentClonerDests(i).length > 0) {
        ctx.fillStyle = "rgba(50,220,120,0.45)";
        ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
      }
    } else if (i === clonerSelected) {
      ctx.fillStyle = "rgba(50,220,120,0.7)";
      ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
    }
  }
  if (clonerSelected >= 0) {
    for (const di of adjacentClonerDests(clonerSelected)) {
      const [px, py] = xy(di);
      ctx.fillStyle = "rgba(50,220,120,0.4)";
      ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
    }
  }
}

// Upgrader highlight â€" all white pieces selectable
if (shieldMode || vampireFangMode || swordMode || speedMode) {
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const [px, py] = xy(i);
    ctx.fillStyle = "rgba(255,200,50,0.5)";
    ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
  }
}


// Elementalizer highlight — all white pieces selectable
if (elementizerMode) {
  const ELEM_RGBA = {
    [ELEM_FIRE]: 'rgba(255,68,0,0.45)', [ELEM_WATER]: 'rgba(34,170,255,0.45)',
    [ELEM_EARTH]: 'rgba(136,102,0,0.45)', [ELEM_AIR]: 'rgba(170,238,255,0.45)'
  };
  const hlColor = ELEM_RGBA[elementizerElem] || 'rgba(204,136,255,0.45)';
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const [px, py] = xy(i);
    ctx.fillStyle = hlColor;
    ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
  }
}

// Bomb highlight — 3x3 blast zone around hovered square
if (bombMode && bombHoverIdx >= 0) {
  const [hx, hy] = xy(bombHoverIdx);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = hx + dx, ny = hy + dy;
    if (!inB(nx, ny)) continue;
    ctx.fillStyle = dx === 0 && dy === 0 ? "rgba(255,80,0,0.55)" : "rgba(255,160,0,0.35)";
    ctx.fillRect(MARGIN + nx * TILE, MARGIN + ny * TILE, TILE, TILE);
  }
}

// Teleporter highlight
if (teleporterMode) {
  for (let i = 0; i < 64; i++) {
    const [px, py] = xy(i);
    if (teleporterSelected < 0) {
      // Highlight selectable white pieces
      if (sides[i] === W) {
        ctx.fillStyle = "rgba(80,180,255,0.45)";
        ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
      }
    } else {
      // Highlight selected piece
      if (i === teleporterSelected) {
        ctx.fillStyle = "rgba(80,180,255,0.7)";
        ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
      } else if (board[i] === NONE || board[i] === CHEST) {
        // Highlight valid destinations
        ctx.fillStyle = "rgba(80,255,180,0.4)";
        ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
      }
    }
  }
}

// Tap-marker ring: LAST board draw (still inside the board translate) so it sits on top of every
// element — Blocks, pieces, items, terrain. Only on the player's turn.
if (_inspectIdx >= 0 && turn === W && !aiThinking && gamePhase === 'playing' && !replayMode) {
  const [ix, iy] = xy(_inspectIdx);
  ctx.save();
  ctx.strokeStyle = "rgba(244, 226, 150, 0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(MARGIN + ix * TILE + 3, MARGIN + iy * TILE + 3, TILE - 6, TILE - 6, 6);
  ctx.stroke();
  ctx.restore();
}

if (_fieldAnim) ctx.restore(); // remove clip + field-advance shift
ctx.restore(); // remove board translate

// Animation overlay: draw moving pieces at interpolated canvas positions
if (anim && anim.pieces) {
  const apad = 6;
  for (const ap of anim.pieces) {
    const acx = ap.fromCX + (ap.toCX - ap.fromCX) * _animT;
    const arcOffset = ap.arc ? ap.arc * 4 * _animT * (1 - _animT) : 0;
    const acy = ap.fromCY + (ap.toCY - ap.fromCY) * _animT - arcOffset;
    if (ap.spriteKey) {
      const img = spriteImages[ap.spriteKey];
      if (img && img.complete) ctx.drawImage(img, acx + apad, acy + apad, TILE - apad * 2, TILE - apad * 2);
    } else if (ap.piece === CHEST) {
      const img = spriteImages["chest"];
      if (img && img.complete) ctx.drawImage(img, acx + apad, acy + apad, TILE - apad * 2, TILE - apad * 2);
    } else {
      _drawPieceSprite(ctx, ap.side, ap.piece, acx + apad, acy + apad, TILE - apad * 2, TILE - apad * 2);
    }
    _drawPieceEffectIcons(ctx, acx, acy, ap.toIdx >= 0 ? effectOrders[ap.toIdx] : []);
  }
}
}

function drawFogWindow() {
// Static fog window â€" completely independent of the board. Always at the same canvas
// position. Board content (including the preview row) scrolls underneath it.
const previewRowNum = 8 + leapCount + 1;
ctx.fillStyle = "rgba(15, 15, 40, 0.58)";
ctx.fillRect(MARGIN, BOARD_Y + MARGIN - TILE, 8 * TILE, TILE);
ctx.font = "42px Canterbury";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
ctx.fillStyle = "#fff";
ctx.fillText(previewRowNum, MARGIN - 26, BOARD_Y + MARGIN - TILE + TILE / 2);
// Tap-marker ring for an inspected fog cell — drawn here, AFTER the fog wash, so the frame reads
// over the darkening instead of being dimmed by it (absolute coords: this fn isn't board-translated).
if (_inspectPreviewCol >= 0 && turn === W && !aiThinking && gamePhase === 'playing' && !replayMode) {
  ctx.save();
  ctx.strokeStyle = "rgba(244, 226, 150, 0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(MARGIN + _inspectPreviewCol * TILE + 3, BOARD_Y + MARGIN - TILE + 3, TILE - 6, TILE - 6, 6);
  ctx.stroke();
  ctx.restore();
}
}


function _drawEffectDot(ctx, cx, cy, r, color, letter, lightText) {
  ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = lightText ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)';
  ctx.font = `bold ${r}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, cx, cy + 1);
}

// Draw up to 3 effect icons (in acquisition order) at bottom-left, bottom-center, bottom-right.
function _drawPieceEffectIcons(ctx, drawX, drawY, effectList) {
  if (!effectList?.length) return;
  const show = effectList.slice(0, 3);
  const sz = 45, r = 12;
  const slotXs = [drawX + TILE * 0.17, drawX + TILE * 0.5, drawX + TILE * 0.83];
  const cy = drawY + TILE - sz / 2 - 2;
  const dotProps = { bt: ['#cc0000','B',true], fire: ['#ff4400','F',true], water: ['#22aaff','W',false], earth: ['#886600','E',true], air: ['#aaeeff','A',false] };
  for (let k = 0; k < show.length; k++) {
    const cx = slotXs[k];
    const eff = show[k];
    if (eff === 'atk') { const img = spriteImages["item_sword"];    if (img?.complete) ctx.drawImage(img, cx-sz/2, cy-sz/2, sz, sz); }
    else if (eff === 'hlt') { const img = spriteImages["item_upgrader"]; if (img?.complete) ctx.drawImage(img, cx-sz/2, cy-sz/2, sz, sz); }
    else if (eff === 'spd') { const img = spriteImages["item_boots"];    if (img?.complete) ctx.drawImage(img, cx-sz/2, cy-sz/2, sz, sz); }
    else if (dotProps[eff]) { const [color, letter, light] = dotProps[eff]; _drawEffectDot(ctx, cx, cy, r, color, letter, light); }
  }
}

function _drawPieceBadges(ctx, drawX, drawY, hlth, atk, spd, sz = 45) {
  if (hlth > 1) {
    const bx = drawX + TILE - sz - 2, by = drawY + (TILE - sz) / 2;
    const shieldImg = spriteImages["item_upgrader"];
    if (shieldImg && shieldImg.complete) ctx.drawImage(shieldImg, bx, by, sz, sz);
  }
  if (atk > 1) {
    const bx = drawX + TILE - sz - 2, by = drawY + 2;
    const swordImg = spriteImages["item_sword"];
    if (swordImg && swordImg.complete) ctx.drawImage(swordImg, bx, by, sz, sz);
  }
  if (spd > 1) {
    const bx = drawX + TILE - sz - 2, by = drawY + TILE - sz - 2;
    const bootsImg = spriteImages["item_boots"];
    if (bootsImg && bootsImg.complete) ctx.drawImage(bootsImg, bx, by, sz, sz);
  }
}

function _drawPromoterStar(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI / 5) - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    i === 0 ? ctx.moveTo(cx + rad * Math.cos(angle), cy + rad * Math.sin(angle))
            : ctx.lineTo(cx + rad * Math.cos(angle), cy + rad * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fillStyle = "#f0c040"; ctx.fill();
  ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 1; ctx.stroke();
}

function _drawItemInSlot(ctx, item, sx, sy, size) {
  const pad = 4;
  if (isPromoterItem(item)) {
    const half = (size - pad * 2) / 2;
    const fromImg = spriteImages[`${W}_${PAWN}`];
    if (fromImg && fromImg.complete) ctx.drawImage(fromImg, sx + pad, sy + pad, half, half);
    if (promoterTo(item) === PROMOTER_WILD) {
      _drawPromoterStar(ctx, sx + pad + half + half / 2, sy + pad + half + half / 2, half * 0.42);
    } else {
      const toImg = spriteImages[`${W}_${promoterTo(item)}`];
      if (toImg && toImg.complete) ctx.drawImage(toImg, sx + pad + half, sy + pad + half, half, half);
    }
    ctx.fillStyle = "#ffdd88";
    ctx.font = `bold ${Math.floor(size * 0.22)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("→", sx + size / 2, sy + size / 2);
  } else if (isElementalizerItem(item)) {
    const elem = elemFromItem(item, false);
    const color = item === ITEM_ELEM_MYSTERY ? '#cc88ff' : ELEM_COLORS[elem];
    const cx2 = sx + size / 2, cy2 = sy + size / 2, r = (size - pad * 2) / 2;
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    const letter = item === ITEM_ELEM_MYSTERY ? '?' : ELEM_NAMES[elem][0];
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(size * 0.45)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    ctx.fillText(letter, cx2, cy2);
    ctx.shadowBlur = 0;
  } else if (item === ITEM_REWINDER) {
    const cx2 = sx + size / 2, cy2 = sy + size / 2, r = (size - pad * 2) / 2;
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
    ctx.fillStyle = '#6a2a9a'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.floor(size * 0.52)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    ctx.fillText('↺', cx2, cy2 + size * 0.04);
    ctx.shadowBlur = 0;
  } else if (item === ITEM_VAMPIRE_FANG) {
    const cx2 = sx + size / 2, cy2 = sy + size / 2, r = (size - pad * 2) / 2;
    ctx.beginPath(); ctx.arc(cx2, cy2, r, 0, Math.PI * 2);
    ctx.fillStyle = '#8b0000'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2; ctx.stroke();
    // Two white fangs
    const fw = r * 0.32, fh = r * 0.85, gap = r * 0.12, fy = cy2 - r * 0.25;
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3;
    for (const fx of [cx2 - gap / 2 - fw, cx2 + gap / 2]) {
      ctx.beginPath();
      ctx.arc(fx + fw / 2, fy, fw / 2, Math.PI, 0); // rounded top
      ctx.lineTo(fx + fw / 2, fy + fh);              // right side to tip
      ctx.lineTo(fx, fy);                             // left side back up
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  } else {
    const img = spriteImages[ITEM_SPRITE_KEYS[item]];
    if (img && img.complete) ctx.drawImage(img, sx + pad, sy + pad, size - pad * 2, size - pad * 2);
  }
}

function drawInventoryPanel() {
// Inventory panel
const invY = INV_PANEL_TOP + 50;
ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 16; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 6;
ctx.fillStyle = "#2a2a4e";
ctx.beginPath();
ctx.roundRect(INV_X, invY - 50, INV_W, INV_ROWS * (INV_SLOT + INV_PAD) + INV_PAD + 58, 8);
ctx.fill();
ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
ctx.strokeStyle = "#5a5a8e";
ctx.lineWidth = 3;
ctx.stroke();
const invStatus = sellMode ? "Select an item to sell" : piecePromoterMode ? `Select a Pawn to promote to ${PIECE_NAMES[piecePromoterTo] || "?"}` : clonerMode ? (clonerSelected >= 0 ? "Select adjacent empty space" : "Select a piece to clone") : shieldMode ? "Select a piece to shield" : teleporterMode ? (teleporterSelected >= 0 ? "Select destination" : "Select a piece to teleport") : bombMode ? "Select blast center" : elementizerMode ? `Select a piece to apply ${elementizerMystery ? "Mystery" : ELEM_NAMES[elementizerElem]} element` : "";
ctx.fillStyle = invStatus ? "#ffdd88" : "#fff";
ctx.font = "42px Canterbury";
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.fillText(invStatus || "Inventory", INV_X + INV_W / 2, invY - 25);
for (let r = 0; r < INV_ROWS; r++) {
  for (let c = 0; c < INV_COLS; c++) {
    const slotIdx = r * INV_COLS + c;
    const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
    const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
    const isActive = isItemActive() && inventory._activeSlot === slotIdx; // any item mode (was missing Sword/Speed/Bomb/etc.)
    ctx.fillStyle = isActive ? "#4a3a1e" : "#1a1a3e";
    ctx.beginPath();
    ctx.roundRect(sx, sy, INV_SLOT, INV_SLOT, 4);
    ctx.fill();
    if (isActive) {
      ctx.strokeStyle = "#e8a735";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (dragSlot !== slotIdx && inventory[slotIdx] !== ITEM_NONE && !itemFlySlots.has(slotIdx)) {
      _drawItemInSlot(ctx, inventory[slotIdx], sx, sy, INV_SLOT);
    }
  }
}



// Floating drag item
if (dragSlot >= 0 && inventory[dragSlot] !== ITEM_NONE) {
  const item = inventory[dragSlot];
  const ds = INV_SLOT;
  _drawItemInSlot(ctx, item, dragX - ds / 2, dragY - ds / 2, ds);
}
}

function drawActionButtons() {
// Buttons
ctx.font = "42px Canterbury";
ctx.textAlign = "center";
ctx.textBaseline = "middle";

if (!gameOver && isItemActive()) {
  // Cancel and Trash buttons replace all other controls while an item is being used
  const halfW = BOARD_PX / 2 - BTN_GAP / 2;
  const btnH = 80;
  // Cancel (X)
  _registerBtn(MARGIN, BTN_Y, halfW, btnH, 8);
  ctx.fillStyle = "#5a2a2a";
  ctx.beginPath(); ctx.roundRect(MARGIN, BTN_Y, halfW, btnH, 8); ctx.fill();
  ctx.fillStyle = "#ff8888";
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("✕  Cancel", MARGIN + halfW / 2, BTN_Y + btnH / 2);
  // Trash
  _registerBtn(MARGIN + BOARD_PX / 2 + BTN_GAP / 2, BTN_Y, halfW, btnH, 8);
  ctx.fillStyle = "#2a2a2a";
  ctx.beginPath(); ctx.roundRect(MARGIN + BOARD_PX / 2 + BTN_GAP / 2, BTN_Y, halfW, btnH, 8); ctx.fill();
  ctx.fillStyle = "#aaa";
  ctx.fillText("🗑  Discard", MARGIN + BOARD_PX / 2 + BTN_GAP / 2 + halfW / 2, BTN_Y + btnH / 2);
} else if (!gameOver && gamePhase === 'setup') {
  // Rows: [Classic | Roll] / [Untimed | Timed] / [Go]. 15s is the only timed option.
  const _drawSetupBtn = (btn, color, label, opts) =>
    drawUIButton(btn, { color, label, radius: 6, font: "42px Canterbury",
      textColor: (opts && opts.textColor) || "#fff", stroke: (opts && opts.border) || null, strokeW: 3 });
  _drawSetupBtn(CLASSIC_BTN, "#b8912e", "Classic");
  _drawSetupBtn(SETUP_ROLL_BTN, "#4a3a7a", "🎲 Roll");
  _drawSetupBtn(UNTIMED_BTN, !timedMode ? "#1a5a8a" : "#33334d", "Untimed",
    !timedMode ? { border: "#6ab0e0" } : { textColor: "#9a9ab0" });
  _drawSetupBtn(TIMED_BTN, timedMode ? "#1a5a8a" : "#33334d", "⏱ Timed 15s",
    timedMode ? { border: "#6ab0e0" } : { textColor: "#9a9ab0" });
  _drawSetupBtn(SETUP_GO_BTN, "#2a6e3f", "▶ Go!");
  // Back to main menu
  drawUIButton(SETUP_BACK_BTN, { color: "#4a3a7a", label: "‹ Back", radius: 6, font: "40px Canterbury" });
  ctx.textBaseline = "alphabetic";
} else if (!gameOver && gamePhase === 'playing') {
  const shiftUrgent = shiftCountdown <= 3;
  if (!replayMode || _miniReplayActive) {
    // Team Leap
    const canLeap = canTeamLeap();
    drawUIButton(LEAP_BTN, { color: canLeap ? LEAP_BTN_COLOR : LEAP_BTN_DISABLED, label: "Team Advance",
      radius: 6, font: "42px Canterbury", textColor: canLeap ? "#fff" : "#999" });

    // Pitch Shift
    const canShift = canManualPitchShift();
    const shiftHighlight = hintMove === "leap";
    drawUIButton(PITCH_BTN, {
      color: shiftHighlight ? "#e8a735" : (shiftUrgent ? "#8a1a1a" : (canShift ? "#1a5a8a" : LEAP_BTN_DISABLED)),
      label: "Field Advance", radius: 6, font: "42px Canterbury", textColor: canShift ? "#fff" : "#999" });
  }
  // Auto-advance countdown — flush under inventory in replay, normal position otherwise
  const cdY = (replayMode && !_miniReplayActive) ? INV_PANEL_BOTTOM + 44 : COUNTDOWN_Y;
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center";
  const cdText = `Field Auto-Advances In ${shiftCountdown} ${shiftCountdown === 1 ? 'Turn' : 'Turns'}`;
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = shiftUrgent ? "#ff6666" : "#88bbff";
  ctx.fillText(cdText, MARGIN + BOARD_PX / 2, cdY);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  if (!replayMode || _miniReplayActive) {
    // Resign
    drawUIButton(RESIGN_BTN, { color: "#993333", label: "Resign", radius: 6, font: "42px Canterbury" });

    // Auto-play toggle button
    drawUIButton(AUTO_BTN, { color: autoPlay ? "#1a7a3a" : "#444466", label: autoPlay ? "⏸ Auto" : "▶ Auto", radius: 6, font: "42px Canterbury" });

    // Last Move replay button
    if (replaySnapshots.length > 1) {
      drawUIButton(LAST_MOVE_BTN, { color: "#1a4a7a", label: "⟳ Last Move", radius: 6, font: "42px Canterbury" });
    }
  }
}
}

function drawGameOverOverlay() {
// Game over overlay
if (gameOver && !replayMode) {
  const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(MARGIN, BOARD_Y + MARGIN, BOARD_PX, BOARD_PX);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "82px Canterbury";
  ctx.fillStyle = "#cc1111";
  ctx.fillText("Game Over", boardCX, boardCY - 40);
  ctx.font = "82px Canterbury";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(`Taken Kings: ${score}`, boardCX, boardCY + 60);
  const L = _gameOverBtns();
  const fillBtn = (r, color, label) => drawUIButton(r, { color, label, font: "44px Canterbury" });
  // Submit-to-leaderboard button (only for eligible runs). During naming the HTML input
  // covers this rect (its "Your name" placeholder is the label), so draw nothing then.
  if (L.eligible && _lbSubmitState !== 'naming') {
    const st = _lbSubmitState;
    const col = st === 'done' ? "#2a8f4f" : st === 'error' ? "#8a2a2a" : st === 'submitting' ? "#444" : "#b8912e";
    const label = st === 'done' ? "✓ Submitted" : st === 'submitting' ? "Submitting…" : st === 'error' ? "Retry Submit" : "Submit to Leaderboard";
    fillBtn(L.submit, col, label);
  }
  fillBtn(L.startOver, "#2a6e3f", "Start Over");
  fillBtn(L.replay, replaySnapshots.length > 0 ? "#1a4a8a" : "#333", "Replay");
  // A failed submit gets a prominent red banner so it's never mistaken for success (the button
  // also flips to red "Retry Submit"). A ranked-but-mismatched score gets an amber banner (the
  // submission landed, but at the server's re-simulated value — a logged determinism bug).
  // Plain success needs no text — the "✓ Submitted" label says it.
  if (L.eligible && (_lbSubmitState === 'error' || _lbSubmitWarn) && _lbSubmitMsg) {
    const isWarn = _lbSubmitState !== 'error';
    const msgY = L.startOver.y + L.startOver.h + 44;
    const txt = "⚠ " + _lbSubmitMsg;
    ctx.font = "30px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const pillW = Math.min(ctx.measureText(txt).width + 44, BOARD_PX - 16);
    ctx.fillStyle = isWarn ? "rgba(96,68,10,0.94)" : "rgba(90,18,18,0.94)";
    ctx.beginPath(); ctx.roundRect(boardCX - pillW / 2, msgY - 27, pillW, 54, 12); ctx.fill();
    ctx.strokeStyle = isWarn ? "rgba(255,200,90,0.55)" : "rgba(255,110,110,0.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(boardCX - pillW / 2, msgY - 27, pillW, 54, 12); ctx.stroke();
    ctx.fillStyle = isWarn ? "#ffe9b8" : "#ffd2d2";
    ctx.fillText(txt, boardCX, msgY);
  }
  ctx.textBaseline = "alphabetic";
}
}

function drawReplayControls() {
if (replayMode && !_miniReplayActive) {
  // Replay nav controls — placed right below the countdown label
  const ctrlX = MARGIN, ctrlY = INV_PANEL_BOTTOM + 90;
  const ctrlW = BOARD_PX, ctrlH = 130;
  ctx.fillStyle = "rgba(10,10,40,0.93)";
  ctx.beginPath(); ctx.roundRect(ctrlX, ctrlY, ctrlW, ctrlH, 10); ctx.fill();
  const midX = ctrlX + ctrlW / 2;
  const rowY1 = ctrlY + 28;
  // Step label
  ctx.font = "30px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#aac";
  ctx.fillText(`Step ${replayIdx + 1} of ${replaySnapshots.length}`, midX, rowY1);
  // Buttons row
  const bW = 140, bH = 52, bGap = 14;
  const totalBW = 4 * bW + 3 * bGap;
  let bx = midX - totalBW / 2;
  const by = ctrlY + ctrlH - bH - 14;
  const btns = [
    { label: "◀ Prev", id: 'prev', enabled: replayIdx > 0, color: "#334" },
    { label: "Next ▶", id: 'next', enabled: replayIdx < replaySnapshots.length - 1, color: "#334" },
    { label: replayAutoPlay ? "⏸ Pause" : "▶ Auto", id: 'auto', enabled: true, color: "#1a4a8a" },
    { label: "✕ Exit", id: 'exit', enabled: true, color: "#5a1a1a" },
  ];
  ctx.font = "32px Canterbury";
  for (const btn of btns) {
    _registerBtn(bx, by, bW, bH, 8);
    ctx.fillStyle = btn.enabled ? btn.color : "#222";
    ctx.beginPath(); ctx.roundRect(bx, by, bW, bH, 8); ctx.fill();
    ctx.fillStyle = btn.enabled ? "#fff" : "#555";
    ctx.fillText(btn.label, bx + bW / 2, by + bH / 2);
    bx += bW + bGap;
  }
}
}

// The White King's dialogue box — occupies the strip where the Fallen/Slain panels used to be.
// Portrait on the left, his current remark on the right. _kingRemark holds the text to show.
// ── White King commentary ─────────────────────────────────────────────────────────────────────
// The King reacts to what happens on the board. To author his lines, just fill the arrays below —
// each key is a SITUATION, and when that situation fires a random line from its array is shown (never
// repeating the immediately-previous one). Leave an array empty and he stays silent for that case.
// When two situations land close together, _KING_PRI decides who wins: a bigger moment (higher number)
// won't be stomped by a smaller one while it's still on screen (for KING_HOLD_MS).
const KING_LINES = {
  start:         ["Behold! The monsters who took our kingdom and burned our homes! Let us come upon them as a fire of judgment!"],  // a new run begins (after Go / the Begin Conquest intro)
  firstMove:     ["There is but the first of the Black Kings before us, marching on like ants. Only ants have more of a mind. This one shall be first of many to fall."],  // after the player's 1st turn
  // secondMove is DYNAMIC (built from the army composition) — see _kingSecondMoveLine(); no pool here.
  tookKing:      [],  // took a Black King this turn
  tookKingMulti: [],  // took 2+ Black Kings in a single turn
  king10:        [],  // reached 10 Taken Kings
  king20:        [],  // reached 20 Taken Kings
  king25:        [],  // reached 25 Taken Kings
  lostPiece:     [],  // a White warrior fell
  recruit:       [],  // recruited a Grey to the cause
  killGrey:      ["Lo, I wish we could have taken a different path together, Grey, but this was not to be."],  // struck down a Grey (non-King)
  fieldAdvance:  [],  // the field advanced — a fresh wave rolls in
  teamAdvance:   [],  // ordered a Team Advance
  kingDanger:    [],  // the player's turn begins with the White King under threat
  idle:          [ // occasional chatter when nothing else is happening ("On any random turn")
    "The Team Advance is a tactic handed down by my fathers. By it, the whole army may progress together, one step at a time.",
    "The Field Advance is a necessary notion of war to continue onward. If anybody gets left behind, it is the price that must be paid.",
    "If I hadn't gone on that cursed diplomatic mission, we might have prevented the Black Kings from committing their bloodshed!",
    "I can't believe the rumors seem to be true: that the kings of the far lands allied against a friendly neighbor to take his resources unjustly. And thus this curse fell upon them!",
    "These Black Kings -- all they have left is to ravage and destroy! It consumes them!",
    "The further we tear through these murderers, the stronger they seem to get! Truly this cursed magic is strong...",
  ],
  gameOver:      [],  // defeat
  // ── One-shot "first sighting" lines (fire once per run; see _kingQueueFirst) ──
  firstFieldAdvance:      ["Ah, this Black King has a Warrior with him, also blackened by this curse. Perhaps they also drank the cup of their master's greed."],
  firstWCheckersMove:     ["Man of Checkers, your kind defies fathomage, but we welcome your service!"],
  firstWCheckersKingMove: ["King of Checkers, you are of most alien lineage, but a King knows a King! Your alliance is appreciated!"],
  firstBCheckers:         ["Even the strange Men of Checkers are among their number!"],
  firstBCheckersKing:     ["Even the states of Checkers were corrupted! O Checkers King, your path shames your kind!"],
  firstShadow:            ["Observe that shadow! Who knows what befalls us!"],
  firstItemFall:          ["Indeed, these Black Kings bring a magic into the air. Odd spells fall from the sky."],
  // ── Capture reactions, keyed by the WHITE piece that took a Black warrior (non-King victims) ──
  capPawn:         ["Good on you, little one! Your vigor is noble!"],
  capRook:         ["The smasher smashes! Good kill, Rook!"],
  capBishop:       ["O seer, have you not indeed seen our enemy fall!"],
  capKnight:       ["Yes, rider! And so we ride to victory!"],
  capKing:         ["A White King does not sit idle on his throne when his people are so ravaged!"],
  capQueen:        ["Is a kingdom not blessed to have such a warrior as Queen!"],
  capCheckers:     ["Even your martial moves are strange, foreign one, but I am no less grateful for them!"],
  capCheckersKing: ["Foreign King, I do not understand your form, but your strength is seen!"],
  // ── First Grey sighting (one-shot) ──
  firstGrey: ["Behold, the Grey Warrior, whose curse falters at conviction! If I speak to them, perhaps they may be saved. Otherwise, they shall fall with the others!"],
  // ── Recruit reactions, keyed by the Grey piece a White King just won over ──
  recruitPawn:         ["Another little one joins our cause! Every blade matters!"],
  recruitRook:         ["Another Rook to join our force, and a force they are indeed!"],
  recruitBishop:       ["Come, Bishop! March with us on the path of light!"],
  recruitKnight:       ["Turn your mount, Knight! Ride with us!"],
  recruitQueen:        ["It is a very hard thing that you should turn, Queen, but your blades are most welcome!"],
  recruitKing:         ["Ah, there is still honor amongst Kings here! Restore your honor!"],
  recruitCheckers:     ["O Man of Checkers, were your fathers not immigrants from afar? Likewise, seek a new banner, our banner of honor!"],
  recruitCheckersKing: ["Our kingdoms may be different, but ally yourself with us, King of Checkers!"],
  // ── Features / hazards first coming into play (one-shot) ──
  firstChest:       ["The Black Kings carry with them treasures of fallen magics. This shall only serve as plunder for my men!"],
  firstMerchant:    ["Who is that strange man? He does not appear a part of the dark party. Perhaps one of my men could speak to him."],
  firstVoid:        ["The dark magics wafting off these Kings is even eating at the very world itself. Lo, let us beware these Voids in the dirt."],
  firstBlock:       ["Behold, that Block of stone -- no Warrior's blade could pierce that. Unless they partook of a magic of the Earth itself..."],
  firstRiver:       ["Beware the currents of that River, men! Adjust your course or they will adjust it for you!"],
  firstAutoAdvance: ["My patience has its limits! We cannot linger here forever, or the Black Kings will never pay their dues!"],
  firstShop:        ["Oh, what a clever man, selling these fallen magics! Surely these Black kings have no mind for business. But I will surely take advantage..."],
  // Merchant shop reopened — rotating chatter; a second variant naming a current ware is built live (_kingSayShop).
  shopReopen:       ["This seller appears to update his wares every once in a while. If I like something I see here, I better grab it quick."],
  // A White Warrior lost to a Bomb.
  bombDeath:        ["Stricken by the power of the Bomb! Let us do better to respect it in the future!"],
  // Down to the last King (oneLeft is a pool; twoLeft is dynamic — built with the companion's name, no pool).
  oneLeft:          ["All my men... gone. So be it. My honor demands fighting till the end!"],
};
const _KING_PRI = {
  gameOver: 100, king25: 70, king20: 70, king10: 70, tookKingMulti: 60, tookKing: 50,
  firstMove: 50, secondMove: 50,
  kingDanger: 45, lostPiece: 40,
  firstFieldAdvance: 30, firstWCheckersMove: 30, firstWCheckersKingMove: 30,
  firstBCheckers: 30, firstBCheckersKing: 30, firstShadow: 30, firstItemFall: 30, firstGrey: 30,
  killGrey: 25, recruit: 25,
  oneLeft: 55, bombDeath: 40, twoLeft: 40, voidDeath: 40,
  firstChest: 30, firstMerchant: 30, firstVoid: 30, firstBlock: 30, firstRiver: 30, firstAutoAdvance: 30, firstShop: 30,
  shopReopen: 5,
  recruitPawn: 25, recruitRook: 25, recruitBishop: 25, recruitKnight: 25, recruitQueen: 25,
  recruitKing: 25, recruitCheckers: 25, recruitCheckersKing: 25,
  capPawn: 20, capRook: 20, capBishop: 20, capKnight: 20, capQueen: 20, capKing: 20,
  capCheckers: 20, capCheckersKing: 20,
  fieldAdvance: 15, teamAdvance: 15,
  start: 10, inspect: 5, idle: 1,
};
// Which capture line each White piece type speaks (victim must be a non-King Black warrior —
// King takes are the tookKing/king10/20/25 family's turf).
const _KING_CAP_KEY = {
  [PAWN]: 'capPawn', [ROOK]: 'capRook', [BISHOP]: 'capBishop', [KNIGHT]: 'capKnight',
  [QUEEN]: 'capQueen', [KING]: 'capKing', [CHECKERS]: 'capCheckers', [CHECKERS_KING]: 'capCheckersKing',
};
// Which recruit line each Grey piece type earns when a White King wins it over.
const _KING_RECRUIT_KEY = {
  [PAWN]: 'recruitPawn', [ROOK]: 'recruitRook', [BISHOP]: 'recruitBishop', [KNIGHT]: 'recruitKnight',
  [QUEEN]: 'recruitQueen', [KING]: 'recruitKing', [CHECKERS]: 'recruitCheckers', [CHECKERS_KING]: 'recruitCheckersKing',
};
let _kingRemark = "";        // current line shown in the dialogue box ('' = just the portrait)
let _kingRemarkPri = 0;      // priority of the current line
let _kingRemarkMs = 0;       // performance.now() when it was set
let _kingPage = 0;           // which page of a long remark is showing (tap the box's arrow to advance)
let _kingDialogPages = 1;    // total pages the current remark spans (set during draw)
let _kingDialogRect = null;  // {x,y,w,h} of the dialogue box (set during draw) for tap hit-testing
let _kingTurnNum = 0;        // White turns completed this run — drives the firstMove/secondMove lines
let _kingLastMovedType = NONE; // type of the player's most recent piece MOVE (NONE after an Advance) — the second-move line's subject
const _kingLastIdx = {};     // last line index shown per key — avoids back-to-back repeats
const KING_HOLD_MS = 3800;   // a line holds at least this long before a LOWER-priority line may replace it

// Set the remark to an explicit line at a given priority (respecting the hold/priority rule).
function _kingSetRemark(text, pri) {
  if (!text) return;
  if (_kingRemark && pri < _kingRemarkPri && (performance.now() - _kingRemarkMs) < KING_HOLD_MS) return;
  _kingRemark = text; _kingRemarkPri = pri; _kingRemarkMs = performance.now(); _kingPage = 0; // new line → back to page 1
}
// Fire the King's reaction to a situation. Live play only (no-op in headless re-sim / replay).
function _kingSay(key) {
  if (_instant || replayMode) return;
  const pool = KING_LINES[key];
  if (!pool || pool.length === 0) return;                  // no lines authored yet → stay silent
  let idx = Math.floor(Math.random() * pool.length);
  if (pool.length > 1 && idx === _kingLastIdx[key]) idx = (idx + 1) % pool.length; // no immediate repeat
  _kingLastIdx[key] = idx;
  _kingSetRemark(pool[idx], _KING_PRI[key] || 0);
}
// ── Per-turn candidate roll ── Events don't speak immediately; they queue a situation key, and at
// the next flush point (end of the player's turn / control returning to the player) ONE queued
// situation is chosen uniformly at random — so a busy turn rolls among its comments instead of the
// last event always talking over the rest. Commentary is cosmetic and live-only: uses Math.random
// (never the gameplay RNG) and no-ops in headless re-sim/replay.
let _kingCand = [];       // situation keys queued since the last flush
const _kingFirsts = {};   // one-shot situations that have already fired this run
function _kingQueue(key) {
  if (_instant || replayMode) return;
  if (!_kingCand.includes(key)) _kingCand.push(key);
}
// One-shot variant: the first occurrence queues the line; every later occurrence is silent.
// The flag is set even if the pool is empty — "first" means the event happened, not that he spoke.
function _kingQueueFirst(key) {
  if (_instant || replayMode || _kingFirsts[key]) return;
  _kingFirsts[key] = true;
  _kingQueue(key);
}
function _kingFlush() {
  if (_kingCand.length === 0) return;
  const speakable = _kingCand.filter(k => (KING_LINES[k] || []).length > 0);
  _kingCand = [];
  if (speakable.length) _kingSay(speakable[(Math.random() * speakable.length) | 0]);
}
// Display name of a piece type for the King's lines ("Knight", "Checkers King").
function _kingPieceName(p) {
  return { [PAWN]: 'Pawn', [ROOK]: 'Rook', [KNIGHT]: 'Knight', [BISHOP]: 'Bishop', [QUEEN]: 'Queen',
    [KING]: 'King', [CHECKERS]: 'Checkers Man', [CHECKERS_KING]: 'Checkers King' }[p] || 'Warrior';
}
// A White Warrior fell into a Void — mourn it by name (live-only; the [piece] line is dynamic).
function _kingSayVoidDeath(piece) {
  if (_instant || replayMode) return;
  _kingSetRemark(`What a tragic end, ${_kingPieceName(piece)}! Oh, to fall not by the blade of an enemy, but by... falling!`, _KING_PRI.voidDeath || 40);
}
// Merchant shop opened: a one-shot intro the first time, then rotating chatter — one variant names a
// current ware (built live from shopOffers, so it can't live in a static pool).
function _kingSayShop() {
  if (_instant || replayMode) return;
  if (!_kingFirsts._shop) { _kingFirsts._shop = true; _kingSay('firstShop'); return; }
  const offers = (shopOffers || []).filter(x => x != null && x !== ITEM_NONE);
  if (offers.length && Math.random() < 0.5) {
    const nm = itemName(offers[(Math.random() * offers.length) | 0]);
    const article = /^[aeiou]/i.test(nm) ? 'an' : 'a';
    _kingSetRemark(`Ooh, ${article} ${nm}! That could be very handy!`, _KING_PRI.shopReopen || 5);
  } else {
    _kingSay('shopReopen');
  }
}
// ── Tap-to-inspect authored descriptions ─────────────────────────────────────
const _COLOR_WORD = { [W]: 'White', [B]: 'Black', [N]: 'Grey' };
// The remark for each standard piece, following "This is a {Color} {mods}{Name}".
const _PIECE_DESC = {
  [PAWN]:   ", the least experienced unit. Pawns can't move far, but their diagonal attacks mean they can form defensive pyramids.",
  [ROOK]:   ". He likes to move in straight lines to smash his opponents.",
  [BISHOP]: ". They are oracles of war, and they only move at diagonal angles.",
  [KNIGHT]: ". They ride upon their mighty horses, which leap at strange angles. They can confront foes from positions no one else can.",
  [QUEEN]:  ". She is well trained in all manner of movement and can dominate the field with her tactical options.",
};
// Appended to a standard-piece line based on the warrior's allegiance.
const _COLOR_APPEND = {
  [W]: " They are loyal to me and the cause of taking these Black Kings for judgment.",
  [B]: " They are loyal to the Black Kings, darkened also by their masters' greed, and they shall fall alongside them.",
  [N]: " Their curse falters at some remnant of honor within them. They do not seem ready to attack. Perhaps a word from myself might change the heart.",
};
// Appended to any burning Warrior's inspect line (board only — burning is a board state).
const _BURNING_APPEND = {
  white: " They are alight! Let us get them to Water quickly!",
  black: " They are engulfed in flames! Let them be eaten by their tongues!",
};
// One clause per effect the highlighted Warrior carries, appended after the loyalty line (keyed by the
// effect badge names, so elements reuse _ELEM_BADGE). Stacked in mods order: element, shield, mighty, fast, bt.
const _EFFECT_DESC = {
  fire:  " This Warrior is imbued with Fire magic. They leave a burning trail wherever they go. They may pass through Fire unharmed.",
  water: " This Warrior is imbued with Water magic. Rivers spring from the ground upon their step. They may pass through Fire safely.",
  earth: " This Warrior is imbued with Earth magic. Blocks of Earth form in their wake. They also may destroy Blocks by landing on them.",
  air:   " This Warrior is imbued with Air magic. They may pass through all objects.",
  shielded:     " This Warrior has extra shielding. Unless a Mighty Warrior strikes them, this shield will take any blow.",
  mighty:       " This Warrior wields a might above others. They may strike a Shielded foe and take them at once.",
  fast:         " This Warrior possesses a blinding speed, able to move two steps for each one of their comrades.",
  bloodthirsty: " This Warrior has a hunger in their eyes for the blood of their enemies. Upon taking a foe, they are reinvigorated to move again.",
};
function _effectAppends(element, hlth, atk, spd, status) {
  let s = '';
  for (const e of ELEM_ALL) if (element & e) { s += _EFFECT_DESC[_ELEM_BADGE[e]]; break; }
  if (hlth >= 2) s += _EFFECT_DESC.shielded;
  if (atk >= 2) s += _EFFECT_DESC.mighty;
  if (spd >= 2) s += _EFFECT_DESC.fast;
  if (status & STATUS_BLOODTHIRSTY) s += _EFFECT_DESC.bloodthirsty;
  return s;
}
const _KING_INSPECT_LINES = {
  whiteSolo:  "That is myself! The White King. I am not as mighty as my loyal guardsmen, but I have freedom of movement and can support an assault from any angle. However, if I am taken, our conquest fails.",
  whiteClone: "That is a White King. Is it myself? Cloning magic is mysterious. I have not the mind to ponder such lofty things.",
  black:      "That is a Black King, one of those responsible for the ruin of my people. They move as I do, one square in any direction. Taking them is the cause of our conquest!",
  grey:       "That is a Grey King. One of the foul ones, but it seems they yet wrestle with the darkness. Perhaps diplomacy might prevail there.",
};
const _TERRAIN_DESC = {
  empty:      "No one's here.",
  void:       "A strange hole in the world, a Void. The magic of the Black Kings tears at all that is seen. They can be safely passed over, but landing on one is certain death.",
  block:      "A Block of condensed dark magic. It prevents all passage except for those maybe of the magics of Air or Earth.",
  tempBlock:  "An Earth Warrior has manifested a Block here. It should disappear in short order, though.",
  whiteFire:  "Literally friendly Fire, on account of one of our own Fire Warriors. We may pass through safely, but a Black passerby will soon meet a terrible end.",
  blackFire:  "Burning flames a la a Black Fire Warrior. Avoid at all cost, unless there is Water nearby to stop the burning.",
  river:      "A flowing River. Its currents can drag units and items alike.",
  tempRiverAppend: " This Water follows a Water Warrior. It shall dry up soon.",
};
// Authored line for a non-Warrior board square: Void/Block/Fire/River terrain, else "No one's here".
// (Merchant/Chest/Item/shadow are handled by the caller — not authored yet.)
function _terrainInspectLine(i) {
  const sp = specialSpaces[i];
  if (sp && sp.type === 'void') return _TERRAIN_DESC.void;
  if (sp && sp.type === 'block') return sp.temp ? _TERRAIN_DESC.tempBlock : _TERRAIN_DESC.block;
  const f = fireSquares.get(i);
  if (f) return f.side === W ? _TERRAIN_DESC.whiteFire : _TERRAIN_DESC.blackFire;
  if (isRiverSpace(i)) return _TERRAIN_DESC.river;
  if (waterTrails.has(i)) return _TERRAIN_DESC.river + _TERRAIN_DESC.tempRiverAppend;
  return _TERRAIN_DESC.empty;
}
function _countWhiteChessKings() { let n = 0; for (let i = 0; i < 64; i++) if (board[i] === KING && sides[i] === W) n++; return n; }
// Buff/element modifier prefix ("Water Shielded ") from a stat set, or '' if none.
function _buffMods(element, hlth, atk, spd, status) {
  const mods = []; // each effect is an adjective in the inspect line
  for (const e of ELEM_ALL) if (element & e) { mods.push(ELEM_NAMES[e] + ' Elemental'); break; } // Fire -> "Fire Elemental"
  if (hlth >= 2) mods.push('Shielded');
  if (atk >= 2) mods.push('Mighty');
  if (spd >= 2) mods.push('Fast');
  if (status & STATUS_BLOODTHIRSTY) mods.push('Bloodthirsty');
  return mods.length ? mods.join(' ') + ' ' : '';
}
// Full authored inspect sentence for a Warrior, or null for pieces with no line yet (Checkers folk) —
// callers fall back to the generic "This is a …" descriptor. `mods` is the _buffMods prefix.
function _pieceInspectLine(piece, side, mods) {
  if (piece === KING) {
    if (side === W) return _countWhiteChessKings() > 1 ? _KING_INSPECT_LINES.whiteClone : _KING_INSPECT_LINES.whiteSolo;
    return side === B ? _KING_INSPECT_LINES.black : _KING_INSPECT_LINES.grey;
  }
  const desc = _PIECE_DESC[piece];
  if (!desc) return null;
  return `This is a ${_COLOR_WORD[side] || 'Grey'} ${mods || ''}${_kingPieceName(piece)}${desc}${_COLOR_APPEND[side] || ''}`;
}
// Name of whatever occupies square i, for the generic tap-to-inspect line (non-Warrior things, and the
// Checkers-folk fallback). Warriors get their authored sentence via _pieceInspectLine instead.
function _squareDescriptor(i) {
  if (board[i] !== NONE) {
    return `${_COLOR_WORD[sides[i]] || 'Grey'} ${_buffMods(elements[i], health[i], attacks[i], speeds[i], statuses[i])}${_kingPieceName(board[i])}`;
  }
  if (i === merchantIdx) return 'Merchant';
  if (chestSpaces.has(i)) return 'Chest';
  if (itemSpaces[i] !== ITEM_NONE) return itemName(itemSpaces[i]);
  if (_shadowSpaces && _shadowSpaces.has(i)) return 'looming shadow';
  const sp = specialSpaces[i];
  if (sp && sp.type === 'void') return 'Void';
  if (sp && sp.type === 'block') return sp.temp ? 'Temporary Block' : 'Block';
  if (isRiverSpace(i)) return 'River';
  if (fireSquares.has(i)) return 'patch of Fire';
  if (waterTrails.has(i)) return 'River current';
  return 'vacant space';
}
// Tap-to-inspect: the King remarks on the square the player tapped. Force-set (bypasses the priority
// hold) so a deliberate tap always responds, but at low priority so real event reactions override it.
// Live-only and RNG-free, so it never perturbs the sim.
function _kingInspect(i) {
  if (_instant || replayMode) return;
  const p = board[i];
  let line;
  if (p !== NONE) {
    line = _pieceInspectLine(p, sides[i], _buffMods(elements[i], health[i], attacks[i], speeds[i], statuses[i])) || `This is a ${_squareDescriptor(i)}`;
    line += _effectAppends(elements[i], health[i], attacks[i], speeds[i], statuses[i]); // a clause per effect
    if (burning[i] > 0) line += (sides[i] === W ? _BURNING_APPEND.white : _BURNING_APPEND.black); // on fire
  } else if (i === merchantIdx || chestSpaces.has(i) || itemSpaces[i] !== ITEM_NONE || (_shadowSpaces && _shadowSpaces.has(i))) {
    line = `This is a ${_squareDescriptor(i)}`; // Merchant / Chest / field Item / shadow — not authored yet
  } else {
    line = _terrainInspectLine(i); // Void / Block / Fire / River terrain, or "No one's here"
  }
  _kingRemark = line;
  _kingRemarkPri = _KING_PRI.inspect || 5;
  _kingRemarkMs = performance.now(); _kingPage = 0;
}
// Same, for an inventory item the player just selected. An item selection isn't a board square, so
// it also drops the board/preview marker rings.
function _kingInspectItem(item) {
  if (_instant || replayMode || item === ITEM_NONE) return;
  _inspectIdx = -1; _inspectPreviewCol = -1;
  _kingRemark = `This is a ${itemName(item)}`; // placeholder text — author real descriptions later
  _kingRemarkPri = _KING_PRI.inspect || 5;
  _kingRemarkMs = performance.now(); _kingPage = 0;
}
// Name of whatever is incoming in the fog (preview) row at column `col`: a Black Warrior (with its
// rolled element/buffs), the queued Merchant, or a bonus (Chest/Item/Void/Block/River/Grey), else fog.
function _previewDescriptor(col) {
  const w = nextWave.find(w => w.x === col);
  if (w) { const e = w.eff || {}; return `Black ${_buffMods(e.element || 0, e.hlth || 1, e.atk || 1, e.spd || 1, e.status || 0)}${_kingPieceName(w.piece)}`; }
  if (merchantQueued && merchantQueuedCol === col) return 'Merchant';
  const b = nextBonuses.find(b => b.col === col);
  if (b) {
    if (b.type === 'chest') return 'Chest';
    if (b.type === 'item') return itemName(b.item);
    if (b.type === 'void') return 'Void';
    if (b.type === 'block') return 'Block';
    if (b.type === 'river') return 'River';
    if (b.type === 'grey') return `Grey ${_kingPieceName(b.piece)}`;
  }
  return 'fog';
}
// Tap-to-inspect for the fog (preview) row above the board.
function _kingInspectPreview(col) {
  if (_instant || replayMode) return;
  _inspectIdx = -1;
  const w = nextWave.find(w => w.x === col);
  const grey = !w && nextBonuses.find(b => b.col === col && b.type === 'grey');
  const src = w || grey; // an incoming Warrior (Black wave piece, or a Grey spawn) gets its authored line
  let line = null;
  if (src) { const e = src.eff || {}; line = _pieceInspectLine(src.piece, w ? B : N, _buffMods(e.element || 0, e.hlth || 1, e.atk || 1, e.spd || 1, e.status || 0)); }
  if (!line) {
    const b = nextBonuses.find(b => b.col === col);
    if (b && b.type === 'void') line = _TERRAIN_DESC.void;               // incoming terrain shares the terrain lines
    else if (b && b.type === 'block') line = _TERRAIN_DESC.block;        // spawned blocks are permanent
    else if (b && b.type === 'river') line = _TERRAIN_DESC.river;
    else if (merchantQueued && merchantQueuedCol === col) line = `This is a Merchant`; // not authored yet
    else if (b && b.type === 'chest') line = `This is a Chest`;
    else if (b && b.type === 'item') line = `This is a ${itemName(b.item)}`;
    else line = _TERRAIN_DESC.empty; // empty fog
  }
  _kingRemark = line;
  _kingRemarkPri = _KING_PRI.inspect || 5;
  _kingRemarkMs = performance.now(); _kingPage = 0;
}
// Spell a small count as words ("one", "two", …). Falls back to the numeral past 99 (absurd armies).
function _numWord(n) {
  const ones = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve',
    'thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  if (n < 0 || n > 99) return String(n);
  if (n < 20) return ones[n];
  return tens[(n / 10) | 0] + (n % 10 ? '-' + ones[n % 10] : '');
}
// Second-move rally — built LIVE from the current White army: one line per piece type the player
// fields, with the count (spelled out) and pluralization filled in. Queen has singular/clone variants;
// the King line only applies when the player commands clones (>1 King). If preferType names a piece the
// player just moved and it has a line, that one is used; otherwise a random applicable line is rolled.
function _kingSecondMoveLine(preferType) {
  const cnt = { [PAWN]: 0, [ROOK]: 0, [BISHOP]: 0, [KNIGHT]: 0, [QUEEN]: 0, [KING]: 0 };
  for (let i = 0; i < 64; i++) if (sides[i] === W && cnt[board[i]] !== undefined) cnt[board[i]]++;
  const lead = "Let our blades taste wicked blood, White Warriors! ", s = n => n > 1 ? 's' : '', w = _numWord;
  const byType = {};
  if (cnt[PAWN])   byType[PAWN]   = `${lead}My ${w(cnt[PAWN])} Pawn${s(cnt[PAWN])}, your training may be incomplete, but do not falter. For now is the true test of your hearts!`;
  if (cnt[ROOK])   byType[ROOK]   = `${lead}My ${w(cnt[ROOK])} Rook${s(cnt[ROOK])}, you who stand like a fortress, stand now for retribution!`;
  if (cnt[BISHOP]) byType[BISHOP] = `${lead}My ${w(cnt[BISHOP])} Bishop${s(cnt[BISHOP])}, sayers of victory, cry out now and take up your rod of justice!`;
  if (cnt[KNIGHT]) byType[KNIGHT] = `${lead}My ${w(cnt[KNIGHT])} Knight${s(cnt[KNIGHT])}, grand horsemaster${s(cnt[KNIGHT])}, let the hooves beneath you trample these beasts!!`;
  if (cnt[QUEEN] === 1) byType[QUEEN] = `${lead}My Queen, surely the most elite swordmaster among us, let your poise be an agent of punishment!`;
  else if (cnt[QUEEN] > 1) byType[QUEEN] = `${lead}My Queen and her ${w(cnt[QUEEN] - 1)} clone${s(cnt[QUEEN] - 1)}... one of you makes the heart of any army glad, surely the lot of you are an army unto yourselves!`;
  if (cnt[KING] > 1) byType[KING] = `${lead}I and my ${w(cnt[KING] - 1)} clone${s(cnt[KING] - 1)} will not rest till every one of these creatures is taken to their graves!`;
  if (preferType != null && byType[preferType]) return byType[preferType]; // name the piece just moved
  const keys = Object.keys(byType);
  return keys.length ? byType[keys[(Math.random() * keys.length) | 0]] : null;
}
function _kingSaySecondMove() {
  if (_instant || replayMode) return;
  // _kingLastMovedType is the piece the player just moved, or NONE after a Team/Field Advance (→ random).
  _kingSetRemark(_kingSecondMoveLine(_kingLastMovedType), _KING_PRI.secondMove || 0);
}
// Advance the White-turn counter and fire the early-game lines. Called EXACTLY once per completed
// player turn: from endWhiteTurn's normal-end branch (covers piece moves and Team Advance, which flows
// through endWhiteTurn) and from fieldAdvance (which ends the turn itself). Deliberately NOT in
// _turnBoundaryUpdate — Team Advance triggers that twice (its own call + endWhiteTurn's), which was
// double-counting the turn and skipping firstMove straight to the secondMove line.
function _kingCountTurn() {
  _kingFlush(); // roll among this turn's queued comments; the early-game lines below outrank it
  _kingTurnNum++;
  if (_kingTurnNum === 1) _kingSay('firstMove');
  else if (_kingTurnNum === 2) _kingSaySecondMove();
}
// Occasional idle chatter — only once the current line has sat a while, so it never stomps a fresh reaction.
function _kingMaybeIdle() {
  if (_instant || replayMode) return;
  if (_kingRemark && (performance.now() - _kingRemarkMs) < 8000) return;
  if (Math.random() < 0.4) _kingSay('idle');
}
// Called when control returns to the player: flush the enemy-phase comments (first sighting of a
// Black checkers piece, sky shadows/drops), worry aloud if the King is threatened, else maybe chatter.
function _kingOnPlayerTurn() {
  if (_instant || replayMode || gameOver) return;
  let _wCount = 0, _wKings = 0, _wCompanion = NONE;
  for (let i = 0; i < 64; i++) { // first sighting of Black checkers pieces / Greys / hazards, any entry path
    if (sides[i] === B) {
      if (board[i] === CHECKERS) _kingQueueFirst('firstBCheckers');
      else if (board[i] === CHECKERS_KING) _kingQueueFirst('firstBCheckersKing');
    } else if (sides[i] === N && board[i] !== NONE) _kingQueueFirst('firstGrey');
    else if (sides[i] === W) { _wCount++; if (board[i] === KING || board[i] === CHECKERS_KING) _wKings++; else _wCompanion = board[i]; }
    const sp = specialSpaces[i];
    if (sp) {
      if (sp.type === 'void') _kingQueueFirst('firstVoid');
      else if (sp.type === 'block' && !sp.temp) _kingQueueFirst('firstBlock'); // hazard block, not a player's Earth wall
      else if (sp.type === 'river') _kingQueueFirst('firstRiver');
    }
  }
  if (merchantIdx >= 0) _kingQueueFirst('firstMerchant');
  if (chestSpaces && chestSpaces.size > 0) _kingQueueFirst('firstChest');
  _kingFlush();
  const [kx, ky] = findKing(W);
  if (kx >= 0 && isAttacked(kx, ky, W)) _kingSay('kingDanger');
  else _kingMaybeIdle();
  // Dwindling army — one-shot emotional beats (last say, so they win their priority against the above).
  if (_wKings >= 1 && _wCount === 1 && !_kingFirsts._oneLeft) { _kingFirsts._oneLeft = true; _kingSay('oneLeft'); }
  else if (_wCount === 2 && _wCompanion !== NONE && !_kingFirsts._twoLeft) {
    _kingFirsts._twoLeft = true;
    _kingSetRemark(`It's just you and me, ${_kingPieceName(_wCompanion)}! We ride until the darkness takes us!`, _KING_PRI.twoLeft || 40);
  }
}

function drawKingDialogue() {
  // Shown during item-targeting too, so the King's remark on a just-selected item is visible. Its box
  // (COUNTDOWN_Y+30 downward) sits below the item mode's Cancel/Discard buttons — no overlap.
  if (gamePhase !== 'playing' || (replayMode && !_miniReplayActive)) return;
  const x = PLAYER_GRAVE_X, w = ENEMY_GRAVE_X + GRAVE_W - PLAYER_GRAVE_X;
  // Taller box: raise the top to sit just under the "Field Auto-Advances" label; keep the bottom
  // where the graveyard ended so the Resign/Auto buttons below don't shift.
  const y = COUNTDOWN_Y + 30, h = (GRAVE_Y + GRAVE_H) - y;
  ctx.save();
  // Box
  ctx.fillStyle = "rgba(18,14,34,0.85)";
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = "rgba(184,145,46,0.85)";
  ctx.beginPath(); ctx.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 9); ctx.stroke();
  // Portrait (circular, center-cropped so it never stretches)
  const pad = 14, picSz = Math.min(h - pad * 2, 150);
  const pcx = x + pad + picSz / 2, pcy = y + h / 2;
  const img = spriteImages['king_profile'];
  if (img && img.complete && img.naturalWidth) {
    ctx.save();
    ctx.beginPath(); ctx.arc(pcx, pcy, picSz / 2, 0, Math.PI * 2); ctx.clip();
    const iw = img.naturalWidth, ih = img.naturalHeight, scale = Math.max(picSz / iw, picSz / ih);
    const sw = picSz / scale, sh = picSz / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, pcx - picSz / 2, pcy - picSz / 2, picSz, picSz);
    ctx.restore();
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(184,145,46,0.95)";
    ctx.beginPath(); ctx.arc(pcx, pcy, picSz / 2, 0, Math.PI * 2); ctx.stroke();
  }
  // Remark text — word-wrapped, vertically centered in the remaining space
  const textX = x + pad + picSz + pad + 2;
  const textW = x + w - pad - textX;
  ctx.font = "34px Canterbury";
  ctx.fillStyle = "#f0e6c8";
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  const lineH = 40;
  const words = String(_kingRemark).split(/\s+/);
  const lines = []; let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width > textW && cur) { lines.push(cur); cur = word; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  // Paginate: only so many lines fit in the box. Long remarks page through via a tap on the box.
  const maxLines = Math.max(1, Math.floor((h - 12) / lineH));
  const totalPages = Math.max(1, Math.ceil(lines.length / maxLines));
  _kingDialogPages = totalPages;
  _kingDialogRect = { x, y, w, h };
  if (_kingPage >= totalPages) _kingPage = 0;
  const pageLines = lines.slice(_kingPage * maxLines, _kingPage * maxLines + maxLines);
  let ty = y + (h - pageLines.length * lineH) / 2 + 2;
  for (const ln of pageLines) { ctx.fillText(ln, textX, ty); ty += lineH; }
  // Blinking "continue" arrow at the bottom-right when there's another page to read.
  if (_kingPage < totalPages - 1) {
    const a = 0.35 + 0.55 * Math.abs(Math.sin(performance.now() / 320));
    const ax = x + w - 22, ay = y + h - 16;
    ctx.fillStyle = `rgba(255, 235, 150, ${a.toFixed(2)})`;
    ctx.beginPath(); ctx.moveTo(ax - 9, ay - 6); ctx.lineTo(ax + 9, ay - 6); ctx.lineTo(ax, ay + 7); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawResignConfirm() {
// Resign confirm — drawn after graveyard so it sits on top
if (!gameOver && resignConfirm) {
  const confirmY = GRAVE_Y + GRAVE_H + 12;
  const panelH = 72, btnW = 100, btnH = 52, gap = 16;
  const midY = confirmY + panelH / 2;
  const btnY = midY - btnH / 2;
  ctx.save();
  ctx.fillStyle = "rgba(20,10,10,0.92)";
  ctx.beginPath(); ctx.roundRect(MARGIN, confirmY, BOARD_PX, panelH, 8); ctx.fill();
  ctx.font = "37px Canterbury";
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillStyle = "#fff";
  const labelText = "Are you sure?";
  const labelW = ctx.measureText(labelText + "  ").width;
  const totalW = labelW + btnW + gap + btnW;
  const startX = MARGIN + (BOARD_PX - totalW) / 2;
  ctx.fillText(labelText, startX, midY);
  const yesX = startX + labelW;
  const noX = yesX + btnW + gap;
  ctx.fillStyle = "#993333";
  ctx.beginPath(); ctx.roundRect(yesX, btnY, btnW, btnH, 6); ctx.fill();
  ctx.fillStyle = "#444";
  ctx.beginPath(); ctx.roundRect(noX, btnY, btnW, btnH, 6); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("YES", yesX + btnW / 2, midY);
  ctx.fillText("NO",  noX  + btnW / 2, midY);
  ctx.restore();
}

}

// Shared geometry for the "crush your Warriors?" confirm (centered on the board).
function _faConfirmBtns() {
  const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
  const w = Math.min(BOARD_PX - 40, 560), h = 250;
  const y = boardCY - h / 2;
  const btnW = 168, btnH = 62, gap = 32, by = y + h - btnH - 26;
  return { boardCX, boardCY, w, h, y,
    yes: { x: boardCX - gap / 2 - btnW, y: by, w: btnW, h: btnH },
    no:  { x: boardCX + gap / 2,        y: by, w: btnW, h: btnH } };
}
function drawFieldAdvanceConfirm() {
  if (!_faConfirm) return;
  const g = _faConfirmBtns();
  ctx.save();
  const x = g.boardCX - g.w / 2;
  ctx.fillStyle = "rgba(30,16,16,0.96)";
  ctx.beginPath(); ctx.roundRect(x, g.y, g.w, g.h, 14); ctx.fill();
  ctx.strokeStyle = "rgba(220,120,120,0.75)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, g.y, g.w, g.h, 14); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#ff8888"; ctx.font = "40px Canterbury";
  ctx.fillText("Advance the Field?", g.boardCX, g.y + 50);
  ctx.fillStyle = "#fff"; ctx.font = "30px Canterbury";
  ctx.fillText("This will crush your own Warriors", g.boardCX, g.y + 100);
  ctx.fillText("on the bottom row.", g.boardCX, g.y + 134);
  drawUIButton(g.yes, { color: "#8a2a2a", label: "Advance", font: "32px Canterbury" });
  drawUIButton(g.no,  { color: "#2a6e3f", label: "Cancel",  font: "32px Canterbury" });
  ctx.restore();
}

function drawRewinderSaveOffer() {
if (!_rewinderSaveOffer) return;
const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
ctx.fillStyle = "rgba(0,0,0,0.55)";
ctx.fillRect(MARGIN, BOARD_Y + MARGIN, BOARD_PX, BOARD_PX);
ctx.textAlign = "center"; ctx.textBaseline = "middle";
ctx.font = "82px Canterbury";
ctx.fillStyle = "#cc1111";
ctx.fillText("Your King", boardCX, boardCY - 80);
ctx.fillText("Has Fallen", boardCX, boardCY);
const btnW = 180, btnH = 70, gap = 40;
const labelY = boardCY + 90;
ctx.font = "52px Canterbury";
ctx.fillStyle = "#ffffff";
ctx.fillText("Use Rewinder?", boardCX, labelY);
const yesX = boardCX - gap / 2 - btnW;
const noX  = boardCX + gap / 2;
const btnY = labelY + 46;
ctx.fillStyle = "#2a6e3f";
ctx.beginPath(); ctx.roundRect(yesX, btnY, btnW, btnH, 8); ctx.fill();
ctx.fillStyle = "#7a1a1a";
ctx.beginPath(); ctx.roundRect(noX, btnY, btnW, btnH, 8); ctx.fill();
ctx.fillStyle = "#fff"; ctx.font = "52px Canterbury";
ctx.fillText("YES", yesX + btnW / 2, btnY + btnH / 2);
ctx.fillText("NO",  noX  + btnW / 2, btnY + btnH / 2);
ctx.textBaseline = "alphabetic";
}

// Accept the Rewinder save offer: burn the Rewinder, restore the current turn's start.
// Shared by the click handler and the replay driver (the choice is a logged input).
function _rewinderOfferAccept() {
  _rewinderSaveOffer = false;
  if (_turnStartSnapIndices.length < 1) { gameOver = true; stopWindLoop(0); playSfx('over1'); playSfx('over2'); draw(); return; }
  const targetIdx = _turnStartSnapIndices.pop(); // last entry IS the turn to restore (no new entry was pushed after Black's fatal move)
  const targetSnap = replaySnapshots[targetIdx];
  replaySnapshots.splice(targetIdx + 1);
  _replayTransitions.splice(targetIdx + 1);
  applyReplaySnapshot(targetSnap);
  const rSlot = inventory.indexOf(ITEM_REWINDER);
  if (rSlot >= 0) inventory[rSlot] = ITEM_NONE;
  turn = W; aiThinking = false; selected = -1; validMoves = [];
  _resetTurnState(); _resetTurnCounters(); // rewound to turn start — discard the aborted turn's counters
  shopMode = false; gameOver = false; gameMsg = "";
  draw();
}

// Decline the offer: accept the game over.
function _rewinderOfferDecline() {
  _rewinderSaveOffer = false;
  gameOver = true;
  stopWindLoop(0); // silence ambient wind on Game Over
  playSfx('over1'); playSfx('over2'); // Game Over
  draw();
}

function handleRewinderSaveOfferClick(cx, cy) {
if (!_rewinderSaveOffer) return;
const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
const btnW = 180, btnH = 70, gap = 40;
const labelY = boardCY + 90;
const btnY = labelY + 46;
const yesX = boardCX - gap / 2 - btnW;
const noX  = boardCX + gap / 2;
if (cy >= btnY && cy <= btnY + btnH) {
  if (cx >= yesX && cx <= yesX + btnW) {
    playSfx('button');
    _logInput({ t: 'rwa' }); // accepted the Rewinder save — the run continues from the rewound turn
    _rewinderOfferAccept();
  } else if (cx >= noX && cx <= noX + btnW) {
    playSfx('button');
    _logInput({ t: 'rwd' }); // declined — game over stands
    _rewinderOfferDecline();
  }
}
}

function drawFlyAnims() {
// Flying pieces (captured pieces arcing to graveyard)
{
  const now = performance.now();
  for (const f of flyAnims) {
    const t = Math.min(1, (now - f.startMs) / f.dur);
    const cx2 = f.sx + (f.tx - f.sx) * t;
    const cy2 = f.sy + (f.ty - f.sy) * t - Math.sin(t * Math.PI) * 160;
    const angle = t * Math.PI * 5;
    const sz = 36;
    const _flyWImg = spriteImages[`${W}_${f.piece}`];
    if (_flyWImg && _flyWImg.complete) {
      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.rotate(angle);
      ctx.globalAlpha = t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.6 : 1;
      if (f.side === W) {
        ctx.drawImage(_flyWImg, -sz / 2, -sz / 2, sz, sz);
      } else {
        _drawTinted(ctx, _flyWImg, f.side, -sz / 2, -sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
  for (const f of itemFlyAnims) {
    const t = Math.min(1, (performance.now() - f.startMs) / f.dur);
    const cx2 = f.sx + (f.tx - f.sx) * t;
    const cy2 = f.sy + (f.ty - f.sy) * t - Math.sin(t * Math.PI) * 100;
    const sz = INV_SLOT * 0.75;
    ctx.save();
    ctx.globalAlpha = t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.5 : 1;
    _drawItemInSlot(ctx, f.item, cx2 - sz / 2, cy2 - sz / 2, sz);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

}

function drawShieldPops() {
// Shield pop effects
if (shieldPops.length > 0) {
  const now = performance.now();
  for (const sp of shieldPops) {
    const t = Math.min(1, (now - sp.startMs) / sp.dur);
    const radius = 16 + t * 32;
    ctx.globalAlpha = (1 - t) * 0.85;
    ctx.strokeStyle = "#88ccff";
    ctx.lineWidth = 3 - t * 2;
    ctx.beginPath();
    ctx.arc(sp.cx, sp.cy, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

}

function drawExplosion() {
// Explosion flash
if (explosionAnim) {
  const t = Math.min(1, (performance.now() - explosionAnim.startMs) / EXPLOSION_MS);
  const img = spriteImages["explosion"];
  if (img && img.complete) {
    const sz = TILE * 3.2 * (0.4 + 0.6 * Math.sin(t * Math.PI)); // grows then shrinks
    ctx.save();
    ctx.globalAlpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
    ctx.translate(explosionAnim.cx, explosionAnim.cy);
    ctx.rotate(t * 0.4);
    ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

}

function drawVoidDeath() {
// Void death spiral
if (voidDeathAnim) {
  const t = Math.min(1, (performance.now() - voidDeathAnim.startMs) / VOID_DEATH_MS);
  const _vdImg = voidDeathAnim.piece == null
    ? spriteImages["merchant"]
    : spriteImages[`${W}_${voidDeathAnim.piece}`];
  if (_vdImg && _vdImg.complete) {
    const scale = (1 - t) * (1 - t);
    const angle = t * Math.PI * 6;
    const sz = TILE * 0.75;
    ctx.save();
    ctx.translate(voidDeathAnim.cx, voidDeathAnim.cy);
    ctx.rotate(angle);
    ctx.globalAlpha = 1 - t * 0.5;
    if (voidDeathAnim.piece == null || voidDeathAnim.side === W) {
      ctx.drawImage(_vdImg, -sz * scale / 2, -sz * scale / 2, sz * scale, sz * scale);
    } else {
      _drawTinted(ctx, _vdImg, voidDeathAnim.side, -sz * scale / 2, -sz * scale / 2, sz * scale, sz * scale);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

}

function drawFireDeaths() {
  if (fireDeaths.length === 0) return;
  const now = performance.now();
  for (const fd of fireDeaths) {
    const t = Math.min(1, (now - fd.startMs) / FIRE_DEATH_MS);
    ctx.save();
    // the doomed piece, shrinking and fading as it's consumed
    const img = fd.piece != null ? spriteImages[`${W}_${fd.piece}`] : null;
    if (img && img.complete) {
      const sz = TILE * 0.78 * (1 - 0.25 * t);
      ctx.globalAlpha = Math.max(0, 1 - t * 1.25);
      if (fd.side === W) ctx.drawImage(img, fd.cx - sz / 2, fd.cy - sz / 2, sz, sz);
      else _drawTinted(ctx, img, fd.side, fd.cx - sz / 2, fd.cy - sz / 2, sz, sz);
      ctx.globalAlpha = 1;
    }
    // flames engulf: rise, peak, then burst into fading embers
    const flame = Math.sin(t * Math.PI); // 0 -> 1 -> 0
    // Flat glow (only a handful of these ever run at once, but keep it allocation-free too).
    ctx.fillStyle = `rgba(255,120,20,${(0.4 * flame).toFixed(2)})`;
    ctx.fillRect(fd.cx - TILE * 0.6, fd.cy - TILE * 0.6, TILE * 1.2, TILE * 1.2);
    // licking flame tongues
    for (let k = 0; k < 6; k++) {
      const spread = TILE * (0.05 + 0.34 * flame);
      const fx = fd.cx + Math.sin(k * 1.9 + t * 5) * spread;
      const baseY = fd.cy + TILE * 0.36;
      const h = TILE * (0.35 + 0.45 * Math.abs(Math.sin(t * 9 + k * 1.3))) * flame;
      ctx.fillStyle = `rgba(255,${130 + Math.floor(90 * flame)},25,${(0.85 * flame).toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(fx - TILE * 0.075, baseY);
      ctx.quadraticCurveTo(fx - TILE * 0.085, baseY - h * 0.55, fx, baseY - h);
      ctx.quadraticCurveTo(fx + TILE * 0.085, baseY - h * 0.55, fx + TILE * 0.075, baseY);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

function drawPromoDialog() {}

function drawShopDialog() {
// Shop dialogue
if (shopMode) {
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const dlgW = 820, dlgH = 500;
  const dlgX = (canvas.width - dlgW) / 2, dlgY = (canvas.height - dlgH) / 2;
  ctx.fillStyle = "#1e1e3c";
  ctx.beginPath(); ctx.roundRect(dlgX, dlgY, dlgW, dlgH, 12); ctx.fill();
  ctx.strokeStyle = "rgba(255,200,50,0.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(dlgX, dlgY, dlgW, dlgH, 12); ctx.stroke();

  ctx.fillStyle = "#f0c040";
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Merchant", dlgX + dlgW / 2, dlgY + 45);
  ctx.fillStyle = "#aaa";
  ctx.fillText(`Gold: ${gold}`, dlgX + dlgW / 2, dlgY + 88);

  const cardW = 220, cardH = 300, cardGap = 20;
  const cardsStartX = dlgX + (dlgW - 3 * cardW - 2 * cardGap) / 2;
  const cardsY = dlgY + 120;

  for (let i = 0; i < shopOffers.length; i++) {
    const item = shopOffers[i];
    const price = itemPrice(item);
    const cardX = cardsStartX + i * (cardW + cardGap);
    const sold = merchantSold[i];
    const canAfford = !sold && gold >= price;

    ctx.fillStyle = sold ? "#181820" : canAfford ? "#2a2a52" : "#1e1e30";
    ctx.beginPath(); ctx.roundRect(cardX, cardsY, cardW, cardH, 8); ctx.fill();
    if (canAfford) {
      ctx.strokeStyle = "rgba(255,200,50,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cardX, cardsY, cardW, cardH, 8); ctx.stroke();
    }

    ctx.globalAlpha = sold ? 0.35 : 1;
    _drawItemInSlot(ctx, item, cardX + (cardW - 90) / 2, cardsY + 16, 90);
    ctx.globalAlpha = 1;

    ctx.fillStyle = sold ? "#555" : "#ddd";
    ctx.font = "42px Canterbury";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const name = itemName(item);
    const words = name.split(" ");
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      ctx.fillText(words.slice(0, mid).join(" "), cardX + cardW / 2, cardsY + 130);
      ctx.fillText(words.slice(mid).join(" "), cardX + cardW / 2, cardsY + 168);
    } else {
      ctx.fillText(name, cardX + cardW / 2, cardsY + 149);
    }

    ctx.fillStyle = sold ? "#444" : canAfford ? "#f0c040" : "#666";
    ctx.font = "42px Canterbury";
    ctx.fillText(sold ? "" : `${price} G`, cardX + cardW / 2, cardsY + 210);

    ctx.fillStyle = sold ? "#2a1a1a" : canAfford ? "#3a6a3a" : "#2a2a2a";
    ctx.beginPath(); ctx.roundRect(cardX + 14, cardsY + cardH - 54, cardW - 28, 44, 6); ctx.fill();
    ctx.fillStyle = sold ? "#663333" : canAfford ? "#fff" : "#555";
    ctx.font = "42px Canterbury";
    ctx.textBaseline = "middle";
    ctx.fillText(sold ? "Sold" : "Buy", cardX + cardW / 2, cardsY + cardH - 54 + 22);
  }

  // Close button (bottom-right)
  const closeBtnX = dlgX + dlgW - 130, closeBtnY = dlgY + dlgH - 58;
  ctx.fillStyle = "#4a2a2a";
  ctx.beginPath(); ctx.roundRect(closeBtnX, closeBtnY, 110, 44, 6); ctx.fill();
  ctx.fillStyle = "#ddd";
  ctx.font = "42px Canterbury";
  ctx.fillText("Close", closeBtnX + 55, closeBtnY + 22);

  // Reroll notice: always shown, white, centered under the offers
  ctx.fillStyle = "#ffffff";
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("New wares each Field Advance", dlgX + dlgW / 2, closeBtnY + 22);
}
}

// Shared geometry for the sell-confirm modal (used by draw + click handler).
function _sellConfirmGeom() {
  const pw = 640, ph = 260;
  const px = (canvas.width - pw) / 2, py = (canvas.height - ph) / 2;
  const btnW = 190, btnH = 74, gap = 44;
  const btnY = py + ph - btnH - 30;
  const yesX = px + pw / 2 - gap / 2 - btnW;
  const noX = px + pw / 2 + gap / 2;
  return { px, py, pw, ph, btnW, btnH, yesX, noX, btnY };
}

function drawSellConfirm() {
  if (sellConfirmSlot < 0) return;
  const item = inventory[sellConfirmSlot];
  if (item === ITEM_NONE) return;
  const g = _sellConfirmGeom();
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1e1e3c";
  ctx.beginPath(); ctx.roundRect(g.px, g.py, g.pw, g.ph, 12); ctx.fill();
  ctx.strokeStyle = "rgba(255,200,50,0.5)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(g.px, g.py, g.pw, g.ph, 12); ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.font = "42px Canterbury";
  ctx.fillText(`Sell ${itemName(item)} for ${sellValue(item)}G?`, g.px + g.pw / 2, g.py + 70);
  ctx.font = "37px Canterbury";
  ctx.fillStyle = "#aaa";
  ctx.fillText("Are you sure?", g.px + g.pw / 2, g.py + 120);
  ctx.fillStyle = "#2a6e3f";
  ctx.beginPath(); ctx.roundRect(g.yesX, g.btnY, g.btnW, g.btnH, 8); ctx.fill();
  ctx.fillStyle = "#7a1a1a";
  ctx.beginPath(); ctx.roundRect(g.noX, g.btnY, g.btnW, g.btnH, 8); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = "42px Canterbury";
  ctx.fillText("Yes", g.yesX + g.btnW / 2, g.btnY + g.btnH / 2);
  ctx.fillText("No", g.noX + g.btnW / 2, g.btnY + g.btnH / 2);
}

// ─── Achievements ─────────────────────────────────────────────────────────────
// Framework: each achievement has an id, name, one-line desc, and a check()
// predicate evaluated against live game state. Unlock state persists in
// localStorage. The grid maps cell index (row-major) → ACHIEVEMENTS[index]; cells
// past the defined list are empty "coming soon" slots. Add more by appending here.
const ACHIEVEMENTS = [
  { id: 'take_1_king',  name: 'First Blood', desc: 'Take 1 Black King',            check: () => score >= 1 },
  { id: 'take_5_king',  name: 'Bloodbath',   desc: 'Take 5 Black Kings in one run',  check: () => score >= 5 },
  { id: 'take_10_king', name: 'Decimator',   desc: 'Take 10 Black Kings in one run', check: () => score >= 10 },
  { id: 'take_25_king', name: 'Warlord',     desc: 'Take 25 Black Kings in one run', check: () => score >= 25 },
  { id: 'take_50_king', name: 'Conqueror',   desc: 'Take 50 Black Kings in one run', check: () => score >= 50 },
  { id: 'blitz_5',  name: 'Blitz Bloodbath', desc: 'Take 5 Black Kings in one run with a 15-second timer',  check: () => score >= 5  && timedMode && timedModeSecs === 15 },
  { id: 'blitz_10', name: 'Blitz Decimator', desc: 'Take 10 Black Kings in one run with a 15-second timer', check: () => score >= 10 && timedMode && timedModeSecs === 15 },
  { id: 'blitz_25', name: 'Blitz Warlord',   desc: 'Take 25 Black Kings in one run with a 15-second timer', check: () => score >= 25 && timedMode && timedModeSecs === 15 },
  { id: 'blitz_50', name: 'Blitz Conqueror', desc: 'Take 50 Black Kings in one run with a 15-second timer', check: () => score >= 50 && timedMode && timedModeSecs === 15 },
  { id: 'flawless_25', name: 'Flawless',  desc: 'Take 25 Black Kings in one run without losing a White Warrior', check: () => score >= 25 && !_lostWhiteThisRun },
  { id: 'speed_25',    name: 'Speedrun',  desc: 'Take 25 Black Kings in one run within 15 minutes',            check: () => score >= 25 && _runStartMs > 0 && (performance.now() - _runStartMs) <= 15 * 60 * 1000 },
  { id: 'king20_rook',   name: 'Siege Breaker', desc: 'Take the 20th Black King with a Rook',         check: () => _king20TakenBy === ROOK },
  { id: 'king20_bishop', name: 'Crusader',      desc: 'Take the 20th Black King with a Bishop',       check: () => _king20TakenBy === BISHOP },
  { id: 'king20_knight', name: 'Cavalier',      desc: 'Take the 20th Black King with a Knight',       check: () => _king20TakenBy === KNIGHT },
  { id: 'king20_pawn',   name: 'Giant Slayer',  desc: 'Take the 20th Black King with a Pawn',         check: () => _king20TakenBy === PAWN },
  { id: 'king20_king',   name: 'Duel of Kings', desc: 'Take the 20th Black King with a King',         check: () => _king20TakenBy === KING },
  { id: 'king20_cman',   name: 'Draughtsman',   desc: 'Take the 20th Black King with a Checkers Man', check: () => _king20TakenBy === CHECKERS },
  { id: 'king20_cking',  name: 'Double Crown',  desc: 'Take the 20th Black King with a Checkers King',check: () => _king20TakenBy === CHECKERS_KING },
  { id: 'cking20',    name: 'King Hunter',   desc: 'Take the 20th Checkers King', check: () => (enemyDead[CHECKERS_KING] || 0) >= 20 },
  { id: 'recruit_cman',  name: 'Enlist',    desc: 'Recruit a Checkers Man',  check: () => _recruitedCManThisRun },
  { id: 'recruit_cking', name: 'Kingmaker', desc: 'Recruit a Checkers King', check: () => _recruitedCKingThisRun },
  { id: 'gold_100', name: 'Prospector', desc: 'Collect 100 G in one run', check: () => _maxGoldThisRun >= 100 },
  { id: 'gold_250', name: 'Tycoon',     desc: 'Collect 250 G in one run', check: () => _maxGoldThisRun >= 250 },
  { id: 'no_item_25',  name: 'Purist',      desc: 'Take 25 Black Kings without using an Item (Classic setup)', check: () => score >= 25 && !_usedItemThisRun && _startedClassic },
  { id: 'four_kings',  name: 'Court',        desc: 'Have 4 Kings in your team when you take the 25th Black King', check: () => _had4KingsAt25 },
  { id: 'start_12pawn',  name: 'Pawn Storm',  desc: 'Take 25 Black Kings on a run starting with at least 12 Pawns',   check: () => score >= 25 && (_startCounts[PAWN]   || 0) >= 12 },
  { id: 'start_4knight', name: 'Cavalry',     desc: 'Take 25 Black Kings on a run starting with at least 4 Knights',  check: () => score >= 25 && (_startCounts[KNIGHT] || 0) >= 4 },
  { id: 'start_4rook',   name: 'Battlements', desc: 'Take 25 Black Kings on a run starting with at least 4 Rooks',    check: () => score >= 25 && (_startCounts[ROOK]   || 0) >= 4 },
  { id: 'start_4bishop', name: 'Conclave',    desc: 'Take 25 Black Kings on a run starting with at least 4 Bishops',  check: () => score >= 25 && (_startCounts[BISHOP] || 0) >= 4 },
  { id: 'triple_effect', name: 'Empowered',   desc: 'Have three White Warriors with three Effects each',             check: () => _countWhiteWithEffects(3) >= 3 },
  { id: 'blitz_25_clean', name: 'Clockwork',  desc: 'Take 25 Black Kings in 15-second timer mode without timing out', check: () => score >= 25 && timedMode && timedModeSecs === 15 && !_timedOutThisRun },
  { id: 'kill_25_pawn',   name: 'Pawnbroker', desc: 'Take 25 Black Pawns in one run',   check: () => (enemyDead[PAWN]   || 0) >= 25 },
  { id: 'kill_25_rook',   name: 'Rook Ruin',  desc: 'Take 25 Black Rooks in one run',   check: () => (enemyDead[ROOK]   || 0) >= 25 },
  { id: 'kill_25_bishop', name: 'Iconoclast', desc: 'Take 25 Black Bishops in one run', check: () => (enemyDead[BISHOP] || 0) >= 25 },
  { id: 'kill_25_knight', name: 'Horse Tamer',desc: 'Take 25 Black Knights in one run', check: () => (enemyDead[KNIGHT] || 0) >= 25 },
  { id: 'kings_2_turn', name: 'Double Kill', desc: 'Take 2 Black Kings in one turn', check: () => _turnKingsTaken >= 2 },
  { id: 'kings_3_turn', name: 'Triple Kill', desc: 'Take 3 Black Kings in one turn', check: () => _turnKingsTaken >= 3 },
  { id: 'kings_4_turn', name: 'Overkill',    desc: 'Take 4 Black Kings in one turn', check: () => _turnKingsTaken >= 4 },
  { id: 'bt_pawn_2', name: 'Rabid Pawn', desc: 'Take 2 Black Warriors in one turn with a Bloodthirsty or Fast Pawn', check: () => _turnActorType === PAWN && _turnActorBuffed && _turnActorTakes >= 2 },
  { id: 'bt_king_2', name: 'Rampage',    desc: 'Take 2 Black Warriors in one turn with a Bloodthirsty or Fast King', check: () => _turnActorType === KING && _turnActorBuffed && _turnActorTakes >= 2 },
  { id: 'cman_chain_2', name: 'Double Jump', desc: 'Take 2 Black Warriors with a chained Checkers Man jump',  check: () => _turnActorType === CHECKERS && _turnActorTakes >= 2 },
  { id: 'cman_chain_3', name: 'Triple Jump', desc: 'Take 3 Black Warriors with a chained Checkers Man jump',  check: () => _turnActorType === CHECKERS && _turnActorTakes >= 3 },
  { id: 'cking_chain_2', name: 'Royal Leap',  desc: 'Take 2 Black Warriors with a chained Checkers King jump', check: () => _turnActorType === CHECKERS_KING && _turnActorTakes >= 2 },
  { id: 'cking_chain_3', name: 'Royal Rampage',desc: 'Take 3 Black Warriors with a chained Checkers King jump', check: () => _turnActorType === CHECKERS_KING && _turnActorTakes >= 3 },
  { id: 'bomb_6_inv',   name: 'Demolitionist', desc: 'Take 6 Black Warriors in one turn with a Bomb', check: () => _turnBombKills >= 6 && _turnBombFromInv },
  { id: 'bomb_6_square',name: 'Minesweeper',   desc: 'Take 6 Black Warriors in one turn by moving onto a Bomb square', check: () => _turnBombKills >= 6 && _turnBombFromSquare },
  { id: 'sell_8_turn', name: 'Liquidation', desc: 'Sell 8 Items in one turn', check: () => _turnSells >= 8 },
  { id: 'water_void',  name: 'Riptide',  desc: 'Take a Black Warrior by pushing them into a Void with a Water Piece', check: () => _pushedBlackIntoVoidByWater },
  { id: 'water_bomb',  name: 'Flushed',  desc: 'Take a Black Warrior by pushing them into a Bomb with a Water Warrior', check: () => _pushedBlackIntoBombByWater },
  { id: 'sword_shield_king', name: 'Shieldbreaker', desc: 'Take a Shielded Black King with a Sworded White Warrior', check: () => _tookShieldedKingWithSword },
  { id: 'recruit_streak_3', name: 'Recruiter',  desc: 'Recruit a Grey Warrior three turns in a row', check: () => _recruitStreak >= 3 },
  { id: 'recruit_cking_grey', name: 'Talent Scout', desc: 'Recruit a Grey Warrior with a Checkers King', check: () => _recruitedWithCKing },
  { id: 'double_hit_shield', name: 'One-Two',    desc: 'Take a Shielded Black Warrior by hitting them twice with a Fast Warrior in one turn', check: () => _tookShieldedWithDoubleHit },
  { id: 'bomb_streak_3', name: 'Serial Bomber', desc: 'Take at least 1 Black Warrior with a Bomb 3 turns in a row', check: () => _bombStreak >= 3 },
  { id: 'flawless_8_adv', name: 'Untouchable', desc: 'Survive 8 Field Advances without taking a Black King or losing a White Warrior', check: () => _flawlessAdvances >= 8 },
];

// Count White pieces carrying at least n effect badges (attack/health/speed/status/element).
function _countWhiteWithEffects(n) {
  let c = 0;
  for (let i = 0; i < 64; i++) if (sides[i] === W && effectOrders[i] && effectOrders[i].length >= n) c++;
  return c;
}
const ACH_GRID_CELLS = 64; // 8×8

let _achUnlocked = {};
try { _achUnlocked = JSON.parse(localStorage.getItem('tk_achievements') || '{}') || {}; } catch (e) { _achUnlocked = {}; }
let achievementsOpen = false;

// --- Main menu (Play / Achievements / Leaderboard), shown after the start screen ---
let mainMenuOpen = false;
function _mmBtnRects() {
  const cx = canvas.width / 2, w = Math.min(canvas.width * 0.62, 440), h = 92, gap = 32;
  const x = cx - w / 2, y0 = canvas.height * 0.40;
  return {
    play:         { x, y: y0, w, h },
    achievements: { x, y: y0 + (h + gap), w, h },
    leaderboard:  { x, y: y0 + 2 * (h + gap), w, h },
  };
}
function drawMainMenu() {
  drawScrollingGround(0.22); // slowly-scrolling gameplay ground behind the menu
  const cx = canvas.width / 2, titleY = canvas.height * 0.22;
  const logo = spriteImages['logo'];
  if (logo && logo.complete && logo.naturalWidth > 0) {
    const lw = Math.min(canvas.width * 0.62, 440), lh = lw * (logo.naturalHeight / logo.naturalWidth);
    ctx.drawImage(logo, cx - lw / 2, titleY - lh / 2, lw, lh);
  } else {
    ctx.fillStyle = "#c8a060"; ctx.font = "76px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Taken Kings", cx, titleY);
  }
  const R = _mmBtnRects();
  const drawBtn = (r, color, label) =>
    drawUIButton(r, { color, label, radius: 12, font: "50px Canterbury", stroke: "rgba(255,255,255,0.3)", dy: 2 });
  drawBtn(R.play, "#2a6e3f", "▶ Play");
  drawBtn(R.achievements, "#b8912e", "Achievements");
  drawBtn(R.leaderboard, "#1a5a6e", "Leaderboard");
  ctx.textBaseline = "alphabetic";
}
function handleMainMenuClick(cx, cy) {
  const inR = (r) => _inRect(cx, cy, r);
  const R = _mmBtnRects();
  if (inR(R.play)) { playSfx('button'); mainMenuOpen = false; _startMenuDecel(); startIdleAnim(); draw(); return; } // scroll eases to a stop; ground becomes gameplay background
  if (inR(R.achievements)) { playSfx('button'); achievementsOpen = true; _achSelected = 0; _achClearConfirm = false; startMenuBg(); draw(); return; }
  if (inR(R.leaderboard)) { playSfx('button'); _lbOpen(); return; }
}

// --- Leaderboard (Phase 2): read-only boards from Supabase (client reads; writes are server-only) ---
const SUPABASE_URL = 'https://froggegesqnoznvenoyt.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JFBcrijOlFo2S8EucZl4HA_4ej0DSpo'; // publishable/client-safe
// Two high-score boards. `key` is the DB `board` value. Both read either setup (Classic + Rolled).
const LB_BOARDS = [
  { key: 'hs_untimed', tab: 'Untimed',   title: 'High Score — Untimed',   metric: 'Taken Kings', speed: false },
  { key: 'hs_15s',     tab: '15s Timer', title: 'High Score — 15s Timer', metric: 'Taken Kings', speed: false },
];
const _lbBoard = (key) => LB_BOARDS.find(b => b.key === key);
let leaderboardOpen = false;
let _lbTab = LB_BOARDS[0].key;
const _lbData = {};   // key -> null (unloaded) | array of rows
const _lbState = {};  // key -> 'idle' | 'loading' | 'ready' | 'error'
for (const b of LB_BOARDS) { _lbData[b.key] = null; _lbState[b.key] = 'idle'; }

function _lbFetch(key) {
  if (_lbState[key] === 'loading') return;
  _lbState[key] = 'loading';
  if (leaderboardOpen) draw();
  const asc = !!_lbBoard(key).speed; // speed boards rank by LOWEST value (time)
  const url = `${SUPABASE_URL}/rest/v1/scores?board=eq.${key}&select=name,value,created_at&order=value.${asc ? 'asc' : 'desc'}&limit=${LB_MAX_ROWS}`;
  fetch(url, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }, cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(rows => { _lbData[key] = rows; _lbState[key] = 'ready'; if (leaderboardOpen) draw(); })
    .catch(() => { _lbState[key] = 'error'; if (leaderboardOpen) draw(); });
}
function _lbOpen() {
  leaderboardOpen = true; _lbTab = LB_BOARDS[0].key;
  if (_lbState[_lbTab] !== 'ready') _lbFetch(_lbTab);
  startMenuBg(); // keep the ground scrolling behind the leaderboard
  draw();
}
// High-score boards: value is a plain integer (Kings taken). Speed boards: value is ms -> m:ss.
function _lbFormatValue(key, v) {
  if (!_lbBoard(key).speed) return String(v);
  const totalS = v / 1000, m = Math.floor(totalS / 60), s = Math.floor(totalS % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
// Compact local date+time for a leaderboard row's created_at, e.g. "7/7/26 4:53 PM".
function _lbFormatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  let h = d.getHours(); const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`;
}

// --- Phase 3d: submit a finished run to the leaderboard (validated server-side) ---
const LB_SUBMIT_URL = SUPABASE_URL + '/functions/v1/bright-task';
let _lbSubmitState = 'idle'; // 'idle' | 'submitting' | 'done' | 'error'
let _lbSubmitMsg = '';       // status line under the button
let _lbSubmitWarn = false;   // ranked, but the server's re-simulated score differed from live

// A run is submittable only if it's a genuine, reproducible human run on an eligible mode.
// Auto-play consumes RNG the input log can't reproduce (server would reject it), so it's barred.
function _lbEligible() {
  return !_autoPlayUsedThisRun && score >= 1 && _replayInputs.length > 0 && (!timedMode || timedModeSecs === 15);
}

// On-screen name entry via a real HTML <input> overlaid on the canvas, with a Submit button to
// its right — mobile players get an explicit tap target instead of hunting for the keyboard's
// return key. Works everywhere: preview panes and mobile/app webviews block window.prompt(), and
// mobile needs a focusable input to raise the keyboard. cb(name) on Enter/Submit, cb(null) on
// Escape/cancel.
let _lbNameInput = null;
let _lbNameBtn = null;
function _lbShowNameEntry(prefill, cb) {
  const wrap = (typeof document !== 'undefined' && (document.getElementById('game-wrap') || document.body)) || null;
  if (!wrap) { // no DOM (headless) — fall back to prompt if available, else cancel
    let v = null; try { v = prompt('Enter your name (max 20):', prefill || ''); } catch (e) {}
    cb(v ? v.trim().slice(0, 20) : null); return;
  }
  if (!_lbNameInput) {
    _lbNameInput = document.createElement('input');
    _lbNameInput.type = 'text'; _lbNameInput.maxLength = 20;
    _lbNameInput.setAttribute('placeholder', 'Your name');
    _lbNameInput.setAttribute('autocomplete', 'off'); _lbNameInput.setAttribute('autocapitalize', 'off');
    _lbNameInput.style.cssText = 'position:absolute; z-index:20; box-sizing:border-box; text-align:center; font-family:sans-serif; color:#fff; background:#12122a; border:2px solid #b8912e; border-radius:8px; outline:none; padding:0 10px;';
    wrap.appendChild(_lbNameInput);
    _lbNameBtn = document.createElement('button');
    _lbNameBtn.type = 'button';
    _lbNameBtn.textContent = 'Submit';
    // Match the game's canvas buttons (drawUIButton): solid gold fill like the "Submit to
    // Leaderboard" button, white Canterbury text, rounded corners, and the same drop shadow.
    _lbNameBtn.style.cssText = "position:absolute; z-index:20; box-sizing:border-box; display:flex; align-items:center; justify-content:center; color:#fff; background:#b8912e; border:none; border-radius:8px; cursor:pointer; padding:0; box-shadow:0 5px 14px rgba(0,0,0,0.7); font-family:'Canterbury', serif; line-height:1; touch-action:manipulation; user-select:none;";
    wrap.appendChild(_lbNameBtn);
  }
  const inp = _lbNameInput, btn = _lbNameBtn;
  // Split the Submit-button rect: name field on the left, Submit button on the right.
  const b = _gameOverBtns().submit;
  const scale = (canvas.getBoundingClientRect().width || canvas.width) / canvas.width;
  const gap = 8 * scale, btnW = b.w * scale * 0.34;
  const inpW = b.w * scale - btnW - gap;
  inp.style.left = (b.x * scale) + 'px';
  inp.style.top = (b.y * scale) + 'px';
  inp.style.width = inpW + 'px';
  inp.style.height = (b.h * scale) + 'px';
  inp.style.fontSize = Math.max(12, Math.round(b.h * scale * 0.48)) + 'px';
  btn.style.left = (b.x * scale + inpW + gap) + 'px';
  btn.style.top = (b.y * scale) + 'px';
  btn.style.width = btnW + 'px';
  btn.style.height = (b.h * scale) + 'px';
  btn.style.fontSize = Math.max(16, Math.round(b.h * scale * 0.6)) + 'px'; // Canterbury sits small — match the canvas buttons' proportions
  inp.value = prefill || '';
  inp.style.display = 'block';
  btn.style.display = 'block';
  let done = false;
  const finish = (val) => {
    if (done) return; done = true;
    inp.style.display = 'none'; btn.style.display = 'none';
    inp.onkeydown = null; inp.onblur = null; btn.onpointerdown = null; btn.onclick = null;
    cb(val);
  };
  const submit = () => finish((inp.value || '').trim().slice(0, 20));
  inp.onkeydown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); finish(null); }
  };
  // pointerdown fires BEFORE the input's blur, and preventDefault keeps focus on the field —
  // so tapping Submit can't be mistaken for the tap-away cancel below. onclick is a fallback
  // for environments without pointer events (the done flag makes a double fire harmless).
  btn.onpointerdown = (e) => { e.preventDefault(); submit(); };
  btn.onclick = () => submit();
  // Tapping away cancels (delayed so an Enter/Submit path isn't clobbered).
  inp.onblur = () => setTimeout(() => { if (!done) finish(null); }, 120);
  setTimeout(() => { inp.focus(); try { inp.select(); } catch (e) {} }, 0);
}

function _lbSubmit() {
  if (_lbSubmitState === 'submitting' || _lbSubmitState === 'done' || _lbSubmitState === 'naming') return;
  let prev = ''; try { prev = localStorage.getItem('tk_lb_name') || ''; } catch (e) {}
  _lbSubmitState = 'naming'; _lbSubmitMsg = ''; draw(); // label drawn beside the field, not below
  _lbShowNameEntry(prev, (name) => {
    if (!name) { _lbSubmitState = 'idle'; _lbSubmitMsg = ''; draw(); return; } // cancelled / empty
    _lbDoSubmit(name);
  });
}

function _lbDoSubmit(name) {
  try { localStorage.setItem('tk_lb_name', name); } catch (e) {}
  _lbSubmitState = 'submitting'; _lbSubmitMsg = ''; _lbSubmitWarn = false; draw();
  // liveScore rides along for forensics: the validator ignores it, but a stored run whose
  // re-simulated value differs from liveScore is a confirmed determinism bug worth digging into.
  const payload = { version: VERSION, name, run: { seed: _runSeed, classic: _startedClassic, timed: timedMode, secs: timedModeSecs, liveScore: score, inputs: _replayInputs, blackMoves: _blackMoveLog } };
  // Abort a hung request so the player sees an error (and can Retry) instead of a
  // "Submitting…" button that spins forever with no feedback.
  const _ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  const _timeout = setTimeout(() => { if (_ctrl) _ctrl.abort(); }, 20000);
  fetch(LB_SUBMIT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: _ctrl ? _ctrl.signal : undefined })
    .then(r => r.json().then(j => ({ ok: r.ok, status: r.status, j })).catch(() => ({ ok: r.ok, status: r.status, j: {} })))
    .then(({ ok, status, j }) => {
      clearTimeout(_timeout);
      if (ok && j.ok && j.ranked) {
        _lbSubmitState = 'done';
        const bd = _lbBoard(j.board) ? _lbBoard(j.board).tab : j.board;
        // Transparency: the board shows the SERVER's re-simulated score. If it differs from
        // what the player actually saw, say so plainly instead of a silent "✓ Submitted" —
        // a mismatch is a determinism bug (the run is stored server-side for investigation).
        if (typeof j.value === 'number' && j.value !== score && !j.duplicate) {
          _lbSubmitWarn = true;
          _lbSubmitMsg = `Ranked as ${j.value}, not ${score} — bug logged, sorry!`;
        } else {
          _lbSubmitMsg = j.duplicate ? 'Already on the board!' : `Added to the ${bd} board!`;
        }
        if (_lbData[j.board] !== undefined) _lbState[j.board] = 'idle';
      }
      else if (ok && j.ok && !j.ranked) { _lbSubmitState = 'done'; _lbSubmitMsg = 'Score too low to rank.'; }
      else {
        _lbSubmitState = 'error';
        const err = (j && j.error) ? String(j.error) : '';
        // Surface enough to diagnose from the player's screen instead of a bare "Submit failed.":
        //  • version mismatch = server can't fetch this release yet (tag still propagating) —
        //    never tell the player to refresh (that destroys the run); retrying is the fix.
        //  • 546 = Supabase worker CPU/mem limit (a run too heavy to re-simulate in budget).
        //  • anything else = show the server's error text, or the raw HTTP status as a fallback.
        if (/version mismatch/.test(err)) _lbSubmitMsg = 'Server updating — retry in a minute.';
        else if (err) _lbSubmitMsg = err.slice(0, 44);
        else if (status === 546) _lbSubmitMsg = 'Run too heavy to verify (546) — retry.';
        else _lbSubmitMsg = `Submit failed (HTTP ${status || '?'}).`;
      }
      draw();
    })
    .catch((e) => {
      clearTimeout(_timeout);
      _lbSubmitState = 'error';
      _lbSubmitMsg = (e && e.name === 'AbortError') ? 'Timed out — check connection, retry.' : 'Network error — retry.';
      draw();
    });
}

// Shared game-over button geometry (draw + click). A "Submit" button appears above the
// Start Over / Replay row when the run is leaderboard-eligible.
function _gameOverBtns() {
  const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
  const btnW = 280, btnH = 70, btnGap = 24;
  const eligible = _lbEligible();
  const subW = btnW * 2 + btnGap;
  const rowY = eligible ? boardCY + 214 : boardCY + 120;
  const soX = boardCX - subW / 2, repX = soX + btnW + btnGap;
  return {
    eligible,
    submit: { x: boardCX - subW / 2, y: boardCY + 120, w: subW, h: btnH },
    startOver: { x: soX, y: rowY, w: btnW, h: btnH },
    replay: { x: repX, y: rowY, w: btnW, h: btnH },
  };
}
let _achSelected = 0;        // highlighted grid cell
let _achClearConfirm = false; // "Are you sure?" dialog for Clear Achievements
let _achToast = null;        // { name, startMs } — brief in-game unlock banner

function _saveAchievements() { try { localStorage.setItem('tk_achievements', JSON.stringify(_achUnlocked)); } catch (e) {} }

function unlockAchievement(id) {
  if (_achUnlocked[id]) return;
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return;
  _achUnlocked[id] = Date.now();
  _saveAchievements();
  _achToast = { name: a.name, startMs: performance.now() };
  playSfx('recruit'); // celebratory cue
  const tick = () => { draw(); if (_achToast) requestAnimationFrame(tick); }; // drive the fade
  requestAnimationFrame(tick);
}

// Evaluate all still-locked achievements against current state. Called only from
// real (non-simulated, non-replay) rendering so minimax's temporary score changes
// never trigger an unlock.
function checkAchievements() {
  if (gold > _maxGoldThisRun) _maxGoldThisRun = gold; // high-water mark for "collect N gold"
  for (const a of ACHIEVEMENTS) {
    if (_achUnlocked[a.id]) continue;
    try { if (a.check()) unlockAchievement(a.id); } catch (e) {}
  }
}

function _achCellRect(i) {
  const col = i % 8, row = Math.floor(i / 8);
  return { x: ACH_GRID_X + col * TILE, y: ACH_GRID_Y + row * TILE, w: TILE, h: TILE };
}

function drawAchievementsScreen() {
  drawScrollingGround(0.5); // scrolling ground background (scrim keeps the grid + text legible)

  // Header
  ctx.fillStyle = "#c8a060"; ctx.font = "56px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Achievements", canvas.width / 2, BOARD_Y - 40);
  const unlockedCount = ACHIEVEMENTS.filter(a => _achUnlocked[a.id]).length;
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "30px Canterbury";
  ctx.fillText(`${unlockedCount} / ${ACHIEVEMENTS.length} unlocked`, canvas.width / 2, BOARD_Y - 4);

  // 8×8 grid of equal cells
  for (let i = 0; i < ACH_GRID_CELLS; i++) {
    const r = _achCellRect(i);
    const ach = ACHIEVEMENTS[i];
    const unlocked = ach && _achUnlocked[ach.id];
    // base cell — chessboard shading: light/dark alternates by (col + row) parity
    const dark = (i % 8 + Math.floor(i / 8)) % 2;
    if (!ach)            ctx.fillStyle = dark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)"; // empty slot
    else if (unlocked)   ctx.fillStyle = dark ? "#247a43" : "#2f9a56"; // accomplished — filled in
    else                 ctx.fillStyle = dark ? "#32324a" : "#424260"; // available but locked
    ctx.beginPath(); ctx.roundRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 6); ctx.fill();
    // check mark on unlocked cells
    if (unlocked) {
      ctx.strokeStyle = "#eaffea"; ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.30, r.y + r.h * 0.52);
      ctx.lineTo(r.x + r.w * 0.45, r.y + r.h * 0.68);
      ctx.lineTo(r.x + r.w * 0.72, r.y + r.h * 0.34);
      ctx.stroke();
    }
    // selection highlight
    if (i === _achSelected) {
      ctx.strokeStyle = "#f0c040"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, 6); ctx.stroke();
    }
  }

  // Label for the highlighted cell
  const sel = ACHIEVEMENTS[_achSelected];
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  if (sel) {
    const done = !!_achUnlocked[sel.id];
    ctx.fillStyle = done ? "#7fe0a0" : "#fff"; ctx.font = "44px Canterbury";
    ctx.fillText(sel.name, canvas.width / 2, ACH_LABEL_Y);
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "32px Canterbury";
    ctx.fillText(sel.desc, canvas.width / 2, ACH_LABEL_Y + 52);
    ctx.fillStyle = done ? "#7fe0a0" : "rgba(255,255,255,0.45)"; ctx.font = "28px Canterbury";
    ctx.fillText(done ? "✓ Unlocked" : "Locked", canvas.width / 2, ACH_LABEL_Y + 96);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "34px Canterbury";
    ctx.fillText("Empty slot", canvas.width / 2, ACH_LABEL_Y);
    ctx.font = "28px Canterbury";
    ctx.fillText("More achievements coming soon", canvas.width / 2, ACH_LABEL_Y + 48);
  }

  // Back + Clear buttons
  const drawBtn = (r, fill, label) => {
    drawUIButton(r, { color: fill, label, stroke: "rgba(255,255,255,0.3)", dy: 2 });
    ctx.textBaseline = "alphabetic";
  };
  drawBtn(ACH_BACK_BTN, "#4a3a7a", "‹ Back");
  drawBtn(_achClearBtnRect(), "#7a2a2a", "Clear");

  // Are-you-sure dialog for Clear Achievements
  if (_achClearConfirm) {
    const d = _achClearDlgRects();
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#26263e"; ctx.beginPath(); ctx.roundRect(d.box.x, d.box.y, d.box.w, d.box.h, 12); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(d.box.x, d.box.y, d.box.w, d.box.h, 12); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "40px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Clear all achievements?", d.box.x + d.box.w / 2, d.box.y + 46);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "28px Canterbury";
    ctx.fillText("This cannot be undone.", d.box.x + d.box.w / 2, d.box.y + 90);
    drawBtn(d.yes, "#7a2a2a", "Yes");
    drawBtn(d.no, "#4a3a7a", "No");
  }
}

function handleAchievementsClick(cx, cy) {
  const inR = (r) => _inRect(cx, cy, r);
  // Modal confirm takes priority
  if (_achClearConfirm) {
    const d = _achClearDlgRects();
    if (inR(d.yes)) { playSfx('button'); _achUnlocked = {}; _saveAchievements(); _achClearConfirm = false; draw(); return; }
    if (inR(d.no))  { playSfx('button'); _achClearConfirm = false; draw(); return; }
    return; // clicks elsewhere are ignored while the dialog is open
  }
  if (inR(ACH_BACK_BTN))  { playSfx('button'); achievementsOpen = false; draw(); return; }
  if (inR(_achClearBtnRect())) { playSfx('button'); _achClearConfirm = true; draw(); return; }
  for (let i = 0; i < ACH_GRID_CELLS; i++) {
    const r = _achCellRect(i);
    if (inR(r)) {
      if (_achSelected !== i) { _achSelected = i; playSfx('draw'); draw(); }
      return;
    }
  }
}

function drawLeaderboardScreen() {
  drawScrollingGround(0.5); // scrolling ground background (scrim keeps the rows + text legible)

  // Header
  ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#e6b96e"; ctx.font = "56px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("Leaderboard", canvas.width / 2, BOARD_Y - 40);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  // Tabs (2×2, one per board)
  const tabs = _lbTabRects();
  for (const r of tabs) {
    const active = _lbTab === r.key;
    drawUIButton(r, {
      color: active ? "#2a6e3f" : "#33334d", label: _lbBoard(r.key).tab,
      font: "33px Canterbury", textColor: active ? "#fff" : "#9a9ab0",
      stroke: active ? "#7fe0a0" : "rgba(255,255,255,0.15)", strokeW: active ? 3 : 2, dy: 2,
    });
  }

  const board = _lbBoard(_lbTab);

  // List / status
  const state = _lbState[_lbTab], rows = _lbData[_lbTab];
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (state === 'loading' || state === 'idle') {
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "34px Canterbury";
    ctx.fillText("Loading…", canvas.width / 2, LB_LIST_TOP + 120);
  } else if (state === 'error') {
    ctx.fillStyle = "#e08080"; ctx.font = "34px Canterbury";
    ctx.fillText("Couldn't load scores.", canvas.width / 2, LB_LIST_TOP + 100);
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = "28px Canterbury";
    ctx.fillText("Check your connection, then tap Refresh.", canvas.width / 2, LB_LIST_TOP + 150);
  } else if (!rows || rows.length === 0) {
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "34px Canterbury";
    ctx.fillText("No scores yet — be the first!", canvas.width / 2, LB_LIST_TOP + 120);
  } else {
    // column captions
    ctx.shadowColor = "rgba(0,0,0,0.85)"; ctx.shadowBlur = 4; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
    ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.font = "32px Canterbury"; ctx.textBaseline = "middle";
    ctx.textAlign = "left";  ctx.fillText("Player", MARGIN + 92, LB_LIST_TOP - 26);
    ctx.textAlign = "right"; ctx.fillText(board.metric, MARGIN + BOARD_PX - 24, LB_LIST_TOP - 26);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    const rankColors = ["#ffd24d", "#dcdce6", "#e09a58"];
    for (let i = 0; i < Math.min(rows.length, LB_MAX_ROWS); i++) {
      const row = rows[i], y = LB_LIST_TOP + i * LB_ROW_H, midY = y + (LB_ROW_H - 6) / 2;
      // Solid, dark row strip so text reads clearly over the scrolling ground.
      ctx.fillStyle = (i % 2) ? "rgba(14,14,32,0.66)" : "rgba(26,26,50,0.72)";
      ctx.beginPath(); ctx.roundRect(MARGIN, y, BOARD_PX, LB_ROW_H - 6, 6); ctx.fill();
      ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 4; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
      ctx.fillStyle = i < 3 ? rankColors[i] : "rgba(255,255,255,0.75)";
      ctx.font = "34px Canterbury"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(`${i + 1}.`, MARGIN + 20, midY);
      // Name on top, date/time beneath.
      ctx.fillStyle = "#fff"; ctx.font = "33px Canterbury";
      ctx.fillText(String(row.name || "—").slice(0, 20), MARGIN + 92, midY - 9);
      ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.font = "23px Canterbury";
      ctx.fillText(_lbFormatDate(row.created_at), MARGIN + 92, midY + 15);
      ctx.fillStyle = "#8dedb0"; ctx.font = "36px Canterbury"; ctx.textAlign = "right";
      ctx.fillText(_lbFormatValue(_lbTab, row.value), MARGIN + BOARD_PX - 24, midY);
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    }
  }

  // Buttons
  const drawBtn = (r, fill, label) => drawUIButton(r, { color: fill, label, stroke: "rgba(255,255,255,0.3)", dy: 2 });
  drawBtn(LB_BACK_BTN, "#4a3a7a", "‹ Back");
  drawBtn(LB_REFRESH_BTN, "#2a5a7a", "Refresh");
  ctx.textBaseline = "alphabetic";
}

function handleLeaderboardClick(cx, cy) {
  const inR = (r) => _inRect(cx, cy, r);
  if (inR(LB_BACK_BTN)) { playSfx('button'); leaderboardOpen = false; draw(); return; }
  if (inR(LB_REFRESH_BTN)) { playSfx('button'); _lbState[_lbTab] = 'idle'; _lbFetch(_lbTab); return; }
  const tabs = _lbTabRects();
  for (const r of tabs) {
    if (inR(r)) {
      if (_lbTab !== r.key) { _lbTab = r.key; playSfx('draw'); if (_lbState[r.key] !== 'ready') _lbFetch(r.key); else draw(); }
      return;
    }
  }
}

// Brief banner when an achievement unlocks mid-game (fades after ~3.5s).
function drawAchievementToast() {
  if (!_achToast) return;
  const t = performance.now() - _achToast.startMs;
  if (t > 3500) { _achToast = null; return; }
  const alpha = t < 300 ? t / 300 : (t > 3000 ? Math.max(0, 1 - (t - 3000) / 500) : 1);
  const bw = Math.min(canvas.width - 40, 560), bh = 92, bx = (canvas.width - bw) / 2, by = BOARD_Y + 12;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = "#2a8f4f"; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.stroke();
  ctx.fillStyle = "#eaffea"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "30px Canterbury"; ctx.fillText("Achievement Unlocked!", bx + bw / 2, by + 30);
  ctx.font = "40px Canterbury"; ctx.fillStyle = "#fff"; ctx.fillText(_achToast.name, bx + bw / 2, by + 66);
  ctx.restore();
  ctx.textBaseline = "alphabetic";
}

function draw() {
  if (_instant) return; // headless re-sim: no rendering
  _uiButtons = [];      // rebuilt each frame as buttons draw; used for press hit-testing
  _drawScene();
  _drawPressedOverlay(); // darken whatever button is currently held down
  _drawVersionLabel();   // "v<n>" in the lower-left corner, on every screen
}
function _drawVersionLabel() {
  ctx.save();
  ctx.font = "22px monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 3; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText("v" + VERSION, 8, canvas.height - 6);
  ctx.restore();
}
// "Your Move" indicator: a persistent label above the board plus a gold border that pulses (flashes)
// continuously the whole time it's the player's move, and vanishes while Black is going. Without it,
// a paralyzed Black King (Black passes instantly) reads as "the enemy is still thinking" and the
// player sits waiting. Both ride the always-on idle repaint loop, so no extra RAF loop is needed.
function drawTurnIndicator() {
  if (gamePhase !== 'playing' || gameOver || replayMode || _rewinderSaveOffer || _conquestGifActive) return;
  if (turn !== W || aiThinking || anim || waveAnim) return;
  ctx.save();
  // Continuously-flashing gold border hugging the board (only ever shown on the player's turn).
  ctx.strokeStyle = `rgba(232, 201, 106, ${(0.45 + 0.35 * Math.sin(performance.now() / 400)).toFixed(3)})`;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.roundRect(MARGIN - 4, BOARD_Y + MARGIN - 4, BOARD_PX + 8, BOARD_PX + 8, 8); ctx.stroke();
  // "Your Move" label above the board — styled like the status labels (drop-shadowed, no chip).
  // In Timed mode it sits above the countdown timer.
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  // Pulse the label white ↔ gold, in sync with the board border so its gold peak (232,201,106 —
  // the border's colour) lands as the border is at its strongest.
  const _p = 0.5 - 0.5 * Math.sin(performance.now() / 400); // 0 = gold (border peak), 1 = white
  ctx.fillStyle = `rgb(${Math.round(232 + 23 * _p)}, ${Math.round(201 + 54 * _p)}, ${Math.round(106 + 149 * _p)})`;
  ctx.fillText("Your Move", MARGIN + BOARD_PX / 2, timedMode ? (LOGO_H / 2 - 50) : (LOGO_H / 2));
  ctx.restore();
}

function _drawScene() {
  if (!spritesLoaded) { _drawSplash(); return; }
  if (!_continued) { drawStartScreen(); return; }
  if (achievementsOpen) { drawAchievementsScreen(); return; }
  if (leaderboardOpen) { drawLeaderboardScreen(); return; }
  if (mainMenuOpen) { drawMainMenu(); return; }
  if (gamePhase === 'playing' && !replayMode) checkAchievements();
  const _animT = anim ? easeOut(Math.min(1, (performance.now() - anim.startMs) / anim.dur)) : 1;
  const _animToSet = (() => {
    const s = new Set();
    if (anim && anim.pieces) {
      for (const p of anim.pieces) {
        s.add(p.toIdx);                          // always suppress landing square (no flash at final frame)
        if (p.fromIdx != null) s.add(p.fromIdx); // always suppress source
      }
    }
    return s;
  })();
  const _fieldAnim = anim && anim.boardDy !== 0 && _animT < 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawBackground(_fieldAnim, _animT);
  // Capture shake: jiggle the board horizontally; pieces hop per-square via _pieceHopAt(i).
  const _shakeX = _captureShakeX();
  ctx.save();
  ctx.translate(_shakeX, 0);
  drawBoardArea(_animT, _animToSet, _fieldAnim);
  ctx.restore();
  drawFogWindow();
  drawTurnIndicator();
  if (_conquestGifActive) {
    ctx.fillStyle = "rgba(0,0,0,0.20)";
    ctx.fillRect(MARGIN, BOARD_Y + MARGIN, BOARD_PX, BOARD_PX);
    const _cf = _conquestFrames[_conquestCurrentFrame];
    if (_cf && _cf.complete) ctx.drawImage(_cf, 0, 0, canvas.width, canvas.height);
  }
  drawInventoryPanel();
  drawActionButtons();
  drawGameOverOverlay();
  drawReplayControls();
  drawKingDialogue();
  drawResignConfirm();
  drawFieldAdvanceConfirm();
  drawRewinderSaveOffer();
  drawShieldPops();
  drawExplosion();
  drawVoidDeath();
  drawFireDeaths();
  drawPromoDialog();
  drawShopDialog();
  if (shopMode && sellMode) drawInventoryPanel(); // lift inventory above the shop backdrop while selling
  drawSellConfirm();
  drawFlyAnims();
  // Logo — topmost layer
  const logoEl = spriteImages["logo"];
  if (logoEl && logoEl.width > 0) {
    const maxW = canvas.width - MARGIN * 2;
    const scale = Math.min(maxW / logoEl.width, (LOGO_H - 8) / logoEl.height);
    const lw = logoEl.width * scale, lh = logoEl.height * scale;
    ctx.drawImage(logoEl, MARGIN, (LOGO_H - lh) / 2, lw, lh);
  }
  drawAchievementToast();
}

function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * canvas.width / rect.width,
          (e.clientY - rect.top) * canvas.height / rect.height];
}

// --- Button press feedback ----------------------------------------------------
// Every button registers its rect while drawing (_registerBtn). On pointerdown we find the
// button under the point and mark it pressed; draw() then darkens it (a "tapped" look) until
// pointerup/cancel. This is central, so no per-button rendering changes are needed.
let _uiButtons = [];        // rects registered during the current draw()
let _pressedRect = null;    // the button currently held down (a {x,y,w,h,r})
function _registerBtn(x, y, w, h, r) { _uiButtons.push({ x, y, w, h, r: r == null ? 8 : r }); }
function _btnAt(cx, cy) {
  // last match wins → topmost (buttons drawn later, e.g. dialogs, sit on top)
  let hit = null;
  for (const b of _uiButtons) if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) hit = b;
  return hit;
}
function _drawPressedOverlay() {
  const b = _pressedRect;
  if (!b) return;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, b.r); ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.fillRect(b.x, b.y, b.w, b.h);     // darken the whole button
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(b.x, b.y, b.w, 8);       // inner top shadow → "pressed in"
  ctx.restore();
}
function _setPressed(cx, cy) {
  const b = _btnAt(cx, cy);
  if (b === _pressedRect) return;
  _pressedRect = b;
  if (_pressedRect) draw();
}
function _clearPressed() { if (_pressedRect) { _pressedRect = null; draw(); } }
canvas.addEventListener("pointerdown", (e) => { const [cx, cy] = canvasCoords(e); _setPressed(cx, cy); });
canvas.addEventListener("pointerup", _clearPressed);
canvas.addEventListener("pointercancel", _clearPressed);
canvas.addEventListener("pointerleave", _clearPressed);

// Canonical UI button: registers for press feedback, drops the standard shadow, fills a rounded
// rect, optional stroke, centered Canterbury label. All screens' buttons route through here so
// geometry, shadow, and press-darkening stay consistent (previously ~6 near-identical closures).
function drawUIButton(r, { color, label, radius = 8, font = "38px Canterbury", textColor = "#fff", stroke = null, strokeW = 2, dy = 0 } = {}) {
  _registerBtn(r.x, r.y, r.w, r.h, radius);
  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, radius); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeW; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, radius); ctx.stroke(); }
  if (label) {
    ctx.fillStyle = textColor; ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + dy);
  }
}
// Point-in-rect hit test for {x,y,w,h} button rects (replaces per-handler inR closures).
function _inRect(cx, cy, r) { return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h; }

function trashBounds() {
  const invY = INV_PANEL_TOP + 50;
  const panelH = INV_ROWS * (INV_SLOT + INV_PAD) + INV_PAD + 28;
  return { x: INV_X, y: invY - 24 + panelH + 10, w: INV_W, h: 54 };
}

canvas.addEventListener("mousedown", (e) => {
  if (replayMode || gameOver || _turnBusy() || shopMode || sellMode || sellConfirmSlot >= 0 || gamePhase !== 'playing') return;
  const [cx, cy] = canvasCoords(e);
  const invY = INV_PANEL_TOP + 50;
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const slotIdx = r * INV_COLS + c;
      if (inventory[slotIdx] === ITEM_NONE) continue;
      const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
      const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
      if (cx >= sx && cx <= sx + INV_SLOT && cy >= sy && cy <= sy + INV_SLOT) {
        _pendingDrag = { slot: slotIdx, startX: cx, startY: cy, startMs: performance.now() };
        return;
      }
    }
  }
});

function _activatePendingDrag() {
  if (!_pendingDrag || dragSlot >= 0) return;
  dragSlot = _pendingDrag.slot;
  dragX = _pendingDrag.startX; dragY = _pendingDrag.startY; dragOverTrash = false;
  _pendingDrag = null;
  _kingInspectItem(inventory[dragSlot]); // dragging an item out also counts as selecting it
  draw();
}

canvas.addEventListener("mousemove", (e) => {
  if (bombMode) {
    const [cx, cy] = canvasCoords(e);
    const gx = Math.floor((cx - MARGIN) / TILE), gy = Math.floor((cy - BOARD_Y - MARGIN) / TILE);
    const newHover = inB(gx, gy) ? idx(gx, gy) : -1;
    if (newHover !== bombHoverIdx) { bombHoverIdx = newHover; draw(); }
  }
  if (_pendingDrag) {
    const [cx, cy] = canvasCoords(e);
    const dx = cx - _pendingDrag.startX, dy = cy - _pendingDrag.startY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    const held = performance.now() - _pendingDrag.startMs;
    if (moved > 8 || held > 300) _activatePendingDrag();
  }
  if (dragSlot < 0) return;
  const [cx, cy] = canvasCoords(e);
  dragX = cx; dragY = cy;
  const tb = trashBounds();
  dragOverTrash = cx >= tb.x && cx <= tb.x + tb.w && cy >= tb.y && cy <= tb.y + tb.h;
  draw();
});

canvas.addEventListener("mouseup", (e) => {
  _pendingDrag = null;
  if (dragSlot < 0) return;
  const [cx, cy] = canvasCoords(e);
  const slot = dragSlot;
  const item = inventory[slot];
  dragSlot = -1; dragOverTrash = false;

  const tb = trashBounds();
  if (cx >= tb.x && cx <= tb.x + tb.w && cy >= tb.y && cy <= tb.y + tb.h) {
    _logInput({ t: 'tr', s: slot }); // drag-to-trash destroys the item — validator must replay it
    removeFromInventory(slot);
    dragConsumed = true;
    draw();
    return;
  }

  // Check if dropped onto the board
  const gx = Math.floor((cx - MARGIN) / TILE);
  const gy = Math.floor((cy - BOARD_Y - MARGIN) / TILE);
  if (turn === W && !aiThinking && !shopMode && inB(gx, gy)) {
    const i = idx(gx, gy);
    inventory._activeSlot = slot;

    if (isPromoterItem(item) && sides[i] === W && board[i] === PAWN) {
      _logItemUse(slot, false, [i]);
      _promotePawnTo(item, i);
      removeFromInventory(slot); delete inventory._activeSlot;
      piecePromoterMode = false; piecePromoterTo = NONE;
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_SHIELD && sides[i] === W) {
      _logItemUse(slot, false, [i]);
      _applyStatEffect(ITEM_SHIELD, i);
      removeFromInventory(slot); delete inventory._activeSlot;
      shieldMode = false;
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_TELEPORTER && sides[i] === W) {
      teleporterMode = true; teleporterSelected = i;
      selected = -1; validMoves = [];
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_CLONER && sides[i] === W && adjacentClonerDests(i).length > 0) {
      clonerMode = true; clonerSelected = i;
      selected = -1; validMoves = [];
      dragConsumed = true; draw(); return;
    }
    // Bomb: detonate at the drop square (handleBombClick removes the item + boom).
    if (item === ITEM_BOMB) {
      bombMode = true; bombHoverIdx = -1;
      dragConsumed = true;
      handleBombClick(cx, cy);
      return;
    }
    // Stat buffs / Elementalizer: apply to the piece under the drop, via the same
    // handlers the click path uses (they remove the item on a valid target, or
    // cancel the mode harmlessly on an invalid one).
    if (item === ITEM_SWORD)        { swordMode = true;        dragConsumed = true; handleSwordClick(cx, cy); return; }
    if (item === ITEM_VAMPIRE_FANG) { vampireFangMode = true;  dragConsumed = true; handleVampireFangClick(cx, cy); return; }
    if (item === ITEM_BOOTS)        { speedMode = true;        dragConsumed = true; handleSpeedClick(cx, cy); return; }
    if (isElementalizerItem(item)) {
      elementizerMode = true;
      elementizerMystery = (item === ITEM_ELEM_MYSTERY);
      elementizerElem = elementizerMystery ? 0 : elemFromItem(item, false);
      dragConsumed = true; handleElementizerClick(cx, cy); return;
    }
    delete inventory._activeSlot;
  }

  draw();
});

// --- Click handler sub-functions ---

function handleReplayClick(cx, cy) {
  if (_miniReplayActive) return; // mini replay draws no controls — invisible buttons must not react (Exit would end the game!)
  const ctrlX = MARGIN, ctrlY = INV_PANEL_BOTTOM + 90;
  const ctrlH = 130;
  const midX = ctrlX + BOARD_PX / 2;
  const bW = 140, bH = 52, bGap = 14;
  const totalBW = 4 * bW + 3 * bGap;
  let bx = midX - totalBW / 2;
  const by = ctrlY + ctrlH - bH - 14;
  const ids = ['prev', 'next', 'auto', 'exit'];
  for (const id of ids) {
    if (cx >= bx && cx <= bx + bW && cy >= by && cy <= by + bH) {
      playSfx('button');
      if (id === 'prev') stepReplay(-1);
      else if (id === 'next') stepReplay(1);
      else if (id === 'auto') toggleReplayAutoPlay();
      else if (id === 'exit') exitReplay();
      return;
    }
    bx += bW + bGap;
  }
}

function handleGameOverClick(cx, cy) {
  const inR = (r) => _inRect(cx, cy, r);
  const L = _gameOverBtns();
  if (L.eligible && inR(L.submit)) { playSfx('button'); _lbSubmit(); return; }
  if (inR(L.startOver)) { playSfx('button'); initBoard(); draw(); return; }
  if (inR(L.replay)) { playSfx('button'); enterReplay(); return; }
}

function handleItemCancelOrTrash(cx, cy) {
  const halfW = BOARD_PX / 2 - BTN_GAP / 2;
  const btnH = 80;
  if (cx >= MARGIN && cx <= MARGIN + halfW && cy >= BTN_Y && cy <= BTN_Y + btnH) {
    // Logged for the validator: a board-space item mode was entered as a side effect of a
    // logged move, so the re-sim must cancel it too (harmless no-op for inventory modes).
    playSfx('button'); _logInput({ t: 'ic' }); cancelItemMode(); return true;
  }
  if (cx >= MARGIN + BOARD_PX / 2 + BTN_GAP / 2 && cx <= MARGIN + BOARD_PX && cy >= BTN_Y && cy <= BTN_Y + btnH) {
    // Trash destroys the item — a real inventory change the validator must replay.
    playSfx('button'); _logInput({ t: 'tr', s: inventory._activeSlot !== undefined ? inventory._activeSlot : -1 }); trashActiveItem(); return true;
  }
  return false;
}

function handleShopClick(cx, cy) {
  const dlgW = 820, dlgH = 500, dlgX = (canvas.width - 820) / 2, dlgY = (canvas.height - 500) / 2;
  const cardW = 220, cardH = 300, cardGap = 20;
  const cardsStartX = dlgX + (dlgW - 3 * cardW - 2 * cardGap) / 2;
  const cardsY = dlgY + 120;
  for (let i = 0; i < shopOffers.length; i++) {
    const price = itemPrice(shopOffers[i]);
    const cardX = cardsStartX + i * (cardW + cardGap);
    const btnX = cardX + 14, btnY = cardsY + cardH - 54, btnW = cardW - 28, btnH = 44;
    if (cx >= btnX && cx <= btnX + btnW && cy >= btnY && cy <= btnY + btnH && gold >= price && !merchantSold[i]) {
      _logInput({ t: 'buy', i });
      gold -= price;
      playSfx('buy'); playSfx('pickup');
      const _mSlot = findInventorySlot();
      if (_mSlot < 0) { draw(); return; }
      const [_mx, _my] = xy(merchantIdx);
      _pendingShopFlies.push({ item: shopOffers[i], sx: MARGIN + _mx * TILE + TILE / 2, sy: BOARD_Y + MARGIN + _my * TILE + TILE / 2, slotIdx: _mSlot });
      startItemFlyAnim(shopOffers[i], cardX + cardW / 2, cardsY + cardH / 2, _mSlot);
      merchantSold[i] = true;
      draw();
      return;
    }
  }
  const closeBtnX = dlgX + dlgW - 130, closeBtnY = dlgY + dlgH - 58, closeBtnW = 110, closeBtnH = 44;
  if (cx >= closeBtnX && cx <= closeBtnX + closeBtnW && cy >= closeBtnY && cy <= closeBtnY + closeBtnH) {
    playSfx('button'); closeShop(); return;
  }
  if (cx < dlgX || cx > dlgX + dlgW || cy < dlgY || cy > dlgY + dlgH) {
    closeShop(); // tap outside dismisses (no button sound)
  }
}

// Inventory slot index under a canvas point, or -1.
function _inventorySlotAt(cx, cy) {
  const invY = INV_PANEL_TOP + 50;
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
      const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
      if (cx >= sx && cx <= sx + INV_SLOT && cy >= sy && cy <= sy + INV_SLOT) return r * INV_COLS + c;
    }
  }
  return -1;
}

function handleSellConfirmClick(cx, cy) {
  const g = _sellConfirmGeom();
  const hit = (bx) => cx >= bx && cx <= bx + g.btnW && cy >= g.btnY && cy <= g.btnY + g.btnH;
  if (hit(g.yesX)) {
    const item = inventory[sellConfirmSlot];
    if (item !== ITEM_NONE) { _logInput({ t: 'sell', s: sellConfirmSlot }); gold += sellValue(item); removeFromInventory(sellConfirmSlot); playSfx('sell'); _turnSells++; }
    sellConfirmSlot = -1; draw(); // stay in sell mode with the shop still open
    return;
  }
  if (hit(g.noX)) {
    playSfx('button'); sellConfirmSlot = -1; draw(); // back to item selection
    return;
  }
  // clicks elsewhere are ignored (modal)
}

function handlePiecePromoterClick(cx, cy) {
  const _s = inventory._activeSlot, _fs = activeItemSpaceIdx >= 0;
  const i2 = cellIdxFromCoords(cx, cy);
  const eligible = i2 >= 0 && sides[i2] === W && board[i2] === PAWN;
  if (eligible) {
    _logItemUse(_s, _fs, [i2]);
    board[i2] = piecePromoterTo === PROMOTER_WILD ? _rollWildTo() : piecePromoterTo;
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    const fromSpace = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1;
    piecePromoterMode = false; piecePromoterTo = NONE;
    if (fromSpace) { processNextQueuedItem(); } else { draw(); }
    return;
  }
  _logItemUse(_s, _fs, null);
  piecePromoterMode = false; piecePromoterTo = NONE;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function handleShieldClick(cx, cy) {
  const _s = inventory._activeSlot, _fs = activeItemSpaceIdx >= 0;
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0 && sides[i] === W) {
    _logItemUse(_s, _fs, [i]);
    _applyStatEffect(ITEM_SHIELD, i);
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    shieldMode = false; draw(); return;
  }
  _logItemUse(_s, _fs, null);
  shieldMode = false;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function handleBombClick(cx, cy) {
  const _s = inventory._activeSlot, _fs = activeItemSpaceIdx >= 0;
  const i = cellIdxFromCoords(cx, cy);
  bombMode = false; bombHoverIdx = -1;
  _logItemUse(_s, _fs, i >= 0 ? [i] : null);
  // Only consume the bomb when actually detonated — an off-board click cancels harmlessly
  // (was: consumed even on cancel, silently eating the bomb + desyncing the input log).
  if (i < 0) { if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); return; }
  if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
  _bombSource = 'inv'; // Bomb used from inventory
  detonateBomb(i);
  recordPosition();
  if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); } else { draw(); }
}

function handleClonerClick(cx, cy) {
  const _s = inventory._activeSlot, _fs = activeItemSpaceIdx >= 0;
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0) {
    if (clonerSelected < 0) {
      if (sides[i] === W && adjacentClonerDests(i).length > 0) {
        clonerSelected = i; draw(); return;
      }
    } else {
      const dests = adjacentClonerDests(clonerSelected);
      if (dests.includes(i)) {
        _logItemUse(_s, _fs, [clonerSelected, i]);
        if (chestSpaces.has(i)) { chestSpaces.delete(i); playSfx('chest'); playSfx('pickup'); const _ci = _randomItem(); const [_cx2,_cy2]=xy(i); startItemFlyAnim(_ci, MARGIN+_cx2*TILE+TILE/2, BOARD_Y+MARGIN+_cy2*TILE+TILE/2, findInventorySlot()); }
        copyPiece(clonerSelected, i); sides[i] = W; playSfx('clone');
        _igniteOnLand(i); // clone dropped onto enemy fire — catches fire
        if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
        const clonerFromSpace = activeItemSpaceIdx >= 0;
        activeItemSpaceIdx = -1; clonerMode = false; clonerSelected = -1;
        // Check if clone landed on an item space
        const cloneItem = itemSpaces[i];
        if (!clonerFromSpace && cloneItem !== ITEM_NONE && sides[i] === W && canItemAffectPiece(cloneItem, i)) {
          itemSpaces[i] = ITEM_NONE;
          activeItemSpaceIdx = i;
          const done = activateItemSpace(cloneItem, i);
          if (done) { firstMoveMade = true; recordPosition(); endWhiteTurn(); }
        } else if (clonerFromSpace) {
          processNextQueuedItem();
        } else {
          firstMoveMade = true; recordPosition(); draw();
        }
        return;
      } else if (sides[i] === W && adjacentClonerDests(i).length > 0) {
        clonerSelected = i; draw(); return;
      }
    }
  }
  const clonerCancelSpace = activeItemSpaceIdx >= 0;
  _logItemUse(_s, clonerCancelSpace, null);
  activeItemSpaceIdx = -1; clonerMode = false; clonerSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  if (clonerCancelSpace) { processNextQueuedItem(); } else { draw(); }
}


function handleTeleporterClick(cx, cy) {
  const _s = inventory._activeSlot, _fs = activeItemSpaceIdx >= 0;
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0) {
    if (teleporterSelected < 0) {
      if (sides[i] === W) { teleporterSelected = i; draw(); return; }
    } else {
      if (board[i] === NONE) {
        _logItemUse(_s, _fs, [teleporterSelected, i]);
        playSfx('teleport');
        if (chestSpaces.has(i)) { chestSpaces.delete(i); playSfx('chest'); playSfx('pickup'); const _ci = _randomItem(); const [_cx2,_cy2]=xy(i); startItemFlyAnim(_ci, MARGIN+_cx2*TILE+TILE/2, BOARD_Y+MARGIN+_cy2*TILE+TILE/2, findInventorySlot()); }
        const _tPiece0 = board[teleporterSelected], _tHlth0 = health[teleporterSelected];
        const _tElem0 = elements[teleporterSelected], _tStat0 = statuses[teleporterSelected], _tAtk0 = attacks[teleporterSelected], _tSpd0 = speeds[teleporterSelected];
        const _tOrd0 = [...effectOrders[teleporterSelected]];
        board[i] = _tPiece0; sides[i] = W; health[i] = _tHlth0;
        elements[i] = _tElem0; statuses[i] = _tStat0; attacks[i] = _tAtk0; speeds[i] = _tSpd0; effectOrders[i] = _tOrd0;
        board[teleporterSelected] = NONE; sides[teleporterSelected] = 0; health[teleporterSelected] = 1;
        elements[teleporterSelected] = 0; statuses[teleporterSelected] = 0; attacks[teleporterSelected] = 1; speeds[teleporterSelected] = 1; effectOrders[teleporterSelected] = [];
        if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
        const fromSpace = activeItemSpaceIdx >= 0;
        activeItemSpaceIdx = -1; teleporterMode = false; teleporterSelected = -1;
        const _tPiece = board[i] || _tPiece0, _tHlth = health[i] || _tHlth0;
        _igniteOnLand(i); // teleported onto enemy fire — catches fire (checkWhiteKingAlive below covers the King)
        const _tFinish = () => {
          checkWhiteKingAlive();
          if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
          if (fromSpace) {
            if (_speedIdx >= 0) _speedIdx = i; // piece teleported; redirect speed second move to destination
            processNextQueuedItem();
          } else {
            recordPosition();
            const itm = itemSpaces[i];
            if (itm !== ITEM_NONE && sides[i] === W && canItemAffectPiece(itm, i)) {
              activateItemSpace(itm, i); // item activates but turn continues — player still moves
            } else { draw(); }
          }
        };
        if (isVoidSpace(i) && _tPiece !== NONE) {
          const [vx, vy] = xy(i);
          startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _tPiece, W, _tFinish);
        } else { _tFinish(); }
        return;
      } else if (sides[i] === W) { teleporterSelected = i; draw(); return; }
    }
  }
  const teleFromSpace = activeItemSpaceIdx >= 0;
  _logItemUse(_s, teleFromSpace, null);
  activeItemSpaceIdx = -1; teleporterMode = false; teleporterSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  if (teleFromSpace) { processNextQueuedItem(); } else { draw(); }
}

function handleElementizerClick(cx, cy) {
  const _s = inventory._activeSlot, _fs = activeItemSpaceIdx >= 0;
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0 && sides[i] === W) {
    _logItemUse(_s, _fs, [i]);
    const resolvedElem = elementizerMystery ? ELEM_ALL[randInt(4)] : elementizerElem;
    effectOrders[i] = effectOrders[i].filter(e => e !== 'fire' && e !== 'water' && e !== 'earth' && e !== 'air');
    elements[i] = resolvedElem;
    _grantEffect(i, _ELEM_BADGE[resolvedElem]);
    playSfx('spell'); // item grants a piece an effect
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    const fromSpace = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1; elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
    if (fromSpace) { processNextQueuedItem(); } else { firstMoveMade = true; recordPosition(); draw(); }
    return;
  }
  const fromSpace = activeItemSpaceIdx >= 0;
  _logItemUse(_s, fromSpace, null);
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  activeItemSpaceIdx = -1; elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  if (fromSpace) { processNextQueuedItem(); } else { draw(); }
}

// Shared handler for single-target stat-buff item modes (Sword, Speed, Vampire Fang).
// Applies `item` to a clicked White piece, else cancels; `clearMode` resets the mode flag.
function _handleStatItemClick(cx, cy, item, clearMode) {
  const _s = inventory._activeSlot;
  const i = cellIdxFromCoords(cx, cy);
  const fromSpace = activeItemSpaceIdx >= 0;
  const hit = i >= 0 && sides[i] === W;
  _logItemUse(_s, fromSpace, hit ? [i] : null);
  if (hit) {
    _applyStatEffect(item, i);
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
  } else if (inventory._activeSlot !== undefined) {
    delete inventory._activeSlot;
  }
  activeItemSpaceIdx = -1; clearMode();
  if (fromSpace) { processNextQueuedItem(); }
  else if (hit) { firstMoveMade = true; recordPosition(); draw(); }
  else { draw(); }
}

function handleVampireFangClick(cx, cy) { _handleStatItemClick(cx, cy, ITEM_VAMPIRE_FANG, () => { vampireFangMode = false; }); }
function handleSwordClick(cx, cy)       { _handleStatItemClick(cx, cy, ITEM_SWORD, () => { swordMode = false; }); }
function handleSpeedClick(cx, cy)       { _handleStatItemClick(cx, cy, ITEM_BOOTS, () => { speedMode = false; }); }

function handleFieldAdvanceConfirmClick(cx, cy) {
  const g = _faConfirmBtns();
  if (_inRect(cx, cy, g.yes)) { playSfx('button'); _faConfirm = false; fieldAdvance(true); }
  else if (_inRect(cx, cy, g.no)) { playSfx('button'); _faConfirm = false; draw(); }
}

function handleResignConfirmClick(cx, cy) {
  const confirmY = GRAVE_Y + GRAVE_H + 12;
  const panelH = 72, btnW = 100, btnH = 52, gap = 16;
  const midY = confirmY + panelH / 2;
  const btnY = midY - btnH / 2;
  ctx.font = "37px Canterbury";
  const labelW = ctx.measureText("Are you sure?  ").width;
  const totalW = labelW + btnW + gap + btnW;
  const yesX = MARGIN + (BOARD_PX - totalW) / 2 + labelW;
  const noX  = yesX + btnW + gap;
  if (cx >= yesX && cx <= yesX + btnW && cy >= btnY && cy <= btnY + btnH) {
    playSfx('button'); resignConfirm = false; gameOver = true;
    stopWindLoop(0); // silence ambient wind on resign
    gameMsg = `Resigned. Kings Taken: ${score}`;
    selected = -1; validMoves = []; draw();
  } else if (cx >= noX && cx <= noX + btnW && cy >= btnY && cy <= btnY + btnH) {
    playSfx('button'); resignConfirm = false; draw();
  }
}

// Inventory slot (holding an item) under a tap, or -1. Geometry mirrors handleInventoryClick's grid.
function _invSlotAt(cx, cy) {
  const invY = INV_PANEL_TOP + 50;
  for (let r = 0; r < INV_ROWS; r++) for (let c = 0; c < INV_COLS; c++) {
    const slotIdx = r * INV_COLS + c;
    const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
    const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
    if (cx >= sx && cx <= sx + INV_SLOT && cy >= sy && cy <= sy + INV_SLOT && inventory[slotIdx] !== ITEM_NONE) return slotIdx;
  }
  return -1;
}
function handleInventoryClick(cx, cy) {
  // anim/waveAnim guard: the click dispatcher already blocks mid-animation taps, but direct
  // callers (replay driver, autoplay) bypass it — using an item mid-slide silently corrupts
  // (e.g. the mode opens against a board the current animation is about to change).
  if (gamePhase !== 'playing' || turn !== W || aiThinking || anim || waveAnim) return false;
  const invY = INV_PANEL_TOP + 50;
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const slotIdx = r * INV_COLS + c;
      const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
      const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
      if (!(cx >= sx && cx <= sx + INV_SLOT && cy >= sy && cy <= sy + INV_SLOT)) continue;
      const item = inventory[slotIdx];
      if (item === ITEM_NONE) continue;
      playSfx('pickup'); // player selected an inventory item
      _kingInspectItem(item); // the King remarks on the selected item (also drops the board marker ring)
      const modeMap = {
        [ITEM_TELEPORTER]:   () => { teleporterMode = true; teleporterSelected = -1; },
        [ITEM_CLONER]:       () => { clonerMode = true; clonerSelected = -1; },
        [ITEM_SHIELD]:     () => { shieldMode = true; },
        [ITEM_BOMB]:         () => { bombMode = true; bombHoverIdx = -1; },
      };
      if (isPromoterItem(item)) modeMap[item] = () => { piecePromoterMode = true; piecePromoterTo = promoterTo(item); };
      if (isElementalizerItem(item)) modeMap[item] = () => { elementizerMode = true; elementizerMystery = (item === ITEM_ELEM_MYSTERY); elementizerElem = elementizerMystery ? 0 : elemFromItem(item, false); };
      if (item === ITEM_VAMPIRE_FANG) modeMap[item] = () => { vampireFangMode = true; };
      if (item === ITEM_SWORD) modeMap[item] = () => { swordMode = true; };
      if (item === ITEM_BOOTS) modeMap[item] = () => { speedMode = true; };
      // Rewinder: immediate action, no board-interaction mode
      if (item === ITEM_REWINDER) {
        if (_turnStartSnapIndices.length < 1) return true; // nothing to undo yet
        _logInput({ t: 'rw' }); // Phase-3 validator rewinds its sim + RNG to THIS turn's start, dropping the aborted turn's inputs
        // Restore the START OF THE CURRENT TURN — undo just this turn's actions (matches the death-save
        // Rewinder). Popping to the PRIOR turn start over-rewound a full round: it brought back pieces
        // the bomb had killed but dropped anything acquired since (e.g. a Bomb bought/found last turn).
        const targetIdx = _turnStartSnapIndices.pop();
        const targetSnap = replaySnapshots[targetIdx];
        replaySnapshots.splice(targetIdx + 1);
        _replayTransitions.splice(targetIdx + 1);
        applyReplaySnapshot(targetSnap);
        // removeFromInventory must NOT use pre-restore slotIdx — the restore already
        // replaces inventory with the snapshot's state (which predates the Rewinder).
        // If the Rewinder somehow persisted in the restored inventory, remove it now.
        const rSlot = inventory.indexOf(ITEM_REWINDER);
        if (rSlot >= 0) inventory[rSlot] = ITEM_NONE;
        turn = W; aiThinking = false; selected = -1; validMoves = [];
        _resetTurnState(); _resetTurnCounters(); // rewound to turn start — discard the aborted turn's counters
        shopMode = false;
        stopWhiteTurnTimer(); startWhiteTurnTimer();
        draw();
        return true;
      }
      if (modeMap[item]) {
        modeMap[item]();
        selected = -1; validMoves = [];
        inventory._activeSlot = slotIdx;
        draw();
        return true;
      }
    }
  }
  return false;
}

function handleBoardClick(cx, cy) {
  if (aiThinking || turn !== W) return;
  hintMove = null;
  const mx = cx - MARGIN, my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  // Fog (preview) row — the virtual row directly above the board (gy === -1): inspect what's incoming.
  if (gy === -1 && gx >= 0 && gx < 8) {
    selected = -1; validMoves = []; _inspectIdx = -1; _inspectPreviewCol = gx;
    _kingInspectPreview(gx);
    draw(); return;
  }
  if (!inB(gx, gy)) { selected = -1; validMoves = []; _inspectIdx = -1; _inspectPreviewCol = -1; draw(); return; }
  const clicked = idx(gx, gy);
  _inspectIdx = clicked; _inspectPreviewCol = -1; // mark the tapped square (a ring is drawn around it)
  // Tap-to-inspect: on any tap that ISN'T a move (select, deselect, empty square, out-of-range piece,
  // a feature), the King remarks on what's there. A move tap is left to the move's own commentary.
  if (!(selected >= 0 && validMoves.includes(clicked))) _kingInspect(clicked);
  if (selected < 0) {
    if (sides[clicked] === W) { selected = clicked; validMoves = legalMoves(gx, gy); playSelectSfx(board[clicked]); }
  } else {
    if (validMoves.includes(clicked)) {
      _logInput({ t: 'm', f: selected, to: clicked }); // any board move/attack/recruit begins here
      const [pfx, pfy] = xy(selected), [ptx, pty] = xy(clicked);
      const pFromCX = MARGIN + pfx * TILE, pFromCY = BOARD_Y + MARGIN + pfy * TILE;
      const pToCX = MARGIN + ptx * TILE, pToCY = BOARD_Y + MARGIN + pty * TILE;
      // Match makeMove's castle test exactly (incl. pty===7 + rook-present) so the rook slide only
      // animates on a real castle — an Air King can now land on (6,7)/(2,7) as a plain 2-square move.
      const isCKS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && pty === 7 && ptx === 6 && !wkMoved && !wrhMoved && board[idx(7, 7)] === ROOK && sides[idx(7, 7)] === W;
      const isCQS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && pty === 7 && ptx === 2 && !wkMoved && !wraMoved && board[idx(0, 7)] === ROOK && sides[idx(0, 7)] === W;
      const clickedDest = clicked;
      firstMoveMade = true;
      // Shared bounce animation: approach target then bounce back, pop shield, call onDone.
      // suppressFromIdx: if the piece hasn't moved on the board, pass fromI to suppress ghost draw.
      const _doBounceAnim = (fromI, targetCX, targetCY, bounceI, suppressFromIdx, piece, side, hlth, onDone) => {
        const [bx, by] = xy(bounceI);
        const bounceCX = MARGIN + bx * TILE, bounceCY = BOARD_Y + MARGIN + by * TILE;
        const approach = { toIdx: bounceI, fromCX: pFromCX, fromCY: pFromCY, toCX: targetCX, toCY: targetCY, piece, side, hlth };
        const retreat  = { toIdx: bounceI, fromCX: targetCX, fromCY: targetCY, toCX: bounceCX, toCY: bounceCY, piece, side, hlth };
        if (suppressFromIdx != null) { approach.fromIdx = suppressFromIdx; retreat.fromIdx = suppressFromIdx; }
        startAnim([approach], 0, () => {
          startShieldPop(targetCX + TILE / 2, targetCY + TILE / 2); // shield blocks on impact (sound + pop)
          startAnim([retreat], 0, () => {
            onDone();
          });
        });
      };
      // Recruit a Grey: only a King (or Checkers King) recruits — attacker bounces, the Grey turns white.
      // A non-King White piece targeting a Grey KILLS it instead, and falls through to the normal
      // capture path below (moves onto the square, half gold, no point even for a Grey King).
      if (sides[clicked] === N && (board[selected] === KING || board[selected] === CHECKERS_KING)) {
        const fromI = selected;
        const attackPiece = board[fromI], attackHlth = health[fromI];
        const recruitedType = board[clicked]; // the Grey being recruited
        if (attackPiece === KING || attackPiece === CHECKERS_KING) {
          playSfx('recruit'); // King (or Checkers King) recruits the Grey
          _turnRecruited = true;                                    // recruited a Grey this turn (streak)
          if (attackPiece === CHECKERS_KING) _recruitedWithCKing = true; // recruited with a Checkers King
          if (recruitedType === CHECKERS) _recruitedCManThisRun = true;
          if (recruitedType === CHECKERS_KING) _recruitedCKingThisRun = true;
        }
        const bounceI = calcBouncePos(fromI, clicked, attackPiece);
        selected = -1; validMoves = [];
        makeMove(fromI, clicked, false);
        recordPosition();
        // Pre-register the Speed extra move at the bounce square so a Fast King recruiting a Grey
        // can still go again (mirrors the shield-bounce / merchant-engage branches). Without this
        // the turn ended after the recruit — a Fast King's second move was silently lost.
        // The else-reset matters: recruiting ON the extra move must clear the stale _speedIdx
        // from move 1, or endWhiteTurn would offer a third move.
        if (sides[bounceI] === W && speeds[bounceI] > 1 && _speedMovesUsed < speeds[bounceI] - 1) {
          _speedMovesUsed++; _speedIdx = bounceI;
        } else {
          _speedIdx = -1; _speedMovesUsed = 0;
        }
        _doBounceAnim(fromI, pToCX, pToCY, bounceI, null, attackPiece, W, attackHlth, endWhiteTurn);
        return;
      }
      // Attack shielded enemy: bounce attacker, damage enemy
      if (sides[clicked] === B && health[clicked] > attacks[selected]) {
        playSfx('shield'); // shield block sound at attack start (pop stays on impact)
        const fromI = selected;
        // A Fast piece bounced off a shielded Black piece — remember it, so finishing it
        // off this turn (with the Speed extra move) unlocks the two-hit achievement.
        if (speeds[fromI] > 1 && health[clicked] - attacks[fromI] >= 1) _turnFastBounced.add(clicked);
        const attackPiece = board[fromI], attackHlth = health[fromI];
        const result = applyShieldBounceState(fromI, clicked, attackPiece);
        const bounceI = result.bounceI;
        selected = -1; validMoves = [];
        if (result.voidDeath) { // the White attacker bounced into a Void and fell in
          _speedIdx = -1; _speedMovesUsed = 0;
          recordPosition();
          const [bvx, bvy] = xy(result.bounceI);
          const bvCX = MARGIN + bvx * TILE, bvCY = BOARD_Y + MARGIN + bvy * TILE;
          const kingFell = (result.deadPiece === KING || result.deadPiece === CHECKERS_KING);
          _doBounceAnim(fromI, pToCX, pToCY, result.bounceI, null, attackPiece, W, attackHlth, () => {
            if (kingFell) _triggerGameOver(`Game Over! Score: ${score}`);
            startVoidDeath(bvCX + TILE / 2, bvCY + TILE / 2, attackPiece, W, () => { if (gameOver) { takeReplaySnapshot(); draw(); } else endWhiteTurn(); });
          });
          return;
        }
        // Pre-register Speed so endWhiteTurn offers the extra move after the bounce
        // (mirrors the AI's _aiSpeedContinue after a shield bounce).
        const _sbFinalI = result.bounceI;
        if (sides[_sbFinalI] === W && speeds[_sbFinalI] > 1 && _speedMovesUsed < speeds[_sbFinalI] - 1) {
          _speedMovesUsed++; _speedIdx = _sbFinalI;
        } else {
          _speedIdx = -1; _speedMovesUsed = 0; // bounce ON the extra move: clear the stale move-1 registration (no third move)
        }
        recordPosition();
        _doBounceAnim(fromI, pToCX, pToCY, bounceI, null, attackPiece, W, attackHlth, endWhiteTurn);
        return;
      }
      // Engage merchant: bounce attacker, open shop, then end turn
      if (clicked === merchantIdx) {
        const fromI = selected;
        const attackPiece = board[fromI], attackHlth = health[fromI], attackElem = elements[fromI], attackStat = statuses[fromI], attackAtk = attacks[fromI], attackSpd = speeds[fromI], attackEff = [...effectOrders[fromI]];
        // Always bounce to the square directly adjacent to the merchant on the attacker's side.
        const [_mfx, _mfy] = xy(fromI), [_mtx, _mty] = xy(clicked);
        const _mdx = Math.sign(_mtx - _mfx), _mdy = Math.sign(_mty - _mfy);
        const bounceI = (attackPiece === ROOK || attackPiece === BISHOP || attackPiece === QUEEN)
          ? idx(_mtx - _mdx, _mty - _mdy)
          : fromI;
        selected = -1; validMoves = [];
        recordPosition();
        _doBounceAnim(fromI, pToCX, pToCY, bounceI, fromI, attackPiece, W, attackHlth, () => {
          // Move piece to bounce square only after animation finishes to avoid mid-anim flash.
          if (bounceI !== fromI) {
            board[bounceI] = attackPiece; sides[bounceI] = W; health[bounceI] = attackHlth; elements[bounceI] = attackElem; statuses[bounceI] = attackStat; attacks[bounceI] = attackAtk; speeds[bounceI] = attackSpd; effectOrders[bounceI] = attackEff;
            clearSquare(fromI);
            // An elemental Warrior still leaves its trail along the approach even when it bounces off
            // the Merchant — the slide happened, only the landing changed. fromI is now vacant, so the
            // origin is eligible. (Runs in live and re-sim alike: replay drives this same branch.)
            if (attackElem & ELEM_EARTH) _applyEarthLanding(fromI, bounceI, W, true);
            if (attackElem & ELEM_FIRE) applyFireTrail(fromI, bounceI, attackPiece, W);
            if (attackElem & ELEM_WATER) applyWaterTrail(fromI, bounceI, attackPiece, W);
          }
          // Pre-register speed so endWhiteTurn shows second move after shop closes
          const _mSpI = bounceI !== fromI ? bounceI : fromI;
          if (speeds[_mSpI] > 1 && _speedMovesUsed < speeds[_mSpI] - 1) {
            _speedMovesUsed++; _speedIdx = _mSpI;
          } else {
            _speedIdx = -1; _speedMovesUsed = 0; // engaged ON the extra move: clear the stale move-1 registration (no third move)
          }
          openMerchantShop(endWhiteTurn);
        });
        return;
      }
      const _fromElems = elements[selected], _fromPiece = board[selected], _fromSide = sides[selected], _fromI = selected;
      const _midI2 = (Math.abs(ptx - pfx) === 2 && Math.abs(pty - pfy) === 2) ? idx((pfx + ptx) >> 1, (pfy + pty) >> 1) : -1;
      const _isCheckersJump = (_fromPiece === CHECKERS || _fromPiece === CHECKERS_KING)
        && _midI2 >= 0 && board[_midI2] !== NONE && sides[_midI2] !== _fromSide;
      const _wasCapture = sides[clicked] === B || sides[clicked] === N || _isCheckersJump; // a Grey kill also counts (Bloodthirsty)
      // Extended Air move (Knight/Pawn/King second hop) → animate hop-by-hop. Computed pre-move.
      const _airLegs = null; // Air moves are single-hop now (phasing sliders slide straight; no extended range)
      makeMove(selected, clicked, true);
      if (_fromElems & ELEM_FIRE) applyFireTrail(selected, clickedDest, _fromPiece, _fromSide);
      if (_fromElems & ELEM_WATER) applyWaterTrail(selected, clickedDest, _fromPiece, _fromSide);
      const wAnimPieces = [{
        toIdx: clickedDest,
        fromCX: pFromCX, fromCY: pFromCY, toCX: pToCX, toCY: pToCY,
        piece: board[clickedDest], side: sides[clickedDest], hlth: health[clickedDest], atk: attacks[clickedDest], spd: speeds[clickedDest],
        arc: _isCheckersJump ? TILE * 1.5 : 0
      }];
      if (isCKS) wAnimPieces.push({ toIdx: idx(5,7), fromCX: MARGIN+7*TILE, fromCY: BOARD_Y+MARGIN+7*TILE, toCX: MARGIN+5*TILE, toCY: BOARD_Y+MARGIN+7*TILE, piece: ROOK, side: W, hlth: health[idx(5,7)], atk: attacks[idx(5,7)], spd: speeds[idx(5,7)] });
      if (isCQS) wAnimPieces.push({ toIdx: idx(3,7), fromCX: MARGIN+0*TILE, fromCY: BOARD_Y+MARGIN+7*TILE, toCX: MARGIN+3*TILE, toCY: BOARD_Y+MARGIN+7*TILE, piece: ROOK, side: W, hlth: health[idx(3,7)], atk: attacks[idx(3,7)], spd: speeds[idx(3,7)] });
      // Hold captured pieces stationary at their squares during the attacker's travel
      _appendCaptureGhosts(wAnimPieces);
      selected = -1; validMoves = [];
      const _wPiece0 = board[clickedDest], _wSide0 = sides[clickedDest], _wHlth0 = health[clickedDest];
      const _wContinue = (movedTo) => {
        pendingCaptures = {};
        checkWhiteKingAlive();
        if (!gameOver) {
          if (_isCheckersJump && (board[movedTo] === CHECKERS || board[movedTo] === CHECKERS_KING) && sides[movedTo] === W) {
            const chainJumps = _checkersJumpsFrom(movedTo);
            if (chainJumps.length > 0) {
              _checkersChainIdx = movedTo;
              selected = movedTo;
              validMoves = chainJumps;
              draw();
              return;
            }
          }
          _checkersChainIdx = -1; _bloodthirstyIdx = -1;
          // Bloodthirsty: piece that just captured gets one extra move per turn (no chaining)
          if (_wasCapture && !_bloodthirstyUsed && (statuses[movedTo] & STATUS_BLOODTHIRSTY)) {
            const [_btx, _bty] = xy(movedTo);
            const _btMoves = legalMoves(_btx, _bty);
            if (_btMoves.length > 0) {
              _speedMovesUsed = 0; // capture resets speed budget
              _bloodthirstyUsed = true;
              _bloodthirstyIdx = movedTo; selected = movedTo; validMoves = _btMoves;
              draw(); return;
            }
          }
          _bloodthirstyIdx = -1;
          // Pre-register speed extra move so endWhiteTurn shows it after any item/interaction
          if (speeds[movedTo] > 1 && _speedMovesUsed < speeds[movedTo] - 1) {
            _speedMovesUsed++; _speedIdx = movedTo;
          } else {
            _speedIdx = -1; _speedMovesUsed = 0; _bloodthirstyUsed = false;
          }
          // A sky-drop targeting movedTo may not have landed yet (anim takes 380ms, move takes 180ms).
          // Intercept it early so the piece picks it up immediately.
          const pendingDropIdx = _skyDropAnims.findIndex(a => a.i === movedTo);
          if (pendingDropIdx >= 0) {
            const pd = _skyDropAnims.splice(pendingDropIdx, 1)[0];
            if (sides[movedTo] === W) activateItemSpace(pd.item, movedTo);
          }
          const item = itemSpaces[movedTo];
          if (item !== ITEM_NONE && sides[movedTo] === W && canItemAffectPiece(item, movedTo)) {
            const done = activateItemSpace(item, movedTo);
            if (done) endWhiteTurn();
            // if !done: interactive item mode active; will call endWhiteTurn when complete
          } else { endWhiteTurn(); }
        } else { draw(); }
      };
      playMoveSfx(board[clickedDest], clickedDest);
      _startMoveAnim(wAnimPieces, _airLegs, () => {
        _drainCaptureAnims();
        checkWhiteKingAlive();
        if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
        if (isVoidSpace(clickedDest) && _wPiece0 !== NONE) {
          const [vx, vy] = xy(clickedDest);
          startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _wPiece0, _wSide0, () => _wContinue(clickedDest));
        } else { _wContinue(clickedDest); }
      });
      return;
    } else if (clicked === selected) {
      if (_speedIdx >= 0) { _logInput({ t: 'p' }); _speedIdx = -1; _speedMovesUsed = 0; selected = -1; validMoves = []; endWhiteTurn(); return; }
      if (_bloodthirstyIdx >= 0) { _logInput({ t: 'p' }); _bloodthirstyIdx = -1; _bloodthirstyUsed = false; selected = -1; validMoves = []; endWhiteTurn(); return; }
      if (_checkersChainIdx < 0) { selected = -1; validMoves = []; }
    } else if (sides[clicked] === W) {
      if (_checkersChainIdx < 0 && _bloodthirstyIdx < 0 && _speedIdx < 0) { selected = clicked; validMoves = legalMoves(gx, gy); playSelectSfx(board[clicked]); }
    } else {
      if (_checkersChainIdx < 0 && _bloodthirstyIdx < 0 && _speedIdx < 0) { selected = -1; validMoves = []; }
    }
  }
  draw();
}

// True while the turn pipeline is mid-flight: any animation, wave sweep, sky drops landing,
// Black thinking/acting, or the conquest intro. Player input is accepted ONLY at full idle, so
// a tap can never interleave with turn resolution. This is the structural fix for the
// live-vs-server score mismatches: the headless re-simulation applies each logged input at
// exactly this idle state, so live play must too — any handler reachable mid-pipeline (however
// its own guards are written) is a determinism hole. One gate closes the whole class.
function _turnBusy() {
  return !!anim || !!waveAnim || _conquestGifActive ||
    (gamePhase === 'playing' && !gameOver && (aiThinking || turn !== W || _skyDropAnims.length > 0));
}

canvas.addEventListener("click", (e) => {
  if (dragConsumed) { dragConsumed = false; return; }
  const [cx, cy] = canvasCoords(e);
  if (spritesLoaded && !_continued) { _doContinue(cx, cy); return; } // start screen — tap enters the menu
  if (achievementsOpen) { handleAchievementsClick(cx, cy); return; }
  if (leaderboardOpen) { handleLeaderboardClick(cx, cy); return; }
  if (mainMenuOpen) { handleMainMenuClick(cx, cy); return; }
  if (replayMode) { handleReplayClick(cx, cy); return; }
  if (_rewinderSaveOffer) { handleRewinderSaveOfferClick(cx, cy); return; }
  if (gameOver) { handleGameOverClick(cx, cy); return; }
  if (_faConfirm) { handleFieldAdvanceConfirmClick(cx, cy); return; } // modal: capture all clicks
  if (_turnBusy()) return;
  // Long King remark: tap the dialogue box to page through it (arrow shown while more remains).
  if (_kingDialogPages > 1 && _kingDialogRect && _inRect(cx, cy, _kingDialogRect)) { _kingPage = (_kingPage + 1) % _kingDialogPages; draw(); return; }
  if (gamePhase === 'playing' && isItemActive() && handleItemCancelOrTrash(cx, cy)) return;
  if (sellConfirmSlot >= 0) { handleSellConfirmClick(cx, cy); return; }
  if (shopMode) {
    if (sellMode) {
      const _sSlot = _inventorySlotAt(cx, cy);
      if (_sSlot >= 0) { if (inventory[_sSlot] !== ITEM_NONE) { sellConfirmSlot = _sSlot; draw(); } return; }
    }
    handleShopClick(cx, cy);
    return;
  }
  // Switch items in one tap: tapping a DIFFERENT inventory item while an inventory item's mode is
  // active cancels the current mode and falls through to select the tapped one (so it gets its own
  // King comment) — instead of the active handler swallowing the tap as a plain cancel. Board-space
  // item queues (activeItemSpaceIdx >= 0) are excluded so their resolution order isn't disturbed.
  if (isItemActive() && activeItemSpaceIdx < 0) {
    const _swSlot = _invSlotAt(cx, cy);
    if (_swSlot >= 0 && _swSlot !== inventory._activeSlot) cancelItemMode(); // now all modes are off → handleInventoryClick below selects the new item
  }
  if (piecePromoterMode) { handlePiecePromoterClick(cx, cy); return; }
  if (shieldMode) { handleShieldClick(cx, cy); return; }
  if (bombMode) { handleBombClick(cx, cy); return; }
  if (clonerMode) { handleClonerClick(cx, cy); return; }
  if (teleporterMode) { handleTeleporterClick(cx, cy); return; }
  if (elementizerMode) { handleElementizerClick(cx, cy); return; }
  if (vampireFangMode) { handleVampireFangClick(cx, cy); return; }
  if (swordMode) { handleSwordClick(cx, cy); return; }
  if (speedMode) { handleSpeedClick(cx, cy); return; }
  if (resignConfirm) { handleResignConfirmClick(cx, cy); return; }
  if (isItemActive() && handleItemCancelOrTrash(cx, cy)) return;
  if (!gameOver && _inRect(cx, cy, RESIGN_BTN)) { playSfx('button'); resignConfirm = true; draw(); return; }
  if (!gameOver && replaySnapshots.length > 1 &&
      turn === W && !aiThinking &&
      _speedIdx < 0 && _bloodthirstyIdx < 0 && _checkersChainIdx < 0 && // mid-turn extra-move pending: replay would revert the first move
      _inRect(cx, cy, LAST_MOVE_BTN)) {
    playSfx('button');
    selected = -1; validMoves = []; // clear any selection — the board is about to be spliced
    replayMode = true; _miniReplayActive = true;
    // Last Move is a pure review: capture the true current state (including any items used or effects
    // applied THIS turn, which have no turn snapshot of their own) and restore it when the review ends,
    // rather than leaving the board at the last turn-start snapshot (which would undo those actions).
    const _liveState = _buildReplaySnapshot();
    _playReplayTransition(replaySnapshots.length - 1, () => {
      applyReplaySnapshot(_liveState);
      replayMode = false; _miniReplayActive = false;
      draw();
    });
    return;
  }
  if (!gameOver && _inRect(cx, cy, AUTO_BTN)) {
    playSfx('button');
    autoPlay = !autoPlay; draw();
    if (autoPlay) _autoPlayUsedThisRun = true; // auto-assisted run -> not leaderboard-eligible
    if (autoPlay && turn === W && !aiThinking && !anim) autoWhitePlay();
    return;
  }
  if (handleInventoryClick(cx, cy)) return;
  if (testMode && _inRect(cx, cy, HINT_BTN)) { playSfx('button'); showHint(); return; }
  if (gamePhase === 'setup') {
    if (_inRect(cx, cy, CLASSIC_BTN))    { playSfx('button'); _beginSetup(classicSetup); draw(); return; }
    if (_inRect(cx, cy, SETUP_ROLL_BTN)) { playSfx('button'); _beginSetup(rollSetup); draw(); return; }
    if (_inRect(cx, cy, UNTIMED_BTN))    { playSfx('button'); timedMode = false; draw(); return; }
    if (_inRect(cx, cy, TIMED_BTN))      { playSfx('button'); timedMode = true; timedModeSecs = 15; draw(); return; }
    if (_inRect(cx, cy, SETUP_GO_BTN))   { playSfx('button'); playConquestGif(); return; }
    if (_inRect(cx, cy, SETUP_BACK_BTN)) { playSfx('button'); mainMenuOpen = true; startMenuBg(); draw(); return; }
    return;
  }
  if (_inRect(cx, cy, LEAP_BTN))  { playSfx('button'); hintMove = null; teamAdvance(); return; }
  if (_inRect(cx, cy, PITCH_BTN)) {
    playSfx('button'); hintMove = null;
    if (canManualPitchShift()) {
      if (_faWillCrushWhite()) { _faConfirm = true; draw(); } // confirm before crushing your own pieces
      else fieldAdvance(true);
    }
    return;
  }
  handleBoardClick(cx, cy);
});


// ─── White Auto-Play AI ──────────────────────────────────────────────────────

let autoPlay = false;
let _autoScheduled = false;

const AUTO_BTN = { x: RESIGN_BTN.x - 176, y: RESIGN_BTN.y, w: 168, h: 60 };

function _aiPieceVal(p) {
  // Piece capture/recruit value for scoring
  return [0, 100, 500, 320, 330, 900, 100000, 250, 150][p] || 0;
}

function _aiItemVal(item) {
  if (item === ITEM_BOMB)        return 350;
  if (item === ITEM_CLONER)      return 450;
  if (item === ITEM_TELEPORTER)  return 300;
  if (item === ITEM_SHIELD)      return 200;
  if (isPromoterItem(item))      return 400;
  if (isElementalizerItem(item)) return 250;
  return 100;
}

// ── Item usage ────────────────────────────────────────────────────────────────

function _aiUseBomb() {
  // Find 3×3 center that maximises (enemy hits - white hits); must hit ≥2 enemies
  // or a Black King — don't waste a bomb on a lone pawn.
  let bestI = -1, bestScore = -Infinity;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let score = 0, enemies = 0, hitsKing = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!inB(x + dx, y + dy)) continue;
          const ni = idx(x + dx, y + dy);
          if (sides[ni] === B) {
            score += _aiPieceVal(board[ni]) * 10; enemies++;
            if (board[ni] === KING || board[ni] === CHECKERS_KING) hitsKing = true;
          }
          if (sides[ni] === W) score -= _aiPieceVal(board[ni]) * 8; // penalise own losses
        }
      }
      if ((enemies >= 2 || hitsKing) && score > 0 && score > bestScore) { bestScore = score; bestI = idx(x, y); }
    }
  }
  if (bestI < 0) return false;
  const slot = inventory.findIndex(v => v === ITEM_BOMB);
  if (slot < 0) return false;
  inventory._activeSlot = slot;
  bombMode = true; bombHoverIdx = -1;
  const [bx, by] = xy(bestI);
  // Detonate synchronously — a deferred click races the 600ms auto-play poll,
  // which could cancel bombMode and drop _activeSlot mid-flight, causing the
  // bomb to detonate WITHOUT being removed from inventory.
  handleBombClick(MARGIN + bx * TILE + TILE / 2, BOARD_Y + MARGIN + by * TILE + TILE / 2);
  return true;
}

function _aiUseShield() {
  // Shield most valuable White piece (prefer Queen/Rook, never waste on pawn if better exists)
  let bestI = -1, bestVal = 0;
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const v = _aiPieceVal(board[i]);
    if (v > bestVal) { bestVal = v; bestI = i; }
  }
  if (bestI < 0 || bestVal < PIECE_VALUE[ROOK]) return false; // only shield Rook or better
  const slot = inventory.findIndex(v => v === ITEM_SHIELD);
  if (slot < 0) return false;
  inventory._activeSlot = slot;
  shieldMode = true;
  const [sx, sy] = xy(bestI);
  setTimeout(() => handleShieldClick(MARGIN + sx * TILE + TILE / 2, BOARD_Y + MARGIN + sy * TILE + TILE / 2), 150);
  return true;
}

function _aiUsePromoter(slot, promoteTo) {
  // Find best pawn (highest y = closest to being pushed off; promote soonest)
  let bestI = -1, bestY = -1;
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W && board[i] === PAWN) {
      const [, py] = xy(i);
      if (py > bestY) { bestY = py; bestI = i; }
    }
  }
  if (bestI < 0) return false;
  inventory._activeSlot = slot;
  piecePromoterMode = true; piecePromoterTo = promoterTo(inventory[slot]);
  const [px, py] = xy(bestI);
  setTimeout(() => handlePiecePromoterClick(MARGIN + px * TILE + TILE / 2, BOARD_Y + MARGIN + py * TILE + TILE / 2), 150);
  return true;
}

function _aiUseTeleporter(slot) {
  // Move most valuable piece to best attacking square
  let bestPieceI = -1, bestPieceVal = 0;
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W || board[i] === KING) continue; // don't teleport King
    const v = _aiPieceVal(board[i]);
    if (v > bestPieceVal) { bestPieceVal = v; bestPieceI = i; }
  }
  if (bestPieceI < 0) return false;
  // Find best empty destination (score by proximity to enemies)
  let bestDestI = -1, bestDestScore = -Infinity;
  for (let i = 0; i < 64; i++) {
    if (board[i] !== NONE || chestSpaces.has(i)) continue;
    if (i === merchantIdx || isVoidSpace(i) || isBlockSpace(i)) continue; // void = death, block = illegal
    const [tx, ty] = xy(i);
    let s = (7 - ty) * 20;
    if (itemSpaces[i] !== ITEM_NONE) s += 300;
    if (s > bestDestScore) { bestDestScore = s; bestDestI = i; }
  }
  if (bestDestI < 0) return false;
  inventory._activeSlot = slot;
  teleporterMode = true; teleporterSelected = -1;
  const [px, py] = xy(bestPieceI);
  const [dx, dy] = xy(bestDestI);
  setTimeout(() => {
    handleTeleporterClick(MARGIN + px * TILE + TILE / 2, BOARD_Y + MARGIN + py * TILE + TILE / 2);
    setTimeout(() => handleTeleporterClick(MARGIN + dx * TILE + TILE / 2, BOARD_Y + MARGIN + dy * TILE + TILE / 2), 150);
  }, 150);
  return true;
}

function _aiUseCloner(slot) {
  // Clone most valuable piece to best adjacent square
  let bestI = -1, bestVal = 0;
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const v = _aiPieceVal(board[i]);
    if (v > bestVal && adjacentClonerDests(i).length > 0) { bestVal = v; bestI = i; }
  }
  if (bestI < 0) return false;
  const dests = adjacentClonerDests(bestI);
  if (dests.length === 0) return false;
  // Pick dest closest to row 0
  const destI = dests.reduce((a, b) => xy(a)[1] < xy(b)[1] ? a : b);
  inventory._activeSlot = slot;
  clonerMode = true; clonerSelected = -1;
  const [px, py] = xy(bestI);
  const [dx, dy] = xy(destI);
  setTimeout(() => {
    handleClonerClick(MARGIN + px * TILE + TILE / 2, BOARD_Y + MARGIN + py * TILE + TILE / 2);
    setTimeout(() => handleClonerClick(MARGIN + dx * TILE + TILE / 2, BOARD_Y + MARGIN + dy * TILE + TILE / 2), 150);
  }, 150);
  return true;
}

function _aiUseElementalizer(slot) {
  // Apply to most valuable non-elemental piece (prefer Queen/Rook); Fire for aggressors, Earth for defenders
  let bestI = -1, bestVal = 0;
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W || elements[i] !== 0) continue;
    const v = _aiPieceVal(board[i]);
    if (v > bestVal) { bestVal = v; bestI = i; }
  }
  if (bestI < 0) return false;
  inventory._activeSlot = slot;
  const item = inventory[slot];
  elementizerMode = true;
  elementizerMystery = (item === ITEM_ELEM_MYSTERY);
  elementizerElem = elementizerMystery ? 0 : elemFromItem(item, false);
  const [px, py] = xy(bestI);
  setTimeout(() => handleElementizerClick(MARGIN + px * TILE + TILE / 2, BOARD_Y + MARGIN + py * TILE + TILE / 2), 150);
  return true;
}

// Use a single-target stat buff (Sword / Vampire Fang / Boots) on the best
// eligible piece. Boots prefer the King (a double-move King is a huge survival
// tool); Sword/Fang prefer the most valuable attacker.
function _aiUseStatItem(slot, item, clickFn) {
  let bestI = -1, bestVal = -1;
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W || !canItemAffectPiece(item, i)) continue;
    let v = _aiPieceVal(board[i]);
    if (item === ITEM_BOOTS && (board[i] === KING || board[i] === CHECKERS_KING)) v = 1e9;
    if (item !== ITEM_BOOTS && (board[i] === KING || board[i] === CHECKERS_KING)) v = 0; // buff fighters, not the King
    if (v > bestVal) { bestVal = v; bestI = i; }
  }
  if (bestI < 0) return false;
  inventory._activeSlot = slot;
  if (item === ITEM_SWORD) swordMode = true;
  else if (item === ITEM_VAMPIRE_FANG) vampireFangMode = true;
  else if (item === ITEM_BOOTS) speedMode = true;
  const [px, py] = xy(bestI);
  setTimeout(() => clickFn(MARGIN + px * TILE + TILE / 2, BOARD_Y + MARGIN + py * TILE + TILE / 2), 150);
  return true;
}

// Try to use a high-value inventory item. Returns true if triggered (async).
function _aiTryUseItem() {
  for (let slot = 0; slot < inventory.length; slot++) {
    const item = inventory[slot];
    if (item === ITEM_NONE) continue;

    // Promoters and Clonermode: use immediately — always a tempo gain
    if (isPromoterItem(item) && _aiUsePromoter(slot)) return true;
    if (item === ITEM_CLONER && _aiUseCloner(slot)) return true;

    // Bomb: use when it hits ≥2 enemies (or a King) at positive value
    if (item === ITEM_BOMB && _aiUseBomb()) return true;

    // Shield: use on any piece worth ≥ a Rook (no threat requirement)
    if (item === ITEM_SHIELD && _aiUseShield()) return true;

    // Teleporter: use early — repositioning is almost always good
    if (item === ITEM_TELEPORTER && _aiUseTeleporter(slot)) return true;

    // Elementalizer: use on best non-elemental piece regardless of threat state
    if (isElementalizerItem(item) && _aiUseElementalizer(slot)) return true;

    // Stat buffs: apply immediately (using an item doesn't consume the turn)
    if (item === ITEM_SWORD && _aiUseStatItem(slot, item, handleSwordClick)) return true;
    if (item === ITEM_VAMPIRE_FANG && _aiUseStatItem(slot, item, handleVampireFangClick)) return true;
    if (item === ITEM_BOOTS && _aiUseStatItem(slot, item, handleSpeedClick)) return true;
  }
  return false;
}

// Handle merchant shop: buy best affordable item then close
function _aiHandleShop() {
  const dlgW = 820, dlgH = 500;
  const dlgX = (canvas.width - dlgW) / 2, dlgY = (canvas.height - dlgH) / 2;
  const cardW = 220, cardH = 300, cardGap = 20;
  const cardsStartX = dlgX + (dlgW - 3 * cardW - 2 * cardGap) / 2;
  const cardsY = dlgY + 120;

  let bestSlot = -1, bestVal = 0;
  for (let i = 0; i < shopOffers.length; i++) {
    if (merchantSold[i]) continue;
    const price = itemPrice(shopOffers[i]);
    if (gold < price) continue;
    const val = _aiItemVal(shopOffers[i]);
    if (val > bestVal) { bestVal = val; bestSlot = i; }
  }

  if (bestSlot >= 0) {
    const cardX = cardsStartX + bestSlot * (cardW + cardGap);
    const btnY = cardsY + cardH - 54;
    handleShopClick(cardX + 14 + 5, btnY + 5);
  }
  // Close the shop
  setTimeout(() => { if (shopMode) closeShop(); }, 200);
}

// ── Main auto-play step ───────────────────────────────────────────────────────

const AUTO_DEPTH = 4; // search depth for auto-play decisions (all actions compared at this depth)

function _aiWhiteStep() {
  if (!autoPlay || gameOver || turn !== W || aiThinking || anim || replayMode) return;
  if (shopMode || piecePromoterMode || shieldMode || bombMode || clonerMode || teleporterMode || elementizerMode || vampireFangMode || swordMode || speedMode) return;

  // 0. Pending extra-move (Speed / Bloodthirsty / checkers chain): only the
  //    selected piece may act — play its best continuation, or pass (click the
  //    piece again) when ending the turn scores better. Without this the auto
  //    player deadlocks trying to move other pieces.
  if (selected >= 0 && (_speedIdx >= 0 || _bloodthirstyIdx >= 0 || _checkersChainIdx >= 0)) {
    const from = selected;
    const cc = _sqCenter;
    let bestTo = -1, bestVal = -Infinity;
    for (const to of validMoves) {
      const val = withState(() => {
        const wasCap = sides[to] === B;
        makeMove(from, to); recordPosition();
        return _turnContinuation(to, _extraMoveBudget(to, wasCap), AUTO_DEPTH, -Infinity, Infinity, true);
      });
      if (val > bestVal) { bestVal = val; bestTo = to; }
    }
    const inChain = _checkersChainIdx >= 0; // chain jumps can't be passed by re-clicking
    const passVal = inChain ? -Infinity : withState(() => minimax(AUTO_DEPTH - 1, -Infinity, Infinity, false));
    const target = (bestTo >= 0 && bestVal >= passVal) ? bestTo : from;
    const [ccx, ccy] = cc(target);
    handleBoardClick(ccx, ccy);
    return;
  }

  // 1. Try using a high-value item first (bomb, cloner, promoter, buffs)
  if (_aiTryUseItem()) return;

  // 2. Compare best piece-move, Team Advance and Field Advance — all at the SAME
  //    search depth so the values are directly comparable (a move's value is
  //    "position after action" searched to AUTO_DEPTH-1 with Black to reply).
  //    When the countdown will force an auto-advance at the end of THIS turn, a
  //    plain piece move is immediately followed by that (non-scoring) forced wave
  //    — fold it into the move eval so the AI braces for the incoming preview row
  //    (and can see that a manual, scoring Field Advance is better than wasting it).
  //    Team/Field Advance reset the countdown, so they get no forced advance.
  const autoAdvanceAfterMove = shiftCountdown <= 1;
  const { move, score: moveVal } = playerBestMove(AUTO_DEPTH, autoAdvanceAfterMove);
  const advEval = (simFn) => withState(() => {
    simFn();
    recordPosition();
    return minimax(AUTO_DEPTH - 1, -Infinity, Infinity, false);
  });
  const teamVal  = canTeamLeap() ? advEval(simulateTeamAdvance) : -Infinity;
  const fieldVal = canManualPitchShift() ? advEval(simulateLeap) : -Infinity;

  // 3. Execute the highest-valued action; on ties prefer the piece move
  //    (advances are all-in tempo plays — only take them when strictly better).
  if (teamVal > moveVal && teamVal >= fieldVal) { teamAdvance(); return; }
  if (fieldVal > moveVal && fieldVal > teamVal) { fieldAdvance(true); return; }
  if (move) {
    const [fromI, toI] = move;
    const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
    handleBoardClick(MARGIN + fx * TILE + TILE / 2, BOARD_Y + MARGIN + fy * TILE + TILE / 2);
    setTimeout(() => {
      handleBoardClick(MARGIN + tx * TILE + TILE / 2, BOARD_Y + MARGIN + ty * TILE + TILE / 2);
      setTimeout(() => { if (shopMode) _aiHandleShop(); }, 250);
    }, 150);
  } else if (teamVal > -Infinity) {
    teamAdvance(); // no legal piece move — advance rather than stall
  } else if (fieldVal > -Infinity) {
    fieldAdvance(true);
  }
}

function autoWhitePlay() {
  if (!autoPlay || gameOver || turn !== W || aiThinking || anim || _autoScheduled || replayMode) return;
  _autoScheduled = true;
  const _gen = _runGen;
  setTimeout(() => { _autoScheduled = false; if (_gen !== _runGen) return; _aiWhiteStep(); }, 450);
}

// Complete an already-active interactive UI mode using canvas coords
function _aiCompleteActiveMode() {
  const cc = _sqCenter;

  if (shopMode) { _aiHandleShop(); return; }

  if (clonerMode) {
    if (clonerSelected < 0) {
      // Pick best piece to clone
      let bestI = -1, bestVal = 0;
      for (let i = 0; i < 64; i++) {
        if (sides[i] !== W) continue;
        const v = _aiPieceVal(board[i]);
        if (v > bestVal && adjacentClonerDests(i).length > 0) { bestVal = v; bestI = i; }
      }
      if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleClonerClick(cx, cy), 100); }
      else { clonerMode = false; clonerSelected = -1; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    } else {
      // Pick best destination adjacent to selected piece
      const dests = adjacentClonerDests(clonerSelected);
      if (dests.length > 0) {
        const destI = dests.reduce((a,b) => xy(a)[1] < xy(b)[1] ? a : b);
        const [cx,cy] = cc(destI); setTimeout(() => handleClonerClick(cx, cy), 100);
      } else { clonerMode = false; clonerSelected = -1; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    }
    return;
  }

  if (teleporterMode) {
    if (teleporterSelected < 0) {
      let bestI = -1, bestVal = 0;
      for (let i = 0; i < 64; i++) {
        if (sides[i] !== W || board[i] === KING) continue;
        const v = _aiPieceVal(board[i]); if (v > bestVal) { bestVal = v; bestI = i; }
      }
      if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleTeleporterClick(cx, cy), 100); }
      else { teleporterMode = false; teleporterSelected = -1; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    } else {
      let bestDestI = -1, bestDestScore = -Infinity;
      for (let i = 0; i < 64; i++) {
        if (board[i] !== NONE || chestSpaces.has(i)) continue;
        if (i === merchantIdx || isVoidSpace(i)) continue;
        const [,ty] = xy(i); let s = (7-ty)*20; if (itemSpaces[i] !== ITEM_NONE) s += 300;
        if (s > bestDestScore) { bestDestScore = s; bestDestI = i; }
      }
      if (bestDestI >= 0) { const [cx,cy] = cc(bestDestI); setTimeout(() => handleTeleporterClick(cx, cy), 100); }
      else { teleporterMode = false; teleporterSelected = -1; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    }
    return;
  }

  if (bombMode) {
    // Targeting must match _aiUseBomb (≥2 enemies OR a Black King) so this never
    // spuriously strands an armed bomb — dropping _activeSlot here would let a
    // later detonation skip removing the bomb from inventory.
    let bestI = -1, bestScore = -Infinity;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      let s = 0, enemies = 0, hitsKing = false;
      for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
        if (!inB(x+dx,y+dy)) continue; const ni=idx(x+dx,y+dy);
        if (sides[ni]===B) { s+=_aiPieceVal(board[ni])*10; enemies++; if (board[ni]===KING||board[ni]===CHECKERS_KING) hitsKing=true; }
        if (sides[ni]===W) s-=_aiPieceVal(board[ni])*8;
      }
      if ((enemies >= 2 || hitsKing) && s > bestScore) { bestScore = s; bestI = idx(x,y); }
    }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); handleBombClick(cx, cy); } // synchronous: no race window
    else { bombMode = false; bombHoverIdx = -1; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }

  if (shieldMode) {
    let bestI = -1, bestVal = 200;
    for (let i = 0; i < 64; i++) { if (sides[i]===W) { const v=_aiPieceVal(board[i]); if (v>bestVal){bestVal=v;bestI=i;} } }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleShieldClick(cx, cy), 100); }
    else { shieldMode = false; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }

  if (piecePromoterMode) {
    let bestI = -1, bestY = -1;
    for (let i = 0; i < 64; i++) { if (sides[i]===W && board[i]===PAWN) { const [,py]=xy(i); if (py>bestY){bestY=py;bestI=i;} } }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handlePiecePromoterClick(cx, cy), 100); }
    else { piecePromoterMode = false; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }

  if (elementizerMode) {
    let bestI = -1, bestVal = 0;
    for (let i = 0; i < 64; i++) { if (sides[i]===W && elements[i]===0) { const v=_aiPieceVal(board[i]); if (v>bestVal){bestVal=v;bestI=i;} } }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleElementizerClick(cx, cy), 100); }
    else { elementizerMode = false; elementizerMystery = false; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }

  if (vampireFangMode) {
    let bestI = -1, bestVal = 0;
    for (let i = 0; i < 64; i++) { if (sides[i]===W && !(statuses[i] & STATUS_BLOODTHIRSTY)) { const v=_aiPieceVal(board[i]); if (v>bestVal){bestVal=v;bestI=i;} } }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleVampireFangClick(cx, cy), 100); }
    else { vampireFangMode = false; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }

  if (swordMode) {
    let bestI = -1, bestVal = 0;
    for (let i = 0; i < 64; i++) { if (sides[i]===W) { const v=_aiPieceVal(board[i]); if (v>bestVal){bestVal=v;bestI=i;} } }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleSwordClick(cx, cy), 100); }
    else { swordMode = false; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }

  if (speedMode) {
    let bestI = -1, bestVal = -1;
    for (let i = 0; i < 64; i++) {
      if (sides[i] !== W || !canItemAffectPiece(ITEM_BOOTS, i)) continue;
      const v = (board[i] === KING || board[i] === CHECKERS_KING) ? 1e9 : _aiPieceVal(board[i]);
      if (v > bestVal) { bestVal = v; bestI = i; }
    }
    if (bestI >= 0) { const [cx,cy] = cc(bestI); setTimeout(() => handleSpeedClick(cx, cy), 100); }
    else { speedMode = false; if (inventory._activeSlot !== undefined) delete inventory._activeSlot; draw(); }
    return;
  }
}

// Poll every 600ms: trigger auto-play, and resolve any stuck interactive-item UI.
// Wrapped in try/catch so one bad step can't permanently kill auto-play.
setInterval(() => {
  if (!autoPlay || gameOver || aiThinking || anim || _autoScheduled || replayMode) return;
  try {
    // Rewinder save offer: always accept — it extends the run
    if (_rewinderSaveOffer) {
      const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
      const btnY = boardCY + 90 + 46;
      handleRewinderSaveOfferClick(boardCX - 40 / 2 - 180 + 5, btnY + 5); // Yes button
      return;
    }
    if (shopMode || clonerMode || teleporterMode || bombMode || shieldMode || piecePromoterMode || elementizerMode || vampireFangMode || swordMode || speedMode) {
      _aiCompleteActiveMode(); return;
    }
    if (turn !== W) return;
    autoWhitePlay();
  } catch (e) {
    console.warn('[auto] step failed:', e);
  }
}, 600);

// ─────────────────────────────────────────────────────────────────────────────

initBoard();
// Start splash immediately so the canvas is never blank while assets load
_loadTotal = 16; // matches spriteList length in loadSprites
_drawSplash();
_createStartVideo(); // begin buffering the attract video during sprite load
(function _loadFont(retriesLeft) {
  document.fonts.load("42px Canterbury")
    .then(() => loadSprites())
    .catch(() => { if (retriesLeft > 0) setTimeout(() => _loadFont(retriesLeft - 1), 400); else loadSprites(); });
})(8);

window.setupTest = function(preset) {
  if (preset === 'teleporter_void') {
    itemSpaces[idx(3, 5)] = ITEM_TELEPORTER;
    specialSpaces[idx(5, 5)] = { type: 'void' };
    draw();
  }
  if (preset === 'shielded_and_merchant') {
    // Black shielded Knight at D4
    const ei = idx(3, 3);
    board[ei] = KNIGHT; sides[ei] = B; health[ei] = 2; elements[ei] = 0;
    // Merchant at F4
    merchantIdx = idx(5, 3);
    merchantOffers = [_randomShopItem(), _randomShopItem(), _randomShopItem()];
    merchantSold = [false, false, false];
    merchantRerollCountdown = MERCHANT_REROLL_CYCLE;
    draw();
  }
};


