import { HUBS, hubNameFor } from "@/data/hubs";
import { toJa } from "@/lib/i18n";
import { haversine } from "./geo";
import { nearbyStations, searchStations } from "./normalize";
import type { Journey, LineRuntime, RouteLeg, RouteStop, StationHit } from "./types";

export type GraphNode = {
  key: string;
  name: string;
  lng: number;
  lat: number;
  prefecture: string;
  lineIds: string[];
};

export type GraphEdge = {
  from: string;
  to: string;
  minutes: number;
  kind: "ride" | "walk";
  lineId?: string;
  lineName?: string;
  color?: string;
};

export type StationGraph = {
  nodes: Map<string, GraphNode>;
  adj: Map<string, GraphEdge[]>;
};

export function buildStationGraph(lines: LineRuntime[]): StationGraph {
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, GraphEdge[]>();
  const addNode = (stop: { n: string; lng: number; lat: number; pf: string }, lineId: string) => {
    const key = `${stop.n}|${stop.pf}`;
    const node = nodes.get(key);
    if (node) {
      if (!node.lineIds.includes(lineId)) node.lineIds.push(lineId);
      return key;
    }
    nodes.set(key, {
      key,
      name: stop.n,
      lng: stop.lng,
      lat: stop.lat,
      prefecture: stop.pf,
      lineIds: [lineId],
    });
    return key;
  };
  const addEdge = (e: GraphEdge) => {
    const list = adj.get(e.from);
    if (list) list.push(e);
    else adj.set(e.from, [e]);
  };

  for (const line of lines) {
    if (line.stops.length < 2) continue;
    for (let i = 0; i < line.stops.length; i++) addNode(line.stops[i]!, line.id);
    const link = (i: number, j: number) => {
      const a = line.stops[i]!;
      const b = line.stops[j]!;
      const from = `${a.n}|${a.pf}`;
      const to = `${b.n}|${b.pf}`;
      if (from === to) return;
      const minutes = Math.max(0.8, (haversine([a.lng, a.lat], [b.lng, b.lat]) / Math.max(18, line.speed)) * 60);
      addEdge({ from, to, minutes, kind: "ride", lineId: line.id, lineName: line.name, color: line.color });
    };
    for (let i = 0; i < line.stops.length - 1; i++) {
      link(i, i + 1);
      link(i + 1, i);
    }
    if (line.loop && line.stops.length > 2) {
      link(line.stops.length - 1, 0);
      link(0, line.stops.length - 1);
    }
  }
  return { nodes, adj };
}

function asStop(s: { n?: string; name?: string; lng: number; lat: number; pf?: string; prefecture?: string }): RouteStop {
  return {
    name: s.name ?? s.n ?? "",
    lng: s.lng,
    lat: s.lat,
    prefecture: s.prefecture ?? s.pf ?? "",
  };
}

