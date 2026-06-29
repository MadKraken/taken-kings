extends Node2D

const TILE_SIZE := 80
const BOARD_OFFSET := Vector2(40, 40)
const BOARD_SIZE := 8

const LIGHT_COLOR := Color(0.93, 0.84, 0.71)
const DARK_COLOR := Color(0.71, 0.53, 0.39)
const HIGHLIGHT_COLOR := Color(0.68, 0.85, 0.35, 0.7)
const SELECTED_COLOR := Color(0.35, 0.68, 0.85, 0.7)

enum Piece { NONE, PAWN, ROOK, KNIGHT, BISHOP, QUEEN, KING }
enum Side { NONE, WHITE, BLACK }

const PIECE_SYMBOLS := {
	Side.WHITE: {
		Piece.KING: "♔", Piece.QUEEN: "♕", Piece.ROOK: "♖",
		Piece.BISHOP: "♗", Piece.KNIGHT: "♘", Piece.PAWN: "♙"
	},
	Side.BLACK: {
		Piece.KING: "♚", Piece.QUEEN: "♛", Piece.ROOK: "♜",
		Piece.BISHOP: "♝", Piece.KNIGHT: "♞", Piece.PAWN: "♟"
	}
}

var board: Array = []
var board_side: Array = []
var selected: Vector2i = Vector2i(-1, -1)
var valid_moves: Array[Vector2i] = []
var current_turn: int = Side.WHITE
var game_over: bool = false
var game_over_message: String = ""

# Track if king/rooks have moved for castling
var white_king_moved := false
var black_king_moved := false
var white_rook_a_moved := false
var white_rook_h_moved := false
var black_rook_a_moved := false
var black_rook_h_moved := false

# En passant target square (the square the capturing pawn lands on)
var en_passant_target := Vector2i(-1, -1)

func _ready() -> void:
	_init_board()

func _init_board() -> void:
	board.resize(64)
	board_side.resize(64)
	board.fill(Piece.NONE)
	board_side.fill(Side.NONE)

	var back_row := [Piece.ROOK, Piece.KNIGHT, Piece.BISHOP, Piece.QUEEN, Piece.KING, Piece.BISHOP, Piece.KNIGHT, Piece.ROOK]
	for x in range(8):
		_set_piece(x, 0, back_row[x], Side.BLACK)
		_set_piece(x, 1, Piece.PAWN, Side.BLACK)
		_set_piece(x, 6, Piece.PAWN, Side.WHITE)
		_set_piece(x, 7, back_row[x], Side.WHITE)

func _idx(x: int, y: int) -> int:
	return y * 8 + x

func _set_piece(x: int, y: int, piece: int, side: int) -> void:
	board[_idx(x, y)] = piece
	board_side[_idx(x, y)] = side

func _get_piece(x: int, y: int) -> int:
	if x < 0 or x > 7 or y < 0 or y > 7:
		return Piece.NONE
	return board[_idx(x, y)]

func _get_side(x: int, y: int) -> int:
	if x < 0 or x > 7 or y < 0 or y > 7:
		return Side.NONE
	return board_side[_idx(x, y)]

func _in_bounds(x: int, y: int) -> bool:
	return x >= 0 and x <= 7 and y >= 0 and y <= 7

func _draw() -> void:
	# Draw board
	for y in range(8):
		for x in range(8):
			var color := LIGHT_COLOR if (x + y) % 2 == 0 else DARK_COLOR
			var rect := Rect2(BOARD_OFFSET + Vector2(x, y) * TILE_SIZE, Vector2(TILE_SIZE, TILE_SIZE))
			draw_rect(rect, color)

	# Draw selected square
	if selected != Vector2i(-1, -1):
		var rect := Rect2(BOARD_OFFSET + Vector2(selected) * TILE_SIZE, Vector2(TILE_SIZE, TILE_SIZE))
		draw_rect(rect, SELECTED_COLOR)

	# Draw valid moves
	for move in valid_moves:
		var rect := Rect2(BOARD_OFFSET + Vector2(move) * TILE_SIZE, Vector2(TILE_SIZE, TILE_SIZE))
		draw_rect(rect, HIGHLIGHT_COLOR)

	# Draw file/rank labels
	for i in range(8):
		var file_label := char("a".unicode_at(0) + i)
		var rank_label := str(8 - i)
		_draw_label(file_label, BOARD_OFFSET + Vector2(i * TILE_SIZE + TILE_SIZE / 2, 8 * TILE_SIZE + 20), 16, Color.WHITE)
		_draw_label(rank_label, BOARD_OFFSET + Vector2(-20, i * TILE_SIZE + TILE_SIZE / 2), 16, Color.WHITE)

	# Draw pieces
	for y in range(8):
		for x in range(8):
			var piece := _get_piece(x, y)
			var side := _get_side(x, y)
			if piece != Piece.NONE and side != Side.NONE:
				var symbol: String = PIECE_SYMBOLS[side][piece]
				var pos := BOARD_OFFSET + Vector2(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2)
				_draw_label(symbol, pos, 48, Color.WHITE if side == Side.WHITE else Color(0.15, 0.15, 0.15))

	# Draw turn indicator
	var turn_text := "White's Turn" if current_turn == Side.WHITE else "Black's Turn"
	if game_over:
		turn_text = game_over_message
	_draw_label(turn_text, Vector2(360, 700), 22, Color.WHITE)

