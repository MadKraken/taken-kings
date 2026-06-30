const VERSION = "269";
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

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

const NONE = 0, PAWN = 1, ROOK = 2, KNIGHT = 3, BISHOP = 4, QUEEN = 5, KING = 6, CHEST = 7, CHECKERS = 8;
const W = 1, B = 2, N = 3;
const GRAVE_TYPES = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, CHECKERS];

const PIECE_NAMES = { [PAWN]: "pawn", [ROOK]: "rook", [KNIGHT]: "knight", [BISHOP]: "bishop", [QUEEN]: "queen", [KING]: "king", [CHECKERS]: "checkers" };
const SIDE_PREFIX = { [W]: "w", [B]: "b", [N]: "n" };
const spriteImages = {};
let spritesLoaded = false;

function loadSprites() {
  let count = 0;
  const total = 30;
  const done = () => { count++; if (count >= total && !spritesLoaded) { spritesLoaded = true; draw(); } };
  const logoImg = new Image();
  logoImg.src = "sprites/logo_2.png?v=1";
  logoImg.onload = () => { spriteImages["logo"] = logoImg; done(); };
  logoImg.onerror = (e) => { console.log("logo FAILED", e); done(); };
  for (const s of [W, B, N]) {
    for (const p of [PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING, CHECKERS]) {
      const key = `${s}_${p}`;
      const img = new Image();
      img.src = (s === W && p === PAWN) ? "sprites/pawn.png" : (s === W && p === KING) ? "sprites/king.png" : (s === W && p === QUEEN) ? "sprites/Queen.png" : `sprites/${SIDE_PREFIX[s]}_${PIECE_NAMES[p]}.svg`;
      img.onload = done; img.onerror = done;
      spriteImages[key] = img;
    }
  }
  const chestImg = new Image();
  chestImg.src = "sprites/chest.svg";
  chestImg.onload = done; chestImg.onerror = done;
  spriteImages["chest"] = chestImg;
  const teleImg = new Image();
  teleImg.src = "sprites/item_teleporter.svg";
  teleImg.onload = done; teleImg.onerror = done;
  spriteImages["item_teleporter"] = teleImg;
  const clonerImg = new Image();
  clonerImg.src = "sprites/item_cloner.svg";
  clonerImg.onload = done; clonerImg.onerror = done;
  spriteImages["item_cloner"] = clonerImg;
  const upgraderImg = new Image();
  upgraderImg.src = "sprites/item_upgrader.svg?v=2";
  upgraderImg.onload = done; upgraderImg.onerror = done;
  spriteImages["item_upgrader"] = upgraderImg;
  const bombImg = new Image();
  bombImg.src = "sprites/item_bomb.svg";
  bombImg.onload = done; bombImg.onerror = done;
  spriteImages["item_bomb"] = bombImg;
  const explosionImg = new Image();
  explosionImg.src = "sprites/explosion.svg";
  explosionImg.onload = done; explosionImg.onerror = done;
  spriteImages["explosion"] = explosionImg;
  const groundImg = new Image();
  groundImg.src = "sprites/Ground.png";
  groundImg.onload = done; groundImg.onerror = done;
  spriteImages["ground"] = groundImg;
  const merchantImg = new Image();
  merchantImg.src = "sprites/merchant.svg";
  merchantImg.onload = done; merchantImg.onerror = done;
  spriteImages["merchant"] = merchantImg;
}

let board = new Array(64).fill(NONE);
let sides = new Array(64).fill(0);
let health = new Array(64).fill(1);
let selected = -1;
let validMoves = [];
let turn = W;
let gameOver = false;
let gameMsg = "";
let score = 0;
let gold = 0;
let spawnCount = 1;
let leapCount = 0;
let nextWave = []; // array of {x, piece} for preview
let nextBonuses = []; // [{type:'chest'|'item'|'obstacle', col, item?, dx?, dy?}]
let positionHistory = []; // track board states to detect repetition
let replaySnapshots = [];
let replayMode = false;
let replayIdx = 0;
let replayAutoPlay = false;
let replayAutoTimer = null;
let _replayAnimBuffer = [];
let _replayTransitions = [];
const ITEM_NONE = 0;
const ITEM_TELEPORTER = 4, ITEM_CLONER = 6, ITEM_UPGRADER = 7, ITEM_BOMB = 8;
const ITEM_PROMOTER_BASE = 100; // encoded: base + to (ROOK/KNIGHT/BISHOP/QUEEN/9=wild); always promotes a Pawn
const PROMOTER_WILD = 9;
function isPromoterItem(item) { return item >= ITEM_PROMOTER_BASE; }
function promoterTo(item) { return item - ITEM_PROMOTER_BASE; }
function makePromoterItem(to) { return ITEM_PROMOTER_BASE + to; }
const ITEM_PROMOTER_WILD = makePromoterItem(PROMOTER_WILD);
const ITEM_NAMES = {
  [ITEM_TELEPORTER]: "Teleporter", [ITEM_CLONER]: "Cloner", [ITEM_UPGRADER]: "Upgrader", [ITEM_BOMB]: "Bomb"
};
function itemName(item) {
  if (isPromoterItem(item)) return promoterTo(item) === PROMOTER_WILD ? "Mystery Promoter" : `Promoter to ${(PIECE_NAMES[promoterTo(item)] || "?")[0].toUpperCase() + (PIECE_NAMES[promoterTo(item)] || "?").slice(1)}`;
  return ITEM_NAMES[item] || "?";
}
let inventory = new Array(INV_COLS * INV_ROWS).fill(ITEM_NONE);
let dragSlot = -1, dragX = 0, dragY = 0, dragOverTrash = false, dragConsumed = false;
let _pendingDrag = null; // { slot, startX, startY, startMs } — promoted to dragSlot after threshold
let playerDead = {}, enemyDead = {}, flyAnims = [];
let shieldPops = [];
let warnFlashRunning = false;
let voidPulseRunning = false;
let chestBobRunning = false;
let voidDeathAnim = null; // {items:[{cx,cy,piece,side}], startMs, onDone}
let explosionAnim = null; // {cx, cy, startMs}
let pendingCaptures = {}; // boardIdx -> {piece, side} — removed from board but still rendered until hop arrives
let piecePromoterMode = false;
let piecePromoterTo = NONE;
let teleporterMode = false;
let teleporterSelected = -1;
let bombMode = false;
let bombHoverIdx = -1;
let clonerMode = false;
let clonerSelected = -1;
let upgraderMode = false;
let shiftCountdown = 10;
let itemSpaces = new Array(64).fill(ITEM_NONE);

let activeItemSpaceIdx = -1; // item space currently pending interactive resolution
let pendingItemQueue = []; // {item, i} pairs queued after a Team Advance
let specialSpaces = new Array(64).fill(null); // {type:'obstacle'|'void'|'block', ...}
let shopMode = false;
let shopOffers = []; // items shown in merchant shop dialog
let shopOnDone = null; // callback after shop closes (null for merchant — doesn't consume turn)
let merchantIdx = -1; // board position of Merchant NPC (-1 = not on board)
let merchantOffers = []; // 3 items generated at game start, persist for the whole game
let merchantQueued = false; // merchant is waiting in the fog preview row
let merchantQueuedCol = -1; // which column he'll enter from

const ITEM_SPRITE_KEYS = {
  [ITEM_TELEPORTER]: "item_teleporter",
  [ITEM_CLONER]: "item_cloner",
  [ITEM_UPGRADER]: "item_upgrader",
  [ITEM_BOMB]: "item_bomb"
};
const _PROMOTER_TO_PRICE = { [ROOK]: 20, [KNIGHT]: 20, [BISHOP]: 20, [QUEEN]: 30, [PROMOTER_WILD]: 15 };
function itemPrice(item) {
  if (isPromoterItem(item)) return _PROMOTER_TO_PRICE[promoterTo(item)] || 20;
  return ITEM_PRICES[item] || 0;
}
const ITEM_PRICES = {
  [ITEM_TELEPORTER]: 30,
  [ITEM_CLONER]: 45,
  [ITEM_UPGRADER]: 20,
  [ITEM_BOMB]: 35
};

let wkMoved = false;
let wraMoved = false, wrhMoved = false;
let epTarget = -1;
let aiThinking = false;

const AI_DEPTH = 3;
const HINT_DEPTH = 4;
const PIECE_VALUE = { [NONE]: 0, [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 20000, [CHEST]: 0, [CHECKERS]: 150 };
const GOLD_VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 15, [CHEST]: 0, [NONE]: 0, [CHECKERS]: 2 };
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
  if (itemSpaces.some(v => v !== ITEM_NONE) || nextBonuses.some(b => b.type === 'item')) {
    requestAnimationFrame(_chestBobTick);
  } else {
    chestBobRunning = false;
  }
}

const VOID_DEATH_MS = 600;
function startVoidDeath(cx, cy, piece, side, onDone) {
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
  for (let i = shieldPops.length - 1; i >= 0; i--) {
    if (now - shieldPops[i].startMs >= shieldPops[i].dur) shieldPops.splice(i, 1);
  }
  draw();
  if (flyAnims.length > 0 || shieldPops.length > 0) requestAnimationFrame(_flyTick);
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
      pieces: pieces.map(p => ({...p})),
      boardDy: boardDy || 0,
      exitRow: exitRow ? exitRow.map(r => ({...r})) : null,
    });
  }
  anim = { pieces, boardDy, startMs: performance.now(), onDone, exitRow: exitRow || null };
  requestAnimationFrame(_animTick);
}

