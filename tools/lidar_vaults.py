"""Curved / sloped roof volumes (barrel vaults, curved shed roofs over gyms and halls) measured from the LiDAR.

    .venv/bin/python -I tools/lidar_vaults.py [--debug]

Run after tools/lidar_derive.py. For every larger building, the roof cells standing clearly above the main
roof level are grouped; each group's principal axis gives a rectangle, and the median height across that
rectangle (in 1 m strips perpendicular to the axis) gives a cross-section. Where the measured roof follows that
extruded cross-section closely (it really is one profile swept along the axis) and the profile is curved or
sloped rather than flat, the volume is stored as

    lidar_bldg[id].vaults = [{c:[x,z], ang, L, W, prof:[h0..hN] (relative to the ground, across W), base}]

and drawn by src/buildings.js as a metal roof surface with walls following the profile.
"""
import json, os, sys, math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
D = os.path.join(ROOT, "data", "raw", "lidar")
OUT = os.path.join(ROOT, "public", "data")
HALF = 2000; N = 2 * HALF
DEBUG = "--debug" in sys.argv

dtm = np.load(os.path.join(D, "dtm1.npy")).astype(np.float64)
dsm = np.load(os.path.join(D, "dsm1.npy")).astype(np.float64)
E0 = float(dtm[HALF, HALF])
data = json.load(open(os.path.join(OUT, "campus.json")))
L = json.load(open(os.path.join(OUT, "lidar_bldg.json")))
NS = 13                                           # samples across the profile

