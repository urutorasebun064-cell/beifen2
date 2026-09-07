import { AIRPORT_BY_ID, AIRPORTS, FLIGHT_ROUTES } from "@/data/flights";
import { operationOf } from "@/data/jr-ops";
import { inBounds, pointAlong, tokyoParts } from "./geo";
import type { LineRuntime, MapBounds, Train } from "./types";

export const FIRST_MIN = 4 * 60 + 40;
const LAST_MIN = 24 * 60 + 50;

export function isNightService(minutes: number): boolean {
  return minutes >= 70 && minutes < FIRST_MIN;
}

/** Minutes until a clock time. Past evening trains stay past; late-night maps onto next morning. */
export function minutesUntilDepart(hhmm: string, nowMin: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const dep = (h ?? 0) * 60 + (m ?? 0);
  let d = dep - nowMin;
  if (d > 12 * 60) d -= 1440;
  if (d < 0 && nowMin >= 21 * 60 && dep < FIRST_MIN + 150) d += 1440;
  if (d < 0 && nowMin < FIRST_MIN && dep >= FIRST_MIN && dep < 12 * 60) d += 1440;
  return d;
}

export function firstServiceDate(now = new Date()): Date {
  const { minutes } = tokyoParts(now);
  if (!isNightService(minutes)) return now;
  return new Date(now.getTime() + (FIRST_MIN - minutes) * 60_000);
}

function rushFactor(minutes: number, weekday: string): number {
  const h = minutes / 60;
  const weekend = weekday === "Sat" || weekday === "Sun";
  let r = 1;
  if ((h >= 7 && h <= 9.4) || (h >= 17 && h <= 19.5)) r = 0.72;
  else if ((h >= 9.4 && h <= 16) || (h >= 19.5 && h <= 22)) r = 1;
  else r = 1.2;
  if (weekend) r *= 1.28;
  return r;
}

function destName(line: LineRuntime, dir: 0 | 1): string {
  if (line.loop) return line.name.replace(/線$/, "") + "内回り";
  const stops = line.stops;
  if (!stops.length) return line.name;
  return dir === 0 ? stops[stops.length - 1]!.n : stops[0]!.n;
}

function stopAt(line: LineRuntime, t: number, dir: 0 | 1): { next: string; prev: string; index: number } {
  const n = line.stops.length;
  if (n === 0) return { next: line.name, prev: line.name, index: 0 };
  const km = t * line.totalKm;
  const kms = line.stopKm ?? line.cum ?? [];
  if (dir === 1 && !line.loop) {
    let nextI = 0;
    for (let i = n - 1; i >= 0; i--) {
      if ((kms[i] ?? 0) <= km + 1e-6) {
        nextI = i;
        break;
      }
    }
    const prevI = Math.min(n - 1, nextI + 1);
    return {
      next: line.stops[nextI]!.n,
      prev: line.stops[prevI]!.n,
      index: nextI,
    };
  }
  let nextI = line.loop ? 0 : n - 1;
  for (let i = 0; i < n; i++) {
    if ((kms[i] ?? 0) >= km - 1e-6) {
      nextI = i;
      break;
    }
  }
  const prevI = line.loop ? (nextI - 1 + n) % n : Math.max(0, nextI - 1);
  return {
    next: line.stops[nextI]!.n,
    prev: line.stops[prevI]!.n,
    index: nextI,
  };
}

export function lineVisible(line: LineRuntime, bounds: MapBounds, zoom: number): boolean {
  if (line.kind === "bus") return false;
  if (line.maxLng < bounds.west || line.minLng > bounds.east || line.maxLat < bounds.south || line.minLat > bounds.north) {
    return false;
  }
  if (line.kind === "shinkansen") return zoom >= 5.55;
  if (zoom < 7.4) return false;
  if (line.kind === "subway") return zoom >= 9.6;
  return true;
}

