# AI-generated art

Everything in this folder was produced by an image generator, not drawn by a person. It is here so
it can be told apart at a glance and replaced with human art without hunting through the sprite
folder. Replacing a file is the whole job: `chess.js` loads these paths by name and nothing else
knows where the art came from.

## The Checkers Warriors

| File | Side | Piece |
|---|---|---|
| `checkers_w.png`      | White   | Checkers Man |
| `checkers_king_w.png` | White   | Checkers King |
| `checkers_b.png`      | Black   | Checkers Man |
| `checkers_king_b.png` | Black   | Checkers King |
| `checkers_n.png`      | Neutral | Checkers Man |
| `checkers_king_n.png` | Neutral | Checkers King |

Black's Checkers are red. A King is the double-stacked disc.

Unlike the other pieces, each side here has its own drawn sprite. Black and Neutral are normally
derived by tinting the White art (`_makeTinted`), and `_drawPieceSprite` still falls back to that
if one of these files fails to load.

## What a replacement has to match

- **Square canvas, transparent background.** The game draws a Checkers sprite into a square cell,
  so a non-square image is stretched. These are 320x320; any square size works.
- **Same footprint**, or pieces will not sit on a common line: the disc is 76% of the canvas wide,
  centred, with the bottom of the piece at 85% of the canvas height. That is the footprint the
  original `sprites/w_checkers.svg` used.
- **Keep it small.** Everything loads at startup behind the progress bar. The generator output was
  7.35 MB for the six; trimmed and resized they are 301 KB.

`_originals/` holds the untouched generator output, and is gitignored — useful only for regenerating
at a different size. Nothing reads from it.
