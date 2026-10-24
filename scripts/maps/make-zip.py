"""Pack the offline map glyphs + sprites into one zip for the app bundle.
usage: python3 -I make-zip.py <assets-dl dir> <out.zip>
"""
import os
import sys
import zipfile

src, out = sys.argv[1], sys.argv[2]
RANGES = [
    "0-255", "256-511", "512-767", "768-1023", "1024-1279",  # Latin, Latin Ext, IPA, Greek, Cyrillic
    "1280-1535", "1536-1791", "1792-2047",  # Armenian + Hebrew, Arabic, Syriac + Arabic Supplement
    "7680-7935", "8192-8447", "8448-8703",  # Latin Ext Additional, punctuation, letterlike
    "64256-64511", "64512-64767", "64768-65023", "65024-65279",  # Hebrew/Arabic presentation forms
]
FONTS = ["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]
NOTICE = """Offline map assets for Nomad Pocket.
Glyphs: Noto Sans (SIL Open Font License 1.1), as SDF PBF ranges from protomaps/basemaps-assets.
Sprites: protomaps/basemaps-assets sprites/v4 (light, dark).
Ranges included: Latin, Latin Extended A/B, IPA, Greek, Cyrillic, Armenian, Hebrew, Arabic,
Syriac, Arabic Supplement, Latin Extended Additional, General Punctuation, Letterlike Symbols,
Hebrew and Arabic presentation forms. Other ranges get empty placeholders on device
(src/features/maps/glyphs.ts).
"""
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("NOTICE.txt", NOTICE)
    for f in FONTS:
        for r in RANGES:
            z.write(os.path.join(src, "fonts", f, r + ".pbf"), f"fonts/{f}/{r}.pbf")
    for name in ["light", "dark"]:
        for s in ["", "@2x"]:
            for e in ["json", "png"]:
                z.write(os.path.join(src, "sprites", f"{name}{s}.{e}"), f"sprites/{name}{s}.{e}")
print(out, os.path.getsize(out))