export function lineSlots(line: LineRuntime, minutes: number, weekday = "Mon"): {
  headway: number;
  oneWayMin: number;
  count: number;
  offset: number;
  first: number;
  last: number;
} {
  const op = operationOf(line);
  const rush = rushFactor(minutes, weekday);
  let hw = op.headway;
  if (rush <= 0.8) hw = op.minHw;
  else if (rush >= 1.15) hw = op.headway * 1.5;
  const headway = Math.max(2, Math.round(hw));
  const oneWayMin = (line.totalKm / Math.max(25, op.speed)) * 60;
  const count = Math.max(1, Math.min(48, Math.round(oneWayMin / headway)));
  const offset = ((Math.round(op.offset) % headway) + headway) % headway;
  return { headway, oneWayMin, count, offset, first: op.first, last: op.last };
}

function serviceNow(minutes: number, last: number) {
  return last > 1440 && minutes < 210 ? minutes + 1440 : minutes;
}

function tripDepart(line: LineRuntime, minutes: number, dir: 0 | 1, i: number, weekday = "Mon") {
  const { headway, oneWayMin, offset, first, last } = lineSlots(line, minutes, weekday);
  const dirOff = dir === 1 && !line.loop ? Math.floor(headway / 2) : 0;
  return { dep: first + offset + dirOff + i * headway, headway, oneWayMin, first, last };
}

export function isTripRunning(line: LineRuntime, minutes: number, dir: 0 | 1, i: number, weekday = "Mon") {
  const { dep, oneWayMin, first, last } = tripDepart(line, minutes, dir, i, weekday);
  if (dep > last + 0.01) return false;
  const now = serviceNow(minutes, last);
  if (line.loop) return now >= first - 1 && now <= last + 2;
  const e = now - dep;
  return e >= -0.2 && e <= oneWayMin + 0.45;
}

export function trainProgress(line: LineRuntime, minutes: number, dir: 0 | 1, i: number, weekday = "Mon"): number {
  const { dep, oneWayMin, last } = tripDepart(line, minutes, dir, i, weekday);
  const now = serviceNow(minutes, last);
  const e = now - dep;
  if (line.loop) {
    const u = e / Math.max(1e-3, oneWayMin);
    return ((u % 1) + 1) % 1;
  }
  const u = Math.max(0, Math.min(1, e / Math.max(1e-3, oneWayMin)));
  return dir === 1 ? 1 - u : u;
}

export function stopFrac(line: LineRuntime, idx: number): number {
  if (line.totalKm <= 0) return 0;
  const km = line.stopKm?.[idx] ?? line.cum?.[idx] ?? 0;
  return Math.max(0, Math.min(1, km / line.totalKm));
}

export function minutesUntilStation(line: LineRuntime, minutes: number, dir: 0 | 1, i: number, stopIdx: number, weekday = "Mon"): number {
  const { oneWayMin } = lineSlots(line, minutes, weekday);
  const { t } = trainPose(line, minutes, dir, i, weekday);
  const frac = stopFrac(line, stopIdx);
  if (line.loop) {
    const span = (frac - t + 1) % 1;
    if (span < 0.0008) return 0;
    return span * oneWayMin;
  }
  if (dir === 0) {
    const dt = (frac - t) * oneWayMin;
    if (dt >= 0) return dt;
    if (dt >= -0.28) return 0;
    return (1 - t + frac) * oneWayMin;
  }
  const dt = (t - frac) * oneWayMin;
  if (dt >= 0) return dt;
  if (dt >= -0.28) return 0;
  return (t + 1 - frac) * oneWayMin;
}

function trainPose(line: LineRuntime, minutes: number, dir: 0 | 1, i: number, weekday = "Mon"): { t: number; dwellIdx: number } {
  const { oneWayMin } = lineSlots(line, minutes, weekday);
  const t0 = trainProgress(line, minutes, dir, i, weekday);
  const dwellFrac = 0.32 / Math.max(1, oneWayMin);
  let dwellIdx = -1;
  for (let s = 0; s < line.stops.length; s++) {
    const f = stopFrac(line, s);
    const arrived = dir === 1 && !line.loop ? t0 <= f && t0 >= f - dwellFrac : t0 >= f && t0 <= f + dwellFrac;
    if (arrived) {
      return { t: f, dwellIdx: s };
    }
  }
  return { t: t0, dwellIdx };
}

