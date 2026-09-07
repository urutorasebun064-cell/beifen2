import { JAPAN_LAND } from "./japan-land";

/** Depth in km, GEBCO-style axes (Japan Trench ~8 km, Izu-Ogasawara ~9.5 km, Nankai ~4.8 km, Japan Sea ~3.5 km). */

const KURIL_TRENCH: [number, number][] = [
  [147.4, 45.8],
  [146.6, 44.4],
  [145.9, 43.2],
  [145.2, 42.2],
];

const JAPAN_TRENCH: [number, number][] = [
  [145.2, 42.2],
  [144.6, 40.8],
  [144.15, 39.5],
  [143.7, 38.2],
  [143.15, 37.0],
  [142.65, 36.05],
  [142.25, 35.25],
  [141.95, 34.7],
];

const IZU_OGASAWARA: [number, number][] = [
  [141.95, 34.7],
  [142.15, 33.4],
  [142.35, 32.0],
  [142.55, 30.4],
  [142.85, 28.6],
  [143.25, 26.8],
  [143.7, 24.6],
];

const NANKAI: [number, number][] = [
  [138.55, 34.65],
  [138.15, 34.15],
  [137.45, 33.7],
  [136.55, 33.35],
  [135.35, 32.95],
  [134.35, 32.55],
  [133.15, 32.15],
  [132.15, 31.55],
  [131.45, 30.85],
];

const RYUKYU_TRENCH: [number, number][] = [
  [131.45, 30.85],
  [130.55, 29.2],
  [129.55, 27.6],
  [128.35, 26.15],
  [126.95, 24.7],
];

const IZU_ARC: [number, number][] = [
  [139.15, 34.9],
  [139.55, 33.6],
  [139.95, 32.0],
  [140.35, 30.2],
  [140.75, 28.2],
  [141.15, 26.0],
];

const WEST_COAST: [number, number][] = [
  [140.35, 45.4],
  [139.65, 43.15],
  [139.45, 41.4],
  [139.55, 40.15],
  [138.35, 37.85],
  [136.85, 36.25],
  [135.75, 35.55],
  [134.55, 35.52],
  [132.15, 34.35],
  [130.35, 33.55],
  [129.55, 32.2],
  [128.15, 28.6],
  [127.05, 26.0],
];

const MOUNTAIN_ROOTS: { lng: number; lat: number; r: number; extra: number }[] = [
  { lng: 137.55, lat: 36.25, r: 95, extra: 0.11 },
  { lng: 138.73, lat: 35.36, r: 42, extra: 0.09 },
  { lng: 140.88, lat: 39.55, r: 85, extra: 0.08 },
  { lng: 142.85, lat: 43.15, r: 75, extra: 0.09 },
  { lng: 131.05, lat: 32.45, r: 70, extra: 0.07 },
  { lng: 133.55, lat: 33.75, r: 55, extra: 0.07 },
  { lng: 140.47, lat: 36.08, r: 40, extra: 0.05 },
];

function distToSegKm(lng: number, lat: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-8;
  const t = Math.max(0, Math.min(1, ((lng - ax) * dx + (lat - ay) * dy) / l2));
  const px = ax + t * dx;
  const py = ay + t * dy;
  const dlat = (lat - py) * 111;
  const dlng = (lng - px) * 111 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dlng, dlat);
}

function distToPolyKm(lng: number, lat: number, pts: [number, number][]) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    best = Math.min(best, distToSegKm(lng, lat, a[0], a[1], b[0], b[1]));
  }
  return best;
}

function ridge(distKm: number, widthKm: number, peakKm: number) {
  const x = distKm / widthKm;
  if (x > 2.4) return 0;
  return peakKm * Math.exp(-x * x);
}

function coastLngAt(lat: number) {
  for (let i = 0; i < WEST_COAST.length - 1; i++) {
    const a = WEST_COAST[i]!;
    const b = WEST_COAST[i + 1]!;
    if ((lat >= b[1] && lat <= a[1]) || (lat >= a[1] && lat <= b[1])) {
      const t = (lat - a[1]) / (b[1] - a[1] || 1);
      return a[0] + t * (b[0] - a[0]);
    }
  }
  return lat > 40 ? 139.8 : 128;
}

