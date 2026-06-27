const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const TILE = 80;
const MARGIN = 32;
const PREVIEW_H = 60;
const BOARD_PX = TILE * 8;
const INV_COLS = 2, INV_ROWS = 4, INV_SLOT = 50, INV_PAD = 4;
const INV_W = INV_COLS * (INV_SLOT + INV_PAD) + INV_PAD;
const INV_X = BOARD_PX + MARGIN * 2 + 10;
canvas.width = INV_X + INV_W + 10;
canvas.height = PREVIEW_H + BOARD_PX + MARGIN * 2 + 130;

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
  const total = 14;
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
}

let board = new Array(64).fill(NONE);
let sides = new Array(64).fill(0);
let selected = -1;
let validMoves = [];
let turn = W;
let gameOver = false;
let gameMsg = "";
let score = 0;
let spawnCount = 1;
let leapCount = 0;
let nextWave = []; // array of {x, piece} for preview
let nextChestCol = -1; // column for next chest, -1 if none
let positionHistory = []; // track board states to detect repetition
const ITEM_NONE = 0, ITEM_PROMOTER = 1;
const ITEM_NAMES = { [ITEM_PROMOTER]: "Promoter" };
let inventory = new Array(INV_COLS * INV_ROWS).fill(ITEM_NONE);
let promotingMode = false;
let promotingPawnIdx = -1;

let wkMoved = false;
let wraMoved = false, wrhMoved = false;
let epTarget = -1;
let aiThinking = false;

const AI_DEPTH = 3;
const HINT_DEPTH = 4;
const PIECE_VALUE = { [NONE]: 0, [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 20000, [CHEST]: 0 };
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
  const n = Math.min(count, 8);
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

function generateChestCol(nextLeap, wave) {
  if (nextLeap >= 2 && nextLeap % 2 === 0) {
    const waveCols = wave.map(w => w.x);
    const open = [];
    for (let x = 0; x < 8; x++) { if (!waveCols.includes(x)) open.push(x); }
    return open.length > 0 ? open[randInt(open.length)] : -1;
  }
  return -1;
}

function placeWave(row, wave) {
  for (const w of wave) {
    set(w.x, row, w.piece, B);
  }
}

let firstMoveMade = false;
let resignConfirm = false;

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
  nextChestCol = generateChestCol(leapCount + 1, nextWave);
  selected = -1; validMoves = []; turn = W;
  gameOver = false; gameMsg = ""; score = 0; leapCount = 0;
  firstMoveMade = false; positionHistory = [];
  inventory.fill(ITEM_NONE); promotingMode = false; promotingPawnIdx = -1;
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
      // White pawns move and capture in both directions
      for (const dir of [-1, 1]) {
        if (inB(x, y + dir) && piece(x, y + dir) === NONE) {
          moves.push(idx(x, y + dir));
          if (dir === -1 && y === 6 && piece(x, y - 2) === NONE) moves.push(idx(x, y - 2));
        }
        for (const dx of [-1, 1]) {
          const nx = x + dx, ny = y + dir;
          if (inB(nx, ny)) {
            if (side(nx, ny) === e) moves.push(idx(nx, ny));
            else if (idx(nx, ny) === epTarget) moves.push(idx(nx, ny));
          }
        }
      }
    } else {
      // Black pawns move down only
      const dir = 1;
      if (inB(x, y + dir) && piece(x, y + dir) === NONE) {
        moves.push(idx(x, y + dir));
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

function isMoveLegal(fromI, toI, s) {
  // Enemy (black) has multiple kings — no check constraint for them
  if (s === B) return true;

  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const savBoard = [...board], savSides = [...sides];

  if (board[fromI] === PAWN && toI === epTarget) {
    const capY = ty + (s === W ? 1 : -1);
    set(tx, capY, NONE, 0);
  }

  board[toI] = board[fromI]; sides[toI] = sides[fromI];
  board[fromI] = NONE; sides[fromI] = 0;

  let kingI = -1;
  for (let i = 0; i < 64; i++) if (board[i] === KING && sides[i] === W) { kingI = i; break; }

  let inCheck = false;
  if (kingI >= 0) {
    const [kx, ky] = xy(kingI);
    inCheck = isAttacked(kx, ky, W);
  }

  board.splice(0, 64, ...savBoard);
  sides.splice(0, 64, ...savSides);
  return !inCheck;
}

function legalMoves(x, y) {
  const s = side(x, y);
  return pseudoMoves(x, y).filter(m => isMoveLegal(idx(x, y), m, s));
}

function makeMove(fromI, toI) {
  const [fx, fy] = xy(fromI), [tx, ty] = xy(toI);
  const p = board[fromI], s = sides[fromI];
  const captured = board[toI];

  if (captured === KING && sides[toI] !== s) {
    score += 1;
  }
  if (captured === CHEST && s === W) {
    addToInventory(ITEM_PROMOTER);
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
    if (piece(tx, capY) === KING) score += 1;
    set(tx, capY, NONE, 0);
  }

  epTarget = -1;
  if (p === PAWN && Math.abs(ty - fy) === 2) {
    epTarget = idx(fx, (fy + ty) / 2);
  }

  board[toI] = p; sides[toI] = s;
  board[fromI] = NONE; sides[fromI] = 0;

}

// --- Team Leap ---

function canTeamLeap() {
  if (gameOver || turn !== W || aiThinking) return false;
  // Can't leap if in check
  const [kx, ky] = findKing(W);
  if (kx >= 0 && isAttacked(kx, ky, W)) return false;
  // Can't leap if non-white piece on bottom row (nowhere to shift)
  for (let x = 0; x < 8; x++) {
    if (piece(x, 7) !== NONE && side(x, 7) !== W) return false;
  }
  // Can't leap if white piece on top row (would be overwritten by new wave)
  for (let x = 0; x < 8; x++) {
    if (side(x, 0) === W) return false;
  }
  // Can't leap if any non-white piece would shift onto a white piece
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W || board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y + 1 <= 7 && side(x, y + 1) === W) return false;
  }
  return true;
}