func _draw_label(text: String, pos: Vector2, size: int, color: Color) -> void:
	var font := ThemeDB.fallback_font
	var text_size := font.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, size)
	draw_string(font, pos - Vector2(text_size.x / 2, -text_size.y / 4), text, HORIZONTAL_ALIGNMENT_CENTER, -1, size, color)

func _input(event: InputEvent) -> void:
	if game_over:
		return
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var local_pos: Vector2 = event.position - BOARD_OFFSET
		var grid_x := int(local_pos.x / TILE_SIZE)
		var grid_y := int(local_pos.y / TILE_SIZE)

		if not _in_bounds(grid_x, grid_y):
			selected = Vector2i(-1, -1)
			valid_moves.clear()
			queue_redraw()
			return

		var clicked := Vector2i(grid_x, grid_y)

		if selected == Vector2i(-1, -1):
			if _get_side(grid_x, grid_y) == current_turn:
				selected = clicked
				valid_moves = _get_legal_moves(grid_x, grid_y)
		else:
			if clicked in valid_moves:
				_make_move(selected, clicked)
				selected = Vector2i(-1, -1)
				valid_moves.clear()
				_switch_turn()
			elif _get_side(grid_x, grid_y) == current_turn:
				selected = clicked
				valid_moves = _get_legal_moves(grid_x, grid_y)
			else:
				selected = Vector2i(-1, -1)
				valid_moves.clear()

		queue_redraw()

func _make_move(from: Vector2i, to: Vector2i) -> void:
	var piece := _get_piece(from.x, from.y)
	var side := _get_side(from.x, from.y)

	# Track castling rights
	if piece == Piece.KING:
		if side == Side.WHITE:
			white_king_moved = true
		else:
			black_king_moved = true
		# Handle castling move
		if abs(to.x - from.x) == 2:
			if to.x > from.x: # Kingside
				_set_piece(5, from.y, Piece.ROOK, side)
				_set_piece(7, from.y, Piece.NONE, Side.NONE)
			else: # Queenside
				_set_piece(3, from.y, Piece.ROOK, side)
				_set_piece(0, from.y, Piece.NONE, Side.NONE)

	if piece == Piece.ROOK:
		if from == Vector2i(0, 7): white_rook_a_moved = true
		elif from == Vector2i(7, 7): white_rook_h_moved = true
		elif from == Vector2i(0, 0): black_rook_a_moved = true
		elif from == Vector2i(7, 0): black_rook_h_moved = true

	# Handle en passant capture
	if piece == Piece.PAWN and to == en_passant_target:
		var captured_y := to.y + (1 if side == Side.WHITE else -1)
		_set_piece(to.x, captured_y, Piece.NONE, Side.NONE)

	# Set en passant target
	en_passant_target = Vector2i(-1, -1)
	if piece == Piece.PAWN and abs(to.y - from.y) == 2:
		en_passant_target = Vector2i(from.x, (from.y + to.y) / 2)

	# Move the piece
	_set_piece(to.x, to.y, piece, side)
	_set_piece(from.x, from.y, Piece.NONE, Side.NONE)

	# Pawn promotion (auto-queen)
	if piece == Piece.PAWN and (to.y == 0 or to.y == 7):
		_set_piece(to.x, to.y, Piece.QUEEN, side)

func _switch_turn() -> void:
	current_turn = Side.BLACK if current_turn == Side.WHITE else Side.WHITE
	if _is_in_checkmate(current_turn):
		game_over = true
		var winner := "White" if current_turn == Side.BLACK else "Black"
		game_over_message = "Checkmate! %s wins!" % winner
	elif _is_in_stalemate(current_turn):
		game_over = true
		game_over_message = "Stalemate! It's a draw."

