"""Wide-area (±4.8 km) products from the coarser LiDAR fetch (points_wide.npz, depth 9) + wide USGS aerial.

    .venv/bin/python -I tools/lidar_wide.py

Writes data/raw/lidar/dtm_outer12.bin  float32 801x801 samples, x/z = -4800..4800 step 12 (absolute m)
       public/data/trees_wide.json   [[x, z, height, radius, species]] for trees outside the ±2 km core
       public/data/macro_wide.jpg    blurred ground colour from the wide aerial (±4.8 km)
"""
import os, json, math
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(ROOT, "data", "raw", "lidar")
OUT = os.path.join(ROOT, "public", "data")
HALF = 4800; RES = 4.0; N = int(2 * HALF / RES)

p = np.load(os.path.join(D, "points_wide.npz"))
x, z, y, c = p["x"], p["z"], p["y"], p["c"]
ok = (c != 7) & (c != 18) & (c != 9)
ix = np.floor((x + HALF) / RES).astype(np.int64); iz = np.floor((z + HALF) / RES).astype(np.int64)
inb = ok & (ix >= 0) & (ix < N) & (iz >= 0) & (iz < N)
idx = iz[inb] * N + ix[inb]; yy = y[inb].astype(np.float64); cc = c[inb]
g = cc == 2
cnt = np.bincount(idx[g], minlength=N * N); sm = np.bincount(idx[g], weights=yy[g], minlength=N * N)
dtm = np.full(N * N, np.nan); dtm[cnt > 0] = sm[cnt > 0] / cnt[cnt > 0]; dtm = dtm.reshape(N, N)
print("ground coverage %.3f" % (cnt > 0).mean())
hole = np.isnan(dtm)
_, (ri, rj) = ndi.distance_transform_edt(hole, return_indices=True)
f = dtm[ri, rj]; dtm = np.where(hole, ndi.gaussian_filter(f, 2.0), f); dtm = ndi.gaussian_filter(dtm, 0.6)
dsm = np.full(N * N, -1e9); np.maximum.at(dsm, idx, yy); dsm = dsm.reshape(N, N)
dsm = np.where(dsm < -1e8, dtm, np.maximum(dsm, dtm))
s = np.arange(-HALF, HALF + 0.001, 12.0)
gx, gz = np.meshgrid(s, s)
grid = ndi.map_coordinates(dtm, [(gz + HALF) / RES - 0.5, (gx + HALF) / RES - 0.5], order=1, mode="nearest").astype(np.float32)
grid.tofile(os.path.join(D, "dtm_outer12.bin"))
print("outer grid", grid.shape, "range %.1f..%.1f" % (grid.min(), grid.max()))

# trees outside the core (|x| or |z| > 1990): canopy height model peaks at 4 m resolution
chm = np.clip(dsm - dtm, 0, 40)
core = np.zeros_like(chm, bool); c0 = int((HALF - 1990) / RES); c1 = int((HALF + 1990) / RES); core[c0:c1, c0:c1] = True
cs = ndi.gaussian_filter(chm, 0.6)
pk = (cs == ndi.maximum_filter(cs, size=3)) & (cs > 4.0) & ~core
pr, pc = np.nonzero(pk)
aer = np.asarray(Image.open(os.path.join(ROOT, "data/raw/aerial/wide_4096.jpg")).convert("RGB")).astype(np.float32) / 255
SCA = 4096 / (2 * HALF)
trees = []
for r_, c_ in zip(pr, pc):
    h = float(chm[r_, c_])
    # crown radius from how far the canopy stays above half the height
    ext = []
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)):
        L = 0
        for st in range(1, 5):
            yy_, xx_ = r_ + dy * st, c_ + dx * st
            if yy_ < 0 or xx_ < 0 or yy_ >= N or xx_ >= N or chm[yy_, xx_] < 0.5 * h: break
            L = st
        ext.append(L * RES * (1.41 if dx and dy else 1))
    rad = float(np.clip(np.mean(ext) * 0.8 + 1.6, 1.5, 12))
    wx = (c_ + 0.5) * RES - HALF; wz = (r_ + 0.5) * RES - HALF
    ax, ay = int((wx + HALF) * SCA), int((wz + HALF) * SCA)
    px = aer[max(0, ay - 1):ay + 2, max(0, ax - 1):ax + 2].reshape(-1, 3).mean(0)
    lum = float(px @ np.array([0.299, 0.587, 0.114])); gi = float(px[1] - 0.5 * (px[0] + px[2]))
    sp = 1 if (h > 15 and rad / h < 0.3) else (3 if lum > 0.24 and gi > 0.05 else 0)
    trees.append([round(wx, 1), round(wz, 1), round(h, 1), round(rad, 1), sp])
print("wide trees", len(trees))
json.dump(trees, open(os.path.join(OUT, "trees_wide.json"), "w"), separators=(",", ":"))

# blurred ground colour for the outer ring
im = Image.open(os.path.join(ROOT, "data/raw/aerial/wide_4096.jpg")).convert("RGB")
im = im.filter(ImageFilter.GaussianBlur(2.5)).resize((2048, 2048), Image.LANCZOS)
im.save(os.path.join(OUT, "macro_wide.jpg"), quality=88)
print("macro_wide written")
