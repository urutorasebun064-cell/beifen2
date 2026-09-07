type Road = { c: number; w: number; m: number; l: number[] };

export const SHOW_ZOOM = 13.2;
const ROAD_ALT = 0.08;
const RING_M = 520;
const pngs = new Map<string, HTMLImageElement | "load" | "fail">();
const tiles = new Map<string, Road[] | "load" | "fail">();
let epoch = 0;
const waiters = new Set<() => void>();
let lastPull = "";
const queue: Array<[number, number, number]> = [];
let flying = 0;

export function roadsEpoch() {
  return epoch;
}

export function onRoads(fn: () => void) {
  waiters.add(fn);
  return () => waiters.delete(fn);
}

let bumpTimer = 0;
function bump() {
  if (bumpTimer) return;
  bumpTimer = window.setTimeout(() => {
    bumpTimer = 0;
    epoch += 1;
    for (const fn of waiters) fn();
  }, 120);
}

function lngToTile(lng: number, z: number) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTile(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tileWest(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}

function tileNorth(y: number, z: number) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function dataZ(zoom: number) {
  return Math.max(14, Math.min(16, Math.round(zoom - 0.3)));
}

const SRC = [
  (z: number, x: number, y: number) => `https://tile.openstreetmap.jp/styles/osm-bright/${z}/${x}/${y}.png`,
  (z: number, x: number, y: number) => `https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`,
];

function pump() {
  if (flying || !queue.length) return;
  const next = queue.shift();
  if (!next) return;
  flying = 1;
  const [z, x, y] = next;
  const key = `${z}/${x}/${y}`;
  const trySrc = (i: number) => {
    if (i >= SRC.length) {
      pngs.set(key, "fail");
      flying = 0;
      pump();
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      pngs.set(key, img);
      flying = 0;
      bump();
      pump();
    };
    img.onerror = () => trySrc(i + 1);
    img.src = SRC[i]!(z, x, y);
  };
  trySrc(0);
}

function requestPng(z: number, x: number, y: number) {
  const key = `${z}/${x}/${y}`;
  if (pngs.has(key)) return;
  pngs.set(key, "load");
  queue.push([z, x, y]);
  pump();
}

function cover(lng: number, lat: number, z: number, rad: number) {
  const cx = lngToTile(lng, z);
  const cy = latToTile(lat, z);
  for (let y = cy - rad; y <= cy + rad; y++) {
    for (let x = cx - rad; x <= cx + rad; x++) requestPng(z, x, y);
  }
}

export function prefetchRoads(lng: number, lat: number) {
  cover(lng, lat, 15, 1);
}

export function pullRoads(lng: number, lat: number, zoom: number, meters = RING_M) {
  if (zoom < SHOW_ZOOM) return;
  const z = dataZ(zoom);
  const rad = tileSpan(lat, z, meters);
  const id = `${z}/${lngToTile(lng, z)}/${latToTile(lat, z)}|${rad}`;
  if (id === lastPull) return;
  lastPull = id;
  cover(lng, lat, z, rad);
}

function ringPx(
  origin: { lng: number; lat: number },
  project: (lng: number, lat: number, alt?: number) => [number, number],
  meters = RING_M,
) {
  const [cx, cy] = project(origin.lng, origin.lat, 0);
  const dlat = Math.max(80, meters) / 111_000;
  const [ex, ey] = project(origin.lng, origin.lat + dlat, 0);
  const rad = Math.max(28, Math.hypot(ex - cx, ey - cy));
  return { cx, cy, rad };
}

function tileSpan(lat: number, z: number, meters: number) {
  const tileM = (40_075_016.68 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  return Math.max(1, Math.min(3, Math.ceil(Math.max(RING_M, meters) / Math.max(80, tileM))));
}

function drawPng(
  g: CanvasRenderingContext2D,
  cam: { lng: number; lat: number; zoom: number },
  origin: { lng: number; lat: number },
  project: (lng: number, lat: number, alt?: number) => [number, number],
  meters = RING_M,
) {
  const z = dataZ(cam.zoom);
  const tcx = lngToTile(origin.lng, z);
  const tcy = latToTile(origin.lat, z);
  const span = tileSpan(origin.lat, z, meters);
  let m: DOMMatrix | null = null;
  try {
    m = g.getTransform();
  } catch {
    m = null;
  }
  for (let x = tcx - span; x <= tcx + span; x++) {
    for (let y = tcy - span; y <= tcy + span; y++) {
      const img = pngs.get(`${z}/${x}/${y}`);
      if (!img || img === "load" || img === "fail") continue;
      const west = tileWest(x, z);
      const east = tileWest(x + 1, z);
      const north = tileNorth(y, z);
      const south = tileNorth(y + 1, z);
      const nw = project(west, north, ROAD_ALT);
      const ne = project(east, north, ROAD_ALT);
      const sw = project(west, south, ROAD_ALT);
      const se = project(east, south, ROAD_ALT);
      if (![nw, ne, sw, se].every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;
      const iw = img.naturalWidth || 256;
      const ih = img.naturalHeight || 256;
      g.save();
      if (m) {
        const a = (ne[0] - nw[0]) / iw;
        const b = (ne[1] - nw[1]) / iw;
        const c = (sw[0] - nw[0]) / ih;
        const d = (sw[1] - nw[1]) / ih;
        g.setTransform(
          m.a * a + m.c * b,
          m.b * a + m.d * b,
          m.a * c + m.c * d,
          m.b * c + m.d * d,
          m.a * nw[0] + m.c * nw[1] + m.e,
          m.b * nw[0] + m.d * nw[1] + m.f,
        );
        g.drawImage(img, 0, 0);
        g.setTransform(m);
      } else {
        const left = Math.min(nw[0], sw[0], ne[0], se[0]);
        const top = Math.min(nw[1], ne[1], sw[1], se[1]);
        const right = Math.max(nw[0], sw[0], ne[0], se[0]);
        const bot = Math.max(nw[1], ne[1], sw[1], se[1]);
        g.drawImage(img, left, top, Math.max(8, right - left), Math.max(8, bot - top));
      }
      g.restore();
    }
  }
}

export function drawRoads(
  g: CanvasRenderingContext2D,
  cam: { lng: number; lat: number; zoom: number },
  _w: number,
  _h: number,
  project: (lng: number, lat: number, alt?: number) => [number, number],
  user?: { lng: number; lat: number } | null,
  meters = RING_M,
) {
  const origin = user ?? { lng: cam.lng, lat: cam.lat };
  const ring = ringPx(origin, project, meters);
  if (!Number.isFinite(ring.cx) || !Number.isFinite(ring.cy) || ring.rad < 4) return;

  g.save();
  g.beginPath();
  g.arc(ring.cx, ring.cy, ring.rad, 0, Math.PI * 2);
  g.fillStyle = "rgba(126, 163, 108, 0.2)";
  g.fill();
  g.strokeStyle = "rgba(154, 240, 212, 0.9)";
  g.lineWidth = 2.2;
  g.stroke();

  if (cam.zoom >= SHOW_ZOOM) {
    g.beginPath();
    g.arc(ring.cx, ring.cy, Math.max(8, ring.rad - 1), 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "#7ea36c";
    g.fill();
    g.globalCompositeOperation = "multiply";
    g.imageSmoothingEnabled = true;
    drawPng(g, cam, origin, project, meters);
    g.globalCompositeOperation = "source-over";
  }
  g.restore();

  g.save();
  g.beginPath();
  g.arc(ring.cx, ring.cy, ring.rad, 0, Math.PI * 2);
  g.strokeStyle = "rgba(10, 32, 24, 0.5)";
  g.lineWidth = 1.1;
  g.stroke();
  g.restore();
}

function distM(lng: number, lat: number, lng2: number, lat2: number) {
  const dlat = (lat2 - lat) * 111_000;
  const dlng = (lng2 - lng) * 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dlng, dlat);
}

function visitNear(
  lng: number,
  lat: number,
  zoom: number,
  fn: (ax: number, ay: number, bx: number, by: number) => void,
) {
  const z = dataZ(Math.max(zoom, 14));
  const cx = lngToTile(lng, z);
  const cy = latToTile(lat, z);
  for (let x = cx - 1; x <= cx + 1; x++) {
    for (let y = cy - 1; y <= cy + 1; y++) {
      const hit = tiles.get(`${z}/${x}/${y}`);
      if (!hit || hit === "load" || hit === "fail") continue;
      for (const r of hit) {
        const l = r.l;
        for (let i = 0; i + 3 < l.length; i += 2) fn(l[i]!, l[i + 1]!, l[i + 2]!, l[i + 3]!);
      }
    }
  }
}

export function snapToRoad(lng: number, lat: number, zoom: number): { lng: number; lat: number } | null {
  let best = 28;
  let out: { lng: number; lat: number } | null = null;
  visitNear(lng, lat, Math.max(zoom, 16), (ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-12;
    let t = ((lng - ax) * dx + (lat - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const d = distM(lng, lat, px, py);
    if (d < best) {
      best = d;
      out = { lng: px, lat: py };
    }
  });
  return out;
}