function teamLeap() {
  if (!canTeamLeap()) return;

  // Board scrolls down: enemy pieces shift y += 1, white stays put.
  // Enemies on row 0 move to row 1, etc. Enemies that collide with
  // white pieces on the way down are captured by white.
  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);

  // Keep white pieces where they are
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W) {
      newBoard[i] = board[i];
      newSides[i] = W;
    }
  }

  // Shift enemy pieces and chests down one
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W || board[i] === NONE) continue;
    const [x, y] = xy(i);
    const ny = y + 1;
    if (ny > 7) continue;
    const ni = idx(x, ny);
    if (newSides[ni] !== W) {
      newBoard[ni] = board[i];
      newSides[ni] = sides[i];
    }
  }

  board.splice(0, 64, ...newBoard);
  sides.splice(0, 64, ...newSides);

  // Place the pre-generated wave and chest
  spawnCount++;
  leapCount++;
  placeWave(0, nextWave);
  if (nextChestCol >= 0) {
    set(nextChestCol, 0, CHEST, 0);
  }

  nextWave = generateWave(spawnCount + 1);
  nextChestCol = generateChestCol(leapCount + 1, nextWave);

  epTarget = -1;
  selected = -1;
  validMoves = [];
  recordPosition();

  // End turn
  turn = B;
  draw();
  if (!gameOver) aiPlay();
}

// --- AI ---

function saveState() {
  return {
    board: [...board], sides: [...sides], epTarget,
    wkMoved, wraMoved, wrhMoved, score, inventory: [...inventory],
    spawnCount, nextChestCol, nextWave: nextWave.map(w => ({...w})),
    histLen: positionHistory.length
  };
}

function restoreState(st) {
  board.splice(0, 64, ...st.board);
  sides.splice(0, 64, ...st.sides);
  epTarget = st.epTarget;
  wkMoved = st.wkMoved;
  wraMoved = st.wraMoved; wrhMoved = st.wrhMoved;
  score = st.score; inventory.splice(0, inventory.length, ...st.inventory);
  spawnCount = st.spawnCount; nextChestCol = st.nextChestCol;
  nextWave = st.nextWave;
  positionHistory.length = st.histLen;
}

function canSimulateLeap() {
  for (let x = 0; x < 8; x++) {
    if (piece(x, 7) !== NONE && side(x, 7) !== W) return false;
  }
  for (let x = 0; x < 8; x++) {
    if (side(x, 0) === W) return false;
  }
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W || board[i] === NONE) continue;
    const [x, y] = xy(i);
    if (y + 1 <= 7 && side(x, y + 1) === W) return false;
  }
  return true;
}