export function makeTrain(line: LineRuntime, minutes: number, hour: number, dir: 0 | 1, i: number, weekday = "Mon"): Train {
  const { t, dwellIdx } = trainPose(line, minutes, dir, i, weekday);
  void hour;
  const { coord, bearing } = pointAlong(line.path, line.cum, line.totalKm, t);
  const id = `${line.id}:${dir}:${i}`;
  const stops = dwellIdx >= 0
    ? {
        next:
          line.stops[dir === 1 && !line.loop ? Math.max(0, dwellIdx - 1) : Math.min(line.stops.length - 1, dwellIdx + 1)]?.n ??
          line.stops[dwellIdx]!.n,
        prev: line.stops[dwellIdx]!.n,
        index: dwellIdx,
      }
    : stopAt(line, t, dir);
  return {
    id,
    lineId: line.id,
    lineName: line.name,
    color: line.color,
    kind: line.kind,
    lng: coord[0],
    lat: coord[1],
    bearing: dir === 1 && !line.loop ? (bearing + 180) % 360 : bearing,
    dir,
    dest: destName(line, dir),
    nextStop: stops.next,
    prevStop: stops.prev,
    delayMin: 0,
    progress: t,
    stopIndex: stops.index,
    etaMin: Math.max(0, minutesUntilStation(line, minutes, dir, i, stops.index, weekday)),
  };
}

function idHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function makeTrainAtT(line: LineRuntime, minutes: number, dir: 0 | 1, t: number, i: number, weekday = "Mon"): Train {
  const u = Math.max(0, Math.min(1, t));
  const { coord, bearing } = pointAlong(line.path, line.cum, line.totalKm, u);
  const stops = stopAt(line, u, dir);
  const { oneWayMin } = lineSlots(line, minutes, weekday);
  const frac = stopFrac(line, stops.index);
  const eta = dir === 1 && !line.loop ? Math.max(0, (u - frac) * oneWayMin) : Math.max(0, (frac - u) * oneWayMin);
  return {
    id: `${line.id}:${dir}:${i}`,
    lineId: line.id,
    lineName: line.name,
    color: line.color,
    kind: line.kind,
    lng: coord[0],
    lat: coord[1],
    bearing: dir === 1 && !line.loop ? (bearing + 180) % 360 : bearing,
    dir,
    dest: destName(line, dir),
    nextStop: stops.next,
    prevStop: stops.prev,
    delayMin: 0,
    progress: u,
    stopIndex: stops.index,
    etaMin: eta,
  };
}

function trainsOnVisibleSpan(
  line: LineRuntime,
  minutes: number,
  weekday: string,
  bounds: MapBounds,
  pad: number,
  zoom: number,
  already: Train[],
): Train[] {
  if (line.path.length < 2 || line.totalKm < 0.05) return [];
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < line.path.length; i++) {
    const p = line.path[i]!;
    if (inBounds(p[0], p[1], bounds, pad)) {
      if (lo < 0) lo = i;
      hi = i;
    }
  }
  if (lo < 0) {
    const cx = (bounds.west + bounds.east) / 2;
    const cy = (bounds.south + bounds.north) / 2;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < line.path.length; i++) {
      const p = line.path[i]!;
      const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    lo = hi = best;
  }
  const kmLo = line.cum[lo] ?? 0;
  const kmHi = line.cum[hi] ?? kmLo;
  const visKm = Math.max(0.6, Math.abs(kmHi - kmLo));
  const tLo = kmLo / line.totalKm;
  const tHi = kmHi / line.totalKm;
  const span = Math.max(0.003, Math.abs(tHi - tLo));
  const a = Math.min(tLo, tHi);
  const { headway, oneWayMin, first, last } = lineSlots(line, minutes, weekday);
  const now = last > 1440 && minutes < 210 ? minutes + 1440 : minutes;
  if (now < first - 1 || now > last + oneWayMin) return [];
  const spacingKm = Math.max(0.8, (line.totalKm * Math.max(2, headway)) / Math.max(4, oneWayMin));
  const nEach = Math.max(2, Math.min(28, Math.round(visKm / spacingKm) || 2));
  const dirs: Array<0 | 1> = line.loop ? [0] : [0, 1];
  const out: Train[] = [];
  for (const dir of dirs) {
    const existing = already.filter((t) => t.lineId === line.id && t.dir === dir);
    for (let k = 0; k < nEach; k++) {
      const phase = (minutes / Math.max(4, oneWayMin) + k / nEach + (dir ? 0.5 : 0) + (idHash(line.id) % 11) / 40) % 1;
      const t = a + phase * span;
      const pose = pointAlong(line.path, line.cum, line.totalKm, t);
      const near = existing.some(
        (e) => Math.hypot((e.lng - pose.coord[0]) * 91, (e.lat - pose.coord[1]) * 111) < spacingKm * 0.4,
      );
      if (near) continue;
      out.push(makeTrainAtT(line, minutes, dir, t, 8000 + dir * 40 + k, weekday));
    }
  }
  return out;
}

