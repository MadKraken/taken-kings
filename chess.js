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

const NONE = 0, PAWN = 1, ROOK = 2, KNIGHT = 3, BISHOP = 4, QUEEN = 5, KING = 6, CHEST = 7;
const W = 1, B = 2;
const GRAVE_TYPES = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING];

const PIECE_NAMES = { [PAWN]: "pawn", [ROOK]: "rook", [KNIGHT]: "knight", [BISHOP]: "bishop", [QUEEN]: "queen", [KING]: "king" };
const SIDE_PREFIX = { [W]: "w", [B]: "b" };
const spriteImages = {};
let spritesLoaded = false;

function loadSprites() {
  let count = 0;
  const total = 23;
  const logoImg = new Image();
  logoImg.src = "taken_kings_logo.png?v=6";
  logoImg.onload = () => {
    spriteImages["logo"] = logoImg;
    count++; if (count === total) { spritesLoaded = true; draw(); }
  };
  logoImg.onerror = (e) => {
    console.log("logo FAILED", e);
    count++; if (count === total) { spritesLoaded = true; draw(); }
  };
  for (const s of [W, B]) {
    for (const p of [PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING]) {
      const key = `${s}_${p}`;
      const img = new Image();
      img.src = (s === W && p === PAWN) ? "pawn.png" : `sprites/${SIDE_PREFIX[s]}_${PIECE_NAMES[p]}.svg`;
      img.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
      spriteImages[key] = img;
    }
  }
  const chestImg = new Image();
  chestImg.src = "sprites/chest.svg";
  chestImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["chest"] = chestImg;
  const promImg = new Image();
  promImg.src = "sprites/item_promoter.svg";
  promImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_promoter"] = promImg;
  const anyPromImg = new Image();
  anyPromImg.src = "sprites/item_any_promoter.svg";
  anyPromImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_any_promoter"] = anyPromImg;
  const teleImg = new Image();
  teleImg.src = "sprites/item_teleporter.svg";
  teleImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_teleporter"] = teleImg;
  const kingPromImg = new Image();
  kingPromImg.src = "sprites/item_king_promoter.svg";
  kingPromImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_king_promoter"] = kingPromImg;
  const clonerImg = new Image();
  clonerImg.src = "sprites/item_cloner.svg";
  clonerImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_cloner"] = clonerImg;
  const upgraderImg = new Image();
  upgraderImg.src = "sprites/item_upgrader.svg?v=2";
  upgraderImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_upgrader"] = upgraderImg;
  const bombImg = new Image();
  bombImg.src = "sprites/item_bomb.svg";
  bombImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["item_bomb"] = bombImg;
  const explosionImg = new Image();
  explosionImg.src = "sprites/explosion.svg";
  explosionImg.onload = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
  spriteImages["explosion"] = explosionImg;
  const groundImg = new Image();
  groundImg.src = "ground.jpg";
  groundImg.onload = () => { spriteImages["ground"] = groundImg; count++; if (count === total) { spritesLoaded = true; draw(); } };
  groundImg.onerror = () => { count++; if (count === total) { spritesLoaded = true; draw(); } };
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
const ITEM_NONE = 0, ITEM_PROMOTER = 1, ITEM_ANY_PROMOTER = 3, ITEM_TELEPORTER = 4, ITEM_KING_PROMOTER = 5, ITEM_CLONER = 6, ITEM_UPGRADER = 7, ITEM_BOMB = 8;
const ITEM_NAMES = { [ITEM_PROMOTER]: "Pawn Promoter", [ITEM_ANY_PROMOTER]: "All Promoter", [ITEM_TELEPORTER]: "Teleporter", [ITEM_KING_PROMOTER]: "Promoter To King", [ITEM_CLONER]: "Cloner", [ITEM_UPGRADER]: "Upgrader", [ITEM_BOMB]: "Bomb" };
let inventory = new Array(INV_COLS * INV_ROWS).fill(ITEM_NONE);
let dragSlot = -1, dragX = 0, dragY = 0, dragOverTrash = false, dragConsumed = false;
let playerDead = {}, enemyDead = {}, flyAnims = [];
let shieldPops = [];
let warnFlashRunning = false;
let voidPulseRunning = false;
let chestBobRunning = false;
let voidDeathAnim = null; // {items:[{cx,cy,piece,side}], startMs, onDone}
let explosionAnim = null; // {cx, cy, startMs}
let pendingCaptures = {}; // boardIdx -> {piece, side} — removed from board but still rendered until hop arrives
let promotingMode = false;
let promotingPawnIdx = -1;
let anyPromotingMode = false;
let anyPromotingPieceIdx = -1;
let teleporterMode = false;
let teleporterSelected = -1;
let bombMode = false;
let bombHoverIdx = -1;
let kingPromotingMode = false;
let clonerMode = false;
let clonerSelected = -1;
let upgraderMode = false;
let shiftCountdown = 10;
let itemSpaces = new Array(64).fill(ITEM_NONE);

let activeItemSpaceIdx = -1; // item space currently pending interactive resolution
let pendingItemQueue = []; // {item, i} pairs queued after a Team Advance
let pendingShopQueue = []; // shop-space indices queued after a Team Advance
let specialSpaces = new Array(64).fill(null); // {type:'obstacle'|'shop'|'void'|'block', ...}
let shopMode = false;
let shopSpaceIdx = -1; // which specialSpaces entry is currently open
let shopOffers = []; // reference to specialSpaces[shopSpaceIdx].offers
let shopOnDone = null; // callback after shop closes

const ITEM_SPRITE_KEYS = {
  [ITEM_PROMOTER]: "item_promoter",
  [ITEM_ANY_PROMOTER]: "item_any_promoter",
  [ITEM_TELEPORTER]: "item_teleporter",
  [ITEM_KING_PROMOTER]: "item_king_promoter",
  [ITEM_CLONER]: "item_cloner",
  [ITEM_UPGRADER]: "item_upgrader",
  [ITEM_BOMB]: "item_bomb"
};
const ITEM_PRICES = {
  [ITEM_PROMOTER]: 20,
  [ITEM_ANY_PROMOTER]: 45,
  [ITEM_TELEPORTER]: 30,
  [ITEM_KING_PROMOTER]: 40,
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
const PIECE_VALUE = { [NONE]: 0, [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 20000, [CHEST]: 0 };
const GOLD_VALUE = { [PAWN]: 1, [KNIGHT]: 3, [BISHOP]: 3, [ROOK]: 5, [QUEEN]: 9, [KING]: 15, [CHEST]: 0, [NONE]: 0 };
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
    wave.push({x: cols[i], piece: SPAWN_PIECES[randInt(SPAWN_PIECES.length)]});
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
    const type = ['chest', 'item', 'obstacle', 'shop', 'void', 'block'][randInt(6)];
    if (type === 'chest') {
      bonuses.push({ type: 'chest', col: x });
    } else if (type === 'item') {
      const items = [ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB];
      bonuses.push({ type: 'item', col: x, item: items[randInt(items.length)] });
    } else if (type === 'shop') {
      const all = [ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB];
      const offers = [all[randInt(all.length)], all[randInt(all.length)], all[randInt(all.length)]];
      bonuses.push({ type: 'shop', col: x, offers, sold: [false, false, false] });
    } else if (type === 'void') {
      bonuses.push({ type: 'void', col: x });
    } else if (type === 'block') {
      bonuses.push({ type: 'block', col: x });
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
  inventory.fill(ITEM_NONE); promotingMode = false; promotingPawnIdx = -1; anyPromotingMode = false; anyPromotingPieceIdx = -1; teleporterMode = false; teleporterSelected = -1; kingPromotingMode = false; clonerMode = false; clonerSelected = -1; upgraderMode = false; bombMode = false; bombHoverIdx = -1;
  playerDead = {}; enemyDead = {}; flyAnims = []; shieldPops = [];
  health.fill(1); shiftCountdown = 10;
  itemSpaces.fill(ITEM_NONE);
  pendingItemQueue = [];
  specialSpaces.fill(null);
  wkMoved = false; wraMoved = false; wrhMoved = false;
  epTarget = -1;
  gamePhase = 'setup';
  rollSetup();
}

function _randomSetupPiece() {
  const r = randInt(16);
  if (r < 8) return PAWN;
  if (r === 8) return ROOK;
  if (r === 9) return KNIGHT;
  if (r === 10) return BISHOP;
  if (r === 11) return QUEEN;
  if (r === 12) return KING;
  return NONE; // 3/16 chance of empty
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

  // Roll remaining 15 positions
  for (let i = 1; i < 16; i++) {
    const p = _randomSetupPiece();
    if (p !== NONE) set(positions[i].x, positions[i].y, p, W);
  }

  // One random item in inventory
  inventory.fill(ITEM_NONE);
  inventory[0] = [ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB][randInt(7)];
}

function startGame() {
  gamePhase = 'playing';
  draw();
}



function slidingMoves(moves, x, y, dirs, s) {
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (inB(nx, ny)) {
      if (side(nx, ny) === s) break;
      if (s === B && piece(nx, ny) === CHEST) break;
      const ni = idx(nx, ny);
      if (isBlockSpace(ni)) break; // wall â€" stop ray, can't land or pass through
      const isVoid = specialSpaces[ni]?.type === 'void';
      if (!isVoid) moves.push(ni);
      if (piece(nx, ny) !== NONE && piece(nx, ny) !== CHEST) break; // chests and voids don't stop the ray
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
  } else if (p === KNIGHT) {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && piece(nx, ny) === CHEST) && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) moves.push(idx(nx, ny));
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
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && piece(nx, ny) === CHEST) && !isVoidSpace(idx(nx, ny)) && !isBlockSpace(idx(nx, ny))) moves.push(idx(nx, ny));
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
    addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB][randInt(7)]);
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
    pitchShift();
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
  return promotingMode || anyPromotingMode || teleporterMode || kingPromotingMode || clonerMode || upgraderMode || bombMode;
}

