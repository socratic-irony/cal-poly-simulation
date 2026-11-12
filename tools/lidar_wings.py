"""Per-wing roof shapes: clay-tile hipped wings around flat cores (Dexter, Administration, the Mission-revival halls ...).

    .venv/bin/python -I tools/lidar_wings.py

Run after tools/lidar_derive.py (+ lidar_vaults.py). Buildings measured as 'flat' overall can still have pitched clay-tile
wings: the footprint's rectangle decomposition (campus.json `rects`) is tested one rectangle at a time. A rectangle is a
pitched tile wing when most of its LiDAR roof cells slope moderately (0.2-0.95) and its aerial colour reads as clay tile.
Stored as lidar_bldg[id].wings = [[rectIndex, eave, ridge, pitch, gable(0/1), dark(0/1)], ...]; src/buildings.js raises
the wing's walls to the measured eave and puts a hipped / gabled tile roof on it.
"""
import json, os, math, colorsys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(ROOT, "data", "raw", "lidar")
OUT = os.path.join(ROOT, "public", "data")
HALF = 2000; N = 2 * HALF

dtm = np.load(os.path.join(D, "dtm1.npy")).astype(np.float64)
dsm = np.load(os.path.join(D, "dsm1.npy")).astype(np.float64)
E0 = float(dtm[HALF, HALF])
_ds = ndi.gaussian_filter(dsm, 0.7)
gy, gx = np.gradient(_ds)
slope = np.hypot(gx, gy)
aer = np.asarray(Image.open(os.path.join(ROOT, "data/raw/aerial/campus_4096.jpg")).convert("RGB")).astype(np.float32)
ASC = aer.shape[0] / (2 * HALF)
data = json.load(open(os.path.join(OUT, "campus.json")))
L = json.load(open(os.path.join(OUT, "lidar_bldg.json")))


def is_tile(rgb):
    r, g, b = rgb / 255.0
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h *= 360
    return (h <= 38 or h >= 346) and s >= 0.20 and v >= 0.22, (0.299 * r + 0.587 * g + 0.114 * b) < 0.36


nb = nw = 0
for b in data["buildings"]:
    rec = L.get(str(b["id"]))
    if not rec:
        continue
    rec.pop("wings", None)
    if "h" not in rec or rec.get("flat") != 1 or not b.get("rects") or len(b["rects"]) < 2:
        continue
    if b["s"].get("kind") not in ("academic", "dorm", "church", "retail", "house"):
        continue
    g0 = rec["g"] + E0
    wings = []
    for k, (cx, cz, hw, hd, ang) in enumerate(b["rects"]):
        if hw * hd * 4 < 60:
            continue
        ca, sa = math.cos(ang), math.sin(ang)
        R = math.hypot(hw, hd) + 1
        x0, x1 = int(cx - R + HALF), int(cx + R + HALF) + 1
        z0, z1 = int(cz - R + HALF), int(cz + R + HALF) + 1
        if x0 < 0 or z0 < 0 or x1 >= N or z1 >= N:
            continue
        zz, xx = np.mgrid[z0:z1, x0:x1]
        px = xx - HALF + 0.5 - cx; pz = zz - HALF + 0.5 - cz
        u = px * ca + pz * sa; v = -px * sa + pz * ca
        m = (np.abs(u) < hw - 0.8) & (np.abs(v) < hd - 0.8)
        if m.sum() < 25:
            continue
        sl = slope[z0:z1, x0:x1][m]
        rel = dsm[z0:z1, x0:x1][m] - g0
        ok = sl < 1.2
        pm = ok & (sl > 0.2) & (sl < 0.95)
        frac = pm.sum() / max(1, ok.sum())
        if frac < 0.5 or pm.sum() < 15:
            continue
        eave = float(np.percentile(rel[pm], 8)); ridge = float(np.percentile(rel[pm], 97))
        if ridge - eave < 1.2 or eave < 2.4:
            continue
        # gable vs hip: share of downhill directions along the rectangle's long axis (hip ends)
        ax = (ca, sa) if hw >= hd else (-sa, ca)
        dgx = gx[z0:z1, x0:x1][m][pm]; dgy = gy[z0:z1, x0:x1][m][pm]
        along = np.abs(dgx * ax[0] + dgy * ax[1]) / np.maximum(np.hypot(dgx, dgy), 1e-6)
        endfrac = float((along > 0.8).mean())
        # aerial colour of the wing (eroded a little so walls / shadows don't count)
        ai = ((zz[m] - 0) * ASC).astype(int); aj = ((xx[m] - 0) * ASC).astype(int)
        col = np.median(aer[np.clip(ai, 0, aer.shape[0] - 1), np.clip(aj, 0, aer.shape[1] - 1)], axis=0)
        tile, dark = is_tile(col)
        if not tile:
            continue
        wings.append([k, round(eave, 2), round(ridge, 2), round(float(np.median(sl[pm])), 3), 1 if endfrac < 0.07 else 0, 1 if dark else 0])
    if wings:
        rec["wings"] = wings
        nb += 1; nw += len(wings)
        print("%-40s wings %d / %d rects" % ((b.get("n") or str(b["id"]))[:40], len(wings), len(b["rects"])))

json.dump(L, open(os.path.join(OUT, "lidar_bldg.json"), "w"), separators=(",", ":"))
print("buildings with tile wings", nb, "wings", nw)
