"""Pack the offline map glyphs + sprites into one zip for the app bundle.
usage: python3 -I make-zip.py <assets-dl dir> <out.zip>
"""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
# The licences that travel with the glyphs and sprites (the same texts as the Credits screen).
LICENSES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "licenses", "texts")
COMMON = [
    "0-255", "256-511", "512-767", "768-1023", "1024-1279",  # Latin, Latin Ext, IPA, Greek, Cyrillic
    "1280-1535", "1536-1791", "1792-2047",  # Armenian + Hebrew, Arabic, Syriac + Arabic Supplement
    "7680-7935", "8192-8447", "8448-8703",  # Latin Ext Additional, punctuation, letterlike
    "64256-64511", "64512-64767", "64768-65023", "65024-65279",  # Hebrew/Arabic presentation forms
]
EXTRA = ["3584-3839", "4096-4351", "4608-4863", "4864-5119"]  # Thai + Lao, Georgian + Myanmar, Ethiopic
# Keep in sync with FONT_RANGES in dl-assets.mjs. Italic (water labels) has no Thai/Georgian/
# Ethiopic glyphs upstream. Devanagari comes pre-shaped by Protomaps into the Private Use Area
# (62720-63743) of its own font, which the style uses for Devanagari names.
FONT_RANGES = {
    "Noto Sans Regular": COMMON + EXTRA,
    "Noto Sans Medium": COMMON + EXTRA,
    "Noto Sans Italic": COMMON,
    "Noto Sans Devanagari Regular v1": ["0-255", "2304-2559", "62720-62975", "62976-63231", "63232-63487", "63488-63743"],
}
NOTICE = """Offline map assets for Nomad Pocket.
Glyphs: Noto Sans (SIL Open Font License 1.1, OFL.txt), as SDF PBF ranges from protomaps/basemaps-assets.
Sprites: protomaps/basemaps-assets sprites/v4 (light, dark), Tangrams icons (MIT, LICENSE-sprites.txt).
Ranges included: Latin, Latin Extended A/B, IPA, Greek, Cyrillic, Armenian, Hebrew, Arabic,
Syriac, Arabic Supplement, Thai, Lao, Georgian, Myanmar, Ethiopic, Latin Extended Additional,
General Punctuation, Letterlike Symbols, Hebrew and Arabic presentation forms, and
Devanagari (Protomaps' pre-shaped Noto Sans Devanagari). Other ranges get empty placeholders on device
(src/features/maps/glyphs.ts).
"""
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("NOTICE.txt", NOTICE)
    z.write(os.path.join(LICENSES, "noto-sans-OFL.txt"), "OFL.txt")
    z.write(os.path.join(LICENSES, "tangrams-icons.txt"), "LICENSE-sprites.txt")
    for f, ranges in FONT_RANGES.items():
        for r in ranges:
            z.write(os.path.join(src, "fonts", f, r + ".pbf"), f"fonts/{f}/{r}.pbf")
    for name in ["light", "dark"]:
        for s in ["", "@2x"]:
            for e in ["json", "png"]:
                z.write(os.path.join(src, "sprites", f"{name}{s}.{e}"), f"sprites/{name}{s}.{e}")
print(out, os.path.getsize(out))
