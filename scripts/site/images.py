#!/usr/bin/env python3
"""Build the landing page's images (site/img) from the raw store captures.

Reads docs/store/screenshots/<lang>/iphone/NN-name.png (the same simulator captures
scripts/store-screenshots.py frames for the stores) and writes:
  site/img/screens/<lang>/<key>.webp   phone screens, 600 px wide (shown at ~300 pt, 2x)
  site/img/og-<lang>.jpg               1200 x 630 social card (Open Graph / X)
  site/img/apple-touch-icon.png        180 px, site/img/icon-512.png (manifest, JSON-LD)
A screen missing in one language falls back to the other one, so the page never shows a hole;
rerun after a new round of captures. Extra source folders (laid out like docs/store/screenshots)
can be passed with --extra DIR; they are searched after the store captures.
Run from the repo root: python3 scripts/site/images.py [--extra DIR ...]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / 'docs/store/screenshots'
OUT = ROOT / 'site/img'
FONTS = ROOT / 'assets/fonts'
ICON = ROOT / 'assets/images/icon.png'
LANGS = ('es', 'en')

# Screen key -> words matched against the capture's file name (first match wins).
SCREENS = {
    'home': ('home',),
    'navigation': ('navigation', 'route'),
    'emergency': ('emergency',),
    'firstaid': ('firstaid', 'guide'),
    'assistant': ('assistant',),
    'library': ('library',),
    'plan': ('plan',),
    'kit': ('kit',),
}

# The app's "Precisión" palette (src/theme/tokens.ts).
BG = (12, 12, 12)
SURFACE = (19, 19, 19)
BORDER = (35, 35, 35)
TICK = (90, 90, 90)
TEXT = (242, 242, 239)
SECONDARY = (143, 143, 137)
ACCENT = (255, 214, 10)

OG_TEXT = {
    'es': ('SIN CONEXIÓN · FUNCIONA IGUAL', ['CUANDO SE CAE', 'INTERNET, TU MÓVIL', 'SIGUE SABIENDO.'],
           'Mapas, emergencias, guía, Wikipedia e IA sin red.'),
    'en': ('OFFLINE · STILL WORKS', ['WHEN THE INTERNET', 'GOES DOWN, YOUR', 'PHONE STILL KNOWS.'],
           'Maps, emergency help, guides, Wikipedia and AI with no network.'),
}


def find_capture(lang: str, words, roots):
    order = [lang] + [l for l in LANGS if l != lang]
    for l in order:
        for root in roots:
            folder = root / l / 'iphone'
            if not folder.is_dir():
                continue
            for word in words:
                hits = sorted(p for p in folder.glob('*.png') if word in p.stem)
                if hits:
                    return hits[0]
    return None


def font(name: str, size: int):
    return ImageFont.truetype(str(FONTS / name), size)


def corner_ticks(draw, box, size=18, width=3):
    x0, y0, x1, y1 = box
    draw.line([(x0, y0 + size), (x0, y0), (x0 + size, y0)], fill=TICK, width=width)
    draw.line([(x1 - size, y1), (x1, y1), (x1, y1 - size)], fill=TICK, width=width)


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    out = Image.new('RGBA', img.size)
    out.paste(img, (0, 0), mask)
    return out


def og_card(lang: str, screen: Path | None, dst: Path):
    W, H = 1200, 630
    canvas = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    # Faint technical grid, like the page's hero.
    for x in range(0, W, 40):
        draw.line([(x, 0), (x, H)], fill=(18, 18, 18))
    for y in range(0, H, 40):
        draw.line([(0, y), (W, y)], fill=(18, 18, 18))
    corner_ticks(draw, (28, 28, W - 28, H - 28))

    over, lines, sub = OG_TEXT[lang]
    x = 72
    icon = Image.open(ICON).convert('RGB').resize((64, 64), Image.LANCZOS)
    canvas.paste(icon, (x, 72))
    draw.text((x + 84, 80), 'NOMAD POCKET', font=font('ChakraPetch-Bold.ttf', 30), fill=TEXT)
    draw.rectangle((x + 84, 124, x + 94, 134), fill=ACCENT)
    draw.text((x + 104, 120), over, font=font('IBMPlexMono-Medium.ttf', 17), fill=SECONDARY)

    title = font('ChakraPetch-Bold.ttf', 62)
    y = 200
    for i, line in enumerate(lines):
        draw.text((x, y), line, font=title, fill=ACCENT if i == len(lines) - 1 else TEXT)
        y += 70
    draw.text((x, y + 22), sub, font=font('IBMPlexSans-Regular.ttf', 25), fill=SECONDARY)
    # Yellow bar with the cut corner, the app's key-control shape.
    bx, by, bw, bh, cut = x, y + 82, 150, 12, 10
    draw.polygon([(bx, by), (bx + bw - cut, by), (bx + bw, by + cut), (bx + bw, by + bh), (bx, by + bh)], fill=ACCENT)

    if screen:
        shot = Image.open(screen).convert('RGB')
        pw = 300
        shot = shot.resize((pw, int(pw * shot.height / shot.width)), Image.LANCZOS)
        frame = Image.new('RGB', (pw + 20, shot.height + 20), (26, 26, 26))
        frame = rounded(frame, 52)
        frame.alpha_composite(rounded(shot, 44), (10, 10))
        canvas.paste(frame, (W - pw - 120, 96), frame)
    canvas.save(dst, quality=88, optimize=True, progressive=True)


def main(argv):
    roots = [SRC]
    args = list(argv)
    while '--extra' in args:
        i = args.index('--extra')
        roots.append(Path(args[i + 1]).expanduser().resolve())
        del args[i:i + 2]

    for lang in LANGS:
        folder = OUT / 'screens' / lang
        folder.mkdir(parents=True, exist_ok=True)
        for key, words in SCREENS.items():
            src = find_capture(lang, words, roots)
            if not src:
                print(f'  {lang}/{key}: no capture (the page hides that phone)')
                continue
            img = Image.open(src).convert('RGB')
            img = img.resize((600, round(600 * img.height / img.width)), Image.LANCZOS)
            img.save(folder / f'{key}.webp', quality=82, method=6)
            print(f'  {lang}/{key}: {src.relative_to(src.parents[2])}')
        og_card(lang, find_capture(lang, SCREENS['home'], roots), OUT / f'og-{lang}.jpg')

    icon = Image.open(ICON).convert('RGB')
    icon.resize((180, 180), Image.LANCZOS).save(OUT / 'apple-touch-icon.png', optimize=True)
    icon.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-512.png', optimize=True)
    print('done')


if __name__ == '__main__':
    main(sys.argv[1:])