export function trainOnDuty(line: LineRuntime, minutes: number, hour: number, dir: 0 | 1, i: number, weekday = "Mon"): Train | null {
  if (!isTripRunning(line, minutes, dir, i, weekday)) return null;
  return makeTrain(line, minutes, hour, dir, i, weekday);
}

export function parseTrainId(id: string): { lineId: string; dir: 0 | 1; i: number } | null {
  const cut = id.lastIndexOf(":");
  if (cut < 0) return null;
  const cut2 = id.lastIndexOf(":", cut - 1);
  if (cut2 < 0) return null;
  const lineId = id.slice(0, cut2);
  const dir = Number(id.slice(cut2 + 1, cut)) as 0 | 1;
  const i = Number(id.slice(cut + 1));
  if (dir !== 0 && dir !== 1) return null;
  if (!Number.isFinite(i)) return null;
  return { lineId, dir, i };
}

function lerpLng(a: number, b: number, t: number) {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  let lng = a + d * t;
  if (lng > 180) lng -= 360;
  if (lng < -180) lng += 360;
  return lng;
}

function airPos(a: { lng: number; lat: number }, b: { lng: number; lat: number }, t: number): { lng: number; lat: number; bearing: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const lng = lerpLng(a.lng, b.lng, clamped);
  const lat = a.lat + (b.lat - a.lat) * clamped;
  const nxt = Math.min(1, clamped + 0.01);
  const nlng = lerpLng(a.lng, b.lng, nxt);
  const nlat = a.lat + (b.lat - a.lat) * nxt;
  let dx = nlng - lng;
  if (dx > 180) dx -= 360;
  if (dx < -180) dx += 360;
  const dy = nlat - lat;
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return { lng, lat, bearing };
}

function flightSlots(route: (typeof FLIGHT_ROUTES)[number], minutes: number) {
  const night = isNightService(minutes);
  const every = night ? route.every * 2.2 : route.every;
  const count = Math.max(1, Math.min(10, Math.round(route.minutes / every)));
  return { every, count, cycle: route.minutes };
}

function makeFlight(route: (typeof FLIGHT_ROUTES)[number], minutes: number, dir: 0 | 1, i: number): Train | null {
  const from = AIRPORT_BY_ID.get(dir === 0 ? route.from : route.to);
  const to = AIRPORT_BY_ID.get(dir === 0 ? route.to : route.from);
  if (!from || !to) return null;
  const { count, cycle } = flightSlots(route, minutes);
  const phase = (minutes / cycle + i / Math.max(1, count)) % 1;
  const { lng, lat, bearing } = airPos(from, to, phase);
  const id = `fly:${route.id}:${dir}:${i}`;
  return {
    id,
    lineId: route.id,
    lineName: `${from.n}–${to.n}`,
    color: route.color,
    kind: "flight",
    lng,
    lat,
    bearing,
    dir,
    dest: to.n,
    nextStop: to.n,
    prevStop: from.n,
    delayMin: 0,
    progress: phase,
    stopIndex: 0,
    etaMin: Math.max(0, (1 - phase) * cycle),
  };
}

export function flightById(id: string, now: Date): Train | null {
  const parsed = parseTrainId(id);
  if (!parsed || !parsed.lineId.startsWith("fly:")) return null;
  const routeId = parsed.lineId.slice(4);
  const route = FLIGHT_ROUTES.find((r) => r.id === routeId);
  if (!route) return null;
  const { minutes } = tokyoParts(now);
  const { count } = flightSlots(route, minutes);
  return makeFlight(route, minutes, parsed.dir, Math.max(0, Math.min(count - 1, parsed.i)));
}