function pathBetweenStops(line: LineRuntime, fromName: string, toName: string, via: RouteStop[]): [number, number][] {
  if (via.length >= 2) {
    const pts: [number, number][] = [];
    for (let i = 0; i < via.length - 1; i++) {
      const a = via[i]!;
      const b = via[i + 1]!;
      const ia = line.stops.findIndex((s) => s.n === a.name);
      const ib = line.stops.findIndex((s) => s.n === b.name);
      if (ia < 0 || ib < 0) {
        pts.push([a.lng, a.lat], [b.lng, b.lat]);
        continue;
      }
      const lo = Math.min(line.stopKm[ia] ?? 0, line.stopKm[ib] ?? 0);
      const hi = Math.max(line.stopKm[ia] ?? 0, line.stopKm[ib] ?? 0);
      const slice: [number, number][] = [];
      for (let p = 0; p < line.path.length; p++) {
        const km = line.cum[p] ?? 0;
        if (km >= lo - 0.08 && km <= hi + 0.08) slice.push(line.path[p]!);
      }
      if ((line.stopKm[ia] ?? 0) > (line.stopKm[ib] ?? 0)) slice.reverse();
      if (!slice.length) slice.push([a.lng, a.lat], [b.lng, b.lat]);
      if (pts.length) slice.shift();
      pts.push(...slice);
    }
    return pts.length ? pts : via.map((s) => [s.lng, s.lat] as [number, number]);
  }
  const ia = line.stops.findIndex((s) => s.n === fromName);
  const ib = line.stops.findIndex((s) => s.n === toName);
  if (ia < 0 || ib < 0) return [];
  const lo = Math.min(line.stopKm[ia] ?? 0, line.stopKm[ib] ?? 0);
  const hi = Math.max(line.stopKm[ia] ?? 0, line.stopKm[ib] ?? 0);
  const pts: [number, number][] = [];
  for (let p = 0; p < line.path.length; p++) {
    const km = line.cum[p] ?? 0;
    if (km >= lo - 0.08 && km <= hi + 0.08) pts.push(line.path[p]!);
  }
  if ((line.stopKm[ia] ?? 0) > (line.stopKm[ib] ?? 0)) pts.reverse();
  return pts;
}

export function normStation(n: string) {
  return toJa(n)
    .replace(/[駅站]$/u, "")
    .replace(/\s+/g, "")
    .trim();
}

function stopIndexByName(line: LineRuntime, name: string, hint?: { lng: number; lat: number }) {
  const key = normStation(name);
  if (!key) return -1;
  const hits: number[] = [];
  for (let i = 0; i < line.stops.length; i++) {
    if (normStation(line.stops[i]!.n) === key) hits.push(i);
  }
  if (!hits.length) return -1;
  if (hits.length === 1 || !hint || !Number.isFinite(hint.lng) || !Number.isFinite(hint.lat)) return hits[0]!;
  let best = hits[0]!;
  let bestD = Infinity;
  for (const i of hits) {
    const s = line.stops[i]!;
    const d = Math.hypot(s.lng - hint.lng, s.lat - hint.lat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function stopNearHint(s: { lng: number; lat: number }, hint: { lng: number; lat: number }, deg = 0.12) {
  if (!Number.isFinite(hint.lng) || !Number.isFinite(hint.lat)) return true;
  if (hint.lng < 122 || hint.lng > 154 || hint.lat < 24 || hint.lat > 46) return true;
  return Math.hypot(s.lng - hint.lng, s.lat - hint.lat) < deg;
}

function nameTokens(s: string) {
  return s
    .replace(/^JR/u, "")
    .replace(/線$/u, "")
    .split(/[・／/、＋+〜～]/u)
    .map((t) => t.replace(/線$/u, "").trim())
    .filter((t) => t.length >= 2);
}

function namesRelate(a: string, b: string) {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  return ta.some((x) => tb.some((y) => x === y || x.includes(y) || y.includes(x)));
}

function cleanLineQuery(s: string) {
  return s
    .replace(/[（(][^）)]{0,40}[）)]/gu, "")
    .replace(/[・･].*$/u, "")
    .replace(/(行き?|方面)$/u, "")
    .replace(/アーバンパーク(?:ライン)?/u, "野田")
    .replace(/区間/gu, "")
    .trim();
}

function stationKeyVariants(name: string) {
  const key = normStation(name);
  const out: string[] = [];
  const add = (v: string) => {
    const n = normStation(v);
    if (n && !out.includes(n)) out.push(n);
  };
  add(key);
  add(key.replace(/[（(][^）)]*[）)]/gu, ""));
  add(key.replace(/(西口|東口|南口|北口)$/u, ""));
  add(key.replace(/[（(][^）)]*[）)]/gu, "").replace(/(西口|東口|南口|北口)$/u, ""));
  return out;
}

function matchStationName(candidate: string, keys: string[]) {
  const n = normStation(candidate);
  if (!n) return false;
  return keys.some((k) => {
    if (!k) return false;
    if (n === k) return true;
    return k.length >= 2 && n.length > k.length && n.endsWith(k);
  });
}