func _get_pseudo_moves(x: int, y: int) -> Array[Vector2i]:
	var moves: Array[Vector2i] = []
	var piece := _get_piece(x, y)
	var side := _get_side(x, y)
	var enemy: int = Side.BLACK if side == Side.WHITE else Side.WHITE

	match piece:
		Piece.PAWN:
			var dir := -1 if side == Side.WHITE else 1
			var start_row := 6 if side == Side.WHITE else 1
			# Forward
			if _in_bounds(x, y + dir) and _get_piece(x, y + dir) == Piece.NONE:
				moves.append(Vector2i(x, y + dir))
				if y == start_row and _get_piece(x, y + 2 * dir) == Piece.NONE:
					moves.append(Vector2i(x, y + 2 * dir))
			# Captures
			for dx in [-1, 1]:
				var nx := x + dx
				var ny := y + dir
				if _in_bounds(nx, ny):
					if _get_side(nx, ny) == enemy:
						moves.append(Vector2i(nx, ny))
					elif Vector2i(nx, ny) == en_passant_target:
						moves.append(Vector2i(nx, ny))

		Piece.KNIGHT:
			for offset in [Vector2i(1,2), Vector2i(2,1), Vector2i(-1,2), Vector2i(-2,1),
							Vector2i(1,-2), Vector2i(2,-1), Vector2i(-1,-2), Vector2i(-2,-1)]:
				var nx := x + offset.x
				var ny := y + offset.y
				if _in_bounds(nx, ny) and _get_side(nx, ny) != side:
					moves.append(Vector2i(nx, ny))

		Piece.BISHOP:
			for dir in [Vector2i(1,1), Vector2i(1,-1), Vector2i(-1,1), Vector2i(-1,-1)]:
				_add_sliding_moves(moves, x, y, dir, side)

		Piece.ROOK:
			for dir in [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]:
				_add_sliding_moves(moves, x, y, dir, side)

		Piece.QUEEN:
			for dir in [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1),
						Vector2i(1,1), Vector2i(1,-1), Vector2i(-1,1), Vector2i(-1,-1)]:
				_add_sliding_moves(moves, x, y, dir, side)

		Piece.KING:
			for dy in range(-1, 2):
				for dx in range(-1, 2):
					if dx == 0 and dy == 0:
						continue
					var nx := x + dx
					var ny := y + dy
					if _in_bounds(nx, ny) and _get_side(nx, ny) != side:
						moves.append(Vector2i(nx, ny))
			# Castling
			moves.append_array(_get_castling_moves(x, y, side))

	return moves

func _add_sliding_moves(moves: Array[Vector2i], x: int, y: int, dir: Vector2i, side: int) -> void:
	var nx := x + dir.x
	var ny := y + dir.y
	while _in_bounds(nx, ny):
		if _get_side(nx, ny) == side:
			break
		moves.append(Vector2i(nx, ny))
		if _get_piece(nx, ny) != Piece.NONE:
			break
		nx += dir.x
		ny += dir.y

func _get_castling_moves(x: int, y: int, side: int) -> Array[Vector2i]:
	var moves: Array[Vector2i] = []
	if _is_square_attacked(x, y, side):
		return moves

	if side == Side.WHITE and not white_king_moved:
		# Kingside
		if not white_rook_h_moved and _get_piece(5, 7) == Piece.NONE and _get_piece(6, 7) == Piece.NONE:
			if not _is_square_attacked(5, 7, side) and not _is_square_attacked(6, 7, side):
				moves.append(Vector2i(6, 7))
		# Queenside
		if not white_rook_a_moved and _get_piece(3, 7) == Piece.NONE and _get_piece(2, 7) == Piece.NONE and _get_piece(1, 7) == Piece.NONE:
			if not _is_square_attacked(3, 7, side) and not _is_square_attacked(2, 7, side):
				moves.append(Vector2i(2, 7))

	elif side == Side.BLACK and not black_king_moved:
		if not black_rook_h_moved and _get_piece(5, 0) == Piece.NONE and _get_piece(6, 0) == Piece.NONE:
			if not _is_square_attacked(5, 0, side) and not _is_square_attacked(6, 0, side):
				moves.append(Vector2i(6, 0))
		if not black_rook_a_moved and _get_piece(3, 0) == Piece.NONE and _get_piece(2, 0) == Piece.NONE and _get_piece(1, 0) == Piece.NONE:
			if not _is_square_attacked(3, 0, side) and not _is_square_attacked(2, 0, side):
				moves.append(Vector2i(2, 0))

	return moves