export function simulateFlights(now: Date, bounds: MapBounds, cap = 280): Train[] {
  if (!bounds) return [];
  const { minutes } = tokyoParts(now);
  const pad = Math.max(1.2, (bounds.east - bounds.west) * 0.25);
  const near: Train[] = [];
  const far: Train[] = [];
  for (const route of FLIGHT_ROUTES) {
    const { count } = flightSlots(route, minutes);
    for (const dir of [0, 1] as const) {
      for (let i = 0; i < count; i++) {
        const t = makeFlight(route, minutes, dir, i);
        if (!t) continue;
        if (inBounds(t.lng, t.lat, bounds, pad)) near.push(t);
        else far.push(t);
        if (near.length >= cap) return near;
      }
    }
  }
  for (const t of far) {
    if (near.length >= cap) break;
    near.push(t);
  }
  return near;
}

export function trainById(lines: LineRuntime[], now: Date, id: string): Train | null {
  if (id.startsWith("fly:")) return flightById(id, now);
  if (id.startsWith("live:")) return null;
  const parsed = parseTrainId(id);
  if (!parsed) return null;
  const line = lines.find((l) => l.id === parsed.lineId);
  if (!line || line.totalKm < 0.15) return null;
  const { minutes, hour, weekday } = tokyoParts(now);
  if (!isTripRunning(line, minutes, parsed.dir, parsed.i, weekday)) return null;
  return makeTrain(line, minutes, hour, parsed.dir, Math.max(0, parsed.i), weekday);
}

export function nearestTrainOnLine(
  line: LineRuntime,
  now: Date,
  lng: number,
  lat: number,
  toward?: string,
): Train | null {
  const { minutes, hour, weekday } = tokyoParts(now);
  if (line.totalKm < 0.15) return null;
  const dirs: Array<0 | 1> = line.loop ? [0] : [0, 1];
  let best: Train | null = null;
  let bestD = Infinity;
  for (const dir of dirs) {
    const { headway, oneWayMin, offset, first, last } = lineSlots(line, minutes, weekday);
    const dirOff = dir === 1 && !line.loop ? Math.floor(headway / 2) : 0;
    const now = last > 1440 && minutes < 210 ? minutes + 1440 : minutes;
    const i0 = Math.max(0, Math.floor((now - oneWayMin - 1 - first - offset - dirOff) / headway));
    const i1 = Math.min(220, Math.floor((now + 1 - first - offset - dirOff) / headway) + (line.loop ? Math.round(oneWayMin / headway) : 1));
    for (let i = i0; i <= i1; i++) {
      const t = makeTrain(line, minutes, hour, dir, i, weekday);
      const d = (t.lng - lng) ** 2 + (t.lat - lat) ** 2;
      if (!isTripRunning(line, minutes, dir, i, weekday)) continue;
      const bonus = toward && (t.dest === toward || t.nextStop === toward) ? 0 : 0.02;
      if (d + bonus < bestD) {
        bestD = d + bonus;
        best = t;
      }
    }
  }
  return best;
}