function cancelItemMode() {
  promotingMode = false; anyPromotingMode = false; teleporterMode = false;
  kingPromotingMode = false; clonerMode = false; upgraderMode = false; bombMode = false; bombHoverIdx = -1;
  promotingPawnIdx = -1; anyPromotingPieceIdx = -1;
  teleporterSelected = -1; clonerSelected = -1;
  if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
  draw();
}

function trashActiveItem() {
  if (inventory._activeSlot !== undefined) {
    removeFromInventory(inventory._activeSlot);
    delete inventory._activeSlot;
  }
  promotingMode = false; anyPromotingMode = false; teleporterMode = false;
  kingPromotingMode = false; clonerMode = false; upgraderMode = false; bombMode = false; bombHoverIdx = -1;
  promotingPawnIdx = -1; anyPromotingPieceIdx = -1;
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
      if (sides[idx(x, y)] === B) occupied.add(y);
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
        if (newBoard[ni] === CHEST) addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB][randInt(7)]);
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

function pitchShift() {
  if (!canPitchShift() || anim) return;

  // Capture the bottom row before it's destroyed so animation can slide it out.
  const exitRow = [];
  for (let x = 0; x < 8; x++) {
    const i = idx(x, 7);
    exitRow.push({ x, piece: board[i], side: sides[i], hlth: health[i] });
  }

  // Everything shifts down one row; row 7 is destroyed (including white pieces).
  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);
  const newHealth = new Array(64).fill(1);

  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) continue; // destroyed
    const ni = idx(x, y + 1);
    if (specialSpaces[ni]?.type === 'block') { newBoard[i] = board[i]; newSides[i] = sides[i]; newHealth[i] = health[i]; continue; }
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
    if (b.type === 'shop') newSpecialSpaces[idx(b.col, 0)] = { type: 'shop', offers: b.offers, sold: b.sold };
    if (b.type === 'void') newSpecialSpaces[idx(b.col, 0)] = { type: 'void' };
    if (b.type === 'block') newSpecialSpaces[idx(b.col, 0)] = { type: 'block' };
  }
  specialSpaces.splice(0, 64, ...newSpecialSpaces);

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
  for (const w of nextWave) {
    if (specialSpaces[idx(w.x, 0)]?.type === 'block') continue; // block wall, piece can't enter
    set(w.x, 0, w.piece, B);
  }
  for (const b of nextBonuses) {
    if (b.type === 'chest') set(b.col, 0, CHEST, 0);
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
  // Simulates pitchShift for AI lookahead: everything shifts down, row 7 destroyed
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
  for (const b of nextBonuses) { if (b.type === 'chest') set(b.col, 0, CHEST, 0); }
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
    if (sides[i] === W) {
      val += v;
      if (board[i] === KING) whiteKing = true;
    } else {
      val -= v;
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
    for (const to of pseudoMoves(x, y)) moves.push([i, to]);
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
          if (!gameOver) turn = W;
          aiThinking = false;
          draw();
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
          recordPosition();
          // Phase 2: bounce back to bounceI (suppress at bounceI)
          startAnim([{ toIdx: bounceI, fromCX: mToCX, fromCY: mToCY, toCX: bounceCX, toCY: bounceCY, piece: attackPiece, side: B, hlth: attackHlth }], 0, () => {
            if (wasLastShield) startShieldPop(hitCX, hitCY);
            _aiFinish();
          });
        });
      } else {
        makeMove(move[0], move[1], true);
        const _aiHops = computeObstacleHops(move[1]);
        const _aiPiece0 = board[move[1]], _aiSide0 = sides[move[1]], _aiHlth0 = health[move[1]];
        const _aiFinalI = applySpecialSpace(move[1]);
        recordPosition();
        const _aiPiece = board[_aiFinalI] || _aiPiece0, _aiSide = sides[_aiFinalI] || _aiSide0, _aiHlth = health[_aiFinalI] || _aiHlth0;
        const aiAnimPieces = [{
          toIdx: _aiFinalI,
          fromCX: mFromCX, fromCY: mFromCY, toCX: mToCX, toCY: mToCY,
          piece: _aiPiece, side: _aiSide, hlth: _aiHlth
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
      if (!gameOver) turn = W;
      aiThinking = false;
      draw();
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
  switch (item) {
    case ITEM_UPGRADER: return true;
    case ITEM_PROMOTER: return p === PAWN;
    case ITEM_ANY_PROMOTER: return p !== KING;
    case ITEM_KING_PROMOTER: return p === PAWN;
    case ITEM_TELEPORTER: return true;
    case ITEM_CLONER: return adjacentClonerDests(i).length > 0;
    case ITEM_BOMB: return true;
    default: return false;
  }
}

function detonateBomb(centerI) {
  const [gx, gy] = xy(centerI);
  startExplosion(MARGIN + gx * TILE + TILE / 2, BOARD_Y + MARGIN + gy * TILE + TILE / 2);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx = gx + dx, ny = gy + dy;
    if (!inB(nx, ny)) continue;
    const i = idx(nx, ny);
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
    if (specialSpaces[i]?.type === 'block' || specialSpaces[i]?.type === 'shop') specialSpaces[i] = null;
    itemSpaces[i] = ITEM_NONE;
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
    case ITEM_KING_PROMOTER:
      board[i] = KING;
      activeItemSpaceIdx = -1;
      return true;
    case ITEM_PROMOTER:
      // Skip pawn selection â€" piece is already known. Jump straight to chooser.
      promotingPawnIdx = i;
      draw();
      return false;
    case ITEM_ANY_PROMOTER:
      anyPromotingPieceIdx = i;
      draw();
      return false;
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
  if (pendingItemQueue.length === 0) { processNextShop(); return; }
  const { item, i } = pendingItemQueue.shift();
  const done = activateItemSpace(item, i);
  if (done) processNextQueuedItem();
}

function processNextShop() {
  if (pendingShopQueue.length === 0) { endWhiteTurn(); return; }
  const spaceIdx = pendingShopQueue.shift();
  openShop(spaceIdx, () => processNextShop());
}

function openShop(spaceIdx, onDone) {
  shopSpaceIdx = spaceIdx;
  shopOffers = specialSpaces[spaceIdx].offers;
  shopMode = true;
  shopOnDone = onDone;
  draw();
}

function closeShop() {
  shopMode = false;
  const done = shopOnDone;
  shopOnDone = null;
  if (done) done();
}

// After a Team Advance, apply obstacle spaces then item spaces leftâ†’right, frontâ†’back.
function applySpacesAfterAdvance() {
  // Pass 1: obstacles. Collect starters first so pieces that land mid-chain aren't re-triggered.
  const obstacleStarters = [];
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W && specialSpaces[i] && specialSpaces[i].type === 'obstacle') {
      obstacleStarters.push(i);
    }
  }
  for (const i of obstacleStarters) {
    if (sides[i] === W) applySpecialSpace(i); // piece may chain-move away
  }
  checkWhiteKingAlive();
  if (gameOver) { draw(); return; }

  // Pass 2: item spaces â€" instant items applied now, interactive items queued.
  pendingItemQueue = [];
  for (let i = 0; i < 64; i++) {
    const item = itemSpaces[i];
    if (item === ITEM_NONE || sides[i] !== W || !canItemAffectPiece(item, i)) continue;
    if (item === ITEM_UPGRADER) { health[i]++; itemSpaces[i] = ITEM_NONE; }
    else if (item === ITEM_KING_PROMOTER) { board[i] = KING; itemSpaces[i] = ITEM_NONE; }
    else { pendingItemQueue.push({ item, i }); itemSpaces[i] = ITEM_NONE; }
  }

  // Pass 3: shop spaces â€" queued after items so each triggers its own dialogue.
  pendingShopQueue = [];
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W && specialSpaces[i]?.type === 'shop') pendingShopQueue.push(i);
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
      addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB][randInt(7)]);
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