function simulateLeap() {
  const newBoard = new Array(64).fill(NONE);
  const newSides = new Array(64).fill(0);
  for (let i = 0; i < 64; i++) {
    if (sides[i] === W) { newBoard[i] = board[i]; newSides[i] = W; }
  }
  for (let i = 0; i < 64; i++) {
    if (sides[i] !== B) continue;
    const [x, y] = xy(i);
    if (y + 1 > 7) continue;
    const ni = idx(x, y + 1);
    newBoard[ni] = board[i];
    newSides[ni] = B;
  }
  board.splice(0, 64, ...newBoard);
  sides.splice(0, 64, ...newSides);
  spawnCount++;
  placeWave(0, nextWave);
  if (nextChestCol >= 0) set(nextChestCol, 0, CHEST, 0);
  nextWave = generateWave(spawnCount + 1);
  nextChestCol = generateChestCol(leapCount + 1, nextWave);
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
      const [kx, ky] = findKing(W);
      if (kx >= 0 && isAttacked(kx, ky, W)) return -99999;
      return 0; // stalemate
    }
    return evaluate(); // black has no moves, just evaluate material
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
      recordPosition();
    }
    if (isCheckmated(W)) {
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

function checkWhiteKingAlive() {
  const [kx, ky] = findKing(W);
  if (kx < 0) {
    gameOver = true;
    gameMsg = `Game Over! Score: ${score}`;
  }
}

// --- Leap button geometry ---
const BOARD_Y = PREVIEW_H;
const LEAP_BTN = {
  x: MARGIN, y: BOARD_Y + MARGIN + BOARD_PX + 72,
  w: 155, h: 36
};
const HINT_BTN = {
  x: MARGIN + 163, y: BOARD_Y + MARGIN + BOARD_PX + 72,
  w: 120, h: 36
};


const RESIGN_BTN = {
  x: MARGIN + BOARD_PX - 100, y: BOARD_Y + MARGIN + BOARD_PX + 72,
  w: 100, h: 36
};

// --- Draw ---

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

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
  if (nextChestCol >= 0) {
    const cimg = spriteImages["chest"];
    if (cimg && cimg.complete) {
      ctx.drawImage(cimg, MARGIN + nextChestCol * TILE + previewPad, BOARD_Y + MARGIN - TILE + previewPad, TILE - previewPad * 2, TILE - previewPad * 2);
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
  }

  // Promoting mode highlight
  if (promotingMode) {
    for (let i = 0; i < 64; i++) {
      if (board[i] === PAWN && sides[i] === W) {
        const [px, py] = xy(i);
        ctx.fillStyle = "rgba(200,150,50,0.5)";
        ctx.fillRect(MARGIN + px * TILE, MARGIN + py * TILE, TILE, TILE);
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
      const isActive = promotingMode && inventory._activeSlot === slotIdx;
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
    const leapHighlight = hintMove === "leap";
    ctx.fillStyle = leapHighlight ? "#e8a735" : (canLeap ? LEAP_BTN_COLOR : LEAP_BTN_DISABLED);
    ctx.beginPath();
    ctx.roundRect(LEAP_BTN.x, LEAP_BTN.y, LEAP_BTN.w, LEAP_BTN.h, 6);
    ctx.fill();
    ctx.fillStyle = canLeap ? "#fff" : "#999";
    ctx.fillText("⬆ TEAM LEAP", LEAP_BTN.x + LEAP_BTN.w / 2, LEAP_BTN.y + LEAP_BTN.h / 2);

    // Hint
    ctx.fillStyle = (turn === W && !aiThinking) ? "#8855aa" : LEAP_BTN_DISABLED;
    ctx.beginPath();
    ctx.roundRect(HINT_BTN.x, HINT_BTN.y, HINT_BTN.w, HINT_BTN.h, 6);
    ctx.fill();
    ctx.fillStyle = (turn === W && !aiThinking) ? "#fff" : "#999";
    ctx.fillText("💡 HINT", HINT_BTN.x + HINT_BTN.w / 2, HINT_BTN.y + HINT_BTN.h / 2);

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
  const status = gameOver ? gameMsg : (promotingMode ? "Select a Pawn to promote" : (aiThinking ? "AI Thinking..." : "Your Turn"));
  ctx.fillText(status, canvas.width / 2, BOARD_Y + MARGIN + BOARD_PX + 36);
  ctx.font = "14px sans-serif";
  ctx.fillStyle = "#aaa";
  ctx.fillText(`Kings Taken: ${score}`, canvas.width / 2, BOARD_Y + MARGIN + BOARD_PX + 52);

  // Promoter piece chooser overlay
  if (promotingPawnIdx >= 0) {
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

  // Piece chooser dialog
  if (promotingPawnIdx >= 0) {
    const choices = [ROOK, KNIGHT, BISHOP, QUEEN];
    const dlgW = 340, dlgH = 100;
    const dlgX = (canvas.width - dlgW) / 2, dlgY = (canvas.height - dlgH) / 2;
    const cpad = 8, csize = 60;
    const startX = dlgX + (dlgW - choices.length * (csize + cpad) + cpad) / 2;
    for (let i = 0; i < choices.length; i++) {
      const bx = startX + i * (csize + cpad);
      const by = dlgY + 36;
      if (cx >= bx && cx <= bx + csize && cy >= by && cy <= by + csize) {
        board[promotingPawnIdx] = choices[i];
        if (inventory._activeSlot !== undefined) {
          removeFromInventory(inventory._activeSlot);
          delete inventory._activeSlot;
        }
        promotingPawnIdx = -1;
        promotingMode = false;
        draw();
        return;
      }
    }
    // Click outside cancels
    promotingPawnIdx = -1;
    promotingMode = false;
    draw();
    return;
  }

  // Pawn selection for promotion
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
            // Store which slot is being used
            inventory._activeSlot = slotIdx;
            draw();
            return;
          }
        }
      }
    }
  }

  // Check hint button
  if (cx >= HINT_BTN.x && cx <= HINT_BTN.x + HINT_BTN.w &&
      cy >= HINT_BTN.y && cy <= HINT_BTN.y + HINT_BTN.h) {
    showHint();
    return;
  }

  // Check leap button
  if (cx >= LEAP_BTN.x && cx <= LEAP_BTN.x + LEAP_BTN.w &&
      cy >= LEAP_BTN.y && cy <= LEAP_BTN.y + LEAP_BTN.h) {
    hintMove = null;
    firstMoveMade = true;
    teamLeap();
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
        turn = B;
        draw();
        aiPlay();
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
draw();