found = 0
for b in data["buildings"]:
    rec = L.get(str(b["id"]))
    rec and rec.pop("vaults", None)
    if not rec or "h" not in rec or b["a"] < 900 or b.get("t") in ("dormitory", "residential", "apartments", "house", "parking"):
        continue
    P = b["p"]
    xs, zs = P[0::2], P[1::2]
    x0, x1 = int(min(xs) + HALF) - 3, int(max(xs) + HALF) + 4
    z0, z1 = int(min(zs) + HALF) - 3, int(max(zs) + HALF) + 4
    if x0 < 0 or z0 < 0 or x1 >= N or z1 >= N:
        continue
    m = Image.new("L", (x1 - x0, z1 - z0), 0)
    ImageDraw.Draw(m).polygon([(P[i] + HALF - x0, P[i + 1] + HALF - z0) for i in range(0, len(P), 2)], fill=255)
    inside = ndi.binary_erosion(np.asarray(m) > 127, iterations=1)
    rel = dsm[z0:z1, x0:x1] - (rec["g"] + E0)
    base = rec["h"]
    # roof regions rising clearly above the main roof level
    hi = inside & (rel > base + 2.5)
    hi = ndi.binary_opening(hi, iterations=2)
    lab, nl = ndi.label(hi)
    vaults = []
    for k in range(1, nl + 1):
        cm = lab == k
        if cm.sum() < 350:
            continue
        rr, cc = np.nonzero(cm)
        px = cc + x0 - HALF + 0.5; pz = rr + z0 - HALF + 0.5
        mx, mz = px.mean(), pz.mean()
        cov = np.cov(np.vstack([px - mx, pz - mz]))
        ev, evec = np.linalg.eigh(cov)
        u = evec[:, 1]; v = np.array([-u[1], u[0]])
        # analyse the whole footprint around the blob in the (u, v) frame
        ri, ci = np.nonzero(inside)
        qx = ci + x0 - HALF + 0.5; qz = ri + z0 - HALF + 0.5
        qu = (qx - mx) * u[0] + (qz - mz) * u[1]; qv = (qx - mx) * v[0] + (qz - mz) * v[1]
        hu = (px - mx) * u[0] + (pz - mz) * u[1]; hv = (px - mx) * v[0] + (pz - mz) * v[1]
        u0, u1 = np.percentile(hu, [2, 98]); v0, v1 = np.percentile(hv, [2, 98])
        # widen across the axis up to the eaves: where the profile falls back to the main roof level
        vb = np.arange(math.floor(v0) - 8, math.ceil(v1) + 9)
        selu = (qu > u0) & (qu < u1)
        prof = []
        for vv in vb:
            s = selu & (qv >= vv) & (qv < vv + 1)
            prof.append(np.median(rel[ri[s], ci[s]]) if s.sum() > 4 else np.nan)
        prof = np.array(prof)
        jc = int(np.nanargmax(np.where(np.isnan(prof), -1e9, prof)))
        thr = base + 1.0
        a_ = jc
        while a_ - 1 >= 0 and not np.isnan(prof[a_ - 1]) and prof[a_ - 1] > thr:
            a_ -= 1
        b_ = jc
        while b_ + 1 < len(prof) and not np.isnan(prof[b_ + 1]) and prof[b_ + 1] > thr:
            b_ += 1
        va, vb_ = vb[a_], vb[b_] + 1
        W = vb_ - va
        if W < 12:
            continue
        # along the axis: extent where the strip stays above the main level
        sv = (qv >= va) & (qv < vb_)
        ub = np.arange(math.floor(u0) - 6, math.ceil(u1) + 7)
        along = np.array([np.median(rel[ri[sv & (qu >= uu) & (qu < uu + 1)], ci[sv & (qu >= uu) & (qu < uu + 1)]]) if (sv & (qu >= uu) & (qu < uu + 1)).sum() > 4 else np.nan for uu in ub])
        okk = ~np.isnan(along) & (along > thr)
        if okk.sum() < 10:
            continue
        idx = np.nonzero(okk)[0]
        # longest run
        runs = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
        run = max(runs, key=len)
        ua, ubb = ub[run[0]], ub[run[-1]] + 1
        Lr = ubb - ua
        if Lr < 12:
            continue
        # resample the cross-section to NS samples and check the fit
        sel = (qu >= ua) & (qu < ubb) & sv
        cv = qv[sel]; ch = rel[ri[sel], ci[sel]]
        edges = np.linspace(va, vb_, NS + 1)
        cs = []
        for j in range(NS):
            s = (cv >= edges[j]) & (cv < edges[j + 1])
            cs.append(float(np.median(ch[s])) if s.sum() > 3 else np.nan)
        cs = np.array(cs)
        if np.isnan(cs).any():
            good = ~np.isnan(cs)
            if good.sum() < NS - 2:
                continue
            cs = np.interp(np.arange(NS), np.nonzero(good)[0], cs[good])
        cs = ndi.gaussian_filter1d(cs, 0.6, mode="nearest")
        model = np.interp(cv, (edges[:-1] + edges[1:]) / 2, cs)
        res = np.abs(ch - model)
        fit = float((res < 1.5).mean())
        rise = float(cs.max() - cs.min())
        # flat-topped boxes are handled by the height tiers; keep only curved or sloped profiles
        curv = float(np.std(np.diff(cs)))
        slope = float(np.median(np.abs(np.diff(cs)))) / ((vb_ - va) / NS)
        # vault / gable: crest inside, both eaves well below it, rising then falling (0.3 m noise allowed)
        jm = int(np.argmax(cs)); dif = np.diff(cs)
        unimodal = (dif[:jm] > -0.3).all() and (dif[jm:] < 0.3).all()
        is_vault = 2 <= jm <= NS - 3 and cs[jm] - cs[0] > 1.5 and cs[jm] - cs[-1] > 1.5 and unimodal
        # shed: one steady slope (most strips change height, no single jump dominates)
        mono = (dif > -0.3).all() or (dif < 0.3).all()
        is_shed = mono and (np.abs(dif) > 0.15).mean() > 0.6 and np.abs(dif).max() < 0.45 * rise
        if fit < 0.62 or rise < 2.0 or not (is_vault or is_shed):
            if DEBUG:
                print("  reject", b.get("n"), "fit %.2f rise %.1f slope %.2f curv %.2f" % (fit, rise, slope, curv))
            continue
        cu, cvv = (ua + ubb) / 2, (va + vb_) / 2
        cx = mx + u[0] * cu + v[0] * cvv; cz = mz + u[1] * cu + v[1] * cvv
        vaults.append({"c": [round(cx, 2), round(cz, 2)], "ang": round(math.atan2(u[1], u[0]), 4), "L": round(float(Lr), 1), "W": round(float(W), 1),
                       "prof": [round(float(h), 2) for h in cs], "base": round(base, 2), "fit": round(fit, 2), "kind": "vault" if is_vault else "shed"})
        print("%-34s vault L %5.1f W %5.1f  prof %s  fit %.2f" % ((b.get("n") or str(b["id"]))[:34], Lr, W, " ".join("%.0f" % h for h in cs), fit))
    if vaults:
        rec["vaults"] = vaults
        found += 1

json.dump(L, open(os.path.join(OUT, "lidar_bldg.json"), "w"), separators=(",", ":"))
print("buildings with vaults", found)
