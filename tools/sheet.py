import sys
from PIL import Image
# usage: sheet.py out.jpg cols w h img1 img2 ...
out, cols, w, h = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
files = sys.argv[5:]
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h), (8, 8, 8))
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB"); im.thumbnail((w, h))
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out, quality=88)
print(out, sheet.size)