function distToLandKm(lng: number, lat: number) {
  let best = Infinity;
  for (const ring of JAPAN_LAND) {
    for (const [x, y] of ring) {
      const dlat = (lat - y) * 111;
      const dlng = (lng - x) * 111 * Math.cos((lat * Math.PI) / 180);
      const d = dlat * dlat + dlng * dlng;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

/** Seafloor depth in kilometres (positive down). */
export function seafloorKm(lng: number, lat: number) {
  const west = lng < coastLngAt(lat) - 0.15;
  let d = west ? (lat > 35.2 ? 3.35 : 1.85) : lat < 31 ? 4.6 : 5.45;
  if (west) {
    const yamato = Math.hypot((lng - 135.4) * 88, (lat - 39.2) * 111);
    if (yamato < 95) d = Math.min(d, 0.45 + (yamato / 95) * 2.4);
    const tsushima = Math.hypot((lng - 131.4) * 90, (lat - 36.4) * 111);
    if (tsushima < 110) d = Math.min(d, 2.1 + (tsushima / 110) * 1.1);
    const okinawa = distToSegKm(lng, lat, 129.2, 31.2, 126.4, 25.4);
    d = Math.max(d, ridge(okinawa, 70, 2.15));
  } else {
    const shikokuBasin = Math.hypot((lng - 136.2) * 96, (lat - 30.8) * 111);
    if (shikokuBasin < 220) d = Math.max(d, 4.4 - (shikokuBasin / 220) * 0.8);
  }

  d = Math.max(d, ridge(distToPolyKm(lng, lat, KURIL_TRENCH), 58, 8.4));
  d = Math.max(d, ridge(distToPolyKm(lng, lat, JAPAN_TRENCH), 62, 8.05));
  d = Math.max(d, ridge(distToPolyKm(lng, lat, IZU_OGASAWARA), 55, 9.4));
  d = Math.max(d, ridge(distToPolyKm(lng, lat, NANKAI), 78, 4.85));
  d = Math.max(d, ridge(distToPolyKm(lng, lat, RYUKYU_TRENCH), 70, 6.5));

  const arc = distToPolyKm(lng, lat, IZU_ARC);
  if (arc < 90) d = Math.min(d, 1.15 + (arc / 90) * 3.2);

  const shelf = distToLandKm(lng, lat);
  if (shelf < 95) {
    const t = shelf / 95;
    d = d * t * t + 0.06 * (1 - t * t);
  }
  return Math.max(0.04, Math.min(9.8, d));
}

/** Map km depth onto the block model: 10 km = floor. */
export function seafloorAlt(lng: number, lat: number) {
  return -Math.min(1, seafloorKm(lng, lat) / 10);
}

/** Island crust underside (exaggerated keel, thicker under Alps / Fuji / Hidaka). */
export function crustAlt(lng: number, lat: number) {
  let alt = -0.12;
  for (const m of MOUNTAIN_ROOTS) {
    const d = Math.hypot((lng - m.lng) * 91, (lat - m.lat) * 111);
    if (d < m.r) alt -= m.extra * (1 - d / m.r) * (1 - d / m.r);
  }
  return Math.max(-0.28, alt);
}

export function oceanFill(km: number) {
  const t = Math.min(1, Math.max(0, (km - 0.08) / 8.6));
  const r = Math.round(58 * (1 - t) + 8 * t);
  const g = Math.round(150 * (1 - t) + 46 * t);
  const b = Math.round(188 * (1 - t) + 92 * t);
  return `rgb(${r},${g},${b})`;
}

export function bedFill(km: number) {
  const t = Math.min(1, Math.max(0, (km - 0.08) / 8.6));
  const r = Math.round(176 * (1 - t) + 42 * t);
  const g = Math.round(138 * (1 - t) + 28 * t);
  const b = Math.round(100 * (1 - t) + 18 * t);
  return `rgba(${r},${g},${b},${0.42 + t * 0.42})`;
}

export function crustFill(lng: number, lat: number) {
  const t = Math.min(1, Math.max(0, (-crustAlt(lng, lat) - 0.12) / 0.16));
  const r = Math.round(138 * (1 - t) + 64 * t);
  const g = Math.round(96 * (1 - t) + 42 * t);
  const b = Math.round(62 * (1 - t) + 28 * t);
  return `rgb(${r},${g},${b})`;
}

export const TRENCH_AXES: { pts: [number, number][]; km: number }[] = [
  { pts: KURIL_TRENCH, km: 8.4 },
  { pts: JAPAN_TRENCH, km: 8.05 },
  { pts: IZU_OGASAWARA, km: 9.4 },
  { pts: NANKAI, km: 4.85 },
  { pts: RYUKYU_TRENCH, km: 6.5 },
];

export const RIDGE_AXES: { pts: [number, number][] }[] = [{ pts: IZU_ARC }];

export type SlabDef = {
  pts: [number, number][];
  trenchKm: number;
  dip: number;
  kind: "pac" | "phs";
};

export const SLAB_DEFS: SlabDef[] = [
  { pts: [...KURIL_TRENCH, ...JAPAN_TRENCH.slice(1)], trenchKm: 8.2, dip: 32, kind: "pac" },
  { pts: IZU_OGASAWARA, trenchKm: 9.4, dip: 42, kind: "pac" },
  { pts: NANKAI, trenchKm: 4.85, dip: 20, kind: "phs" },
  { pts: RYUKYU_TRENCH, trenchKm: 6.5, dip: 40, kind: "phs" },
];

function closestSigned(lng: number, lat: number, pts: [number, number][]) {
  let best = Infinity;
  let landward = 0;
  let px = lng;
  let py = lat;
  let lex = -1;
  let lny = 0;
  const cos = Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i]![0];
    const ay = pts[i]![1];
    const bx = pts[i + 1]![0];
    const by = pts[i + 1]![1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-8;
    const t = Math.max(0, Math.min(1, ((lng - ax) * dx + (lat - ay) * dy) / l2));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    const dlng = (lng - qx) * 111 * cos;
    const dlat = (lat - qy) * 111;
    const d = Math.hypot(dlng, dlat);
    if (d >= best) continue;
    best = d;
    px = qx;
    py = qy;
    const tx = dx * 111 * cos;
    const ty = dy * 111;
    const tl = Math.hypot(tx, ty) || 1;
    landward = (dlng * ty - dlat * tx) / tl;
    lex = ty / tl;
    lny = -tx / tl;
  }
  return { distKm: best, landwardKm: landward, px, py, lex, lny };
}

export function nearestSlab(lng: number, lat: number) {
  let best: (SlabDef & { hit: ReturnType<typeof closestSigned> }) | null = null;
  for (const s of SLAB_DEFS) {
    const hit = closestSigned(lng, lat, s.pts);
    if (!best || hit.distKm < best.hit.distKm) best = { ...s, hit };
  }
  return best;
}

export const BOX_FLOOR = -2.42;
export const DEPTH_MARKS = [50, 100, 200] as const;

export function depthAlt(km: number) {
  return -(0.18 + (Math.max(0, km) / 200) * (Math.abs(BOX_FLOOR) - 0.22));
}

export function plateKm(kind: "pac" | "phs", lng: number, lat: number) {
  let best: { z: number; d: number } | null = null;
  for (const s of SLAB_DEFS) {
    if (s.kind !== kind) continue;
    const hit = closestSigned(lng, lat, s.pts);
    if (hit.distKm > 360 || hit.landwardKm < -16) continue;
    const z = s.trenchKm + Math.max(0, hit.landwardKm) * Math.tan((s.dip * Math.PI) / 180);
    if (z > 205) continue;
    if (!best || hit.distKm < best.d) best = { z, d: hit.distKm };
  }
  return best?.z ?? null;
}

export function slabKm(lng: number, lat: number) {
  const pac = plateKm("pac", lng, lat);
  const phs = plateKm("phs", lng, lat);
  if (pac == null) return phs;
  if (phs == null) return pac;
  return Math.min(pac, phs);
}

export function slabAlt(lng: number, lat: number) {
  const z = slabKm(lng, lat);
  if (z == null) return null;
  return depthAlt(z);
}

export function benioffPoint(lng: number, lat: number, depthKm: number) {
  const target = Math.min(150, Math.max(4, depthKm));
  let best: { err: number; lng: number; lat: number; lex: number; lny: number; tan: number } | null = null;
  for (const s of SLAB_DEFS) {
    const hit = closestSigned(lng, lat, s.pts);
    if (hit.distKm > 460) continue;
    const tan = Math.tan((s.dip * Math.PI) / 180) || 0.7;
    const need = Math.max(0, (target - s.trenchKm) / tan);
    const cos = Math.cos((hit.py * Math.PI) / 180) || 0.8;
    const nlng = hit.px + (hit.lex * need) / (111 * cos);
    const nlat = hit.py + (hit.lny * need) / 111;
    const z = slabKm(nlng, nlat);
    const err = (z == null ? 90 : Math.abs(z - target)) + hit.distKm * 0.012;
    if (!best || err < best.err) best = { err, lng: nlng, lat: nlat, lex: hit.lex, lny: hit.lny, tan };
  }
  if (!best) {
    const z = slabKm(lng, lat);
    return { lng, lat, alt: depthAlt(z ?? target) };
  }
  let x = best.lng;
  let y = best.lat;
  const cos = Math.cos((y * Math.PI) / 180) || 0.8;
  for (let i = 0; i < 10; i++) {
    const z = slabKm(x, y);
    if (z == null) break;
    const diff = z - target;
    if (Math.abs(diff) < 1.2) break;
    const step = diff / (best.tan || 0.7);
    x -= (best.lex * step) / (111 * cos);
    y -= (best.lny * step) / 111;
  }
  const z = slabKm(x, y) ?? target;
  return { lng: x, lat: y, alt: depthAlt(Math.min(150, z)) };
}

export function geoFill(km: number, alpha = 0.92) {
  const x = Math.max(0, Math.min(200, km));
  const stops: [number, number, number, number][] = [
    [0, 198, 172, 132],
    [6, 176, 142, 104],
    [18, 148, 108, 76],
    [35, 112, 74, 52],
    [70, 78, 48, 32],
    [120, 48, 28, 18],
    [200, 20, 11, 8],
  ];
  let a = stops[0]!;
  let b = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i]![0] && x <= stops[i + 1]![0]) {
      a = stops[i]!;
      b = stops[i + 1]!;
      break;
    }
  }
  const span = b[0] - a[0] || 1;
  const t = Math.max(0, Math.min(1, (x - a[0]) / span));
  const r = Math.round(a[1] + (b[1] - a[1]) * t);
  const g = Math.round(a[2] + (b[2] - a[2]) * t);
  const bl = Math.round(a[3] + (b[3] - a[3]) * t);
  const fade = x > 140 ? Math.max(0.1, 1 - (x - 140) / 80) : 1;
  return `rgba(${r},${g},${bl},${alpha * fade})`;
}