function _animTick() {
  if (!anim) return;
  draw();
  if ((performance.now() - anim.startMs) < ANIM_MS) {
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
  const pool = [ROOK, ROOK, KNIGHT, KNIGHT, BISHOP, BISHOP, QUEEN];
  return makePromoterItem(pool[randInt(pool.length)]);
}

function _randomItem() {
  const r = randInt(4);
  if (r === 0) return ITEM_TELEPORTER;
  if (r === 1) return ITEM_CLONER;
  if (r === 2) return ITEM_UPGRADER;
  return ITEM_BOMB;
}

function _randomShopItem() {
  const r = randInt(7);
  if (r === 0) return ITEM_PROMOTER_WILD;
  if (r === 1) return _randomPromoterItem();
  if (r === 2) return ITEM_TELEPORTER;
  if (r === 3) return ITEM_CLONER;
  if (r === 4) return ITEM_UPGRADER;
  if (r === 5) return ITEM_BOMB;
  return _randomPromoterItem();
}

function addToInventory(item) {
  for (let i = 0; i < inventory.length; i++) {
    if (inventory[i] === ITEM_NONE) { inventory[i] = item; return true; }
  }
  return false; // full
}

function removeFromInventory(slot) {
  const item = inventory[slot];
  inventory[slot] = ITEM_NONE;
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
    itemSpaces: [...itemSpaces],
    inventory: [...inventory],
    score, gold, turn,
    playerDead: {...playerDead}, enemyDead: {...enemyDead},
    spawnCount, leapCount, shiftCountdown, merchantIdx
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

function _playReplayTransition(snapIdx, onDone) {
  const events = _replayTransitions[snapIdx] || [];
  let ei = 0;
  const playNext = () => {
    // Fire all consecutive fly events (fire-and-forget, no waiting)
    while (ei < events.length && events[ei].type === 'fly') {
      const ev = events[ei++];
      startFlyAnim(ev.piece, ev.side, ev.sx, ev.sy, ev.tx, ev.ty, null);
    }
    if (ei >= events.length) {
      applyReplaySnapshot(replaySnapshots[snapIdx]);
      onDone();
      return;
    }
    const ev = events[ei++];
    // ev.type === 'anim'
    board.splice(0, 64, ...ev.board);
    sides.splice(0, 64, ...ev.sides);
    health.splice(0, 64, ...ev.health);
    specialSpaces.splice(0, 64, ...ev.specialSpaces);
    itemSpaces.splice(0, 64, ...ev.itemSpaces);
    inventory.splice(0, inventory.length, ...ev.inventory);
    score = ev.score; gold = ev.gold; leapCount = ev.leapCount; shiftCountdown = ev.shiftCountdown;
    merchantIdx = ev.merchantIdx ?? -1;
    playerDead = {...ev.playerDead}; enemyDead = {...ev.enemyDead};
    startAnim(ev.pieces, ev.boardDy, playNext, ev.exitRow || undefined);
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
  const wave = [{x: cols[0], piece: KING}];
  for (let i = 1; i < cols.length; i++) {
    wave.push({x: cols[i], piece: _randomEnemyPiece()});
  }
  return wave;
}

// Each open column has a 1-in-8 chance of becoming a bonus (chest, item, or obstacle).
function generateRowBonuses(wave) {
  const waveCols = new Set(wave.map(w => w.x));
  const bonuses = [];
  for (let x = 0; x < 8; x++) {
    if (waveCols.has(x)) continue;
    if (randInt(5) !== 0) continue;
    const type = ['chest', 'item', 'obstacle', 'void', 'block', 'neutral', 'neutral'][randInt(7)];
    if (type === 'chest') {
      bonuses.push({ type: 'chest', col: x });
    } else if (type === 'item') {
      bonuses.push({ type: 'item', col: x, item: _randomItem() });
    } else if (type === 'void') {
      bonuses.push({ type: 'void', col: x });
    } else if (type === 'block') {
      bonuses.push({ type: 'block', col: x });
    } else if (type === 'neutral') {
      bonuses.push({ type: 'neutral', col: x, piece: _randomSetupPiece() });
    } else {
      const dirs = [];
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) {
        if (dx === 0 && dy === 0) continue;
        if (x + dx < 0 || x + dx > 7) continue;
        if (dy === -1) continue;
        dirs.push({ dx, dy });
      }
      if (dirs.length === 0) continue;
      const d = dirs[randInt(dirs.length)];
      bonuses.push({ type: 'obstacle', col: x, dx: d.dx, dy: d.dy });
    }
  }
  return bonuses;
}

function placeWave(row, wave) {
  for (const w of wave) {
    set(w.x, row, w.piece, B);
  }
}

let firstMoveMade = false;
let resignConfirm = false;
let testMode = false;
let gamePhase = 'setup'; // 'setup' | 'playing'

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
  selected = -1; validMoves = []; turn = W;
  gameOver = false; gameMsg = ""; score = 0; gold = 0;
  firstMoveMade = false; positionHistory = []; testMode = false;
  replaySnapshots = []; replayMode = false; replayIdx = 0; replayAutoPlay = false;
  if (replayAutoTimer) { clearTimeout(replayAutoTimer); replayAutoTimer = null; }
  _replayAnimBuffer = []; _replayTransitions = [];
  inventory.fill(ITEM_NONE); piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false; teleporterSelected = -1; clonerMode = false; clonerSelected = -1; upgraderMode = false; bombMode = false; bombHoverIdx = -1;
  playerDead = {}; enemyDead = {}; flyAnims = []; shieldPops = [];
  health.fill(1); shiftCountdown = 10;
  itemSpaces.fill(ITEM_NONE);
  pendingItemQueue = [];
  specialSpaces.fill(null);
  merchantIdx = -1; merchantOffers = [];
  merchantQueued = false; merchantQueuedCol = -1;
  wkMoved = false; wraMoved = false; wrhMoved = false;
  epTarget = -1;
  gamePhase = 'setup';
  rollSetup();
  _placeMerchant();
}

function _randomSetupPiece() {
  const r = randInt(65);
  if (r < 32) return PAWN;
  if (r < 40) return ROOK;
  if (r < 48) return BISHOP;
  if (r < 56) return KNIGHT;
  if (r < 60) return QUEEN;
  if (r < 64) return KING;
  return CHECKERS;             // 1/65 ≈ 1/64
}

function _randomEnemyPiece() {
  const r = randInt(65);
  if (r < 32) return PAWN;
  if (r < 40) return ROOK;
  if (r < 48) return BISHOP;
  if (r < 56) return KNIGHT;
  if (r < 64) return QUEEN;
  return CHECKERS;             // 1/65 ≈ 1/64
}

function rollSetup() {
  // Clear all pieces and regenerate enemy wave
  board.fill(NONE); sides.fill(0); health.fill(1);
  spawnCount = 1;
  const firstWave = generateWave(spawnCount);
  placeWave(0, firstWave);
  nextWave = generateWave(spawnCount + 1);
  nextBonuses = generateRowBonuses(nextWave);

  // Place guaranteed King at a random position in rows 6–7
  const positions = [];
  for (let y = 6; y <= 7; y++) for (let x = 0; x < 8; x++) positions.push({ x, y });
  shuffle(positions);
  set(positions[0].x, positions[0].y, KING, W);

  // Queen is guaranteed; remaining 14 slots are random (Pawn/Rook/Knight/Bishop only)
  set(positions[1].x, positions[1].y, QUEEN, W);
  for (let i = 2; i < 16; i++) {
    const r = randInt(14);
    const p = r < 8 ? PAWN : r < 10 ? ROOK : r < 12 ? KNIGHT : BISHOP;
    set(positions[i].x, positions[i].y, p, W);
  }

  // One random item in inventory
  inventory.fill(ITEM_NONE);
  inventory[0] = _randomItem();
}

function startGame() {
  gamePhase = 'playing';
  takeReplaySnapshot();
  draw();
}

const CONQUEST_FPS = 30;
const CONQUEST_FRAME_COUNT = 94;
const _conquestFrames = new Array(CONQUEST_FRAME_COUNT).fill(null).map(() => new Image());

// Preload all frames sequentially at startup so they're ready before the player hits Go
(function _preloadConquest(i) {
  if (i >= CONQUEST_FRAME_COUNT) return;
  _conquestFrames[i].onload = () => _preloadConquest(i + 1);
  _conquestFrames[i].onerror = () => _preloadConquest(i + 1);
  _conquestFrames[i].src = `animations/begin conquest frames/Begin Conquest -${i}.png`;
})(0);

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
  const canLand = (nx, ny) => inB(nx, ny) && board[idx(nx, ny)] === NONE && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny));
  if (p === PAWN) {
    if (canLand(x, y - 1)) moves.push(idx(x, y - 1));
    if (canLand(x, y + 1)) moves.push(idx(x, y + 1));
  } else if (p === CHECKERS) {
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
    board[dest] = p; sides[dest] = N; health[dest] = h;
    board[i] = NONE; sides[i] = 0; health[i] = 1;
    applySpecialSpace(dest);
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
      if (s === B && piece(nx, ny) === CHEST) break;
      if (sides[idx(nx, ny)] === N) break; // only W King can recruit neutrals; all others treat them as impassable
      const ni = idx(nx, ny);
      if (isBlockSpace(ni)) break;
      const isVoid = specialSpaces[ni]?.type === 'void';
      if (!isVoid) moves.push(ni);
      if (piece(nx, ny) !== NONE && piece(nx, ny) !== CHEST) break;
      nx += dx; ny += dy;
    }
  }
}

function isVoidSpace(i) { return specialSpaces[i]?.type === 'void'; }
function isBlockSpace(i) { return specialSpaces[i]?.type === 'block'; }

