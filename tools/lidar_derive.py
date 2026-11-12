"""Derive building heights / roof shapes / height tiers and tree crowns from the 1 m LiDAR rasters.

    .venv/bin/python -I tools/lidar_derive.py [--debug]

Needs data/raw/lidar/{dtm1,dsm1}.npy (tools/lidar_rasters.py) and public/data/campus.json (tools/build-data.mjs).
Writes public/data/lidar_bldg.json  {id: {g, h, eave, ridge, pitch, flat, cov, tiers:[{h, rings:[[x,z,...]]}]}}
       public/data/trees_lidar.json [[x, z, height, radius, species], ...]
"""
import json, os, sys, math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from shapely.geometry import Polygon, MultiPolygon, MultiPoint, box
from shapely.ops import unary_union

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(ROOT, "data", "raw", "lidar")
OUT = os.path.join(ROOT, "public", "data")
HALF = 2000; N = 2 * HALF
DEBUG = "--debug" in sys.argv

dtm = np.load(os.path.join(D, "dtm1.npy")).astype(np.float64)
dsm = np.load(os.path.join(D, "dsm1.npy")).astype(np.float64)
E0 = float(dtm[HALF, HALF])
chm = dsm - dtm
_ds = ndi.gaussian_filter(dsm, 0.7)
_gy, _gx = np.gradient(_ds)
slope_all = np.hypot(_gx, _gy)
data = json.load(open(os.path.join(OUT, "campus.json")))

def cell(x, z):   # local metres -> raster (col,row) float
    return x + HALF, z + HALF

