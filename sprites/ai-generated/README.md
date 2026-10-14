# AI-generated art

Everything in this folder was produced by an image generator, not drawn by a person. It is here so
it can be told apart at a glance and replaced with human art without hunting through the sprite
folder. Replacing a file is the whole job: `chess.js` loads these paths by name and nothing else
knows where the art came from.

## The Checkers Warriors

| File | Side | Piece | |
|---|---|---|---|
| `checkers_b.png`      | Black   | Checkers Man  | **authored** |
| `checkers_king_b.png` | Black   | Checkers King | generated |
| `checkers_w.png`      | White   | Checkers Man  | generated |
| `checkers_king_w.png` | White   | Checkers King | generated |
| `checkers_n.png`      | Neutral | Checkers Man  | generated |
| `checkers_king_n.png` | Neutral | Checkers King | generated |

Black's Checkers are red. A King is the double-stacked disc.

Only the red Man is authored art. The other five are built from it by
`scripts/build_checkers_sprites.py`, so the whole set shares one perspective, one lighting setup
and one outline weight — which the generator did not give us on its own. The script desaturates
the red body and remaps its brightness for White and Neutral (leaving the black outline and the
specular highlights alone, since both are already neutral), and builds each King by drawing the
disc twice with the upper copy raised.

It runs offline and the results are committed like any other sprite, so the game just loads PNGs:

    python scripts/build_checkers_sprites.py      # needs Pillow

Unlike the other pieces, each side here has its own file rather than being tinted from the White
one at runtime (`_makeTinted`). `_drawPieceSprite` still falls back to tinting if a file fails to
load.

## Replacing any of this with human art

Drop a new PNG over the file you want to replace. Nothing else needs to change, and a replaced file
does not have to come from the generator — but **don't re-run the build script afterwards**, or it
will overwrite the five generated names again.

A replacement has to match three things:

- **Square canvas, transparent background.** The game draws a Checkers sprite into a square cell,
  so a non-square image is stretched. These are 320x320; any square size works.
- **The same footprint**, or pieces stop sitting on a common line: the disc is 76% of the canvas
  wide, centred, with the bottom of the piece at 85% of the canvas height. That is the footprint
  the original `sprites/w_checkers.svg` used, and the Pawn's feet line agrees with it.
- **A King that reads as two discs at 120px**, which is the tile the board actually draws. The
  original drawn King was only 14px taller than its Man on a 320 canvas — about five pixels at
  playing size, effectively invisible. The generated Kings raise the upper disc by 38 instead.

Keep the files small: everything loads at startup behind the progress bar.

`_originals/` holds the untouched generator output for all six, and is gitignored. Nothing reads
from it; it is there in case the art needs regenerating at a different size.