function pseudoMoves(x, y) {
  const moves = [];
  const p = piece(x, y), s = side(x, y), e = enemy(s);
  if (p === PAWN) {
    if (s === W) {
      // White pawns move and capture upward only (toward row 0)
      const dir = -1;
      const fwd = piece(x, y + dir);
      if (inB(x, y + dir) && (fwd === NONE || fwd === CHEST) && !isVoidSpace(idx(x, y + dir)) && !isBlockSpace(idx(x, y + dir))) {
        moves.push(idx(x, y + dir));
        if (y === 6 && fwd === NONE && piece(x, y - 2) === NONE && !isVoidSpace(idx(x, y - 2)) && !isBlockSpace(idx(x, y - 2))) moves.push(idx(x, y - 2));
      }
      for (const dx of [-1, 1]) {
        const nx = x + dx, ny = y + dir;
        if (inB(nx, ny) && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) {
          if (side(nx, ny) === e) moves.push(idx(nx, ny));
          else if (idx(nx, ny) === epTarget) moves.push(idx(nx, ny));
        }
      }
    } else {
      // Black pawns move down; can move two squares from row 0 (first turn after entering)
      const dir = 1;
      if (inB(x, y + dir) && piece(x, y + dir) === NONE && !isVoidSpace(idx(x, y + dir)) && !isBlockSpace(idx(x, y + dir))) {
        moves.push(idx(x, y + dir));
        if (y === 0 && piece(x, y + 2) === NONE && !isVoidSpace(idx(x, y + 2)) && !isBlockSpace(idx(x, y + 2))) moves.push(idx(x, y + 2));
      }
      for (const dx of [-1, 1]) {
        const nx = x + dx, ny = y + dir;
        if (inB(nx, ny) && side(nx, ny) === e && piece(nx, ny) !== CHEST && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) moves.push(idx(nx, ny));
      }
    }
  } else if (p === CHECKERS) {
    const dir = s === W ? -1 : 1;
    const e = enemy(s);
    for (const dx of [-1, 1]) {
      const nx = x + dx, ny = y + dir;
      // Step move: forward diagonal to empty square
      if (inB(nx, ny) && board[idx(nx, ny)] === NONE && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny)))
        moves.push(idx(nx, ny));
      // Jump capture: leap over an enemy to the empty square beyond
      const jx = x + 2*dx, jy = y + 2*dir;
      if (inB(nx, ny) && inB(jx, jy)) {
        const midI = idx(nx, ny), landI = idx(jx, jy);
        const midSide = sides[midI];
        if (midSide !== 0 && midSide !== s && midSide !== N && board[midI] !== NONE && board[midI] !== CHEST
            && board[landI] === NONE && !isVoidSpace(landI) && !isBlockSpace(landI))
          moves.push(landI);
      }
    }
  } else if (p === KNIGHT) {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && sides[idx(nx, ny)] !== N && !(s === B && piece(nx, ny) === CHEST) && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) moves.push(idx(nx, ny));
    }
  } else if (p === BISHOP) {
    slidingMoves(moves, x, y, [[1,1],[1,-1],[-1,1],[-1,-1]], s);
  } else if (p === ROOK) {
    slidingMoves(moves, x, y, [[1,0],[-1,0],[0,1],[0,-1]], s);
  } else if (p === QUEEN) {
    slidingMoves(moves, x, y, [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]], s);
  } else if (p === KING) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && sides[idx(nx, ny)] === N) && !(s === B && piece(nx, ny) === CHEST) && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) moves.push(idx(nx, ny));
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
  // White has no check restriction â€" all pseudo-legal moves are legal.
  // Black still can't move into check (keeps AI from hanging its own king).
  const s = side(x, y);
  if (s === W) return pseudoMoves(x, y);
  return pseudoMoves(x, y).filter(m => {
    const savBoard = [...board], savSides = [...sides];
    board[m] = board[idx(x,y)]; sides[m] = sides[idx(x,y)];
    board[idx(x,y)] = NONE; sides[idx(x,y)] = 0;
    const [kx, ky] = findKing(B);
    const inCheck = kx >= 0 && isAttacked(kx, ky, B);
    board.splice(0,64,...savBoard); sides.splice(0,64,...savSides);
    return !inCheck;
  });
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
  const captured = board[toI];
  const capSide = sides[toI];

  // Checkers jump: leaps 2 diagonally — remove the piece in the middle square
  if (p === CHECKERS && Math.abs(tx - fx) === 2) {
    const midI = idx((fx + tx) / 2, (fy + ty) / 2);
    const capPiece = board[midI], capSide = sides[midI];
    if (visual && capPiece !== NONE) {
      const isPlayerPiece = capSide === W;
      const pool = isPlayerPiece ? playerDead : enemyDead;
      const [tgx, tgy] = graveSlotPos(isPlayerPiece, capPiece);
      startFlyAnim(capPiece, capSide, MARGIN + ((fx+tx)/2)*TILE + TILE/2, BOARD_Y + MARGIN + ((fy+ty)/2)*TILE + TILE/2, tgx, tgy, () => { pool[capPiece] = (pool[capPiece] || 0) + 1; });
    }
    if (capSide !== s && s === W) gold += GOLD_VALUE[capPiece] ?? 0;
    if (capPiece === KING && capSide !== s && s === W) score += 1;
    board[midI] = NONE; sides[midI] = 0; health[midI] = 1;
  }

  // Bounce: white piece attacks neutral â€" attacker bounces back, neutral is hired
  if (s === W && sides[toI] === N) {
    sides[toI] = W;
    const bounceI = calcBouncePos(fromI, toI, p);
    if (bounceI !== fromI) {
      board[bounceI] = p; sides[bounceI] = W; health[bounceI] = health[fromI];
      board[fromI] = NONE; sides[fromI] = 0; health[fromI] = 1;
    }
    return;
  }

  // Bounce: black piece attacks white piece with health > 1 â€" damage but no capture
  if (s === B && sides[toI] === W && health[toI] > 1) {
    health[toI]--;
    const bounceI = calcBouncePos(fromI, toI, p);
    if (bounceI !== fromI) {
      board[bounceI] = p; sides[bounceI] = B;
      board[fromI] = NONE; sides[fromI] = 0;
    }
    return;
  }

  if (visual && captured !== NONE && captured !== CHEST && capSide !== s) {
    const capSX = MARGIN + tx * TILE + TILE / 2;
    const capSY = BOARD_Y + MARGIN + ty * TILE + TILE / 2;
    const isPlayerPiece = capSide === W;
    const pool = isPlayerPiece ? playerDead : enemyDead;
    const [tgx, tgy] = graveSlotPos(isPlayerPiece, captured);
    startFlyAnim(captured, capSide, capSX, capSY, tgx, tgy, () => { pool[captured] = (pool[captured] || 0) + 1; });
  }

  if (captured !== NONE && captured !== CHEST && sides[toI] !== s && s === W) {
    gold += GOLD_VALUE[captured] ?? 0;
  }
  if (captured === KING && sides[toI] !== s && s === W) {
    score += 1;
  }
  if (captured === CHEST && s === W) {
    addToInventory(_randomItem());
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
    const epPiece = piece(tx, capY);
    const epSide = side(tx, capY);
    if (visual && epPiece !== NONE) {
      const isEPPlayer = epSide === W;
      const epPool = isEPPlayer ? playerDead : enemyDead;
      const [etgx, etgy] = graveSlotPos(isEPPlayer, epPiece);
      startFlyAnim(epPiece, epSide, MARGIN + tx * TILE + TILE / 2, BOARD_Y + MARGIN + capY * TILE + TILE / 2, etgx, etgy, () => { epPool[epPiece] = (epPool[epPiece] || 0) + 1; });
    }
    if (epPiece === KING && s === W) score += 1;
    if (s === W) gold += GOLD_VALUE[epPiece] ?? 0;
    set(tx, capY, NONE, 0);
  }

  epTarget = -1;
  if (p === PAWN && Math.abs(ty - fy) === 2) {
    epTarget = idx(fx, (fy + ty) / 2);
  }

  const movedHealth = health[fromI];
  board[toI] = p; sides[toI] = s; health[toI] = movedHealth;
  board[fromI] = NONE; sides[fromI] = 0; health[fromI] = 1;

}

function endWhiteTurn() {
  shiftCountdown--;
  if (shiftCountdown <= 0) {
    fieldAdvance();
  } else {
    checkArrowSpaces(() => {
      turn = B;
      draw();
      if (!gameOver) aiPlay();
    });
  }
}

// --- Team Leap & Pitch Shift ---

function isItemActive() {
  return piecePromoterMode || teleporterMode || clonerMode || upgraderMode || bombMode;
}

function cancelItemMode() {
  piecePromoterMode = false; piecePromoterTo = NONE; teleporterMode = false;
  clonerMode = false; upgraderMode = false; bombMode = false; bombHoverIdx = -1;
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
  clonerMode = false; upgraderMode = false; bombMode = false; bombHoverIdx = -1;
  teleporterSelected = -1; clonerSelected = -1;
  draw();
}

function canTeamLeap() {
  return !(gameOver || turn !== W || aiThinking);
}