function isShinkansenName(s: string) {
  return /新幹|のぞみ|ひかり|こだま|みずほ|さくら|はやぶさ|こまち|かがやき/.test(s);
}

export function findLineForLeg(lines: LineRuntime[], index: Map<string, StationHit>, leg: RouteLeg): LineRuntime | null {
  if (leg.kind !== "ride") return null;
  const fromKey = normStation(leg.from.name);
  const toKey = normStation(leg.to.name);
  const fromKeys = stationKeyVariants(leg.from.name);
  const toKeys = stationKeyVariants(leg.to.name);
  const hasBoth = (l: LineRuntime) => {
    if (!fromKeys.length || !toKeys.length) return false;
    const fromHits = l.stops.filter((s) => matchStationName(s.n, fromKeys));
    const toHits = l.stops.filter((s) => matchStationName(s.n, toKeys));
    if (!fromHits.length || !toHits.length) return false;
    return fromHits.some((s) => stopNearHint(s, leg.from)) && toHits.some((s) => stopNearHint(s, leg.to));
  };
  if (leg.lineId) {
    const exact = lines.find((l) => l.id === leg.lineId);
    if (exact && (hasBoth(exact) || !fromKey || !toKey)) return exact;
  }
  const raw = cleanLineQuery((leg.lineName ?? "").replace(/^JR/u, "").replace(/線$/u, "").trim());
  const named = raw
    ? lines.filter(
        (l) =>
          namesRelate(l.name, leg.lineName ?? "") ||
          namesRelate(l.name, raw) ||
          namesRelate(l.name.replace(/線$/u, ""), raw) ||
          (isShinkansenName(raw) && l.kind === "shinkansen"),
      )
    : [];
  const namedBoth = named.find(hasBoth);
  if (namedBoth) return namedBoth;
  const anyBoth = lines.find(hasBoth);
  if (anyBoth) return anyBoth;
  const origin = [...index.values()]
    .filter((s) => matchStationName(s.name, fromKeys))
    .sort((a, b) => Math.hypot(a.lng - leg.from.lng, a.lat - leg.from.lat) - Math.hypot(b.lng - leg.from.lng, b.lat - leg.from.lat))[0];
  if (origin?.lines.length) {
    const viaDest = origin.lines.find((l) =>
      l.stops.some((s) => matchStationName(s.n, toKeys) && stopNearHint(s, leg.to)),
    );
    if (viaDest) return viaDest;
  }
  return null;
}

export function locateStation(
  name: string,
  lines: LineRuntime[],
  index: Map<string, StationHit>,
  fallback: RouteStop,
): RouteStop {
  const keys = stationKeyVariants(name);
  if (!keys.length) return { ...fallback, name: name || fallback.name };
  const exact = (nm: string) => {
    const n = normStation(nm);
    return Boolean(n && keys.includes(n));
  };
  const matches: RouteStop[] = [];
  for (const hit of index.values()) {
    if (exact(hit.name)) matches.push({ name: hit.name, lng: hit.lng, lat: hit.lat, prefecture: hit.prefecture });
  }
  if (!matches.length) {
    for (const line of lines) {
      for (const s of line.stops) {
        if (exact(s.n)) matches.push({ name: s.n, lng: s.lng, lat: s.lat, prefecture: s.pf });
      }
    }
  }
  if (matches.length) {
    const hint =
      Number.isFinite(fallback.lng) &&
      Number.isFinite(fallback.lat) &&
      fallback.lng > 122 &&
      fallback.lng < 154 &&
      fallback.lat > 24 &&
      fallback.lat < 46;
    if (hint) {
      matches.sort(
        (a, b) => Math.hypot(a.lng - fallback.lng, a.lat - fallback.lat) - Math.hypot(b.lng - fallback.lng, b.lat - fallback.lat),
      );
      const closest = matches[0]!;
      if (Math.hypot(closest.lng - fallback.lng, closest.lat - fallback.lat) < 0.08) return closest;
      return { name: fallback.name || closest.name, lng: fallback.lng, lat: fallback.lat, prefecture: fallback.prefecture };
    }
    return matches[0]!;
  }
  return { ...fallback, name: name || fallback.name };
}

