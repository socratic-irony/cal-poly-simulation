"""Download CC0 PBR textures from Poly Haven (https://polyhaven.com, CC0 license)."""
import json, os, sys, urllib.request

UA = {"User-Agent": "campus-model-builder/0.1"}
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "textures")
RES = "1k"
HIRES = {"plaster_white", "concrete_smooth", "concrete_panels", "concrete_slab", "concrete_light", "stucco_cream", "stucco_sand", "bark_oak", "bark_euc"}  # walls/bark seen up close: 2k

# name used by the app -> Poly Haven asset id
ASSETS = {
    "stucco_cream": "beige_wall_001",
    "stucco_sand": "beige_wall_002",
    "plaster_white": "painted_plaster_wall",
    "brick_red": "red_brick",
    "brick_brown": "brick_wall_09",
    "brick_buff": "brown_brick_02",
    "concrete_smooth": "concrete_wall_001",
    "concrete_panels": "concrete_panels",
    "concrete_slab": "concrete_slab_wall",
    "concrete_light": "concrete_wall_009",
    "metal_silver": "corrugated_iron",
    "metal_dark": "corrugated_iron_02",
    "metal_red": "box_profile_metal_sheet",
    "roof_clay": "clay_roof_tiles_02",
    "roof_clay_dark": "clay_roof_tiles_03",
    "roof_grey": "grey_roof_01",
    "asphalt": "asphalt_02",
    "sidewalk": "concrete_floor_01",
    "pavers": "concrete_pavers",
    "dry_ground": "dry_ground_01",
    "farm_soil": "farm_soil",
    "gravel": "gravel_ground_01",
    "grass_alt": "leafy_grass",
    "bark_oak": "bark_brown_02",
    "bark_euc": "eucalyptus_bark",
    "bark_pine": "pine_bark",
    "bark_light": "bark_willow",
    "bark_palm": "palm_tree_bark",
}
MAPS = [("Diffuse", "diff"), ("nor_gl", "nor"), ("Rough", "rough")]

def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if binary else json.loads(data)

os.makedirs(OUT, exist_ok=True)
credits = []
for name, pid in ASSETS.items():
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    try:
        files = get(f"https://api.polyhaven.com/files/{pid}")
    except Exception as e:
        print("FAIL files", pid, e); continue
    for key, short in MAPS:
        try:
            res = "2k" if name in HIRES else RES
            url = files[key][res]["jpg"]["url"]
            dest = os.path.join(d, f"{short}.jpg")
            if res == "2k" and os.path.exists(dest) and os.path.getsize(dest) < 900_000 and short == "diff":
                os.remove(dest)
            if res == "2k" and os.path.exists(dest) and short != "diff" and not os.path.exists(dest + ".2k"):
                os.remove(dest)
            if not os.path.exists(dest):
                open(dest, "wb").write(get(url, True))
                if res == "2k": open(dest + ".2k", "w").write("1")
        except Exception as e:
            print("  missing", pid, key, e)
    credits.append((name, pid))
    print("ok", name, pid)
json.dump(credits, open(os.path.join(OUT, "sources.json"), "w"), indent=1)
