import { haversine, toHhmm, tokyoParts } from "./geo";
import { attachTrack } from "./graph";
import { departuresAt } from "./schedule";
import type { Journey, LineRuntime, RailKind, RouteLeg, RouteStop, StationHit } from "./types";

const TRANSFER_MIN = 5;
const WALK_KMH = 4.6;
const WALK_RADIUS_KM = 0.42;

type Edge = {
  to: string;
  minutes: number;
  kind: "ride" | "walk";
  railKind?: RailKind;
  lineId?: string;
  lineName?: string;
  color?: string;
  toward?: string;
  fromStop: RouteStop;
  toStop: RouteStop;
};

type Graph = {
  edges: Map<string, Edge[]>;
};

type HeapItem = { c: number; state: string };

class MinHeap {
  a: HeapItem[] = [];
  push(item: HeapItem) {
    this.a.push(item);
    this.up(this.a.length - 1);
  }
  pop(): HeapItem | undefined {
    const a = this.a;
    if (!a.length) return;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      this.down(0);
    }
    return top;
  }
  private up(i: number) {
    const a = this.a;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.c <= a[i]!.c) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  private down(i: number) {
    const a = this.a;
    for (;;) {
      let m = i;
      const l = i * 2 + 1;
      const r = l + 1;
      if (l < a.length && a[l]!.c < a[m]!.c) m = l;
      if (r < a.length && a[r]!.c < a[m]!.c) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i]!, a[m]!];
      i = m;
    }
  }
}

let cached: { lines: LineRuntime[]; graph: Graph } | null = null;

export function stationKey(s: { name?: string; n?: string; prefecture?: string; pf?: string }): string {
  const n = s.name ?? s.n ?? "";
  const pf = s.prefecture ?? s.pf ?? "";
  return `${n}|${pf}`;
}

function asStop(s: { n?: string; name?: string; lng: number; lat: number; pf?: string; prefecture?: string }): RouteStop {
  return {
    name: s.name ?? s.n ?? "",
    lng: s.lng,
    lat: s.lat,
    prefecture: s.prefecture ?? s.pf ?? "",
  };
}

function towardOf(line: LineRuntime, fromIndex: number, toIndex: number): string {
  if (line.loop) {
    const n = line.stops.length;
    const dir = ((toIndex - fromIndex + n) % n) <= n / 2 ? 1 : -1;
    const dest = line.stops[(toIndex + dir * 4 + n * 4) % n];
    return dest?.n ?? line.name;
  }
  return toIndex > fromIndex
    ? (line.stops[line.stops.length - 1]?.n ?? line.name)
    : (line.stops[0]?.n ?? line.name);
}

function rideMinutes(line: LineRuntime, a: number, b: number): number {
  const km = haversine([line.stops[a]!.lng, line.stops[a]!.lat], [line.stops[b]!.lng, line.stops[b]!.lat]);
  return Math.max(0.8, (km / Math.max(18, line.speed)) * 60);
}

