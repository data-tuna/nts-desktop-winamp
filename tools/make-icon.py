# Draws the app icon: a pixel-art transistor radio with a green LCD, on a
# 32x32 grid scaled up to 1024 px. No NTS or Winamp marks on purpose.
#   python tools/make-icon.py icon-source.png
#   npx tauri icon icon-source.png
import sys

from PIL import Image

ART = """
................................
.........................KK.....
........................KK......
.......................KK.......
......................KK........
.....................KK.........
....................KK..........
...................KK...........
..KKKKKKKKKKKKKKKKKKKKKKKKKKKK..
.KLLLLLLLLLLLLLLLLLLLLLLLLLLLLK.
.KLHHHHHHHHHHHHHHHHHHHHHHHHHHMK.
.KLHMMMMMMMMMMMMMMMMMMMMMMMMMDK.
.KLHMDDDDDDDDDDDDDDDDDDDDDDDMDK.
.KLHMDggggggggggggggggggggDMMDK.
.KLHMDgggggggggggggGGgggggDMMDK.
.KLHMDggggggggGGgggGGgggggDMMDK.
.KLHMDgGGgggggGGgggGGggGGgDMMDK.
.KLHMDgGGggGGgGGggGGGggGGgDMMDK.
.KLHMDgGGggGGgGGggGGGggGGgDMMDK.
.KLHMDggggggggggggggggggggDMMDK.
.KLHMDDDDDDDDDDDDDDDDDDDDDDDMDK.
.KLHMMMMMMMMMMMMMMMMMMMMMMMMMDK.
.KLHMDMDMDMDMDMDMDMDMMMMOOOMMDK.
.KLHMMMMMMMMMMMMMMMMMMMMOWOMMDK.
.KLHMDMDMDMDMDMDMDMDMMMMOOOMMDK.
.KLHMMMMMMMMMMMMMMMMMMMMMMMMMDK.
.KLHMDMDMDMDMDMDMDMDMMMMMMMMMDK.
.KLMDDDDDDDDDDDDDDDDDDDDDDDDDDK.
..KKKKKKKKKKKKKKKKKKKKKKKKKKKK..
....KKK..................KKK....
................................
................................
"""

COLOURS = {
    ".": (0, 0, 0, 0),
    "K": (16, 16, 24, 255),  # outline
    "L": (189, 189, 204, 255),  # light bevel
    "H": (140, 140, 158, 255),  # highlight
    "M": (90, 90, 108, 255),  # body
    "D": (52, 52, 66, 255),  # shadow, grille holes
    "g": (8, 40, 8, 255),  # LCD background
    "G": (0, 230, 0, 255),  # LCD bars
    "O": (230, 150, 20, 255),  # tuning knob
    "W": (255, 230, 150, 255),  # knob centre
}

rows = ART.strip().splitlines()
assert len(rows) == 32 and all(len(r) == 32 for r in rows), "art must be 32x32"
img = Image.new("RGBA", (32, 32))
img.putdata([COLOURS[c] for row in rows for c in row])
img.resize((1024, 1024), Image.NEAREST).save(sys.argv[1])
