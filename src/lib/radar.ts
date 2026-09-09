export const RADAR_ZOOM_MAX = 13.4;
export const RADAR_JAPAN_ZOOM = 6.55;
export const RADAR_JAPAN_LNG = 137.6;
export const RADAR_JAPAN_LAT = 36.2;

/** JMA nowcast HEX (mm/h). */
export const RADAR_BANDS = [
  { id: 0, min: 1, max: 10, hex: "#1e6bff", label: "1–10" },
  { id: 1, min: 10, max: 20, hex: "#21c45a", label: "10–20" },
  { id: 2, min: 20, max: 30, hex: "#f0d000", label: "20–30" },
  { id: 3, min: 30, max: 50, hex: "#ff7a00", label: "30–50" },
  { id: 4, min: 50, max: 80, hex: "#e01010", label: "50–80" },
  { id: 5, min: 80, max: 200, hex: "#6b00a8", label: "80+" },
] as const;

export type RadarBandId = (typeof RADAR_BANDS)[number]["id"];

type RadarMeta = { basetime: string; validtime: string };

let meta: RadarMeta | null = null;
let prevMeta: RadarMeta | null = null;
const images = new Map<string, HTMLImageElement | "load" | "fail">();
const tinted = new Map<string, HTMLCanvasElement>();

export function radarMeta() {
  return meta;
}

export async function refreshRadarMeta(force = false) {
  try {
    const data = (await fetch(force ? "/api/radar?fresh=1" : "/api/radar").then((r) => r.json())) as {
      ok?: boolean;
      basetime?: string;
      validtime?: string;
    };
    if (data.ok && data.basetime && data.validtime) {
      if (meta && meta.basetime !== data.basetime) prevMeta = meta;
      meta = { basetime: data.basetime, validtime: data.validtime };
      if (images.size > 1600) {
        images.clear();
        tinted.clear();
      }
    }
  } catch {
    /* keep last */
  }
  return meta;
}