func _is_square_attacked(x: int, y: int, by_side_defending: int) -> bool:
	var attacker: int = Side.BLACK if by_side_defending == Side.WHITE else Side.WHITE
	for ay in range(8):
		for ax in range(8):
			if _get_side(ax, ay) != attacker:
				continue
			var piece := _get_piece(ax, ay)
			if piece == Piece.KING:
				if abs(ax - x) <= 1 and abs(ay - y) <= 1:
					return true
				continue
			if piece == Piece.PAWN:
				var dir := -1 if attacker == Side.WHITE else 1
				if ay + dir == y and (ax - 1 == x or ax + 1 == x):
					return true
				continue
			# For other pieces, use pseudo moves but skip castling to avoid recursion
			var dirs: Array = []
			match piece:
				Piece.KNIGHT:
					for offset in [Vector2i(1,2), Vector2i(2,1), Vector2i(-1,2), Vector2i(-2,1),
									Vector2i(1,-2), Vector2i(2,-1), Vector2i(-1,-2), Vector2i(-2,-1)]:
						if ax + offset.x == x and ay + offset.y == y:
							return true
					continue
				Piece.BISHOP:
					dirs = [Vector2i(1,1), Vector2i(1,-1), Vector2i(-1,1), Vector2i(-1,-1)]
				Piece.ROOK:
					dirs = [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1)]
				Piece.QUEEN:
					dirs = [Vector2i(1,0), Vector2i(-1,0), Vector2i(0,1), Vector2i(0,-1),
							Vector2i(1,1), Vector2i(1,-1), Vector2i(-1,1), Vector2i(-1,-1)]
			for dir in dirs:
				var nx := ax + dir.x
				var ny := ay + dir.y
				while _in_bounds(nx, ny):
					if nx == x and ny == y:
						return true
					if _get_piece(nx, ny) != Piece.NONE:
						break
					nx += dir.x
					ny += dir.y
	return false

func _get_legal_moves(x: int, y: int) -> Array[Vector2i]:
	var side := _get_side(x, y)
	var pseudo := _get_pseudo_moves(x, y)
	var legal: Array[Vector2i] = []

	for move in pseudo:
		if _is_move_legal(Vector2i(x, y), move, side):
			legal.append(move)

	return legal

func _is_move_legal(from: Vector2i, to: Vector2i, side: int) -> bool:
	# Save state
	var from_piece := board[_idx(from.x, from.y)]
	var from_side := board_side[_idx(from.x, from.y)]
	var to_piece := board[_idx(to.x, to.y)]
	var to_side := board_side[_idx(to.x, to.y)]
	var ep_captured_piece := Piece.NONE
	var ep_captured_side := Side.NONE
	var ep_captured_pos := Vector2i(-1, -1)

	# Handle en passant capture in simulation
	if from_piece == Piece.PAWN and to == en_passant_target:
		var captured_y := to.y + (1 if side == Side.WHITE else -1)
		ep_captured_pos = Vector2i(to.x, captured_y)
		ep_captured_piece = board[_idx(ep_captured_pos.x, ep_captured_pos.y)]
		ep_captured_side = board_side[_idx(ep_captured_pos.x, ep_captured_pos.y)]
		_set_piece(ep_captured_pos.x, ep_captured_pos.y, Piece.NONE, Side.NONE)

	# Make move
	_set_piece(to.x, to.y, from_piece, from_side)
	_set_piece(from.x, from.y, Piece.NONE, Side.NONE)

	# Find king
	var king_pos := Vector2i(-1, -1)
	for ky in range(8):
		for kx in range(8):
			if _get_piece(kx, ky) == Piece.KING and _get_side(kx, ky) == side:
				king_pos = Vector2i(kx, ky)
				break

	var in_check := _is_square_attacked(king_pos.x, king_pos.y, side)

	# Restore state
	_set_piece(from.x, from.y, from_piece, from_side)
	_set_piece(to.x, to.y, to_piece, to_side)
	if ep_captured_pos != Vector2i(-1, -1):
		_set_piece(ep_captured_pos.x, ep_captured_pos.y, ep_captured_piece, ep_captured_side)

	return not in_check

func _has_any_legal_moves(side: int) -> bool:
	for y in range(8):
		for x in range(8):
			if _get_side(x, y) == side:
				if _get_legal_moves(x, y).size() > 0:
					return true
	return false

func _is_in_checkmate(side: int) -> bool:
	var king_pos := Vector2i(-1, -1)
	for y in range(8):
		for x in range(8):
			if _get_piece(x, y) == Piece.KING and _get_side(x, y) == side:
				king_pos = Vector2i(x, y)
				break
	if not _is_square_attacked(king_pos.x, king_pos.y, side):
		return false
	return not _has_any_legal_moves(side)

func _is_in_stalemate(side: int) -> bool:
	var king_pos := Vector2i(-1, -1)
	for y in range(8):
		for x in range(8):
			if _get_piece(x, y) == Piece.KING and _get_side(x, y) == side:
				king_pos = Vector2i(x, y)
				break
	if _is_square_attacked(king_pos.x, king_pos.y, side):
		return false
	return not _has_any_legal_moves(side)
