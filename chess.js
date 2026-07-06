const VERSION = "571";
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
  // Silence audio (esp. the looping wind) when the app is backgrounded / the
  // phone sleeps; resume on return. Mobile browsers otherwise keep the
  // AudioContext running in the background.
  const onVisibility = () => {
    if (!_sfxCtx) return;
    if (document.hidden) {
      if (_sfxCtx.state === 'running') _sfxCtx.suspend();
    } else if (_sfxUnlocked && !_sfxMuted && _sfxCtx.state === 'suspended') {
      _sfxCtx.resume();
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

// Pressing Continue on the loading screen: unlock audio + proceed into the game.
function _doContinue() {
  if (_continued || !spritesLoaded) return;
  _continued = true;
  _sfxUnlockCtx();
  playSfx('button');
  startIdleAnim();
  draw();
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
      draw(); // shows the Continue button; idle anim + game start on Continue
    }
  };
  for (const [key, src, needsBg] of spriteList) {
    const img = new Image();
    img.onload = () => done(key, img, needsBg ? _makeTransparentBg(img) : null);
    img.onerror = () => done(key, null, null);
    img.src = src;
  }
}

let board = new Array(64).fill(NONE);
let sides = new Array(64).fill(0);
let health = new Array(64).fill(1);
let selected = -1;
let validMoves = [];
let _checkersChainIdx = -1; // board index of White Checkers Man mid chain-jump; -1 if not in chain
let _bloodthirstyIdx = -1;  // board index of Bloodthirsty piece mid extra-move; -1 if not active
let _bloodthirstyUsed = false; // true if BT extra move already granted this turn (no chaining)
let _piecesMovedSinceFire = false; // true once any piece actually moves after fire was set; Field Advance alone doesn't count
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
let _recruitedCManThisRun = false;  // recruited a neutral Checkers Man this run
let _recruitedCKingThisRun = false; // recruited a neutral Checkers King this run
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
}
// Record a Black warrior taken by the acting White piece (called real-only from makeMove).
function _trackWhiteTake(pieceMoved, fromI, capturedPiece) {
  if (_turnActorTakes === 0) { _turnActorType = pieceMoved; _turnActorBuffed = (speeds[fromI] > 1) || !!(statuses[fromI] & STATUS_BLOODTHIRSTY); }
  _turnActorTakes++;
  if (capturedPiece === KING || capturedPiece === CHECKERS_KING) _turnKingsTaken++;
}
let spawnCount = 1;
let leapCount = 0;
let nextWave = []; // array of {x, piece} for preview
let nextBonuses = []; // [{type:'chest'|'item'|'void'|'block'|'neutral'|'river', col, ...}]
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
  if (item === ITEM_ELEM_MYSTERY) return 'Mystery Elementalizer';
  return ELEM_NAMES[item - 200] + ' Elementalizer';
}

const ITEM_VAMPIRE_FANG = 300;
const ITEM_SWORD = 301;
const ITEM_BOOTS = 302;

const ITEM_NAMES = {
  [ITEM_TELEPORTER]: "Teleporter", [ITEM_CLONER]: "Cloner", [ITEM_SHIELD]: "Defense Up", [ITEM_BOMB]: "Bomb", [ITEM_REWINDER]: "Rewinder",
  [ITEM_VAMPIRE_FANG]: "Vampire Fang", [ITEM_SWORD]: "Attack Up", [ITEM_BOOTS]: "Speed Up"
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
let fireSquares = new Map(); // Map<boardIdx, side> — squares on fire; kills pieces of the opposing side
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

const AI_DEPTH = 3;
const HINT_DEPTH = 5;
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
function clearSquare(i) { board[i] = NONE; sides[i] = 0; health[i] = 1; elements[i] = 0; statuses[i] = 0; attacks[i] = 1; speeds[i] = 1; effectOrders[i] = []; }
function copyPiece(src, dst) { board[dst] = board[src]; sides[dst] = sides[src]; health[dst] = health[src]; elements[dst] = elements[src]; statuses[dst] = statuses[src]; attacks[dst] = attacks[src]; speeds[dst] = speeds[src]; effectOrders[dst] = [...effectOrders[src]]; }

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
    speeds: new Array(64).fill(1),
    effectOrders: withOrders ? Array.from({ length: 64 }, () => []) : null,
  };
}
// Copy live square i's piece attributes into slot ni of a _blankSquares() set.
function _copySquareTo(n, i, ni) {
  n.board[ni] = board[i]; n.sides[ni] = sides[i]; n.health[ni] = health[i];
  n.elements[ni] = elements[i]; n.statuses[ni] = statuses[i];
  n.attacks[ni] = attacks[i]; n.speeds[ni] = speeds[i];
  if (n.effectOrders) n.effectOrders[ni] = [...effectOrders[i]];
}
// Commit a _blankSquares() set into the live arrays.
function _commitSquares(n) {
  board.splice(0, 64, ...n.board); sides.splice(0, 64, ...n.sides);
  health.splice(0, 64, ...n.health); elements.splice(0, 64, ...n.elements);
  statuses.splice(0, 64, ...n.statuses); attacks.splice(0, 64, ...n.attacks);
  speeds.splice(0, 64, ...n.speeds);
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

function randInt(n) { return Math.floor(Math.random() * n); }

function graveSlotPos(isPlayer, pieceType) {
  const gx = isPlayer ? PLAYER_GRAVE_X : ENEMY_GRAVE_X;
  const slotIdx = GRAVE_TYPES.indexOf(pieceType);
  const slotW = GRAVE_W / GRAVE_TYPES.length;
  return [gx + slotIdx * slotW + slotW / 2, GRAVE_Y + 10 + 40];
}

function startFlyAnim(piece, side, sx, sy, tx, ty, onDone) {
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
  const [tgx, tgy] = graveSlotPos(isPlayer, piece);
  startFlyAnim(piece, side, sx, sy, tgx, tgy, () => { pool[piece] = (pool[piece] || 0) + 1; playSfx('body'); if (side === B) playSfx('loot'); });
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
  if (side === W && piece) { _lostWhiteThisRun = true; _whiteLostSinceAdvance = true; } // a White Warrior fell into the void
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
      _applyItemAuto(f.item, f.i); // Black/Neutral — auto-apply only
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
      board: [...board], sides: [...sides], health: [...health],
      elements: [...elements], statuses: [...statuses], attacks: [...attacks], speeds: [...speeds],
      specialSpaces: specialSpaces.map(s => s ? JSON.parse(JSON.stringify(s)) : null),
      itemSpaces: [...itemSpaces],
      inventory: [...inventory],
      score, gold, leapCount, shiftCountdown, merchantIdx,
      playerDead: {...playerDead}, enemyDead: {...enemyDead},
      fireSquares: [...fireSquares.entries()],
      nextWave: nextWave.map(w => ({...w})), nextBonuses: nextBonuses.map(b => ({...b})),
      squares: [...squares],
      shoveParams: {...shoveParams},
    });
  }
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
      if (elements[ni] & ELEM_EARTH) continue; // Earth is immune — no shove, no drawAt
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
      if (elements[ni] & ELEM_EARTH) continue;
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
  waveAnim = { squares, shoveParams, drawAt, lastHead: -1, startMs: performance.now(), dur: 500, onDone };
  requestAnimationFrame(_waveTick);
}