export function crustKm(lng: number, lat: number) {
  let km = 32;
  for (const m of MOUNTAIN_ROOTS) {
    const d = Math.hypot((lng - m.lng) * 91, (lat - m.lat) * 111);
    if (d < m.r) km += 8 * (1 - d / m.r) * (1 - d / m.r);
  }
  return km;
}

export function slabFill(km: number, kind: "pac" | "phs" = "pac") {
  const t = Math.min(1, Math.max(0, (km - 8) / 180));
  const fade = km > 130 ? Math.max(0.08, 1 - (km - 130) / 90) : 1;
  const warm = kind === "phs" ? 1 : 0;
  const r = Math.round((168 + warm * 18) * (1 - t) + (38 + warm * 8) * t);
  const g = Math.round((128 - warm * 8) * (1 - t) + 26 * t);
  const b = Math.round((92 - warm * 10) * (1 - t) + 16 * t);
  return `rgba(${r},${g},${b},${(0.58 + t * 0.32) * fade})`;
}

export function densifyAxis(pts: [number, number][], n = 22) {
  const out: [number, number][] = [];
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const km = Math.hypot((b[0] - a[0]) * 91, (b[1] - a[1]) * 111);
    seg.push(seg[i - 1]! + km);
  }
  const total = seg[seg.length - 1] || 1;
  for (let k = 0; k <= n; k++) {
    const want = (k / n) * total;
    let i = 1;
    while (i < seg.length && seg[i]! < want) i += 1;
    const a = pts[i - 1]!;
    const b = pts[Math.min(i, pts.length - 1)]!;
    const t = (want - seg[i - 1]!) / Math.max(1e-6, seg[Math.min(i, seg.length - 1)]! - seg[i - 1]!);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

export function slabSample(def: SlabDef, along: [number, number], step: number, steps: number) {
  const hit = closestSigned(along[0], along[1], def.pts);
  const tan = Math.tan((def.dip * Math.PI) / 180);
  const dist = (step / Math.max(1, steps)) * (200 / tan);
  const cos = Math.cos((hit.py * Math.PI) / 180) || 0.8;
  const lng = hit.px + (hit.lex * dist) / (111 * cos);
  const lat = hit.py + (hit.lny * dist) / 111;
  const km = def.trenchKm + dist * tan;
  return { lng, lat, km, alt: depthAlt(km) };
}

export function insideLand(lng: number, lat: number) {
  let n = 0;
  for (const ring of JAPAN_LAND) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      const yi = a[1];
      const yj = b[1];
      if ((yi > lat) !== (yj > lat) && lng < ((b[0] - a[0]) * (lat - yi)) / (yj - yi || 1e-9) + a[0]) n += 1;
    }
  }
  return n % 2 === 1;
}