export function buildGraph(lines: LineRuntime[]): Graph {
  if (cached?.lines === lines) return cached.graph;
  const edges = new Map<string, Edge[]>();
  const add = (from: string, e: Edge) => {
    const list = edges.get(from);
    if (list) list.push(e);
    else edges.set(from, [e]);
  };

  const stations = new Map<string, RouteStop>();
  for (const line of lines) {
    const stops = line.stops;
    if (stops.length < 2) continue;
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]!;
      const key = `${s.n}|${s.pf}`;
      if (!stations.has(key)) stations.set(key, asStop(s));
    }
    const link = (i: number, j: number) => {
      const a = stops[i]!;
      const b = stops[j]!;
      const from = `${a.n}|${a.pf}`;
      const to = `${b.n}|${b.pf}`;
      if (from === to) return;
      add(from, {
        to,
        minutes: rideMinutes(line, i, j),
        kind: "ride",
        railKind: line.kind,
        lineId: line.id,
        lineName: line.name,
        color: line.color,
        toward: towardOf(line, i, j),
        fromStop: asStop(a),
        toStop: asStop(b),
      });
    };
    for (let i = 0; i < stops.length - 1; i++) {
      link(i, i + 1);
      link(i + 1, i);
    }
    if (line.loop && stops.length > 2) {
      link(stops.length - 1, 0);
      link(0, stops.length - 1);
    }
  }

  const list = [...stations.values()];
  const cell = 0.005;
  const buckets = new Map<string, RouteStop[]>();
  const bkey = (lng: number, lat: number) => `${Math.floor(lng / cell)}|${Math.floor(lat / cell)}`;
  for (const s of list) {
    const k = bkey(s.lng, s.lat);
    const arr = buckets.get(k);
    if (arr) arr.push(s);
    else buckets.set(k, [s]);
  }
  const seenWalk = new Set<string>();
  for (const s of list) {
    const gx = Math.floor(s.lng / cell);
    const gy = Math.floor(s.lat / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nearby = buckets.get(`${gx + dx}|${gy + dy}`);
        if (!nearby) continue;
        for (const t of nearby) {
          if (t.name === s.name && t.prefecture === s.prefecture) continue;
          const pair = stationKey(s) < stationKey(t) ? `${stationKey(s)}~${stationKey(t)}` : `${stationKey(t)}~${stationKey(s)}`;
          if (seenWalk.has(pair)) continue;
          const km = haversine([s.lng, s.lat], [t.lng, t.lat]);
          if (km <= 0 || km > WALK_RADIUS_KM) continue;
          seenWalk.add(pair);
          const minutes = Math.max(3, (km / WALK_KMH) * 60 + 2);
          add(stationKey(s), {
            to: stationKey(t),
            minutes,
            kind: "walk",
            fromStop: s,
            toStop: t,
          });
          add(stationKey(t), {
            to: stationKey(s),
            minutes,
            kind: "walk",
            fromStop: t,
            toStop: s,
          });
        }
      }
    }
  }

  const graph = { edges };
  cached = { lines, graph };
  return graph;
}

function parseMin(hhmm?: string) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function dateAt(now: Date, minutes: number) {
  const cur = tokyoParts(now).minutes;
  let d = minutes - cur;
  while (d < -720) d += 1440;
  while (d > 720) d -= 1440;
  return new Date(now.getTime() + d * 60_000);
}

function pickDep(hit: StationHit | undefined, at: Date, lineId?: string, lineName?: string) {
  if (!hit) return null;
  const deps = departuresAt(hit, at, 12);
  return (
    deps.find((d) => lineId && d.lineId === lineId && d.minutesUntil >= 0) ??
    deps.find((d) => lineName && (d.lineName.includes(lineName) || lineName.includes(d.lineName)) && d.minutesUntil >= 0) ??
    deps.find((d) => d.minutesUntil >= 0) ??
    null
  );
}

export function ensureConnections(journey: Journey, index: Map<string, StationHit>, now = new Date()): Journey {
  const legs = journey.legs.map((l) => ({ ...l, stops: l.stops.slice() }));
  const nowMin = tokyoParts(now).minutes;
  let t = parseMin(legs[0]?.departHhmm) ?? nowMin;
  let prevRide = false;
  for (const leg of legs) {
    if (leg.kind === "walk") {
      if (parseMin(leg.departHhmm) == null) leg.departHhmm = toHhmm(t);
      t = parseMin(leg.departHhmm) ?? t;
      t += Math.max(1, Math.round(leg.minutes) || 1);
      leg.arriveHhmm = toHhmm(t);
      prevRide = false;
      continue;
    }
    const pad = prevRide ? TRANSFER_MIN : 0;
    const earliest = t + pad;
    let dep = parseMin(leg.departHhmm);
    if (dep != null && dep < earliest - 12 * 60) dep += 24 * 60;
    if (dep == null || dep < earliest) {
      const hit = index.get(stationKey(leg.from)) ?? [...index.values()].find((s) => s.name === leg.from.name);
      const match = pickDep(hit, dateAt(now, earliest), leg.lineId, leg.lineName);
      if (match) {
        dep = tokyoParts(dateAt(now, earliest)).minutes + match.minutesUntil;
        if (!leg.toward) leg.toward = match.dest;
        if (!leg.lineName) leg.lineName = match.lineName;
        if (!leg.lineId) leg.lineId = match.lineId;
      } else dep = earliest;
      leg.departHhmm = toHhmm(dep);
    }
    t = parseMin(leg.departHhmm) ?? earliest;
    const rideMin = Math.max(1, Math.round(leg.minutes) || 1);
    let arr = parseMin(leg.arriveHhmm);
    if (arr != null && arr < t - 12 * 60) arr += 24 * 60;
    if (arr == null || arr < t + rideMin) {
      arr = t + rideMin;
      leg.arriveHhmm = toHhmm(arr);
    }
    t = arr;
    prevRide = true;
  }
  const first = legs[0];
  const last = legs[legs.length - 1];
  let total = (parseMin(last?.arriveHhmm) ?? t) - (parseMin(first?.departHhmm) ?? nowMin);
  if (total < 0) total += 24 * 60;
  return {
    ...journey,
    legs,
    departHhmm: first?.departHhmm ?? journey.departHhmm,
    arriveHhmm: last?.arriveHhmm ?? journey.arriveHhmm,
    totalMinutes: Math.max(1, Math.round(total)),
  };
}

