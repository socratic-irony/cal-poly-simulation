"""Per-building roof colour check: an orthographic top-down render vs the registered USGS aerial.
   usage: .venv/bin/python -I tools/calib_roofs.py <render.jpg> cx cz hw hh
   Prints median render/aerial colour per larger roof, then the mean ratio for dark-brown, light and tile-ish roofs."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

rp, cx, cz, hw, hh = sys.argv[1], *map(float, sys.argv[2:6])
R = np.asarray(Image.open(rp).convert('RGB')).astype(float)
H, W = R.shape[:2]
A = Image.open('data/raw/aerial/campus_4096.jpg'); SC = 4096 / 4000
A = np.asarray(A.crop((int((cx - hw + 2000) * SC), int((cz - hh + 2000) * SC), int((cx + hw + 2000) * SC), int((cz + hh + 2000) * SC))).resize((W, H))).astype(float)
d = json.load(open('public/data/campus.json'))
P = lambda x, z: ((x - (cx - hw)) / (2 * hw) * W, (z - (cz - hh)) / (2 * hh) * H)
groups = {'brown': [], 'light': [], 'tile': []}
for b in d['buildings']:
    pg = b['p']; pts = [P(pg[i], pg[i + 1]) for i in range(0, len(pg), 2)]
    if not all(0 < p[0] < W and 0 < p[1] < H for p in pts) or b['a'] < 800:
        continue
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon(pts, fill=255)
    mk = np.asarray(m.filter(ImageFilter.MinFilter(7))) > 127
    if mk.sum() < 50:
        continue
    r = np.median(R[mk], 0); a = np.median(A[mk], 0)
    al = a @ [0.299, 0.587, 0.114]; warm = (a[0] - a[2]) / max(al, 1)
    g = 'tile' if warm > 0.28 and al > 120 else ('brown' if warm > 0.15 else 'light')
    groups[g].append(a / np.maximum(r, 1))
    print(str(b.get('n') or b['id'])[:30].ljust(30), g.ljust(5), 'render', r.round(), 'aerial', a.round(), 'ratio', (a / np.maximum(r, 1)).round(2))
for g, v in groups.items():
    if v:
        print('%-5s n %2d  mean aerial/render ratio %s' % (g, len(v), np.mean(v, 0).round(2)))
