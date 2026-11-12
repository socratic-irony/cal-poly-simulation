// Rules that turn raw OSM building tags + footprint shape into a visual style.
// Everything here is an *approximation* tuned against reference photos of the real campus
// (cream stucco + red clay tile "Mission" buildings, concrete/brick mid-century blocks,
// glass-and-metal newer buildings, corrugated-metal agricultural sheds).
import { hash01 } from './osm-lib.mjs';

const AG = /barn|stable|stalls|pens|feedlot|bunker|\bshed\b|hay|dairy|freestall|livestock|poultry|equine|riding|swine|sheep|beef|tractor|lath|hoop|shade house|bug house|pesticide|garcia|herdsman|batting|announcer|methane|reservoir|hangar|hanger|warehouse|storage|shop|jet engine|rose float|transportation|maintenance|facility services|corporation warehouse|technology park|meats|food processing|products technology|winery|gallo/i;
const GLASSHOUSE = /greenhouse|conservatory|hoop house|lath house|shade house/i;

// Buildings with Mission-revival cream stucco walls + red clay tile hip roofs (see Dexter Lawn photos)
const MISSION = /dexter|agricultural sciences|erhart|fisher|orfalea|administration|faculty offices|cotchett|engineering west|architecture and|chase hall|heron|jespersen|student services|health and counseling|smith alumni|university house|natatorium faculty|crandall|old power|printing press|graphic arts|forbes|hall$|hall \(|stenner|university housing|university police|corporation admin|emergency operations|hillcrest|pavilion|spanos|luckman|davidson|cal poly campus market|crop science|english|science north|brown engineering|mathematics and science|bonderson|reinhold|advanced tech|construction innov|materials demonstration|welding|bioresource/i;

// Mid-century / modern concrete + brick blocks
const CONCRETE = /library|baker|frost|pilling|engineering (east|iv|south)|recreation|mott|kinesiology|union|parking|marketplace|vista grande|science$|^science$|frost center|performing arts|cohan|dining/i;
const BRICK = /pilling|brown engineering|engineering south|old power/i;

export function styleFor(b) {
  const { id, name = '', tag, levels, height, area, rectness, nverts } = b;
  const r = hash01(id);
  const s = {
    wall: 'stucco_cream', roof: 'flat', roofMat: 'roof_clay', pitch: 0.5,
    win: 'grid', floorH: 3.9, winSpacing: 3.6, winW: 1.35, winH: 1.7, glass: 0.25,
    h: 0, parapet: 0.5, kind: 'academic', tint: [1, 1, 1],
  };

  let fl = levels || 0;

  // ---------- classify ----------
  if (tag === 'parking' || /parking structure/i.test(name)) {
    s.kind = 'garage'; s.wall = 'concrete_light'; s.win = 'garage'; s.floorH = 3.2; s.roof = 'flat'; s.parapet = 1.0;
    fl = fl || 4;
  } else if (tag === 'greenhouse' || GLASSHOUSE.test(name)) {
    s.kind = 'greenhouse'; s.wall = 'glass'; s.win = 'none'; s.roof = 'gable'; s.roofMat = 'glass'; s.pitch = 0.32; s.h = 3.2;
  } else if (['barn', 'stable', 'riding_hall', 'farm', 'farm_auxiliary', 'cowshed', 'sty', 'silo'].includes(tag) || AG.test(name) ||
             (tag === 'yes' && !name && area > 150 && area < 4000 && b.rural)) {
    s.kind = 'ag';
    s.wall = r < 0.45 ? 'metal_silver' : r < 0.75 ? 'metal_dark' : r < 0.9 ? 'metal_red' : 'metal_silver';
    s.win = 'none'; s.roof = 'gable'; s.roofMat = s.wall === 'metal_red' ? 'metal_red' : 'metal_silver'; s.pitch = 0.22;
    s.h = Math.max(4.5, Math.min(9.5, Math.sqrt(area) * 0.18 + 3.5));
    if (/shop|warehouse|hanger|hangar|storage|facility|tech|winery|gallo|meats|food|products|transportation|maintenance/i.test(name)) {
      s.wall = r < 0.5 ? 'concrete_light' : 'metal_silver'; s.roofMat = 'metal_silver'; s.pitch = 0.1; s.roof = area > 900 ? 'gable' : 'flat'; s.h = Math.max(6, s.h);
      s.win = area > 600 ? 'ribbonHigh' : 'grid';
    }
  } else if (tag === 'house' || tag === 'detached' || tag === 'residential' || tag === 'semidetached_house' || tag === 'terrace') {
    s.kind = 'house'; s.wall = r < 0.4 ? 'stucco_cream' : r < 0.7 ? 'stucco_sand' : r < 0.85 ? 'plaster_white' : 'brick_brown';
    s.roof = 'hip'; s.roofMat = r < 0.5 ? 'roof_grey' : 'roof_clay_dark'; s.pitch = 0.45; s.floorH = 3.0; s.h = levels ? levels * 3.0 : 5.2;
    s.winSpacing = 3.2; s.winW = 1.1; s.winH = 1.3;
  } else if ((tag === 'apartments' || tag === 'dormitory') && /\(17\d[A-Z]\)/.test(name)) {
    s.kind = 'dorm'; s.wall = 'stucco_sand'; s.roof = 'hip'; s.roofMat = 'roof_clay_dark'; s.pitch = 0.36; s.floorH = 3.3; s.winSpacing = 3.3; s.winW = 1.15; s.winH = 1.6; fl = fl || 5;
  } else if (tag === 'apartments' || tag === 'dormitory') {
    s.kind = 'dorm'; s.wall = r < 0.5 ? 'stucco_cream' : r < 0.8 ? 'stucco_sand' : 'plaster_white';
    s.roof = 'hip'; s.roofMat = r < 0.55 ? 'roof_clay' : 'roof_clay_dark'; s.pitch = 0.4; s.floorH = 3.1; s.winSpacing = 3.4; s.winW = 1.2; s.winH = 1.5; fl = fl || 3;
  } else if (tag === 'church') {
    s.kind = 'church'; s.wall = 'stucco_cream'; s.roof = 'gable'; s.roofMat = 'roof_clay'; s.pitch = 0.6; s.h = 8; s.winSpacing = 5; s.winW = 1.0; s.winH = 2.2;
  } else if (['retail', 'commercial', 'supermarket'].includes(tag)) {
    s.kind = 'retail'; s.wall = r < 0.4 ? 'stucco_sand' : r < 0.7 ? 'concrete_smooth' : 'plaster_white'; s.roof = 'flat'; s.h = 5.2; s.win = 'storefront'; s.floorH = 5.2;
  } else if (tag === 'roof') {
    s.kind = 'canopy'; s.wall = 'metal_dark'; s.win = 'none'; s.h = 4.2; s.roof = 'flat'; s.parapet = 0.2;
  } else if (tag === 'shed' || tag === 'garage' || tag === 'garages' || tag === 'hut' || tag === 'service') {
    s.kind = 'shed'; s.wall = r < 0.5 ? 'metal_silver' : 'plaster_white'; s.win = 'none'; s.h = 3.2; s.roof = 'gable'; s.roofMat = 'metal_silver'; s.pitch = 0.18;
  } else {
    // generic academic building ('university', 'yes', 'school', 'office' ...)
    s.kind = 'academic';
    const mission = MISSION.test(name);
    const concrete = CONCRETE.test(name);
    if (concrete && !mission) {
      s.wall = BRICK.test(name) ? (/pilling|kinesiology|brown engineering/i.test(name) ? 'brick_buff' : r < 0.5 ? 'brick_brown' : 'brick_red') : (/library|baker|frost/i.test(name) ? 'concrete_slab' : 'concrete_light');
      s.roof = 'flat'; s.win = /library|baker|frost/i.test(name) ? 'ribbon' : 'grid';
    } else if (mission || (!name && area < 1400 && r < 0.6)) {
      s.wall = r < 0.7 ? 'stucco_cream' : 'stucco_sand'; s.roof = rectness > 0.55 && nverts <= 40 ? 'hip' : 'flat';
      s.roofMat = 'roof_clay'; s.pitch = 0.42;
    } else {
      s.wall = r < 0.45 ? 'stucco_cream' : r < 0.7 ? 'concrete_smooth' : r < 0.85 ? 'brick_brown' : 'stucco_sand';
      s.roof = rectness > 0.7 && area < 1800 && r < 0.5 ? 'hip' : 'flat';
    }
  }

  // ---------- heights ----------
  if (height) s.h = height;
  else if (fl) s.h = fl * s.floorH + (s.roof === 'flat' ? 0.6 : 0);
  else if (!s.h) {
    // unknown: guess from footprint size
    const guess = area > 3000 ? 3 : area > 1000 ? 2.5 : area > 300 ? 2 : 1.4;
    s.h = Math.round(guess * s.floorH * 2) / 2;
  }
  s.floors = Math.max(1, Math.round(s.h / s.floorH));

  // landmark-specific tweaks (heights from OSM levels / photos where available)
  if (/recreation center/i.test(name)) { s.h = 14; s.wall = 'concrete_light'; s.win = 'ribbon'; s.glass = 0.5; s.accent = 'red'; }
  if (/cohan|performing arts/i.test(name)) { s.h = 21; s.wall = 'concrete_smooth'; s.win = 'ribbon'; }
  if (/baker center/i.test(name)) { s.h = 30; s.wall = 'concrete_slab'; s.win = 'ribbon'; s.glass = 0.6; }
  if (/frost center/i.test(name)) { s.h = 17; s.wall = 'concrete_slab'; s.win = 'ribbon'; s.glass = 0.6; }
  if (/dexter building/i.test(name)) { s.h = 12.5; s.wall = 'stucco_cream'; s.roof = 'hip'; s.roofMat = 'roof_clay'; s.pitch = 0.42; }
  if (/mott physical|crandall gym/i.test(name)) { s.h = Math.max(s.h, 11); s.roof = 'flat'; s.wall = 'concrete_light'; s.win = 'none'; }
  if (/engineering iv/i.test(name)) { s.h = 16.5; }
  if (/kennedy|library/i.test(name)) { s.h = 21; s.wall = 'concrete_slab'; s.win = 'ribbon'; s.roof = 'flat'; }

  if (s.roof === 'hip' || s.roof === 'gable') s.parapet = 0;
  // ---- stucco palette index (0 whitewash .. 5 sand-pink); consumed by the facade shader
  const palPick = (arr) => arr[Math.floor(hash01(id + 77) * arr.length) % arr.length];
  if (/^(stucco|plaster)/.test(s.wall)) {
    if (s.kind === 'house') s.pal = palPick([0, 1, 1, 2, 2, 3, 4, 5]);
    else if (s.kind === 'dorm') s.pal = palPick([3, 4, 4, 5, 2]);
    else if (s.kind === 'church') s.pal = 0;
    else if (MISSION.test(name)) s.pal = palPick([0, 1, 2, 2, 3, 3]);
    else s.pal = palPick([1, 2, 3, 4]);
    if (s.wall === 'plaster_white') s.pal = palPick([0, 0, 1]);
    if (s.wall === 'stucco_sand') s.pal = palPick([4, 4, 5, 3]);
  } else s.pal = 0;
  if (/natatorium/i.test(name)) s.pal = 0;
  if (/^Tower \d/.test(name)) s.pal = 7;
  if (/\(17\d[A-Z]\)/.test(name)) s.pal = 6;
  if (/dexter/i.test(name)) s.pal = 2;
  if (/orfalea/i.test(name)) s.pal = 3;
  if (/Corralitos|Huasna|Gypsum|Aliso|Estrella|Buena Vista|Foxen|Inyo|Dover/.test(name)) s.pal = 4;
  // ---- Mission-style buildings get deep eaves
  s.eave = (s.roof === 'hip' || s.roof === 'gable') && /clay/.test(s.roofMat || '') ? (MISSION.test(name) || s.kind === 'dorm' ? 0.95 : 0.7) : 0.4;
  // ---- landmark specifics taken from photos
  if (/Frank E\. Pilling/i.test(name)) { s.wall = 'concrete_light'; s.fins = 1.8; s.win = 'grid'; s.winW = 0.85; s.winH = 2.7; s.winSpacing = 1.8; s.floorH = 4.1; s.roof = 'flat'; s.parapet = 0.9; }
  if (/Kennedy/i.test(name) || /Warren J\. Baker|Frost Center/i.test(name)) { s.win = 'ribbonL'; s.wall = 'concrete_slab'; s.winSpacing = 2.4; s.floorH = 4.2; }
  if (/Recreation Center/i.test(name)) { s.win = 'curtain'; s.accent = 'red'; s.wall = 'concrete_light'; s.floorH = 5.0; s.vaultWall = 'metal_silver'; s.vaultGround = 1; }
  // finished after the 2018 LiDAR flight: the point cloud shows the construction site (or the old building), not this one
  if (/William and Linda Frost Center|Vista Grande Dining|Lohr Family Winery|E&J Gallo|Cal Poly Plant Conservatory|^Summit SLO$/.test(name)) s.noLidar = 1;
  if (/Aero Hang/i.test(name)) { s.wall = 'metal_silver'; s.win = 'garage'; s.vaultWall = 'metal_silver'; s.vaultGround = 1; }
  if (/Mott Physical/i.test(name)) { s.accent = 'green'; s.wall = 'stucco_sand'; s.pal = 4; s.win = 'none'; s.stone = 1; }
  // Crandall Gym + Natatorium: white lime-washed Mission-revival stucco under clay tile with deep rafter-tail eaves (Commons photo)
  // the clock tower between the Business (Orfalea) and Education (Cotchett) buildings, found in the LiDAR (tools/lidar_towers.py)
  if (/Cotchett Education/i.test(name)) s.clock = 1;
  if (/Crandall Gym|Natatorium/i.test(name)) { s.wall = 'plaster_white'; s.pal = 0; s.accent = undefined; s.win = 'grid'; s.winW = 1.2; s.winH = 1.4; s.winSpacing = 4.2; s.eave = 0.9; s.lites = 1; }
  // ---- ground-floor colonnades / stone cladding seen in photos
  if (/Kennedy/i.test(name)) { s.arcade = { d: 4.5, h: 4.6, sp: 7.6, w: 0.75 }; }
  if (/^Orfalea College Of Business Building$/.test(name) && area > 1500) { s.arcade = { d: 3.0, h: 4.0, sp: 3.6, w: 0.7 }; }
  if (/University Union/i.test(name)) { s.arcade = { d: 3.5, h: 4.2, sp: 6.0, w: 0.6 }; }
  if (/Cohan|Performing Arts/.test(name)) { s.stone = 1; s.pal = 1; s.win = 'none'; s.arcade = { d: 3.2, h: 5.0, sp: 6.5, w: 1.1 }; }
  // ---- more buildings matched to Commons photos
  if (/^Brown Engineering$/.test(name)) { s.wall = 'concrete_light'; s.win = 'curtain'; s.floorH = 4.2; s.roof = 'flat'; s.parapet = 0.6; }
  if (/Cotchett Education/.test(name)) { s.wall = 'stucco_sand'; s.pal = 3; s.frame = 'green'; s.lites = 1; s.winW = 1.6; s.winH = 2.0; }
  if (/^Engineering West/.test(name)) { s.wall = 'brick_buff'; s.roof = 'flat'; s.parapet = 0.5; s.win = 'ribbon'; s.lites = 0; }
  if (/^Kinesiology$/.test(name)) { s.wall = 'plaster_white'; s.pal = 0; s.roof = 'flat'; s.parapet = 0.6; s.lites = 0; }
  if (/Warren J\. Baker/.test(name)) { s.wall = 'brick_terracotta'; s.win = 'ribbon'; s.lites = 0; }
  // ---- from the CalPoly photo series (Stilfehler, Commons)
  if (/^Engineering IV$|Bonderson|Advanced Technologies Lab/.test(name)) { s.wall = 'stucco_sand'; s.pal = 3; s.stone = 1; s.win = 'ribbon'; s.roof = 'flat'; s.parapet = 0.4; s.lites = 0; s.canopy = 1; }
  if (/Construction Innovations/.test(name)) { s.wall = 'metal_silver'; s.win = 'ribbon'; s.roof = 'flat'; s.parapet = 0.3; }
  if (/^Graphic Arts$/.test(name)) { s.wall = 'concrete_light'; s.win = 'grid'; s.lites = 0; s.roof = 'flat'; }
  if (/^Engineering East$/.test(name)) { s.wall = 'stucco_sand'; s.pal = 2; s.win = 'ribbon'; s.roof = 'flat'; s.parapet = 0.4; s.lites = 0; }
  if (/University Union/.test(name)) { s.wall = 'concrete_light'; s.win = 'ribbon'; s.brickBase = 1; }
  if (/^Mathematics and Science/.test(name)) { s.wall = 'plaster_white'; s.pal = 0; s.stone = 1; s.win = 'ribbon'; s.roof = 'flat'; s.lites = 0; }
  if (/Cohan|Performing Arts/.test(name)) { s.flatForce = 'roof_metal_blue'; }
  if (/^Architecture and Environmental Design$/.test(name)) { s.wall = 'concrete_light'; s.win = 'ribbon'; s.roof = 'flat'; s.parapet = 0.8; s.lites = 0; s.arcade = { d: 5.0, h: 4.2, sp: 7.0, w: 0.7 }; }
  if (/\(17\d[A-Z]\)/.test(name)) { s.brickBase = 1; }
  // ---- residence halls identified from photos
  if (/^Agricultural Sciences$/.test(name)) { s.wall = 'plaster_white'; s.pal = 0; s.roof = 'gable'; s.roofMat = 'metal_red'; s.pitch = 0.45; s.win = 'ribbon'; }
  if (/^Tower \d/.test(name)) { s.wall = 'stucco_sand'; s.pal = 7; s.win = 'arch'; s.floorH = 3.0; s.winW = 1.3; s.winH = 1.75; s.winSpacing = 3.3; s.roof = 'flat'; s.parapet = 0.6; s.recessX = 0.42; }
  if (/^(Muir|Sequoia|Fremont|Santa Lucia|Tenaya|Trinity) Hall/.test(name)) { s.wall = 'brick_red'; s.roof = 'flat'; s.parapet = 0.22; s.roofMat = 'roof_clay_dark'; s.winW = 1.95; s.winH = 1.15; s.winSpacing = 3.9; s.noLites = 1; }
  if (/\(17\d[A-Z]\)/.test(name)) { s.pal = 6; }
  if (/Cohan|Performing Arts/.test(name)) { s.wall = 'stucco_cream'; s.pal = 2; s.win = 'grid'; s.winSpacing = 7.5; s.winW = 1.1; s.winH = 1.9; }
  // window proportions: older stucco / Mission-style buildings have tall divided-lite windows
  const stuccoW = /^(stucco|plaster)/.test(s.wall);
  if (stuccoW && (s.kind === 'academic' || s.kind === 'church') && s.win === 'grid') { s.winW = 1.7; s.winH = 2.15; s.winSpacing = 3.4; s.lites = 1; }
  if (stuccoW && s.kind === 'dorm' && s.win === 'grid') { s.winW = 1.35; s.winH = 1.65; s.lites = 1; }
  if (/^brick/.test(s.wall) && s.win === 'grid' && !s.noLites) { s.lites = 1; }
  if (s.kind === 'house') { s.lites = hash01(id + 3) < 0.5 ? 1 : 0; }
  // facade detailing flags consumed by the facade shader
  const stuccoLike = /^(stucco|plaster)/.test(s.wall);
  s.trim = stuccoLike && s.kind !== 'ag' && s.kind !== 'shed' ? 1 : 0;
  s.belt = stuccoLike && (s.kind === 'academic' || s.kind === 'dorm' || s.kind === 'church') && s.h > 7 ? 1 : 0;
  s.recess = s.recessX ? s.recessX : s.kind === 'house' ? 0.13 : (s.kind === 'ag' || s.kind === 'shed' || s.kind === 'canopy') ? 0 : stuccoLike ? 0.24 : 0.16;

  // ---------------------------------------------------------------------------------------------
  // High-profile buildings matched against reference photos. These run last so they win over the
  // generic class rules above.
  // Warren J. Baker Center: terracotta rainscreen panels, deep ribbon glazing, glass entry atrium.
  if (/Warren J\. Baker/i.test(name)) {
    s.wall = 'terracotta_panel'; s.pal = 0; s.panel = 1; s.lites = 0;
    s.win = 'ribbon'; s.winSpacing = 3.6; s.floorH = 4.2;
    s.parapet = 0.65; s.coping = 1; s.recess = 0.22;
    s.atrium = { w: 12, d: 4.5, h: 9 };
  }
  // William & Linda Frost Center: light metal/concrete panels, continuous lab glazing, glazed entry.
  if (/William and Linda Frost Center/i.test(name)) {
    s.wall = 'concrete_light'; s.pal = 0; s.panel = 1; s.lites = 0;
    s.win = 'ribbonL'; s.winSpacing = 2.8; s.floorH = 4.3;
    s.parapet = 0.55; s.coping = 1; s.fins = 2.8; s.recess = 0.20;
    s.atrium = { w: 10, d: 4, h: 8.5 };
  }
  // Christopher Cohan Performing Arts Center: beige concrete panels, silver standing-seam roofs with
  // the photographed red fascia, large blank fly-tower tiers and a big glazed entrance lobby.
  if (/Christopher Cohan|Performing Arts Center/i.test(name)) {
    s.wall = 'metal_silver_glass'; s.pal = 0; s.panel = 0; s.stone = 0; s.lites = 0;
    s.win = 'curtain'; s.winSpacing = 3.0; s.winW = 1.6; s.winH = 2.2; s.floorH = 4.8;
    s.parapet = 0.55; s.coping = 0; s.tierBlank = 1; s.tierWall = 'bronze_panel'; s.tierPanel = 1;
    s.flatForce = 'roof_metal_silver';
    s.fascia = 'fascia_red';
    s.arcade = undefined; s.accent = undefined;
    s.atrium = { w: 16, d: 5, h: 12, curved: true };
    s.drum = { r: 6.5, h: 18, off: 0, at: [342, 176] };
    // the signature swept airfoil roof over the glass base (see reference photos)
    s.forceH = 15; s.noTiers = 1;
    s.airfoil = { L: 96, W: 46, rise: 12, sweep: 10, ang: 3 * Math.PI / 4, lift: 0.35, offset: -14 };
  }
  return s;
}
