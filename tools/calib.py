"""Compare per-surface-class colours of an orthographic top-down render against the USGS aerial.
   usage: .venv/bin/python -I tools/calib.py <render.png> cx cz hw hh"""
import json, sys, numpy as np
from PIL import Image, ImageDraw
rp, cx, cz, hw, hh = sys.argv[1], *map(float, sys.argv[2:6])
R = np.asarray(Image.open(rp).convert('RGB')).astype(np.float32) / 255
H, W = R.shape[:2]
d = json.load(open('public/data/campus.json'))
A = Image.open('data/raw/aerial/campus_4096.jpg').convert('RGB')
SC = 4096 / 4000
A = np.asarray(A.crop((int((cx - hw + 2000) * SC), int((cz - hh + 2000) * SC), int((cx + hw + 2000) * SC), int((cz + hh + 2000) * SC))).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
chm = np.load('data/raw/lidar/dsm1.npy') - np.load('data/raw/lidar/dtm1.npy')
xs = np.clip((cx - hw + (np.arange(W) + 0.5) / W * 2 * hw + 2000).astype(int), 0, 3999)
zs = np.clip((cz - hh + (np.arange(H) + 0.5) / H * 2 * hh + 2000).astype(int), 0, 3999)
open_ = chm[np.ix_(zs, xs)] < 0.8
def P(x, z): return ((x - (cx - hw)) / (2 * hw) * W, (z - (cz - hh)) / (2 * hh) * H)
mpp = 2 * hw / W
def lines(f, k):
    m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
    for r in d['roads']:
        if f(r):
            pts = [P(r['p'][i], r['p'][i + 1]) for i in range(0, len(r['p']), 2)]
            if len(pts) > 1: dr.line(pts, fill=255, width=max(1, int(r['w'] * k / mpp)))
    return np.asarray(m) > 127
def areas(kinds):
    m = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(m)
    for a in d['areas']:
        if a['k'] in kinds:
            pts = [P(a['rings'][0][i], a['rings'][0][i + 1]) for i in range(0, len(a['rings'][0]), 2)]
            if len(pts) > 2: dr.polygon(pts, fill=255)
    return np.asarray(m) > 127
bm = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(bm)
for b in d['buildings']:
    pts = [P(b['p'][i], b['p'][i + 1]) for i in range(0, len(b['p']), 2)]; dr.polygon(pts, fill=255)
bld = np.asarray(bm) > 127
gc = np.asarray(Image.open('public/data/ground_cls.png').convert('RGB'))
GN = gc.shape[0]
gcs = gc[np.ix_(np.clip(((zs + 0.5) / 4000 * GN).astype(int), 0, GN - 1), np.clip(((xs + 0.5) / 4000 * GN).astype(int), 0, GN - 1))]
cls = {
    'road': lines(lambda r: r['k'] == 'road' and r['w'] >= 6, 0.45),
    'walk': lines(lambda r: r['k'] == 'walk' and r['w'] >= 2.4, 0.4),
    'parking': areas({'parking'}),
    'lawn': (gcs[..., 1] > 191),
    'beds': (gcs[..., 1] > 64) & (gcs[..., 1] <= 191),
    'aer-paved': (gcs[..., 0] > 127) & ~lines(lambda r: True, 1.4) & ~areas({'parking', 'plaza', 'pool'}),   # terrain concrete layer (no ribbon on top)
    'other ground': ~(areas({'parking', 'lawn', 'pitch'}) | lines(lambda r: True, 1.2) | (gcs[..., 1] > 64) | (gcs[..., 0] > 127)),
    'roofs': bld,
}
for k, m in cls.items():
    m = m & (open_ if k != 'roofs' else True) & (~bld if k != 'roofs' else True)
    if m.sum() < 20: print(k, 'too few'); continue
    r = np.median(R[m], axis=0) * 255; a = np.median(A[m], axis=0) * 255
    print(k.ljust(13), 'n %6d' % m.sum(), 'render', r.round(0), 'aerial', a.round(0), 'ratio', (a / np.maximum(r, 1)).round(2))