function _waveTick() {
  if (!waveAnim) return;
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

// Draw a storefront icon centered in the tile at (tx,ty) with the given tile size.
function drawBlockTile(gctx, tx, ty, tileSize) {
  const bev = tileSize * 0.22;
  gctx.save();
  // Outer dark edge / base
  gctx.fillStyle = "#1e1a16";
  gctx.fillRect(tx, ty, tileSize, tileSize);
  // Top bevel â€" lit from above
  gctx.fillStyle = "#c8b890";
  gctx.beginPath();
  gctx.moveTo(tx, ty); gctx.lineTo(tx + tileSize, ty);
  gctx.lineTo(tx + tileSize - bev, ty + bev); gctx.lineTo(tx + bev, ty + bev);
  gctx.closePath(); gctx.fill();
  // Bottom bevel â€" deep shadow
  gctx.fillStyle = "#2e2418";
  gctx.beginPath();
  gctx.moveTo(tx, ty + tileSize); gctx.lineTo(tx + tileSize, ty + tileSize);
  gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.lineTo(tx + bev, ty + tileSize - bev);
  gctx.closePath(); gctx.fill();
  // Left bevel â€" half-lit
  gctx.fillStyle = "#908068";
  gctx.beginPath();
  gctx.moveTo(tx, ty); gctx.lineTo(tx, ty + tileSize);
  gctx.lineTo(tx + bev, ty + tileSize - bev); gctx.lineTo(tx + bev, ty + bev);
  gctx.closePath(); gctx.fill();
  // Right bevel â€" shadow side
  gctx.fillStyle = "#403428";
  gctx.beginPath();
  gctx.moveTo(tx + tileSize, ty); gctx.lineTo(tx + tileSize, ty + tileSize);
  gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.lineTo(tx + tileSize - bev, ty + bev);
  gctx.closePath(); gctx.fill();
  // Center face
  gctx.fillStyle = "#786450";
  gctx.fillRect(tx + bev, ty + bev, tileSize - bev * 2, tileSize - bev * 2);
  // Inner highlight lines (top-left edge of center)
  gctx.strokeStyle = "#a09070"; gctx.lineWidth = 1.5;
  gctx.beginPath(); gctx.moveTo(tx + bev, ty + bev); gctx.lineTo(tx + tileSize - bev, ty + bev); gctx.stroke();
  gctx.beginPath(); gctx.moveTo(tx + bev, ty + bev); gctx.lineTo(tx + bev, ty + tileSize - bev); gctx.stroke();
  // Inner shadow lines (bottom-right edge of center)
  gctx.strokeStyle = "#3e3028"; gctx.lineWidth = 1.5;
  gctx.beginPath(); gctx.moveTo(tx + tileSize - bev, ty + bev); gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.stroke();
  gctx.beginPath(); gctx.moveTo(tx + bev, ty + tileSize - bev); gctx.lineTo(tx + tileSize - bev, ty + tileSize - bev); gctx.stroke();
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

function startAnim(pieces, boardDy, onDone, exitRow) {
  if (!replayMode) {
    _replayAnimBuffer.push({
      type: 'anim',
      board: [...board], sides: [...sides], health: [...health],
      specialSpaces: specialSpaces.map(s => s ? JSON.parse(JSON.stringify(s)) : null),
      itemSpaces: [...itemSpaces],
      inventory: [...inventory],
      score, gold, leapCount, shiftCountdown, merchantIdx,
      playerDead: {...playerDead}, enemyDead: {...enemyDead},
      elements: [...elements], statuses: [...statuses], attacks: [...attacks], speeds: [...speeds],
      fireSquares: [...fireSquares],
      nextWave: nextWave.map(w => ({...w})), nextBonuses: nextBonuses.map(b => ({...b})),
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
  anim = { pieces, boardDy, startMs: performance.now(), dur: animDur, onDone, exitRow: exitRow || null };
  requestAnimationFrame(_animTick);
}

function _animTick() {
  if (!anim) return;
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

function takeReplaySnapshot() {
  _replayTransitions.push([..._replayAnimBuffer]);
  _replayAnimBuffer = [];
  replaySnapshots.push({
    board: [...board], sides: [...sides], health: [...health],
    specialSpaces: specialSpaces.map(s => s ? JSON.parse(JSON.stringify(s)) : null),
    itemSpaces: [...itemSpaces], chestSpaces: [...chestSpaces],
    shadowSpaces: [..._shadowSpaces],
    inventory: [...inventory],
    score, gold, turn,
    playerDead: {...playerDead}, enemyDead: {...enemyDead},
    spawnCount, leapCount, shiftCountdown, merchantIdx, merchantQueued, merchantQueuedCol,
    elements: [...elements], statuses: [...statuses], attacks: [...attacks], speeds: [...speeds], fireSquares: [...fireSquares],
    effectOrders: effectOrders.map(a => [...a]),
    nextWave: nextWave.map(w => ({...w})), nextBonuses: nextBonuses.map(b => ({...b}))
  });
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
  fireSquares = snap.fireSquares ? new Map(snap.fireSquares) : new Map();
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
    // Fire all consecutive fly events (fire-and-forget, no waiting)
    while (ei < events.length && events[ei].type === 'fly') {
      const ev = events[ei++];
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
    fireSquares = ev.fireSquares ? new Map(ev.fireSquares) : new Map();
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
  return wave;
}

function isDarkSquare(x, y) { return (x + y) % 2 === 1; }

// Roll bonuses (chest / obstacle / neutral) into the empty columns of an incoming wave.
// Obstacles ramp with depth: at wave 1 an empty column has the baseline 1-in-12
// chance of any bonus (of which 1/3 is an obstacle → 2.78% obstacle); by wave 40
// every empty column on an obstacle-row is a guaranteed obstacle, no chests/neutrals.
// Obstacles are gated to alternating waves so two obstacle-rows never spawn back to
// back — since all rows scroll down uniformly, that guarantees a clear row between
// every obstacle row, so obstacles can never wall the player off into a Field Advance.
function generateRowBonuses(wave, waveCount = spawnCount + 1) {
  const waveCols = new Set(wave.map(w => w.x));
  const bonuses = [];
  const t = Math.max(0, Math.min(1, (waveCount - 1) / 39)); // 0 at wave 1 → 1 at wave 40+
  // River-row chance ramps with depth: 1/32 (~3.1%) at wave 1 → 1/5 (20%) at wave 40+.
  const pRiver = (1 / 32) + (0.2 - 1 / 32) * t;
  if (Math.random() < pRiver) {
    const dx = randInt(2) === 0 ? -1 : 1;
    for (let x = 0; x < 8; x++) bonuses.push({ type: 'river', col: x, dx });
    return bonuses; // river replaces all other bonuses for this row
  }
  const obstacleRow = (waveCount % 2 === 1); // only odd waves may spawn obstacles
  const pBonus = (1 / 12) + (1 - 1 / 12) * t;   // chance an empty column rolls anything: 1/12 → 1
  // Type weights lerp from baseline [chest1, void1, block1, neutral3] toward obstacle-only.
  // On non-obstacle rows the void/block weight is zeroed (keeps the every-other-row guarantee).
  const wChest = 1 - t, wNeutral = 3 * (1 - t);
  const wVoid = obstacleRow ? (1 + 2 * t) : 0, wBlock = obstacleRow ? (1 + 2 * t) : 0;
  const wTotal = wChest + wNeutral + wVoid + wBlock;
  for (let x = 0; x < 8; x++) {
    if (waveCols.has(x)) continue;
    if (wTotal <= 0) continue;           // late-game non-obstacle row: nothing left to spawn
    if (Math.random() >= pBonus) continue;
    let r = Math.random() * wTotal, type;
    if ((r -= wVoid) < 0) type = 'void';
    else if ((r -= wBlock) < 0) type = 'block';
    else if ((r -= wChest) < 0) type = 'chest';
    else type = 'neutral';
    if (type === 'void' || type === 'block') {
      bonuses.push({ type, col: x });
    } else if (type === 'chest') {
      bonuses.push({ type: 'chest', col: x });
    } else {
      let neutralPiece = _randomSetupPiece();
      // Checkers pieces must spawn on dark squares (neutrals enter at row 0)
      if ((neutralPiece === CHECKERS || neutralPiece === CHECKERS_KING) && !isDarkSquare(x, 0)) neutralPiece = PAWN;
      bonuses.push({ type: 'neutral', col: x, piece: neutralPiece });
    }
  }
  return bonuses;
}

function _rollSpawnEffects(i, waveCount = spawnCount) {
  // Per-roll effect chance ramps with wave: 1/16 (6.25%) at wave 1 → 1/2 (50%)
  // at wave 30, then holds. Each success grants one distinct effect (max 3),
  // drawn uniformly from the pool.
  // Pool: Attack+1, Health+1, Speed+1, Bloodthirsty, Fire, Water, Earth, Air.
  const t = Math.max(0, Math.min(1, (waveCount - 1) / 29));
  const p = 0.0625 + (0.5 - 0.0625) * t;
  let pool = [
    'atk', 'hlth', 'spd',
    'bt', 'fire', 'water', 'earth', 'air'
  ];
  let count = 0;
  while (count < 3 && Math.random() < p && pool.length > 0) {
    const pick = pool[randInt(pool.length)];
    pool = pool.filter(x => x !== pick);
    if (pick === 'atk')   { attacks[i] = 2;                        _grantEffect(i, 'atk'); }
    else if (pick === 'hlth')  { health[i] = 2;                   _grantEffect(i, 'hlt'); }
    else if (pick === 'spd')   { speeds[i] = 2;                   _grantEffect(i, 'spd'); }
    else if (pick === 'bt')    { statuses[i] |= STATUS_BLOODTHIRSTY; _grantEffect(i, 'bt'); }
    else if (pick === 'fire')  { elements[i] |= ELEM_FIRE;        _grantEffect(i, 'fire'); }
    else if (pick === 'water') { elements[i] |= ELEM_WATER;       _grantEffect(i, 'water'); }
    else if (pick === 'earth') { elements[i] |= ELEM_EARTH;       _grantEffect(i, 'earth'); }
    else if (pick === 'air')   { elements[i] |= ELEM_AIR;         _grantEffect(i, 'air'); }
    count++;
  }
}

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
        if (elements[i] & (ELEM_EARTH | ELEM_WATER)) continue;
        if (board[di] !== NONE || di === merchantIdx) continue;
        {
          animPieces.push({ fromCX: MARGIN + x * TILE, fromCY: BOARD_Y + MARGIN + y * TILE, toCX: MARGIN + nx * TILE, toCY: BOARD_Y + MARGIN + y * TILE, toIdx: di, piece: board[i], side: sides[i], hlth: health[i], atk: attacks[i], spd: speeds[i] });
          movePiece(i, di);
          // Pushed onto an item space — activate it (e.g. a Bomb detonates on whoever
          // the river shoves onto it), same as a piece landing on the item by moving.
          if (itemSpaces[di] !== ITEM_NONE) _applyItemAuto(itemSpaces[di], di);
          checkFireDeath(di); // river pushed the piece onto enemy fire
        }
        continue;
      }
      // Move merchant
      if (i === merchantIdx && board[di] === NONE) {
        animPieces.push({ fromCX: MARGIN + x * TILE, fromCY: BOARD_Y + MARGIN + y * TILE, toCX: MARGIN + nx * TILE, toCY: BOARD_Y + MARGIN + y * TILE, toIdx: di, spriteKey: 'merchant' });
        merchantIdx = di; continue;
      }
      // Drift item space (only if no piece/merchant is occupying it)
      if (itemSpaces[i] !== ITEM_NONE && itemSpaces[di] === ITEM_NONE) {
        itemSpaces[di] = itemSpaces[i]; itemSpaces[i] = ITEM_NONE;
      }
    }
  }
  if (animPieces.length > 0) {
    startAnim(animPieces, 0, onDone);
  } else {
    if (onDone) onDone();
  }
}

function placeWave(row, wave) {
  for (const w of wave) {
    set(w.x, row, w.piece, B);
    _rollSpawnEffects(idx(w.x, row));
  }
}

let firstMoveMade = false;
let resignConfirm = false;
let sellMode = false;       // Merchant sell flow: player is choosing an inventory item to sell
let sellConfirmSlot = -1;   // inventory slot pending sell confirmation; -1 = none
// Sell value: half the item's buy price (min 1 for priced items).
function sellValue(item) { const p = itemPrice(item); return p > 0 ? Math.max(1, Math.floor(p / 2)) : 0; }
let _rewinderSaveOffer = false; // true when King dies but player has a Rewinder
let _blackKingsInCheckmate = new Set(); // indices of Black Kings currently in checkmate; persists through White's full turn
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
let timedModeSecs = 60;
const TIMED_PRESETS = [15, 30, 60, 120, 300];
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
  board.fill(NONE); sides.fill(0);
  spawnCount = 1;
  leapCount = 0;
  stopWindLoop(0);
  stopWhiteTurnTimer();
  _turnStartSnapIndices = [];
  selected = -1; validMoves = []; turn = W;
  gameOver = false; gameMsg = ""; score = 0; gold = 0;
  firstMoveMade = false; positionHistory = []; testMode = false;
  replaySnapshots = []; replayMode = false; replayIdx = 0; replayAutoPlay = false;
  if (replayAutoTimer) { clearTimeout(replayAutoTimer); replayAutoTimer = null; }
  _replayAnimBuffer = []; _replayTransitions = [];
  inventory.fill(ITEM_NONE); piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false; teleporterSelected = -1; clonerMode = false; clonerSelected = -1; shieldMode = false; bombMode = false; bombHoverIdx = -1; speedMode = false; _resetTurnState();
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
  _blackKingsInCheckmate.clear();
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
  elements.fill(0); speeds.fill(1); fireSquares = new Map(); elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  wkMoved = false; wraMoved = false; wrhMoved = false;
  epTarget = -1;
  gamePhase = 'setup';
  rollSetup();
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
  let r = Math.random() * total;
  for (const [piece, wt] of w) { if ((r -= wt) < 0) return piece; }
  return PAWN;
}

function rollSetup() {
  _startedClassic = false;
  // Clear all pieces and regenerate enemy wave
  board.fill(NONE); sides.fill(0); health.fill(1); elements.fill(0); statuses.fill(0); attacks.fill(1); speeds.fill(1);
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
  board.fill(NONE); sides.fill(0); health.fill(1); elements.fill(0); statuses.fill(0); attacks.fill(1); speeds.fill(1);
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
  draw();
  startWhiteTurnTimer();
}

function startWhiteTurnTimer() {
  if (!timedMode || gameOver || replayMode) return;
  stopWhiteTurnTimer();
  _timerDisplay = timedModeSecs;
  _timerEnd = Date.now() + timedModeSecs * 1000;
  // rAF loop keeps the clock display updating every frame
  const tick = () => {
    if (!_timerRafId) return;
    if (!anim && flyAnims.length === 0) draw();
    _timerRafId = requestAnimationFrame(tick);
  };
  _timerRafId = requestAnimationFrame(tick);
  // setTimeout fires when time is up; retries if blocked by animation/shop
  const onExpire = () => {
    if (!timedMode || turn !== W || gameOver || gamePhase !== 'playing') return;
    if (anim || isItemActive() || shopMode || replayMode) {
      _timerTimeoutId = setTimeout(onExpire, 100);
      return;
    }
    stopWhiteTurnTimer();
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

function playConquestGif() {
  _conquestGifActive = true;
  _conquestCurrentFrame = 0;
  // Wait for frame 0 in case preload is still in progress
  if (_conquestFrames[0].complete) {
    _conquestStartMs = performance.now();
    requestAnimationFrame(_conquestTick);
  } else {
    _conquestFrames[0].onload = () => { _conquestStartMs = performance.now(); requestAnimationFrame(_conquestTick); };
  }
}

function _conquestTick() {
  if (!_conquestGifActive) return;
  const now = performance.now();
  const elapsed = now - _conquestStartMs;
  const targetFrame = Math.min(Math.floor(elapsed / 1000 * CONQUEST_FPS), CONQUEST_FRAME_COUNT - 1);
  // Stall timer if the target frame isn't loaded yet (safety net)
  if (!_conquestFrames[targetFrame].complete) {
    _conquestStartMs = now - (targetFrame / CONQUEST_FPS * 1000);
    requestAnimationFrame(_conquestTick);
    return;
  }
  _conquestCurrentFrame = targetFrame;
  draw();
  if (_conquestCurrentFrame >= CONQUEST_FRAME_COUNT - 1) {
    _conquestGifActive = false;
    startGame();
  } else {
    requestAnimationFrame(_conquestTick);
  }
}



function neutralMovesFor(i) {
  const [x, y] = xy(i);
  const p = board[i];
  const moves = [];
  const canLand = (nx, ny) => inB(nx, ny) && board[idx(nx, ny)] === NONE && idx(nx, ny) !== merchantIdx && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny));
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
      while (inB(nx, ny) && board[idx(nx, ny)] === NONE && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) {
        moves.push(idx(nx, ny));
        nx += dx; ny += dy;
      }
    }
  }
  return moves;
}