const PEAKS: { lng: number; lat: number; m: number; r: number }[] = [
  { lng: 138.727, lat: 35.361, m: 3776, r: 22 },
  { lng: 138.239, lat: 35.674, m: 3193, r: 28 },
  { lng: 137.648, lat: 36.289, m: 3190, r: 32 },
  { lng: 137.648, lat: 36.342, m: 3180, r: 18 },
  { lng: 138.185, lat: 35.574, m: 3052, r: 20 },
  { lng: 137.617, lat: 36.576, m: 3015, r: 24 },
  { lng: 137.48, lat: 35.893, m: 3067, r: 20 },
  { lng: 137.553, lat: 36.107, m: 3026, r: 16 },
  { lng: 137.758, lat: 36.759, m: 2932, r: 18 },
  { lng: 136.771, lat: 36.155, m: 2702, r: 22 },
  { lng: 138.523, lat: 36.407, m: 2568, r: 14 },
  { lng: 139.376, lat: 36.798, m: 2578, r: 14 },
  { lng: 139.5, lat: 36.768, m: 2486, r: 14 },
  { lng: 139.139, lat: 35.474, m: 1673, r: 14 },
  { lng: 139.963, lat: 37.125, m: 1917, r: 16 },
  { lng: 140.072, lat: 37.601, m: 1816, r: 14 },
  { lng: 140.44, lat: 38.141, m: 1841, r: 18 },
  { lng: 140.881, lat: 39.853, m: 2038, r: 18 },
  { lng: 140.881, lat: 40.656, m: 1584, r: 18 },
  { lng: 139.997, lat: 39.099, m: 2236, r: 16 },
  { lng: 133.546, lat: 35.371, m: 1729, r: 16 },
  { lng: 133.185, lat: 33.768, m: 1982, r: 14 },
  { lng: 131.106, lat: 32.884, m: 1592, r: 20 },
  { lng: 131.24, lat: 33.086, m: 1791, r: 16 },
  { lng: 130.861, lat: 31.934, m: 1700, r: 14 },
  { lng: 130.657, lat: 31.585, m: 1117, r: 8 },
  { lng: 142.854, lat: 43.664, m: 2291, r: 24 },
  { lng: 142.686, lat: 43.418, m: 2077, r: 16 },
  { lng: 144.719, lat: 43.766, m: 1547, r: 14 },
  { lng: 145.122, lat: 44.076, m: 1661, r: 12 },
  { lng: 141.241, lat: 45.179, m: 1721, r: 9 },
  { lng: 140.812, lat: 42.826, m: 1898, r: 11 },
  { lng: 142.9, lat: 42.95, m: 2052, r: 28 },
];

