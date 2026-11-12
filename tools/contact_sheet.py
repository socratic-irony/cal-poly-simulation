import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 7
cell = 200
files = sorted(glob.glob(os.path.join(src, "*.png")) + glob.glob(os.path.join(src, "*.jpg")))
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell, rows * (cell + 16)), (30, 30, 30))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 12)
except Exception:
    font = ImageFont.load_default()
for i, f in enumerate(files):
    try:
        im = Image.open(f).convert("RGB").resize((cell - 4, cell - 4))
    except Exception as e:
        continue
    x, y = (i % cols) * cell, (i // cols) * (cell + 16)
    sheet.paste(im, (x + 2, y + 2))
    d.text((x + 4, y + cell - 2), os.path.splitext(os.path.basename(f))[0], fill=(255, 255, 255), font=font)
sheet.save(out, quality=88)
print(len(files), "->", out, sheet.size)
