"""Draws the three icon options as SVG, and the app's PNG icons from the chosen one.
Run from the repo root:  python3 icons/options/make.py [page|book|receipt|coins|wallet|split|pencil]   (default: page)
Each icon is a list of shapes on a 512x512 canvas, so the SVG and the PNGs always match."""
import sys
from PIL import Image, ImageDraw

INK, PAPER, BLUE, RULE, RED = "#1b2a49", "#fdf8ea", "#2f6fdc", "#a9bddf", "#c0504d"

def plus(x, y, s, w, c):  return [("line", x - s, y, x + s, y, w, c), ("line", x, y - s, x, y + s, w, c)]
def minus(x, y, s, w, c): return [("line", x - s, y, x + s, y, w, c)]

import math
GOLD, GOLD_D, FOLD, PINK = "#f2b632", "#c98a12", "#c9d6ef", "#e98f8f"

def quad(x1, y1, x2, y2, w):                 # a straight bar from (x1,y1) to (x2,y2), w wide
    dx, dy = x2 - x1, y2 - y1; n = math.hypot(dx, dy); ox, oy = -dy / n * w / 2, dx / n * w / 2
    return [(x1 + ox, y1 + oy), (x2 + ox, y2 + oy), (x2 - ox, y2 - oy), (x1 - ox, y1 - oy)]
def sector(cx, cy, r, a0, a1):
    return [(cx, cy)] + [(round(cx + r * math.cos(math.radians(a))), round(cy + r * math.sin(math.radians(a)))) for a in range(a0, a1 + 1, 6)]
def teeth(x_right, x_left, y, h, n):         # zigzag bottom edge of a receipt, right to left
    step = (x_right - x_left) / n
    return [(round(x_right - step * (i + 0.5)), y + h if i % 1 == 0 else y) for i in range(n) for _ in [0]] and \
           [pt for i in range(n) for pt in ((round(x_right - step * (i + 0.5)), y + h), (round(x_right - step * (i + 1)), y))]

ICONS = {
    # Page: the clean page with a folded corner and "=" (the one you liked)
    "page": (BLUE, [
        ("poly", [(136, 96), (316, 96), (376, 156), (376, 416), (136, 416)], PAPER),
        ("poly", [(316, 96), (316, 156), (376, 156)], FOLD),
        ("line", 188, 236, 324, 236, 34, INK), ("line", 188, 306, 324, 306, 34, INK),
    ]),
    # Book: a closed notebook with a gold ribbon bookmark
    "book": (INK, [
        ("rrect", 140, 92, 372, 420, 30, PAPER),
        ("line", 184, 92, 184, 420, 10, FOLD),
        ("poly", [(296, 92), (338, 92), (338, 452), (317, 430), (296, 452)], GOLD),
        ("line", 214, 214, 262, 214, 20, INK), ("line", 214, 262, 262, 262, 20, INK),
    ]),
    # Receipt: a till slip with a torn edge and a total line
    "receipt": (BLUE, [
        ("poly", [(150, 80), (362, 80), (362, 404)] + teeth(362, 150, 404, 26, 6), PAPER),
        ("line", 196, 150, 316, 150, 16, INK), ("line", 196, 198, 286, 198, 16, INK), ("line", 196, 246, 302, 246, 16, INK),
        ("line", 196, 302, 316, 302, 6, INK),
        ("line", 236, 346, 316, 346, 20, BLUE),
    ]),
    # Coins: a short stack of coins
    "coins": (BLUE, [
        *[x for (y, dx) in ((330, -14), (262, 14), (194, -4)) for x in (
            ("rrect", 150 + dx, y, 362 + dx, y + 66, 33, GOLD_D),
            ("rrect", 150 + dx, y, 362 + dx, y + 50, 25, GOLD))],
    ]),
    # Wallet: a wallet with its clasp
    "wallet": (BLUE, [
        ("rrect", 124, 124, 352, 214, 30, FOLD),
        ("rrect", 104, 160, 408, 396, 40, PAPER),
        ("rrect", 300, 236, 428, 320, 34, INK),
        ("circle", 344, 278, 15, GOLD),
    ]),
    # Split: a budget circle with one slice taken out
    "split": (INK, [
        ("poly", sector(256, 264, 148, 0, 270), PAPER),
        ("poly", sector(276, 244, 148, 270, 360), GOLD),
    ]),
    # Pencil: a pencil drawing a double "total" underline
    "pencil": (BLUE, [
        ("poly", quad(214, 300, 360, 154, 62), GOLD),
        ("poly", quad(360, 154, 392, 122, 62), PINK),
        ("poly", [quad(214, 300, 360, 154, 62)[0], quad(214, 300, 360, 154, 62)[3], (166, 348)], PAPER),
        ("poly", [(182, 312), (202, 332), (166, 348)], INK),
        ("line", 110, 400, 330, 400, 16, PAPER), ("line", 110, 436, 330, 436, 16, PAPER),
    ]),
}

