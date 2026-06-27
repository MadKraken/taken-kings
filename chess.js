const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const TILE = 80;
const MARGIN = 32;
const LOGO_H = 135;
const PREVIEW_H = 60;
const BOARD_PX = TILE * 8;
const INV_COLS = 2, INV_ROWS = 4, INV_SLOT = 50, INV_PAD = 4;
const INV_W = INV_COLS * (INV_SLOT + INV_PAD) + INV_PAD;
const INV_X = BOARD_PX + MARGIN * 2 + 10;
canvas.width = INV_X + INV_W + 10;
canvas.height = LOGO_H + PREVIEW_H + BOARD_PX + MARGIN * 2 + 130;

const LIGHT = "#edcea0";
const DARK = "#b5855a";
const SEL_COLOR = "rgba(50,120,200,0.5)";
const MOVE_COLOR = "rgba(100,180,60,0.55)";
const LEAP_BTN_COLOR = "#2a6e3f";
const LEAP_BTN_DISABLED = "#555";

const NONE = 0, PAWN = 1, ROOK = 2, KNIGHT = 3, BISHOP = 4, QUEEN = 5, KING = 6, CHEST = 7;
const W = 1, B = 2;

const PIECE_NAMES = { [PAWN]: "pawn", [ROOK]: "rook", [KNIGHT]: "knight", [BISHOP]: "bishop", [QUEEN]: "queen", [KING]: "king" };
const SIDE_PREFIX = { [W]: "w", [B]: "b" };
const spriteImages = {};
let spritesLoaded = false;

