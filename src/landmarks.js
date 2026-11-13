// Hand-tuned overrides for landmark buildings, keyed by their OSM name. They are merged into the
// per-building style (`b.s`) at load time, after tools/building-rules.mjs has run, so they can be
// iterated on without rebuilding public/data/campus.json.
//
// Extra style keys understood by buildings.js:
//   passages: [{ a:[x,z], b:[x,z], w, h }]  ground-level breezeways: the footprint is split along the
//             strip a->b (width w); the strip keeps only the floors above h (a "bridge" with a soffit),
//             so it can be walked through. Lines are infinite, so a strip cuts the whole footprint.
//   bands:    [{ y, h, out, mat }]  projecting horizontal slabs around the perimeter (balcony
//             parapets, heavy fascias) at height y above grade, h tall, `out` metres proud of the wall
//   fins:     spacing of vertical fins (existing); finDepth / finW / finMat refine them
//   arcadeAll: apply the colonnade (s.arcade) to every edge, not only the ones facing a path

const UU_ALLEY = { a: [209.9, 48.4], b: [224.5, 66.5], w: 5.6, h: 4.4 };   // OSM way 1431383646, tunnel=building_passage

export const LANDMARK_STYLES = [
  {
    // Julian A. McPhee University Union (1971, Esherick): board-formed concrete in heavy horizontal
    // layers: a deep shadowed colonnade with storefronts at plaza level, a solid concrete balcony band,
    // a ribbon of dark glass between deep fins, and a heavy fascia. The Alley runs under the SW wing.
    re: /Julian A\. McPhee University Union/,
    s: {
      wall: 'concrete_board', pal: 0, panel: 0, stone: 0, belt: 0, trim: 0, lites: 0, coping: 0, brickBase: 0,
      win: 'ribbon', winSpacing: 3.3, floorH: 4.6, recess: 0.45, parapet: 0.2,
      arcade: { d: 4.2, h: 4.4, sp: 7.2, w: 1.0 }, arcadeAll: 1,
      fins: 3.3, finDepth: 0.9, finW: 0.4, finFrom: 4.4,
      bands: [{ y: 4.4, h: 1.25, out: 1.5 }, { y: 0, top: 1, h: 1.7, out: 0.6 }],
      passages: [UU_ALLEY],
    },
  },
  {
    // University Store / El Corral (same complex, bldg 65): the taller concrete block on the plaza
    re: /Cal Poly University Store/,
    s: {
      wall: 'concrete_board', pal: 0, panel: 0, stone: 0, belt: 0, trim: 0, lites: 0, coping: 0, brickBase: 0,
      win: 'ribbon', winSpacing: 3.3, floorH: 4.6, recess: 0.45, parapet: 0.2,
      arcade: { d: 3.2, h: 4.4, sp: 7.2, w: 1.0 },
      fins: 3.3, finDepth: 0.9, finW: 0.4, finFrom: 4.4,
      bands: [{ y: 4.4, h: 1.25, out: 1.2 }, { y: 0, top: 1, h: 1.7, out: 0.6 }],
      passages: [UU_ALLEY],
    },
  },
];

