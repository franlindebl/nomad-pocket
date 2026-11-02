#!/usr/bin/env python3
"""Compose store marketing screenshots: headline + raw simulator/emulator capture.

Reads docs/store/screenshots/<lang>/<device>/NN-name.png and writes
docs/store/marketing/<lang>/<device>/NN-name.png at the exact App Store size (iphone, ipad) or Google Play's phone size (android: 9:16, as Play
refuses a long side over twice the short one), plus Play's 1024 x 500 feature graphic in
docs/store/play/.
Run from the repo root: python3 scripts/store-screenshots.py [device ...] (iphone, ipad, android; default all)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs/store/screenshots'
OUT = ROOT / 'docs/store/marketing'
FONTS = ROOT / 'assets/fonts'

SIZES = {'iphone': (1320, 2868), 'ipad': (2064, 2752), 'android': (1080, 1920)}
PLAY = ROOT / 'docs/store/play'
ICON = ROOT / 'assets/images/icon.png'
# The app's "Precisión" palette (src/theme/tokens.ts), turned inside out for the store (owner's pick,
# 2026-11-03): the whole frame in signal yellow with black type, so the black app on a black phone stands out.
ACCENT = (255, 214, 10)
BG = ACCENT
INK = (12, 12, 12)
SECONDARY = (58, 52, 20)  # the subtitle: near black, warm, on the yellow
DEVICE = (14, 14, 14)  # the phone's frame around the capture
SHADOW = (60, 50, 0, 110)
TITLE_FONT = FONTS / 'ChakraPetch-Bold.ttf'
SUB_FONT = FONTS / 'IBMPlexSans-Regular.ttf'
CREDIT_FONT = FONTS / 'IBMPlexSans-Medium.ttf'

# Matched against the capture's file name (first key contained in the name wins). Chosen by the owner
# 2026-11-03 for 2.0.0.
CAPTIONS = {
    'es': {
        'home': ('Si hay un apagón, estás preparado', 'Mapas, emergencias y guías offline'),
        'emergency': ('Busca el hospital más cercano, sin red', 'Farmacias, agua potable y refugios a tu alrededor'),
        'navigation': ('Funciona sin internet. Siempre.', 'Rutas guiadas por voz, incluso con la pantalla bloqueada'),
        'address': ('Encuentra cualquier calle', 'Hasta el número de portal, sin internet'),
        'firstaid': ('Qué hacer, paso a paso', 'Más de 200 fichas de fuentes oficiales'),
        'assistant': ('Una IA que vive en tu móvil', 'Responde sin internet y cita sus fuentes'),
        'plan': ('Tu familia sabe qué hacer', 'Puntos de encuentro, contactos y datos médicos'),
        'library': ('Wikipedia offline, en tu bolsillo', 'Medicina, supervivencia, cursos y más'),
        'kit': ('Listo en un minuto', 'Elige tu país y descarga tu kit'),
    },
    'en': {
        'home': ('Ready for the next blackout', 'Maps, emergency help and guides, offline'),
        'emergency': ('Find the nearest hospital, offline', 'Pharmacies, drinking water and shelters around you'),
        'navigation': ('Works without internet. Always.', 'Voice-guided routes, even with the screen locked'),
        'address': ('Find any street', 'Down to the house number, no internet'),
        'firstaid': ('What to do, step by step', '200+ cards from official sources'),
        'assistant': ('An AI that lives on your phone', 'Answers without internet and cites its sources'),
        'plan': ('Your family knows what to do', 'Meeting points, contacts and medical details'),
        'library': ('Wikipedia offline, in your pocket', 'Medicine, survival, courses and more'),
        'kit': ('Ready in a minute', 'Pick your country and download your kit'),
    },
}


# Screens that show the map carry the OpenStreetMap credit under the phone: the in-app pill fades
# after five seconds (MapCredit), and OSMF's guidelines accept the credit next to a map image.
MAP_SHOTS = ('navigation', 'route', 'emergency')
OSM_CREDIT = {'es': 'Mapa © colaboradores de OpenStreetMap', 'en': 'Map © OpenStreetMap contributors'}


# Google Play: the Android build has no health features (src/lib/health.ts), so no first aid, medicine
# or medical details; its 04 screen is a survival guide instead of first aid.
ANDROID_CAPTIONS = {
    'es': {
        'guides': ('Guías de supervivencia, sin red', 'Agua, refugio, nudos y mucho más'),
        'plan': ('Tu familia sabe qué hacer', 'Puntos de encuentro, contactos y números clave'),
        'library': ('Wikipedia offline, en tu bolsillo', 'Supervivencia, agua, cursos y más'),
    },
    'en': {
        'guides': ('Survival guides, offline', 'Water, shelter, knots and much more'),
        'plan': ('Your family knows what to do', 'Meeting points, contacts and key numbers'),
        'library': ('Wikipedia offline, in your pocket', 'Survival, water, courses and more'),
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


def wrap_text(draw, text, font_path, max_size, max_width, max_lines=2):
    """The biggest size at which `text` fits in `max_lines` lines, balanced (no lonely last word)."""
    words = text.split()
    size = max_size
    while size > 20:
        font = ImageFont.truetype(str(font_path), size)
        if draw.textlength(text, font=font) <= max_width:
            return font, [text]
        if max_lines > 1:
            # Two lines: the split whose longer line is shortest.
            best = None
            for i in range(1, len(words)):
                lines = [' '.join(words[:i]), ' '.join(words[i:])]
                widest = max(draw.textlength(line, font=font) for line in lines)
                if widest <= max_width and (best is None or widest < best[0]):
                    best = (widest, lines)
            if best:
                return font, best[1]
        size -= 4
    return ImageFont.truetype(str(font_path), size), [text]


def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, *img.size), radius, fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask)
    return out


def chamfer_bar(draw, x0, y0, x1, y1, fill):
    """A bar with its top-right corner cut, like the app's key buttons."""
    cut = (y1 - y0)
    draw.polygon([(x0, y0), (x1 - cut, y0), (x1, y0 + cut), (x1, y1), (x0, y1)], fill=fill)