function draw() {
  const _animT = anim ? easeOut(Math.min(1, (performance.now() - anim.startMs) / ANIM_MS)) : 1;
  const _animToSet = (anim && anim.pieces && _animT < 1) ? new Set(anim.pieces.map(p => p.toIdx)) : new Set();
  const _fieldAnim = anim && anim.boardDy !== 0 && _animT < 1;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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

  // Logo
  const logoEl = spriteImages["logo"];
  if (logoEl && logoEl.width > 0) {
    const maxW = canvas.width - MARGIN * 2;
    const scale = Math.min(maxW / logoEl.width, (LOGO_H - 8) / logoEl.height);
    const lw = logoEl.width * scale, lh = logoEl.height * scale;
    ctx.drawImage(logoEl, MARGIN + BOARD_PX - lw, (LOGO_H - lh) / 2, lw, lh);
  }

  // Stats â€" left and right of logo, in the logo area
  {
    const statsY = LOGO_H * 0.55;
    ctx.font = "bold 36px sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#fff";
    ctx.fillText(`TAKEN KINGS: ${score}`, MARGIN, LOGO_H * 0.35);
    ctx.fillText(`GOLD: ${gold}`, MARGIN, LOGO_H * 0.70);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  }

  ctx.save();
  ctx.translate(0, BOARD_Y);

  // Labels
  ctx.font = "bold 36px sans-serif";
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
    } else if (b.type === 'shop') {
      ctx.fillStyle = "rgba(255, 200, 50, 0.18)";
      ctx.fillRect(bpx, bpy, TILE, TILE);
      ctx.strokeStyle = "rgba(255, 200, 50, 0.55)";
      ctx.lineWidth = 2;
      ctx.strokeRect(bpx + 1, bpy + 1, TILE - 2, TILE - 2);
      drawShopTile(ctx, bpx, bpy, TILE);
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
    }
  }

  // Exit row â€" only during Field Advance animation. Drawn at y=8 (one below the live board)
  // so it starts at its original position and slides down behind the bottom border.
  if (_fieldAnim && anim.exitRow) {
    const erPad = 6;
    for (let x = 0; x < 8; x++) {
      if ((x + 8) % 2 !== 0) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(MARGIN + x * TILE, MARGIN + BOARD_PX, TILE, TILE); }
    }
    for (const ep of anim.exitRow) {
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
        ctx.font = "bold 36px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
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

  // Shop spaces
  for (let i = 0; i < 64; i++) {
    const sp = specialSpaces[i];
    if (!sp || sp.type !== 'shop') continue;
    const [x, y] = xy(i);
    const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
    ctx.fillStyle = "rgba(255, 200, 50, 0.18)";
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = "rgba(255, 200, 50, 0.55)";
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
    drawShopTile(ctx, px, py, TILE);
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
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeText(shields, bx + sz / 2, by + sz / 2 + 1);
      ctx.fillText(shields, bx + sz / 2, by + sz / 2 + 1);
    }
  }

  // Pending captures: pieces removed from board but not yet visually taken (waiting for hop anim)
  for (const [idxStr, cap] of Object.entries(pendingCaptures)) {
    const i = Number(idxStr);
    const [x, y] = xy(i);
    const key = `${cap.side}_${cap.piece}`;
    const img = spriteImages[key];
    if (img && img.complete) ctx.drawImage(img, MARGIN + x * TILE + pad, MARGIN + y * TILE + pad, TILE - pad * 2, TILE - pad * 2);
  }

  // King Promoter highlight â€" highlight white pawns
  if (kingPromotingMode) {
    for (let i = 0; i < 64; i++) {
      if (board[i] === PAWN && sides[i] === W) {
        const [px, py] = xy(i);
        ctx.fillStyle = "rgba(180,80,255,0.5)";
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

  // Promoting mode highlight
  if (promotingMode || anyPromotingMode) {
    for (let i = 0; i < 64; i++) {
      const eligible = anyPromotingMode
        ? (sides[i] === W && board[i] !== NONE && board[i] !== KING)
        : (board[i] === PAWN && sides[i] === W);
      if (eligible) {
        const [px, py] = xy(i);
        ctx.fillStyle = "rgba(200,150,50,0.5)";
        ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
      }
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
      const acy = ap.fromCY + (ap.toCY - ap.fromCY) * _animT;
      if (ap.piece === CHEST) {
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
        ctx.font = "bold 36px sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.strokeText(shields, bx + sz / 2, by + sz / 2 + 1);
        ctx.fillText(shields, bx + sz / 2, by + sz / 2 + 1);
      }
    }
  }

  // Static fog window â€" completely independent of the board. Always at the same canvas
  // position. Board content (including the preview row) scrolls underneath it.
  const previewRowNum = 8 + leapCount + 1;
  ctx.fillStyle = "rgba(15, 15, 40, 0.58)";
  ctx.fillRect(MARGIN, BOARD_Y + MARGIN - TILE, 8 * TILE, TILE);
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
  ctx.fillStyle = "#fff";
  ctx.fillText(previewRowNum, MARGIN - 26, BOARD_Y + MARGIN - TILE + TILE / 2);
  ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

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
  const invStatus = promotingMode ? "Select a Pawn to promote" : anyPromotingMode ? (anyPromotingPieceIdx >= 0 ? "Choose a piece type" : "Select a piece to promote") : kingPromotingMode ? "Select a Pawn to crown as King" : clonerMode ? (clonerSelected >= 0 ? "Select adjacent empty space" : "Select a piece to clone") : upgraderMode ? "Select a piece to upgrade" : teleporterMode ? (teleporterSelected >= 0 ? "Select destination" : "Select a piece to teleport") : bombMode ? "Select blast center" : "";
  ctx.fillStyle = invStatus ? "#ffdd88" : "#fff";
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(invStatus || "INVENTORY", INV_X + INV_W / 2, invY - 25);
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const slotIdx = r * INV_COLS + c;
      const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
      const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
      const isActive = (promotingMode || anyPromotingMode || teleporterMode || kingPromotingMode || clonerMode || upgraderMode) && inventory._activeSlot === slotIdx;
      ctx.fillStyle = isActive ? "#4a3a1e" : "#1a1a3e";
      ctx.beginPath();
      ctx.roundRect(sx, sy, INV_SLOT, INV_SLOT, 4);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = "#e8a735";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (dragSlot === slotIdx) { /* skip â€" item is being dragged */ } else
      if (inventory[slotIdx] === ITEM_PROMOTER) {
        const img = spriteImages["item_promoter"];
        if (img && img.complete) {
          ctx.drawImage(img, sx + 4, sy + 4, INV_SLOT - 8, INV_SLOT - 8);
        }
      } else if (inventory[slotIdx] === ITEM_ANY_PROMOTER) {
        const img = spriteImages["item_any_promoter"];
        if (img && img.complete) {
          ctx.drawImage(img, sx + 4, sy + 4, INV_SLOT - 8, INV_SLOT - 8);
        }
      } else if (inventory[slotIdx] === ITEM_TELEPORTER) {
        const img = spriteImages["item_teleporter"];
        if (img && img.complete) {
          ctx.drawImage(img, sx + 4, sy + 4, INV_SLOT - 8, INV_SLOT - 8);
        }
      } else if (inventory[slotIdx] === ITEM_KING_PROMOTER) {
        const img = spriteImages["item_king_promoter"];
        if (img && img.complete) {
          ctx.drawImage(img, sx + 4, sy + 4, INV_SLOT - 8, INV_SLOT - 8);
        }
      } else if (inventory[slotIdx] === ITEM_CLONER) {
        const img = spriteImages["item_cloner"];
        if (img && img.complete) {
          ctx.drawImage(img, sx + 4, sy + 4, INV_SLOT - 8, INV_SLOT - 8);
        }
      } else if (inventory[slotIdx] === ITEM_UPGRADER) {
        const img = spriteImages["item_upgrader"];
        if (img && img.complete) {
          ctx.drawImage(img, sx + 4, sy + 4, INV_SLOT - 8, INV_SLOT - 8);
        }
      }
    }
  }



  // Floating drag item
  if (dragSlot >= 0 && inventory[dragSlot] !== ITEM_NONE) {
    const item = inventory[dragSlot];
    const key = item === ITEM_PROMOTER ? "item_promoter" : item === ITEM_ANY_PROMOTER ? "item_any_promoter" : item === ITEM_TELEPORTER ? "item_teleporter" : item === ITEM_KING_PROMOTER ? "item_king_promoter" : item === ITEM_CLONER ? "item_cloner" : "item_upgrader";
    const img = spriteImages[key];
    const ds = INV_SLOT;
    if (img && img.complete) ctx.drawImage(img, dragX - ds / 2, dragY - ds / 2, ds, ds);
  }

  // Buttons
  ctx.font = "bold 36px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (!gameOver && resignConfirm) {
    // Resign confirm replaces all buttons
    ctx.fillStyle = "#ddd";
    ctx.fillText("Are you sure?", canvas.width / 2, RESIGN_BTN.y - 6);
    const yesX = canvas.width / 2 - 70, noX = canvas.width / 2 + 20;
    const btnW = 50, btnH = 36;
    ctx.fillStyle = "#993333";
    ctx.beginPath(); ctx.roundRect(yesX, RESIGN_BTN.y, btnW, btnH, 6); ctx.fill();
    ctx.fillStyle = "#555";
    ctx.beginPath(); ctx.roundRect(noX, RESIGN_BTN.y, btnW, btnH, 6); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("YES", yesX + btnW / 2, RESIGN_BTN.y + btnH / 2);
    ctx.fillText("NO", noX + btnW / 2, RESIGN_BTN.y + btnH / 2);
  } else if (!gameOver && isItemActive()) {
    // Cancel and Trash buttons replace all other controls while an item is being used
    const halfW = BOARD_PX / 2 - BTN_GAP / 2;
    const btnH = 80;
    // Cancel (X)
    ctx.fillStyle = "#5a2a2a";
    ctx.beginPath(); ctx.roundRect(MARGIN, BTN_Y, halfW, btnH, 8); ctx.fill();
    ctx.fillStyle = "#ff8888";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("✕  CANCEL", MARGIN + halfW / 2, BTN_Y + btnH / 2);
    // Trash
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath(); ctx.roundRect(MARGIN + BOARD_PX / 2 + BTN_GAP / 2, BTN_Y, halfW, btnH, 8); ctx.fill();
    ctx.fillStyle = "#aaa";
    ctx.fillText("🗑  DISCARD", MARGIN + BOARD_PX / 2 + BTN_GAP / 2 + halfW / 2, BTN_Y + btnH / 2);
  } else if (!gameOver && gamePhase === 'setup') {
    // Die button (left) and Go button (right)
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#4a3a7a";
    ctx.beginPath(); ctx.roundRect(LEAP_BTN.x, LEAP_BTN.y, LEAP_BTN.w, LEAP_BTN.h, 6); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff"; ctx.font = "bold 36px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🎲 ROLL", LEAP_BTN.x + LEAP_BTN.w / 2, LEAP_BTN.y + LEAP_BTN.h / 2);

    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#2a6e3f";
    ctx.beginPath(); ctx.roundRect(PITCH_BTN.x, PITCH_BTN.y, PITCH_BTN.w, PITCH_BTN.h, 6); ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff"; ctx.font = "bold 36px sans-serif";
    ctx.fillText("▶ GO!", PITCH_BTN.x + PITCH_BTN.w / 2, PITCH_BTN.y + PITCH_BTN.h / 2);
  } else if (!gameOver && gamePhase === 'playing') {
    // Team Leap
    const canLeap = canTeamLeap();
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = canLeap ? LEAP_BTN_COLOR : LEAP_BTN_DISABLED;
    ctx.beginPath();
    ctx.roundRect(LEAP_BTN.x, LEAP_BTN.y, LEAP_BTN.w, LEAP_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = canLeap ? "#fff" : "#999";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("TEAM ADVANCE", LEAP_BTN.x + LEAP_BTN.w / 2, LEAP_BTN.y + LEAP_BTN.h / 2);
    ctx.font = "bold 36px sans-serif";

    // Pitch Shift
    const canShift = canManualPitchShift();
    const shiftHighlight = hintMove === "leap";
    const shiftUrgent = shiftCountdown <= 3;
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = shiftHighlight ? "#e8a735" : (shiftUrgent ? "#8a1a1a" : (canShift ? "#1a5a8a" : LEAP_BTN_DISABLED));
    ctx.beginPath();
    ctx.roundRect(PITCH_BTN.x, PITCH_BTN.y, PITCH_BTN.w, PITCH_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = canShift ? "#fff" : "#999";
    ctx.font = "bold 36px sans-serif";
    ctx.fillText("FIELD ADVANCE", PITCH_BTN.x + PITCH_BTN.w / 2, PITCH_BTN.y + PITCH_BTN.h / 2);
    // Auto-advance countdown below buttons
    ctx.font = "bold 36px sans-serif";
    ctx.fillStyle = shiftUrgent ? "#ff6666" : "#2255aa";
    ctx.textAlign = "center";
    const cdText = `FIELD AUTO-ADVANCES IN ${shiftCountdown} ${shiftCountdown === 1 ? 'TURN' : 'TURNS'}`;
    ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillStyle = shiftUrgent ? "#ff6666" : "#88bbff";
    ctx.fillText(cdText, MARGIN + BOARD_PX / 2, COUNTDOWN_Y);
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

    // Resign
    ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = 14; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#993333";
    ctx.beginPath();
    ctx.roundRect(RESIGN_BTN.x, RESIGN_BTN.y, RESIGN_BTN.w, RESIGN_BTN.h, 6);
    ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = "#fff";
    ctx.fillText("RESIGN", RESIGN_BTN.x + RESIGN_BTN.w / 2, RESIGN_BTN.y + RESIGN_BTN.h / 2);
  }


  // Game over overlay
  if (gameOver) {
    const boardCX = MARGIN + 4 * TILE, boardCY = BOARD_Y + MARGIN + 4 * TILE;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(MARGIN, BOARD_Y + MARGIN, BOARD_PX, BOARD_PX);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "bold 72px sans-serif";
    ctx.fillStyle = "#cc1111";
    ctx.fillText("GAME OVER", boardCX, boardCY - 40);
    ctx.font = "bold 72px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`TAKEN KINGS: ${score}`, boardCX, boardCY + 60);
    ctx.textBaseline = "alphabetic";
  }
  // Graveyard panels (hidden while using an item)
  if (!isItemActive() && gamePhase === 'playing') for (const [pool, isPlayer] of [[playerDead, true], [enemyDead, false]]) {
    const gx = isPlayer ? PLAYER_GRAVE_X : ENEMY_GRAVE_X;
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.shadowColor = "rgba(0,0,0,0.9)"; ctx.shadowBlur = 6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#fff";
    ctx.fillText(isPlayer ? "FALLEN" : "SLAIN", gx + GRAVE_W / 2, GRAVE_Y - 6);
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
        ctx.globalAlpha = 0.15;
        if (img && img.complete) ctx.drawImage(img, cx - pieceSz / 2, cy - pieceSz / 2, pieceSz, pieceSz);
        ctx.globalAlpha = 1;
      } else {
        if (isKing) {
          ctx.fillStyle = isPlayer ? "rgba(180,60,60,0.5)" : "rgba(60,160,60,0.5)";
          ctx.beginPath(); ctx.arc(cx, cy, pieceSz / 2 + 2, 0, Math.PI * 2); ctx.fill();
        }
        if (img && img.complete) ctx.drawImage(img, cx - pieceSz / 2, cy - pieceSz / 2, pieceSz, pieceSz);
        ctx.font = "bold 24px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center"; ctx.textBaseline = "top";
        ctx.fillText(`x${count}`, cx, cy + pieceSz / 2 + 4);
      }
    }
  }

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

  // Promoter piece chooser overlay
  if (promotingPawnIdx >= 0 || anyPromotingPieceIdx >= 0) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const targetIdx2 = promotingPawnIdx >= 0 ? promotingPawnIdx : anyPromotingPieceIdx;
    const [ptx, pty] = xy(targetIdx2);
    const pawnSX = MARGIN + ptx * TILE + TILE / 2;
    const pawnSY = BOARD_Y + MARGIN + pty * TILE + TILE / 2;

    const dlgW = 600, dlgH = 200, dlgGap = 18;
    const dlgX = (canvas.width - dlgW) / 2;
    // Place dialogue above pawn if pawn is in lower half, below if in upper half
    const placeAbove = pty >= 4;
    const dlgY = placeAbove
      ? Math.max(LOGO_H, pawnSY - TILE / 2 - dlgGap - dlgH)
      : Math.min(canvas.height - dlgH - 10, pawnSY + TILE / 2 + dlgGap);

    // Arrow between dialogue and pawn
    const arrowX = Math.max(dlgX + 20, Math.min(dlgX + dlgW - 20, pawnSX));
    const arrowTailY = placeAbove ? dlgY + dlgH : dlgY;
    const arrowTipY  = placeAbove ? pawnSY - TILE / 2 - 4 : pawnSY + TILE / 2 + 4;
    const arrowDir   = placeAbove ? 1 : -1; // +1 = tip points down, -1 = tip points up
    ctx.strokeStyle = "#aaa"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(arrowX, arrowTailY); ctx.lineTo(arrowX, arrowTipY); ctx.stroke();
    ctx.fillStyle = "#aaa";
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowTipY);
    ctx.lineTo(arrowX - 8, arrowTipY - arrowDir * 14);
    ctx.lineTo(arrowX + 8, arrowTipY - arrowDir * 14);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = "#2a2a4e";
    ctx.beginPath(); ctx.roundRect(dlgX, dlgY, dlgW, dlgH, 10); ctx.fill();
    ctx.fillStyle = "#ddd";
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("Promote to:", dlgX + dlgW / 2, dlgY + 36);
    const choices = [ROOK, KNIGHT, BISHOP, QUEEN];
    const cpad = 16, csize = 100;
    const startX = dlgX + (dlgW - choices.length * (csize + cpad) + cpad) / 2;
    for (let i = 0; i < choices.length; i++) {
      const cx = startX + i * (csize + cpad);
      const cy = dlgY + 70;
      ctx.fillStyle = "#3a3a5e";
      ctx.beginPath(); ctx.roundRect(cx, cy, csize, csize, 8); ctx.fill();
      const img = spriteImages[`${W}_${choices[i]}`];
      if (img && img.complete) ctx.drawImage(img, cx + 8, cy + 8, csize - 16, csize - 16);
    }
  }

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
    ctx.font = "bold 36px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("SHOP", dlgX + dlgW / 2, dlgY + 45);
    ctx.fillStyle = "#aaa";
    ctx.fillText(`Gold: ${gold}`, dlgX + dlgW / 2, dlgY + 88);

    const cardW = 220, cardH = 300, cardGap = 20;
    const cardsStartX = dlgX + (dlgW - 3 * cardW - 2 * cardGap) / 2;
    const cardsY = dlgY + 120;

    const shopSold = specialSpaces[shopSpaceIdx].sold;
    for (let i = 0; i < shopOffers.length; i++) {
      const item = shopOffers[i];
      const price = ITEM_PRICES[item];
      const cardX = cardsStartX + i * (cardW + cardGap);
      const isSold = shopSold[i];
      const canAfford = !isSold && gold >= price;

      ctx.fillStyle = isSold ? "#161622" : (canAfford ? "#2a2a52" : "#1e1e30");
      ctx.beginPath(); ctx.roundRect(cardX, cardsY, cardW, cardH, 8); ctx.fill();
      if (canAfford) {
        ctx.strokeStyle = "rgba(255,200,50,0.3)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(cardX, cardsY, cardW, cardH, 8); ctx.stroke();
      }

      const simg = spriteImages[ITEM_SPRITE_KEYS[item]];
      if (simg && simg.complete) {
        ctx.globalAlpha = isSold ? 0.25 : 1.0;
        ctx.drawImage(simg, cardX + (cardW - 90) / 2, cardsY + 16, 90, 90);
        ctx.globalAlpha = 1.0;
      }

      ctx.fillStyle = isSold ? "#444" : "#ddd";
      ctx.font = "bold 36px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const name = ITEM_NAMES[item];
      const words = name.split(" ");
      if (words.length > 1) {
        const mid = Math.ceil(words.length / 2);
        ctx.fillText(words.slice(0, mid).join(" "), cardX + cardW / 2, cardsY + 130);
        ctx.fillText(words.slice(mid).join(" "), cardX + cardW / 2, cardsY + 168);
      } else {
        ctx.fillText(name, cardX + cardW / 2, cardsY + 149);
      }

      ctx.fillStyle = isSold ? "#444" : (canAfford ? "#f0c040" : "#666");
      ctx.font = "bold 36px sans-serif";
      ctx.fillText(isSold ? "-" : `${price} G`, cardX + cardW / 2, cardsY + 210);

      ctx.fillStyle = (isSold || !canAfford) ? "#2a2a2a" : "#3a6a3a";
      ctx.beginPath(); ctx.roundRect(cardX + 14, cardsY + cardH - 54, cardW - 28, 44, 6); ctx.fill();
      ctx.fillStyle = (isSold || !canAfford) ? "#555" : "#fff";
      ctx.font = "bold 36px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(isSold ? "Sold" : "Buy", cardX + cardW / 2, cardsY + cardH - 54 + 22);
    }

    // Close button
    const closeBtnX = dlgX + dlgW - 130, closeBtnY = dlgY + dlgH - 58;
    ctx.fillStyle = "#4a2a2a";
    ctx.beginPath(); ctx.roundRect(closeBtnX, closeBtnY, 110, 44, 6); ctx.fill();
    ctx.fillStyle = "#ddd";
    ctx.font = "bold 36px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Close", closeBtnX + 55, closeBtnY + 22);
  }

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
  if (gameOver || anim || turn !== W || aiThinking || shopMode) return;
  const [cx, cy] = canvasCoords(e);
  const invY = INV_PANEL_TOP + 50;
  for (let r = 0; r < INV_ROWS; r++) {
    for (let c = 0; c < INV_COLS; c++) {
      const slotIdx = r * INV_COLS + c;
      if (inventory[slotIdx] === ITEM_NONE) continue;
      const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
      const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
      if (cx >= sx && cx <= sx + INV_SLOT && cy >= sy && cy <= sy + INV_SLOT) {
        dragSlot = slotIdx;
        dragX = cx; dragY = cy; dragOverTrash = false;
        draw();
        return;
      }
    }
  }
});

