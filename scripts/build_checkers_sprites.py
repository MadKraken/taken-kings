"""Generate the Checkers Warrior sprites from the single red Checkers Man.

    python scripts/build_checkers_sprites.py          (needs Pillow: pip install pillow)

`sprites/ai-generated/checkers_b.png` is the only authored Checkers sprite. The other five are
built from it, so the whole set shares one perspective, one lighting setup and one outline weight.
The generated files are committed like any other sprite, so the game loads plain PNGs and a human
artist can still replace any single file by hand -- running this script again would overwrite them,
which is the point at which you stop running it.

Two operations:

  recolour   Every pixel is driven to neutral grey, then the body's brightness is remapped -- up
             for White, to the middle for Neutral. The remap fades in with saturation, so the black
             outline and the white specular highlights, which are already neutral, keep their own
             values and only the red body moves. The result measures a zero channel spread: no red
             fringing survives anywhere.

  stack      A King is the same disc drawn twice, the upper copy raised, so the lower one shows
             only its rim. STACK_DY is deliberately larger than the height difference in the
             original drawn King (14px), which is nearly invisible at the 120px tile the board
             actually draws: at 44 the two discs read clearly at playing size.
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

ART = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sprites', 'ai-generated')
SOURCE = 'checkers_b.png'      # the one authored sprite; everything else is derived from it

STACK_DY = 44                  # how far the upper disc of a King is raised, in source pixels
WHITE_RANGE = (0.62, 1.00)     # body brightness remapped into this range for the White side
GREY_RANGE = (0.34, 0.78)      # ... and this one for Neutral
SAT_KNEE = 0.22                # saturation at which a pixel counts as fully "body"


def recolour(im, lo, hi):
    """Desaturate, and remap the coloured body's brightness into [lo, hi]."""
    out = im.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            mx, mn = max(r, g, b), min(r, g, b)
            s = 0.0 if mx == 0 else (mx - mn) / mx
            v = mx / 255.0
            t = min(1.0, s / SAT_KNEE)
            t = t * t * (3 - 2 * t)                     # smoothstep: no hard edge at the knee
            nv = v * (1 - t) + (lo + (hi - lo) * v) * t
            level = max(0, min(255, round(nv * 255)))
            px[x, y] = (level, level, level, a)
    return out


def stack(man, dy):
    """A King: the disc on the feet line, and a second copy of it raised by dy."""
    upper = Image.new('RGBA', man.size, (0, 0, 0, 0))
    # Plain paste, NOT paste(..., mask=man): pasting with a mask onto a transparent canvas blends
    # every antialiased pixel toward (0,0,0,0) -- it halved the alpha of the disc's rim and dragged
    # its colour to black, leaving a chewed dark halo along the upper disc. A straight copy moves
    # the pixels untouched, and alpha_composite then does the actual over-compositing.
    upper.paste(man, (0, -dy))
    return Image.alpha_composite(man, upper)


def main():
    src_path = os.path.join(ART, SOURCE)
    if not os.path.exists(src_path):
        sys.exit(f'missing source sprite: {src_path}')
    man_b = Image.open(src_path).convert('RGBA')

    men = {
        'checkers_w.png': recolour(man_b, *WHITE_RANGE),
        'checkers_n.png': recolour(man_b, *GREY_RANGE),
    }
    kings = {
        'checkers_king_b.png': stack(man_b, STACK_DY),
        'checkers_king_w.png': stack(men['checkers_w.png'], STACK_DY),
        'checkers_king_n.png': stack(men['checkers_n.png'], STACK_DY),
    }

    total = 0
    for name, im in list(men.items()) + list(kings.items()):
        dst = os.path.join(ART, name)
        im.save(dst, 'PNG', optimize=True)
        kb = os.path.getsize(dst) / 1024
        total += kb
        print(f'  {name:22s} {im.size[0]}x{im.size[1]}  {kb:6.1f} KB')

    src_kb = os.path.getsize(src_path) / 1024
    print(f'\n  {SOURCE:22s} {man_b.size[0]}x{man_b.size[1]}  {src_kb:6.1f} KB  (source, untouched)')
    print(f'\ngenerated 5 sprites, {total:.0f} KB; set total {total + src_kb:.0f} KB')

    # The derivation is only honest if no red survives in the neutral sides.
    for name in ('checkers_w.png', 'checkers_n.png'):
        im = Image.open(os.path.join(ART, name)).convert('RGBA')
        px = im.load()
        worst = 0
        for y in range(im.height):
            for x in range(im.width):
                r, g, b, a = px[x, y]
                if a > 8:
                    worst = max(worst, max(r, g, b) - min(r, g, b))
        status = 'neutral' if worst == 0 else f'RESIDUAL COLOUR CAST: {worst}'
        print(f'  {name:22s} channel spread {worst}  ({status})')


if __name__ == '__main__':
    main()