def svg(bg, shapes, rounded=True):
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
           f'<rect width="512" height="512" rx="{112 if rounded else 0}" fill="{bg}"/>']
    for s in shapes:
        k = s[0]
        if k == "line":
            _, x1, y1, x2, y2, w, c = s
            out.append(f'<path d="M{x1} {y1}L{x2} {y2}" stroke="{c}" stroke-width="{w}" stroke-linecap="round"/>')
        elif k == "rrect":
            _, x1, y1, x2, y2, r, c = s
            out.append(f'<rect x="{x1}" y="{y1}" width="{x2-x1}" height="{y2-y1}" rx="{r}" fill="{c}"/>')
        elif k == "ring":
            _, x, y, r, w, c = s
            out.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{c}" stroke-width="{w}"/>')
        elif k == "circle":
            _, x, y, r, c = s
            out.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{c}"/>')
        elif k == "poly":
            _, pts, c = s
            out.append(f'<path d="M{"L".join(f"{a} {b}" for a, b in pts)}Z" fill="{c}"/>')
    out.append("</svg>")
    return "\n".join(out) + "\n"

def png(bg, shapes, size, rounded, inset=1.0):
    S = 4 * size / 512                       # draw 4x bigger, then shrink: smooth edges
    big = 4 * size
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded: d.rounded_rectangle([0, 0, big - 1, big - 1], radius=112 * S, fill=bg)
    else: d.rectangle([0, 0, big, big], fill=bg)
    off = 256 * (1 - inset)
    P = lambda v: (off + v * inset) * S
    for s in shapes:
        k = s[0]
        if k == "line":
            _, x1, y1, x2, y2, w, c = s
            r = w * inset * S / 2
            d.line([P(x1), P(y1), P(x2), P(y2)], fill=c, width=round(2 * r))
            for x, y in ((x1, y1), (x2, y2)): d.ellipse([P(x) - r, P(y) - r, P(x) + r, P(y) + r], fill=c)
        elif k == "rrect":
            _, x1, y1, x2, y2, r, c = s
            d.rounded_rectangle([P(x1), P(y1), P(x2), P(y2)], radius=r * inset * S, fill=c)
        elif k == "ring":
            _, x, y, r, w, c = s
            d.ellipse([P(x - r), P(y - r), P(x + r), P(y + r)], outline=c, width=round(w * inset * S))
        elif k == "circle":
            _, x, y, r, c = s
            d.ellipse([P(x - r), P(y - r), P(x + r), P(y + r)], fill=c)
        elif k == "poly":
            _, pts, c = s
            d.polygon([(P(a), P(b)) for a, b in pts], fill=c)
    return img.resize((size, size), Image.LANCZOS)

if __name__ == "__main__":
    for key, (bg, shapes) in ICONS.items():
        open(f"icons/options/option-{key}.svg", "w").write(svg(bg, shapes))
    key = (sys.argv[1:] or ["page"])[0]
    bg, shapes = ICONS[key]
    open("icons/icon-rounded.svg", "w").write(svg(bg, shapes))
    open("icons/icon.svg", "w").write(svg(bg, shapes, rounded=False))
    for n in (192, 512): png(bg, shapes, n, True).save(f"icons/icon-{n}.png")
    for n in (192, 512): png(bg, shapes, n, False, inset=0.8).save(f"icons/icon-maskable-{n}.png")   # safe zone for Android shapes
    png(bg, shapes, 180, False).convert("RGB").save("icons/apple-touch-icon.png")
    print("icons made from option", key)
