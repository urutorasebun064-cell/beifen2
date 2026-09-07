export type MarineKind = "humpback" | "sperm" | "whaleShark" | "sardine" | "tuna" | "ray" | "bottom";

export type MarineZone = {
  id: string;
  west: number;
  east: number;
  south: number;
  north: number;
};

export const MARINE_ZONES: Record<string, MarineZone> = {
  okinawa: { id: "okinawa", west: 124.05, east: 128.15, south: 24.22, north: 27.18 },
  yaeyama: { id: "yaeyama", west: 123.72, east: 124.55, south: 24.02, north: 24.72 },
  ogasawara: { id: "ogasawara", west: 141.78, east: 142.92, south: 26.45, north: 27.82 },
  okinawaWest: { id: "okinawaWest", west: 126.42, east: 127.55, south: 26.04, north: 26.9 },
  bosoPacific: { id: "bosoPacific", west: 140.18, east: 141.88, south: 34.48, north: 35.92 },
  kashima: { id: "kashima", west: 140.72, east: 142.15, south: 35.72, north: 36.95 },
  sanriku: { id: "sanriku", west: 142.15, east: 144.05, south: 37.15, north: 40.15 },
  izuKuroshio: { id: "izuKuroshio", west: 138.55, east: 140.12, south: 33.42, north: 34.98 },
  sagami: { id: "sagami", west: 139.02, east: 139.78, south: 34.82, north: 35.34 },
  uraga: { id: "uraga", west: 139.62, east: 139.95, south: 35.0, north: 35.42 },
  suruga: { id: "suruga", west: 138.22, east: 138.82, south: 34.58, north: 35.12 },
  japanSea: { id: "japanSea", west: 137.85, east: 139.55, south: 37.35, north: 40.15 },
  hokkaidoEast: { id: "hokkaidoEast", west: 144.05, east: 146.15, south: 42.15, north: 43.85 },
};