bmask_all = Image.new("L", (N, N), 0)
dball = ImageDraw.Draw(bmask_all)
out = {}
nb = 0
for b in data["buildings"]:
    P = b["p"]
    pts = [cell(P[i], P[i + 1]) for i in range(0, len(P), 2)]
    dball.polygon(pts, fill=255)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, x1 = int(max(0, min(xs) - 4)), int(min(N, max(xs) + 5)); y0, y1 = int(max(0, min(ys) - 4)), int(min(N, max(ys) + 5))
    if x1 - x0 < 3 or y1 - y0 < 3:
        continue
    W, H = x1 - x0, y1 - y0
    m = Image.new("L", (W, H), 0); ImageDraw.Draw(m).polygon([(p[0] - x0, p[1] - y0) for p in pts], fill=255)
    inside = np.asarray(m) > 127
    if inside.sum() < 4:
        continue
    ring = ndi.binary_dilation(inside, iterations=3) & ~ndi.binary_dilation(inside, iterations=1)
    D_ = dtm[y0:y1, x0:x1]; S_ = dsm[y0:y1, x0:x1]
    g0 = float(np.median(D_[ring])) if ring.any() else float(np.median(D_[inside]))
    er = ndi.binary_erosion(inside, iterations=1)
    if er.sum() < 4:
        er = inside
    rel = S_ - g0
    roof = er & ((S_ - D_) > 1.6)
    cov = float(roof.sum()) / float(er.sum())
    rec = {"g": round(g0 - E0, 2), "cov": round(cov, 2)}
    if roof.sum() >= 4 and cov > 0.25:
        hv = rel[roof]
        p = np.percentile(hv, [10, 25, 50, 75, 90, 98])
        # pitched roofs: most interior roof cells have a consistent, moderate slope (flat roofs ~0, walls/steps > 1.2)
        flat = True; pitch = 0.0; eave = float(p[2]); ridge = float(p[5])
        inner = ndi.binary_erosion(roof, iterations=2)
        sl = slope_all[y0:y1, x0:x1][inner]
        sl = sl[sl < 1.2]
        if len(sl) >= 8:
            med = float(np.median(sl)); frac = float((sl > 0.15).mean())
            pm = (sl > 0.2) & (sl < 0.95)
            rec["pfrac"] = round(float(pm.mean()), 2)
            if pm.sum() >= 6:
                hin = (rel[inner])[slope_all[y0:y1, x0:x1][inner] < 1.2][pm]
                rec["pmed"] = round(float(np.median(sl[pm])), 2)
                rec["peave"] = round(float(np.percentile(hin, 10)), 2); rec["pridge"] = round(float(np.percentile(hin, 97)), 2)
            # gable vs hip: share of sloped cells whose downhill direction runs along the long axis (hip ends)
            try:
                fpp = Polygon([(P[i], P[i + 1]) for i in range(0, len(P), 2)]).buffer(0)
                mrr = fpp.minimum_rotated_rectangle; co = list(mrr.exterior.coords)
                e1 = (co[1][0] - co[0][0], co[1][1] - co[0][1]); e2 = (co[2][0] - co[1][0], co[2][1] - co[1][1])
                ax = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
                axl = math.hypot(*ax) or 1; ax = (ax[0] / axl, ax[1] / axl)
                gx_ = _gx[y0:y1, x0:x1][inner]; gy_ = _gy[y0:y1, x0:x1][inner]
                sel = (np.hypot(gx_, gy_) > 0.2) & (np.hypot(gx_, gy_) < 0.95)
                if sel.sum() >= 12:
                    dirx, diry = gx_[sel], gy_[sel]
                    along = np.abs(dirx * ax[0] + diry * ax[1]) / np.hypot(dirx, diry)
                    rec["endfrac"] = round(float((along > 0.8).mean()), 3)
            except Exception:
                pass
            if med > 0.2 and frac > 0.6 and (p[5] - p[0]) > 1.0:
                flat = False; pitch = float(min(med * 1.05, 0.95)); eave = float(np.percentile(hv, 8)); ridge = float(p[5])
        rec.update({"h": round(float(p[2]) if flat else eave, 2), "p90": round(float(p[4]), 2), "ridge": round(ridge, 2),
                    "eave": round(eave, 2), "pitch": round(pitch, 2), "flat": 1 if flat else 0})
        # height tiers for larger flat-roofed buildings
        if (flat and b["a"] > 450 or (not flat and b["a"] > 2500)) and (p[4] - p[0]) > 3.0:
            hist, edges = np.histogram(hv, bins=np.arange(max(0, hv.min() - 1), hv.max() + 1.5, 0.5))
            hs = ndi.gaussian_filter1d(hist.astype(float), 2.0)
            cen = (edges[:-1] + edges[1:]) / 2
            peaks = [i for i in range(1, len(hs) - 1) if hs[i] >= hs[i - 1] and hs[i] > hs[i + 1] and hs[i] > 0.035 * len(hv) / 2]
            levels = sorted(set(round(float(cen[i]), 1) for i in peaks))
            merged = []
            for L in levels:
                if merged and L - merged[-1] < 2.8:
                    continue
                merged.append(L)
            if len(merged) >= 2:
                tiers = []
                fp = Polygon([(P[i], P[i + 1]) for i in range(0, len(P), 2)]).buffer(0)
                for k in range(1, len(merged)):
                    thr = (merged[k - 1] + merged[k]) / 2
                    mk = roof & (rel >= thr)
                    mk = ndi.binary_opening(mk, iterations=1)
                    mk = ndi.binary_closing(mk, iterations=2) & inside
                    lab, nl = ndi.label(mk)
                    if nl == 0:
                        continue
                    sizes = ndi.sum(mk, lab, range(1, nl + 1))
                    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 30])
                    if keep.sum() < 30:
                        continue
                    rr, cc_ = np.nonzero(keep)
                    sq = unary_union([box(c_ + x0 - HALF, r_ + y0 - HALF, c_ + x0 - HALF + 1, r_ + y0 - HALF + 1) for r_, c_ in zip(rr, cc_)])
                    poly = sq.simplify(0.9, preserve_topology=True).intersection(fp).buffer(0)
                    geoms = list(poly.geoms) if isinstance(poly, MultiPolygon) else [poly]
                    rings = []
                    for gpoly in geoms:
                        if gpoly.is_empty or gpoly.area < 25:
                            continue
                        gpoly = gpoly.simplify(0.5, preserve_topology=True)
                        ext = list(gpoly.exterior.coords)[:-1]
                        if len(ext) >= 3:
                            rings.append([round(v, 2) for xy in ext for v in xy])
                    if rings:
                        # tier height = median of the cells above the threshold
                        tiers.append({"h": round(float(np.median(rel[mk])), 2), "rings": rings})
                if tiers:
                    if flat:
                        rec["tiers"] = tiers
                        rec["h"] = round(float(merged[0]), 2)
                    else:
                        rec["tiers2"] = tiers; rec["h2"] = round(float(merged[0]), 2)
                    nb += 1
    # rooftop equipment / small penthouses: blobs standing > 0.9 m above the local roof level
    if "h" in rec and rec.get("flat") == 1 and b["a"] > 120:
        relr = np.where(roof, rel, np.nan)
        base = ndi.median_filter(np.nan_to_num(relr, nan=-50.0), size=13)
        up = roof & ((rel - base) > 0.9) & ((rel - base) < 7.0) & ndi.binary_erosion(inside, iterations=2)
        lab, nl = ndi.label(up)
        units = []
        if nl:
            for k, sl_ in enumerate(ndi.find_objects(lab)):
                if sl_ is None:
                    continue
                cm = lab[sl_] == (k + 1)
                ncell = int(cm.sum())
                if ncell < 3 or ncell > 120:
                    continue
                rr, cc_ = np.nonzero(cm)
                rr = rr + sl_[0].start; cc_ = cc_ + sl_[1].start
                pts_ = MultiPoint([(c_ + x0 - HALF + 0.5, r_ + y0 - HALF + 0.5) for r_, c_ in zip(rr, cc_)]).buffer(0.55, cap_style=3)
                mrr = pts_.minimum_rotated_rectangle
                co = list(mrr.exterior.coords)[:4]
                e1 = (co[1][0] - co[0][0], co[1][1] - co[0][1]); e2 = (co[2][0] - co[1][0], co[2][1] - co[1][1])
                w = math.hypot(*e1); d = math.hypot(*e2); ang = math.atan2(e1[1], e1[0])
                hh = float(np.percentile((rel - base)[rr, cc_], 85))
                bz = float(np.median(base[rr, cc_]))
                c0 = mrr.centroid
                units.append([round(c0.x, 2), round(c0.y, 2), round(w, 2), round(d, 2), round(ang, 3), round(hh, 2), round(bz, 2)])
        if units:
            rec["units"] = units[:40]
    out[str(b["id"])] = rec