function neutralPlay(onDone) {
  const neutrals = [];
  for (let i = 0; i < 64; i++) if (sides[i] === N) neutrals.push(i);
  if (neutrals.length === 0) { onDone(); return; }
  shuffle(neutrals);
  const doNext = (ni) => {
    if (ni >= neutrals.length) { onDone(); return; }
    const i = neutrals[ni];
    if (sides[i] !== N) { doNext(ni + 1); return; }
    const moves = neutralMovesFor(i);
    if (moves.length === 0) { doNext(ni + 1); return; }
    const dest = moves[randInt(moves.length)];
    const [fx, fy] = xy(i), [tx, ty] = xy(dest);
    const p = board[i], h = health[i];
    movePiece(i, dest); // preserves statuses/elements/attacks/speeds/effectOrders (e.g. Bloodthirsty)
    if (itemSpaces[dest] !== ITEM_NONE) _applyItemAuto(itemSpaces[dest], dest);
    checkFireDeath(dest);
    startAnim([{
      toIdx: dest,
      fromCX: MARGIN + fx * TILE, fromCY: BOARD_Y + MARGIN + fy * TILE,
      toCX: MARGIN + tx * TILE, toCY: BOARD_Y + MARGIN + ty * TILE,
      piece: p, side: N, hlth: h
    }], 0, () => doNext(ni + 1));
  };
  doNext(0);
}

function slidingMoves(moves, x, y, dirs, s) {
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (inB(nx, ny)) {
      if (side(nx, ny) === s) break;
      if (sides[idx(nx, ny)] === N) break; // only W King can recruit neutrals; all others treat them as impassable
      const ni = idx(nx, ny);
      if (isBlockSpace(ni)) break;
      // Enemy fire: non-White sliders can land here but can't slide through
      if (fireSquares.has(ni) && fireSquares.get(ni) !== s) { moves.push(ni); break; }
      const isVoid = specialSpaces[ni]?.type === 'void';
      if (!isVoid) moves.push(ni);
      if (piece(nx, ny) !== NONE) break;
      nx += dx; ny += dy;
    }
  }
}

// Air variant: pass through pieces/obstacles, land on any reachable vacant square
function airSlidingMoves(moves, x, y, dirs, s) {
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (inB(nx, ny)) {
      const ni = idx(nx, ny);
      if (isBlockSpace(ni)) break; // physical blocks still stop Air
      const occ = sides[ni];
      if (occ === s) { nx += dx; ny += dy; continue; } // fly through own pieces
      if (occ === N) { nx += dx; ny += dy; continue; } // fly through neutrals
      moves.push(ni); // vacant or capturable enemy square
      if (board[ni] !== NONE) { nx += dx; ny += dy; continue; } // fly through enemy pieces too
      nx += dx; ny += dy;
    }
  }
}

function airKnightMoves(x, y, s) {
  const OFFSETS = [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
  const reachable = new Set();
  for (const [dx, dy] of OFFSETS) {
    const nx = x + dx, ny = y + dy;
    if (inB(nx, ny)) reachable.add(idx(nx, ny));
    // 2-hop: from each 1-hop land, do another Knight jump
    if (!inB(nx, ny)) continue;
    for (const [dx2, dy2] of OFFSETS) {
      const nx2 = nx + dx2, ny2 = ny + dy2;
      if (inB(nx2, ny2)) reachable.add(idx(nx2, ny2));
    }
  }
  reachable.delete(idx(x, y)); // can't stay in place
  const moves = [];
  for (const ni of reachable) {
    if (board[ni] === NONE) moves.push(ni); // Air: destination must be vacant
  }
  return moves;
}

function isVoidSpace(i) { return specialSpaces[i]?.type === 'void'; }
function isBlockSpace(i) { return specialSpaces[i]?.type === 'block'; }
function canLandEmpty(i) { return board[i] === NONE && !isVoidSpace(i) && !isBlockSpace(i); }

// Adds a 2-square checkers move (jump capture or Air slide) to moves[]. Bounds checked by caller.
function _checkersAddJumpSlide(moves, midI, landI, s, isAir) {
  if (isAir && canLandEmpty(landI)) {
    moves.push(landI);
  } else if (sides[midI] !== 0 && sides[midI] !== s && sides[midI] !== N
      && board[midI] !== NONE && canLandEmpty(landI)) {
    moves.push(landI);
  }
}

function pseudoMoves(x, y) {
  const moves = [];
  const p = piece(x, y), s = side(x, y), e = enemy(s);
  const isAir = !!(elements[idx(x, y)] & ELEM_AIR);
  // Air Knights get their own extended move set
  if (isAir && p === KNIGHT) return airKnightMoves(x, y, s);
  if (p === PAWN) {
    const dir = s === W ? -1 : 1;
    const startY   = s === W ? 6 : 0;
    const fwdRange = isAir ? 2 : 1;
    const maxFwd   = isAir ? 4 : 2; // extra distance available from starting row
    const capRange = isAir ? 2 : 1;
    // Forward steps — path must be clear
    const steps = y === startY ? maxFwd : fwdRange;
    for (let step = 1; step <= steps; step++) {
      const ny = y + dir * step;
      if (!inB(x, ny)) break;
      const ni = idx(x, ny);
      if (ni === merchantIdx || isVoidSpace(ni) || isBlockSpace(ni)) break;
      if (piece(x, ny) !== NONE) break;
      moves.push(ni);
    }
    // Diagonal captures — can reach up to capRange squares; stop on any occupied square
    for (const dx of [-1, 1]) {
      for (let step = 1; step <= capRange; step++) {
        const nx = x + dx * step, ny = y + dir * step;
        if (!inB(nx, ny)) break;
        const ni = idx(nx, ny);
        if (isVoidSpace(ni) || isBlockSpace(ni)) break;
        if (s === W) {
          if (side(nx, ny) === e) { moves.push(ni); break; }
          if (ni === epTarget || ni === merchantIdx) { moves.push(ni); break; }
        } else {
          if (side(nx, ny) === e) { moves.push(ni); break; }
        }
        if (piece(nx, ny) !== NONE) break; // own piece or neutral blocks further diagonal
      }
    }
  } else if (p === CHECKERS) {
    const dir = s === W ? -1 : 1;
    const isAir = !!(elements[idx(x, y)] & ELEM_AIR);
    for (const dx of [-1, 1]) {
      const nx = x + dx, ny = y + dir;
      const ni = inB(nx, ny) ? idx(nx, ny) : -1;
      if (ni >= 0 && canLandEmpty(ni)) moves.push(ni);
      const jx = x + 2*dx, jy = y + 2*dir;
      if (ni >= 0 && inB(jx, jy)) _checkersAddJumpSlide(moves, ni, idx(jx, jy), s, isAir);
    }
    // Air bent-path: (x, y+2*dir) reachable via two zigzag forward steps
    if (isAir) {
      const bentI = inB(x, y + 2*dir) ? idx(x, y + 2*dir) : -1;
      if (bentI >= 0 && canLandEmpty(bentI)) moves.push(bentI);
    }
  } else if (p === CHECKERS_KING) {
    const isAir = !!(elements[idx(x, y)] & ELEM_AIR);
    for (const [dx, dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
      const nx = x + dx, ny = y + dy;
      const ni = inB(nx, ny) ? idx(nx, ny) : -1;
      if (ni >= 0 && (canLandEmpty(ni) || sides[ni] === N) && !isVoidSpace(ni) && !isBlockSpace(ni))
        moves.push(ni);
      const jx = x + 2*dx, jy = y + 2*dy;
      if (ni >= 0 && inB(jx, jy)) _checkersAddJumpSlide(moves, ni, idx(jx, jy), s, isAir);
    }
    // Air bent-path slides: squares reachable via two diagonal steps in different directions
    if (isAir) {
      for (const [bdx, bdy] of [[2,0],[-2,0],[0,2],[0,-2]]) {
        const bx = x + bdx, by = y + bdy;
        if (inB(bx, by) && canLandEmpty(idx(bx, by))) moves.push(idx(bx, by));
      }
    }
  } else if (p === KNIGHT) {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && sides[idx(nx, ny)] !== N && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) moves.push(idx(nx, ny));
    }
  } else if (p === BISHOP) {
    const dirs = [[1,1],[1,-1],[-1,1],[-1,-1]];
    if (isAir) airSlidingMoves(moves, x, y, dirs, s); else slidingMoves(moves, x, y, dirs, s);
  } else if (p === ROOK) {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    if (isAir) airSlidingMoves(moves, x, y, dirs, s); else slidingMoves(moves, x, y, dirs, s);
  } else if (p === QUEEN) {
    const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    if (isAir) airSlidingMoves(moves, x, y, dirs, s); else slidingMoves(moves, x, y, dirs, s);
  } else if (p === KING) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && sides[idx(nx, ny)] === N) && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) {
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
  _piecesMovedSinceFire = false; // reset; fire must see another piece move before it expires
  fireSquares.set(fromI, s);
  fireSquares.set(toI, s); // destination also burns — enemies that capture here are killed
  // Checkers pieces don't touch intermediate squares (they jump over them), and Knights have no path
  if (p === KNIGHT || p === CHECKERS || p === CHECKERS_KING) return;
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const dx = tx === fx ? 0 : (tx > fx ? 1 : -1);
  const dy = ty === fy ? 0 : (ty > fy ? 1 : -1);
  let cx = fx + dx, cy = fy + dy;
  while (cx !== tx || cy !== ty) { fireSquares.set(idx(cx, cy), s); cx += dx; cy += dy; }
}

// Remove all fire owned by side s (fireSquares maps square -> the side that laid it,
// which is the side immune to it). Used at turn boundaries: a fire has done its job
// threatening the opponent during their turn, so it clears when they finish moving.
function _clearFireOfSide(s) {
  for (const [i, fs] of [...fireSquares]) if (fs === s) fireSquares.delete(i);
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
  if (elements[srcI] & ELEM_EARTH) return; // Earth pieces immune to forced movement
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
  if (!replayMode) checkFireDeath(destI); // shoved onto enemy fire burns (consistent with voids/bombs)
}

function applyWaterWave(fromI, toI, p) {
  _waterShoveActive = true; // this whole shove sweep is from a Water piece
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  if (p === KNIGHT) {
    // Radial shove from landing square
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ni = idx(tx + dx, ty + dy);
      if (!inB(tx + dx, ty + dy) || ni === toI) continue;
      if (board[ni] !== NONE || ni === merchantIdx) shovePiece(ni, dx, dy);
    }
    _waterShoveActive = false;
    return;
  }
  // Sliding piece: wave travels the full movement axis, edge to edge
  const dx = tx === fx ? 0 : (tx > fx ? 1 : -1);
  const dy = ty === fy ? 0 : (ty > fy ? 1 : -1);
  // Find the start of the axis line (walk opposite direction to edge)
  let sx = tx, sy = ty;
  while (inB(sx - dx, sy - dy)) { sx -= dx; sy -= dy; }
  // Collect all squares on this line
  const line = [];
  let cx = sx, cy = sy;
  while (inB(cx, cy)) { line.push(idx(cx, cy)); cx += dx; cy += dy; }
  // Process from the far end (direction of wave) inward to avoid cascades
  for (let i = line.length - 1; i >= 0; i--) {
    const ni = line[i];
    if (ni === toI) continue; // don't shove the mover itself
    if (board[ni] !== NONE || ni === merchantIdx) shovePiece(ni, dx, dy);
  }
  _waterShoveActive = false;
}

