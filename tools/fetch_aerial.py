"""Fetch the USGS ImageryOnly aerials (public domain), registered exactly to the model's local frame.

    .venv/bin/python -I tools/fetch_aerial.py [campus|wide|far ...]

The ArcGIS MapServer keeps pixels square in the *output* spatial reference. An earlier version asked for a
lat/lon box in EPSG:4326 at a square pixel size; the server then widened the latitude range to make the pixels
square in degrees, which squashed every image north-south by cos(lat) = 0.82 (features up to ~360 m out of place
at the edge of the campus image). Now the box is requested in Web Mercator, the server's actual extent is read
back (f=json), and the result is resampled onto the local equirectangular metre grid used everywhere else
(x east, z south, origin LAT0/LON0 -- same conversion as tools/lidar_fetch.py and tools/osm-lib.mjs).

Writes data/raw/aerial/{campus,wide,far}_4096.jpg covering +/-2000, +/-4800 and +/-20480 m.
"""
import json, math, os, sys, io, urllib.request, urllib.parse
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "raw", "aerial")
UA = {"User-Agent": "campus-model-builder/0.1"}
SVC = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export"
LAT0, LON0 = 35.3007, -120.6614
phi = math.radians(LAT0)
M_LAT = 111132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
M_LON = 111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
R = 6378137.0
SIZE = 4096
JOBS = {"campus": 2000.0, "wide": 4800.0, "far": 20480.0}


def merc(lat, lon):
    return R * np.radians(lon), R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def get(url, binary=True):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r:
        d = r.read()
    return d if binary else json.loads(d)


def fetch(name, half):
    m = 1.01                                                     # small margin so resampling never reads past the edge
    lat_n, lat_s = LAT0 + half * m / M_LAT, LAT0 - half * m / M_LAT
    lon_w, lon_e = LON0 - half * m / M_LON, LON0 + half * m / M_LON
    x0, y0 = merc(lat_s, lon_w); x1, y1 = merc(lat_n, lon_e)
    q = urllib.parse.urlencode({"bbox": "%.3f,%.3f,%.3f,%.3f" % (x0, y0, x1, y1), "bboxSR": 3857, "imageSR": 3857,
                                "size": "%d,%d" % (SIZE, SIZE), "format": "jpg", "f": "json"})
    meta = get(SVC + "?" + q, binary=False)
    ex = meta["extent"]; W, H = meta["width"], meta["height"]
    src = np.asarray(Image.open(io.BytesIO(get(meta["href"]))).convert("RGB")).astype(np.float32)
    print(name, "server extent %.1f x %.1f merc-m, image %dx%d" % (ex["xmax"] - ex["xmin"], ex["ymax"] - ex["ymin"], W, H))
    # output pixel centres on the local grid -> lat/lon -> mercator -> source pixel
    s = (np.arange(SIZE) + 0.5) / SIZE * 2 * half - half
    gx, gz = np.meshgrid(s, s)
    lat = LAT0 - gz / M_LAT; lon = LON0 + gx / M_LON
    X, Y = merc(lat, lon)
    col = (X - ex["xmin"]) / (ex["xmax"] - ex["xmin"]) * src.shape[1] - 0.5
    row = (ex["ymax"] - Y) / (ex["ymax"] - ex["ymin"]) * src.shape[0] - 0.5
    out = np.stack([ndi.map_coordinates(src[..., k], [row, col], order=1, mode="nearest") for k in range(3)], -1)
    f = os.path.join(OUT, name + "_4096.jpg")
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(f, quality=93)
    print("  wrote", f)


if __name__ == "__main__":
    names = [a for a in sys.argv[1:] if a in JOBS] or list(JOBS)
    for n in names:
        fetch(n, JOBS[n])