export function sliceRailPath(
  line: LineRuntime,
  from: { lng: number; lat: number; name?: string },
  to: { lng: number; lat: number; name?: string },
): [number, number][] {
  let ia = from.name ? stopIndexByName(line, from.name) : -1;
  let ib = to.name ? stopIndexByName(line, to.name) : -1;
  const nearestStop = (lng: number, lat: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < line.stops.length; i++) {
      const d = (line.stops[i]!.lng - lng) ** 2 + (line.stops[i]!.lat - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  if (ia < 0) ia = nearestStop(from.lng, from.lat);
  if (ib < 0) ib = nearestStop(to.lng, to.lat);
  if (ia === ib) {
    const a = nearestPathIndexLocal(line, from.lng, from.lat);
    const b = nearestPathIndexLocal(line, to.lng, to.lat);
    if (a === b) return [];
    const out: [number, number][] = [];
    const step = a < b ? 1 : -1;
    for (let i = a; ; i += step) {
      out.push(line.path[i]!);
      if (i === b) break;
    }
    return out;
  }
  const lo = Math.min(line.stopKm[ia] ?? 0, line.stopKm[ib] ?? 0);
  const hi = Math.max(line.stopKm[ia] ?? 0, line.stopKm[ib] ?? 0);
  const pts: [number, number][] = [];
  for (let p = 0; p < line.path.length; p++) {
    const km = line.cum[p] ?? 0;
    if (km >= lo - 0.05 && km <= hi + 0.05) pts.push(line.path[p]!);
  }
  if ((line.stopKm[ia] ?? 0) > (line.stopKm[ib] ?? 0)) pts.reverse();
  if (pts.length >= 2) return pts;
  const a = nearestPathIndexLocal(line, from.lng, from.lat);
  const b = nearestPathIndexLocal(line, to.lng, to.lat);
  if (a === b) return [];
  const out: [number, number][] = [];
  const step = a < b ? 1 : -1;
  for (let i = a; ; i += step) {
    out.push(line.path[i]!);
    if (i === b) break;
  }
  return out;
}

function nearestPathIndexLocal(line: LineRuntime, lng: number, lat: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < line.path.length; i++) {
    const dx = (line.path[i]![0] - lng) * 91;
    const dy = (line.path[i]![1] - lat) * 111;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

let graphCache: { n: number; g: StationGraph } | null = null;
function graphOf(lines: LineRuntime[]) {
  if (graphCache && graphCache.n === lines.length) return graphCache.g;
  graphCache = { n: lines.length, g: buildStationGraph(lines) };
  return graphCache.g;
}

function nodesNamed(g: StationGraph, name: string, hint?: { lng: number; lat: number }) {
  const key = normStation(name);
  const out: GraphNode[] = [];
  if (!key) return out;
  for (const n of g.nodes.values()) if (normStation(n.name) === key) out.push(n);
  if (!hint || !out.length || !Number.isFinite(hint.lng) || !Number.isFinite(hint.lat)) return out;
  const near = out.filter((n) => Math.hypot(n.lng - hint.lng, n.lat - hint.lat) < 0.25);
  if (near.length) return near;
  out.sort((a, b) => Math.hypot(a.lng - hint.lng, a.lat - hint.lat) - Math.hypot(b.lng - hint.lng, b.lat - hint.lat));
  return out.slice(0, 1);
}

function concatPath(parts: [number, number][][]) {
  const out: [number, number][] = [];
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) continue;
      out.push(p);
    }
  }
  return out;
}