def compose(src: Path, dst: Path, lang: str, device: str):
    W, H = SIZES[device]
    canvas = Image.new('RGBA', (W, H), BG + (255,))
    draw = ImageDraw.Draw(canvas)
    title, sub = caption_for(lang, src.stem, device)

    margin = int(W * 0.08)
    top = int(H * 0.05)
    # Type scales with the width; the iPad's is wide and short, so it takes smaller factors.
    title_k, sub_k = (0.052, 0.026) if device == 'ipad' else (0.078, 0.038)
    title_font, lines = wrap_text(draw, title.upper(), TITLE_FONT, int(W * title_k), W - 2 * margin)
    sub_font = fit_text(draw, sub, SUB_FONT, int(W * sub_k), W - 2 * margin)
    # The header always takes the room of a two-line headline at full size, so every phone in the set
    # sits at the same height and size; shorter headlines are centred in that room.
    bar_w, bar_h = int(W * 0.09), max(10, int(W * 0.011))
    line_h = int(title_font.size * 1.08)
    gap_bar, gap_sub = int(H * 0.024), int(H * 0.016)
    block = bar_h + gap_bar + line_h * len(lines) + gap_sub + sub_font.size
    room = bar_h + gap_bar + int(int(W * title_k) * 1.08) * 2 + gap_sub + int(W * sub_k)
    y = top + max(0, room - block) // 2
    # The black mark above the headline, cut like the app's key controls.
    chamfer_bar(draw, (W - bar_w) // 2, y, (W + bar_w) // 2, y + bar_h, INK)
    y += bar_h + gap_bar
    for line in lines:
        draw.text((W // 2, y), line, font=title_font, fill=INK, anchor='ma')
        y += line_h
    y += gap_sub
    draw.text((W // 2, y), sub, font=sub_font, fill=SECONDARY, anchor='ma')
    y = top + max(room, block) + int(H * 0.045)

    # The capture inside a plain black phone: a bezel all round, the screen's own corners rounded.
    bezel = int(W * 0.02)
    shot = Image.open(src).convert('RGB')
    avail_h = H - y - int(H * 0.04) - 2 * bezel
    avail_w = W - 2 * int(W * (0.10 if device == 'ipad' else 0.12)) - 2 * bezel
    scale = min(avail_w / shot.width, avail_h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    radius = int(shot.width * {'iphone': 0.09, 'android': 0.06}.get(device, 0.035))
    x = (W - shot.width) // 2
    frame = (x - bezel, y, x + shot.width + bezel, y + shot.height + 2 * bezel)
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((frame[0], frame[1] + 30, frame[2], frame[3] + 30), radius + bezel, fill=SHADOW)
    canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(60)))
    over = ImageDraw.Draw(canvas)
    over.rounded_rectangle(frame, radius + bezel, fill=DEVICE)
    canvas.alpha_composite(rounded(shot, radius), (x, y + bezel))
    if any(key in src.stem for key in MAP_SHOTS):
        credit_font = ImageFont.truetype(str(CREDIT_FONT), int(W * 0.02))
        over.text((W // 2, (frame[3] + H) // 2), OSM_CREDIT[lang], font=credit_font, fill=SECONDARY, anchor='mm')

    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert('RGB').save(dst, 'PNG', optimize=True)


FEATURE = {
    'es': ('Si hay un apagón, estás preparado', 'Mapas, emergencias, Wikipedia e IA offline'),
    'en': ('Ready for the next blackout', 'Maps, emergency help, Wikipedia and AI, offline'),
}


def play_graphics():
    """Play's 512 px icon and a 1024 x 500 feature graphic per language (no alpha, as Play asks)."""
    PLAY.mkdir(parents=True, exist_ok=True)
    icon = Image.open(ICON).convert('RGB')
    icon.resize((512, 512), Image.LANCZOS).save(PLAY / 'icon-512.png', 'PNG', optimize=True)
    W, H = 1024, 500
    for lang, (title, sub) in FEATURE.items():
        canvas = Image.new('RGB', (W, H), BG)
        draw = ImageDraw.Draw(canvas)
        side = 240
        mark = rounded(icon.resize((side, side), Image.LANCZOS), 52)
        canvas.paste(mark, (72, (H - side) // 2), mark)
        left = 72 + side + 56
        width = W - left - 64
        title_font, lines = wrap_text(draw, title.upper(), TITLE_FONT, 64, width)
        sub_font = fit_text(draw, sub, SUB_FONT, 28, width)
        bar_h, line_h = 10, int(title_font.size * 1.08)
        block = bar_h + 24 + line_h * len(lines) + 14 + sub_font.size
        y = (H - block) // 2
        chamfer_bar(draw, left, y, left + 84, y + bar_h, INK)
        y += bar_h + 24
        for line in lines:
            draw.text((left, y), line, font=title_font, fill=INK)
            y += line_h
        y += 14
        draw.text((left, y), sub, font=sub_font, fill=SECONDARY)
        canvas.save(PLAY / f'feature-{lang}.png', 'PNG', optimize=True)


def main():
    count = 0
    devices = sys.argv[1:] or list(SIZES)
    for src in sorted(SRC.glob('*/*/*.png')):
        lang, device = src.parent.parent.name, src.parent.name
        if lang not in CAPTIONS or device not in devices:
            continue
        compose(src, OUT / lang / device / src.name, lang, device)
        count += 1
    print(f'{count} screenshots written to {OUT.relative_to(ROOT)}')
    if 'android' in devices:
        play_graphics()
        print(f'Play icon and feature graphics written to {PLAY.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