// ---- William and Linda Frost Center (ZGF, 2023): an "Italian hill town" of buff-brick tower blocks
// with sparse slot windows, stitched together by glazed modules screened by pale vertical fins and
// floor-edge bands. A two-storey breezeway runs N-S through the waist of the plan, linking North Poly
// View Drive to the courtyard behind. (Massing estimated from photos: the 2018 LiDAR predates it.)
const FROST_GLASS = {
  wall: 'metal_silver_glass', win: 'curtain', winW: 1.5, winH: 2.6, winSpacing: 1.6, floorH: 4.4, pal: 0, panel: 0, lites: 0, trim: 0,
  recess: 0.1, parapet: 0.5, coping: 1, forceH: 18.2, flatForce: 'roof_flat_new', noUnits: 1,
  fins: 1.6, finMat: 'coping', finDepth: 0.55, finW: 0.07, finFrom: 0,
  bands: [{ y: 4.4, h: 0.3, out: 0.6, mat: 'coping' }, { y: 8.8, h: 0.3, out: 0.6, mat: 'coping' }, { y: 13.2, h: 0.3, out: 0.6, mat: 'coping' }],
};
const FROST_BRICK = (h) => ({
  wall: 'brick_buff', win: 'grid', winW: 1.0, winH: 2.7, winSpacing: 3.9, floorH: 4.4, pal: 0, panel: 0, lites: 0, trim: 0,
  recess: 0.32, parapet: 0.35, coping: 1, forceH: h, fins: 0, bands: null, frame: 'dark', flatForce: 'roof_flat_new', noUnits: 1,
});
const FROST_WAIST = { a: [70, -100], b: [70, -180], w: 6.5, h: 8.6 };

// ---- Warren J. Baker Center for Science and Mathematics (ZGF, 2013): orange brick with wide punched
// windows in dark frames and a charcoal metal parapet band, plus a five-storey glazed "lantern"
// screened by horizontal silver sunshades at the entrance facing the lawn.
const BAKER = {
  wall: 'brick_terracotta', panel: 0, stone: 0, belt: 0, lites: 0, trim: 0, coping: 0, frame: 'dark',
  win: 'grid', winW: 2.5, winH: 1.9, winSpacing: 3.4, recess: 0.28, atrium: null,
  bands: [{ y: 0, top: 1, h: 1.5, out: 0.18, mat: 'metal_dark' }],
  boxes: [{ c: [88.35, -54.1], w: 17, d: 6, h: 22.5, ang: -0.237, louvers: 1.05, louverFrom: 4.6, louverFaces: [1, 2, 3], spacing: 1.7, winH: 3.0, floorH: 4.3 }],
};

LANDMARK_STYLES.push(
  {
    re: /William and Linda Frost Center/,
    s: {
      atrium: null, noLidar: 1,
      passages: [FROST_WAIST],
      splits: [{ a: [31, -200], b: [31, -50] }, { a: [89, -200], b: [89, -50] }, { a: [-50, -128], b: [200, -128] }, { a: [-50, -150], b: [200, -150] }],
      cells: (x, z, lift) => {
        if (lift) return FROST_GLASS;
        if (x < 31) return z < -128 ? FROST_GLASS : FROST_BRICK(22.5);
        if (x < 67) return z < -128 ? FROST_BRICK(21) : FROST_GLASS;
        if (x < 89) return z < -150 ? FROST_GLASS : FROST_BRICK(23.5);
        return z < -150 ? FROST_BRICK(20) : z < -128 ? FROST_BRICK(21.5) : FROST_GLASS;
      },
    },
  },
  { re: /Warren J\. Baker Center/, s: BAKER },
);

// ---- ASI Recreation Center: the 2012 expansion's street corner is a two-storey glass fitness pavilion
// with a rounded corner and thick red rainscreen bands, cantilevered over round white columns; the
// silver barrel-vaulted gyms behind are measured by LiDAR and left to the generic vault builder.
const REC_PAVILION = {
  wall: 'metal_silver_glass', win: 'curtain', winW: 1.7, winH: 2.4, winSpacing: 1.8, floorH: 4.6, accent: null, pal: 0,
  forceH: 14.6, noTiers: 1, noVaults: 1, noUnits: 1, vaultWall: null, parapet: 0.3, recess: 0.08,
  arcade: { d: 3.6, h: 5.0, sp: 8.5, w: 1.0, round: 1 }, arcadeAll: 1,
  bands: [{ y: 5.0, h: 2.0, out: 0.3, mat: 'panel_red' }, { y: 0, top: 1, h: 1.7, out: 0.3, mat: 'panel_red' }],
  fillet: 14,
};
LANDMARK_STYLES.push({
  re: /^Recreation Center$/,
  s: {
    vaultRoof: 'roof_silver_clean',
    splits: [{ a: [168.7, 319.2], b: [208.3, 296.6] }],
    cells: (x, z) => {
      // the block on the SE side of the cut line (toward the street corner)
      const side = (208.3 - 168.7) * (z - 319.2) - (296.6 - 319.2) * (x - 168.7);
      return side > 0 ? REC_PAVILION : null;
    },
  },
});

