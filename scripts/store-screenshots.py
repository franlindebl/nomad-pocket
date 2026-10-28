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
        'home': ('Si cae internet, tú sigues', 'Tu kit de supervivencia, siempre a mano'),
        'emergency': ('El hospital más cercano, sin red', 'Farmacias, agua potable y refugios cerca'),
        'route': ('Mapas que no se apagan', 'Rutas en coche, a pie y en bici sin conexión'),
        'address': ('Encuentra cualquier calle', 'Hasta el número de portal, sin internet'),
        'firstaid': ('Primeros auxilios al instante', 'Guías médicas y de supervivencia offline'),
        'assistant': ('Una IA que no necesita internet', 'Responde con tu biblioteca y cita fuentes'),
        'plan': ('Tu plan familiar, a mano', 'Puntos de encuentro, contactos y datos médicos'),
        'library': ('Todo el conocimiento, sin red', 'Wikipedia, medicina, supervivencia y más'),
        'kit': ('Listo en un minuto', 'Elige tu país y descarga tu kit'),
    },
    'en': {
        'home': ('When the internet fails, you don\'t', 'Your survival kit, always at hand'),
        'emergency': ('The nearest hospital, offline', 'Pharmacies, drinking water and shelters nearby'),
        'route': ('Maps that never switch off', 'Offline routes by car, on foot and by bike'),
        'address': ('Find any street', 'Down to the house number, no internet'),
        'firstaid': ('First aid in seconds', 'Medical and survival guides, offline'),
        'assistant': ('An AI that needs no internet', 'Answers from your library, with sources'),
        'plan': ('Your family plan, at hand', 'Meeting points, contacts and medical details'),
        'library': ('All the knowledge, no network', 'Wikipedia, medicine, survival and more'),
        'kit': ('Ready in a minute', 'Pick your country and download your kit'),
    },
}


# Screens that show the map carry the OpenStreetMap credit under the phone: the in-app pill fades
# after five seconds (MapCredit), and OSMF's guidelines accept the credit next to a map image.
MAP_SHOTS = ('route', 'emergency')
OSM_CREDIT = {'es': 'Mapa © colaboradores de OpenStreetMap', 'en': 'Map © OpenStreetMap contributors'}


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
    if any(key in src.stem for key in MAP_SHOTS):
        credit_font = ImageFont.truetype(str(FONTS / 'Inter_500Medium.ttf'), int(W * 0.022))
        border.text((W // 2, (y + shot.height + H) // 2), OSM_CREDIT[lang], font=credit_font, fill=SECONDARY, anchor='mm')

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
