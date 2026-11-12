"""LiDAR points -> 1 m rasters over +/-2000 m (local frame).

    .venv/bin/python -I tools/lidar_rasters.py

Writes data/raw/lidar/
  dtm1.npy   bare-earth elevation (m, absolute), holes filled
  dsm1.npy   top-surface elevation (m, absolute), holes filled from DTM
  dtm_core4.bin  float32 grid for the terrain mesh: 1001 x 1001 samples, x/z = -2000..2000 step 4 (absolute m)
"""
import os
import numpy as np
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(ROOT, "data", "raw", "lidar")
HALF = 2000
N = 2 * HALF

p = np.load(os.path.join(D, "points.npz"))
x, z, y, c, rn = p["x"], p["z"], p["y"], p["c"], p["rn"]
ok = (c != 7) & (c != 18) & (c != 9)                                  # drop noise + water
ix = np.floor(x + HALF).astype(np.int64); iz = np.floor(z + HALF).astype(np.int64)
inb = (ix >= 0) & (ix < N) & (iz >= 0) & (iz < N) & ok
idx = iz[inb] * N + ix[inb]
yy = y[inb].astype(np.float64); cc = c[inb]

# ground: mean of class-2 returns per cell
g = cc == 2
cnt = np.bincount(idx[g], minlength=N * N)
sm = np.bincount(idx[g], weights=yy[g], minlength=N * N)
dtm = np.full(N * N, np.nan); has = cnt > 0
dtm[has] = sm[has] / cnt[has]
dtm = dtm.reshape(N, N)
print("ground coverage %.3f" % has.mean())
# ground under buildings is never observed: drop any 'ground' returns inside footprints (roof points misclassified as ground)
import json
from PIL import Image, ImageDraw
cj = os.path.join(ROOT, "public", "data", "campus.json")
if os.path.exists(cj):
    bm = Image.new("L", (N, N), 0); dr = ImageDraw.Draw(bm)
    for b in json.load(open(cj))["buildings"]:
        P = b["p"]; dr.polygon([(P[i] + HALF, P[i + 1] + HALF) for i in range(0, len(P), 2)], fill=255)
    bmask = ndi.binary_dilation(np.asarray(bm) > 127, iterations=1)
    dtm[bmask] = np.nan
# despike: isolated cells far above their neighbourhood (cars, walls, stray roof hits)
loc = ndi.median_filter(np.where(np.isnan(dtm), -9999, dtm), size=9)
spike = (~np.isnan(dtm)) & (loc > -9000) & (dtm - loc > 2.0)
print("spikes removed", int(spike.sum()))
dtm[spike] = np.nan
# fill holes (under buildings, water) from the nearest valid cell, then smooth only the filled part
hole = np.isnan(dtm)
_, (ri, rj) = ndi.distance_transform_edt(hole, return_indices=True)
filled = dtm[ri, rj]
blur = ndi.gaussian_filter(filled, 3.0)
dtm = np.where(hole, blur, filled)
dtm = ndi.gaussian_filter(dtm, 0.7)

# surface: max of all non-noise returns (bridge decks included)
dsm = np.full(N * N, -1e9)
np.maximum.at(dsm, idx, yy)
dsm = dsm.reshape(N, N)
miss = dsm < -1e8
print("surface coverage %.3f" % (1 - miss.mean()))
dsm[miss] = np.nan
# fill small gaps with a local max of neighbours, larger gaps with the DTM
loc = ndi.maximum_filter(np.nan_to_num(dsm, nan=-1e9), size=3)
dsm = np.where(miss & (loc > -1e8), loc, dsm)
dsm = np.where(np.isnan(dsm) | (dsm < -1e8), dtm, dsm)
dsm = np.maximum(dsm, dtm)

np.save(os.path.join(D, "dtm1.npy"), dtm.astype(np.float32))
np.save(os.path.join(D, "dsm1.npy"), dsm.astype(np.float32))

# terrain mesh grid (4 m) sampled bilinearly from the 1 m DTM (cell centres at -1999.5 ...)
s = np.arange(-HALF, HALF + 0.001, 4.0)
gx, gz = np.meshgrid(s, s)
core = ndi.map_coordinates(dtm, [gz + HALF - 0.5, gx + HALF - 0.5], order=1, mode="nearest").astype(np.float32)
core.tofile(os.path.join(D, "dtm_core4.bin"))
print("core grid", core.shape, "origin elev %.2f" % dtm[HALF, HALF], "range %.1f..%.1f" % (core.min(), core.max()))
nd = dsm - dtm
print("nDSM > 2m fraction %.3f, max %.1f" % ((nd > 2).mean(), nd.max()))