export function matchTrainForStop(
  line: LineRuntime,
  now: Date,
  lng: number,
  lat: number,
  toward?: string,
): Train | null {
  const hit = nearestTrainOnLine(line, now, lng, lat, toward);
  if (hit) return hit;
  const { minutes, hour, weekday } = tokyoParts(now);
  if (line.totalKm < 0.15) return null;
  const { headway, oneWayMin, offset, first, last } = lineSlots(line, minutes, weekday);
  const nowMin = last > 1440 && minutes < 210 ? minutes + 1440 : minutes;
  const dirs: Array<0 | 1> = line.loop ? [0] : [0, 1];
  let best: Train | null = null;
  let bestScore = Infinity;
  for (const dir of dirs) {
    const dest = destName(line, dir);
    const dirOff = dir === 1 && !line.loop ? Math.floor(headway / 2) : 0;
    const i0 = Math.max(0, Math.floor((nowMin - oneWayMin - 40 - first - offset - dirOff) / headway));
    const i1 = Math.min(220, Math.floor((nowMin + 40 - first - offset - dirOff) / headway) + 2);
    for (let i = i0; i <= i1; i++) {
      const t = makeTrain(line, minutes, hour, dir, i, weekday);
      const km = Math.hypot((t.lng - lng) * 91, (t.lat - lat) * 111);
      const towardHit = toward && (dest === toward || t.dest === toward || t.nextStop === toward);
      const score = km + (toward && !towardHit ? 8 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
  }
  return best;
}

export function trainForSchedule(
  line: LineRuntime,
  now: Date,
  fromLng: number,
  fromLat: number,
  toward?: string,
  departHhmm?: string,
  toName?: string,
): Train | null {
  if (line.totalKm < 0.15) return null;
  const { minutes, hour, weekday } = tokyoParts(now);
  const { headway, oneWayMin, offset, first, last } = lineSlots(line, minutes, weekday);
  let idx = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.stops.length; i++) {
    const s = line.stops[i]!;
    const d = (s.lng - fromLng) ** 2 + (s.lat - fromLat) ** 2;
    if (d < bestD) {
      bestD = d;
      idx = i;
    }
  }
  let dir: 0 | 1 = 0;
  if (toName) {
    const toI = line.stops.findIndex((s) => s.n === toName);
    if (toI >= 0) dir = toI >= idx || line.loop ? 0 : 1;
    if (line.loop && toI >= 0) {
      const n = line.stops.length;
      const fwd = (toI - idx + n) % n;
      const back = (idx - toI + n) % n;
      dir = fwd <= back ? 0 : 1;
    }
  } else if (toward) {
    if (destName(line, 1) === toward || toward.includes(destName(line, 1)) || destName(line, 1).includes(toward)) dir = 1;
  }
  const frac = stopFrac(line, idx);
  const travel = Math.round(line.loop ? frac * oneWayMin : dir === 0 ? frac * oneWayMin : (1 - frac) * oneWayMin);
  const dirOff = dir === 1 && !line.loop ? Math.floor(headway / 2) : 0;
  let depMin = minutes;
  if (departHhmm) {
    const [h, m] = departHhmm.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) depMin = h * 60 + m;
  }
  let i = Math.round((depMin - travel - first - offset - dirOff) / headway);
  if (i < 0) i = 0;
  const maxI = Math.max(0, Math.floor((last - first - offset - dirOff) / headway));
  if (i > maxI) i = maxI;
  const train = makeTrain(line, minutes, hour, dir, i, weekday);
  if (isTripRunning(line, minutes, dir, i, weekday)) return train;
  const pose = pointAlong(line.path, line.cum, line.totalKm, stopFrac(line, idx));
  return {
    ...train,
    lng: pose.coord[0],
    lat: pose.coord[1],
    bearing: pose.bearing,
    progress: stopFrac(line, idx),
    stopIndex: idx,
    nextStop: line.stops[Math.min(line.stops.length - 1, idx + (dir === 1 ? -1 : 1))]?.n ?? train.nextStop,
    prevStop: line.stops[idx]?.n ?? train.prevStop,
  };
}

