# Cal Poly San Luis Obispo — interactive 3D campus model

A browser-based, walkable 3D reproduction of the Cal Poly SLO campus and the surrounding Morros / Santa Lucia foothills,
built with **Three.js** from real geographic data (not hand-modelled from scratch):

| Layer | Source |
|---|---|
| Building footprints, names, levels, roads, paths, parking lots, fields, ponds, fences, trees, street furniture | [OpenStreetMap](https://www.openstreetmap.org/) via the Overpass API (© OpenStreetMap contributors, ODbL) |
| Terrain (campus at ~8 m grid, surrounding hills ~25 m grid out to ±4.8 km) | Mapzen/AWS Terrain Tiles built from USGS 3DEP + other public elevation sources |
| PBR textures (stucco, brick, concrete, corrugated metal, clay tile, asphalt, grass, soil …) | [Poly Haven](https://polyhaven.com) and [ambientCG](https://ambientcg.com) — both **CC0** |
| Reference photos used to tune colours / facade styles | Wikimedia Commons (see `reference/credits.json` for author + licence of each) |

Everything else — facade windows/doors/frames, roofs, trees, sky, clouds, road paint, parking stalls, lamps, benches — is generated procedurally.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Production build: `npm run build` → `dist/` (static files, host anywhere). Query options: `?t=16.5` (hour of day), `?pr=1` (render scale; default 1.5 on Retina, `?pr=2` for full), `?q=low`.

The render loop runs at up to 60 fps only while something moves (camera, tour, orbit, keys) and drops to ~6 fps when idle; the sun's shadow map is re-rendered only when the sun or the shadow frustum moves.

### Controls
* **Orbit mode** (default): drag = orbit, right-drag = pan, wheel = zoom, click a building = show its name.
* **Walk mode** (`G`): `WASD` / arrows move, drag or double-click (pointer lock) to look, `Shift` run, `F` fly, `G` back to orbit.
* Bottom bar: landmarks, **time of day**, **season** (green ↔ golden hills), `P` = save a screenshot, `H` = hide UI.

## Rebuilding the data

```bash
# 1. raw downloads (OSM JSON + terrain tiles) live in data/raw/  (see tools/ for the fetch commands used)
# 2. convert to the compact files the app loads:
npm run data         # → public/data/campus.json, terrain_core.bin, terrain_outer.bin
```

`tools/building-rules.mjs` is where per-building styles live (wall material, roof, window pattern, height overrides for landmarks).
`tools/fetch_textures.py` downloads the CC0 textures, `tools/fetch_refs.py` the reference photos.

## Progress screenshots

Every screenshot taken while developing is saved in `screenshots/` (numbered in order). Open `screenshots/index.html` for a gallery and
`screenshots/progression.mp4` for a time-lapse (`node tools/make-gallery.mjs` regenerates both).

## Accuracy — what is real and what is a guess

* **Measured**: footprints, roads, paths, lots, ponds, fields (OSM); terrain, building heights, roof pitch / gable-vs-hip / height tiers,
  rooftop equipment and tree positions + sizes (USGS 2018 LiDAR); flat-roof appearance and ground colour (USGS orthophoto).
* **Photo-matched by hand**: facade materials and details of ~25 landmark buildings (see `tools/building-rules.mjs`).
* **Estimated**: wall materials / colours of the remaining buildings, window layouts, tree species, road widths and markings, street furniture.
* **Not modelled**: interiors (windows use fake interior mapping), signage beyond building names, people, moving vehicles.

## Layout

```
src/main.js        scene setup, loading, post-processing (N8AO, bloom, grade, SMAA), render loop
src/ground.js      OSM + aerial -> ground splat maps, terrain shader (no-tile sampling, aerial colour transfer), contact shadows
src/buildings.js   footprints -> walls / roofs / portals / colonnades / signs / downspouts, roof + facade material set
src/landmarks.js   hand-tuned landmark overrides (Union, Frost, Baker, Rec Center, yakʔitʸutʸu halls, Construction Innovations
                   Center): breezeways cut through footprints, glazed lounge 'lanterns',
                   blocks with different styles, projecting bands, glazed lanterns -- merged at load time, no data rebuild
src/pacplaza.js    Performing Arts Center plaza (paving, bollards, benches, wire-mesh globes); PAC shells live in buildings.js
src/atmosphere.js  aerial perspective: height-dependent haze + sun-side forward scattering (replaces three's fog chunks)
src/shading.js     shader library: facade (windows, interior mapping, brick, metal, stucco palette), roofs, pavements, desire paths
src/trees.js       LiDAR-placed instanced trees with clustered crowns, solid cores, limbs, 3-tier LOD
src/grass.js       grass tufts around the camera     src/paths.js  sidewalks, pavers, steps, curbs, desire paths
src/smooth.js      curve smoothing for OSM centre lines   src/roadmarks.js  lane paint, crosswalks, parking stalls
src/fields.js      sports surfaces, grandstands, light towers   src/props.js  lamps, benches, bike racks, cars, fences, "The P"
src/water.js       ponds, pools, streams         src/sky.js, src/clouds.js, src/night.js, src/grade.js  sky, sun, night, colour grade
src/controls.js    walk mode + collisions        src/ui.js, src/labels.js, src/tour.js  HUD, landmarks, name labels, camera tour
tools/             data pipeline (OSM, DEM, LiDAR, aerial), texture / photo fetchers, calibration and gallery scripts
```

## Real-world data derived from the USGS aerial photo

`tools/fetch_aerial.py` downloads the USGS "Imagery Only" orthophotos (public domain) for ±2 km, ±4.8 km and ±20.5 km and resamples them
onto the model's local metre grid (`data/raw/aerial/{campus,wide,far}_4096.jpg`). They are requested in Web Mercator and the server's actual
extent is read back: an earlier lat/lon (EPSG:4326) export at a square size had been silently stretched by the server to square pixels in
*degrees*, squashing every image north–south by cos(35.3°) = 0.82 — roof colours, aerial-classified plazas and detected trees were up to
~360 m out of place. Registration is now checked against the LiDAR by edge cross-correlation (1–2 m everywhere, previously up to 156 m).

`tools/aerial.py` (needs `data/raw/aerial/campus_4096.jpg`) produces:

* `public/data/roofs.json` — median roof colour inside every OSM footprint. At load time `applyRoof()` in `src/buildings.js` uses it to pick tile vs. flat vs. shingle vs. metal roofs, switch a building between flat and hipped, and tint the procedural roof materials to match the photo.
* `public/data/macro.jpg` — buildings / roads / tree canopy masked out, then blurred; the terrain shader transfers its colour onto the grass, soil and hillside layers (the season slider blends between lush green, the photographed colours and parched gold).
* `public/data/trees_detected.json` — ~35k tree crowns found in the photo (position, radius, species hint) that replace the random tree scatter inside the photo's footprint.

## USGS LiDAR (3DEP) — measured heights, roofs, terrain and trees

The 2018 USGS 3DEP survey **CA_FEMA_Z4_B2_2018** (public domain, Entwine Point Tiles on AWS) is used for:

| Product | Script | Used for |
|---|---|---|
| 1 m bare-earth + surface models (±2 km) | `tools/lidar_rasters.py` | 4 m terrain mesh for the campus core |
| per-building height, roof pitch, gable-vs-hip, height tiers, rooftop equipment | `tools/lidar_derive.py` → `public/data/lidar_bldg.json` | building massing, roof shapes, stepped upper storeys, HVAC boxes |
| tree crowns (position, height, radius) | `tools/lidar_derive.py` → `public/data/trees_lidar.json` | ~37k campus trees at their real positions and sizes |
| 4 m bare earth + canopy (±4.8 km, coarser fetch) | `tools/lidar_wide.py` | 12 m outer terrain mesh, ~48k hillside trees, outer ground colour |
| curved / sloped roof volumes (barrel vaults, curved shed roofs) | `tools/lidar_vaults.py` → `vaults` in `lidar_bldg.json` | measured cross-section swept along the volume's axis: the Rec Center gym vault, Aero Hangar, Facility Services, Vista Grande … |

Rebuild (needs a Python venv with `laspy[lazrs]`, `numpy`, `scipy`, `shapely`, `pillow`):

```bash
python3 -m venv --system-site-packages .venv && .venv/bin/pip install "laspy[lazrs]" shapely
.venv/bin/python -I tools/lidar_fetch.py --depth 10                                   # ~260 MB of LAZ tiles, ±2 km
HALF=4800 OUTNAME=points_wide.npz .venv/bin/python -I tools/lidar_fetch.py --depth 9  # ±4.8 km, coarser
.venv/bin/python -I tools/lidar_rasters.py && npm run data
.venv/bin/python -I tools/fetch_aerial.py                                            # registered USGS orthophotos
.venv/bin/python -I tools/lidar_derive.py && .venv/bin/python -I tools/lidar_vaults.py
.venv/bin/python -I tools/lidar_wings.py && .venv/bin/python -I tools/lidar_towers.py
.venv/bin/python -I tools/lidar_wide.py && .venv/bin/python -I tools/aerial.py
```

Other measured / photo-derived inputs: flat roofs are textured directly from the USGS orthophoto (`public/data/aerial.jpg`, canopy/shadow pixels
rejected), ground and roof colours are calibrated class-by-class against the orthophoto with `tools/calib.py` and `tools/calib_roofs.py` (top-down render
at a *summer* noon sun, like the aerial flight), and landmark details (colonnades at the
Kennedy Library / Orfalea / University Union, stone cladding at the PAC, arched windows on the Sierra Madre / Yosemite towers, rose-taupe stucco at
Poly Canyon Village, red-brick halls, white walls + red metal roof at Agricultural Sciences, "The P" on the hill) come from the reference photos and OSM.

## Status (latest pass)

Done in the second pass (fidelity / detail), each checked in screenshots `073`–`190`:
* **Measured geometry**: USGS LiDAR heights for 1,745 buildings, pitched vs flat and gable vs hip roofs from the point cloud, stepped upper
  storeys (Library, Baker, PAC …), LiDAR-detected rooftop HVAC / penthouses, LiDAR bare-earth terrain (4 m core, 12 m out to ±4.8 km),
  ~37k campus + ~29k hillside trees at their measured positions, heights and crown sizes.
* **Photo-derived colour**: flat roofs textured from the orthophoto, pitched-roof tint from the photo, ground colour transferred from the photo
  (calibrated per surface class with `tools/calib.py`: asphalt, parking and lawns within ~10 % of the aerial), unmapped plazas / lawns
  classified from the aerial + LiDAR, the campus boundary treated as landscaped grounds.
* **Building detail**: divided-lite windows, interior-mapped rooms behind the glass, arched windows, colonnades, entrance portals with steps and
  rails, cast-letter name signs, fascia + soffits under eaves, ridge / hip caps, downspouts, entrance wall lights, stone panel cladding,
  green-framed windows (Cotchett), Spanos-style grandstands with press boxes, "The P" on the hill.
* **Look**: calibrated clear-sky gradient + haze, warmer white balance, grass tufts near the camera, clustered tree crowns with limbs.
* **Skyline**: a far terrain ring out to ±20 km (USGS terrain tiles + a wide USGS aerial) so Bishop Peak and the Morros chain toward
  Morro Bay sit on the horizon as in photos taken from the hills ("Hill vista" button / last stop of the tour).
* **Roofs**: pitched roofs now also take their broad colour variation from the orthophoto (flat roofs use it at full resolution).
* **More photo matches** (Commons `CalPoly01–103` series by Stilfehler, `reference/photos_series/`, credits in `reference/series_credits.json`):
  red-brick halls with wide slider windows and thin coping (Sequoia), raw-concrete Architecture building with an open ground floor,
  Poly Canyon Village with a red-brick ground storey and cast-stone course, Mott Gym as tan precast panels with green ribs.
* **Brick shading** fixed so brick reads as brick at every distance (correct 10 mm joints, darker mortar, distance-aware averaging).

Third pass (checked in screenshots `220`–`358`):
* **Aerial registration fixed** (see above) and everything derived from it regenerated: roof colours/classes, macro ground colour, aerial
  plaza/lawn classes, detected trees, tree species hints, wide/far ring colours.
* **Paving**: unmapped plazas, aprons and wide walks are now classified from the registered aerial at 1 m (previously 2 m and excluded within
  ~3.5 m of every mapped path), so the core reads as the paved campus it is instead of lawn.
* **Recalibrated** against the registered aerial (summer sun): walks, lawns and roofs within ~1–5 %, light roofs 2–4 %, clay tile deliberately *more* saturated than the aerial (its haze roughly
  halves tile saturation: ~0.3 in the photo vs ~0.6 in ground photos of Dexter, the Natatorium and the Business School, which now set the
  terracotta red; tone mapping pushes bright reds orange, so tile sits a little darker),
  asphalt / parking ~5–20 % darker than the (hazy) photo. The terrain's own concrete layer (building aprons and the aerial-classified plazas —
  OSM walks are separate ribbons) had never been calibrated and rendered brown at ~60 % of the photo's brightness; it is now light neutral concrete
  within ~10 % (`aer-paved` class in `tools/calib.py`). Desire-path trails are only kept where they cross lawn (they were dark patches on plazas). Brown gravel roofs no longer turn mauve: the sky used for image-based lighting is
  desaturated (the visible sky is unchanged; `?envdesat=` to experiment) and roofs take less environment light, since the photo colour already
  contains skylight.
* **Curved roofs from LiDAR** (`tools/lidar_vaults.py`): the Rec Center gym's silver barrel vault (eaves ~16 m, crest ~23 m) and its lower
  curved east roof, the Aero Hangar, and other measured vaults / sheds. Footprint walls that run along a measured gym vault take the vault's
  corrugated-silver cladding from the ground up, so the Rec Center reads as the photographed silver gym boxes behind the glass / red annex.
* **Photo matches** from the CalPoly01–103 series: Engineering IV / Bonderson / Advanced Technologies Lab as sand-coloured stone-jointed
  panels with ribbon windows under a floating sun canopy on posts; Baker Center in terracotta rainscreen brick; blue standing-seam roofs on the
  Performing Arts Center; white panelled Mathematics & Science; Graphic Arts, Construction Innovations Center, Engineering East; a red-brick
  base on the University Union; Crandall Gym and the Natatorium as white lime-washed Mission-revival stucco under clay tile (they had
  inherited Mott Gym's sand panels and green ribs).
* **Brick / concrete paver fields**: the aerial can't tell red pavers from concrete at 1 m, so paving within 12 m of OSM walks tagged with a
  paver surface is treated as the same paver field (University Union plaza, Dexter walk), in the salmon-terracotta of the photos.
* **Planting beds**: open ground within 30 m of buildings that the photo shows as neither lawn nor paving drops the mown-lawn fill and
  uses the natural-ground shader (photo colour, taller tufts) — shrub / mulch beds rather than turf. Aerial classes now keep thin strips
  (paving and lawn margins along paths) instead of eroding them away, and irrigated lawn is only classified on developed ground (within
  40 m of buildings / paths), so green hillside patches are no longer turned into mown turf. Unclassified ground in the core: −40 %.
* **Clay-tile wings on flat buildings** (`tools/lidar_wings.py`): each rectangle of a footprint is tested on its own (LiDAR slope + aerial
  tile colour), so the Dexter Building now has its red-tile hipped wings along Dexter Lawn around a flat core, as in the photos.
* **Window glass** reflects the real clear-sky gradient with a Fresnel falloff (dark straight on, sky sheen at grazing angles) instead of the
  desaturated lighting copy of the sky, so windows read as sunlit glass rather than dark holes; near sunset the reflected horizon band turns warm with the sky.
* **Lawns**: mowing stripes (1.9 m bands along the campus grid that swap light/dark with the viewing direction); the sparse grass tufts on mowed
  lawns are gone (ambient occlusion turned them into black specks).
* **Trees**: leaf textures no longer bleed black into their edges at lower mip levels (the dark scribbled crown outlines); near trees
  (< 95 m) and mid-distance trees (95–330 m) use ~2× more, smaller leaf cards, so crowns read as foliage rather than a few large cards. Eucalyptus get open, irregular crowns (many smaller clumps scattered up the
  height, leaf cards filling each clump's volume and hanging more vertically, thinner opaque core) instead of round "lollipop" crowns.
* **Post-2018 buildings**: the William & Linda Frost Center (opened 2021), the new Vista Grande dining complex, the wine & viticulture
  buildings and the Summit SLO apartments ignore the 2018 point cloud, which shows their construction sites (the Frost Center had been a 2.9 m "building" under a crane).
  Parking structures always get a flat top deck (their ramps used to measure as a hipped roof).
* **Clock tower** (`tools/lidar_towers.py`): compact blobs rising > 4 m above a building's own roof, rectangular and not green in the
  photo, become tower volumes with a pyramid (tile) or flat top. This finds the Business / Education clock tower on the corner of the
  Cotchett building (≈20 m, now with clock faces as in the Business School aerial photo) plus stair towers on two parking structures and
  Muir Hall.
* Distant parts of the cloud layer no longer read as flat "beams" from the ground.

Not verified / known issues:
* Frame time (measured with a forced GPU sync, 1024×768, render scale 1, on the development Mac): ~31 ms for an oblique campus view and
  ~28 ms at eye level on Dexter Lawn (≈ 32–36 fps). At eye level roughly 14 ms is post-processing (SSAO, bloom, grade, SMAA), ~7 ms terrain
  shading, ~5 ms trees, ~2 ms buildings; `?treer=` sets the radius of the detailed near-tree tier (default 95 m). Higher render scales cost more;
  `?q=low` turns off SSAO and thins trees for weaker GPUs.
* Building heights for the ~35 buildings the LiDAR doesn't cover, and the post-2018 buildings listed in `tools/building-rules.mjs`
  (`noLidar`), are estimated from rules; other buildings rebuilt since 2018 may still show their predecessor's height.
* Roof-type, tree-species and plaza/lawn classifications are heuristic; individual buildings can still be wrong.
* Facade materials are only photo-matched for ~25 landmark buildings; the rest use rules (stucco palette, brick, concrete, metal).

