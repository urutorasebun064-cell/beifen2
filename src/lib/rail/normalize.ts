import { CITIES, STATION_ALIASES, toJa, toZh } from "@/lib/i18n";
import { hanFold } from "@/lib/han";
import { hubNameFor, HUBS } from "@/data/hubs";
import { foldKey, stationSearchKeys } from "./romanize";
import type { LineJson, LineRuntime, RailKind, StationHit } from "./types";

const KINDS: RailKind[] = ["shinkansen", "jr", "subway", "private"];

export type CompactRails = {
  prefs: string[];
  lines: Array<{
    i: string;
    n: string;
    c: string;
    k: 0 | 1 | 2 | 3;
    h: number;
    s: number;
    o: 0 | 1;
    p: [number, number][];
    t: [string, number, number, number][];
  }>;
};

export function unpackRails(data: CompactRails): LineJson[] {
  return data.lines.map((l) => ({
    id: l.i,
    name: l.n,
    color: l.c,
    kind: KINDS[l.k] ?? "private",
    headway: l.h,
    speed: l.s,
    loop: l.o === 1,
    path: l.p,
    stops: l.t.map(([n, lng, lat, pi]) => ({
      n,
      lng,
      lat,
      pf: data.prefs[pi] ?? "",
      pv: null,
      nx: null,
    })),
  }));
}

export function prepareLine(raw: LineJson): LineRuntime {
  const path = raw.path;
  const cum: number[] = [0];
  let total = 0;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const drawPath: [number, number][] = [];
  const step = raw.kind === "subway" ? 0.12 : raw.kind === "shinkansen" ? 0.45 : 0.22;
  let acc = 0;
  if (path.length) drawPath.push(path[0]!);
  for (let i = 0; i < path.length; i++) {
    const [lng, lat] = path[i]!;
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
    if (i > 0) {
      const dx = (lng - path[i - 1]![0]) * 91;
      const dy = (lat - path[i - 1]![1]) * 111;
      const seg = Math.hypot(dx, dy);
      total += seg;
      cum.push(total);
      acc += seg;
      if (acc >= step || i === path.length - 1) {
        drawPath.push(path[i]!);
        acc = 0;
      }
    }
  }
  const stopKm: number[] = [];
  let cursor = 0;
  for (const stop of raw.stops) {
    if (path.length < 2) {
      stopKm.push(0);
      continue;
    }
    let bestD = Infinity;
    let bestI = cursor;
    let bestT = 0;
    const start = Math.max(0, cursor - 6);
    for (let i = start; i < path.length - 1; i++) {
      const ax = path[i]![0];
      const ay = path[i]![1];
      const bx = path[i + 1]![0];
      const by = path[i + 1]![1];
      const vx = bx - ax;
      const vy = by - ay;
      const len2 = vx * vx + vy * vy || 1e-12;
      const t = Math.max(0, Math.min(1, ((stop.lng - ax) * vx + (stop.lat - ay) * vy) / len2));
      const px = ax + vx * t;
      const py = ay + vy * t;
      const d = (px - stop.lng) ** 2 + (py - stop.lat) ** 2;
      if (d < bestD) {
        bestD = d;
        bestI = i;
        bestT = t;
      }
    }
    const a = path[bestI]!;
    const b = path[bestI + 1] ?? a;
    stop.lng = a[0] + (b[0] - a[0]) * bestT;
    stop.lat = a[1] + (b[1] - a[1]) * bestT;
    const seg = (cum[bestI + 1] ?? cum[bestI] ?? 0) - (cum[bestI] ?? 0);
    stopKm.push((cum[bestI] ?? 0) + bestT * seg);
    cursor = bestI;
  }
  return {
    ...raw,
    kind: raw.kind as RailKind,
    cum,
    stopKm,
    totalKm: total,
    minLng,
    minLat,
    maxLng,
    maxLat,
    drawPath,
  };
}

export function buildStationIndex(lines: LineRuntime[]): Map<string, StationHit> {
  const index = new Map<string, StationHit>();
  for (const line of lines) {
    for (const stop of line.stops) {
      const key = `${stop.n}|${stop.pf}`;
      const existing = index.get(key);
      if (existing) {
        if (!existing.lines.includes(line)) existing.lines.push(line);
      } else {
        index.set(key, {
          name: stop.n,
          lng: stop.lng,
          lat: stop.lat,
          prefecture: stop.pf,
          lines: [line],
          keys: stationSearchKeys(stop.n),
        });
      }
    }
  }
  return index;
}

