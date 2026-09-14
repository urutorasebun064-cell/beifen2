import { liveToTrains, nearestOnPath, railDriftKm, type LivePayload } from "./live";
import { ingestLiveTracks, sampleLiveTracks, type LiveTrack } from "./track-lerp";
import { stampTrainsDia, type YahooDiaDelay } from "./yahoo";
import { pointAlong } from "./geo";
import { operationOf } from "@/data/jr-ops";
import type { LineRuntime, Train } from "./types";

const INTERVAL_MS = 20_000;
const TIMEOUT_MS = 10_000;
const PIN_TTL = 180_000;

let officialDia: YahooDiaDelay[] = [];
let pinned: { t: Train; at: number; progress: number } | null = null;

function coastPinned(lines: LineRuntime[]): Train | null {
  if (!pinned) return null;
  if (Date.now() - pinned.at > PIN_TTL) {
    pinned = null;
    return null;
  }
  const t = pinned.t;
  const line = lines.find((l) => l.id === t.lineId);
  if (!line || t.kind === "flight" || t.kind === "bus") return t;
  const elapsedH = (Date.now() - pinned.at) / 3_600_000;
  const speed = Math.max(80, operationOf(line).speed);
  const sign = t.dir === 1 && !line.loop ? -1 : 1;
  let p = pinned.progress + (sign * speed * elapsedH) / Math.max(1, line.totalKm);
  if (!line.loop) p = Math.max(0, Math.min(1, p));
  else p = ((p % 1) + 1) % 1;
  const pose = pointAlong(line.path, line.cum, line.totalKm, p);
  const bearing = t.dir === 1 && !line.loop ? (pose.bearing + 180) % 360 : pose.bearing;
  return {
    ...t,
    lng: pose.coord[0],
    lat: pose.coord[1],
    bearing,
    progress: p,
  };
}

export function getOfficialDia(): YahooDiaDelay[] {
  return officialDia;
}

export function getPinnedTrain(lines?: LineRuntime[]): Train | null {
  if (!pinned) return null;
  if (Date.now() - pinned.at > PIN_TTL) {
    pinned = null;
    return null;
  }
  if (lines?.length) return coastPinned(lines);
  return pinned.t;
}

export function clearPinnedTrain() {
  pinned = null;
}

