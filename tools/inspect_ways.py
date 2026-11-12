import json, collections
w = json.load(open("data/raw/ways.json"))["elements"]
n = json.load(open("data/raw/nodes.json"))["elements"]
print("ways", len(w), "nodes", len(n))
c = collections.Counter()
for e in w:
    t = e.get("tags", {})
    for k in ("highway", "landuse", "natural", "leisure", "amenity", "waterway", "barrier", "railway"):
        if k in t:
            c[(k, t[k])] += 1
for k, v in sorted(c.items(), key=lambda kv: -kv[1])[:70]:
    print(k, v)
print("--- nodes")
cn = collections.Counter()
for e in n:
    t = e.get("tags", {})
    for k in ("natural", "highway", "amenity", "man_made", "tourism", "historic"):
        if k in t:
            cn[(k, t[k])] += 1
for k, v in sorted(cn.items(), key=lambda kv: -kv[1])[:30]:
    print(k, v)
print("--- named campus roads")
names = collections.Counter()
for e in w:
    t = e.get("tags", {})
    if "highway" in t and "name" in t:
        names[(t["name"], t["highway"])] += 1
print(names.most_common(40))
