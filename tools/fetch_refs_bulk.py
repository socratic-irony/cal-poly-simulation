"""Fetch small thumbnails of the CalPoly01..CalPoly103 Commons series (Stilfehler, CC BY-SA 4.0) for building identification."""
import json, os, re, time, urllib.parse, urllib.request
UA = {"User-Agent": "campus-model-builder/0.1"}
ROOT = os.path.join(os.path.dirname(__file__), "..", "reference")
OUT = os.path.join(ROOT, "photos_series"); os.makedirs(OUT, exist_ok=True)
titles = [f"CalPoly{n:02d}.jpg" for n in range(1, 104)] + [f"CalPoly{n}.jpg" for n in range(100, 104)]
titles = sorted(set(titles))
credits = {}
for i in range(0, len(titles), 40):
    chunk = titles[i:i + 40]
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"action": "query", "format": "json", "prop": "imageinfo|categories", "iiprop": "url|extmetadata", "iiurlwidth": 640, "cllimit": "max", "titles": "|".join("File:" + t for t in chunk)})
    d = json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())
    for p in d["query"]["pages"].values():
        ii = (p.get("imageinfo") or [None])[0]
        if not ii: continue
        md = ii["extmetadata"]
        desc = re.sub(r"<[^>]+>", "", md.get("ImageDescription", {}).get("value", ""))[:200]
        cats = [c["title"].replace("Category:", "") for c in p.get("categories", [])]
        fn = p["title"].replace("File:", "")
        dest = os.path.join(OUT, fn)
        if not os.path.exists(dest):
            for attempt in range(3):
                try:
                    open(dest, "wb").write(urllib.request.urlopen(urllib.request.Request(ii["thumburl"], headers=UA), timeout=90).read()); break
                except Exception as e:
                    time.sleep(15)
            time.sleep(3.5)
        credits[fn] = {"license": md.get("LicenseShortName", {}).get("value"), "artist": re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "")).strip(), "page": ii["descriptionurl"], "desc": desc, "cats": cats}
    time.sleep(2)
json.dump(credits, open(os.path.join(ROOT, "series_credits.json"), "w"), indent=1)
print("done", len(credits), "files", len(os.listdir(OUT)))