export function nearestTrainAt(lines: LineRuntime[], now: Date, lng: number, lat: number): Train | null {
  const pad = 0.06;
  let best: Train | null = null;
  let bestD = Infinity;
  for (const line of lines) {
    if (lng < line.minLng - pad || lng > line.maxLng + pad || lat < line.minLat - pad || lat > line.maxLat + pad) continue;
    const t = nearestTrainOnLine(line, now, lng, lat);
    if (!t) continue;
    const d = ((t.lng - lng) * 91) ** 2 + ((t.lat - lat) * 111) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return bestD < 8 * 8 ? best : null;
}

export function simulateTrains(
  lines: LineRuntime[],
  now: Date,
  bounds: MapBounds,
  zoom: number,
  cap = 960,
  followId?: string | null,
  priorityIds?: Set<string>,
  sparse = false,
): Train[] {
  const { minutes, hour, weekday } = tokyoParts(now);
  const trains: Train[] = [];
  if (isNightService(minutes)) {
    trains.push(...simulateFlights(now, bounds, 280));
    if (followId && !trains.some((t) => t.id === followId)) {
      const extra = trainById(lines, now, followId);
      if (extra) trains.push(extra);
    }
    return trains;
  }
  const pad = Math.max(0.02, (bounds.east - bounds.west) * 0.05);
  const visible = lines.filter((l) => (l.kind === "shinkansen" || zoom >= 8.2 || l.totalKm >= 0.4) && (l.totalKm >= 0.15 || l.stops.length >= 2) && lineVisible(l, bounds, zoom));
  visible.sort((a, b) => {
    const pa = priorityIds?.has(a.id) ? 0 : 1;
    const pb = priorityIds?.has(b.id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const rank = (k: string) => (k === "shinkansen" ? 0 : k === "jr" ? 1 : k === "subway" ? 2 : k === "bus" ? 4 : 3);
    return rank(a.kind) - rank(b.kind);
  });

  const dens = sparse ? 1 / 3 : 1;
  const maxOn = (line: LineRuntime) => {
    if (line.kind === "bus" || zoom < 5.5) return 0;
    const { count } = lineSlots(line, minutes, weekday);
    const full = count * (line.loop ? 1 : 2);
    if (line.kind === "shinkansen") return Math.max(2, full);
    if (zoom >= 10) return Math.max(0, Math.round(full * dens));
    const n = zoom >= 8.4 ? Math.max(5, Math.round(full * 0.45)) : Math.max(2, Math.round(full * 0.22));
    if (priorityIds?.has(line.id) && zoom >= 10) return Math.max(n, Math.min(full, 24));
    return Math.max(0, Math.round(n * dens));
  };

  const seen = new Set<string>();
  const addLine = (line: LineRuntime, limit: number, ignoreCap = false) => {
    const { headway, oneWayMin, offset, first, last } = lineSlots(line, minutes, weekday);
    const dirs: Array<0 | 1> = line.loop ? [0] : [0, 1];
    let n = 0;
    for (const id of seen) {
      if (id.startsWith(`${line.id}:`)) n += 1;
    }
    const now = last > 1440 && minutes < 210 ? minutes + 1440 : minutes;
    if (now < first - 1 || now > last + oneWayMin) return;
    for (const dir of dirs) {
      const dirOff = dir === 1 && !line.loop ? Math.floor(headway / 2) : 0;
      const i0 = Math.max(0, Math.floor((now - oneWayMin - 1 - first - offset - dirOff) / headway));
      const i1 = Math.min(
        220,
        Math.floor((now + 1 - first - offset - dirOff) / headway) + (line.loop ? Math.round(oneWayMin / headway) : 1),
      );
      for (let i = i0; i <= i1; i++) {
        if (n >= limit || (!ignoreCap && trains.length >= cap)) return;
        if (!isTripRunning(line, minutes, dir, i, weekday)) continue;
        const t = makeTrain(line, minutes, hour, dir, i, weekday);
        if (seen.has(t.id)) continue;
        if (!inBounds(t.lng, t.lat, bounds, pad)) continue;
        seen.add(t.id);
        trains.push(t);
        n += 1;
      }
    }
  };

  const seed = zoom >= 15.6 ? 999 : zoom >= 13.8 ? 64 : zoom >= 11 ? 16 : zoom >= 8.5 ? 8 : 4;
  const floorOf = (line: LineRuntime) => {
    const m = maxOn(line);
    if (m <= 0) return 0;
    if (line.kind === "shinkansen") return Math.min(m, Math.max(2, seed));
    if (zoom >= 10) return m;
    if (zoom >= 8.4) return Math.min(m, 2);
    return Math.min(m, 1);
  };
  for (const line of visible) addLine(line, floorOf(line), true);
  if (trains.length < cap) {
    for (const line of visible) {
      addLine(line, maxOn(line));
      if (trains.length >= cap) break;
    }
  }
  if (zoom >= 10) {
    for (const line of visible) {
      if (trains.length >= cap) break;
      for (const t of trainsOnVisibleSpan(line, minutes, weekday, bounds, pad, zoom, trains)) {
        if (trains.length >= cap) break;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        trains.push(t);
      }
    }
  }

  trains.push(...simulateFlights(now, bounds, 280));

  if (followId && !trains.some((t) => t.id === followId)) {
    const extra = trainById(lines, now, followId);
    if (extra) trains.push(extra);
  }
  return trains;
}

export { LAST_MIN, AIRPORTS };