export function searchStations(
  index: Map<string, StationHit>,
  query: string,
  limit = 16,
  near: { lng: number; lat: number } | null = null,
): StationHit[] {
  const raw = query.trim().normalize("NFKC");
  if (!raw) return [];
  const qFold = foldKey(raw);
  const qJa = foldKey(toJa(raw));
  const qZh = foldKey(toZh(raw));
  const qHan = hanFold(raw);
  const fullNeedles = new Set<string>([qFold, qJa, qZh, qHan].filter((s) => s.length > 0));
  const needles = new Set<string>(fullNeedles);
  const alias =
    STATION_ALIASES[raw] ??
    STATION_ALIASES[qFold] ??
    STATION_ALIASES[toZh(raw)] ??
    STATION_ALIASES[toJa(raw)] ??
    hubNameFor(raw) ??
    hubNameFor(toJa(raw));
  if (alias) needles.add(foldKey(alias));
  for (const city of CITIES) {
    if (foldKey(city.ja) === qFold || foldKey(city.zh) === qFold || foldKey(city.en) === qFold) {
      needles.add(foldKey(city.ja));
      needles.add(foldKey(city.zh));
      needles.add(foldKey(city.en));
    }
  }
  for (const hub of HUBS) {
    if (foldKey(hub.name) === qFold || hub.aliases.some((a) => foldKey(a) === qFold)) {
      needles.add(foldKey(hub.name));
      hub.aliases.forEach((a) => needles.add(foldKey(a)));
    }
  }
  for (const n of [...needles]) {
    for (const part of n.split(/[線线・･／/]/u)) {
      if (part.length >= 2) needles.add(part);
    }
  }
  const latin = /^[a-z0-9]+$/.test(qFold);
  const ranked: { hit: StationHit; score: number; dist: number }[] = [];
  for (const hit of index.values()) {
    const keys = hit.keys?.length ? hit.keys : stationSearchKeys(hit.name);
    let nameScore = 0;
    for (const n of needles) {
      if (n.length < 1) continue;
      for (const k of keys) {
        if (!k) continue;
        if (k === n) nameScore = Math.max(nameScore, fullNeedles.has(n) ? 120 : 70);
        else if (n.endsWith(k) && k.length >= 2) nameScore = Math.max(nameScore, (fullNeedles.has(n) ? 95 : 75) + Math.min(k.length, 8));
        else if (n.includes(k) && k.length >= 2) nameScore = Math.max(nameScore, 50 + Math.min(k.length, 8));
        else if (k.startsWith(n) && n.length >= 2) nameScore = Math.max(nameScore, 35);
        else if (n.length >= (latin ? 3 : 2) && k.includes(n)) nameScore = Math.max(nameScore, 18);
      }
    }
    if (nameScore <= 0) continue;
    let lineScore = 0;
    for (const line of hit.lines) {
      const lks = [foldKey(line.name), foldKey(toZh(line.name)), foldKey(toJa(line.name)), hanFold(line.name)];
      for (const lk of lks) {
        if (lk.length < 2) continue;
        for (const n of needles) {
          if (n.length < 2) continue;
          if (n === qFold || n === qJa || n === qZh || n === qHan) {
            if (n.includes(lk) || lk.includes(n)) lineScore = Math.max(lineScore, 25);
          } else if (lk.includes(n)) {
            lineScore = Math.max(lineScore, 45);
          }
        }
      }
    }
    let dist = 0;
    if (near) {
      const dy = hit.lat - near.lat;
      const dx = (hit.lng - near.lng) * 0.82;
      dist = dy * dy + dx * dx;
    }
    ranked.push({ hit, score: nameScore + lineScore, dist });
  }
  ranked.sort((a, b) => b.score - a.score || a.dist - b.dist);
  const exactName = new Set(
    [...fullNeedles].map((s) => s.replace(/駅$/u, "")).filter((s) => s.length >= 1),
  );
  const isExact = (hit: StationHit) => exactName.has(foldKey(hit.name.replace(/駅$/u, "")));
  const seen = new Set<string>();
  const out: StationHit[] = [];
  const push = (hit: StationHit) => {
    const k = `${hit.name}|${hit.lng.toFixed(3)}|${hit.lat.toFixed(3)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(hit);
  };
  for (const { hit } of ranked) {
    if (isExact(hit)) push(hit);
  }
  for (const { hit } of ranked) {
    if (out.length >= Math.max(limit, 12)) break;
    push(hit);
  }
  return out;
}

export function nearbyStations(
  index: Map<string, StationHit>,
  lng: number,
  lat: number,
  limit = 8,
): StationHit[] {
  const ranked: { hit: StationHit; d: number }[] = [];
  for (const hit of index.values()) {
    const dy = hit.lat - lat;
    const dx = (hit.lng - lng) * 0.82;
    const d = dy * dy + dx * dx;
    if (d < 0.012) ranked.push({ hit, d });
  }
  ranked.sort((a, b) => a.d - b.d);
  const unique = new Map<string, StationHit>();
  for (const { hit } of ranked) {
    if (!unique.has(hit.name)) unique.set(hit.name, hit);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}

export function searchLines(lines: LineRuntime[], query: string, limit = 8): LineRuntime[] {
  const q = foldKey(query);
  if (!q) return [];
  return lines
    .filter((l) => {
      const keys = [foldKey(l.name), foldKey(toZh(l.name)), ...stationSearchKeys(l.name)];
      return keys.some((k) => k.includes(q) || q.includes(k));
    })
    .slice(0, limit);
}