function checkFireDeath(i) {
  if (!fireSquares.has(i)) return false;
  if (board[i] === NONE || fireSquares.get(i) === sides[i]) return false; // own-faction fire is harmless
  const p = board[i], s = sides[i];
  if ((p === KING || p === CHECKERS_KING) && s === B) score++;
  if (s === B) { gold += GOLD_VALUE[p] ?? 0; enemyDead[p] = (enemyDead[p] || 0) + 1; }
  if (s === W) { _lostWhiteThisRun = true; _whiteLostSinceAdvance = true; } // a White Warrior burned to death
  clearSquare(i);
  // A burning White King ends the game (was: silently deleted, leaving a kingless zombie game)
  if ((p === KING || p === CHECKERS_KING) && s === W && countKings(W) === 0) _triggerGameOver(`Game Over! Score: ${score}`);
  return true;
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
      for (const [dx, dy] of dirs) {
        let nx = ax + dx, ny = ay + dy;
        while (inB(nx, ny)) {
          if (nx === tx && ny === ty) return true;
          if (board[idx(nx, ny)] !== NONE) break;
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
  // Non-King Black pieces move freely; checkmate is handled separately in _isSingleKingCheckmated.
  const s = side(x, y);
  if (s === W) return pseudoMoves(x, y);
  const movingPiece = board[idx(x, y)];
  if (movingPiece !== KING) return pseudoMoves(x, y);
  // Black King: filter out moves that land on a square attacked by White,
  // EXCEPT capturing a White King — that wins instantly (or bounces off its shield),
  // so it must never be filtered even when the King's square is defended.
  return pseudoMoves(x, y).filter(m => {
    if ((board[m] === KING || board[m] === CHECKERS_KING) && sides[m] === W) return true;
    const [nx, ny] = xy(m);
    return !isAttacked(nx, ny, B);
  });
}

// Returns the destination index if an Earth attacker can bonk the defender, else -1 (fall back to bounce).
// fromI = attacker origin, toI = defender square, p = attacker piece type.
function calcEarthBonkDest(fromI, toI, p) {
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  let nx, ny;
  if (p === KNIGHT) {
    nx = tx + (tx - fx); ny = ty + (ty - fy);
  } else {
    const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    nx = tx + dx; ny = ty + dy;
  }
  if (!inB(nx, ny)) return -1;
  const di = idx(nx, ny);
  if (isBlockSpace(di)) return -1;
  if (board[di] !== NONE) return -1;
  return di;
}

// Applies shield-bounce state for atkI→defI (must already satisfy health[defI]>1 check).
// Returns { mode:'earth-bonk', bonkDest } or { mode:'attacker-bounce', bounceI }.
function applyShieldBounceState(atkI, defI, p) {
  health[defI]--;
  if (health[defI] < 2) _removeEffect(defI, 'hlt'); // shield consumed — drop the badge
  if ((elements[atkI] & ELEM_EARTH) && !(elements[defI] & ELEM_EARTH)) {
    const bonkDest = calcEarthBonkDest(atkI, defI, p);
    if (bonkDest >= 0) {
      // Move defender to bonkDest, attacker occupies defI
      copyPiece(defI, bonkDest);
      copyPiece(atkI, defI);
      clearSquare(atkI);
      return { mode: 'earth-bonk', bonkDest };
    }
  }
  const bounceI = calcBouncePos(atkI, defI, p);
  if (bounceI !== atkI) {
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
  _piecesMovedSinceFire = true;
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const p = board[fromI], s = sides[fromI];
  const captured = board[toI];
  const capSide = sides[toI];

  // Checkers / Checkers King jump: leaps 2 diagonally — remove the piece in the middle square (only if it's an enemy, not an Air slide)
  if ((p === CHECKERS || p === CHECKERS_KING) && Math.abs(tx - fx) === 2 && Math.abs(ty - fy) === 2) {
    const midI = idx((fx + tx) / 2, (fy + ty) / 2);
    const capPiece = board[midI], capSide = sides[midI], capHlth = health[midI];
    if (capPiece !== NONE && capSide !== s && capSide !== N) {
      if (visual) { playSfx('capture'); playSfx('punch'); _pendingCaptureAnims.push({ piece: capPiece, side: capSide, hlth: capHlth, atk: attacks[midI], spd: speeds[midI], boardIdx: midI, sx: MARGIN + ((fx+tx)/2)*TILE + TILE/2, sy: BOARD_Y + MARGIN + ((fy+ty)/2)*TILE + TILE/2 }); }
      if (s === W) gold += GOLD_VALUE[capPiece] ?? 0;
      if ((capPiece === KING || capPiece === CHECKERS_KING) && s === W) { score += 1; if (visual && score === 20) _king20TakenBy = p; if (visual && score === 25) _had4KingsAt25 = countKings(W) >= 4; }
      if (visual && s === W) _trackWhiteTake(p, fromI, capPiece); // per-turn take tracking (checkers chain, etc.)
      board[midI] = NONE; sides[midI] = 0; health[midI] = 1;
    }
  }

  // White piece attacks neutral: King (or Checkers King) recruits, all others kill
  if (s === W && sides[toI] === N) {
    if (p === KING || p === CHECKERS_KING) {
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
    gold += GOLD_VALUE[captured] ?? 0;
  }
  if ((captured === KING || captured === CHECKERS_KING) && sides[toI] !== s && s === W) {
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
  }
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
    wkMoved = true;
    if (Math.abs(tx - fx) === 2) {
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
  let landPiece = p;
  // Checkers Man promotion: reaches the far back rank
  if (p === CHECKERS && ((s === W && ty === 0) || (s === B && ty === 7))) landPiece = CHECKERS_KING;
  board[toI] = landPiece; sides[toI] = s; health[toI] = movedHealth;
  elements[toI] = movedElem; statuses[toI] = movedStatus; attacks[toI] = movedAtk; speeds[toI] = movedSpd;
  effectOrders[toI] = [...effectOrders[fromI]];
  clearSquare(fromI);

  // Ground items (sky drops): in simulation, bank the item so the search values
  // landing on item squares (via the inventory eval term). Real pickups run
  // through activateItemSpace in the click/AI flow instead.
  if (!visual && s === W && itemSpaces[toI] !== ITEM_NONE && canItemAffectPiece(itemSpaces[toI], toI)) {
    addToInventory(itemSpaces[toI]);
    itemSpaces[toI] = ITEM_NONE;
  }
}

function endWhiteTurn() {
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
  _clearFireOfSide(B);   // White moved a piece — enemy fire has done its job; clear it
  shiftCountdown--;
  if (shiftCountdown <= 0) {
    fieldAdvance();
  } else {
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
  piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false;
  clonerMode = false; shieldMode = false; bombMode = false; bombHoverIdx = -1;
  elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  vampireFangMode = false; swordMode = false; speedMode = false;
  teleporterSelected = -1; clonerSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function trashActiveItem() {
  if (inventory._activeSlot !== undefined) {
    removeFromInventory(inventory._activeSlot);
    delete inventory._activeSlot;
  }
  piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false;
  clonerMode = false; shieldMode = false; bombMode = false; bombHoverIdx = -1;
  elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  teleporterSelected = -1; clonerSelected = -1;
  draw();
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
  if (gameOver || turn !== W || aiThinking || anim) return;
  _turnBoundaryUpdate(); // Team Advance ends the White turn — update streaks, clear per-turn counters
  _clearFireOfSide(B);   // Team Advance counts as a White move — enemy fire clears (Field Advance never does)
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

function canManualPitchShift() {
  if (!canPitchShift()) return false;
  for (let x = 0; x < 8; x++) {
    if (sides[idx(x, 7)] === W) return false;
  }
  return true;
}

function _placeChestBonus(col) {
  const ci = idx(col, 0);
  if (sides[ci] === W) {
    // White piece already here — award item immediately instead of placing chest
    const _ci = _randomItem();
    const [_cx, _cy] = xy(ci);
    startItemFlyAnim(_ci, MARGIN + _cx * TILE + TILE / 2, BOARD_Y + MARGIN + _cy * TILE + TILE / 2, findInventorySlot());
  } else {
    chestSpaces.add(ci);
  }
}

function fieldAdvance(playerTriggered = false) {
  if (!canPitchShift() || anim) return;
  // Flawless-survival streak: count consecutive advances during which no Black King
  // was taken and no White Warrior was lost (the interval since the previous advance).
  if (score === _lastAdvanceScore && !_whiteLostSinceAdvance) _flawlessAdvances++;
  else _flawlessAdvances = 0;
  _lastAdvanceScore = score; _whiteLostSinceAdvance = false;
  _turnBoundaryUpdate(); // Field Advance ends the White turn — update streaks, clear per-turn counters
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

  // Shift fire squares down one row, drop any that fall off row 7
  const newFireSquares = new Map();
  for (const [fi, fs] of fireSquares) {
    const [fx, fy] = xy(fi);
    if (fy < 7) newFireSquares.set(idx(fx, fy + 1), fs);
  }
  fireSquares = newFireSquares;

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
      set(w.x, 0, w.piece, B); _rollSpawnEffects(idx(w.x, 0));
    }
    for (const b of nextBonuses) {
      if (b.type === 'chest') _placeChestBonus(b.col);
      if (b.type === 'neutral') { set(b.col, 0, b.piece, N); _rollSpawnEffects(idx(b.col, 0)); }
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
      set(w.x, 0, w.piece, B); _rollSpawnEffects(idx(w.x, 0));
    }
    for (const b of nextBonuses) {
      if (b.col === merchantEnterCol) continue;
      if (b.type === 'chest') _placeChestBonus(b.col);
      if (b.type === 'neutral') { set(b.col, 0, b.piece, N); _rollSpawnEffects(idx(b.col, 0)); }
    }
  } else {
    // Normal advance: wave works around merchant's current position
    for (const w of nextWave) {
      if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue;
      if (idx(w.x, 0) === merchantIdx) continue;
      if (chestSpaces.has(idx(w.x, 0))) continue;
      set(w.x, 0, w.piece, B); _rollSpawnEffects(idx(w.x, 0));
    }
    for (const b of nextBonuses) {
      if (idx(b.col, 0) === merchantIdx) continue;
      if (b.type === 'chest') _placeChestBonus(b.col);
      if (b.type === 'neutral') { set(b.col, 0, b.piece, N); _rollSpawnEffects(idx(b.col, 0)); }
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
  // so the preview already shows final spawn positions
  if (merchantQueued && merchantQueuedCol >= 0) {
    const usedCols = new Set(nextWave.map(w => w.x).filter(x => x !== merchantQueuedCol));
    for (const w of nextWave) {
      if (w.x === merchantQueuedCol) {
        for (let x = 0; x < 8; x++) {
          if (x !== merchantQueuedCol && !usedCols.has(x) && specialSpaces[idx(x, 0)]?.type !== 'block') {
            usedCols.add(x); w.x = x; break;
          }
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
const _squareArrays = () => [board, sides, health, elements, statuses, attacks, speeds];

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
    merchantIdx, merchantQueued, merchantQueuedCol,
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
  if (st.merchantIdx !== undefined) merchantIdx = st.merchantIdx;
  if (st.merchantQueued !== undefined) { merchantQueued = st.merchantQueued; merchantQueuedCol = st.merchantQueuedCol; }
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
  for (const w of nextWave) { if (!chestSpaces.has(idx(w.x, 0))) set(w.x, 0, w.piece, B); _rollSpawnEffects(idx(w.x, 0)); }
  for (const b of nextBonuses) {
    if (b.type === 'chest') chestSpaces.add(idx(b.col, 0));
    if (b.type === 'neutral') { set(b.col, 0, b.piece, N); _rollSpawnEffects(idx(b.col, 0)); }
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
  const s = moverIsMax ? W : B, opp = moverIsMax ? B : W;
  if (extra <= 0 || board[pieceI] === NONE || sides[pieceI] !== s) return best;
  if (moverIsMax) { if (best >= beta) return best; alpha = Math.max(alpha, best); }
  else           { if (best <= alpha) return best; beta = Math.min(beta, best); }
  const [px, py] = xy(pieceI);
  for (const to of legalMoves(px, py)) {
    if (s === B && to === merchantIdx) continue;
    const val = withState(() => {
      const wasCap = sides[to] === opp;
      makeMove(pieceI, to); recordPosition();
      return _turnContinuation(to, extra - 1, depth, alpha, beta, moverIsMax);
    });
    if (moverIsMax) { best = Math.max(best, val); if (best >= beta) break; alpha = Math.max(alpha, best); }
    else           { best = Math.min(best, val); if (best <= alpha) break; beta = Math.min(beta, best); }
  }
  return best;
}

function minimax(depth, alpha, beta, maximizing) {
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
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    // Field advance is always a White option in the search
    {
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

// Check if a specific Black King (by board index ki) is in checkmate:
// it must be in check AND no Black move leaves it safe.
function _isSingleKingCheckmated(ki) {
  const [kx, ky] = xy(ki);
  if (!isAttacked(kx, ky, B)) return false; // King is not in check
  const blackMoves = allLegalMovesForSide(B);
  for (const [from, to] of blackMoves) {
    const safe = withState(() => {
      board[to] = board[from]; sides[to] = sides[from]; board[from] = NONE; sides[from] = 0;
      const newPos = (from === ki) ? to : ki;
      const [nkx, nky] = xy(newPos);
      return board[newPos] === KING && sides[newPos] === B && !isAttacked(nkx, nky, B);
    });
    if (safe) return false;
  }
  return true;
}

function aiBestMove() {
  // If checkmated (no legal moves), fall back to pseudo-legal so the enemy is never paralyzed
  let moves = allLegalMovesForSide(B);
  _blackKingsInCheckmate.clear();
  if (moves.length === 0) {
    for (let i = 0; i < 64; i++) { if (board[i] === KING && sides[i] === B) _blackKingsInCheckmate.add(i); }
    moves = allPseudoMovesForSide(B);
  } else {
    for (let i = 0; i < 64; i++) { if (board[i] === KING && sides[i] === B && _isSingleKingCheckmated(i)) _blackKingsInCheckmate.add(i); }
  }
  if (moves.length === 0) return null;
  // Compelled: any move that directly attacks a white King (kill or damage) must be taken
  const kingAttacks = moves.filter(([, to]) => (board[to] === KING || board[to] === CHECKERS_KING) && sides[to] === W);
  const kingIdx = board.findIndex((p, i) => (p === KING || p === CHECKERS_KING) && sides[i] === W);
  console.log(`[aiBestMove] ${moves.length} moves | kingIdx=${kingIdx} | kingAttacks=${kingAttacks.length} | king-targeting moves:`, moves.filter(([,to]) => to === kingIdx).map(([f,t]) => `${f}->${t}`));
  if (kingAttacks.length > 0) return kingAttacks[randInt(kingAttacks.length)];
  // Also compelled: Checkers jumps whose chain will reach a White King
  const chainKingAttacks = moves.filter(([from, to]) => {
    if ((board[from] !== CHECKERS && board[from] !== CHECKERS_KING) || Math.abs(xy(to)[0] - xy(from)[0]) !== 2) return false;
    return withState(() => { makeMove(from, to); return _checkersChainCanKillKing(to); });
  });
  if (chainKingAttacks.length > 0) return chainKingAttacks[randInt(chainKingAttacks.length)];
  if (moves.length === 0) return null;
  let bestScore = Infinity;
  let bestMoves = [];
  for (const [from, to] of moves) {
    const val = withState(() => {
      const wasCap = sides[to] === W;
      makeMove(from, to); recordPosition();
      return _turnContinuation(to, _extraMoveBudget(to, wasCap), AI_DEPTH, -Infinity, Infinity, false);
    });
    if (val < bestScore) {
      bestScore = val;
      bestMoves = [[from, to]];
    } else if (val === bestScore) {
      bestMoves.push([from, to]);
    }
  }
  return bestMoves[randInt(bestMoves.length)];
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
      makeMove(from, to);
      if (forcedAdvance) { simulateLeap(false); recordPosition(); return minimax(depth - 1, -Infinity, Infinity, false); }
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
  return { move: bestMoves.length > 0 ? bestMoves[randInt(bestMoves.length)] : null, score: bestScore };
}

function showHint() {
  if (gameOver || turn !== W || aiThinking) return;
  aiThinking = true;
  draw();
  setTimeout(() => {
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

function aiPlay() {
  if (gameOver || turn !== B) return;
  _blackKingsInCheckmate.clear();
  aiThinking = true;
  draw();
  setTimeout(() => {
    const move = aiBestMove();
    if (move) {
      // If a checkmated King is the one making the forced move, follow it to its new index
      if (_blackKingsInCheckmate.has(move[0])) { _blackKingsInCheckmate.delete(move[0]); _blackKingsInCheckmate.add(move[1]); }
      lastActingSide = B;
      const [mfx, mfy] = xy(move[0]), [mtx, mty] = xy(move[1]);
      const mFromCX = MARGIN + mfx * TILE, mFromCY = BOARD_Y + MARGIN + mfy * TILE;
      const mToCX = MARGIN + mtx * TILE, mToCY = BOARD_Y + MARGIN + mty * TILE;
      const _aiFinish = () => {
        if (countKings(W) === 0) _triggerGameOver(`Game Over! Score: ${score}`);
        else if (isCheckmated(W)) _triggerGameOver(`Checkmate! Score: ${score}`);
        if (gameOver || _rewinderSaveOffer) { aiThinking = false; takeReplaySnapshot(); draw(); return; }
        neutralPlay(() => {
          merchantPlay(() => {
            applyRiverFlow(() => {
              _clearFireOfSide(W); // Black's turn is over — White (player) fire has had its chance to burn Black
              _doSkyDropPhase(() => {
                turn = W;
                aiThinking = false;
                takeReplaySnapshot();
                _turnStartSnapIndices.push(replaySnapshots.length - 1);
                draw();
                startWhiteTurnTimer();
              });
            });
          });
        });
      };

      // Shield bounce: attacker slides in, then bounces back (or Earth bonks defender forward)
      if (sides[move[0]] === B && sides[move[1]] === W && health[move[1]] > attacks[move[0]]) {
        playSfx('shield'); // shield block sound at attack start (pop stays on impact)
        const attackPiece = board[move[0]], attackHlth = health[move[0]];
        const defPiece = board[move[1]], defSide = sides[move[1]], defHlth = health[move[1]];
        const wasLastShield = health[move[1]] === 2;
        const isEarth = !!(elements[move[0]] & ELEM_EARTH);
        const hitCX = mToCX + TILE / 2, hitCY = mToCY + TILE / 2;
        // Phase 1: slide attacker toward defender's square
        startAnim([{ toIdx: move[0], fromCX: mFromCX, fromCY: mFromCY, toCX: mToCX, toCY: mToCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
          const result = applyShieldBounceState(move[0], move[1], attackPiece);
          if (move[1] === merchantIdx) respawnMerchant();
          recordPosition();
          if (wasLastShield) startShieldPop(hitCX, hitCY); // shield blocks on impact (sound + pop)
          if (result.mode === 'earth-bonk') {
            // Attacker already at move[1]; animate defender being bonked to bonkDest
            const [bdx, bdy] = xy(result.bonkDest);
            const bonkCX = MARGIN + bdx * TILE, bonkCY = BOARD_Y + MARGIN + bdy * TILE;
            startAnim([{ toIdx: result.bonkDest, fromCX: mToCX, fromCY: mToCY, toCX: bonkCX, toCY: bonkCY, piece: defPiece, side: defSide, hlth: defHlth - 1, atk: attacks[result.bonkDest], spd: speeds[result.bonkDest] }], 0, () => {
              _aiSpeedContinue(move[1], 0, _aiFinish); // Earth attacker now occupies the defender's square
            });
          } else {
            // Normal bounce: animate attacker sliding back
            const [bx, by] = xy(result.bounceI);
            const bounceCX = MARGIN + bx * TILE, bounceCY = BOARD_Y + MARGIN + by * TILE;
            startAnim([{ toIdx: result.bounceI, fromCX: mToCX, fromCY: mToCY, toCX: bounceCX, toCY: bounceCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
              _aiSpeedContinue(result.bounceI, 0, _aiFinish); // attacker bounced back — may still have Speed moves
            });
          }
        });
      } else {
        const _aiFromElems = elements[move[0]], _aiFromPiece0 = board[move[0]], _aiFromSide0 = sides[move[0]];
        const _aiWaveData = (_aiFromElems & ELEM_WATER) ? _waveLineSqFromMove(move[0], move[1], _aiFromPiece0) : null;
        // Capture detection (before the move): a White target, or a checkers jump over a piece.
        const _aiWasCapture = sides[move[1]] === W
          || ((_aiFromPiece0 === CHECKERS || _aiFromPiece0 === CHECKERS_KING) && Math.abs(mtx - mfx) === 2);
        makeMove(move[0], move[1], true);
        if (_aiFromElems & ELEM_FIRE) applyFireTrail(move[0], move[1], _aiFromPiece0, _aiFromSide0);
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
        startAnim(_aiAnimPieces, 0, () => {
          _drainCaptureAnims();
          checkFireDeath(move[1]);
          if (board[move[1]] !== NONE && itemSpaces[move[1]] !== ITEM_NONE) _applyItemAuto(itemSpaces[move[1]], move[1]);
          recordPosition();
          const _aiAfterLand = () => _aiTryChainJump(move[1], _aiIsCheckersJump, () =>
            _aiBloodthirstyContinue(move[1], _aiWasCapture, (btDest) => _aiSpeedContinue(btDest, 0, _aiFinish)));
          const _aiChainContinues = _aiIsCheckersJump && _checkersJumpsFrom(move[1]).length > 0;
          if (isVoidSpace(move[1]) && _aiPiece0 !== NONE) {
            const [vx, vy] = xy(move[1]);
            startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _aiPiece0, _aiSide0, _aiAfterLand);
          } else if (_aiWaveData && !_aiChainContinues) {
            _aiWaveData.shoveParams.toI = move[1];
            startWaveAnim(_aiWaveData.squares, _aiWaveData.shoveParams, _aiAfterLand);
          } else { _aiAfterLand(); }
        });
      }
    } else {
      // No Black moves — pass through to neutralPlay/merchantPlay
      if (countKings(W) === 0) _triggerGameOver(`Game Over! Score: ${score}`);
      else if (isCheckmated(W)) _triggerGameOver(`Checkmate! Score: ${score}`);
      if (gameOver || _rewinderSaveOffer) { aiThinking = false; takeReplaySnapshot(); draw(); return; }
      neutralPlay(() => {
        merchantPlay(() => {
          applyRiverFlow(() => {
            _clearFireOfSide(W); // Black's turn is over — White (player) fire has had its chance
            _doSkyDropPhase(() => {
              turn = W;
              aiThinking = false;
              takeReplaySnapshot();
              _turnStartSnapIndices.push(replaySnapshots.length - 1);
              draw();
              startWhiteTurnTimer();
            });
          });
        });
      });
    }
  }, 50);
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
  const waveData = (elems & ELEM_WATER) ? _waveLineSqFromMove(dest, best, piece0) : null;
  makeMove(dest, best, true);
  if (elems & ELEM_FIRE) applyFireTrail(dest, best, piece0, side0);
  const p0 = board[best], s0 = sides[best], h0 = health[best];
  const anims = [{ toIdx: best, fromCX, fromCY, toCX, toCY, piece: p0, side: s0, hlth: h0, atk: attacks[best], spd: speeds[best] }];
  _appendCaptureGhosts(anims);
  startAnim(anims, 0, () => {
    _drainCaptureAnims();
    checkFireDeath(best);
    if (board[best] !== NONE && itemSpaces[best] !== ITEM_NONE) _applyItemAuto(itemSpaces[best], best);
    recordPosition();
    if (waveData) { waveData.shoveParams.toI = best; startWaveAnim(waveData.squares, waveData.shoveParams, () => onDone(best)); }
    else onDone(best);
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
  const chainWaveData = (chainElems & ELEM_WATER) ? _waveLineSqFromMove(landI, nextTo, chainPiece0) : null;
  makeMove(landI, nextTo, true);
  if (chainElems & ELEM_FIRE) applyFireTrail(landI, nextTo, chainPiece0, chainSide0);
  const cp0 = board[nextTo], cs0 = sides[nextTo], ch0 = health[nextTo];
  const chainAnims = [{ toIdx: nextTo, fromCX, fromCY, toCX, toCY, piece: cp0, side: cs0, hlth: ch0, atk: attacks[nextTo], spd: speeds[nextTo], arc: TILE * 1.5 }];
  _appendCaptureGhosts(chainAnims);
  startAnim(chainAnims, 0, () => {
    _drainCaptureAnims();
    checkFireDeath(nextTo);
    recordPosition();
    const isFinalJump = _checkersJumpsFrom(nextTo).length === 0;
    const afterChain = () => _aiTryChainJump(nextTo, true, onDone);
    if (chainWaveData && isFinalJump) {
      chainWaveData.shoveParams.toI = nextTo;
      startWaveAnim(chainWaveData.squares, chainWaveData.shoveParams, afterChain);
    } else { afterChain(); }
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
// item lands on / is triggered by a Neutral or Black piece — mirrors the player's teleport).
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
  checkFireDeath(_tDest); // teleported onto enemy fire — burns
}

// Auto-clone: drop a same-side copy of the piece at i onto a random adjacent empty square.
function _autoClone(i) {
  const dests = adjacentClonerDests(i).filter(j => j !== merchantIdx && !isVoidSpace(j) && !isBlockSpace(j));
  if (dests.length === 0) return;
  playSfx('clone');
  const _cDest = dests[randInt(dests.length)];
  copyPiece(i, _cDest); // clone keeps the same side/stats/effects
  checkFireDeath(_cDest); // clone dropped onto enemy fire — burns
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

// Auto-apply an item to any piece (used for Black/Neutral landings). Teleporter/Cloner auto-trigger
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
  if (hasDrops) {
    if (flyAnims.length === 0 && itemFlyAnims.length === 0 && shieldPops.length === 0 && _skyDropAnims.length === 1) requestAnimationFrame(_flyTick);
    // Land all drops deterministically before onDone (which snapshots the turn start), so the
    // snapshot never misses an item that's still mid-animation — otherwise a later Rewinder loses it.
    setTimeout(() => { _resolveAllSkyDrops(); onDone(); }, 420);
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
    if (i === merchantIdx) respawnMerchant();
    itemSpaces[i] = ITEM_NONE;
  }
  for (const bi of chainBombs) {
    setTimeout(() => detonateBomb(bi, detonated), 350);
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
const _SETUP_BTN_W = Math.floor((BOARD_PX - 2 * BTN_GAP) / 3);
const CLASSIC_BTN  = { x: MARGIN, y: BTN_Y, w: _SETUP_BTN_W, h: 60 };
const SETUP_ROLL_BTN = { x: MARGIN + _SETUP_BTN_W + BTN_GAP, y: BTN_Y, w: _SETUP_BTN_W, h: 60 };
const SETUP_GO_BTN   = { x: MARGIN + 2 * (_SETUP_BTN_W + BTN_GAP), y: BTN_Y, w: _SETUP_BTN_W, h: 60 };
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

// --- Draw ---

function drawBackground(_fieldAnim, _animT) {
// Ground texture — tiles vertically, scrolls with the field
const groundEl = spriteImages["ground"];
if (groundEl && groundEl.complete && groundEl.naturalWidth > 0) {
  const gw = groundEl.naturalWidth, gh = groundEl.naturalHeight;
  const scale = canvas.width / gw;
  const tileH = gh * scale;
  const animScrollDy = _fieldAnim ? -anim.boardDy * (1 - _animT) : 0;
  const rawOffset = -leapCount * TILE + animScrollDy;
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
  } else if (b.type === 'neutral') {
    {
      _drawPieceSprite(ctx, N, b.piece, bpx + prevPad, bpy + prevPad, TILE - prevPad * 2, TILE - prevPad * 2, false, true);
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

// Block spaces
for (let i = 0; i < 64; i++) {
  const sp = specialSpaces[i];
  if (!sp || sp.type !== 'block') continue;
  const [x, y] = xy(i);
  drawBlockTile(ctx, MARGIN + x * TILE, MARGIN + y * TILE, TILE);
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

// Fire squares: orange overlay
for (const fi of fireSquares.keys()) {
  const [fx, fy] = xy(fi);
  ctx.fillStyle = 'rgba(255,80,0,0.38)';
  ctx.fillRect(MARGIN + fx * TILE, MARGIN + fy * TILE, TILE, TILE);
  // Flicker edge
  ctx.strokeStyle = 'rgba(255,160,0,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(MARGIN + fx * TILE + 1, MARGIN + fy * TILE + 1, TILE - 2, TILE - 2);
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
  if (board[i] === KING && sides[i] === B && !_animToSet.has(i) && _blackKingsInCheckmate.has(i)) {
    ctx.save();
    ctx.shadowColor = '#ff1111';
    ctx.shadowBlur = 28;
    _drawPieceSprite(ctx, sides[i], board[i], _drawX + pad, _drawY + pad, TILE - pad * 2, TILE - pad * 2, _isActivePiece);
    ctx.restore();
  } else {
    _drawPieceSprite(ctx, sides[i], board[i], _drawX + pad, _drawY + pad, TILE - pad * 2, TILE - pad * 2, _isActivePiece);
  }
  _drawPieceEffectIcons(ctx, _drawX, _drawY, effectOrders[i]);
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
      const _isCheckmatedBK = ap.piece === KING && ap.side === B && (_blackKingsInCheckmate.has(ap.fromIdx ?? -1) || _blackKingsInCheckmate.has(ap.toIdx ?? -1));
      if (_isCheckmatedBK) {
        ctx.save(); ctx.shadowColor = '#ff1111'; ctx.shadowBlur = 28;
        _drawPieceSprite(ctx, ap.side, ap.piece, acx + apad, acy + apad, TILE - apad * 2, TILE - apad * 2);
        ctx.restore();
      } else {
        _drawPieceSprite(ctx, ap.side, ap.piece, acx + apad, acy + apad, TILE - apad * 2, TILE - apad * 2);
      }
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
    const isActive = (piecePromoterMode || teleporterMode || clonerMode || shieldMode) && inventory._activeSlot === slotIdx;
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
  ctx.fillStyle = "#5a2a2a";
  ctx.beginPath(); ctx.roundRect(MARGIN, BTN_Y, halfW, btnH, 8); ctx.fill();
  ctx.fillStyle = "#ff8888";
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("✕  Cancel", MARGIN + halfW / 2, BTN_Y + btnH / 2);
  // Trash
  ctx.fillStyle = "#2a2a2a";
  ctx.beginPath(); ctx.roundRect(MARGIN + BOARD_PX / 2 + BTN_GAP / 2, BTN_Y, halfW, btnH, 8); ctx.fill();
  ctx.fillStyle = "#aaa";
  ctx.fillText("🗑  Discard", MARGIN + BOARD_PX / 2 + BTN_GAP / 2 + halfW / 2, BTN_Y + btnH / 2);
} else if (!gameOver && gamePhase === 'setup') {
  // Classic | Roll | Go
  const _setupBtns = [
    { btn: CLASSIC_BTN,    color: "#6e4a1a", label: "Classic" },
    { btn: SETUP_ROLL_BTN, color: "#4a3a7a", label: "🎲 Roll" },
    { btn: SETUP_GO_BTN,   color: "#2a6e3f", label: "▶ Go!" },
  ];
  for (const { btn, color, label } of _setupBtns) {
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(btn.x, btn.y, btn.w, btn.h, 6); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff"; ctx.font = "42px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }

  // Timed Mode toggle row
  {
    const tmY = COUNTDOWN_Y;
    const tmCX = MARGIN + BOARD_PX / 2; // center divider: labels right-align here, chips left-align here
    const chipW = 86, chipH = 44, chipGap = 10;
    ctx.font = "42px Canterbury"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#fff";
    ctx.fillText("Timed:", tmCX - 12, tmY);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    const offX = tmCX + 12, onX = tmCX + 12 + chipW + chipGap;
    // OFF chip
    ctx.fillStyle = !timedMode ? "#4a3a7a" : "#333";
    ctx.beginPath(); ctx.roundRect(offX, tmY - chipH / 2, chipW, chipH, 6); ctx.fill();
    ctx.fillStyle = !timedMode ? "#fff" : "#888"; ctx.font = "34px Canterbury"; ctx.textAlign = "center";
    ctx.fillText("OFF", offX + chipW / 2, tmY);
    // ON chip
    ctx.fillStyle = timedMode ? "#2a6e3f" : "#333";
    ctx.beginPath(); ctx.roundRect(onX, tmY - chipH / 2, chipW, chipH, 6); ctx.fill();
    ctx.fillStyle = timedMode ? "#fff" : "#888";
    ctx.fillText("ON", onX + chipW / 2, tmY);

    if (timedMode) {
      const psY = tmY + 62;
      ctx.font = "42px Canterbury"; ctx.textAlign = "right";
      ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
      ctx.fillStyle = "#fff";
      ctx.fillText("Seconds per turn:", tmCX - 12, psY);
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      const labels = ["15s", "30s", "1m", "2m", "5m"];
      const pW = chipW, pGap = chipGap;
      let px = tmCX + 12;
      TIMED_PRESETS.forEach((secs, i) => {
        const active = timedModeSecs === secs;
        ctx.fillStyle = active ? "#1a5a8a" : "#333";
        ctx.beginPath(); ctx.roundRect(px, psY - 22, pW, 44, 6); ctx.fill();
        ctx.fillStyle = active ? "#fff" : "#888"; ctx.textAlign = "center";
        ctx.fillText(labels[i], px + pW / 2, psY);
        px += pW + pGap;
      });
    }
  }
  // Achievements button
  {
    const b = ACH_MENU_BTN;
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#6e5a1a";
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 6); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff"; ctx.font = "40px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Achievements", b.x + b.w / 2, b.y + b.h / 2);
    ctx.textBaseline = "alphabetic";
  }
} else if (!gameOver && gamePhase === 'playing') {
  const shiftUrgent = shiftCountdown <= 3;
  if (!replayMode || _miniReplayActive) {
    // Team Leap
    const canLeap = canTeamLeap();
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = canLeap ? LEAP_BTN_COLOR : LEAP_BTN_DISABLED;
    ctx.beginPath();
    ctx.roundRect(LEAP_BTN.x, LEAP_BTN.y, LEAP_BTN.w, LEAP_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = canLeap ? "#fff" : "#999";
    ctx.font = "42px Canterbury";
    ctx.fillText("Team Advance", LEAP_BTN.x + LEAP_BTN.w / 2, LEAP_BTN.y + LEAP_BTN.h / 2);

    // Pitch Shift
    const canShift = canManualPitchShift();
    const shiftHighlight = hintMove === "leap";
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = shiftHighlight ? "#e8a735" : (shiftUrgent ? "#8a1a1a" : (canShift ? "#1a5a8a" : LEAP_BTN_DISABLED));
    ctx.beginPath();
    ctx.roundRect(PITCH_BTN.x, PITCH_BTN.y, PITCH_BTN.w, PITCH_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = canShift ? "#fff" : "#999";
    ctx.font = "42px Canterbury";
    ctx.fillText("Field Advance", PITCH_BTN.x + PITCH_BTN.w / 2, PITCH_BTN.y + PITCH_BTN.h / 2);
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
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#993333";
    ctx.beginPath();
    ctx.roundRect(RESIGN_BTN.x, RESIGN_BTN.y, RESIGN_BTN.w, RESIGN_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff";
    ctx.fillText("Resign", RESIGN_BTN.x + RESIGN_BTN.w / 2, RESIGN_BTN.y + RESIGN_BTN.h / 2);

    // Auto-play toggle button
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = autoPlay ? "#1a7a3a" : "#444466";
    ctx.beginPath();
    ctx.roundRect(AUTO_BTN.x, AUTO_BTN.y, AUTO_BTN.w, AUTO_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff";
    ctx.fillText(autoPlay ? "⏸ Auto" : "▶ Auto", AUTO_BTN.x + AUTO_BTN.w / 2, AUTO_BTN.y + AUTO_BTN.h / 2);

    // Last Move replay button
    if (replaySnapshots.length > 1) {
      ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
      ctx.fillStyle = "#1a4a7a";
      ctx.beginPath();
      ctx.roundRect(LAST_MOVE_BTN.x, LAST_MOVE_BTN.y, LAST_MOVE_BTN.w, LAST_MOVE_BTN.h, 6);
      ctx.fill();
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.fillStyle = "#fff";
      ctx.fillText("⟳ Last Move", LAST_MOVE_BTN.x + LAST_MOVE_BTN.w / 2, LAST_MOVE_BTN.y + LAST_MOVE_BTN.h / 2);
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
  const btnW = 280, btnH = 70, btnGap = 24;
  const totalW = btnW * 2 + btnGap;
  const soY = boardCY + 120;
  const soX = boardCX - totalW / 2;
  const repX = soX + btnW + btnGap;
  ctx.font = "44px Canterbury";
  ctx.fillStyle = "#2a6e3f";
  ctx.beginPath(); ctx.roundRect(soX, soY, btnW, btnH, 8); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText("Start Over", soX + btnW / 2, soY + btnH / 2);
  ctx.fillStyle = replaySnapshots.length > 0 ? "#1a4a8a" : "#333";
  ctx.beginPath(); ctx.roundRect(repX, soY, btnW, btnH, 8); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.fillText("Replay", repX + btnW / 2, soY + btnH / 2);
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
    ctx.fillStyle = btn.enabled ? btn.color : "#222";
    ctx.beginPath(); ctx.roundRect(bx, by, bW, bH, 8); ctx.fill();
    ctx.fillStyle = btn.enabled ? "#fff" : "#555";
    ctx.fillText(btn.label, bx + bW / 2, by + bH / 2);
    bx += bW + bGap;
  }
}
}

function drawGraveyardPanels() {
// Graveyard panels (hidden while using an item or in replay mode)
if (!isItemActive() && gamePhase === 'playing' && (!replayMode || _miniReplayActive)) for (const [pool, isPlayer] of [[playerDead, true], [enemyDead, false]]) {
  const gx = isPlayer ? PLAYER_GRAVE_X : ENEMY_GRAVE_X;
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#fff";
  ctx.fillText(isPlayer ? "Fallen" : "Slain", gx + GRAVE_W / 2, GRAVE_Y - 6);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath(); ctx.roundRect(gx, GRAVE_Y, GRAVE_W, GRAVE_H, 6); ctx.fill();
  const sideVal = isPlayer ? W : B;
  const slotW = GRAVE_W / GRAVE_TYPES.length;
  const pieceSz = 80;
  const pieceCY = GRAVE_Y + 10 + pieceSz / 2;
  for (let si = 0; si < GRAVE_TYPES.length; si++) {
    const pt = GRAVE_TYPES[si];
    const count = pool[pt] || 0;
    const [cx] = graveSlotPos(isPlayer, pt);
    const cy = pieceCY;
    const isKing = pt === KING;
    if (count === 0) {
      if (pt !== CHECKERS && pt !== CHECKERS_KING) {
        ctx.globalAlpha = 0.15;
        _drawPieceSprite(ctx, sideVal, pt, cx - pieceSz / 2, cy - pieceSz / 2, pieceSz, pieceSz, false, false, true);
        ctx.globalAlpha = 1;
      }
    } else {
      if (isKing) {
        ctx.fillStyle = isPlayer ? "rgba(180,60,60,0.5)" : "rgba(60,160,60,0.5)";
        ctx.beginPath(); ctx.arc(cx, cy, pieceSz / 2 + 2, 0, Math.PI * 2); ctx.fill();
      }
      _drawPieceSprite(ctx, sideVal, pt, cx - pieceSz / 2, cy - pieceSz / 2, pieceSz, pieceSz, false, false, true);
      ctx.font = "28px Canterbury";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(`x${count}`, cx, cy + pieceSz / 2 + 4);
    }
  }
}

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
    // Use Rewinder
    playSfx('button');
    _rewinderSaveOffer = false;
    console.log('[RewinderOffer] indices before:', JSON.stringify(_turnStartSnapIndices), '| snapshots.length:', replaySnapshots.length);
    if (_turnStartSnapIndices.length < 1) { gameOver = true; stopWindLoop(0); playSfx('over1'); playSfx('over2'); draw(); return; }
    const targetIdx = _turnStartSnapIndices.pop(); // last entry IS the turn to restore (no new entry was pushed after Black's fatal move)
    console.log('[RewinderOffer] targetIdx:', targetIdx, '| indices now:', JSON.stringify(_turnStartSnapIndices), '| targetSnap.turn:', replaySnapshots[targetIdx]?.turn);
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
  } else if (cx >= noX && cx <= noX + btnW) {
    // Accept game over
    playSfx('button');
    _rewinderSaveOffer = false;
    gameOver = true;
    stopWindLoop(0); // silence ambient wind on Game Over
    playSfx('over1'); playSfx('over2'); // Game Over
    draw();
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
  { id: 'water_bomb',  name: 'Flushed',  desc: 'Take a Black Warrior by pushing them into a Bomb with a Water Piece', check: () => _pushedBlackIntoBombByWater },
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a2e"; ctx.fillRect(0, 0, canvas.width, canvas.height);

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
    // base cell
    if (!ach)            ctx.fillStyle = ((i % 8 + Math.floor(i / 8)) % 2) ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)"; // empty slot
    else if (unlocked)   ctx.fillStyle = "#2a8f4f"; // accomplished — filled in
    else                 ctx.fillStyle = "#3a3a55"; // available but locked
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
    ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 8); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 8); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "38px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 2);
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
  const inR = (r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
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
  if (!spritesLoaded || !_continued) { _drawSplash(); return; }
  if (achievementsOpen) { drawAchievementsScreen(); return; }
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
  drawGraveyardPanels();
  drawResignConfirm();
  drawRewinderSaveOffer();
  drawShieldPops();
  drawExplosion();
  drawVoidDeath();
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
  ctx.font = "22px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(VERSION, 8, canvas.height - 6);

}

function canvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [(e.clientX - rect.left) * canvas.width / rect.width,
          (e.clientY - rect.top) * canvas.height / rect.height];
}

function trashBounds() {
  const invY = INV_PANEL_TOP + 50;
  const panelH = INV_ROWS * (INV_SLOT + INV_PAD) + INV_PAD + 28;
  return { x: INV_X, y: invY - 24 + panelH + 10, w: INV_W, h: 54 };
}

canvas.addEventListener("mousedown", (e) => {
  if (replayMode || gameOver || anim || turn !== W || aiThinking || shopMode || sellMode || sellConfirmSlot >= 0 || gamePhase !== 'playing') return;
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
      _promotePawnTo(item, i);
      removeFromInventory(slot); delete inventory._activeSlot;
      piecePromoterMode = false; piecePromoterTo = NONE;
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_SHIELD && sides[i] === W) {
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
  const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
  const btnW = 280, btnH = 70, btnGap = 24;
  const soY = boardCY + 120;
  const soX = boardCX - (btnW * 2 + btnGap) / 2;
  const repX = soX + btnW + btnGap;
  if (cx >= soX && cx <= soX + btnW && cy >= soY && cy <= soY + btnH) {
    playSfx('button'); initBoard(); draw();
  } else if (cx >= repX && cx <= repX + btnW && cy >= soY && cy <= soY + btnH) {
    playSfx('button'); enterReplay();
  }
}

function handleItemCancelOrTrash(cx, cy) {
  const halfW = BOARD_PX / 2 - BTN_GAP / 2;
  const btnH = 80;
  if (cx >= MARGIN && cx <= MARGIN + halfW && cy >= BTN_Y && cy <= BTN_Y + btnH) {
    playSfx('button'); cancelItemMode(); return true;
  }
  if (cx >= MARGIN + BOARD_PX / 2 + BTN_GAP / 2 && cx <= MARGIN + BOARD_PX && cy >= BTN_Y && cy <= BTN_Y + btnH) {
    playSfx('button'); trashActiveItem(); return true;
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
    if (item !== ITEM_NONE) { gold += sellValue(item); removeFromInventory(sellConfirmSlot); playSfx('sell'); _turnSells++; }
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
  const i2 = cellIdxFromCoords(cx, cy);
  const eligible = i2 >= 0 && sides[i2] === W && board[i2] === PAWN;
  if (eligible) {
    board[i2] = piecePromoterTo === PROMOTER_WILD ? _rollWildTo() : piecePromoterTo;
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    const fromSpace = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1;
    piecePromoterMode = false; piecePromoterTo = NONE;
    if (fromSpace) { processNextQueuedItem(); } else { draw(); }
    return;
  }
  piecePromoterMode = false; piecePromoterTo = NONE;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function handleShieldClick(cx, cy) {
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0 && sides[i] === W) {
    _applyStatEffect(ITEM_SHIELD, i);
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    shieldMode = false; draw(); return;
  }
  shieldMode = false;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function handleBombClick(cx, cy) {
  const i = cellIdxFromCoords(cx, cy);
  bombMode = false; bombHoverIdx = -1;
  if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
  _bombSource = 'inv'; // Bomb used from inventory
  if (i >= 0) {
    detonateBomb(i);
    recordPosition();
    if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); } else { draw(); }
  } else { draw(); }
}

function handleClonerClick(cx, cy) {
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0) {
    if (clonerSelected < 0) {
      if (sides[i] === W && adjacentClonerDests(i).length > 0) {
        clonerSelected = i; draw(); return;
      }
    } else {
      const dests = adjacentClonerDests(clonerSelected);
      if (dests.includes(i)) {
        if (chestSpaces.has(i)) { chestSpaces.delete(i); playSfx('chest'); playSfx('pickup'); const _ci = _randomItem(); const [_cx2,_cy2]=xy(i); startItemFlyAnim(_ci, MARGIN+_cx2*TILE+TILE/2, BOARD_Y+MARGIN+_cy2*TILE+TILE/2, findInventorySlot()); }
        copyPiece(clonerSelected, i); sides[i] = W; playSfx('clone');
        checkFireDeath(i); // clone dropped onto enemy fire — burns
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
  activeItemSpaceIdx = -1; clonerMode = false; clonerSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  if (clonerCancelSpace) { processNextQueuedItem(); } else { draw(); }
}


function handleTeleporterClick(cx, cy) {
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0) {
    if (teleporterSelected < 0) {
      if (sides[i] === W) { teleporterSelected = i; draw(); return; }
    } else {
      if (board[i] === NONE) {
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
        checkFireDeath(i); // teleported onto enemy fire — burns (checkWhiteKingAlive below covers the King)
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
  activeItemSpaceIdx = -1; teleporterMode = false; teleporterSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  if (teleFromSpace) { processNextQueuedItem(); } else { draw(); }
}

function handleElementizerClick(cx, cy) {
  const i = cellIdxFromCoords(cx, cy);
  if (i >= 0 && sides[i] === W) {
    const resolvedElem = elementizerMystery ? ELEM_ALL[randInt(4)] : elementizerElem;
    effectOrders[i] = effectOrders[i].filter(e => e !== 'fire' && e !== 'water' && e !== 'earth' && e !== 'air');
    elements[i] = resolvedElem;
    _grantEffect(i, _ELEM_BADGE[resolvedElem]);
    if (resolvedElem === ELEM_EARTH) { health[i] = 2; _grantEffect(i, 'hlt'); }
    playSfx('spell'); // item grants a piece an effect
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    const fromSpace = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1; elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
    if (fromSpace) { processNextQueuedItem(); } else { firstMoveMade = true; recordPosition(); draw(); }
    return;
  }
  const fromSpace = activeItemSpaceIdx >= 0;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  activeItemSpaceIdx = -1; elementizerMode = false; elementizerElem = 0; elementizerMystery = false;
  if (fromSpace) { processNextQueuedItem(); } else { draw(); }
}

// Shared handler for single-target stat-buff item modes (Sword, Speed, Vampire Fang).
// Applies `item` to a clicked White piece, else cancels; `clearMode` resets the mode flag.
function _handleStatItemClick(cx, cy, item, clearMode) {
  const i = cellIdxFromCoords(cx, cy);
  const fromSpace = activeItemSpaceIdx >= 0;
  const hit = i >= 0 && sides[i] === W;
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

function handleInventoryClick(cx, cy) {
  if (gamePhase !== 'playing' || turn !== W || aiThinking) return false;
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
        if (_turnStartSnapIndices.length < 2) return true; // nothing to undo yet
        _turnStartSnapIndices.pop(); // discard current turn start
        const targetIdx = _turnStartSnapIndices[_turnStartSnapIndices.length - 1];
        const targetSnap = replaySnapshots[targetIdx];
        console.log('[Rewinder] targetIdx:', targetIdx, 'of', replaySnapshots.length,
          '| turn indices:', JSON.stringify(_turnStartSnapIndices),
          '| snap.turn:', targetSnap.turn,
          '| snap.playerDead:', JSON.stringify(targetSnap.playerDead),
          '| snap.board (64):', JSON.stringify(targetSnap.board));
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
  if (!inB(gx, gy)) { selected = -1; validMoves = []; draw(); return; }
  const clicked = idx(gx, gy);
  if (selected < 0) {
    if (sides[clicked] === W) { selected = clicked; validMoves = legalMoves(gx, gy); playSelectSfx(board[clicked]); }
  } else {
    if (validMoves.includes(clicked)) {
      const [pfx, pfy] = xy(selected), [ptx, pty] = xy(clicked);
      const pFromCX = MARGIN + pfx * TILE, pFromCY = BOARD_Y + MARGIN + pfy * TILE;
      const pToCX = MARGIN + ptx * TILE, pToCY = BOARD_Y + MARGIN + pty * TILE;
      const isCKS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && ptx === 6 && !wkMoved;
      const isCQS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && ptx === 2 && !wkMoved;
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
      // Hire neutral: bounce attacker, neutral turns white
      if (sides[clicked] === N) {
        const fromI = selected;
        const attackPiece = board[fromI], attackHlth = health[fromI];
        const recruitedType = board[clicked]; // the neutral being recruited (only a King/Checkers King actually recruits)
        if (attackPiece === KING || attackPiece === CHECKERS_KING) {
          playSfx('recruit'); // King (or Checkers King) recruits the Neutral
          _turnRecruited = true;                                    // recruited a Grey this turn (streak)
          if (attackPiece === CHECKERS_KING) _recruitedWithCKing = true; // recruited with a Checkers King
          if (recruitedType === CHECKERS) _recruitedCManThisRun = true;
          if (recruitedType === CHECKERS_KING) _recruitedCKingThisRun = true;
        }
        const bounceI = calcBouncePos(fromI, clicked, attackPiece);
        selected = -1; validMoves = [];
        makeMove(fromI, clicked, false);
        recordPosition();
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
        const bounceI = result.mode === 'attacker-bounce' ? result.bounceI : fromI;
        selected = -1; validMoves = [];
        // Pre-register Speed so endWhiteTurn offers the extra move after the bounce
        // (mirrors the AI's _aiSpeedContinue after a shield bounce).
        const _sbFinalI = result.mode === 'earth-bonk' ? clicked : result.bounceI;
        if (sides[_sbFinalI] === W && speeds[_sbFinalI] > 1 && _speedMovesUsed < speeds[_sbFinalI] - 1) {
          _speedMovesUsed++; _speedIdx = _sbFinalI;
        }
        recordPosition();
        _doBounceAnim(fromI, pToCX, pToCY, bounceI, null, attackPiece, W, attackHlth, endWhiteTurn);
        return;
      }
      // Engage merchant: bounce attacker, open shop, then end turn
      if (clicked === merchantIdx) {
        const fromI = selected;
        const attackPiece = board[fromI], attackHlth = health[fromI], attackElem = elements[fromI], attackStat = statuses[fromI], attackAtk = attacks[fromI], attackSpd = speeds[fromI];
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
            board[bounceI] = attackPiece; sides[bounceI] = W; health[bounceI] = attackHlth; elements[bounceI] = attackElem; statuses[bounceI] = attackStat; attacks[bounceI] = attackAtk; speeds[bounceI] = attackSpd;
            clearSquare(fromI);
          }
          // Pre-register speed so endWhiteTurn shows second move after shop closes
          const _mSpI = bounceI !== fromI ? bounceI : fromI;
          if (speeds[_mSpI] > 1 && _speedMovesUsed < speeds[_mSpI] - 1) {
            _speedMovesUsed++; _speedIdx = _mSpI;
          }
          openMerchantShop(endWhiteTurn);
        });
        return;
      }
      const _fromElems = elements[selected], _fromPiece = board[selected], _fromSide = sides[selected], _fromI = selected;
      const _waveData = (_fromElems & ELEM_WATER) ? _waveLineSqFromMove(selected, clickedDest, _fromPiece) : null;
      const _midI2 = (Math.abs(ptx - pfx) === 2 && Math.abs(pty - pfy) === 2) ? idx((pfx + ptx) >> 1, (pfy + pty) >> 1) : -1;
      const _isCheckersJump = (_fromPiece === CHECKERS || _fromPiece === CHECKERS_KING)
        && _midI2 >= 0 && board[_midI2] !== NONE && sides[_midI2] !== _fromSide;
      const _wasCapture = sides[clicked] === B || _isCheckersJump;
      makeMove(selected, clicked, true);
      if (_fromElems & ELEM_FIRE) applyFireTrail(selected, clickedDest, _fromPiece, _fromSide);
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
        checkFireDeath(movedTo); // landing on enemy fire burns (same as the AI/auto paths)
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
      startAnim(wAnimPieces, 0, () => {
        _drainCaptureAnims();
        checkWhiteKingAlive();
        if (gameOver || _rewinderSaveOffer) { takeReplaySnapshot(); draw(); return; }
        const _afterWave = () => {
          if (isVoidSpace(clickedDest) && _wPiece0 !== NONE) {
            const [vx, vy] = xy(clickedDest);
            startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _wPiece0, _wSide0, () => _wContinue(clickedDest));
          } else { _wContinue(clickedDest); }
        };
        // For Water Checkers chains: suppress wave on non-final jumps; final jump applies its own wave
        const _chainContinues = _isCheckersJump
          && (board[clickedDest] === CHECKERS || board[clickedDest] === CHECKERS_KING)
          && _checkersJumpsFrom(clickedDest).length > 0;
        if (_waveData && !_chainContinues) {
          _waveData.shoveParams.toI = clickedDest;
          startWaveAnim(_waveData.squares, _waveData.shoveParams, _afterWave);
        } else {
          _afterWave();
        }
      });
      return;
    } else if (clicked === selected) {
      if (_speedIdx >= 0) { _speedIdx = -1; _speedMovesUsed = 0; selected = -1; validMoves = []; endWhiteTurn(); return; }
      if (_bloodthirstyIdx >= 0) { _bloodthirstyIdx = -1; _bloodthirstyUsed = false; selected = -1; validMoves = []; endWhiteTurn(); return; }
      if (_checkersChainIdx < 0) { selected = -1; validMoves = []; }
    } else if (sides[clicked] === W) {
      if (_checkersChainIdx < 0 && _bloodthirstyIdx < 0 && _speedIdx < 0) { selected = clicked; validMoves = legalMoves(gx, gy); playSelectSfx(board[clicked]); }
    } else {
      if (_checkersChainIdx < 0 && _bloodthirstyIdx < 0 && _speedIdx < 0) { selected = -1; validMoves = []; }
    }
  }
  draw();
}

canvas.addEventListener("click", (e) => {
  if (dragConsumed) { dragConsumed = false; return; }
  const [cx, cy] = canvasCoords(e);
  if (spritesLoaded && !_continued) { _doContinue(); return; } // Continue button on the loading screen
  if (achievementsOpen) { handleAchievementsClick(cx, cy); return; }
  if (replayMode) { handleReplayClick(cx, cy); return; }
  if (_rewinderSaveOffer) { handleRewinderSaveOfferClick(cx, cy); return; }
  if (gameOver) { handleGameOverClick(cx, cy); return; }
  if (anim || _conquestGifActive) return;
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
  if (!gameOver && cx >= RESIGN_BTN.x && cx <= RESIGN_BTN.x + RESIGN_BTN.w &&
      cy >= RESIGN_BTN.y && cy <= RESIGN_BTN.y + RESIGN_BTN.h) { playSfx('button'); resignConfirm = true; draw(); return; }
  if (!gameOver && replaySnapshots.length > 1 &&
      turn === W && !aiThinking &&
      _speedIdx < 0 && _bloodthirstyIdx < 0 && _checkersChainIdx < 0 && // mid-turn extra-move pending: replay would revert the first move
      cx >= LAST_MOVE_BTN.x && cx <= LAST_MOVE_BTN.x + LAST_MOVE_BTN.w &&
      cy >= LAST_MOVE_BTN.y && cy <= LAST_MOVE_BTN.y + LAST_MOVE_BTN.h) {
    playSfx('button');
    selected = -1; validMoves = []; // clear any selection — the board is about to be spliced
    replayMode = true; _miniReplayActive = true;
    _playReplayTransition(replaySnapshots.length - 1, () => {
      replayMode = false; _miniReplayActive = false;
      draw();
    });
    return;
  }
  if (!gameOver && cx >= AUTO_BTN.x && cx <= AUTO_BTN.x + AUTO_BTN.w &&
      cy >= AUTO_BTN.y && cy <= AUTO_BTN.y + AUTO_BTN.h) {
    playSfx('button');
    autoPlay = !autoPlay; draw();
    if (autoPlay && turn === W && !aiThinking && !anim) autoWhitePlay();
    return;
  }
  if (handleInventoryClick(cx, cy)) return;
  if (testMode && cx >= HINT_BTN.x && cx <= HINT_BTN.x + HINT_BTN.w &&
      cy >= HINT_BTN.y && cy <= HINT_BTN.y + HINT_BTN.h) { playSfx('button'); showHint(); return; }
  if (gamePhase === 'setup') {
    if (cx >= CLASSIC_BTN.x && cx <= CLASSIC_BTN.x + CLASSIC_BTN.w &&
        cy >= CLASSIC_BTN.y && cy <= CLASSIC_BTN.y + CLASSIC_BTN.h) { playSfx('button'); classicSetup(); draw(); return; }
    if (cx >= SETUP_ROLL_BTN.x && cx <= SETUP_ROLL_BTN.x + SETUP_ROLL_BTN.w &&
        cy >= SETUP_ROLL_BTN.y && cy <= SETUP_ROLL_BTN.y + SETUP_ROLL_BTN.h) { playSfx('button'); rollSetup(); draw(); return; }
    if (cx >= SETUP_GO_BTN.x && cx <= SETUP_GO_BTN.x + SETUP_GO_BTN.w &&
        cy >= SETUP_GO_BTN.y && cy <= SETUP_GO_BTN.y + SETUP_GO_BTN.h) { playSfx('button'); playConquestGif(); return; }
    if (cx >= ACH_MENU_BTN.x && cx <= ACH_MENU_BTN.x + ACH_MENU_BTN.w &&
        cy >= ACH_MENU_BTN.y && cy <= ACH_MENU_BTN.y + ACH_MENU_BTN.h) { playSfx('button'); achievementsOpen = true; _achSelected = 0; _achClearConfirm = false; draw(); return; }
    // Timed mode toggle
    {
      const tmY = COUNTDOWN_Y, chipH = 44, chipW = 86, chipGap = 10;
      const tmCX = MARGIN + BOARD_PX / 2;
      const offX = tmCX + 12, onX = tmCX + 12 + chipW + chipGap;
      if (cx >= offX && cx <= offX + chipW && cy >= tmY - chipH / 2 && cy <= tmY + chipH / 2) { playSfx('button'); timedMode = false; draw(); return; }
      if (cx >= onX && cx <= onX + chipW && cy >= tmY - chipH / 2 && cy <= tmY + chipH / 2) { playSfx('button'); timedMode = true; draw(); return; }
      if (timedMode) {
        const psY = tmY + 62, pW = chipW, pGap = chipGap;
        let px = tmCX + 12;
        for (let i = 0; i < TIMED_PRESETS.length; i++) {
          if (cx >= px && cx <= px + pW && cy >= psY - 22 && cy <= psY + 22) { playSfx('button'); timedModeSecs = TIMED_PRESETS[i]; draw(); return; }
          px += pW + pGap;
        }
      }
    }
    return;
  }
  if (cx >= LEAP_BTN.x && cx <= LEAP_BTN.x + LEAP_BTN.w &&
      cy >= LEAP_BTN.y && cy <= LEAP_BTN.y + LEAP_BTN.h) { playSfx('button'); hintMove = null; teamAdvance(); return; }
  if (cx >= PITCH_BTN.x && cx <= PITCH_BTN.x + PITCH_BTN.w &&
      cy >= PITCH_BTN.y && cy <= PITCH_BTN.y + PITCH_BTN.h) { playSfx('button'); hintMove = null; if (canManualPitchShift()) fieldAdvance(true); return; }
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
    const cc = i => [MARGIN + (i % 8) * TILE + TILE / 2, BOARD_Y + MARGIN + Math.floor(i / 8) * TILE + TILE / 2];
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
  setTimeout(() => { _autoScheduled = false; _aiWhiteStep(); }, 450);
}

// Complete an already-active interactive UI mode using canvas coords
function _aiCompleteActiveMode() {
  const cc = (i) => [MARGIN + xy(i)[0] * TILE + TILE/2, BOARD_Y + MARGIN + xy(i)[1] * TILE + TILE/2];

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


