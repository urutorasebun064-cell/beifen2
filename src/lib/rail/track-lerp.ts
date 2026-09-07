import { pointAlong } from "./geo";
import type { LineRuntime, Train } from "./types";

export type LiveTrack = {
  train: Train;
  lineId: string | null;
  progress: number;
  fromProgress: number;
  toProgress: number;
  fromLng: number;
  fromLat: number;
  toLng: number;
  toLat: number;
  fromBearing: number;
  toBearing: number;
  startAt: number;
  endAt: number;
  arrUnix?: number;
  status?: number;
  delaySec?: number;
  snapAt?: number;
};

const HORIZON_MS = 10_000;
const SNAP_KM = 40;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function kmJump(a: Train, b: Train) {
  return Math.hypot((a.lng - b.lng) * 91, (a.lat - b.lat) * 111);
}

/** Retarget tracks from a fresh live snapshot; tween between polls. */
export function ingestLiveTracks(
  tracks: Map<string, LiveTrack>,
  trains: Train[],
  now: number,
  horizonMs = HORIZON_MS,
) {
  const seen = new Set<string>();
  for (const t of trains) {
    seen.add(t.id);
    const prev = tracks.get(t.id);
    const jump = prev ? kmJump(prev.train, t) : 0;
    const snap = !prev || jump > SNAP_KM;
    const hold = jump > 6 && jump <= SNAP_KM ? 4000 : horizonMs;
    tracks.set(t.id, {
      train: t,
      lineId: t.kind === "flight" ? null : t.lineId,
      progress: t.progress,
      fromProgress: snap ? t.progress : prev!.progress,
      toProgress: t.progress,
      fromLng: snap ? t.lng : prev!.train.lng,
      fromLat: snap ? t.lat : prev!.train.lat,
      toLng: t.lng,
      toLat: t.lat,
      fromBearing: snap ? t.bearing : prev!.train.bearing,
      toBearing: t.bearing,
      startAt: now,
      endAt: now + hold,
      arrUnix: t.arrUnix,
      status: t.gtfsStatus,
      delaySec: t.delaySec ?? (t.delayMin > 0 ? t.delayMin * 60 : 0),
      snapAt: now,
    });
  }
  for (const id of [...tracks.keys()]) {
    if (!seen.has(id)) tracks.delete(id);
  }
}

/** Sample: lerp toward the last live snapshot so motion stays smooth between 10s polls. */
export function sampleLiveTracks(
  tracks: Map<string, LiveTrack>,
  lines: LineRuntime[],
  now: number,
): Train[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const out: Train[] = [];
  for (const tr of tracks.values()) {
    const span = Math.max(1, tr.endAt - tr.startAt);
    const e = Math.max(0, Math.min(1, (now - tr.startAt) / span));
    const line = tr.lineId ? byId.get(tr.lineId) : undefined;
    if (line && tr.train.kind !== "flight" && tr.train.kind !== "bus") {
      let p = lerp(tr.fromProgress, tr.toProgress, e);
      if (tr.train.kind === "shinkansen" && !tr.train.gps && Math.abs(tr.toProgress - tr.fromProgress) < 1e-6) {
        const sign = tr.train.dir === 1 && !line.loop ? -1 : 1;
        const km = (0.055 * (now - tr.startAt)) / 1000;
        p = tr.toProgress + (sign * km) / Math.max(1, line.totalKm);
        if (!line.loop) p = Math.max(0, Math.min(1, p));
        else p = ((p % 1) + 1) % 1;
      }
      const pose = pointAlong(line.path, line.cum, line.totalKm, p);
      const bearing =
        tr.train.dir === 1 && !line.loop ? (pose.bearing + 180) % 360 : pose.bearing;
      const next: Train = {
        ...tr.train,
        lng: pose.coord[0],
        lat: pose.coord[1],
        bearing,
        progress: p,
      };
      tr.progress = p;
      tr.train = next;
      out.push(next);
      continue;
    }
    const next: Train = {
      ...tr.train,
      lng: lerp(tr.fromLng, tr.toLng, e),
      lat: lerp(tr.fromLat, tr.toLat, e),
      bearing: lerpAngle(tr.fromBearing, tr.toBearing, e),
    };
    tr.train = next;
    out.push(next);
  }
  return out;
}