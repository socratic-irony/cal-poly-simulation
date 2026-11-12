"""Fetch reference photos of Cal Poly from Wikimedia Commons (with license/attribution metadata)."""
import json, os, re, time, urllib.parse, urllib.request

UA = {"User-Agent": "campus-model-builder/0.1"}
ROOT = os.path.join(os.path.dirname(__file__), "..", "reference")
OUT = os.path.join(ROOT, "photos")
os.makedirs(OUT, exist_ok=True)

TITLES = [
 "Robert E. Kennedy Library, exterior, Cal Poly SLO (September 2018).jpg",
 "Dexter Building, entrance, Cal Poly SLO (August 2017).jpg",
 "Frank E. Pilling Building, exterior, Cal Poly SLO (September 2018).jpg",
 "Frank E. Pilling Building, exterior, Cal Poly SLO (September 2018) 1.jpg",
 "Jespersen Hall.jpg",
 "Cal-Poly-Dexter-Lawn.jpg",
 "Cal Pal University Library.jpg",
 "Cal Poly Business School.jpg",
 "OrfaleaCollegeBroadview.jpg",
 "Calpoly agsci bldg.jpg",
 "Calpoly education bldg.jpg",
 "Calpoly engineering west.jpg",
 "Calpoly kinesiology bldg.jpg",
 "Calpoly outside arch bldg.jpg",
 "Calpoly rec center.jpg",
 "Center for Science.jpg",
 "ChaseHall.jpg",
 "Grant Brown Engr Bldg.jpg",
 "Cal-Poly-from-outback.jpg",
 "Cal Poly Campus - panoramio.jpg",
 "Cal-Poly-performing-arts-center.jpg",
 "Natatorium (California Polytechnic State University).jpg",
 "MottAthleticsCenterBeachExterior2023.jpg",
 "Cal Poly's New Poly Canyon Village.jpg",
 "Cal Poly Recreation Center (San Luis Obispo).jpg",
 "Cal Poly Sunset.jpg",
 "CalPolyAlexGSpanosStadiumSanLuisObispoCAJune17th2022PalmTrees.jpg",
 "CalPoly01.jpg", "CalPoly05.jpg", "CalPoly10.jpg", "CalPoly15.jpg", "CalPoly20.jpg",
 "CalPoly40.jpg", "CalPoly50.jpg", "CalPoly60.jpg", "CalPoly70.jpg", "CalPoly80.jpg", "CalPoly90.jpg",
]

def api(params):
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read())

credits = {}
for i in range(0, len(TITLES), 20):
    chunk = TITLES[i:i+20]
    d = api({"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|extmetadata|size",
             "iiurlwidth": 1400, "titles": "|".join("File:" + t for t in chunk)})
    for p in d["query"]["pages"].values():
        ii = (p.get("imageinfo") or [None])[0]
        if not ii:
            print("missing", p.get("title")); continue
        md = ii["extmetadata"]
        lic = md.get("LicenseShortName", {}).get("value", "?")
        artist = re.sub(r"<[^>]+>", "", md.get("Artist", {}).get("value", "?"))
        fname = re.sub(r"[^A-Za-z0-9._-]+", "_", p["title"].replace("File:", ""))
        dest = os.path.join(OUT, fname)
        if not os.path.exists(dest):
            try:
                data = urllib.request.urlopen(urllib.request.Request(ii["thumburl"], headers=UA), timeout=90).read()
                open(dest, "wb").write(data)
                time.sleep(4)
            except Exception as e:
                print("fail", fname, str(e)[:60]); time.sleep(10); continue
        credits[fname] = {"title": p["title"], "license": lic, "artist": artist.strip(),
                          "page": ii["descriptionurl"], "orig_size": [ii["width"], ii["height"]]}
        print(fname, "|", lic, "|", artist.strip()[:40])
json.dump(credits, open(os.path.join(ROOT, "credits.json"), "w"), indent=1)