function extraCost(prevKind: string, prevLine: string | undefined, edge: Edge): number {
  if (edge.kind === "walk") return 0;
  const boardPenalty = edge.railKind === "shinkansen" && prevLine !== edge.lineId ? 22 : 0;
  if (prevKind === "walk" || prevKind === "start") return boardPenalty;
  if (prevLine && prevLine !== edge.lineId) return TRANSFER_MIN + boardPenalty;
  return 0;
}

type Seed = { key: string; cost: number; walk?: RouteLeg };

export function planJourney(
  lines: LineRuntime[],
  index: Map<string, StationHit>,
  origin: StationHit | { lng: number; lat: number },
  dest: StationHit,
  now = new Date(),
  minWait = -0.2,
): Journey | null {
  const destKey = stationKey(dest);
  const graph = buildGraph(lines);
  const seeds: Seed[] = [];

  if ("name" in origin) {
    seeds.push({ key: stationKey(origin), cost: 0 });
  } else {
    for (const hit of index.values()) {
      const km = haversine([origin.lng, origin.lat], [hit.lng, hit.lat]);
      if (km > 1.8) continue;
      const minutes = Math.max(2, (km / WALK_KMH) * 60);
      seeds.push({
        key: stationKey(hit),
        cost: minutes,
        walk: {
          kind: "walk",
          from: { name: "", lng: origin.lng, lat: origin.lat, prefecture: "" },
          to: asStop(hit),
          stops: [
            { name: "", lng: origin.lng, lat: origin.lat, prefecture: "" },
            asStop(hit),
          ],
          minutes,
        },
      });
    }
    seeds.sort((a, b) => a.cost - b.cost);
    seeds.splice(6);
    if (!seeds.length) return null;
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { prev: string; edge: Edge }>();
  const heap = new MinHeap();

  for (const seed of seeds) {
    const state = `${seed.key}|start`;
    dist.set(state, seed.cost);
    heap.push({ c: seed.cost, state });
  }

  let bestState: string | null = null;
  let bestCost = Infinity;

  while (heap.a.length) {
    const cur = heap.pop()!;
    const known = dist.get(cur.state);
    if (known === undefined || cur.c > known + 1e-6) continue;
    const bar = cur.state.lastIndexOf("|");
    const key = cur.state.slice(0, bar);
    const via = cur.state.slice(bar + 1);
    if (key === destKey && cur.c < bestCost) {
      bestCost = cur.c;
      bestState = cur.state;
      continue;
    }
    if (cur.c > bestCost) continue;
    const prevKind = via === "start" ? "start" : via === "walk" ? "walk" : "ride";
    const prevLine = prevKind === "ride" ? via : undefined;
    const list = graph.edges.get(key);
    if (!list) continue;
    for (const edge of list) {
      const add = extraCost(prevKind, prevLine, edge);
      const nc = cur.c + edge.minutes + add;
      const nvia = edge.kind === "walk" ? "walk" : (edge.lineId ?? "ride");
      const nstate = `${edge.to}|${nvia}`;
      const old = dist.get(nstate);
      if (old !== undefined && old <= nc) continue;
      dist.set(nstate, nc);
      prev.set(nstate, { prev: cur.state, edge });
      heap.push({ c: nc, state: nstate });
    }
  }

  if (!bestState) return null;

  const raw: Edge[] = [];
  let cursor: string | undefined = bestState;
  while (cursor) {
    const step = prev.get(cursor);
    if (!step) break;
    raw.push(step.edge);
    cursor = step.prev;
  }
  raw.reverse();
  if (!raw.length && "name" in origin && stationKey(origin) === destKey) return null;

  const seed = seeds.find((s) => s.key === (raw[0]?.fromStop ? stationKey(raw[0].fromStop) : s.key)) ?? seeds[0];
  const legs: RouteLeg[] = [];
  if (seed?.walk) legs.push(seed.walk);

  for (const edge of raw) {
    const last = legs[legs.length - 1];
    if (
      last &&
      last.kind === "ride" &&
      edge.kind === "ride" &&
      last.lineId === edge.lineId
    ) {
      last.to = edge.toStop;
      last.stops.push(edge.toStop);
      last.minutes += edge.minutes;
      last.toward = edge.toward;
    } else {
      legs.push({
        kind: edge.kind,
        lineId: edge.lineId,
        lineName: edge.lineName,
        color: edge.color,
        toward: edge.toward,
        from: edge.fromStop,
        to: edge.toStop,
        stops: [edge.fromStop, edge.toStop],
        minutes: edge.minutes,
      });
    }
  }

  if (!legs.length) return null;

  const { minutes } = tokyoParts(now);
  let t = minutes;
  let prevRide = false;

  for (const leg of legs) {
    if (leg.kind === "walk") {
      leg.departHhmm = toHhmm(t);
      t += Math.max(1, leg.minutes);
      leg.arriveHhmm = toHhmm(t);
      prevRide = false;
      continue;
    }
    const pad = prevRide ? TRANSFER_MIN : Math.max(0, minWait);
    const earliest = t + pad;
    const fromHit = index.get(stationKey(leg.from));
    const match = pickDep(fromHit, dateAt(now, earliest), leg.lineId, leg.lineName);
    if (!match && !fromHit) return null;
    t = match ? tokyoParts(dateAt(now, earliest)).minutes + match.minutesUntil : earliest;
    if (t < earliest) t = earliest;
    if (match?.dest && !leg.toward) leg.toward = match.dest;
    leg.departHhmm = toHhmm(t);
    t += Math.max(1, leg.minutes);
    leg.arriveHhmm = toHhmm(t);
    prevRide = true;
  }

  const rideLegs = legs.filter((l) => l.kind === "ride");
  const transfers = Math.max(0, rideLegs.length - 1);
  const originStop: RouteStop =
    "name" in origin
      ? asStop(origin)
      : (legs[0]?.from ?? asStop(dest));
  const totalMinutes = Math.max(1, Math.round(t - minutes < 0 ? t + 24 * 60 - minutes : t - minutes));

  return attachTrack(
    {
      origin: originStop,
      dest: asStop(dest),
      legs,
      totalMinutes,
      transfers,
      departHhmm: legs[0]?.departHhmm ?? toHhmm(minutes),
      arriveHhmm: legs[legs.length - 1]?.arriveHhmm ?? toHhmm(t),
      walkFromGpsMin: seed?.walk?.minutes,
      source: "local",
    },
    lines,
  );
}

export function journeyCamera(j: Journey): { lng: number; lat: number; zoom: number } {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const leg of j.legs) {
    for (const s of leg.stops) {
      if (!s.lng && !s.lat && !s.name) continue;
      minLng = Math.min(minLng, s.lng);
      maxLng = Math.max(maxLng, s.lng);
      minLat = Math.min(minLat, s.lat);
      maxLat = Math.max(maxLat, s.lat);
    }
  }
  const span = Math.max(maxLng - minLng, maxLat - minLat, 0.04);
  const zoom = Math.max(7.4, Math.min(13.6, Math.log2(360 / span) - 1.35));
  return { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2, zoom };
}
