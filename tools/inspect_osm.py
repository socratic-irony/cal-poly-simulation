import json, sys, collections
d = json.load(open(sys.argv[1]))
els = d["elements"]
print("elements", len(els))
types = collections.Counter(e["type"] for e in els)
print(types)
named = [e for e in els if "name" in e.get("tags", {})]
print("named", len(named))
withh = [e for e in els if "height" in e.get("tags", {}) or "building:levels" in e.get("tags", {})]
print("with height/levels", len(withh))
btypes = collections.Counter(e["tags"].get("building") for e in els)
print(btypes.most_common(15))
for e in named[:80]:
    t = e["tags"]
    print(e["id"], t.get("name"), "|", t.get("building"), "|", t.get("height"), t.get("building:levels"), t.get("building:material"), t.get("roof:shape"))
