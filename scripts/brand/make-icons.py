"""Draws the app icon and splash from one vector source (the "B · Brújula" design, 2026-11-02):
a graduated grey bezel, the north half of the needle in signal yellow, the south half in outline,
on the app's near-black. Writes:

  assets/expo.icon/Assets/{ring,needle}.svg   iOS 26 Icon Composer layers (icon.json sets the fill)
  assets/images/icon.png                      1024 px, opaque (App Store, fallbacks)
  assets/images/android-icon-{foreground,background,monochrome}.png   adaptive icon layers
  assets/images/notification-icon.png         96 px white silhouette
  assets/images/splash-icon{,-dark}.png       the glyph on transparent (the splash is dark only)
  site/icon.png, site/favicon.png             the privacy/support site

Colours: bg and accent of src/theme/tokens.ts and the bezel grey #8F8F89. Rerun after changing them.
Needs cairosvg (and the cairo library) and Pillow.
Usage: python3 -I scripts/brand/make-icons.py
"""
import io
import math
import os

import cairosvg
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../..")
BG = "#0C0C0C"
YELLOW = "#FFD60A"
GREY = "#8F8F89"


def bezel(ring):
    """Grey ring with ticks every 15 degrees (longer at 45 and 90), none at north."""
    s = f'<circle cx="512" cy="512" r="336" fill="none" stroke="{ring}" stroke-width="16"/>'
    for d in range(15, 360, 15):
        a = math.radians(d)
        length = 46 if d % 90 == 0 else 30 if d % 45 == 0 else 18
        x1, y1 = 512 + 300 * math.sin(a), 512 - 300 * math.cos(a)
        x2, y2 = 512 + (300 - length) * math.sin(a), 512 - (300 - length) * math.cos(a)
        s += f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{ring}" stroke-width="12"/>'
    return s


def needle(north, south, hub_fill):
    """North marker and north half in yellow, south half in outline, hub ring."""
    return (
        f'<rect x="498" y="150" width="28" height="60" fill="{north}"/>'
        f'<path d="M512 262L588 512H436Z" fill="{north}"/>'
        f'<path d="M436 512H588L512 762Z" fill="none" stroke="{south}" stroke-width="16" stroke-linejoin="miter"/>'
        f'<circle cx="512" cy="512" r="30" fill="{hub_fill}" stroke="{north}" stroke-width="14"/>'
    )


def svg(inner, background=None, scale=1.0):
    """1024 canvas; `scale` shrinks the drawing around the centre (adaptive icon safe zone)."""
    bg = f'<rect width="1024" height="1024" fill="{background}"/>' if background else ""
    g = f'<g transform="translate(512 512) scale({scale}) translate(-512 -512)">{inner}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{bg}{g}</svg>'


def png(source, size, path, opaque=False):
    data = cairosvg.svg2png(bytestring=source.encode(), output_width=size, output_height=size)
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    if opaque:
        img = img.convert("RGB")
    full = os.path.join(ROOT, path)
    img.save(full, optimize=True)
    print(f"{path} {size}px")


def write(path, text):
    with open(os.path.join(ROOT, path), "w") as f:
        f.write(text + "\n")
    print(path)


GLYPH = bezel(GREY) + needle(YELLOW, GREY, BG)
WHITE = bezel("#FFFFFF") + needle("#FFFFFF", "#FFFFFF", "none")
# Android adaptive icons draw a 108 dp layer and show the central 66 dp circle (61 %): the bezel
# (672 of 1024) is shrunk to sit inside it with a little air.
SAFE = 0.86

# iOS 26 Icon Composer layers: the fill colour lives in icon.json.
write("assets/expo.icon/Assets/ring.svg", svg(bezel(GREY)))
write("assets/expo.icon/Assets/needle.svg", svg(needle(YELLOW, GREY, BG)))

png(svg(GLYPH, BG), 1024, "assets/images/icon.png", opaque=True)
png(svg("", BG), 512, "assets/images/android-icon-background.png", opaque=True)
png(svg(GLYPH, None, SAFE), 512, "assets/images/android-icon-foreground.png")
png(svg(WHITE, None, SAFE), 432, "assets/images/android-icon-monochrome.png")
# Notification icons show at 24 dp: the ring and needle only, no ticks.
RING_ONLY = '<circle cx="512" cy="512" r="336" fill="none" stroke="#FFFFFF" stroke-width="40"/>'
png(svg(RING_ONLY + needle("#FFFFFF", "#FFFFFF", "none"), None, 1.3), 96, "assets/images/notification-icon.png")
png(svg(GLYPH), 456, "assets/images/splash-icon-dark.png")
png(svg(GLYPH), 456, "assets/images/splash-icon.png")
png(svg(GLYPH, BG), 256, "site/icon.png", opaque=True)
png(svg(GLYPH, BG), 48, "site/favicon.png", opaque=True)