function teamLeap() {
  if (gameOver || turn !== W || aiThinking || anim) return;

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
      piece: board[i], side: sides[i], hlth: health[i]
    });
  }

  // Track enemy captures from team advance
  for (let i = 0; i < 64; i++) {
    if (!canMoveUp[i]) continue;
    const [ax2, ay2] = xy(i);
    const ni2 = idx(ax2, ay2 - 1);
    if (sides[ni2] === B && board[ni2] !== NONE && board[ni2] !== CHEST) {
      const capPiece = board[ni2];
      const [tgx, tgy] = graveSlotPos(false, capPiece);
      startFlyAnim(capPiece, B, MARGIN + ax2 * TILE + TILE / 2, BOARD_Y + MARGIN + (ay2 - 1) * TILE + TILE / 2, tgx, tgy, () => { enemyDead[capPiece] = (enemyDead[capPiece] || 0) + 1; });
    }
  }

  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);
  const newHealth = new Array(64).fill(1);

  // Enemies stay
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) {
      newBoard[i] = board[i];
      newSides[i] = sides[i];
      newHealth[i] = health[i];
    }
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
        if (board[i] === KING) { gameOver = true; gameMsg = `Game Over! Score: ${score}`; }
        _leapVoidDeath = { cx: MARGIN + x * TILE + TILE / 2, cy: BOARD_Y + MARGIN + (y - 1) * TILE + TILE / 2, piece: board[i], side: W };
      } else {
        if (newBoard[ni] === CHEST) addToInventory(_randomItem());
        newBoard[ni] = board[i]; newSides[ni] = W; newHealth[ni] = health[i];
      }
    } else {
      newBoard[i] = board[i]; newSides[i] = W; newHealth[i] = health[i];
    }
  }

  board.splice(0, 64, ...newBoard);
  sides.splice(0, 64, ...newSides);
  health.splice(0, 64, ...newHealth);

  epTarget = -1;
  selected = -1;
  validMoves = [];
  wkMoved = true; wraMoved = true; wrhMoved = true;
  firstMoveMade = true;
  recordPosition();
  startAnim(leapAnimPieces, 0, () => {
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

function fieldAdvance(playerTriggered = false) {
  if (!canPitchShift() || anim) return;

  // Capture the bottom row before it's destroyed so animation can slide it out.
  const exitRow = [];
  for (let x = 0; x < 8; x++) {
    const i = idx(x, 7);
    exitRow.push({ x, piece: board[i], side: sides[i], hlth: health[i] });
  }
  // If merchant is on row 7 he slides off with the exit row
  const merchantAtRow7 = merchantIdx >= 0 && xy(merchantIdx)[1] === 7;
  if (merchantAtRow7) exitRow[xy(merchantIdx)[0]].merchant = true;

  // If merchant was queued in the fog preview, he enters the board this advance
  const merchantEntersThisWave = merchantQueued;
  const merchantEnterCol = merchantQueuedCol;
  if (merchantQueued) { merchantQueued = false; merchantQueuedCol = -1; }

  // Everything shifts down one row; row 7 is destroyed (including white pieces).
  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);
  const newHealth = new Array(64).fill(1);

  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) { // destroyed
      if (playerTriggered && sides[i] === B && board[i] === KING) score++;
      const isPlayer = sides[i] === W;
      const pool = isPlayer ? playerDead : enemyDead;
      const [tgx, tgy] = graveSlotPos(isPlayer, board[i]);
      const sx = MARGIN + x * TILE + TILE / 2, sy = BOARD_Y + MARGIN + y * TILE + TILE / 2;
      const p = board[i], s = sides[i];
      startFlyAnim(p, s, sx, sy, tgx, tgy, () => { pool[p] = (pool[p] || 0) + 1; });
      continue;
    }
    const ni = idx(x, y + 1);
    newBoard[ni] = board[i];
    newSides[ni] = sides[i];
    newHealth[ni] = health[i];
  }

  board.splice(0, 64, ...newBoard);
  sides.splice(0, 64, ...newSides);
  health.splice(0, 64, ...newHealth);

  // Scroll special spaces down
  const newSpecialSpaces = new Array(64).fill(null);
  for (let i = 0; i < 64; i++) {
    if (!specialSpaces[i]) continue;
    const [x, y] = xy(i);
    if (y === 7) continue;
    newSpecialSpaces[idx(x, y + 1)] = specialSpaces[i];
  }
  for (const b of nextBonuses) {
    if (b.type === 'obstacle') newSpecialSpaces[idx(b.col, 0)] = { type: 'obstacle', dx: b.dx, dy: b.dy };
    if (b.type === 'void') newSpecialSpaces[idx(b.col, 0)] = { type: 'void' };
    if (b.type === 'block') newSpecialSpaces[idx(b.col, 0)] = { type: 'block' };
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

  spawnCount++;
  leapCount++;

  if (merchantAtRow7) {
    // Merchant slides off bottom; queue him in the fog preview row for the NEXT advance
    merchantIdx = -1;
    merchantQueued = true;
    merchantQueuedCol = randInt(8);
    // Normal wave placement this advance
    for (const w of nextWave) {
      if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue;
      set(w.x, 0, w.piece, B);
    }
    for (const b of nextBonuses) {
      if (b.type === 'chest') set(b.col, 0, CHEST, 0);
      if (b.type === 'neutral') set(b.col, 0, b.piece, N);
    }
  } else if (merchantEntersThisWave) {
    // Merchant slides in from fog preview: he takes his column first, King next, rest after
    merchantIdx = idx(merchantEnterCol, 0);
    const avail = [];
    for (let x = 0; x < 8; x++) {
      if (x !== merchantEnterCol && specialSpaces[idx(x, 0)]?.type !== 'block') avail.push(x);
    }
    shuffle(avail);
    let ci = 0;
    const waveKing = nextWave.find(w => w.piece === KING);
    const waveOthers = nextWave.filter(w => w.piece !== KING);
    if (waveKing && ci < avail.length) set(avail[ci++], 0, KING, B);
    for (const w of waveOthers) { if (ci < avail.length) set(avail[ci++], 0, w.piece, B); }
    for (const b of nextBonuses) {
      if (b.col === merchantEnterCol) continue;
      if (b.type === 'chest') set(b.col, 0, CHEST, 0);
      if (b.type === 'neutral') set(b.col, 0, b.piece, N);
    }
  } else {
    // Normal advance: wave works around merchant's current position
    for (const w of nextWave) {
      if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue;
      if (idx(w.x, 0) === merchantIdx) continue;
      set(w.x, 0, w.piece, B);
    }
    for (const b of nextBonuses) {
      if (idx(b.col, 0) === merchantIdx) continue;
      if (b.type === 'chest') set(b.col, 0, CHEST, 0);
      if (b.type === 'neutral') set(b.col, 0, b.piece, N);
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
  // Rotate merchant wares: oldest item leaves, new random one arrives
  merchantOffers.shift();
  merchantOffers.push(_randomShopItem());
  startAnim([], -TILE, () => {
    turn = B;
    draw();
    if (!gameOver) aiPlay();
  }, exitRow);
}

// --- AI ---

function saveState() {
  return {
    board: [...board], sides: [...sides], epTarget,
    wkMoved, wraMoved, wrhMoved, score, gold, inventory: [...inventory],
    spawnCount, nextBonuses: nextBonuses.map(b => ({...b})), nextWave: nextWave.map(w => ({...w})),
    histLen: positionHistory.length,
    health: [...health], shiftCountdown
  };
}

function restoreState(st) {
  board.splice(0, 64, ...st.board);
  sides.splice(0, 64, ...st.sides);
  epTarget = st.epTarget;
  wkMoved = st.wkMoved;
  wraMoved = st.wraMoved; wrhMoved = st.wrhMoved;
  score = st.score; gold = st.gold; inventory.splice(0, inventory.length, ...st.inventory);
  spawnCount = st.spawnCount; nextBonuses = st.nextBonuses.map(b => ({...b}));
  nextWave = st.nextWave;
  positionHistory.length = st.histLen;
  health.splice(0, 64, ...st.health);
  shiftCountdown = st.shiftCountdown;
}

function canSimulateLeap() {
  return true;
}

function simulateLeap() {
  // Simulates fieldAdvance for AI lookahead: everything shifts down, row 7 destroyed
  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) continue;
    const ni = idx(x, y + 1);
    newBoard[ni] = board[i];
    newSides[ni] = sides[i];
  }
  board.splice(0, 64, ...newBoard);
  sides.splice(0, 64, ...newSides);
  spawnCount++;
  placeWave(0, nextWave);
  for (const b of nextBonuses) {
    if (b.type === 'chest') set(b.col, 0, CHEST, 0);
    if (b.type === 'neutral') set(b.col, 0, b.piece, N);
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

function evaluate() {
  let val = 0;
  let whiteKing = false;
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const v = PIECE_VALUE[board[i]];
    const shields = health[i] - 1;
    const effectiveV = shields > 0 ? v * (1 + 0.5 * shields) : v;
    if (sides[i] === W) {
      val += effectiveV;
      if (board[i] === KING) whiteKing = true;
    } else {
      val -= effectiveV;
    }
  }
  if (!whiteKing) return -99999;
  // Penalize repeated positions â€" both sides should avoid loops
  const reps = countPosition(boardHash());
  if (reps >= 2) val -= 5000;
  else if (reps >= 1) val -= 1000;
  return val;
}

function minimax(depth, alpha, beta, maximizing) {
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
      const st = saveState();
      makeMove(from, to);
      recordPosition();
      const val = minimax(depth - 1, alpha, beta, false);
      restoreState(st);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    // Also consider team leap as a white move
    if (canSimulateLeap()) {
      const st = saveState();
      simulateLeap();
      recordPosition();
      const val = minimax(depth - 1, alpha, beta, false);
      restoreState(st);
      best = Math.max(best, val);
    }
    return best;
  } else {
    let best = Infinity;
    for (const [from, to] of moves) {
      const st = saveState();
      makeMove(from, to);
      recordPosition();
      const val = minimax(depth - 1, alpha, beta, true);
      restoreState(st);
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

function aiBestMove() {
  // If checkmated (no legal moves), fall back to pseudo-legal so the enemy is never paralyzed
  let moves = allLegalMovesForSide(B);
  if (moves.length === 0) moves = allPseudoMovesForSide(B);
  if (moves.length === 0) return null;
  // Compelled: any move that directly attacks a white King (kill or damage) must be taken
  const kingAttacks = moves.filter(([, to]) => board[to] === KING && sides[to] === W);
  if (kingAttacks.length > 0) return kingAttacks[randInt(kingAttacks.length)];
  if (moves.length === 0) return null;
  let bestScore = Infinity;
  let bestMoves = [];
  for (const [from, to] of moves) {
    const st = saveState();
    makeMove(from, to);
    recordPosition();
    const val = minimax(AI_DEPTH - 1, -Infinity, Infinity, true);
    restoreState(st);
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

function playerBestMove() {
  const moves = allLegalMovesForSide(W);
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const [from, to] of moves) {
    const st = saveState();
    makeMove(from, to);
    recordPosition();
    const val = minimax(HINT_DEPTH - 1, -Infinity, Infinity, false);
    restoreState(st);
    if (val > bestScore) {
      bestScore = val;
      bestMoves = [[from, to]];
    } else if (val === bestScore) {
      bestMoves.push([from, to]);
    }
  }
  return bestMoves.length > 0 ? bestMoves[randInt(bestMoves.length)] : null;
}

function showHint() {
  if (gameOver || turn !== W || aiThinking) return;
  aiThinking = true;
  draw();
  setTimeout(() => {
    hintMove = playerBestMove();
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
  aiThinking = true;
  draw();
  setTimeout(() => {
    const move = aiBestMove();
    if (move) {
      const [mfx, mfy] = xy(move[0]), [mtx, mty] = xy(move[1]);
      const mFromCX = MARGIN + mfx * TILE, mFromCY = BOARD_Y + MARGIN + mfy * TILE;
      const mToCX = MARGIN + mtx * TILE, mToCY = BOARD_Y + MARGIN + mty * TILE;
      const _aiFinish = () => {
        checkArrowSpaces(() => {
          if (countKings(W) === 0) { gameOver = true; gameMsg = `Game Over! Score: ${score}`; }
          else if (isCheckmated(W)) { gameOver = true; gameMsg = `Checkmate! Score: ${score}`; }
          if (gameOver) { aiThinking = false; takeReplaySnapshot(); draw(); return; }
          neutralPlay(() => {
            merchantPlay(() => {
              turn = W;
              aiThinking = false;
              takeReplaySnapshot();
              draw();
            });
          });
        });
      };

      // Shield bounce: attacker slides in, bounces back
      if (sides[move[0]] === B && sides[move[1]] === W && health[move[1]] > 1) {
        const attackPiece = board[move[0]], attackHlth = health[move[0]];
        const wasLastShield = health[move[1]] === 2;
        const bounceI = calcBouncePos(move[0], move[1], attackPiece);
        const [bx, by] = xy(bounceI);
        const bounceCX = MARGIN + bx * TILE, bounceCY = BOARD_Y + MARGIN + by * TILE;
        const hitCX = mToCX + TILE / 2, hitCY = mToCY + TILE / 2;
        // Phase 1: slide attacker onto target square (suppress at fromI)
        startAnim([{ toIdx: move[0], fromCX: mFromCX, fromCY: mFromCY, toCX: mToCX, toCY: mToCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
          // Apply board state now
          makeMove(move[0], move[1], true);
          if (move[1] === merchantIdx) respawnMerchant();
          recordPosition();
          // Phase 2: bounce back to bounceI (suppress at bounceI)
          startAnim([{ toIdx: bounceI, fromCX: mToCX, fromCY: mToCY, toCX: bounceCX, toCY: bounceCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
            if (wasLastShield) startShieldPop(hitCX, hitCY);
            _aiFinish();
          });
        });
      } else {
        makeMove(move[0], move[1], true);
        if (move[1] === merchantIdx) respawnMerchant();
        const _aiHops = computeObstacleHops(move[1]);
        const _aiPiece0 = board[move[1]], _aiSide0 = sides[move[1]], _aiHlth0 = health[move[1]];
        const _aiFinalI = applySpecialSpace(move[1]);
        recordPosition();
        const _aiPiece = board[_aiFinalI] || _aiPiece0, _aiSide = sides[_aiFinalI] || _aiSide0, _aiHlth = health[_aiFinalI] || _aiHlth0;
        const _aiIsCheckersJump = _aiPiece0 === CHECKERS && Math.abs(mtx - mfx) === 2;
        const aiAnimPieces = [{
          toIdx: _aiFinalI,
          fromCX: mFromCX, fromCY: mFromCY, toCX: mToCX, toCY: mToCY,
          piece: _aiPiece, side: _aiSide, hlth: _aiHlth,
          arc: _aiIsCheckersJump ? TILE * 1.5 : 0
        }];
        const _aiDoHop = (hi) => {
          if (hi >= _aiHops.length) {
            if (isVoidSpace(_aiFinalI) && _aiPiece !== NONE) {
              const [vx, vy] = xy(_aiFinalI);
              startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _aiPiece, _aiSide, _aiFinish);
            } else { _aiFinish(); }
            return;
          }
          const [fI, tI] = _aiHops[hi];
          const [fx, fy] = xy(fI), [tx, ty] = xy(tI);
          startAnim([{ toIdx: _aiFinalI, fromCX: MARGIN+fx*TILE, fromCY: BOARD_Y+MARGIN+fy*TILE, toCX: MARGIN+tx*TILE, toCY: BOARD_Y+MARGIN+ty*TILE, piece: _aiPiece, side: _aiSide, hlth: _aiHlth }], 0, () => _aiDoHop(hi+1));
        };
        startAnim(aiAnimPieces, 0, () => _aiDoHop(0));
      }
    } else {
      if (countKings(W) === 0) {
        gameOver = true;
        gameMsg = `Game Over! Score: ${score}`;
      } else if (isCheckmated(W)) {
        gameOver = true;
        gameMsg = `Checkmate! Score: ${score}`;
      }
      if (gameOver) { aiThinking = false; takeReplaySnapshot(); draw(); return; }
      neutralPlay(() => {
        merchantPlay(() => {
          turn = W;
          aiThinking = false;
          takeReplaySnapshot();
          draw();
        });
      });
    }
  }, 50);
}

function findKing(s) {
  for (let i = 0; i < 64; i++) if (board[i] === KING && sides[i] === s) return xy(i);
  return [-1, -1];
}

function adjacentClonerDests(i) {
  const [x, y] = xy(i);
  const dests = [];
  for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
    const nx = x + dx, ny = y + dy;
    if (inB(nx, ny) && (board[idx(nx, ny)] === NONE || board[idx(nx, ny)] === CHEST)) dests.push(idx(nx, ny));
  }
  return dests;
}

function countKings(s) {
  let n = 0;
  for (let i = 0; i < 64; i++) if (board[i] === KING && sides[i] === s) n++;
  return n;
}

function checkWhiteKingAlive() {
  const [kx, ky] = findKing(W);
  if (kx < 0) {
    gameOver = true;
    gameMsg = `Game Over! Score: ${score}`;
  }
}

function canItemAffectPiece(item, i) {
  const p = board[i];
  if (isPromoterItem(item)) { return p === PAWN && sides[i] === W; }
  switch (item) {
    case ITEM_UPGRADER: return true;
    case ITEM_TELEPORTER: return true;
    case ITEM_CLONER: return adjacentClonerDests(i).length > 0;
    case ITEM_BOMB: return true;
    default: return false;
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
      if (sides[i] === W && board[i] === KING) { gameOver = true; gameMsg = `Game Over! Score: ${score}`; }
      if (sides[i] === B && board[i] === KING) score++;
      if (sides[i] === B) gold += GOLD_VALUE[board[i]] ?? 0;
      const bp = board[i], bs = sides[i];
      const isPlayerPiece = bs === W;
      const pool = isPlayerPiece ? playerDead : enemyDead;
      const [tgx, tgy] = graveSlotPos(isPlayerPiece, bp);
      startFlyAnim(bp, bs, MARGIN + nx * TILE + TILE / 2, BOARD_Y + MARGIN + ny * TILE + TILE / 2, tgx, tgy, () => { pool[bp] = (pool[bp] || 0) + 1; });
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
    case ITEM_UPGRADER:
      health[i]++;
      activeItemSpaceIdx = -1;
      return true;
    default:
      if (isPromoterItem(item)) {
        piecePromoterMode = true; piecePromoterTo = promoterTo(item);
        draw(); return false;
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
      detonateBomb(i);
      activeItemSpaceIdx = -1;
      return true;
  }
  activeItemSpaceIdx = -1;
  return true;
}

// Only auto-applies instant items (Upgrader/KingPromoter) during Team Leap.
// Interactive items are left on the board until a regular move triggers them.
// Called after item/obstacle interaction completes; drains queue or ends turn.
function processNextQueuedItem() {
  activeItemSpaceIdx = -1;
  if (pendingItemQueue.length === 0) { endWhiteTurn(); return; }
  const { item, i } = pendingItemQueue.shift();
  const done = activateItemSpace(item, i);
  if (done) processNextQueuedItem();
}

function closeShop() {
  shopMode = false;
  const done = shopOnDone;
  shopOnDone = null;
  if (done) done();
}

function openMerchantShop(onDone) {
  shopOffers = merchantOffers;
  shopMode = true;
  shopOnDone = onDone || null;
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
  for (let i = 0; i < 64; i++) if (board[i] === NONE) empty.push(i);
  merchantIdx = empty.length > 0 ? empty[randInt(empty.length)] : -1;
  merchantOffers = [_randomShopItem(), _randomShopItem(), _randomShopItem()];
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

// After a Team Advance, apply obstacle spaces then item spaces leftâ†’right, frontâ†’back.
function applySpacesAfterAdvance() {
  // Pass 1: obstacles â€" use checkArrowSpaces so hop animations play correctly.
  checkArrowSpaces(() => {
    checkWhiteKingAlive();
    if (gameOver) { takeReplaySnapshot(); draw(); return; }
    _applySpacesAfterAdvancePass2();
  });
}

function _applySpacesAfterAdvancePass2() {
  // Pass 2: item spaces â€" instant items applied now, interactive items queued.
  pendingItemQueue = [];
  for (let i = 0; i < 64; i++) {
    const item = itemSpaces[i];
    if (item === ITEM_NONE || sides[i] !== W || !canItemAffectPiece(item, i)) continue;
    if (item === ITEM_UPGRADER) { health[i]++; itemSpaces[i] = ITEM_NONE; }
    else if (isPromoterItem(item)) { board[i] = promoterTo(item) === PROMOTER_WILD ? _rollWildTo() : promoterTo(item); itemSpaces[i] = ITEM_NONE; }
    else { pendingItemQueue.push({ item, i }); itemSpaces[i] = ITEM_NONE; }
  }

  processNextQueuedItem();
}

// After any move, check if a piece that was stuck on an arrow space can now redirect.
function checkArrowSpaces(onDone) {
  const toProcess = [];
  for (let i = 0; i < 64; i++) {
    const sp = specialSpaces[i];
    if (!sp || sp.type !== 'obstacle') continue;
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    const nx = x + sp.dx, ny = y + sp.dy;
    if (!inB(nx, ny)) continue;
    const destI = idx(nx, ny);
    if (isBlockSpace(destI)) continue;
    const moverSide = sides[i];
    const destSide = sides[destI];
    if (destSide !== 0 && destSide === moverSide) continue; // still blocked by friendly
    if (moverSide === B && destSide === W && health[destI] > 1) continue; // shielded
    toProcess.push(i);
  }
  if (toProcess.length === 0) { onDone(); return; }
  let qi = 0;
  const processNext = () => {
    if (qi >= toProcess.length) { onDone(); return; }
    const startI = toProcess[qi++];
    if (board[startI] === NONE) { processNext(); return; } // already moved by prior chain
    const piece0 = board[startI], side0 = sides[startI], hlth0 = health[startI];
    const hops = computeObstacleHops(startI);
    const finalI = applySpecialSpace(startI);
    const piece = board[finalI] || piece0, side = sides[finalI] || side0, hlth = health[finalI] || hlth0;
    const doHop = (hi) => {
      if (hi >= hops.length) {
        if (isVoidSpace(finalI) && piece !== NONE) {
          if (board[finalI] !== NONE) {
            if (board[finalI] === KING && side === W) { gameOver = true; gameMsg = `Game Over! Score: ${score}`; }
            else if (board[finalI] === KING && side === B) score++;
            board[finalI] = NONE; sides[finalI] = 0; health[finalI] = 1;
          }
          const [vx, vy] = xy(finalI);
          startVoidDeath(MARGIN + vx*TILE + TILE/2, BOARD_Y + MARGIN + vy*TILE + TILE/2, piece, side, processNext);
        } else { processNext(); }
        return;
      }
      const [fI, tI] = hops[hi];
      const [fx, fy] = xy(fI), [tx, ty] = xy(tI);
      startAnim([{ toIdx: finalI, fromCX: MARGIN+fx*TILE, fromCY: BOARD_Y+MARGIN+fy*TILE, toCX: MARGIN+tx*TILE, toCY: BOARD_Y+MARGIN+ty*TILE, piece, side, hlth }], 0, () => doHop(hi+1));
    };
    doHop(0);
  };
  processNext();
}

// Dry-run: returns the list of [fromI, toI] hops an obstacle chain would produce,
// without modifying board state. Used to drive redirect animations.
function computeObstacleHops(startI) {
  const visited = new Set();
  const hops = [];
  let curI = startI;
  while (true) {
    if (visited.has(curI)) break;
    const sp = specialSpaces[curI];
    if (!sp || sp.type !== 'obstacle') break;
    visited.add(curI);
    const [x, y] = xy(curI);
    const nx = x + sp.dx, ny = y + sp.dy;
    if (!inB(nx, ny)) break;
    const destI = idx(nx, ny);
    if (isBlockSpace(destI)) break;
    const moverSide = sides[curI];
    const destSide = sides[destI];
    if (destSide !== 0 && destSide === moverSide) break;
    if (moverSide === B && destSide === W && health[destI] > 1) break;
    hops.push([curI, destI]);
    if (isVoidSpace(destI)) break; // animate the slide in, then piece disappears
    curI = destI;
  }
  return hops;
}

// Applies obstacle (arrow) spaces with chaining. Any piece â€" white or black â€"
// landing on an obstacle is redirected; if the destination is also an obstacle
// the chain continues. Visited set prevents infinite loops.
function applySpecialSpace(startI) {
  const visited = new Set();
  let toI = startI;
  while (true) {
    if (visited.has(toI)) break; // cycle detected â€" piece stays where it is
    const sp = specialSpaces[toI];
    if (!sp || sp.type !== 'obstacle') break;
    visited.add(toI);
    const [x, y] = xy(toI);
    const nx = x + sp.dx, ny = y + sp.dy;
    if (!inB(nx, ny)) break;
    const destI = idx(nx, ny);
    if (isBlockSpace(destI)) break; // wall — stop
    if (isVoidSpace(destI)) {
      // piece falls into void — remove it and return the void square
      const moverSide = sides[toI];
      if (moverSide === W && board[toI] === KING) { gameOver = true; gameMsg = `Game Over! Score: ${score}`; }
      if (moverSide === B && board[toI] === KING) score++;
      board[toI] = NONE; sides[toI] = 0; health[toI] = 1;
      return destI;
    }
    const moverSide = sides[toI];
    const destSide = sides[destI];
    if (destSide !== 0 && destSide === moverSide) break; // friendly blocks
    // Bounce: black piece hitting shielded white
    if (moverSide === B && destSide === W && health[destI] > 1) {
      health[destI]--; break;
    }
    if (destSide !== 0 && destSide !== moverSide) {
      if (board[destI] === KING && moverSide === W) score++;
      if (moverSide === W) gold += GOLD_VALUE[board[destI]] ?? 0;
    }
    if (board[destI] === CHEST && moverSide === W) {
      addToInventory(_randomItem());
    }
    board[destI] = board[toI]; sides[destI] = moverSide; health[destI] = health[toI];
    board[toI] = NONE; sides[toI] = 0; health[toI] = 1;
    toI = destI;
  }
  return toI;
}

// --- Leap button geometry ---
const BOARD_Y = LOGO_H + PREVIEW_H;
const INV_PANEL_TOP = BOARD_Y + MARGIN + BOARD_PX + 70;
const INV_PANEL_BOTTOM = INV_PANEL_TOP + INV_ROWS * (INV_SLOT + INV_PAD) + INV_PAD + 58;
const BTN_Y = INV_PANEL_BOTTOM + 20;
const BTN_GAP = 8;
const LEAP_BTN = { x: MARGIN, y: BTN_Y, w: BOARD_PX / 2 - BTN_GAP / 2, h: 60 };
const PITCH_BTN = { x: MARGIN + BOARD_PX / 2 + BTN_GAP / 2, y: BTN_Y, w: BOARD_PX / 2 - BTN_GAP / 2, h: 60 };
const COUNTDOWN_Y = BTN_Y + 60 + 46;
const GRAVE_Y = COUNTDOWN_Y + 100;
const GRAVE_H = 150;
const GRAVE_W = Math.floor(BOARD_PX / 2) - 8;
const PLAYER_GRAVE_X = MARGIN;
const ENEMY_GRAVE_X = MARGIN + Math.floor(BOARD_PX / 2) + 8;
const RESIGN_BTN = { x: MARGIN + BOARD_PX / 2 - 80, y: GRAVE_Y + GRAVE_H + 8, w: 160, h: 60 };
const SIDE_BTN_Y = GRAVE_Y + GRAVE_H + 74;
const HINT_BTN = { x: INV_X, y: SIDE_BTN_Y, w: INV_W, h: 36 };

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
  const wimg = spriteImages[`${B}_${w.piece}`];
  if (wimg && wimg.complete)
    ctx.drawImage(wimg, MARGIN + w.x * TILE + prevPad, MARGIN - TILE + prevPad, TILE - prevPad * 2, TILE - prevPad * 2);
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
  } else if (b.type === 'obstacle') {
    ctx.fillStyle = "rgba(80,200,255,0.18)";
    ctx.fillRect(bpx, bpy, TILE, TILE);
    const pocx = bpx + TILE / 2, pocy = bpy + TILE / 2;
    const pAngle = Math.atan2(b.dy, b.dx), pLen = TILE * 0.32;
    const ptx = pocx + Math.cos(pAngle) * pLen, pty = pocy + Math.sin(pAngle) * pLen;
    const pbx = pocx - Math.cos(pAngle) * pLen * 0.55, pby = pocy - Math.sin(pAngle) * pLen * 0.55;
    ctx.strokeStyle = "rgba(120,230,255,0.9)"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(pbx, pby); ctx.lineTo(ptx, pty); ctx.stroke();
    ctx.fillStyle = "rgba(120,230,255,0.9)";
    ctx.save(); ctx.translate(ptx, pty); ctx.rotate(pAngle);
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-13,-6); ctx.lineTo(-13,6); ctx.closePath(); ctx.fill();
    ctx.restore();
  } else if (b.type === 'void') {
    const vcx = bpx + TILE / 2, vcy = bpy + TILE / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(vcx, vcy, TILE * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "#000000"; ctx.fill();
    ctx.strokeStyle = "rgba(140,0,220,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(vcx, vcy, TILE * 0.36, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  } else if (b.type === 'block') {
    drawBlockTile(ctx, bpx, bpy, TILE);
  } else if (b.type === 'neutral') {
    const nimg = spriteImages[`${N}_${b.piece}`];
    if (nimg && nimg.complete) {
      ctx.drawImage(nimg, bpx + prevPad, bpy + prevPad, TILE - prevPad * 2, TILE - prevPad * 2);
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
    if (ep.side === W && ep.hlth > 1) {
      const bx = MARGIN + ep.x * TILE + TILE - 32, by = MARGIN + BOARD_PX + 2, sz = 30;
      const shieldImg = spriteImages["item_upgrader"];
      if (shieldImg && shieldImg.complete) ctx.drawImage(shieldImg, bx, by, sz, sz);
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 2.5;
      ctx.font = "42px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeText(ep.hlth - 1, bx + sz / 2, by + sz / 2 + 1);
      ctx.fillText(ep.hlth - 1, bx + sz / 2, by + sz / 2 + 1);
    }
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

// Item spaces (rendered before pieces so pieces show on top)
for (let i = 0; i < 64; i++) {
  if (itemSpaces[i] === ITEM_NONE) continue;
  const [x, y] = xy(i);
  const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
  ctx.fillStyle = "rgba(255,220,80,0.22)";
  ctx.fillRect(px, py, TILE, TILE);
  ctx.strokeStyle = "rgba(255,200,50,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
  const key = ITEM_SPRITE_KEYS[itemSpaces[i]];
  const img = spriteImages[key];
  if (img && img.complete) {
    const sz = TILE * 0.7;
    const offX = (TILE - sz) / 2;
    const baseOffY = (TILE - sz) / 2;
    const bob = Math.sin(performance.now() * 0.002 + i * 0.7) * 6;
    // shadow
    const shadowAlpha = 0.3 - 0.1 * ((bob + 6) / 12);
    ctx.save();
    ctx.globalAlpha = shadowAlpha;
    ctx.beginPath();
    ctx.ellipse(px + TILE / 2, py + TILE - 10, sz * 0.35, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 0.9;
    ctx.drawImage(img, px + offX, py + baseOffY + bob, sz, sz);
    ctx.globalAlpha = 1.0;
  }
}


// Arrow spaces
for (let i = 0; i < 64; i++) {
  const sp = specialSpaces[i];
  if (!sp || sp.type !== 'obstacle') continue;
  const [x, y] = xy(i);
  const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
  const cx = px + TILE / 2, cy = py + TILE / 2;
  ctx.fillStyle = "rgba(80,200,255,0.18)";
  ctx.fillRect(px, py, TILE, TILE);
  const angle = Math.atan2(sp.dy, sp.dx);
  const len = TILE * 0.32;
  const tx2 = cx + Math.cos(angle) * len, ty2 = cy + Math.sin(angle) * len;
  const bx2 = cx - Math.cos(angle) * len * 0.55, by2 = cy - Math.sin(angle) * len * 0.55;
  ctx.strokeStyle = "rgba(120,230,255,0.9)";
  ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(tx2, ty2); ctx.stroke();
  ctx.fillStyle = "rgba(120,230,255,0.9)";
  ctx.save(); ctx.translate(tx2, ty2); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-13,-6); ctx.lineTo(-13,6); ctx.closePath(); ctx.fill();
  ctx.restore();
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
const hasItemSpace = itemSpaces.some(v => v !== ITEM_NONE) || nextBonuses.some(b => b.type === 'item');
if (hasItemSpace && !chestBobRunning && !anim) { chestBobRunning = true; requestAnimationFrame(_chestBobTick); }

// Block spaces
for (let i = 0; i < 64; i++) {
  const sp = specialSpaces[i];
  if (!sp || sp.type !== 'block') continue;
  const [x, y] = xy(i);
  drawBlockTile(ctx, MARGIN + x * TILE, MARGIN + y * TILE, TILE);
}

// Pieces and chests
const pad = 6;
for (let i = 0; i < 64; i++) {
  if (board[i] === NONE) continue;
  if (_animToSet.has(i)) continue; // drawn by animation overlay at interpolated position
  const [x, y] = xy(i);
  if (board[i] === CHEST) {
    const img = spriteImages["chest"];
    if (img && img.complete) {
      ctx.drawImage(img, MARGIN + x * TILE + pad, MARGIN + y * TILE + pad, TILE - pad * 2, TILE - pad * 2);
    }
  } else {
    const key = `${sides[i]}_${board[i]}`;
    const img = spriteImages[key];
    if (img && img.complete) {
      ctx.drawImage(img, MARGIN + x * TILE + pad, MARGIN + y * TILE + pad, TILE - pad * 2, TILE - pad * 2);
    }
  }
  // Shield badge: shows number of shields (health - 1) using the shield sprite
  if (sides[i] === W && health[i] > 1) {
    const shields = health[i] - 1;
    const sz = 45;
    const bx = MARGIN + x * TILE + TILE - sz - 2, by = MARGIN + y * TILE + 2;
    const shieldImg = spriteImages["item_upgrader"];
    if (shieldImg && shieldImg.complete) ctx.drawImage(shieldImg, bx, by, sz, sz);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 2.5;
    ctx.font = "42px Canterbury";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeText(shields, bx + sz / 2, by + sz / 2 + 1);
    ctx.fillText(shields, bx + sz / 2, by + sz / 2 + 1);
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
  const key = `${cap.side}_${cap.piece}`;
  const img = spriteImages[key];
  if (img && img.complete) ctx.drawImage(img, MARGIN + x * TILE + pad, MARGIN + y * TILE + pad, TILE - pad * 2, TILE - pad * 2);
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
if (upgraderMode) {
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    const [px, py] = xy(i);
    ctx.fillStyle = "rgba(255,200,50,0.5)";
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
if (anim && anim.pieces && _animT < 1) {
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
      const key = `${ap.side}_${ap.piece}`;
      const img = spriteImages[key];
      if (img && img.complete) ctx.drawImage(img, acx + apad, acy + apad, TILE - apad * 2, TILE - apad * 2);
    }
    if (ap.side === W && ap.hlth > 1) {
      const shields = ap.hlth - 1;
      const sz = 45; const bx = acx + TILE - sz - 2, by = acy + 2;
      const shieldImg = spriteImages["item_upgrader"];
      if (shieldImg && shieldImg.complete) ctx.drawImage(shieldImg, bx, by, sz, sz);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2.5;
      ctx.font = "42px Canterbury";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeText(shields, bx + sz / 2, by + sz / 2 + 1);
      ctx.fillText(shields, bx + sz / 2, by + sz / 2 + 1);
    }
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
const invStatus = piecePromoterMode ? `Select a Pawn to promote to ${PIECE_NAMES[piecePromoterTo] || "?"}` : clonerMode ? (clonerSelected >= 0 ? "Select adjacent empty space" : "Select a piece to clone") : upgraderMode ? "Select a piece to upgrade" : teleporterMode ? (teleporterSelected >= 0 ? "Select destination" : "Select a piece to teleport") : bombMode ? "Select blast center" : "";
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
    const isActive = (piecePromoterMode || teleporterMode || clonerMode || upgraderMode) && inventory._activeSlot === slotIdx;
    ctx.fillStyle = isActive ? "#4a3a1e" : "#1a1a3e";
    ctx.beginPath();
    ctx.roundRect(sx, sy, INV_SLOT, INV_SLOT, 4);
    ctx.fill();
    if (isActive) {
      ctx.strokeStyle = "#e8a735";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (dragSlot !== slotIdx && inventory[slotIdx] !== ITEM_NONE) {
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
  // Die button (left) and Go button (right)
  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
  ctx.fillStyle = "#4a3a7a";
  ctx.beginPath(); ctx.roundRect(LEAP_BTN.x, LEAP_BTN.y, LEAP_BTN.w, LEAP_BTN.h, 6); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#fff"; ctx.font = "42px Canterbury"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("🎲 Roll", LEAP_BTN.x + LEAP_BTN.w / 2, LEAP_BTN.y + LEAP_BTN.h / 2);

  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
  ctx.fillStyle = "#2a6e3f";
  ctx.beginPath(); ctx.roundRect(PITCH_BTN.x, PITCH_BTN.y, PITCH_BTN.w, PITCH_BTN.h, 6); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  ctx.fillStyle = "#fff"; ctx.font = "42px Canterbury";
  ctx.fillText("▶ Go!", PITCH_BTN.x + PITCH_BTN.w / 2, PITCH_BTN.y + PITCH_BTN.h / 2);
} else if (!gameOver && gamePhase === 'playing') {
  const shiftUrgent = shiftCountdown <= 3;
  if (!replayMode) {
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
  const cdY = replayMode ? INV_PANEL_BOTTOM + 44 : COUNTDOWN_Y;
  ctx.font = "42px Canterbury";
  ctx.textAlign = "center";
  const cdText = `Field Auto-Advances In ${shiftCountdown} ${shiftCountdown === 1 ? 'Turn' : 'Turns'}`;
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = shiftUrgent ? "#ff6666" : "#88bbff";
  ctx.fillText(cdText, MARGIN + BOARD_PX / 2, cdY);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

  if (!replayMode) {
    // Resign
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#993333";
    ctx.beginPath();
    ctx.roundRect(RESIGN_BTN.x, RESIGN_BTN.y, RESIGN_BTN.w, RESIGN_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff";
    ctx.fillText("Resign", RESIGN_BTN.x + RESIGN_BTN.w / 2, RESIGN_BTN.y + RESIGN_BTN.h / 2);
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
if (replayMode) {
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
if (!isItemActive() && gamePhase === 'playing' && !replayMode) for (const [pool, isPlayer] of [[playerDead, true], [enemyDead, false]]) {
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
    const img = spriteImages[`${sideVal}_${pt}`];
    if (count === 0) {
      if (pt !== CHECKERS) {
        ctx.globalAlpha = 0.15;
        if (img && img.complete) ctx.drawImage(img, cx - pieceSz / 2, cy - pieceSz / 2, pieceSz, pieceSz);
        ctx.globalAlpha = 1;
      }
    } else {
      if (isKing) {
        ctx.fillStyle = isPlayer ? "rgba(180,60,60,0.5)" : "rgba(60,160,60,0.5)";
        ctx.beginPath(); ctx.arc(cx, cy, pieceSz / 2 + 2, 0, Math.PI * 2); ctx.fill();
      }
      if (img && img.complete) ctx.drawImage(img, cx - pieceSz / 2, cy - pieceSz / 2, pieceSz, pieceSz);
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
    const img = spriteImages[`${f.side}_${f.piece}`];
    if (img && img.complete) {
      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.rotate(angle);
      ctx.globalAlpha = t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.6 : 1;
      ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
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
  const img = spriteImages[`${voidDeathAnim.side}_${voidDeathAnim.piece}`];
  if (img && img.complete) {
    const scale = (1 - t) * (1 - t);
    const angle = t * Math.PI * 6;
    const sz = TILE * 0.75;
    ctx.save();
    ctx.translate(voidDeathAnim.cx, voidDeathAnim.cy);
    ctx.rotate(angle);
    ctx.globalAlpha = 1 - t * 0.5;
    ctx.drawImage(img, -sz * scale / 2, -sz * scale / 2, sz * scale, sz * scale);
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
    const canAfford = gold >= price;

    ctx.fillStyle = canAfford ? "#2a2a52" : "#1e1e30";
    ctx.beginPath(); ctx.roundRect(cardX, cardsY, cardW, cardH, 8); ctx.fill();
    if (canAfford) {
      ctx.strokeStyle = "rgba(255,200,50,0.3)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cardX, cardsY, cardW, cardH, 8); ctx.stroke();
    }

    if (isPromoterItem(item)) {
      _drawItemInSlot(ctx, item, cardX + (cardW - 90) / 2, cardsY + 16, 90);
    } else {
      const simg = spriteImages[ITEM_SPRITE_KEYS[item]];
      if (simg && simg.complete) ctx.drawImage(simg, cardX + (cardW - 90) / 2, cardsY + 16, 90, 90);
    }

    ctx.fillStyle = "#ddd";
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

    ctx.fillStyle = canAfford ? "#f0c040" : "#666";
    ctx.font = "42px Canterbury";
    ctx.fillText(`${price} G`, cardX + cardW / 2, cardsY + 210);

    ctx.fillStyle = canAfford ? "#3a6a3a" : "#2a2a2a";
    ctx.beginPath(); ctx.roundRect(cardX + 14, cardsY + cardH - 54, cardW - 28, 44, 6); ctx.fill();
    ctx.fillStyle = canAfford ? "#fff" : "#555";
    ctx.font = "42px Canterbury";
    ctx.textBaseline = "middle";
    ctx.fillText("Buy", cardX + cardW / 2, cardsY + cardH - 54 + 22);
  }

  // Close button
  const closeBtnX = dlgX + dlgW - 130, closeBtnY = dlgY + dlgH - 58;
  ctx.fillStyle = "#4a2a2a";
  ctx.beginPath(); ctx.roundRect(closeBtnX, closeBtnY, 110, 44, 6); ctx.fill();
  ctx.fillStyle = "#ddd";
  ctx.font = "42px Canterbury";
  ctx.textBaseline = "middle";
  ctx.fillText("Close", closeBtnX + 55, closeBtnY + 22);
}
}

function draw() {
  const _animT = anim ? easeOut(Math.min(1, (performance.now() - anim.startMs) / ANIM_MS)) : 1;
  const _animToSet = (anim && anim.pieces && _animT < 1) ? new Set(anim.pieces.map(p => p.toIdx)) : new Set();
  const _fieldAnim = anim && anim.boardDy !== 0 && _animT < 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawBackground(_fieldAnim, _animT);
  drawBoardArea(_animT, _animToSet, _fieldAnim);
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
  drawFlyAnims();
  drawShieldPops();
  drawExplosion();
  drawVoidDeath();
  drawPromoDialog();
  drawShopDialog();
  // Logo — topmost layer
  const logoEl = spriteImages["logo"];
  if (logoEl && logoEl.width > 0) {
    const maxW = canvas.width - MARGIN * 2;
    const scale = Math.min(maxW / logoEl.width, (LOGO_H - 8) / logoEl.height);
    const lw = logoEl.width * scale, lh = logoEl.height * scale;
    ctx.drawImage(logoEl, MARGIN, (LOGO_H - lh) / 2, lw, lh);
  }
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
  if (replayMode || gameOver || anim || turn !== W || aiThinking || shopMode || gamePhase !== 'playing') return;
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
      board[i] = promoterTo(item) === PROMOTER_WILD ? _rollWildTo() : promoterTo(item);
      removeFromInventory(slot); delete inventory._activeSlot;
      piecePromoterMode = false; piecePromoterTo = NONE;
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_UPGRADER && sides[i] === W) {
      health[i] = Math.max(health[i], 1) + 1;
      removeFromInventory(slot); delete inventory._activeSlot;
      upgraderMode = false;
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
    delete inventory._activeSlot;
  }

  draw();
});

// --- Click handler sub-functions ---

function handleReplayClick(cx, cy) {
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
    initBoard(); draw();
  } else if (cx >= repX && cx <= repX + btnW && cy >= soY && cy <= soY + btnH) {
    enterReplay();
  }
}

function handleItemCancelOrTrash(cx, cy) {
  const halfW = BOARD_PX / 2 - BTN_GAP / 2;
  const btnH = 80;
  if (cx >= MARGIN && cx <= MARGIN + halfW && cy >= BTN_Y && cy <= BTN_Y + btnH) {
    cancelItemMode(); return true;
  }
  if (cx >= MARGIN + BOARD_PX / 2 + BTN_GAP / 2 && cx <= MARGIN + BOARD_PX && cy >= BTN_Y && cy <= BTN_Y + btnH) {
    trashActiveItem(); return true;
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
    if (cx >= btnX && cx <= btnX + btnW && cy >= btnY && cy <= btnY + btnH && gold >= price) {
      gold -= price;
      addToInventory(shopOffers[i]);
      draw();
      return;
    }
  }
  const closeBtnX = dlgX + dlgW - 130, closeBtnY = dlgY + dlgH - 58, closeBtnW = 110, closeBtnH = 44;
  if ((cx >= closeBtnX && cx <= closeBtnX + closeBtnW && cy >= closeBtnY && cy <= closeBtnY + closeBtnH) ||
      cx < dlgX || cx > dlgX + dlgW || cy < dlgY || cy > dlgY + dlgH) {
    closeShop();
  }
}

function handlePiecePromoterClick(cx, cy) {
  const mx = cx - MARGIN, my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  const i2 = inB(gx, gy) ? idx(gx, gy) : -1;
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

function handleUpgraderClick(cx, cy) {
  const mx = cx - MARGIN, my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  if (inB(gx, gy) && sides[idx(gx, gy)] === W) {
    const i = idx(gx, gy);
    health[i] = Math.max(health[i], 1) + 1;
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    upgraderMode = false; draw(); return;
  }
  upgraderMode = false;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function handleBombClick(cx, cy) {
  const mx = cx - MARGIN, my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  bombMode = false; bombHoverIdx = -1;
  if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
  if (inB(gx, gy)) {
    detonateBomb(idx(gx, gy));
    firstMoveMade = true; recordPosition();
    if (!gameOver) endWhiteTurn(); else { takeReplaySnapshot(); draw(); }
  } else { draw(); }
}

function handleClonerClick(cx, cy) {
  const mx = cx - MARGIN, my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  if (inB(gx, gy)) {
    const i = idx(gx, gy);
    if (clonerSelected < 0) {
      if (sides[i] === W && adjacentClonerDests(i).length > 0) {
        clonerSelected = i; draw(); return;
      }
    } else {
      const dests = adjacentClonerDests(clonerSelected);
      if (dests.includes(i)) {
        if (board[i] === CHEST) addToInventory(_randomItem());
        board[i] = board[clonerSelected]; sides[i] = W; health[i] = health[clonerSelected];
        if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
        const clonerFromSpace = activeItemSpaceIdx >= 0;
        activeItemSpaceIdx = -1; clonerMode = false; clonerSelected = -1;
        if (clonerFromSpace) { processNextQueuedItem(); } else { firstMoveMade = true; recordPosition(); draw(); }
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
  const mx = cx - MARGIN, my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  if (inB(gx, gy)) {
    const i = idx(gx, gy);
    if (teleporterSelected < 0) {
      if (sides[i] === W) { teleporterSelected = i; draw(); return; }
    } else {
      if (board[i] === NONE || board[i] === CHEST) {
        if (board[i] === CHEST) addToInventory(_randomItem());
        const _tPiece0 = board[teleporterSelected], _tHlth0 = health[teleporterSelected];
        board[i] = _tPiece0; sides[i] = W; health[i] = _tHlth0;
        board[teleporterSelected] = NONE; sides[teleporterSelected] = 0; health[teleporterSelected] = 1;
        if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
        const fromSpace = activeItemSpaceIdx >= 0;
        activeItemSpaceIdx = -1; teleporterMode = false; teleporterSelected = -1;
        const _tHops = computeObstacleHops(i);
        const _tFinalI = applySpecialSpace(i);
        const _tPiece = board[_tFinalI] || _tPiece0, _tHlth = health[_tFinalI] || _tHlth0;
        const _tFinish = () => {
          checkWhiteKingAlive();
          if (gameOver) { takeReplaySnapshot(); draw(); return; }
          if (fromSpace) {
            processNextQueuedItem();
          } else {
            firstMoveMade = true; recordPosition();
            const itm = itemSpaces[_tFinalI];
            if (itm !== ITEM_NONE && sides[_tFinalI] === W && canItemAffectPiece(itm, _tFinalI)) {
              const done = activateItemSpace(itm, _tFinalI);
              if (done) endWhiteTurn();
            } else { endWhiteTurn(); }
          }
        };
        const _tDoHop = (hi) => {
          if (hi >= _tHops.length) {
            if (isVoidSpace(_tFinalI) && _tPiece !== NONE) {
              if (board[_tFinalI] !== NONE) {
                if (board[_tFinalI] === KING) { gameOver = true; gameMsg = `Game Over! Score: ${score}`; }
                board[_tFinalI] = NONE; sides[_tFinalI] = 0; health[_tFinalI] = 1;
              }
              const [vx, vy] = xy(_tFinalI);
              startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _tPiece, W, _tFinish);
            } else { _tFinish(); }
            return;
          }
          const [fI, tI] = _tHops[hi];
          const [fx, fy] = xy(fI), [tx, ty] = xy(tI);
          startAnim([{ toIdx: _tFinalI, fromCX: MARGIN+fx*TILE, fromCY: BOARD_Y+MARGIN+fy*TILE, toCX: MARGIN+tx*TILE, toCY: BOARD_Y+MARGIN+ty*TILE, piece: _tPiece, side: W, hlth: _tHlth }], 0, () => _tDoHop(hi+1));
        };
        _tDoHop(0);
        return;
      } else if (sides[i] === W) { teleporterSelected = i; draw(); return; }
    }
  }
  const teleFromSpace = activeItemSpaceIdx >= 0;
  activeItemSpaceIdx = -1; teleporterMode = false; teleporterSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  if (teleFromSpace) { processNextQueuedItem(); } else { draw(); }
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
    resignConfirm = false; gameOver = true;
    gameMsg = `Resigned. Kings Taken: ${score}`;
    selected = -1; validMoves = []; draw();
  } else if (cx >= noX && cx <= noX + btnW && cy >= btnY && cy <= btnY + btnH) {
    resignConfirm = false; draw();
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
      const modeMap = {
        [ITEM_TELEPORTER]:   () => { teleporterMode = true; teleporterSelected = -1; },
        [ITEM_CLONER]:       () => { clonerMode = true; clonerSelected = -1; },
        [ITEM_UPGRADER]:     () => { upgraderMode = true; },
        [ITEM_BOMB]:         () => { bombMode = true; bombHoverIdx = -1; },
      };
      if (isPromoterItem(item)) modeMap[item] = () => { piecePromoterMode = true; piecePromoterTo = promoterTo(item); };
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
    if (sides[clicked] === W) { selected = clicked; validMoves = legalMoves(gx, gy); }
  } else {
    if (validMoves.includes(clicked)) {
      const [pfx, pfy] = xy(selected), [ptx, pty] = xy(clicked);
      const pFromCX = MARGIN + pfx * TILE, pFromCY = BOARD_Y + MARGIN + pfy * TILE;
      const pToCX = MARGIN + ptx * TILE, pToCY = BOARD_Y + MARGIN + pty * TILE;
      const isCKS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && ptx === 6 && !wkMoved;
      const isCQS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && ptx === 2 && !wkMoved;
      const clickedDest = clicked;
      firstMoveMade = true;
      // Hire neutral: bounce attacker, neutral turns white
      if (sides[clicked] === N) {
        const fromI = selected;
        const attackPiece = board[fromI], attackHlth = health[fromI];
        const bounceI = calcBouncePos(fromI, clicked, attackPiece);
        const [bx, by] = xy(bounceI);
        const bounceCX = MARGIN + bx * TILE, bounceCY = BOARD_Y + MARGIN + by * TILE;
        selected = -1; validMoves = [];
        makeMove(fromI, clicked, false);
        recordPosition();
        startAnim([{ toIdx: bounceI, fromCX: pFromCX, fromCY: pFromCY, toCX: pToCX, toCY: pToCY, piece: attackPiece, side: W, hlth: attackHlth }], 0, () => {
          startAnim([{ toIdx: bounceI, fromCX: pToCX, fromCY: pToCY, toCX: bounceCX, toCY: bounceCY, piece: attackPiece, side: W, hlth: attackHlth }], 0, () => {
            startShieldPop(pToCX + TILE / 2, pToCY + TILE / 2);
            endWhiteTurn();
          });
        });
        return;
      }
      // Engage merchant: bounce attacker, open shop, then end turn
      if (clicked === merchantIdx) {
        const fromI = selected;
        const attackPiece = board[fromI], attackHlth = health[fromI];
        const bounceI = calcBouncePos(fromI, clicked, attackPiece);
        const [bx, by] = xy(bounceI);
        const bounceCX = MARGIN + bx * TILE, bounceCY = BOARD_Y + MARGIN + by * TILE;
        selected = -1; validMoves = [];
        recordPosition();
        startAnim([{ toIdx: bounceI, fromCX: pFromCX, fromCY: pFromCY, toCX: pToCX, toCY: pToCY, piece: attackPiece, side: W, hlth: attackHlth }], 0, () => {
          startAnim([{ toIdx: bounceI, fromCX: pToCX, fromCY: pToCY, toCX: bounceCX, toCY: bounceCY, piece: attackPiece, side: W, hlth: attackHlth }], 0, () => {
            startShieldPop(pToCX + TILE / 2, pToCY + TILE / 2);
            openMerchantShop(endWhiteTurn);
          });
        });
        return;
      }
      makeMove(selected, clicked, true);
      recordPosition();
      const _isCheckersJump = board[clickedDest] === CHECKERS && Math.abs(ptx - pfx) === 2;
      const wAnimPieces = [{
        toIdx: clickedDest,
        fromCX: pFromCX, fromCY: pFromCY, toCX: pToCX, toCY: pToCY,
        piece: board[clickedDest], side: sides[clickedDest], hlth: health[clickedDest],
        arc: _isCheckersJump ? TILE * 1.5 : 0
      }];
      if (isCKS) wAnimPieces.push({ toIdx: idx(5,7), fromCX: MARGIN+7*TILE, fromCY: BOARD_Y+MARGIN+7*TILE, toCX: MARGIN+5*TILE, toCY: BOARD_Y+MARGIN+7*TILE, piece: ROOK, side: W, hlth: health[idx(5,7)] });
      if (isCQS) wAnimPieces.push({ toIdx: idx(3,7), fromCX: MARGIN+0*TILE, fromCY: BOARD_Y+MARGIN+7*TILE, toCX: MARGIN+3*TILE, toCY: BOARD_Y+MARGIN+7*TILE, piece: ROOK, side: W, hlth: health[idx(3,7)] });
      selected = -1; validMoves = [];
      const _wHops = computeObstacleHops(clickedDest);
      const _wHopCaptures = {};
      for (const [, tI] of _wHops) {
        if (board[tI] !== NONE && board[tI] !== CHEST && sides[tI] !== W) {
          _wHopCaptures[tI] = { piece: board[tI], side: sides[tI] };
          pendingCaptures[tI] = _wHopCaptures[tI];
        }
      }
      const _wPiece0 = board[clickedDest], _wSide0 = sides[clickedDest], _wHlth0 = health[clickedDest];
      const _wFinalI = applySpecialSpace(clickedDest);
      const _wPiece = board[_wFinalI] || _wPiece0, _wSide = sides[_wFinalI] || _wSide0, _wHlth = health[_wFinalI] || _wHlth0;
      wAnimPieces[0].toIdx = _wFinalI;
      wAnimPieces[0].piece = _wPiece; wAnimPieces[0].side = _wSide; wAnimPieces[0].hlth = _wHlth;
      const _wContinue = (movedTo) => {
        pendingCaptures = {};
        checkWhiteKingAlive();
        if (!gameOver) {
          const item = itemSpaces[movedTo];
          if (item !== ITEM_NONE && sides[movedTo] === W && canItemAffectPiece(item, movedTo)) {
            const done = activateItemSpace(item, movedTo);
            if (done) endWhiteTurn();
          } else { endWhiteTurn(); }
        } else { draw(); }
      };
      const _wDoHop = (hi) => {
        if (hi >= _wHops.length) {
          if (isVoidSpace(_wFinalI) && _wPiece !== NONE) {
            const [vx, vy] = xy(_wFinalI);
            startVoidDeath(MARGIN + vx * TILE + TILE / 2, BOARD_Y + MARGIN + vy * TILE + TILE / 2, _wPiece, _wSide, () => _wContinue(_wFinalI));
          } else { _wContinue(_wFinalI); }
          return;
        }
        const [fI, tI] = _wHops[hi];
        const [fx, fy] = xy(fI), [tx, ty] = xy(tI);
        startAnim([{ toIdx: _wFinalI, fromCX: MARGIN+fx*TILE, fromCY: BOARD_Y+MARGIN+fy*TILE, toCX: MARGIN+tx*TILE, toCY: BOARD_Y+MARGIN+ty*TILE, piece: _wPiece, side: _wSide, hlth: _wHlth }], 0, () => {
          const cap = _wHopCaptures[tI];
          if (cap) {
            delete pendingCaptures[tI];
            const isPlayerPiece = cap.side === W;
            const pool = isPlayerPiece ? playerDead : enemyDead;
            const [tgx, tgy] = graveSlotPos(isPlayerPiece, cap.piece);
            startFlyAnim(cap.piece, cap.side, MARGIN + tx*TILE + TILE/2, BOARD_Y + MARGIN + ty*TILE + TILE/2, tgx, tgy, () => { pool[cap.piece] = (pool[cap.piece] || 0) + 1; });
          }
          _wDoHop(hi+1);
        });
      };
      startAnim(wAnimPieces, 0, () => {
        checkWhiteKingAlive();
        if (!gameOver) { _wDoHop(0); } else { takeReplaySnapshot(); draw(); }
      });
      return;
    } else if (clicked === selected) {
      selected = -1; validMoves = [];
    } else if (sides[clicked] === W) {
      selected = clicked; validMoves = legalMoves(gx, gy);
    } else {
      selected = -1; validMoves = [];
    }
  }
  draw();
}

canvas.addEventListener("click", (e) => {
  if (dragConsumed) { dragConsumed = false; return; }
  const [cx, cy] = canvasCoords(e);
  if (replayMode) { handleReplayClick(cx, cy); return; }
  if (gameOver) { handleGameOverClick(cx, cy); return; }
  if (anim) return;
  if (gamePhase === 'playing' && isItemActive() && handleItemCancelOrTrash(cx, cy)) return;
  if (shopMode) { handleShopClick(cx, cy); return; }
  if (piecePromoterMode) { handlePiecePromoterClick(cx, cy); return; }
  if (upgraderMode) { handleUpgraderClick(cx, cy); return; }
  if (bombMode) { handleBombClick(cx, cy); return; }
  if (clonerMode) { handleClonerClick(cx, cy); return; }
  if (teleporterMode) { handleTeleporterClick(cx, cy); return; }
  if (resignConfirm) { handleResignConfirmClick(cx, cy); return; }
  if (isItemActive() && handleItemCancelOrTrash(cx, cy)) return;
  if (!gameOver && cx >= RESIGN_BTN.x && cx <= RESIGN_BTN.x + RESIGN_BTN.w &&
      cy >= RESIGN_BTN.y && cy <= RESIGN_BTN.y + RESIGN_BTN.h) { resignConfirm = true; draw(); return; }
  if (handleInventoryClick(cx, cy)) return;
  if (testMode && cx >= HINT_BTN.x && cx <= HINT_BTN.x + HINT_BTN.w &&
      cy >= HINT_BTN.y && cy <= HINT_BTN.y + HINT_BTN.h) { showHint(); return; }
  if (gamePhase === 'setup') {
    if (cx >= LEAP_BTN.x && cx <= LEAP_BTN.x + LEAP_BTN.w &&
        cy >= LEAP_BTN.y && cy <= LEAP_BTN.y + LEAP_BTN.h) { rollSetup(); draw(); return; }
    if (cx >= PITCH_BTN.x && cx <= PITCH_BTN.x + PITCH_BTN.w &&
        cy >= PITCH_BTN.y && cy <= PITCH_BTN.y + PITCH_BTN.h) { playConquestGif(); return; }
    return;
  }
  if (cx >= LEAP_BTN.x && cx <= LEAP_BTN.x + LEAP_BTN.w &&
      cy >= LEAP_BTN.y && cy <= LEAP_BTN.y + LEAP_BTN.h) { hintMove = null; teamLeap(); return; }
  if (cx >= PITCH_BTN.x && cx <= PITCH_BTN.x + PITCH_BTN.w &&
      cy >= PITCH_BTN.y && cy <= PITCH_BTN.y + PITCH_BTN.h) { hintMove = null; if (canManualPitchShift()) fieldAdvance(true); return; }
  handleBoardClick(cx, cy);
});


initBoard();
document.fonts.load("42px Canterbury").then(() => loadSprites());

window.setupTest = function(preset) {
  if (preset === 'teleporter_void') {
    itemSpaces[idx(3, 5)] = ITEM_TELEPORTER;
    specialSpaces[idx(5, 5)] = { type: 'void' };
    draw();
  }
};