export type MarineActor = {
  id: string;
  kind: MarineKind;
  zone: MarineZone;
  phase: number;
  period: number;
  depth: number;
  depthAmp: number;
  rx: number;
  ry: number;
  freq: number;
  seed: number;
  floor: boolean;
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function spawn(
  kind: MarineKind,
  zone: MarineZone,
  n: number,
  period: number,
  depth: number,
  depthAmp: number,
  rx: number,
  ry: number,
  floor = false,
) {
  const out: MarineActor[] = [];
  for (let i = 0; i < n; i++) {
    const seed = hash(`${kind}:${zone.id}:${i}`);
    out.push({
      id: `${kind}-${zone.id}-${i}`,
      kind,
      zone,
      phase: seed,
      period: period * (0.88 + seed * 0.24),
      depth,
      depthAmp,
      rx: rx * (0.72 + seed * 0.46),
      ry: ry * (0.68 + (1 - seed) * 0.48),
      freq: 0.72 + seed * 0.48,
      seed,
      floor,
    });
  }
  return out;
}

export const MARINE_ACTORS: MarineActor[] = [
  ...spawn("humpback", MARINE_ZONES.okinawa, 3, 220, -0.07, 0.055, 0.3, 0.24),
  ...spawn("humpback", MARINE_ZONES.ogasawara, 2, 240, -0.08, 0.05, 0.36, 0.3),
  ...spawn("humpback", MARINE_ZONES.hokkaidoEast, 2, 260, -0.09, 0.045, 0.28, 0.22),
  ...spawn("sperm", MARINE_ZONES.ogasawara, 2, 280, -0.48, 0.3, 0.32, 0.26),
  ...spawn("sperm", MARINE_ZONES.sanriku, 3, 300, -0.55, 0.34, 0.24, 0.18),
];

export type MarinePose = {
  lng: number;
  lat: number;
  alt: number;
  bearing: number;
  beat: number;
  roll: number;
  pitch: number;
  surface: boolean;
};

function clamp01(v: number) {
  return Math.max(0.08, Math.min(0.92, v));
}

export function marinePose(actor: MarineActor, tSec: number): MarinePose {
  const z = actor.zone;
  const w = z.east - z.west;
  const hgt = z.north - z.south;
  const t = tSec / actor.period + actor.phase;
  const u = t * Math.PI * 2;
  const homeX = 0.5 + 0.14 * Math.sin(actor.seed * 7.1);
  const homeY = 0.5 + 0.12 * Math.cos(actor.seed * 5.3);
  const nx = clamp01(
    homeX + actor.rx * Math.sin(u) + actor.rx * 0.38 * Math.sin(u * 0.31 + 1.4) + actor.rx * 0.14 * Math.sin(u * 1.55 + actor.seed),
  );
  const ny = clamp01(
    homeY +
      actor.ry * Math.sin(u * actor.freq + 0.7) +
      actor.ry * 0.34 * Math.cos(u * 0.44 + 0.4) +
      actor.ry * 0.11 * Math.cos(u * 1.7),
  );
  const lng = z.west + w * nx;
  const lat = z.south + hgt * ny;
  const dNx =
    actor.rx * Math.cos(u) + actor.rx * 0.38 * 0.31 * Math.cos(u * 0.31 + 1.4) + actor.rx * 0.14 * 1.55 * Math.cos(u * 1.55 + actor.seed);
  const dNy =
    actor.ry * actor.freq * Math.cos(u * actor.freq + 0.7) -
    actor.ry * 0.34 * 0.44 * Math.sin(u * 0.44 + 0.4) -
    actor.ry * 0.11 * 1.7 * Math.sin(u * 1.7);
  const bearing = ((Math.atan2(dNx * w, dNy * hgt) * 180) / Math.PI + 360) % 360;
  const turn = dNx * Math.cos(u) - dNy * Math.sin(u);
  let alt = actor.depth + actor.depthAmp * Math.sin(u * 1.05 + actor.seed * 3);
  let pitch = 0;
  if (actor.kind === "sperm") {
    const dive = 0.5 + 0.5 * Math.sin(u * 0.42 + actor.seed);
    alt = actor.depth * (0.18 + 0.82 * dive);
    pitch = Math.cos(u * 0.42 + actor.seed) * 0.45;
  } else if (actor.kind === "humpback") {
    const lift = Math.max(0, Math.sin(u * 0.72 + actor.seed * 4));
    alt = actor.depth + actor.depthAmp * 0.35 - lift * 0.055;
    pitch = -Math.cos(u * 0.72 + actor.seed * 4) * 0.22;
  } else if (actor.floor) {
    alt = actor.depth + actor.depthAmp * Math.sin(u * 0.8);
    pitch = 0;
  }
  const beatHz =
    actor.kind === "sardine" ? 6.4 : actor.kind === "tuna" ? 4.6 : actor.kind === "whaleShark" ? 1.7 : actor.kind === "ray" ? 2.8 : actor.kind === "bottom" ? 3.1 : 1.55;
  const beat = Math.sin(tSec * beatHz + actor.seed * 9);
  return {
    lng,
    lat,
    alt,
    bearing,
    beat,
    roll: Math.max(-0.45, Math.min(0.45, turn * 1.8)),
    pitch,
    surface: !actor.floor && alt > -0.05,
  };
}

export function zoneHits(
  zone: MarineZone,
  bounds: { west: number; east: number; south: number; north: number },
) {
  return !(zone.east < bounds.west || zone.west > bounds.east || zone.north < bounds.south || zone.south > bounds.north);
}

export function marineLod(zoom: number, tilt: number) {
  if (zoom < 6.7 || tilt < 0.26) return 0;
  const z = Math.min(1, (zoom - 6.7) / 1.5);
  const t = Math.min(1, (tilt - 0.26) / 0.5);
  return z * t;
}