export function chainRailPath(
  fromName: string,
  toName: string,
  lines: LineRuntime[],
  preferName = "",
  fromHint?: { lng: number; lat: number },
  toHint?: { lng: number; lat: number },
): [number, number][] {
  const g = graphOf(lines);
  const starts = nodesNamed(g, fromName, fromHint);
  const goals = new Set(nodesNamed(g, toName, toHint).map((n) => n.key));
  if (!starts.length || !goals.size) return [];
  const byId = new Map(lines.map((l) => [l.id, l]));
  const preferShin = isShinkansenName(preferName);
  const dist = new Map<string, number>();
  const prev = new Map<string, { prev: string; edge: GraphEdge }>();
  const heap: { c: number; k: string }[] = [];
  const push = (c: number, k: string) => {
    heap.push({ c, k });
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p]!.c <= heap[i]!.c) break;
      const t = heap[p]!;
      heap[p] = heap[i]!;
      heap[i] = t;
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (!heap.length || !last) return top;
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heap[l]!.c < heap[m]!.c) m = l;
      if (r < heap.length && heap[r]!.c < heap[m]!.c) m = r;
      if (m === i) break;
      const t = heap[i]!;
      heap[i] = heap[m]!;
      heap[m] = t;
      i = m;
    }
    return top;
  };
  for (const s of starts) {
    dist.set(s.key, 0);
    push(0, s.key);
  }
  let end: string | null = null;
  while (heap.length) {
    const cur = pop()!;
    const known = dist.get(cur.k);
    if (known === undefined || cur.c > known + 1e-6) continue;
    if (goals.has(cur.k)) {
      end = cur.k;
      break;
    }
    const edges = g.adj.get(cur.k);
    if (!edges) continue;
    const via = prev.get(cur.k)?.edge.lineId;
    for (const e of edges) {
      const line = e.lineId ? byId.get(e.lineId) : undefined;
      const shin = line?.kind === "shinkansen" || isShinkansenName(e.lineName ?? "");
      const named = preferName && namesRelate(e.lineName ?? "", preferName);
      const hop = e.minutes * (preferShin && shin ? 0.35 : named ? 0.55 : 1) + (via && via !== e.lineId ? (shin ? 4 : 12) : 0);
      const nc = cur.c + hop;
      const old = dist.get(e.to);
      if (old !== undefined && old <= nc) continue;
      dist.set(e.to, nc);
      prev.set(e.to, { prev: cur.k, edge: e });
      push(nc, e.to);
    }
  }
  if (!end) return [];
  const hops: GraphEdge[] = [];
  let cursor: string | undefined = end;
  while (cursor) {
    const step = prev.get(cursor);
    if (!step) break;
    hops.push(step.edge);
    cursor = step.prev;
  }
  hops.reverse();
  const parts: [number, number][][] = [];
  let i = 0;
  while (i < hops.length) {
    const lineId = hops[i]!.lineId;
    let j = i;
    while (j + 1 < hops.length && hops[j + 1]!.lineId === lineId) j++;
    const line = lineId ? byId.get(lineId) : undefined;
    const a = g.nodes.get(hops[i]!.from);
    const b = g.nodes.get(hops[j]!.to);
    if (line && a && b) {
      const sliced = sliceRailPath(line, { name: a.name, lng: a.lng, lat: a.lat }, { name: b.name, lng: b.lng, lat: b.lat });
      if (sliced.length >= 2) parts.push(sliced);
      else parts.push([[a.lng, a.lat], [b.lng, b.lat]]);
    } else if (a && b) {
      parts.push([[a.lng, a.lat], [b.lng, b.lat]]);
    }
    i = j + 1;
  }
  return concatPath(parts);
}

function thinPath(pts: [number, number][], from: RouteStop, to: RouteStop) {
  const km = haversine([from.lng, from.lat], [to.lng, to.lat]);
  return km > 1.2 && pts.length < 4;
}