function loadSprites() {
  let count = 0;
  const total = 20;
  const logoImg = new Image();
  logoImg.src = "taken_kings_logo.png?v=2";
  logoImg.onload = () => {
    spriteImages["logo"] = logoImg;
    count++; if (count === total) { spritesLoaded = true; draw(); }
  };
  for (const s of [W, B]) {
    for (const p of [PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING]) {
      const key = `${s}_${p}`;
      const img = new Image();
      img.src = `sprites/${SIDE_PREFIX[s]}_${PIECE_NAMES[p]}.svg`;
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
const ITEM_NONE = 0, ITEM_PROMOTER = 1, ITEM_ANY_PROMOTER = 3, ITEM_TELEPORTER = 4, ITEM_KING_PROMOTER = 5, ITEM_CLONER = 6, ITEM_UPGRADER = 7;
const ITEM_NAMES = { [ITEM_PROMOTER]: "Pawn Promoter", [ITEM_ANY_PROMOTER]: "All Promoter", [ITEM_TELEPORTER]: "Teleporter", [ITEM_KING_PROMOTER]: "Promoter To King", [ITEM_CLONER]: "Cloner", [ITEM_UPGRADER]: "Upgrader" };
let inventory = new Array(INV_COLS * INV_ROWS).fill(ITEM_NONE);
let promotingMode = false;
let promotingPawnIdx = -1;
let anyPromotingMode = false;
let anyPromotingPieceIdx = -1;
let teleporterMode = false;
let teleporterSelected = -1;
let kingPromotingMode = false;
let clonerMode = false;
let clonerSelected = -1;
let upgraderMode = false;
let shiftCountdown = 10;
let itemSpaces = new Array(64).fill(ITEM_NONE);

let activeItemSpaceIdx = -1; // item space currently pending interactive resolution
let pendingItemQueue = []; // {item, i} pairs queued after a Team Advance
let specialSpaces = new Array(64).fill(null); // {type:'obstacle', dx, dy}

const ITEM_SPRITE_KEYS = {
  [ITEM_PROMOTER]: "item_promoter",
  [ITEM_ANY_PROMOTER]: "item_any_promoter",
  [ITEM_TELEPORTER]: "item_teleporter",
  [ITEM_KING_PROMOTER]: "item_king_promoter",
  [ITEM_CLONER]: "item_cloner",
  [ITEM_UPGRADER]: "item_upgrader"
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

function idx(x, y) { return y * 8 + x; }
function xy(i) { return [i % 8, Math.floor(i / 8)]; }
function inB(x, y) { return x >= 0 && x < 8 && y >= 0 && y < 8; }
function piece(x, y) { return inB(x, y) ? board[idx(x, y)] : NONE; }
function side(x, y) { return inB(x, y) ? sides[idx(x, y)] : 0; }
function set(x, y, p, s) { board[idx(x, y)] = p; sides[idx(x, y)] = s; }
function enemy(s) { return s === W ? B : W; }

function randInt(n) { return Math.floor(Math.random() * n); }

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
  // count=1 → 1 piece (opening row); count≥2 → starts at 2, +1 every 5 rows, max 7
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
    if (randInt(8) !== 0) continue;
    const type = ['chest', 'item', 'obstacle'][randInt(3)];
    if (type === 'chest') {
      bonuses.push({ type: 'chest', col: x });
    } else if (type === 'item') {
      const items = [ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER];
      bonuses.push({ type: 'item', col: x, item: items[randInt(items.length)] });
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

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function initBoard() {
  board.fill(NONE); sides.fill(0);
  const back = [ROOK, KNIGHT, BISHOP, QUEEN, KING, BISHOP, KNIGHT, ROOK];
  for (let x = 0; x < 8; x++) {
    set(x, 6, PAWN, W);
    set(x, 7, back[x], W);
  }
  spawnCount = 1;
  const firstWave = generateWave(spawnCount);
  placeWave(0, firstWave);
  nextWave = generateWave(spawnCount + 1);
  leapCount = 0;
  nextBonuses = generateRowBonuses(nextWave);
  selected = -1; validMoves = []; turn = W;
  gameOver = false; gameMsg = ""; score = 0; gold = 0;
  firstMoveMade = false; positionHistory = []; testMode = false;
  inventory.fill(ITEM_NONE); promotingMode = false; promotingPawnIdx = -1; anyPromotingMode = false; anyPromotingPieceIdx = -1; teleporterMode = false; teleporterSelected = -1; kingPromotingMode = false; clonerMode = false; clonerSelected = -1; upgraderMode = false;
  health.fill(1); shiftCountdown = 10;
  itemSpaces.fill(ITEM_NONE);
  pendingItemQueue = [];
  specialSpaces.fill(null);
  wkMoved = false; wraMoved = false; wrhMoved = false;
  epTarget = -1;
}



function slidingMoves(moves, x, y, dirs, s) {
  for (const [dx, dy] of dirs) {
    let nx = x + dx, ny = y + dy;
    while (inB(nx, ny)) {
      if (side(nx, ny) === s) break;
      if (s === B && piece(nx, ny) === CHEST) break;
      moves.push(idx(nx, ny));
      if (piece(nx, ny) !== NONE) break;
      nx += dx; ny += dy;
    }
  }
}

function pseudoMoves(x, y) {
  const moves = [];
  const p = piece(x, y), s = side(x, y), e = enemy(s);
  if (p === PAWN) {
    if (s === W) {
      // White pawns move and capture upward only (toward row 0)
      const dir = -1;
      const fwd = piece(x, y + dir);
      if (inB(x, y + dir) && (fwd === NONE || fwd === CHEST)) {
        moves.push(idx(x, y + dir));
        if (y === 6 && fwd === NONE && piece(x, y - 2) === NONE) moves.push(idx(x, y - 2));
      }
      for (const dx of [-1, 1]) {
        const nx = x + dx, ny = y + dir;
        if (inB(nx, ny)) {
          if (side(nx, ny) === e) moves.push(idx(nx, ny));
          else if (idx(nx, ny) === epTarget) moves.push(idx(nx, ny));
        }
      }
    } else {
      // Black pawns move down; can move two squares from row 0 (first turn after entering)
      const dir = 1;
      if (inB(x, y + dir) && piece(x, y + dir) === NONE) {
        moves.push(idx(x, y + dir));
        if (y === 0 && piece(x, y + 2) === NONE) moves.push(idx(x, y + 2));
      }
      for (const dx of [-1, 1]) {
        const nx = x + dx, ny = y + dir;
        if (inB(nx, ny) && side(nx, ny) === e && piece(nx, ny) !== CHEST) moves.push(idx(nx, ny));
      }
    }
  } else if (p === KNIGHT) {
    for (const [dx, dy] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && piece(nx, ny) === CHEST)) moves.push(idx(nx, ny));
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
      if (inB(nx, ny) && side(nx, ny) !== s && !(s === B && piece(nx, ny) === CHEST)) moves.push(idx(nx, ny));
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
  // White has no check restriction — all pseudo-legal moves are legal.
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

function makeMove(fromI, toI) {
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const p = board[fromI], s = sides[fromI];
  const captured = board[toI];

  // Bounce: black piece attacks white piece with health > 1 — damage but no capture
  if (s === B && sides[toI] === W && health[toI] > 1) {
    health[toI]--;
    const bounceI = calcBouncePos(fromI, toI, p);
    if (bounceI !== fromI) {
      board[bounceI] = p; sides[bounceI] = B;
      board[fromI] = NONE; sides[fromI] = 0;
    }
    return;
  }

  if (captured !== NONE && captured !== CHEST && sides[toI] !== s && s === W) {
    gold += GOLD_VALUE[captured] ?? 0;
  }
  if (captured === KING && sides[toI] !== s) {
    score += 1;
  }
  if (captured === CHEST && s === W) {
    addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER][randInt(6)]);
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
    if (epPiece === KING) score += 1;
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
    turn = B;
    draw();
    if (!gameOver) aiPlay();
  }
}

// --- Team Leap & Pitch Shift ---

function canTeamLeap() {
  return !(gameOver || turn !== W || aiThinking);
}

function teamLeap() {
  if (gameOver || turn !== W || aiThinking) return;

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
      if (y === 0 || occupied.has(y - 1)) {
        occupied.add(y); // stays, blocks pieces below
      } else {
        canMoveUp[idx(x, y)] = true;
        occupied.add(y - 1); // destination claimed
      }
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
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== W) continue;
    if (canMoveUp[i]) {
      const [x, y] = xy(i);
      const ni = idx(x, y - 1);
      if (newBoard[ni] === CHEST) addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER][randInt(6)]);
      newBoard[ni] = board[i]; newSides[ni] = W; newHealth[ni] = health[i];
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
  applySpacesAfterAdvance();
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
  if (!canPitchShift()) return;

  // Everything shifts down one row; row 7 is destroyed (including white pieces).
  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);
  const newHealth = new Array(64).fill(1);

  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y === 7) continue; // destroyed
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
    set(w.x, 0, w.piece, B);
  }
  for (const b of nextBonuses) {
    if (b.type === 'chest') set(b.col, 0, CHEST, 0);
  }

  nextWave = generateWave(spawnCount + 1);
  nextBonuses = generateRowBonuses(nextWave);

  epTarget = -1;
  selected = -1;
  validMoves = [];
  firstMoveMade = true;
  shiftCountdown = 10;
  recordPosition();

  turn = B;
  draw();
  if (!gameOver) aiPlay();
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
  // Penalize repeated positions — both sides should avoid loops
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