// ---- yakʔitʸutʸu residence halls (Valerio Dewalt Train, 2018): long 4-5 storey bars clad in smooth
// white panels, paired windows in charcoal frames, and full-height glass lounges ("lanterns") framed in
// bronze or copper with coloured glass fins -- each hall has its own three-colour palette.
const YTT = {
  wall: 'stucco_white', pal: 0, panel: 0, stone: 0, belt: 0, trim: 0, lites: 0, coping: 1, frame: 'dark',
  win: 'grid', winW: 2.3, winH: 1.55, winSpacing: 3.7, floorH: 3.2, recess: 0.32, parapet: 0.45,
  roof: 'flat', noUnits: 1, kind: 'dorm', flatForce: 'roof_flat_new', baseH: 6.4, basePal: 3,
};
const YTT_HALLS = {
  A: { fins: ['fin_orange', 'fin_amber', 'fin_yellow'], frame: 'frame_copper', at: [[0.12, 1], [0.86, -1]] },
  B: { fins: ['fin_green', 'fin_lime', 'fin_yellow'], frame: 'frame_bronze', at: [[0.14, -1], [0.82, 1]] },
  C: { fins: ['fin_red', 'fin_orange', 'fin_amber'], frame: 'frame_copper', at: [[0.15, 1], [0.85, -1]] },
  D: { fins: ['fin_teal', 'fin_green', 'fin_lime'], frame: 'frame_bronze', at: [[0.13, -1], [0.86, 1]] },
  E: { fins: ['fin_amber', 'fin_yellow', 'fin_lime'], frame: 'frame_copper', at: [[0.2, 1]] },
  F: { fins: ['fin_orange', 'fin_red', 'fin_amber'], frame: 'frame_bronze', at: [[0.12, 1], [0.84, -1]] },
  G: { fins: ['fin_green', 'fin_teal', 'fin_yellow'], frame: 'frame_copper', at: [[0.14, -1], [0.85, 1]] },
};
for (const [k, H] of Object.entries(YTT_HALLS)) {
  LANDMARK_STYLES.push({
    re: new RegExp('^172' + k + ' '),
    s: { ...YTT, lanterns: H.at.map(([u, side]) => ({ u, side, w: 9.5, d: 3.2, fins: H.fins, frame: H.frame })) },
  });
}

