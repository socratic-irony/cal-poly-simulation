"""Towers rising above a building's roof (clock / bell / stair towers), measured from the LiDAR.

    .venv/bin/python -I tools/lidar_towers.py

Run after tools/lidar_derive.py. Works for pitched and flat buildings alike (the height tiers only cover flat ones): inside each
footprint, compact blobs standing more than 4 m above the building's own roof level (85th percentile) and small enough to be a
tower (15-150 m2, nearly rectangular) are stored as
    lidar_bldg[id].towers = [{c:[x,z], ang, w, d, eave, top}]   (heights relative to the ground)
src/buildings.js raises them as a tower volume with a pyramid roof (or a flat top) in the building's materials.
"""
import json, os, math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(ROOT, "data", "raw", "lidar")
OUT = os.path.join(ROOT, "public", "data")
HALF = 2000; N = 2 * HALF
dtm = np.load(os.path.join(D, "dtm1.npy")).astype(np.float64)
dsm = np.load(os.path.join(D, "dsm1.npy")).astype(np.float64)
E0 = float(dtm[HALF, HALF])
data = json.load(open(os.path.join(OUT, "campus.json")))
aer = np.asarray(Image.open(os.path.join(ROOT, "data/raw/aerial/campus_4096.jpg")).convert("RGB")).astype(np.float32) / 255
ASC = aer.shape[0] / (2 * HALF)
L = json.load(open(os.path.join(OUT, "lidar_bldg.json")))

found = 0
for b in data["buildings"]:
    rec = L.get(str(b["id"]))
    if not rec:
        continue
    rec.pop("towers", None)
    if "h" not in rec or b["a"] < 250 or b["s"].get("noLidar") or b["s"].get("kind") in ("house", "shed"):
        continue
    P = b["p"]
    xs, zs = P[0::2], P[1::2]
    x0, x1 = int(min(xs) + HALF) - 2, int(max(xs) + HALF) + 3
    z0, z1 = int(min(zs) + HALF) - 2, int(max(zs) + HALF) + 3
    if x0 < 0 or z0 < 0 or x1 >= N or z1 >= N:
        continue
    m = Image.new("L", (x1 - x0, z1 - z0), 0)
    ImageDraw.Draw(m).polygon([(P[i] + HALF - x0, P[i + 1] + HALF - z0) for i in range(0, len(P), 2)], fill=255)
    inside = np.asarray(m) > 127
    near = ndi.binary_dilation(inside, iterations=2)                   # towers may overhang the traced outline a little
    rel = dsm[z0:z1, x0:x1] - (rec["g"] + E0)
    roofv = rel[inside & (rel > 2)]
    if roofv.size < 50:
        continue
    base = float(np.percentile(roofv, 85))
    hi = near & (rel > base + 4.0)
    hi = ndi.binary_opening(hi, iterations=1)
    lab, nl = ndi.label(hi)
    towers = []
    for k in range(1, nl + 1):
        cm = lab == k
        a = int(cm.sum())
        if a < 18 or a > 150 or (cm & inside).sum() < 0.8 * a:
            continue
        rr, cc = np.nonzero(cm)
        # trees overhanging the roof are green in the photo; tower roofs are tile / grey
        ai = np.clip(((rr + z0) * ASC).astype(int), 0, aer.shape[0] - 1); aj = np.clip(((cc + x0) * ASC).astype(int), 0, aer.shape[1] - 1)
        col = np.median(aer[ai, aj], axis=0)
        if col[1] - 0.5 * (col[0] + col[2]) > 0.012 or col.mean() < 0.16:
            continue
        rr, cc = np.nonzero(cm)
        px = cc + x0 - HALF + 0.5; pz = rr + z0 - HALF + 0.5
        mx, mz = px.mean(), pz.mean()
        ev, evec = np.linalg.eigh(np.cov(np.vstack([px - mx, pz - mz])))
        u = evec[:, 1]; v = np.array([-u[1], u[0]])
        pu = (px - mx) * u[0] + (pz - mz) * u[1]; pv = (px - mx) * v[0] + (pz - mz) * v[1]
        w = float(pu.max() - pu.min() + 1); d = float(pv.max() - pv.min() + 1)
        if max(w, d) > 14 or min(w, d) < 3.5 or a / (w * d) < 0.6:
            continue
        hv = rel[rr, cc]
        top = float(np.percentile(hv, 97)); eave = float(np.percentile(hv, 15))
        # trees are rough; a tower top is a plane or a pyramid
        if float(np.std(hv)) > 2.2:
            continue
        import colorsys
        hh, ss, vv = colorsys.rgb_to_hsv(*[float(t) for t in col])
        tile = 1 if ((hh * 360 <= 38 or hh * 360 >= 346) and ss >= 0.2 and vv >= 0.22) else 0
        towers.append({"c": [round(mx, 2), round(mz, 2)], "ang": round(math.atan2(u[1], u[0]), 4), "w": round(w, 1), "d": round(d, 1),
                       "eave": round(eave, 2), "top": round(top, 2), "base": round(base, 2), "tile": tile})
        print("%-40s tower %.1f x %.1f m  eave %.1f  top %.1f  (roof %.1f) tile %d" % ((b.get("n") or str(b["id"]))[:40], w, d, eave, top, base, tile))
    if towers:
        rec["towers"] = towers
        found += 1
json.dump(L, open(os.path.join(OUT, "lidar_bldg.json"), "w"), separators=(",", ":"))
print("buildings with towers", found)