function nearestRailStop(lines: LineRuntime[], lng: number, lat: number, preferName = ""): RouteStop | null {
  const prefer = normStation(preferName);
  let best: RouteStop | null = null;
  let bestD = Infinity;
  for (const line of lines) {
    for (const s of line.stops) {
      const dx = (s.lng - lng) * 91;
      const dy = (s.lat - lat) * 111;
      let d = Math.hypot(dx, dy);
      if (prefer && normStation(s.n) === prefer) d -= 80;
      if (d < bestD) {
        bestD = d;
        best = asStop(s);
      }
    }
  }
  return best;
}

export function densifyRailPath(
  from: RouteStop,
  to: RouteStop,
  lines: LineRuntime[],
  index: Map<string, StationHit>,
  leg: RouteLeg,
): { line: LineRuntime | null; path: [number, number][]; stops: RouteStop[] } {
  const routed = pathForRide(from, to, lines, index, leg);
  if (!thinPath(routed.path, from, to) && routed.path.length >= 3) return routed;
  const a = nearestRailStop(lines, from.lng, from.lat, from.name);
  const b = nearestRailStop(lines, to.lng, to.lat, to.name);
  if (a && b && a.name !== b.name) {
    const chained = chainRailPath(a.name, b.name, lines, leg.lineName ?? "", a, b);
    if (chained.length >= 4) return { line: routed.line, path: chained, stops: routed.stops };
    const via = findLineForLeg(lines, index, { ...leg, from: a, to: b });
    if (via) {
      const sliced = sliceRailPath(via, a, b);
      if (sliced.length >= 4) return { line: via, path: sliced, stops: routed.stops };
    }
  }
  if (routed.path.length >= 3) return routed;
  if (routed.stops.length >= 3) {
    return { ...routed, path: routed.stops.map((s) => [s.lng, s.lat] as [number, number]) };
  }
  return routed;
}