// ---- Construction Innovations Center (2008): a pale-blue glass wing with horizontal sunshades under a
// thin floating roof plane, a sand-coloured block with tall strip windows, and a silver metal end, with
// an exposed-steel breezeway at the junction of the glass wing and the rest of the bar.
const CIC_GLASS = {
  wall: 'pac_glass', win: 'curtain', winW: 1.5, winH: 2.6, winSpacing: 1.6, floorH: 4.4, pal: 0, panel: 0, lites: 0, trim: 0,
  recess: 0.08, parapet: 0.3, coping: 0, canopy: 1, canopyLift: 1.8, canopyOut: 3.2, noUnits: 1,
  bands: [2.9, 7.3, 11.7].map((y) => ({ y, h: 0.12, out: 1.1, mat: 'metal_silver' })),
};
const CIC_SAND = {
  wall: 'stucco_sand', pal: 3, panel: 1, lites: 0, trim: 0, belt: 0, frame: 'dark',
  win: 'grid', winW: 1.7, winH: 3.5, winSpacing: 6.2, floorH: 4.4, recess: 0.35, parapet: 0.5, coping: 1,
};
const CIC_METAL = { wall: 'metal_silver', pal: 0, win: 'ribbon', winSpacing: 3.0, floorH: 4.4, recess: 0.2, panel: 0, coping: 1 };
const CIC_A = [-151.5, 141.6], CIC_B = [-145.7, 161.2];
LANDMARK_STYLES.push({
  re: /^Construction Innovations Center$/,
  s: {
    passages: [{ a: CIC_A, b: CIC_B, w: 5.0, h: 4.4 }],
    splits: [{ a: [-118, 160], b: [-113.6, 179.5] }],
    cells: (x, z, lift) => {
      if (lift) return { ...CIC_METAL, wall: 'metal_dark', win: 'ribbon', bands: [{ y: 5.45, h: 0.08, out: 1.3, mat: 'rail' }, { y: 9.85, h: 0.08, out: 1.3, mat: 'rail' }, { y: 4.4, h: 0.25, out: 1.4, mat: 'metal_silver' }, { y: 8.8, h: 0.25, out: 1.4, mat: 'metal_silver' }] };   // steel walkway decks + top rails
      const side = (CIC_B[0] - CIC_A[0]) * (z - CIC_A[1]) - (CIC_B[1] - CIC_A[1]) * (x - CIC_A[0]);
      if (side > 0) return CIC_GLASS;           // west of the junction
      return x < -116 ? CIC_SAND : CIC_METAL;
    },
  },
});

// ---- Robert E. Kennedy Library (Marquis, 1977; Miller Hull renovation 2025): five storeys of pale
// cast-in-place concrete. Every floor is a deep spandrel band under a ribbon of glass shaded by
// closely spaced concrete fins; the upper floors step back in terraces on the north and east sides and
// around the central courtyard (plate outlines measured from the 2018 LiDAR, in a building-aligned frame).
{
  const FH = 4.45, L = (k) => k * FH;
  const lib = { wall: 'concrete_cream', spacing: 1.5, fins: { d: 0.6, w: 0.22, from: 1.3 }, recess: 0.35 };
  const band = (k) => ({ y: L(k) - 0.35, h: 1.65, out: 0.6 }), cap = (k, h = 1.0) => ({ y: L(k) - 0.05, h, out: 0.5 });
  const court = [[-22, 6], [16, 6], [16, 26], [-22, 26]];
  LANDMARK_STYLES.push({
    re: /^Robert E\. Kennedy Library$/,
    s: {
      plateFrame: { o: [-215.1, -135.9], ang: -0.2237 }, plateSeed: 0.72, flatMat: 'roof_flat_c',
      plates: [
        // ground floor: glazing set back behind square columns
        { ...lib, poly: 'footprint', holes: 'footprint', y0: 0, y1: L(1), inset: 3.0, win: 'storefront', spacing: 3.75, fins: null, columns: { sp: 7.5, w: 0.8 } },
        { ...lib, poly: [[-44.3, -23.5], [33.2, -23.5], [33.5, -17.4], [31.8, -14.2], [31.9, 3.6], [39.7, 3.9], [39.7, 38.3], [-44.3, 38.6]], holes: 'footprint',
          y0: L(1), y1: L(2), soffit: 1, bands: [band(1), cap(2)] },
        { ...lib, poly: [[-42, -18.5], [30, -18.5], [30, 6], [37.5, 6], [37.5, 38.5], [-42, 38.5]], holes: [[[-18, 10], [14, 10], [14, 26], [-18, 26]]],
          y0: L(2), y1: L(3), bands: [band(2), cap(3)] },
        { ...lib, poly: [[-42, -18.5], [-30, -18.5], [-30, -14], [18, -14], [18, -18.5], [30, -18.5], [30, 6], [34, 6], [34, 38.5], [-42, 38.5]], holes: [court],
          y0: L(3), y1: L(4), bands: [band(3), cap(4)] },
        { ...lib, poly: [[-42, -14], [30, -14], [30, 38.5], [-42, 38.5]], holes: [court], y0: L(4), y1: L(5), bands: [band(4), cap(5, 1.3)] },
        // solid stair towers on the north face
        { wall: 'concrete_cream', win: 'none', poly: [[-28.7, -19.5], [-24, -19.5], [-24, -13.5], [-28.7, -13.5]], y0: L(2), y1: L(5) + 1.3 },
        { wall: 'concrete_cream', win: 'none', poly: [[12.5, -19.5], [18.4, -19.5], [18.4, -13.5], [12.5, -13.5]], y0: L(2), y1: L(5) + 1.3 },
      ],
    },
  });
}

