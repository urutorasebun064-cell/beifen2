import { operationOf } from "@/data/jr-ops";
import { haversine, pointAlong, tokyoParts } from "./geo";
import { delayMinutes } from "./delay";
import { stopFrac } from "./simulate";
import type { LineRuntime, RouteLeg, Train } from "./types";

export function stopIndexByName(line: LineRuntime, name: string) {
  const n = name.replace(/駅$/u, "").trim();
  if (!n) return -1;
  const exact = line.stops.findIndex((s) => s.n === n);
  if (exact >= 0) return exact;
  return line.stops.findIndex((s) => s.n.startsWith(n) || n.startsWith(s.n));
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

const coasts = new Map<string, { key: string; t0: number; u0: number }>();

/** Place a live train on the rail using GTFS-RT delay + next-stop times, not GPS lerp. */
export function snapTrainToTimetable(
  line: LineRuntime,
  train: Train,
  nowMs: number,
  meta?: { arrUnix?: number; status?: number; delaySec?: number; snapAt?: number },
): Train {
  const fi = stopIndexByName(line, train.prevStop);
  const ti = stopIndexByName(line, train.nextStop);
  const delaySec = meta?.delaySec ?? (train.delayMin > 0 ? train.delayMin * 60 : 0);
  const status = meta?.status ?? -1;
  let p = train.progress;

  if (status === 1 && (fi >= 0 || ti >= 0)) {
    p = stopFrac(line, fi >= 0 ? fi : ti);
  } else if (fi >= 0 && ti >= 0 && fi !== ti) {
    const a = stopFrac(line, fi);
    const b = stopFrac(line, ti);
    const segKm = Math.abs((line.stopKm[ti] ?? 0) - (line.stopKm[fi] ?? 0));
    const speed = Math.max(18, operationOf(line).speed);
    const segSec = Math.max(45, (segKm / speed) * 3600);
    const key = `${train.prevStop}|${train.nextStop}|${train.dir}`;
    const prev = coasts.get(train.id);
    let u = 0.18;
    if (meta?.arrUnix) {
      u = 1 - (meta.arrUnix * 1000 - nowMs) / (segSec * 1000);
    } else if (train.etaMin != null && Number.isFinite(train.etaMin)) {
      const elapsed = meta?.snapAt ? (nowMs - meta.snapAt) / 60000 : 0;
      u = 1 - ((train.etaMin - elapsed) * 60) / segSec;
    } else if (prev && prev.key === key) {
      u = prev.u0 + (nowMs - prev.t0) / (segSec * 1000);
    } else {
      u = delaySec > 90 ? 0.12 : 0.18;
      if (status === 0) u = Math.min(u, 0.16);
      coasts.set(train.id, { key, t0: nowMs, u0: u });
    }
    p = a + (b - a) * clamp01(u);
  } else if (fi >= 0) {
    p = stopFrac(line, fi);
  } else if (ti >= 0) {
    p = stopFrac(line, ti);
  }

  if (line.loop) p = ((p % 1) + 1) % 1;
  else p = clamp01(p);

  const pose = pointAlong(line.path, line.cum, line.totalKm, p);
  const bearing = train.dir === 1 && !line.loop ? (pose.bearing + 180) % 360 : pose.bearing;
  let eta = train.etaMin;
  if (meta?.arrUnix) eta = Math.max(0, (meta.arrUnix * 1000 - nowMs) / 60000);

  return {
    ...train,
    lng: pose.coord[0],
    lat: pose.coord[1],
    bearing,
    progress: p,
    delayMin: delayMinutes(delaySec) || train.delayMin,
    delaySec: delaySec || train.delaySec,
    stopIndex: ti >= 0 ? ti : fi >= 0 ? fi : train.stopIndex,
    etaMin: eta,
    gps: false,
  };
}

function parseMin(hhmm?: string) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when this timetable ride has not left yet. */
export function rideWaiting(leg: RouteLeg, now: Date, delayMin = 0) {
  const dep = parseMin(leg.departHhmm);
  if (dep == null) return false;
  const nowMin = tokyoParts(now).minutes;
  let t = nowMin;
  const start = dep + Math.max(0, delayMin);
  if (start - t > 720) t += 1440;
  if (t - start > 720) t -= 1440;
  return t < start - 0.35;
}

function alongPath(path: [number, number][], u: number) {
  if (path.length < 2) return { coord: path[0] ?? [0, 0], bearing: 0 };
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1]! + haversine(path[i - 1]!, path[i]!));
  const total = cum[cum.length - 1] || 0;
  if (total < 1e-6) return { coord: path[0]!, bearing: 0 };
  return pointAlong(path, cum, total, clamp01(u));
}

/** Put a searched ride on its official rail, using the transit-app times. */
export function placeTrainOnLeg(
  leg: RouteLeg,
  line: LineRuntime | null,
  path: [number, number][] | undefined,
  now: Date,
  delayMin = 0,
): Train | null {
  if (leg.kind !== "ride") return null;
  const rail =
    path && path.length >= 2
      ? path
      : [
          [leg.from.lng, leg.from.lat] as [number, number],
          [leg.to.lng, leg.to.lat] as [number, number],
        ];
  if (rail.length < 2) return null;
  const nowMin = tokyoParts(now).minutes;
  const dep = parseMin(leg.departHhmm);
  const arr = parseMin(leg.arriveHhmm);
  let start = dep ?? nowMin;
  let end = arr ?? start + Math.max(1, leg.minutes);
  if (end <= start) end += 1440;
  let t = nowMin;
  if (start - t > 720) t += 1440;
  if (t - start > 720) t -= 1440;
  const u = clamp01((t - (start + Math.max(0, delayMin))) / Math.max(1, end - start));
  const pose = alongPath(rail, u);

  let prev = leg.from.name;
  let next = leg.to.name;
  let stopIndex = 0;
  let dir: 0 | 1 = 0;
  if (line) {
    const ia = stopIndexByName(line, leg.from.name);
    const ib = stopIndexByName(line, leg.to.name);
    if (ia >= 0 && ib >= 0 && ia !== ib) {
      dir = ib > ia ? 0 : 1;
      const span = Math.abs(ib - ia);
      const k = Math.min(span, Math.floor(u * span));
      const sign = ib > ia ? 1 : -1;
      const cur = ia + k * sign;
      const nxt = ia + Math.min(span, k + 1) * sign;
      prev = line.stops[cur]?.n ?? prev;
      next = line.stops[nxt]?.n ?? next;
      stopIndex = nxt;
    }
  }
  if (u <= 0.02) {
    prev = leg.from.name;
    next = next || leg.to.name;
  }
  if (u >= 0.98) {
    prev = leg.to.name;
    next = leg.to.name;
  }

  const progress = line ? stopFrac(line, stopIndex) : u;
  return {
    id: `trip:${leg.lineId || leg.lineName || "ride"}:${leg.from.name}:${leg.departHhmm || ""}`,
    lineId: line?.id ?? leg.lineId ?? "",
    lineName: leg.lineName || line?.name || "",
    color: leg.color || line?.color || "#7ec8e3",
    kind: line?.kind ?? "jr",
    lng: pose.coord[0],
    lat: pose.coord[1],
    bearing: pose.bearing,
    dir,
    dest: leg.toward || leg.to.name,
    nextStop: next,
    prevStop: prev,
    delayMin: Math.max(0, delayMin),
    delaySec: Math.max(0, delayMin) * 60,
    progress,
    stopIndex,
  };
}