canvas.addEventListener("mousemove", (e) => {
  if (bombMode) {
    const [cx, cy] = canvasCoords(e);
    const gx = Math.floor((cx - MARGIN) / TILE), gy = Math.floor((cy - BOARD_Y - MARGIN) / TILE);
    const newHover = inB(gx, gy) ? idx(gx, gy) : -1;
    if (newHover !== bombHoverIdx) { bombHoverIdx = newHover; draw(); }
  }
  if (dragSlot < 0) return;
  const [cx, cy] = canvasCoords(e);
  dragX = cx; dragY = cy;
  const tb = trashBounds();
  dragOverTrash = cx >= tb.x && cx <= tb.x + tb.w && cy >= tb.y && cy <= tb.y + tb.h;
  draw();
});

canvas.addEventListener("mouseup", (e) => {
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

    if (item === ITEM_PROMOTER && board[i] === PAWN && sides[i] === W) {
      promotingMode = true; promotingPawnIdx = i;
      selected = -1; validMoves = [];
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_ANY_PROMOTER && sides[i] === W && board[i] !== NONE && board[i] !== KING) {
      anyPromotingMode = true; anyPromotingPieceIdx = i;
      selected = -1; validMoves = [];
      dragConsumed = true; draw(); return;
    }
    if (item === ITEM_KING_PROMOTER && board[i] === PAWN && sides[i] === W) {
      board[i] = KING;
      removeFromInventory(slot); delete inventory._activeSlot;
      kingPromotingMode = false;
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

canvas.addEventListener("click", (e) => {
  if (dragConsumed) { dragConsumed = false; return; }
  if (gameOver) return;
  if (anim) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  // Shop dialogue
  if (shopMode) {
    const dlgW = 820, dlgH = 500, dlgX = (canvas.width - 820) / 2, dlgY = (canvas.height - 500) / 2;
    const cardW = 220, cardH = 300, cardGap = 20;
    const cardsStartX = dlgX + (dlgW - 3 * cardW - 2 * cardGap) / 2;
    const cardsY = dlgY + 120;
    for (let i = 0; i < shopOffers.length; i++) {
      const price = ITEM_PRICES[shopOffers[i]];
      const cardX = cardsStartX + i * (cardW + cardGap);
      const btnX = cardX + 14, btnY = cardsY + cardH - 54, btnW = cardW - 28, btnH = 44;
      const sold = specialSpaces[shopSpaceIdx].sold[i];
      if (cx >= btnX && cx <= btnX + btnW && cy >= btnY && cy <= btnY + btnH && gold >= price && !sold) {
        gold -= price;
        addToInventory(shopOffers[i]);
        specialSpaces[shopSpaceIdx].sold[i] = true;
        draw();
        return;
      }
    }
    // Close button or outside-dialog click
    const closeBtnX = dlgX + dlgW - 130, closeBtnY = dlgY + dlgH - 58, closeBtnW = 110, closeBtnH = 44;
    if ((cx >= closeBtnX && cx <= closeBtnX + closeBtnW && cy >= closeBtnY && cy <= closeBtnY + closeBtnH) ||
        cx < dlgX || cx > dlgX + dlgW || cy < dlgY || cy > dlgY + dlgH) {
      closeShop();
    }
    return;
  }

  // Piece chooser dialog (shared by Pawn Promoter and Any Promoter)
  if (promotingPawnIdx >= 0 || anyPromotingPieceIdx >= 0) {
    const targetIdx = promotingPawnIdx >= 0 ? promotingPawnIdx : anyPromotingPieceIdx;
    const choices = [ROOK, KNIGHT, BISHOP, QUEEN];
    const dlgW = 600, dlgH = 200, dlgGap = 18;
    const dlgX = (canvas.width - dlgW) / 2;
    const [ptx2, pty2] = xy(targetIdx);
    const pawnSY2 = BOARD_Y + MARGIN + pty2 * TILE + TILE / 2;
    const placeAbove2 = pty2 >= 4;
    const dlgY = placeAbove2
      ? Math.max(LOGO_H, pawnSY2 - TILE / 2 - dlgGap - dlgH)
      : Math.min(canvas.height - dlgH - 10, pawnSY2 + TILE / 2 + dlgGap);
    const cpad = 16, csize = 100;
    const startX = dlgX + (dlgW - choices.length * (csize + cpad) + cpad) / 2;
    for (let i = 0; i < choices.length; i++) {
      const bx = startX + i * (csize + cpad);
      const by = dlgY + 70;
      if (cx >= bx && cx <= bx + csize && cy >= by && cy <= by + csize) {
        board[targetIdx] = choices[i];
        if (inventory._activeSlot !== undefined) {
          removeFromInventory(inventory._activeSlot);
          delete inventory._activeSlot;
        }
        const fromSpace = activeItemSpaceIdx >= 0;
        activeItemSpaceIdx = -1;
        promotingPawnIdx = -1; promotingMode = false;
        anyPromotingPieceIdx = -1; anyPromotingMode = false;
        if (fromSpace) { processNextQueuedItem(); } else { draw(); }
        return;
      }
    }
    // Click outside cancels
    const fromSpaceCancel = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1;
    promotingPawnIdx = -1; promotingMode = false;
    anyPromotingPieceIdx = -1; anyPromotingMode = false;
    if (fromSpaceCancel) { processNextQueuedItem(); } else { draw(); }
    return;
  }

  // Pawn selection for Pawn Promoter
  if (promotingMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    if (inB(gx, gy) && board[idx(gx, gy)] === PAWN && sides[idx(gx, gy)] === W) {
      promotingPawnIdx = idx(gx, gy);
      draw();
      return;
    }
    // Click elsewhere cancels
    promotingMode = false;
    draw();
    return;
  }

  // Any piece selection for Any Promoter
  if (anyPromotingMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    if (inB(gx, gy) && sides[idx(gx, gy)] === W && board[idx(gx, gy)] !== NONE && board[idx(gx, gy)] !== KING) {
      anyPromotingPieceIdx = idx(gx, gy);
      draw();
      return;
    }
    // Click elsewhere cancels
    anyPromotingMode = false;
    draw();
    return;
  }

  // Upgrader
  if (upgraderMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    if (inB(gx, gy) && sides[idx(gx, gy)] === W) {
      const i = idx(gx, gy);
      health[i] = Math.max(health[i], 1) + 1;
      if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
      upgraderMode = false;
      draw();
      return;
    }
    upgraderMode = false;
    if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
    draw();
    return;
  }

  // Bomb
  if (bombMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    bombMode = false; bombHoverIdx = -1;
    if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
    if (inB(gx, gy)) {
      detonateBomb(idx(gx, gy));
      firstMoveMade = true; recordPosition();
      if (!gameOver) endWhiteTurn(); else draw();
    } else { draw(); }
    return;
  }

  // Cloner
  if (clonerMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    if (inB(gx, gy)) {
      const i = idx(gx, gy);
      if (clonerSelected < 0) {
        if (sides[i] === W && adjacentClonerDests(i).length > 0) {
          clonerSelected = i;
          draw();
          return;
        }
      } else {
        const dests = adjacentClonerDests(clonerSelected);
        if (dests.includes(i)) {
          if (board[i] === CHEST) addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER, ITEM_BOMB][randInt(7)]);
          board[i] = board[clonerSelected];
          sides[i] = W;
          health[i] = health[clonerSelected];
          if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
          const clonerFromSpace = activeItemSpaceIdx >= 0;
          activeItemSpaceIdx = -1;
          clonerMode = false; clonerSelected = -1;
          if (clonerFromSpace) {
            processNextQueuedItem();
          } else {
            firstMoveMade = true; recordPosition(); draw();
          }
          return;
        } else if (sides[i] === W && adjacentClonerDests(i).length > 0) {
          clonerSelected = i;
          draw();
          return;
        }
      }
    }
    const clonerCancelSpace = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1;
    clonerMode = false; clonerSelected = -1;
    if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
    if (clonerCancelSpace) { processNextQueuedItem(); } else { draw(); }
    return;
  }

  // King Promoter â€" select a white pawn, convert to King
  if (kingPromotingMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    if (inB(gx, gy) && board[idx(gx, gy)] === PAWN && sides[idx(gx, gy)] === W) {
      board[idx(gx, gy)] = KING;
      if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
      kingPromotingMode = false;
      draw();
      return;
    }
    kingPromotingMode = false;
    if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
    draw();
    return;
  }

  // Teleporter
  if (teleporterMode) {
    const mx = cx - MARGIN;
    const my = cy - BOARD_Y - MARGIN;
    const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
    if (inB(gx, gy)) {
      const i = idx(gx, gy);
      if (teleporterSelected < 0) {
        // Select a white piece
        if (sides[i] === W) {
          teleporterSelected = i;
          draw();
          return;
        }
      } else {
        // Move to vacant square or chest
        if (board[i] === NONE || board[i] === CHEST) {
          if (board[i] === CHEST) addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_UPGRADER][randInt(4)]);
          const _tPiece0 = board[teleporterSelected], _tHlth0 = health[teleporterSelected];
          board[i] = _tPiece0; sides[i] = W; health[i] = _tHlth0;
          board[teleporterSelected] = NONE; sides[teleporterSelected] = 0; health[teleporterSelected] = 1;
          if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
          const fromSpace = activeItemSpaceIdx >= 0;
          activeItemSpaceIdx = -1;
          teleporterMode = false; teleporterSelected = -1;
          // Apply special space effects at landing square
          const _tHops = computeObstacleHops(i);
          const _tFinalI = applySpecialSpace(i);
          const _tPiece = board[_tFinalI] || _tPiece0, _tHlth = health[_tFinalI] || _tHlth0;
          const _tFinish = () => {
            checkWhiteKingAlive();
            if (gameOver) { draw(); return; }
            if (fromSpace) {
              processNextQueuedItem();
            } else {
              firstMoveMade = true; recordPosition();
              const continueAfterShop = () => {
                const itm = itemSpaces[_tFinalI];
                if (itm !== ITEM_NONE && sides[_tFinalI] === W && canItemAffectPiece(itm, _tFinalI)) {
                  const done = activateItemSpace(itm, _tFinalI);
                  if (done) endWhiteTurn();
                } else { endWhiteTurn(); }
              };
              if (specialSpaces[_tFinalI]?.type === 'shop' && sides[_tFinalI] === W) {
                openShop(_tFinalI, continueAfterShop);
              } else { continueAfterShop(); }
            }
          };
          const _tDoHop = (hi) => {
            if (hi >= _tHops.length) {
              if (isVoidSpace(_tFinalI) && _tPiece !== NONE) {
                // Piece still on board if it landed directly on void (applySpecialSpace only clears arrow→void)
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
        } else if (sides[i] === W) {
          // Re-select a different white piece
          teleporterSelected = i;
          draw();
          return;
        }
      }
    }
    // Click outside board or invalid target cancels
    const teleFromSpace = activeItemSpaceIdx >= 0;
    activeItemSpaceIdx = -1;
    teleporterMode = false; teleporterSelected = -1;
    if (inventory._activeSlot !== undefined) delete inventory._activeSlot;
    if (teleFromSpace) { processNextQueuedItem(); } else { draw(); }
    return;
  }

  // Resign confirm dialog
  if (resignConfirm) {
    const yesX = canvas.width / 2 - 70, noX = canvas.width / 2 + 20;
    const btnY = RESIGN_BTN.y, btnW = 50, btnH = 36;
    if (cx >= yesX && cx <= yesX + btnW && cy >= btnY && cy <= btnY + btnH) {
      resignConfirm = false;
      gameOver = true;
      gameMsg = `Resigned. Kings Taken: ${score}`;
      selected = -1; validMoves = [];
      draw();
    } else if (cx >= noX && cx <= noX + btnW && cy >= btnY && cy <= btnY + btnH) {
      resignConfirm = false;
      draw();
    }
    return;
  }

  // Cancel / Trash buttons (shown while item is active)
  if (!gameOver && isItemActive()) {
    const halfW = BOARD_PX / 2 - BTN_GAP / 2;
    const btnH = 80;
    if (cx >= MARGIN && cx <= MARGIN + halfW && cy >= BTN_Y && cy <= BTN_Y + btnH) {
      cancelItemMode(); return;
    }
    if (cx >= MARGIN + BOARD_PX / 2 + BTN_GAP / 2 && cx <= MARGIN + BOARD_PX && cy >= BTN_Y && cy <= BTN_Y + btnH) {
      trashActiveItem(); return;
    }
  }

  // Check resign button
  if (!gameOver && cx >= RESIGN_BTN.x && cx <= RESIGN_BTN.x + RESIGN_BTN.w &&
      cy >= RESIGN_BTN.y && cy <= RESIGN_BTN.y + RESIGN_BTN.h) {
    resignConfirm = true;
    draw();
    return;
  }

  // Check inventory click
  if (turn === W && !aiThinking) {
    const invY = INV_PANEL_TOP + 50;
    for (let r = 0; r < INV_ROWS; r++) {
      for (let c = 0; c < INV_COLS; c++) {
        const slotIdx = r * INV_COLS + c;
        const sx = INV_X + INV_PAD + c * (INV_SLOT + INV_PAD);
        const sy = invY + INV_PAD + r * (INV_SLOT + INV_PAD);
        if (cx >= sx && cx <= sx + INV_SLOT && cy >= sy && cy <= sy + INV_SLOT) {
          if (inventory[slotIdx] === ITEM_PROMOTER) {
            promotingMode = true;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
          if (inventory[slotIdx] === ITEM_ANY_PROMOTER) {
            anyPromotingMode = true;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
          if (inventory[slotIdx] === ITEM_TELEPORTER) {
            teleporterMode = true;
            teleporterSelected = -1;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
          if (inventory[slotIdx] === ITEM_CLONER) {
            clonerMode = true;
            clonerSelected = -1;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
          if (inventory[slotIdx] === ITEM_KING_PROMOTER) {
            kingPromotingMode = true;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
          if (inventory[slotIdx] === ITEM_UPGRADER) {
            upgraderMode = true;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
          if (inventory[slotIdx] === ITEM_BOMB) {
            bombMode = true; bombHoverIdx = -1;
            selected = -1; validMoves = [];
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
        }
      }
    }
  }

  // Check hint button (test mode only)
  if (testMode && cx >= HINT_BTN.x && cx <= HINT_BTN.x + HINT_BTN.w &&
      cy >= HINT_BTN.y && cy <= HINT_BTN.y + HINT_BTN.h) {
    showHint();
    return;
  }


  // Setup lobby buttons
  if (gamePhase === 'setup') {
    if (cx >= LEAP_BTN.x && cx <= LEAP_BTN.x + LEAP_BTN.w &&
        cy >= LEAP_BTN.y && cy <= LEAP_BTN.y + LEAP_BTN.h) {
      rollSetup(); draw(); return;
    }
    if (cx >= PITCH_BTN.x && cx <= PITCH_BTN.x + PITCH_BTN.w &&
        cy >= PITCH_BTN.y && cy <= PITCH_BTN.y + PITCH_BTN.h) {
      startGame(); return;
    }
    return;
  }

  // Check leap button
  if (cx >= LEAP_BTN.x && cx <= LEAP_BTN.x + LEAP_BTN.w &&
      cy >= LEAP_BTN.y && cy <= LEAP_BTN.y + LEAP_BTN.h) {
    hintMove = null;
    teamLeap();
    return;
  }

  // Check pitch shift button
  if (cx >= PITCH_BTN.x && cx <= PITCH_BTN.x + PITCH_BTN.w &&
      cy >= PITCH_BTN.y && cy <= PITCH_BTN.y + PITCH_BTN.h) {
    hintMove = null;
    if (canManualPitchShift()) pitchShift();
    return;
  }

  if (aiThinking || turn !== W) return;
  hintMove = null;
  const mx = cx - MARGIN;
  const my = cy - BOARD_Y - MARGIN;
  const gx = Math.floor(mx / TILE), gy = Math.floor(my / TILE);
  if (!inB(gx, gy)) { selected = -1; validMoves = []; draw(); return; }

  const clicked = idx(gx, gy);

  if (selected < 0) {
    if (sides[clicked] === W) {
      selected = clicked;
      validMoves = legalMoves(gx, gy);
    }
  } else {
    if (validMoves.includes(clicked)) {
      const [pfx, pfy] = xy(selected), [ptx, pty] = xy(clicked);
      const pFromCX = MARGIN + pfx * TILE, pFromCY = BOARD_Y + MARGIN + pfy * TILE;
      const pToCX = MARGIN + ptx * TILE, pToCY = BOARD_Y + MARGIN + pty * TILE;
      const isCKS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && ptx === 6 && !wkMoved;
      const isCQS = board[selected] === KING && sides[selected] === W && pfx === 4 && pfy === 7 && ptx === 2 && !wkMoved;
      const clickedDest = clicked;
      firstMoveMade = true;
      makeMove(selected, clicked, true);
      recordPosition();
      const wAnimPieces = [{
        toIdx: clickedDest,
        fromCX: pFromCX, fromCY: pFromCY, toCX: pToCX, toCY: pToCY,
        piece: board[clickedDest], side: sides[clickedDest], hlth: health[clickedDest]
      }];
      if (isCKS) wAnimPieces.push({ toIdx: idx(5,7), fromCX: MARGIN+7*TILE, fromCY: BOARD_Y+MARGIN+7*TILE, toCX: MARGIN+5*TILE, toCY: BOARD_Y+MARGIN+7*TILE, piece: ROOK, side: W, hlth: health[idx(5,7)] });
      if (isCQS) wAnimPieces.push({ toIdx: idx(3,7), fromCX: MARGIN+0*TILE, fromCY: BOARD_Y+MARGIN+7*TILE, toCX: MARGIN+3*TILE, toCY: BOARD_Y+MARGIN+7*TILE, piece: ROOK, side: W, hlth: health[idx(3,7)] });
      selected = -1; validMoves = [];
      const _wHops = computeObstacleHops(clickedDest);
      // Snapshot captures at each hop destination before applySpecialSpace clears them
      const _wHopCaptures = {};
      for (const [, tI] of _wHops) {
        if (board[tI] !== NONE && board[tI] !== CHEST && sides[tI] !== W) {
          _wHopCaptures[tI] = { piece: board[tI], side: sides[tI] };
          pendingCaptures[tI] = _wHopCaptures[tI]; // keep rendering until hop arrives
        }
      }
      const _wPiece0 = board[clickedDest], _wSide0 = sides[clickedDest], _wHlth0 = health[clickedDest];
      const _wFinalI = applySpecialSpace(clickedDest);
      const _wPiece = board[_wFinalI] || _wPiece0, _wSide = sides[_wFinalI] || _wSide0, _wHlth = health[_wFinalI] || _wHlth0;
      // Update wAnimPieces toIdx to point to where piece actually ends up
      wAnimPieces[0].toIdx = _wFinalI;
      wAnimPieces[0].piece = _wPiece; wAnimPieces[0].side = _wSide; wAnimPieces[0].hlth = _wHlth;
      const _wContinue = (movedTo) => {
        pendingCaptures = {};
        checkWhiteKingAlive();
        if (!gameOver) {
          const continueAfterShop = () => {
            const item = itemSpaces[movedTo];
            if (item !== ITEM_NONE && sides[movedTo] === W && canItemAffectPiece(item, movedTo)) {
              const done = activateItemSpace(item, movedTo);
              if (done) endWhiteTurn();
            } else {
              endWhiteTurn();
            }
          };
          if (specialSpaces[movedTo]?.type === 'shop' && sides[movedTo] === W) {
            openShop(movedTo, continueAfterShop);
          } else {
            continueAfterShop();
          }
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
          // Hop arrived — remove pending capture overlay and fly it to graveyard
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
        if (!gameOver) { _wDoHop(0); } else { draw(); }
      });
      return;
    } else if (sides[clicked] === W) {
      selected = clicked;
      validMoves = legalMoves(gx, gy);
    } else {
      selected = -1; validMoves = [];
    }
  }
  draw();
});

initBoard();
loadSprites();

window.setupTest = function(preset) {
  if (preset === 'teleporter_void') {
    itemSpaces[idx(3, 5)] = ITEM_TELEPORTER;
    specialSpaces[idx(5, 5)] = { type: 'void' };
    draw();
  }
};