const SPINES: { pts: [number, number][]; width: number; m: number }[] = [
  {
    pts: [
      [130.95, 34.35],
      [132.4, 34.7],
      [133.5, 35.15],
      [135.1, 35.25],
      [136.6, 35.7],
      [137.55, 36.25],
      [138.5, 36.15],
      [139.15, 36.75],
      [140.35, 37.55],
      [140.75, 38.7],
      [140.9, 39.7],
      [140.95, 40.65],
    ],
    width: 48,
    m: 980,
  },
  {
    pts: [
      [142.7, 42.55],
      [143.05, 42.95],
      [143.15, 43.45],
    ],
    width: 28,
    m: 1100,
  },
  {
    pts: [
      [130.55, 31.4],
      [130.85, 32.2],
      [131.15, 33.05],
    ],
    width: 32,
    m: 720,
  },
];

/** Surface height in model alt. Fuji 3776 m ≈ 0.21, not exaggerated vs trench scale. */
export function landMeters(lng: number, lat: number) {
  let m = 40;
  for (const p of PEAKS) {
    const d = Math.hypot((lng - p.lng) * 91, (lat - p.lat) * 111);
    if (d < p.r * 2.2) {
      const x = d / p.r;
      m = Math.max(m, p.m * Math.exp(-x * x));
    }
  }
  for (const s of SPINES) {
    m = Math.max(m, ridge(distToPolyKm(lng, lat, s.pts), s.width, s.m / 1000) * 1000);
  }
  return m;
}

export function landAlt(lng: number, lat: number) {
  if (!insideLand(lng, lat)) return 0;
  return Math.min(0.22, landMeters(lng, lat) / 18000);
}

export function landFill(meters: number) {
  const t = Math.min(1, Math.max(0, (meters - 80) / 3200));
  const r = Math.round(107 * (1 - t) + 142 * t);
  const g = Math.round(154 * (1 - t) + 128 * t);
  const b = Math.round(104 * (1 - t) + 92 * t);
  return `rgb(${r},${g},${b})`;
}
