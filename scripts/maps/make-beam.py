"""Draws the compass beam the map shows under the user's position (a fan that fades
with distance, like Google Maps'): assets/maps/beam/beam-<width>-<scheme>@<n>x.png.
<width>: narrow (compass accurate) or wide (uncalibrated, iOS heading accuracy ≥ 35°).
The apex is the bottom centre of the image (the layer anchors it at the position) and
the fan points up (north before icon-rotate). Colour: the `location` token of
src/theme/tokens.ts. Rerun after changing either. Needs Pillow.
Usage: python3 -I scripts/maps/make-beam.py"""
import math
import os

from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../assets/maps/beam")
RADIUS = 88  # points
WIDTHS = {"narrow": 26, "wide": 44}  # half angle, degrees
COLORS = {"light": (0x1A, 0x73, 0xE8), "dark": (0x4C, 0x8D, 0xF6)}
PEAK = {"light": 0.5, "dark": 0.56}
EDGE = 7  # degrees of soft edge


def beam(half, rgb, peak, scale):
    r = RADIUS * scale
    w = math.ceil(2 * r * math.sin(math.radians(half))) + 2 * scale
    img = Image.new("RGBA", (w, r), (0, 0, 0, 0))
    px = img.load()
    cx = w / 2
    for y in range(r):
        for x in range(w):
            dx, dy = x + 0.5 - cx, r - (y + 0.5)
            d = math.hypot(dx, dy)
            if d >= r:
                continue
            ang = abs(math.degrees(math.atan2(dx, dy)))
            if ang >= half:
                continue
            radial = (1 - d / r) ** 1.4
            side = min(1.0, (half - ang) / EDGE)
            side = side * side * (3 - 2 * side)  # smoothstep
            a = peak * radial * side
            px[x, y] = (*rgb, round(255 * a))
    return img


os.makedirs(OUT, exist_ok=True)
for name, half in WIDTHS.items():
    for scheme, rgb in COLORS.items():
        for scale in (1, 2, 3):
            suffix = "" if scale == 1 else f"@{scale}x"
            beam(half, rgb, PEAK[scheme], scale).save(os.path.join(OUT, f"beam-{name}-{scheme}{suffix}.png"), optimize=True)
print("beams in", os.path.normpath(OUT))