export function pathForRide(
  from: RouteStop,
  to: RouteStop,
  lines: LineRuntime[],
  index: Map<string, StationHit>,
  leg: RouteLeg,
): { line: LineRuntime | null; path: [number, number][]; stops: RouteStop[] } {
  const line = findLineForLeg(lines, index, { ...leg, from, to });
  let sliced: [number, number][] = [];
  let filled = [from, to];
  const a = line ? stopIndexByName(line, from.name, from) : -1;
  const b = line ? stopIndexByName(line, to.name, to) : -1;
  if (line && a >= 0 && b >= 0 && a !== b) {
    const step = a <= b ? 1 : -1;
    const out: RouteStop[] = [];
    for (let i = a; i !== b; i += step) out.push(asStop(line.stops[i]!));
    out.push(asStop(line.stops[b]!));
    filled = out;
    sliced = sliceRailPath(line, asStop(line.stops[a]!), asStop(line.stops[b]!));
    if (!thinPath(sliced, from, to) && sliced.length >= 3) return { line, path: sliced, stops: filled };
  }
  const chained = chainRailPath(from.name, to.name, lines, leg.lineName ?? "", from, to);
  if (chained.length >= 3) return { line, path: chained, stops: filled };
  const snapA = nearestRailStop(lines, from.lng, from.lat, from.name);
  const snapB = nearestRailStop(lines, to.lng, to.lat, to.name);
  if (snapA && snapB && snapA.name !== snapB.name) {
    const snapped = chainRailPath(snapA.name, snapB.name, lines, leg.lineName ?? "", snapA, snapB);
    if (snapped.length >= 3) return { line, path: snapped, stops: filled };
    const via = findLineForLeg(lines, index, { ...leg, from: snapA, to: snapB });
    if (via) {
      const extra = sliceRailPath(via, snapA, snapB);
      if (extra.length >= 3) return { line: via, path: extra, stops: filled };
    }
  }
  if (sliced.length >= 3) return { line, path: sliced, stops: filled };
  if (filled.length >= 3) {
    const via = filled.map((s) => [s.lng, s.lat] as [number, number]);
    if (via.length >= 3) return { line, path: via, stops: filled };
  }
  if (sliced.length >= 2 && !thinPath(sliced, from, to)) return { line, path: sliced, stops: filled };
  return {
    line,
    path: chained.length >= 2 ? chained : sliced.length >= 2 ? sliced : [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    stops: filled,
  };
}

export function attachTrack(journey: Journey, lines: LineRuntime[], index: Map<string, StationHit> = new Map()): Journey {
  const legs: RouteLeg[] = journey.legs.map((leg) => {
    const from = locateStation(leg.from.name, lines, index, leg.from);
    const to = locateStation(leg.to.name, lines, index, leg.to);
    if (leg.kind !== "ride") {
      const hop = haversine([from.lng, from.lat], [to.lng, to.lat]);
      if (hop > 2.4) {
        const routed = densifyRailPath(from, to, lines, index, { ...leg, kind: "ride", from, to });
        if (routed.path.length >= 4) {
          return {
            ...leg,
            kind: "ride",
            from,
            to,
            lineId: leg.lineId ?? routed.line?.id,
            lineName: leg.lineName ?? routed.line?.name,
            color: leg.color ?? routed.line?.color,
            stops: routed.stops,
            path: routed.path,
          };
        }
      }
      return {
        ...leg,
        from,
        to,
        stops: [from, to],
        path: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      };
    }
    const resolved = { ...leg, from, to };
    const routed = densifyRailPath(from, to, lines, index, resolved);
    return {
      ...leg,
      from,
      to,
      lineId: leg.lineId ?? routed.line?.id,
      lineName: leg.lineName ?? routed.line?.name,
      color: leg.color ?? routed.line?.color,
      stops: routed.stops,
      path: routed.path,
    };
  });
  return { ...journey, legs };
}

function pinHit(hits: StationHit[], fallback: StationHit | null) {
  if (!fallback || !Number.isFinite(fallback.lng) || !Number.isFinite(fallback.lat)) return null;
  let best: StationHit | null = null;
  let bestD = 0.05;
  for (const hit of hits) {
    const d = Math.hypot(hit.lng - fallback.lng, hit.lat - fallback.lat);
    if (d < bestD) {
      bestD = d;
      best = hit;
    }
  }
  return best;
}

export function resolveStationQuery(
  index: Map<string, StationHit>,
  query: string,
  fallback: StationHit | null = null,
  near: { lng: number; lat: number } | null = null,
): { match: StationHit | null; suggestions: StationHit[] } {
  const q = query.trim();
  if (!q) {
    const suggestions = near ? nearbyStations(index, near.lng, near.lat, 8) : [];
    return { match: fallback, suggestions };
  }
  const hub = hubNameFor(q);
  const hits = searchStations(index, hub ?? q, 16, near);
  if (hits[0] && (hits[0].name === (hub ?? q) || hits[0].name.startsWith(hub ?? q) || (hub && hits[0].name === hub))) {
    const pinned = pinHit(hits, fallback) ?? hits[0]!;
    return { match: pinned, suggestions: hits };
  }
  if (hits.length) {
    const pinned = pinHit(hits, fallback) ?? hits[0]!;
    return { match: pinned, suggestions: hits };
  }
  const hubsNear = HUBS.filter((h) => h.name.includes(q) || h.aliases.some((a) => a.includes(q) || q.toLowerCase().includes(a.toLowerCase()))).slice(0, 5);
  const fromHubs: StationHit[] = [];
  for (const h of hubsNear) {
    const found = searchStations(index, h.name, 1)[0];
    if (found) fromHubs.push(found);
  }
  if (fromHubs.length) return { match: fromHubs[0]!, suggestions: fromHubs };
  if (near) {
    const nearby = nearbyStations(index, near.lng, near.lat, 6);
    if (nearby.length) return { match: nearby[0]!, suggestions: nearby };
  }
  return { match: fallback, suggestions: fallback ? [fallback] : [] };
}