json.dump(out, open(os.path.join(OUT, "lidar_bldg.json"), "w"), separators=(",", ":"))
print("buildings with lidar", sum(1 for v in out.values() if "h" in v), "of", len(out), "| tiered", nb,
      "| pitched", sum(1 for v in out.values() if v.get("flat") == 0))

# ------------------------------------------------------------------ trees from the canopy height model
bm = np.asarray(bmask_all) > 127
bm = ndi.binary_dilation(bm, iterations=2)
c = np.where(bm, 0, chm)
c[c > 45] = 0
cs = ndi.gaussian_filter(c, 1.0)
mx = ndi.maximum_filter(cs, size=5)
peaks = (cs == mx) & (cs > 3.0)
pr, pc = np.nonzero(peaks)
print("raw peaks", len(pr))
aer = np.asarray(Image.open(os.path.join(ROOT, "data/raw/aerial/campus_4096.jpg")).convert("RGB")).astype(np.float32) / 255
SC = 4096 / 4000
dirs = [(math.cos(a), math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
cand = []
for r_, c_ in zip(pr, pc):
    h = float(c[max(0, r_ - 1):r_ + 2, max(0, c_ - 1):c_ + 2].max())
    ext = []
    for dx, dy in dirs:
        L = 0
        for s in range(1, 16):
            yy = int(round(r_ + dy * s)); xx = int(round(c_ + dx * s))
            if yy < 0 or yy >= N or xx < 0 or xx >= N or c[yy, xx] < max(1.8, 0.55 * h):
                break
            L = s
        ext.append(L)
    ext = np.array(ext)
    if (ext >= 1).mean() < 0.6:          # power lines, poles, thin structures
        continue
    rad = float(np.clip(np.mean(ext) * 0.92 + 0.6, 1.2, 13.0))
    ax, ay = int((c_ + 0.5) * SC), int((r_ + 0.5) * SC)
    pat = aer[max(0, ay - 2):ay + 3, max(0, ax - 2):ax + 3].reshape(-1, 3).mean(axis=0)
    lum = float(pat @ np.array([0.299, 0.587, 0.114])); gi = float(pat[1] - 0.5 * (pat[0] + pat[2]))
    cand.append([c_ + 0.5 - HALF, r_ + 0.5 - HALF, h, rad, lum, gi])
cand = np.array(cand)
# thin out peaks that sit inside a bigger neighbour's crown
order = np.argsort(-cand[:, 2])
kd = cKDTree(cand[:, :2])
alive = np.ones(len(cand), bool)
for i in order:
    if not alive[i]:
        continue
    for j in kd.query_ball_point(cand[i, :2], cand[i, 3] * 0.55):
        if j != i and cand[j, 2] < cand[i, 2]:
            alive[j] = False
cand = cand[alive]
trees = []
for x, z, h, rad, lum, gi in cand:
    slender = rad / max(h, 1)
    if h > 14 and slender < 0.28:
        sp = 1 if lum > 0.2 or gi < 0.03 else 2          # tall + narrow: eucalyptus (pale) / conifer (dark)
    elif lum < 0.14 and gi > 0.02 and slender < 0.4:
        sp = 2
    elif lum > 0.24 and gi > 0.05:
        sp = 3
    else:
        sp = 0
    trees.append([round(float(x), 1), round(float(z), 1), round(float(h), 1), round(float(rad), 1), sp])
json.dump(trees, open(os.path.join(OUT, "trees_lidar.json"), "w"), separators=(",", ":"))
from collections import Counter
print("trees", len(trees), Counter(t[4] for t in trees), "median h %.1f r %.1f" % (np.median(cand[:, 2]), np.median(cand[:, 3])))