function aiBestMove() {
  const moves = allLegalMovesForSide(B);
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
      makeMove(move[0], move[1]);
      applySpecialSpace(move[1]);
      recordPosition();
    }
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
    default: return false;
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
      // Skip pawn selection — piece is already known. Jump straight to chooser.
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

// After a Team Advance, apply obstacle spaces then item spaces left→right, front→back.
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

  // Pass 2: item spaces — instant items applied now, interactive items queued.
  pendingItemQueue = [];
  for (let i = 0; i < 64; i++) {
    const item = itemSpaces[i];
    if (item === ITEM_NONE || sides[i] !== W || !canItemAffectPiece(item, i)) continue;
    if (item === ITEM_UPGRADER) { health[i]++; itemSpaces[i] = ITEM_NONE; }
    else if (item === ITEM_KING_PROMOTER) { board[i] = KING; itemSpaces[i] = ITEM_NONE; }
    else { pendingItemQueue.push({ item, i }); itemSpaces[i] = ITEM_NONE; }
  }
  processNextQueuedItem();
}

// Applies obstacle (arrow) spaces with chaining. Any piece — white or black —
// landing on an obstacle is redirected; if the destination is also an obstacle
// the chain continues. Visited set prevents infinite loops.
function applySpecialSpace(startI) {
  const visited = new Set();
  let toI = startI;
  while (true) {
    if (visited.has(toI)) break; // cycle detected — piece stays where it is
    const sp = specialSpaces[toI];
    if (!sp || sp.type !== 'obstacle') break;
    visited.add(toI);
    const [x, y] = xy(toI);
    const nx = x + sp.dx, ny = y + sp.dy;
    if (!inB(nx, ny)) break;
    const destI = idx(nx, ny);
    const moverSide = sides[toI];
    const destSide = sides[destI];
    if (destSide !== 0 && destSide === moverSide) break; // friendly blocks
    // Bounce: black piece hitting shielded white
    if (moverSide === B && destSide === W && health[destI] > 1) {
      health[destI]--; break;
    }
    if (destSide !== 0 && destSide !== moverSide) {
      if (board[destI] === KING) score++;
      if (moverSide === W) gold += GOLD_VALUE[board[destI]] ?? 0;
    }
    if (board[destI] === CHEST && moverSide === W) {
      addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER][randInt(6)]);
    }
    board[destI] = board[toI]; sides[destI] = moverSide; health[destI] = health[toI];
    board[toI] = NONE; sides[toI] = 0; health[toI] = 1;
    toI = destI;
  }
  return toI;
}