export async function fetchLive(lines: LineRuntime[], odptKey = "", mode: "flights" | "all" = "flights"): Promise<{
  trains: Train[];
  source: "odpt" | "live" | "sim";
  error: string | null;
  dia: YahooDiaDelay[];
}> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const qs = mode === "flights" ? "?flights=1" : "";
    const res = await fetch(`/api/live${qs}`, {
      signal: ctrl.signal,
      headers: odptKey.trim() ? { "x-odpt-key": odptKey.trim() } : undefined,
    });
    const data = (await res.json()) as LivePayload;
    const dia = data.dia ?? [];
    officialDia = dia;
    const trains = stampTrainsDia(liveToTrains(lines, data.trains ?? []), dia).filter((t) =>
      mode === "flights" ? t.kind === "flight" : true,
    );
    if (!data.ok) {
      return { trains, source: "sim", error: data.error ?? "live", dia };
    }
    return {
      trains,
      source: data.source === "sim" ? "sim" : data.source,
      error: null,
      dia,
    };
  } catch {
    return { trains: [], source: "sim", error: "timeout", dia: officialDia };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function pinLivePosition(train: Train, lines: LineRuntime[], odptKey = ""): Promise<Train> {
  const fallback: Train = {
    ...train,
    gps: false,
    posStatus: train.delayMin > 0 || (train.delaySec ?? 0) > 0 ? "dia" : "timetable",
  };
  try {
    const qs = new URLSearchParams({
      pin: "1",
      line: train.lineName || train.lineId,
      from: train.prevStop || "",
      to: train.nextStop || "",
      dest: train.dest || "",
      lng: String(train.lng),
      lat: String(train.lat),
      dir: String(train.dir),
    });
    const res = await fetch(`/api/live?${qs}`, {
      signal: AbortSignal.timeout(9000),
      headers: odptKey.trim() ? { "x-odpt-key": odptKey.trim() } : undefined,
    });
    const data = (await res.json()) as LivePayload;
    if (data.dia?.length) officialDia = data.dia;
    const mapped = stampTrainsDia(liveToTrains(lines, data.trains ?? []), data.dia ?? []);
    const hit = mapped.find((t) => t.kind !== "flight" && t.kind !== "bus") ?? mapped[0];
    if (!hit || hit.kind === "flight") {
      pinned = { t: fallback, at: Date.now(), progress: train.progress };
      return fallback;
    }
    const line = lines.find((l) => l.id === train.lineId) ?? lines.find((l) => l.id === hit.lineId);
    let delayMin = Math.max(train.delayMin, hit.delayMin);
    let delaySec = Math.max(train.delaySec ?? 0, hit.delaySec ?? 0, delayMin * 60);
    let gps = hit.gps === true;
    let lng = hit.lng;
    let lat = hit.lat;
    let bearing = hit.bearing;
    let progress = train.progress;
    let liveLate = false;
    if (gps && line) {
      const km = railDriftKm(line, hit.lng, hit.lat);
      const max = train.kind === "shinkansen" ? 2.5 : 0.8;
      if (km > max) {
        gps = false;
        lng = train.lng;
        lat = train.lat;
        bearing = train.bearing;
        progress = train.progress;
      } else {
        const snap = nearestOnPath(line, hit.lng, hit.lat);
        progress = snap.t;
        lng = snap.coord[0];
        lat = snap.coord[1];
        bearing = train.dir === 1 && !line.loop ? (snap.bearing + 180) % 360 : snap.bearing;
        if (delayMin <= 0 && (train.delaySec ?? 0) <= 0 && !train.delayAlert && !hit.delayAlert) {
          const simKm = nearestOnPath(line, train.lng, train.lat).km;
          const lagKm = train.dir === 1 ? snap.km - simKm : simKm - snap.km;
          if (lagKm > 0.7) liveLate = true;
          const kmPerMin = train.kind === "shinkansen" ? 3.2 : 0.7;
          const lagMin = lagKm / kmPerMin;
          if (lagMin >= 3) {
            liveLate = true;
            delayMin = Math.max(delayMin, Math.round(lagMin));
            delaySec = Math.max(delaySec, Math.round(lagMin * 60));
          }
        }
      }
    }
    const next: Train = {
      ...train,
      lng,
      lat,
      bearing,
      progress,
      delayMin,
      delaySec,
      delayAlert: Boolean(train.delayAlert || hit.delayAlert || delayMin > 0),
      gps,
      liveLate,
      posStatus: gps ? "live" : delayMin > 0 ? "dia" : "timetable",
      dest: hit.dest || train.dest,
      etaMin: hit.etaMin ?? train.etaMin,
    };
    pinned = { t: next, at: Date.now(), progress };
    return next;
  } catch {
    pinned = { t: fallback, at: Date.now(), progress: train.progress };
    return fallback;
  }
}

export function startLivePoll(
  getLines: () => LineRuntime[],
  getKey: () => string,
  onTick: (next: { trains: Train[]; source: "odpt" | "live" | "sim"; error: string | null; stale: boolean }) => void,
) {
  let cancelled = false;
  let lastGood: Train[] = [];
  const pull = async () => {
    const lines = getLines();
    if (cancelled) return;
    const result = await fetchLive(lines, getKey(), "flights");
    if (cancelled) return;
    const flights = result.trains.filter((t) => t.kind === "flight");
    if (flights.length) {
      lastGood = flights;
      onTick({ trains: flights, source: result.source, error: result.error, stale: false });
      return;
    }
    onTick({
      trains: lastGood,
      source: lastGood.length ? result.source : "sim",
      error: result.error,
      stale: true,
    });
  };
  void pull();
  const id = window.setInterval(pull, INTERVAL_MS);
  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

/** @deprecated geographic lerp — use smoothLiveOnTrack */
export function smoothLive(prev: Map<string, Train>, next: Train[], alpha = 0.28): Train[] {
  const seen = new Set<string>();
  const out: Train[] = [];
  for (const t of next) {
    seen.add(t.id);
    const last = prev.get(t.id);
    if (!last) {
      prev.set(t.id, t);
      out.push(t);
      continue;
    }
    const mixed: Train = {
      ...t,
      lng: last.lng + (t.lng - last.lng) * alpha,
      lat: last.lat + (t.lat - last.lat) * alpha,
      bearing: lerpAngle(last.bearing, t.bearing, alpha),
    };
    prev.set(t.id, mixed);
    out.push(mixed);
  }
  for (const [id, t] of prev) {
    if (!seen.has(id)) prev.delete(id);
    void t;
  }
  return out;
}

export function smoothLiveOnTrack(
  tracks: Map<string, LiveTrack>,
  snapshot: Train[] | null,
  lines: LineRuntime[],
  now: number,
): Train[] {
  if (snapshot) ingestLiveTracks(tracks, snapshot, now);
  return sampleLiveTracks(tracks, lines, now);
}