// ---- Bonderson Projects Center (2007): low gold slate-panel blocks around a work yard, tall dark-framed
// glazing, and thin flat roofs floating past the walls on slim steel posts. Outlines from the LiDAR.
{
  const bp = { wall: 'ochre_panel', panel: 1, win: 'grid', winW: 2.6, winH: 2.7, spacing: 4.4, recess: 0.3, seed: 0.75 };
  const upper = [[-31.6, -9.1], [-13.4, -9.2], [-13.4, -14], [23.9, -14.3], [23.9, 5], [-11, 5], [-11, 16.4], [-31.6, 16.4]];
  const roof = (poly, y, out) => ({ wall: 'metal_dark', win: 'none', poly, y0: y, y1: y + 0.28, inset: -out, roof: 'roof_metal_silver', soffit: 1,
    columns: { sp: 6.5, w: 0.16, from: 0, out: out - 0.5, mat: 'rail' } });
  LANDMARK_STYLES.push({
    re: /^Bonderson Projects Center$/,
    s: {
      plateFrame: { o: [-253.4, -202.2], ang: -0.2237 }, plateSeed: 0.75,
      plates: [
        { ...bp, poly: 'footprint', y0: 0, y1: 4.5, winH: 3.0, bands: [{ y: 4.5 - 0.1, h: 0.5, out: 0.12, mat: 'metal_dark' }] },
        { ...bp, poly: upper, y0: 4.5, y1: 8.9, bands: [{ y: 8.9 - 0.25, h: 0.45, out: 0.12, mat: 'metal_dark' }] },
        // glazed corner on the plaza (north-east) end of the north bar
        { wall: 'pac_glass', win: 'curtain', winW: 1.5, winH: 3.2, spacing: 1.6, floorH: 4.4, poly: [[15, -14.6], [24.3, -14.6], [24.3, 5.3], [15, 5.3]], y0: 0, y1: 8.6, recess: 0.1 },
        roof(upper, 9.7, 2.6),
        // lower floating roof over the single-storey south and east wings
        roof([[-11, 5], [22.7, 5], [22.7, 21.2], [-26.8, 21.6], [-26.8, 16.4], [-11, 16.4]], 5.2, 1.8),
      ],
    },
  });
  // the rest of the Engineering Plaza group shares the gold panels and floating sun canopies
  LANDMARK_STYLES.push({ re: /^Advanced Technologies Laboratory$/, s: { wall: 'ochre_panel', panel: 1, stone: 0, pal: 0, frame: 'dark', trim: 0, belt: 0, canopyLift: 1.6, canopyOut: 2.4 } });
  // Engineering IV (AC Martin, 2007; Aerospace + Mechanical): long bars of silver corrugated metal with ribbon windows
  // over a gold base storey, under tall steel sun canopies
  LANDMARK_STYLES.push({ re: /^Engineering IV$/, s: { wall: 'metal_silver', panel: 0, stone: 0, pal: 0, frame: 'dark', trim: 0, belt: 0, win: 'ribbon', winSpacing: 3.0,
    brickBase: 1, baseMat: 'ochre_panel', tierWall: 'ochre_panel', tierBlank: 0, canopyLift: 2.4, canopyOut: 2.8 } });
}

export function applyLandmarkStyle(b) {
  if (!b.n || b._lmDone) return;
  b._lmDone = true;
  for (const L of LANDMARK_STYLES) if (L.re.test(b.n)) Object.assign(b.s, L.s);
}