export function startRadarPoll() {
  void refreshRadarMeta();
  const id = window.setInterval(() => void refreshRadarMeta(), 30_000);
  return () => window.clearInterval(id);
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

function tileZoom(mapZoom: number) {
  return Math.max(4, Math.min(10, Math.floor(mapZoom + 0.15)));
}

function hueOf(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

function bandOfPixel(r: number, g: number, b: number, a: number): number {
  if (a < 28) return -1;
  const max = Math.max(r, g, b);
  if (max < 36) return -1;
  const h = hueOf(r, g, b);
  if (h >= 185 && h < 265) return 0;
  if (h >= 85 && h < 165) return 1;
  if (h >= 45 && h < 75) return 2;
  if (h >= 18 && h < 45) return 3;
  if (h < 18 || h >= 345) return 4;
  if (h >= 265 && h < 345) return 5;
  return -1;
}

function tileKey(stamp: RadarMeta, z: number, x: number, y: number) {
  return `${stamp.basetime}|${stamp.validtime}|${z}|${x}|${y}`;
}

function peekTile(stamp: RadarMeta, z: number, x: number, y: number) {
  const hit = images.get(tileKey(stamp, z, x, y));
  return hit instanceof HTMLImageElement ? hit : null;
}

function requestTile(z: number, x: number, y: number, stamp: RadarMeta) {
  const key = tileKey(stamp, z, x, y);
  const hit = images.get(key);
  if (hit instanceof HTMLImageElement) return hit;
  if (hit) return null;
  images.set(key, "load");
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => images.set(key, img);
  img.onerror = () => {
    images.set(key, "fail");
    window.setTimeout(() => {
      if (images.get(key) === "fail") images.delete(key);
    }, 1600);
  };
  img.src = `/api/radar?z=${z}&x=${x}&y=${y}&b=${stamp.basetime}&v=${stamp.validtime}`;
  return null;
}

function readyTile(z: number, x: number, y: number, stamp: RadarMeta) {
  requestTile(z, x, y, stamp);
  const now = peekTile(stamp, z, x, y);
  if (now) return now;
  if (prevMeta) return peekTile(prevMeta, z, x, y);
  return null;
}

function tintTile(img: HTMLImageElement, hidden: number[]) {
  if (!hidden.length) return img;
  const key = `${img.src}|h:${hidden.slice().sort((a, b) => a - b).join(",")}`;
  const cached = tinted.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const g = c.getContext("2d");
  if (!g) return img;
  g.drawImage(img, 0, 0);
  const pix = g.getImageData(0, 0, c.width, c.height);
  const d = pix.data;
  const hide = new Set(hidden);
  for (let i = 0; i < d.length; i += 4) {
    const band = bandOfPixel(d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!);
    if (band < 0 || hide.has(band)) d[i + 3] = 0;
  }
  g.putImageData(pix, 0, 0);
  tinted.set(key, c);
  return c;
}

function paintTile(
  g: CanvasRenderingContext2D,
  z: number,
  x: number,
  y: number,
  img: HTMLImageElement,
  hidden: number[],
  project: (lng: number, lat: number, alt?: number) => [number, number],
  alt: number,
) {
  const src = tintTile(img, hidden);
  const iw = src instanceof HTMLCanvasElement ? src.width : src.naturalWidth || src.width;
  const ih = src instanceof HTMLCanvasElement ? src.height : src.naturalHeight || src.height;
  if (iw < 2 || ih < 2) return;
  const west = tileWest(x, z);
  const east = tileWest(x + 1, z);
  const north = tileNorth(y, z);
  const south = tileNorth(y + 1, z);
  const splits = z <= 5 ? 4 : z <= 7 ? 3 : z <= 9 ? 2 : 1;
  const overlap = 1.4;
  for (let i = 0; i < splits; i++) {
    for (let j = 0; j < splits; j++) {
      const u0 = i / splits;
      const u1 = (i + 1) / splits;
      const v0 = j / splits;
      const v1 = (j + 1) / splits;
      const lng0 = west + (east - west) * u0;
      const lng1 = west + (east - west) * u1;
      const lat0 = north + (south - north) * v0;
      const lat1 = north + (south - north) * v1;
      const [ax, ay] = project(lng0, lat0, alt);
      const [bx, by] = project(lng1, lat0, alt);
      const [cx, cy] = project(lng0, lat1, alt);
      const sx = u0 * iw;
      const sy = v0 * ih;
      const sw = (u1 - u0) * iw;
      const sh = (v1 - v0) * ih;
      if (sw < 0.5 || sh < 0.5) continue;
      g.save();
      g.transform((bx - ax) / sw, (by - ay) / sw, (cx - ax) / sh, (cy - ay) / sh, ax, ay);
      g.drawImage(src, sx, sy, sw, sh, -overlap, -overlap, sw + overlap * 2, sh + overlap * 2);
      g.restore();
    }
  }
}

function paintLevel(
  g: CanvasRenderingContext2D,
  z: number,
  bounds: { west: number; east: number; south: number; north: number },
  stamp: RadarMeta,
  hidden: number[],
  project: (lng: number, lat: number, alt?: number) => [number, number],
  alt: number,
) {
  const pad = 0.04;
  const x0 = lngToTile(bounds.west - pad, z);
  const x1 = lngToTile(bounds.east + pad, z);
  const y0 = latToTile(Math.min(85, bounds.north + pad), z);
  const y1 = latToTile(Math.max(-85, bounds.south - pad), z);
  const maxN = 2 ** z;
  let asked = 0;
  const cap = 220;
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const tx = ((x % maxN) + maxN) % maxN;
      const ready = peekTile(stamp, z, tx, y);
      if (!ready && asked < cap) {
        asked += 1;
        requestTile(z, tx, y, stamp);
      }
      const img = readyTile(z, tx, y, stamp);
      if (!img) continue;
      paintTile(g, z, x, y, img, hidden, project, alt);
    }
  }
}

export function drawRadarLayer(
  g: CanvasRenderingContext2D,
  cam: { zoom: number },
  w: number,
  h: number,
  bounds: { west: number; east: number; south: number; north: number },
  project: (lng: number, lat: number, alt?: number) => [number, number],
  alpha: number,
  enabled: boolean,
  hidden: number[],
  ts: number,
) {
  if (!enabled || alpha < 0.04) return;
  if (cam.zoom > RADAR_ZOOM_MAX + 0.04) return;
  if (!meta) {
    void refreshRadarMeta();
    return;
  }
  const z = tileZoom(cam.zoom);
  const alt = 0.16;
  g.save();
  g.globalAlpha = alpha * (0.74 + 0.02 * Math.sin(ts * 0.00028));
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  if (z > 4) paintLevel(g, z - 1, bounds, meta, hidden, project, alt);
  paintLevel(g, z, bounds, meta, hidden, project, alt);
  g.restore();
}
