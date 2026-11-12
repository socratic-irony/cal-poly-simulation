"""Derive real-world detail from the USGS aerial photo (public domain) for the campus model.

Reads  : public/data/campus.json          (OSM footprints, roads, areas -- local metres)
         data/raw/aerial/campus_4096.jpg  (USGS imagery, +/-2000 m around the origin, ~0.98 m/px)
Writes : public/data/roofs.json           per-building roof colour sampled from the photo
         public/data/macro.jpg            masked, blurred ground colour (buildings/roads/trees removed)
         public/data/trees_detected.json  tree crowns found in the photo: [x, z, radius_m, species, lum]

Run:  python3 -I tools/aerial.py [--debug]
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "public", "data")
DEBUG = "--debug" in sys.argv
DBG = os.environ.get("DBG_DIR", "/tmp")

HALF = 2000.0
img = Image.open(os.path.join(ROOT, "data/raw/aerial/campus_4096.jpg")).convert("RGB")
N = img.size[0]
SC = N / (2 * HALF)                        # px per metre
rgb = np.asarray(img).astype(np.float32) / 255.0
lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
gi = rgb[..., 1] - 0.5 * (rgb[..., 0] + rgb[..., 2])      # "greenness"
data = json.load(open(os.path.join(OUT, "campus.json")))

def px(x, z):
    return ((x + HALF) * SC, (z + HALF) * SC)

# ------------------------------------------------------------------ masks (full resolution)
def draw_mask(buildings=True, roads=True, areas=True, grow_b=2, grow_r=1.5):
    m = Image.new("L", (N, N), 0)
    d = ImageDraw.Draw(m)
    if buildings:
        for b in data["buildings"]:
            pts = [px(b["p"][i], b["p"][i + 1]) for i in range(0, len(b["p"]), 2)]
            d.polygon(pts, fill=255)
    if roads:
        for r in data["roads"]:
            if r["k"] in ("stream",):
                continue
            pts = [px(r["p"][i], r["p"][i + 1]) for i in range(0, len(r["p"]), 2)]
            w = max(1, int(round((r["w"] + grow_r * 2) * SC)))
            if len(pts) > 1:
                d.line(pts, fill=255, width=w, joint="curve")
    if areas:
        for a in data["areas"]:
            if a["k"] in ("parking", "plaza", "pool", "water", "garage_roof", "track"):
                for ring in a["rings"][:1]:
                    pts = [px(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]
                    if len(pts) >= 3:
                        d.polygon(pts, fill=255)
    m = m.filter(ImageFilter.MaxFilter(2 * grow_b + 1)) if grow_b > 0 else m
    return np.asarray(m) > 127

built = draw_mask()
print("built-up fraction %.3f" % built.mean())

# ------------------------------------------------------------------ 1) roof colours per building
roofs = {}
for b in data["buildings"]:
    P = b["p"]
    pts = [px(P[i], P[i + 1]) for i in range(0, len(P), 2)]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, x1 = int(max(0, min(xs) - 2)), int(min(N, max(xs) + 3)); y0, y1 = int(max(0, min(ys) - 2)), int(min(N, max(ys) + 3))
    if x1 - x0 < 3 or y1 - y0 < 3:
        continue
    m = Image.new("L", (x1 - x0, y1 - y0), 0)
    ImageDraw.Draw(m).polygon([(p[0] - x0, p[1] - y0) for p in pts], fill=255)
    tall = b["s"].get("h", 0) > 13
    m = m.filter(ImageFilter.MinFilter(7 if tall else 3))                # erode: keep clear of wall/shadow edges
    mk = np.asarray(m) > 127
    n = int(mk.sum())
    if n < 10:
        # tiny building: fall back to the un-eroded footprint
        mk = np.asarray(Image.new("L", (x1 - x0, y1 - y0), 0)) > 0
        mm = Image.new("L", (x1 - x0, y1 - y0), 0); ImageDraw.Draw(mm).polygon([(p[0] - x0, p[1] - y0) for p in pts], fill=255)
        mk = np.asarray(mm) > 127; n = int(mk.sum())
        if n < 6:
            continue
    patch = rgb[y0:y1, x0:x1][mk]
    med = np.median(patch, axis=0)
    l = patch @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    gimean = float((patch[:, 1] - 0.5 * (patch[:, 0] + patch[:, 2])).mean())
    roofs[str(b["id"])] = [round(float(med[0]) * 255), round(float(med[1]) * 255), round(float(med[2]) * 255), round(float(l.std()) * 255, 1), round(gimean * 255, 1), n]
json.dump(roofs, open(os.path.join(OUT, "roofs.json"), "w"), separators=(",", ":"))
print("roofs", len(roofs))

# ------------------------------------------------------------------ 2) macro ground colour (normalised, masked blur)
# pixels that are NOT bare ground colour: buildings / roads / parking, dark canopy & shadows
canopy = (lum < 0.30) & (gi > 0.0)
shadow = lum < 0.13
excl = built | ndi.binary_dilation(canopy | shadow, iterations=2)
w = (~excl).astype(np.float32)
# work at half resolution (~2 m/px)
def down2(a):
    return a.reshape(N // 2, 2, N // 2, 2, *a.shape[2:]).mean(axis=(1, 3))
rgb2 = down2(rgb * w[..., None]); w2 = down2(w)
res = []
for sg in (3.0, 12.0, 48.0):
    num = np.stack([ndi.gaussian_filter(rgb2[..., c], sg) for c in range(3)], axis=-1)
    den = ndi.gaussian_filter(w2, sg)[..., None]
    res.append((num / np.maximum(den, 1e-4), den[..., 0]))
macro = res[2][0].copy()
for (c, d) in (res[1], res[0]):                       # finest scale wins where there is enough data
    k = np.clip((d - 0.04) / 0.20, 0, 1)[..., None]
    macro = macro * (1 - k) + c * k
Image.fromarray((np.clip(macro, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "macro.jpg"), quality=90)
# confidence: how much real (unmasked) ground the fine-scale colour is based on
conf = np.clip((res[0][1] - 0.12) / 0.45, 0, 1)
conf = ndi.gaussian_filter(conf, 2.0)
Image.fromarray((conf * 255).astype(np.uint8)).resize((1024, 1024), Image.BILINEAR).save(os.path.join(OUT, "macro_w.png"))
print("macro written", macro.shape)

# ------------------------------------------------------------------ 2b) unmapped surfaces: paved plazas / irrigated lawns
chm_p = os.path.join(ROOT, "data/raw/lidar/dsm1.npy")
if os.path.exists(chm_p):
    dsm_l = np.load(chm_p); dtm_l = np.load(os.path.join(ROOT, "data/raw/lidar/dtm1.npy"))
    chm_l = dsm_l - dtm_l
    ii = np.clip((np.arange(N) / SC).astype(int), 0, chm_l.shape[0] - 1)
    chm_a = chm_l[np.ix_(ii, ii)]
else:
    chm_a = np.zeros((N, N), np.float32)
mx_ = rgb.max(axis=2); mn_ = rgb.min(axis=2); sat = (mx_ - mn_) / np.maximum(mx_, 1e-3)
ground_ok = (~built) & (chm_a < 1.0)
# paving: only buildings are excluded (1 px for relief lean). Mapped roads and paths are painted on top of this
# layer anyway, and the real walks / aprons / courtyards in the core are much wider than their OSM centre lines.
built_b = draw_mask(roads=False, areas=False, grow_b=1)
open_b = (~built_b) & (chm_a < 1.0)
paved = open_b & (lum > 0.46) & (sat < 0.18) & (gi < 0.035)
paved = ndi.binary_closing(paved, iterations=2) & open_b & (gi < 0.05)    # bridge thin tree shadows across paving
lawn = open_b & (gi > 0.045) & (lum > 0.22) & (lum < 0.62)      # up to path edges too (paths are painted on top)
def clean(m, it=2, minsz=60):
    m = ndi.binary_opening(m, iterations=it); m = ndi.binary_closing(m, iterations=it)
    lab, nl = ndi.label(m)
    if nl:
        sz = ndi.sum(m, lab, range(1, nl + 1)); m = np.isin(lab, np.nonzero(sz >= minsz)[0] + 1)
    return m
def specks(m, minsz):                                     # drop tiny blobs only; no opening, so thin path margins survive
    lab, nl = ndi.label(m)
    if nl:
        sz = ndi.sum(m, lab, range(1, nl + 1)); m = np.isin(lab, np.nonzero(sz >= minsz)[0] + 1)
    return m
# irrigated lawn only on developed ground (within 40 m of buildings / paths): green hillside patches are not mown turf
near_dev = ndi.distance_transform_edt(~built) < 40 * SC
paved = specks(paved, 12); lawn = specks(ndi.binary_closing(lawn, iterations=1) & open_b & near_dev, 20)
# brick / paver plazas: the photo can't tell red pavers from concrete at 1 m, but OSM tags some walks with a paver surface;
# paving that adjoins those walks (within 12 m) is taken to be the same paver field (University Union plaza, Dexter walk ...)
pm_ = Image.new("L", (N, N), 0); dpm = ImageDraw.Draw(pm_)
for r in data["roads"]:
    if r["k"] == "walk" and r.get("sf") == "paver":
        pts = [px(r["p"][i], r["p"][i + 1]) for i in range(0, len(r["p"]), 2)]
        if len(pts) > 1:
            dpm.line(pts, fill=255, width=max(1, int(r["w"] * SC)), joint="curve")
near_pv = ndi.distance_transform_edt(np.asarray(pm_) < 128) < 12 * SC
pavers = paved & near_pv
# planting beds / groundcover / mulch: open ground near buildings that the photo shows as neither irrigated lawn nor paving.
# Stored as 128 in the lawn channel; the app removes the landscaped-lawn fill there so the natural ground shader (photo colour,
# taller tufts) takes over. Only within 30 m of buildings, so open hillsides and fields are never touched.
bm_only = draw_mask(roads=False, areas=False, grow_b=0)
near_b = ndi.distance_transform_edt(~bm_only) < 30 * SC
farmish = Image.new("L", (N, N), 0); dfa = ImageDraw.Draw(farmish)
for a in data["areas"]:
    if a["k"] in ("farm", "orchard", "vineyard", "meadow", "scrub", "wood", "pitch", "track", "dirt"):
        for ring in a["rings"][:1]:
            pts = [px(ring[i], ring[i + 1]) for i in range(0, len(ring), 2)]
            if len(pts) >= 3: dfa.polygon(pts, fill=255)
bed = open_b & near_b & ~paved & ~lawn & ~(np.asarray(farmish) > 127) & (lum > 0.22) & (lum < 0.62) & (gi < 0.045)
bed = specks(bed, 12)
gc = np.zeros((N, N, 3), np.uint8); gc[..., 0] = paved * 255; gc[..., 1] = np.where(lawn, 255, np.where(bed, 128, 0)); gc[..., 2] = pavers * 255
print("beds %.4f" % bed.mean())
print("pavers %.4f" % pavers.mean())
Image.fromarray(gc).save(os.path.join(OUT, "ground_cls.png"))                  # full 4096 px (~1 m): paths and aprons are narrow
print("paved %.3f lawn %.3f" % (paved.mean(), lawn.mean()))

# ------------------------------------------------------------------ 3) tree crowns
dark = np.clip((0.31 - lum) / 0.10, 0, 1)
green = np.clip((gi - 0.002) / 0.016, 0, 1)
score = dark * green
# bright, irrigated young trees: green blobs that are locally darker than their surroundings
loc = ndi.gaussian_filter(lum, 7.0)
contrast = np.clip((loc - lum - 0.025) / 0.10, 0, 1) * np.clip((gi - 0.03) / 0.04, 0, 1) * np.clip((0.55 - lum) / 0.10, 0, 1)
score = np.maximum(score, 0.9 * contrast)
score[ndi.binary_dilation(built, iterations=1)] = 0
sb = ndi.gaussian_filter(score, 1.5)
mx = ndi.maximum_filter(sb, size=5)
peaks = (sb == mx) & (sb > 0.26)
py, pxx = np.nonzero(peaks)
mask_bin = ndi.gaussian_filter(score, 0.8) > 0.28
edt = ndi.distance_transform_edt(mask_bin)
tree = cKDTree(np.stack([pxx, py], axis=1))
dd, _ = tree.query(np.stack([pxx, py], axis=1), k=2)
dnn = dd[:, 1] / SC
trees = []
lum_s = ndi.gaussian_filter(lum, 1.5)
gi_s = ndi.gaussian_filter(gi, 1.5)
for i in range(len(py)):
    y, x = py[i], pxx[i]
    r_edt = edt[y, x] / SC
    r = min(r_edt * 1.25 + 0.7, 0.68 * dnn[i] + 0.9)
    r = float(np.clip(r, 1.3, 13.0))
    wx = x / SC - HALF; wz = y / SC - HALF
    l = float(lum_s[y, x]); g = float(gi_s[y, x])
    # species hint: 0 oak (dark, round) / 1 eucalyptus (pale grey-green) / 2 conifer (very dark, blue-green) / 3 deciduous (brighter green)
    if l < 0.13 and g > 0.02: sp = 2
    elif g < 0.035 and l > 0.17: sp = 1
    elif l > 0.19 and g > 0.06: sp = 3
    else: sp = 0
    trees.append([round(wx, 1), round(wz, 1), round(r, 1), sp, round(l, 2)])
json.dump(trees, open(os.path.join(OUT, "trees_detected.json"), "w"), separators=(",", ":"))
print("trees", len(trees), "mean r %.1f" % (np.mean([t[2] for t in trees]) if trees else 0))
from collections import Counter
print(Counter(t[3] for t in trees))

if DEBUG:
    dbg = img.copy(); dr = ImageDraw.Draw(dbg)
    for (wx, wz, r, sp, l) in trees:
        cx, cy = px(wx, wz); R = r * SC
        col = [(255, 255, 0), (0, 255, 255), (255, 0, 255), (255, 128, 0)][sp]
        dr.ellipse((cx - R, cy - R, cx + R, cy + R), outline=col)
    cx, cz = px(-190, 20)
    dbg.crop((int(cx - 260), int(cz - 200), int(cx + 260), int(cz + 200))).resize((1560, 1200), Image.LANCZOS).save(os.path.join(DBG, "trees_dbg.jpg"), quality=90)
    cx, cz = px(150, -700)
    dbg.crop((int(cx - 260), int(cz - 200), int(cx + 260), int(cz + 200))).resize((1560, 1200), Image.LANCZOS).save(os.path.join(DBG, "trees_dbg2.jpg"), quality=90)
    Image.fromarray((np.clip(macro, 0, 1) * 255).astype(np.uint8)).crop((900, 900, 1500, 1500)).resize((1200, 1200)).save(os.path.join(DBG, "macro_dbg.jpg"), quality=90)