// --- Leap button geometry ---
const BOARD_Y = LOGO_H + PREVIEW_H;
const BTN_Y = BOARD_Y + MARGIN + BOARD_PX + 72;
const LEAP_BTN = { x: MARGIN, y: BTN_Y, w: 130, h: 36 };
const PITCH_BTN = { x: MARGIN + 138, y: BTN_Y, w: 130, h: 36 };
const HINT_BTN = { x: MARGIN + 276, y: BTN_Y, w: 90, h: 36 };
const TEST_BTN = { x: MARGIN + 374, y: BTN_Y, w: 90, h: 36 };
const RESIGN_BTN = { x: MARGIN + BOARD_PX - 100, y: BTN_Y, w: 100, h: 36 };

// --- Draw ---

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Logo
  const logoEl = spriteImages["logo"];
  if (logoEl && logoEl.width > 0) {
    const maxW = canvas.width - MARGIN * 2;
    const scale = Math.min(maxW / logoEl.width, (LOGO_H - 8) / logoEl.height);
    const lw = logoEl.width * scale, lh = logoEl.height * scale;
    const logoCx = MARGIN + 4 * TILE; // d/e column boundary
    ctx.drawImage(logoEl, logoCx - lw / 2, (LOGO_H - lh) / 2, lw, lh);
  }

  // Preview row (ghosted board tile + pieces above the board)
  const previewRowNum = 8 + leapCount + 1;
  ctx.globalAlpha = 0.3;
  for (let x = 0; x < 8; x++) {
    ctx.fillStyle = (x + 1) % 2 === 0 ? LIGHT : DARK;
    ctx.fillRect(MARGIN + x * TILE, BOARD_Y + MARGIN - TILE, TILE, TILE);
  }
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(previewRowNum, MARGIN - 16, BOARD_Y + MARGIN - TILE + TILE / 2);
  const previewPad = 6;
  for (const w of nextWave) {
    const key = `${B}_${w.piece}`;
    const img = spriteImages[key];
    if (img && img.complete) {
      ctx.drawImage(img, MARGIN + w.x * TILE + previewPad, BOARD_Y + MARGIN - TILE + previewPad, TILE - previewPad * 2, TILE - previewPad * 2);
    }
  }
  for (const b of nextBonuses) {
    const px = MARGIN + b.col * TILE, py = BOARD_Y + MARGIN - TILE;
    if (b.type === 'chest') {
      const cimg = spriteImages["chest"];
      if (cimg && cimg.complete)
        ctx.drawImage(cimg, px + previewPad, py + previewPad, TILE - previewPad * 2, TILE - previewPad * 2);
    } else if (b.type === 'item') {
      const iimg = spriteImages[ITEM_SPRITE_KEYS[b.item]];
      if (iimg && iimg.complete) {
        ctx.fillStyle = "rgba(255,220,80,0.22)";
        ctx.fillRect(px, py, TILE, TILE);
        const sz = (TILE - previewPad * 2) * 0.44, off = (TILE - sz) / 2;
        ctx.drawImage(iimg, px + off, py + off, sz, sz);
      }
    } else if (b.type === 'obstacle') {
      ctx.fillStyle = "rgba(80,200,255,0.18)";
      ctx.fillRect(px, py, TILE, TILE);
      const cx2 = px + TILE / 2, cy2 = py + TILE / 2;
      const angle2 = Math.atan2(b.dy, b.dx), len2 = TILE * 0.32;
      const tx3 = cx2 + Math.cos(angle2) * len2, ty3 = cy2 + Math.sin(angle2) * len2;
      const bx3 = cx2 - Math.cos(angle2) * len2 * 0.55, by3 = cy2 - Math.sin(angle2) * len2 * 0.55;
      ctx.strokeStyle = "rgba(120,230,255,0.9)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx3, by3); ctx.lineTo(tx3, ty3); ctx.stroke();
      ctx.fillStyle = "rgba(120,230,255,0.9)";
      ctx.save(); ctx.translate(tx3, ty3); ctx.rotate(angle2);
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-13,-6); ctx.lineTo(-13,6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1.0;

  ctx.save();
  ctx.translate(0, BOARD_Y);

  // Labels
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#aaa";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 8; i++) {
    ctx.fillText("abcdefgh"[i], MARGIN + i * TILE + TILE / 2, MARGIN + BOARD_PX + 16);
    ctx.fillText(8 + leapCount - i, MARGIN - 16, MARGIN + i * TILE + TILE / 2);
  }

  // Board squares
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const px = MARGIN + x * TILE, py = MARGIN + y * TILE;
    ctx.fillStyle = (x + y) % 2 === 0 ? LIGHT : DARK;
    ctx.fillRect(px, py, TILE, TILE);
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
      const sz = TILE * 0.44;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(img, px + (TILE - sz) / 2, py + (TILE - sz) / 2, sz, sz);
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

  // Pieces and chests
  const pad = 6;
  for (let i = 0; i < 64; i++) {
    if (board[i] === NONE) continue;
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
      const bx = MARGIN + x * TILE + TILE - 22, by = MARGIN + y * TILE + 2;
      const sz = 20;
      const shieldImg = spriteImages["item_upgrader"];
      if (shieldImg && shieldImg.complete) ctx.drawImage(shieldImg, bx, by, sz, sz);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 2.5;
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeText(shields, bx + sz / 2, by + sz / 2 + 1);
      ctx.fillText(shields, bx + sz / 2, by + sz / 2 + 1);
    }
  }

  // King Promoter highlight — highlight white pawns
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

  // Upgrader highlight — all white pieces selectable
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

  ctx.restore();

  // Inventory panel
  const invY = BOARD_Y + MARGIN;
  ctx.fillStyle = "#2a2a4e";
  ctx.beginPath();
  ctx.roundRect(INV_X, invY - 24, INV_W, INV_ROWS * (INV_SLOT + INV_PAD) + INV_PAD + 28, 8);
  ctx.fill();
  ctx.fillStyle = "#aaa";
  ctx.font = "bold 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ITEMS", INV_X + INV_W / 2, invY - 10);
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

  // Buttons
  ctx.font = "bold 16px sans-serif";
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
  } else if (!gameOver) {
    // Team Leap
    const canLeap = canTeamLeap();
    ctx.fillStyle = canLeap ? LEAP_BTN_COLOR : LEAP_BTN_DISABLED;
    ctx.beginPath();
    ctx.roundRect(LEAP_BTN.x, LEAP_BTN.y, LEAP_BTN.w, LEAP_BTN.h, 6);
    ctx.fill();
    ctx.fillStyle = canLeap ? "#fff" : "#999";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText("TEAM ADVANCE", LEAP_BTN.x + LEAP_BTN.w / 2, LEAP_BTN.y + LEAP_BTN.h / 2);
    ctx.font = "bold 16px sans-serif";

    // Pitch Shift
    const canShift = canManualPitchShift();
    const shiftHighlight = hintMove === "leap";
    const shiftUrgent = shiftCountdown <= 3;
    ctx.fillStyle = shiftHighlight ? "#e8a735" : (shiftUrgent ? "#8a1a1a" : (canShift ? "#1a5a8a" : LEAP_BTN_DISABLED));
    ctx.beginPath();
    ctx.roundRect(PITCH_BTN.x, PITCH_BTN.y, PITCH_BTN.w, PITCH_BTN.h, 6);
    ctx.fill();
    ctx.fillStyle = canShift ? "#fff" : "#999";
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(`FIELD ADVANCE`, PITCH_BTN.x + PITCH_BTN.w / 2, PITCH_BTN.y + PITCH_BTN.h / 2 - 4);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = shiftUrgent ? "#ffaaaa" : "#aaccff";
    ctx.fillText(`auto in ${shiftCountdown}`, PITCH_BTN.x + PITCH_BTN.w / 2, PITCH_BTN.y + PITCH_BTN.h / 2 + 10);
    ctx.font = "bold 16px sans-serif";

    // Hint (only shown in test mode)
    if (testMode) {
      const hintActive = turn === W && !aiThinking;
      ctx.fillStyle = hintActive ? "#8855aa" : LEAP_BTN_DISABLED;
      ctx.beginPath();
      ctx.roundRect(HINT_BTN.x, HINT_BTN.y, HINT_BTN.w, HINT_BTN.h, 6);
      ctx.fill();
      ctx.fillStyle = hintActive ? "#fff" : "#999";
      ctx.fillText("💡 HINT", HINT_BTN.x + HINT_BTN.w / 2, HINT_BTN.y + HINT_BTN.h / 2);
    }

    // Test
    ctx.fillStyle = "#336633";
    ctx.beginPath();
    ctx.roundRect(TEST_BTN.x, TEST_BTN.y, TEST_BTN.w, TEST_BTN.h, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("🧪 TEST", TEST_BTN.x + TEST_BTN.w / 2, TEST_BTN.y + TEST_BTN.h / 2);

    // Resign
    ctx.fillStyle = "#993333";
    ctx.beginPath();
    ctx.roundRect(RESIGN_BTN.x, RESIGN_BTN.y, RESIGN_BTN.w, RESIGN_BTN.h, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.fillText("RESIGN", RESIGN_BTN.x + RESIGN_BTN.w / 2, RESIGN_BTN.y + RESIGN_BTN.h / 2);
  }

  // Score + status
  ctx.font = "20px sans-serif";
  ctx.fillStyle = "#ddd";
  ctx.textAlign = "center";
  const status = gameOver ? gameMsg : (promotingMode ? "Select a Pawn to promote" : (anyPromotingMode ? (anyPromotingPieceIdx >= 0 ? "Choose a piece type" : "Select a piece to promote") : (kingPromotingMode ? "Select a Pawn to crown as King" : (clonerMode ? (clonerSelected >= 0 ? "Select adjacent empty space" : "Select a piece to clone") : (upgraderMode ? "Select a piece to upgrade" : (teleporterMode ? (teleporterSelected >= 0 ? "Select destination" : "Select a piece to teleport") : (aiThinking ? "AI Thinking..." : "Your Turn")))))));
  ctx.fillText(status, canvas.width / 2, BOARD_Y + MARGIN + BOARD_PX + 36);
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#aaa";
  ctx.fillText(`Kings Taken: ${score}   Gold: ${gold}`, canvas.width / 2, BOARD_Y + MARGIN + BOARD_PX + 52);

  // Promoter piece chooser overlay
  if (promotingPawnIdx >= 0 || anyPromotingPieceIdx >= 0) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#2a2a4e";
    const dlgW = 340, dlgH = 100;
    const dlgX = (canvas.width - dlgW) / 2, dlgY = (canvas.height - dlgH) / 2;
    ctx.beginPath(); ctx.roundRect(dlgX, dlgY, dlgW, dlgH, 10); ctx.fill();
    ctx.fillStyle = "#ddd";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Promote to:", dlgX + dlgW / 2, dlgY + 24);
    const choices = [ROOK, KNIGHT, BISHOP, QUEEN];
    const cpad = 8;
    const csize = 60;
    const startX = dlgX + (dlgW - choices.length * (csize + cpad) + cpad) / 2;
    for (let i = 0; i < choices.length; i++) {
      const cx = startX + i * (csize + cpad);
      const cy = dlgY + 36;
      ctx.fillStyle = "#3a3a5e";
      ctx.beginPath(); ctx.roundRect(cx, cy, csize, csize, 6); ctx.fill();
      const img = spriteImages[`${W}_${choices[i]}`];
      if (img && img.complete) {
        ctx.drawImage(img, cx + 6, cy + 6, csize - 12, csize - 12);
      }
    }
  }

}

