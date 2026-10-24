#!/usr/bin/env python3
"""Compose App Store marketing screenshots: headline + raw simulator capture.

Reads docs/store/screenshots/<lang>/<device>/NN-name.png and writes
docs/store/marketing/<lang>/<device>/NN-name.png at the exact App Store size.
Run from the repo root: python3 scripts/store-screenshots.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs/store/screenshots'
OUT = ROOT / 'docs/store/marketing'
FONTS = ROOT / 'assets/fonts'

SIZES = {'iphone': (1320, 2868), 'ipad': (2064, 2752)}
BG = (246, 245, 242)
INK = (24, 23, 27)
SECONDARY = (106, 103, 96)
ACCENT = (242, 100, 58)

# Matched against the capture's file name (first key contained in the name wins).
CAPTIONS = {
    'es': {
        'home': ('Tu biblioteca, siempre contigo', 'Funciona sin internet'),
        'library': ('Wikipedia, medicina y supervivencia', 'Descarga lo que necesites'),
        'dark': ('También en modo oscuro', 'Lectura cómoda de noche'),
        'reader': ('Lee y busca sin conexión', 'Búsqueda de texto completo'),
        'search': ('Encuentra cualquier cosa', 'Búsqueda en toda tu biblioteca'),
        'map': ('Mapas offline con GPS', 'Recorta cualquier región del mundo'),
        'assistant': ('IA local con fuentes', 'Tus preguntas no salen del móvil'),
        'course': ('Aprende a tu ritmo', 'Cursos educativos sin conexión'),
    },
    'en': {
        'home': ('Your library, always with you', 'Works with no internet'),
        'library': ('Wikipedia, medicine & survival', 'Download what you need'),
        'dark': ('Dark mode included', 'Easy reading at night'),
        'reader': ('Read and search offline', 'Full-text search'),
        'search': ('Find anything', 'Search your whole library'),
        'map': ('Offline maps with GPS', 'Cut any region of the world'),
        'assistant': ('On-device AI with sources', 'Your questions never leave your phone'),
        'course': ('Learn at your own pace', 'Educational courses, offline'),
    },
}


def caption_for(lang: str, name: str):
    for key, text in CAPTIONS[lang].items():
        if key in name:
            return text
    raise SystemExit(f'No caption for {lang}/{name}')


def fit_text(draw, text, font_path, max_size, max_width):
    size = max_size
    while size > 20:
        font = ImageFont.truetype(str(font_path), size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 4
    return ImageFont.truetype(str(font_path), size)


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def compose(src: Path, dst: Path, lang: str, device: str):
    W, H = SIZES[device]
    canvas = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    title, sub = caption_for(lang, src.stem)

    margin = int(W * 0.08)
    top = int(H * 0.055)
    title_font = fit_text(draw, title, FONTS / 'Inter_800ExtraBold.ttf', int(W * 0.072), W - 2 * margin)
    sub_font = fit_text(draw, sub, FONTS / 'Inter_500Medium.ttf', int(W * 0.040), W - 2 * margin)
    # Accent bar above the headline.
    bar_w, bar_h = int(W * 0.07), max(8, int(W * 0.008))
    draw.rounded_rectangle(((W - bar_w) // 2, top, (W + bar_w) // 2, top + bar_h), bar_h // 2, fill=ACCENT)
    y = top + bar_h + int(H * 0.022)
    draw.text((W // 2, y), title, font=title_font, fill=INK, anchor='ma')
    y += title_font.size + int(H * 0.012)
    draw.text((W // 2, y), sub, font=sub_font, fill=SECONDARY, anchor='ma')
    y += sub_font.size + int(H * 0.04)

    shot = Image.open(src).convert('RGB')
    avail_h = H - y - int(H * 0.035)
    avail_w = W - 2 * int(W * (0.10 if device == 'iphone' else 0.09))
    scale = min(avail_w / shot.width, avail_h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    radius = int(shot.width * (0.09 if device == 'iphone' else 0.035))
    shot = rounded(shot, radius)
    x = (W - shot.width) // 2

    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x, y + 18, x + shot.width, y + 18 + shot.height), radius, fill=(24, 23, 27, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(36))
    canvas = Image.alpha_composite(canvas.convert('RGBA'), shadow)
    canvas.alpha_composite(shot, (x, y))
    border = ImageDraw.Draw(canvas)
    border.rounded_rectangle((x, y, x + shot.width - 1, y + shot.height - 1), radius, outline=(227, 224, 217), width=3)

    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert('RGB').save(dst, 'PNG', optimize=True)


def main():
    count = 0
    for src in sorted(SRC.glob('*/*/*.png')):
        lang, device = src.parent.parent.name, src.parent.name
        if lang not in CAPTIONS or device not in SIZES:
            continue
        compose(src, OUT / lang / device / src.name, lang, device)
        count += 1
    print(f'{count} screenshots written to {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
