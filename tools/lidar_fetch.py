"""Fetch USGS 3DEP LiDAR (CA_FEMA_Z4_B2_2018, Entwine Point Tiles on AWS, public domain) around campus.

    .venv/bin/python tools/lidar_fetch.py --plan        # show point counts per depth
    .venv/bin/python tools/lidar_fetch.py --depth 11    # download + decode -> data/raw/lidar/points.npz

Points are converted to the model's local frame (x east, z south, metres from the origin in osm-lib.mjs)
and stored as float32 arrays x, y(elevation, m), z plus uint8 classification / return info.
"""
import json, math, os, sys, io, urllib.request, concurrent.futures as cf
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "raw", "lidar")
BASE = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/CA_FEMA_Z4_B2_2018/"
UA = {"User-Agent": "campus-model-builder/0.1"}
os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)

LAT0, LON0 = 35.3007, -120.6614
phi = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
M_LON = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
R = 6378137.0
HALF = float(os.environ.get("HALF", "2000"))

def merc(lat, lon):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))

lat_n, lat_s = LAT0 + HALF / M_LAT, LAT0 - HALF / M_LAT
lon_w, lon_e = LON0 - HALF / M_LON, LON0 + HALF / M_LON
bx0, by0 = merc(lat_s, lon_w)
bx1, by1 = merc(lat_n, lon_e)

ept = json.load(open(os.path.join(OUT, "ept.json")))
B = ept["bounds"]
SIZE = B[3] - B[0]

def get(url, binary=False):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                data = r.read()
            return data if binary else json.loads(data)
        except Exception as e:
            if attempt == 3:
                raise
    return None

hier_cache = {}
def hierarchy(key):
    if key not in hier_cache:
        f = os.path.join(OUT, f"h_{key}.json")
        if os.path.exists(f):
            hier_cache[key] = json.load(open(f))
        else:
            hier_cache[key] = get(BASE + f"ept-hierarchy/{key}.json")
            json.dump(hier_cache[key], open(f, "w"))
    return hier_cache[key]

def node_bounds(d, x, y):
    s = SIZE / 2 ** d
    return B[0] + x * s, B[1] + y * s, B[0] + (x + 1) * s, B[1] + (y + 1) * s

def intersects(d, x, y):
    a0, b0, a1, b1 = node_bounds(d, x, y)
    return a0 < bx1 and a1 > bx0 and b0 < by1 and b1 > by0

def collect(maxd):
    """all node keys (d-x-y-z) with points, intersecting the bbox, depth <= maxd"""
    out = []
    pending = ["0-0-0-0"]
    root = hierarchy("0-0-0-0")
    table = dict(root)
    seen_sub = set()
    # walk the tree: expand children of every intersecting node
    stack = [(0, 0, 0, 0)]
    while stack:
        d, x, y, z = stack.pop()
        key = f"{d}-{x}-{y}-{z}"
        cnt = table.get(key)
        if cnt is None:
            continue
        if cnt == -1 and key not in seen_sub:
            seen_sub.add(key)
            sub = hierarchy(key)
            table.update(sub)
            cnt = table.get(key)
        if not intersects(d, x, y):
            continue
        if cnt and cnt > 0:
            out.append((key, cnt))
        if d < maxd:
            for dx in (0, 1):
                for dy in (0, 1):
                    for dz in (0, 1):
                        stack.append((d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz))
    return out

if "--plan" in sys.argv:
    nodes = collect(13)
    from collections import defaultdict
    per = defaultdict(lambda: [0, 0])
    for k, c in nodes:
        d = int(k.split("-")[0]); per[d][0] += 1; per[d][1] += c
    cum = 0
    for d in sorted(per):
        cum += per[d][1]
        print(f"depth {d:2d}: nodes {per[d][0]:5d} points {per[d][1]:11,d}  cumulative {cum:12,d}")
    sys.exit(0)

maxd = int(sys.argv[sys.argv.index("--depth") + 1]) if "--depth" in sys.argv else 11
nodes = collect(maxd)
print("nodes", len(nodes), "points (whole nodes)", sum(c for _, c in nodes))

import laspy

def fetch_decode(key):
    f = os.path.join(OUT, "tiles", key + ".laz")
    if not os.path.exists(f):
        open(f, "wb").write(get(BASE + f"ept-data/{key}.laz", True))
    las = laspy.read(f)
    X = np.asarray(las.x); Y = np.asarray(las.y); Z = np.asarray(las.z)
    m = (X >= bx0) & (X <= bx1) & (Y >= by0) & (Y <= by1)
    cls = np.asarray(las.classification)[m]
    rn = np.asarray(las.return_number)[m]; nr = np.asarray(las.number_of_returns)[m]
    return X[m], Y[m], Z[m], cls, rn, nr

xs, ys, zs, cs, rns, nrs = [], [], [], [], [], []
done = 0
with cf.ThreadPoolExecutor(max_workers=16) as ex:
    for res in ex.map(fetch_decode, [k for k, _ in nodes]):
        xs.append(res[0]); ys.append(res[1]); zs.append(res[2]); cs.append(res[3]); rns.append(res[4]); nrs.append(res[5])
        done += 1
        if done % 100 == 0:
            print("decoded", done, "/", len(nodes), flush=True)
X = np.concatenate(xs); Y = np.concatenate(ys); Z = np.concatenate(zs)
lon = np.degrees(X / R); lat = np.degrees(2 * np.arctan(np.exp(Y / R)) - math.pi / 2)
lx = ((lon - LON0) * M_LON).astype(np.float32)
lz = (-(lat - LAT0) * M_LAT).astype(np.float32)
np.savez(os.path.join(OUT, os.environ.get("OUTNAME", "points.npz")), x=lx, z=lz, y=Z.astype(np.float32), c=np.concatenate(cs).astype(np.uint8),
         rn=np.concatenate(rns).astype(np.uint8), nr=np.concatenate(nrs).astype(np.uint8))
from collections import Counter
print("points kept", len(lx))
print("classes", sorted(Counter(np.concatenate(cs).tolist()).items()))