canvas.addEventListener("click", (e) => {
  if (gameOver) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;

  // Piece chooser dialog (shared by Pawn Promoter and Any Promoter)
  if (promotingPawnIdx >= 0 || anyPromotingPieceIdx >= 0) {
    const targetIdx = promotingPawnIdx >= 0 ? promotingPawnIdx : anyPromotingPieceIdx;
    const choices = [ROOK, KNIGHT, BISHOP, QUEEN];
    const dlgW = 340, dlgH = 100;
    const dlgX = (canvas.width - dlgW) / 2, dlgY = (canvas.height - dlgH) / 2;
    const cpad = 8, csize = 60;
    const startX = dlgX + (dlgW - choices.length * (csize + cpad) + cpad) / 2;
    for (let i = 0; i < choices.length; i++) {
      const bx = startX + i * (csize + cpad);
      const by = dlgY + 36;
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
          if (board[i] === CHEST) addToInventory([ITEM_PROMOTER, ITEM_ANY_PROMOTER, ITEM_TELEPORTER, ITEM_KING_PROMOTER, ITEM_CLONER, ITEM_UPGRADER][randInt(6)]);
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

  // King Promoter — select a white pawn, convert to King
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
          board[i] = board[teleporterSelected];
          sides[i] = W; health[i] = health[teleporterSelected];
          board[teleporterSelected] = NONE;
          sides[teleporterSelected] = 0; health[teleporterSelected] = 1;
          if (inventory._activeSlot !== undefined) { removeFromInventory(inventory._activeSlot); delete inventory._activeSlot; }
          const fromSpace = activeItemSpaceIdx >= 0;
          activeItemSpaceIdx = -1;
          teleporterMode = false; teleporterSelected = -1;
          if (fromSpace) {
            processNextQueuedItem();
          } else {
            firstMoveMade = true; recordPosition(); draw();
          }
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

  // Check resign button
  if (!gameOver && cx >= RESIGN_BTN.x && cx <= RESIGN_BTN.x + RESIGN_BTN.w &&
      cy >= RESIGN_BTN.y && cy <= RESIGN_BTN.y + RESIGN_BTN.h) {
    resignConfirm = true;
    draw();
    return;
  }

  // Check inventory click
  if (turn === W && !aiThinking) {
    const invY = BOARD_Y + MARGIN;
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

  // Check test button
  if (cx >= TEST_BTN.x && cx <= TEST_BTN.x + TEST_BTN.w &&
      cy >= TEST_BTN.y && cy <= TEST_BTN.y + TEST_BTN.h) {
    testMode = true;
    addToInventory(ITEM_PROMOTER);
    addToInventory(ITEM_ANY_PROMOTER);
    addToInventory(ITEM_TELEPORTER);
    addToInventory(ITEM_KING_PROMOTER);
    addToInventory(ITEM_CLONER);
    addToInventory(ITEM_UPGRADER);
    draw();
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
      const target = board[clicked];
      const targetSide = sides[clicked];
      firstMoveMade = true;
      makeMove(selected, clicked);
      recordPosition();
      selected = -1; validMoves = [];
      checkWhiteKingAlive();
      if (!gameOver) {
        const movedTo = applySpecialSpace(clicked);
        checkWhiteKingAlive();
        if (!gameOver) {
          const item = itemSpaces[movedTo];
          if (item !== ITEM_NONE && sides[movedTo] === W && canItemAffectPiece(item, movedTo)) {
            const done = activateItemSpace(item, movedTo);
            if (done) endWhiteTurn();
          } else {
            endWhiteTurn();
          }
        } else { draw(); }
      } else {
        draw();
      }
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
