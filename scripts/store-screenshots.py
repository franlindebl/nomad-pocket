#!/usr/bin/env python3
"""Compose store marketing screenshots: headline + raw simulator/emulator capture.

Reads docs/store/screenshots/<lang>/<device>/NN-name.png and writes
docs/store/marketing/<lang>/<device>/NN-name.png at the exact App Store size (iphone, ipad) or Google Play's phone size (android: 9:16, as Play
refuses a long side over twice the short one), plus Play's 1024 x 500 feature graphic in
docs/store/play/.
Run from the repo root: python3 scripts/store-screenshots.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs/store/screenshots'
OUT = ROOT / 'docs/store/marketing'
FONTS = ROOT / 'assets/fonts'

SIZES = {'iphone': (1320, 2868), 'ipad': (2064, 2752), 'android': (1080, 1920)}
PLAY = ROOT / 'docs/store/play'
ICON = ROOT / 'assets/images/icon.png'
DARK = (24, 23, 27)
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


# Google Play: the Android build has no health features (src/lib/health.ts), so no first aid, medicine
# or medical details; its 04 screen is a survival guide instead of first aid.
ANDROID_CAPTIONS = {
    'es': {
        'guides': ('Guías de supervivencia, sin red', 'Agua, refugio, nudos y mucho más'),
        'plan': ('Tu plan familiar, a mano', 'Puntos de encuentro, contactos y números clave'),
        'library': ('Todo el conocimiento, sin red', 'Wikipedia, supervivencia, bricolaje y más'),
    },
    'en': {
        'guides': ('Survival guides, offline', 'Water, shelter, knots and much more'),
        'plan': ('Your family plan, at hand', 'Meeting points, contacts and key numbers'),
        'library': ('All the knowledge, no network', 'Wikipedia, survival, DIY and more'),
    },
}


def caption_for(lang: str, name: str, device: str):
    captions = {**CAPTIONS[lang], **ANDROID_CAPTIONS[lang]} if device == 'android' else CAPTIONS[lang]
    for key, text in captions.items():
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
    title, sub = caption_for(lang, src.stem, device)

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
    avail_w = W - 2 * int(W * (0.09 if device == 'ipad' else 0.10))
    scale = min(avail_w / shot.width, avail_h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    radius = int(shot.width * {'iphone': 0.09, 'android': 0.06}.get(device, 0.035))
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


FEATURE = {
    'es': ('Si cae internet, tú sigues', 'Mapas, emergencias, Wikipedia e IA sin conexión'),
    'en': ("When the internet fails, you don't", 'Maps, emergency help, Wikipedia and AI, offline'),
}


def play_graphics():
    """Play's 512 px icon and a 1024 x 500 feature graphic per language (no alpha, as Play asks)."""
    PLAY.mkdir(parents=True, exist_ok=True)
    icon = Image.open(ICON).convert('RGB')
    icon.resize((512, 512), Image.LANCZOS).save(PLAY / 'icon-512.png', 'PNG', optimize=True)
    W, H = 1024, 500
    for lang, (title, sub) in FEATURE.items():
        canvas = Image.new('RGB', (W, H), DARK)
        draw = ImageDraw.Draw(canvas)
        side = 220
        mark = rounded(icon.resize((side, side), Image.LANCZOS), 48)
        canvas.paste(mark, (72, (H - side) // 2), mark)
        left = 72 + side + 56
        width = W - left - 64
        title_font = fit_text(draw, title, FONTS / 'Inter_800ExtraBold.ttf', 60, width)
        sub_font = fit_text(draw, sub, FONTS / 'Inter_500Medium.ttf', 30, width)
        bar_h = 8
        block = bar_h + 24 + title_font.size + 18 + sub_font.size
        y = (H - block) // 2
        draw.rounded_rectangle((left, y, left + 72, y + bar_h), bar_h // 2, fill=ACCENT)
        y += bar_h + 24
        draw.text((left, y), title, font=title_font, fill=BG)
        y += title_font.size + 18
        draw.text((left, y), sub, font=sub_font, fill=(186, 182, 173))
        canvas.save(PLAY / f'feature-{lang}.png', 'PNG', optimize=True)


def main():
    count = 0
    for src in sorted(SRC.glob('*/*/*.png')):
        lang, device = src.parent.parent.name, src.parent.name
        if lang not in CAPTIONS or device not in SIZES:
            continue
        compose(src, OUT / lang / device / src.name, lang, device)
        count += 1
    print(f'{count} screenshots written to {OUT.relative_to(ROOT)}')
    play_graphics()
    print(f'Play icon and feature graphics written to {PLAY.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
