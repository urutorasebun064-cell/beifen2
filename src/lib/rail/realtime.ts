import { liveToTrains, type LivePayload } from "./live";
import { ingestLiveTracks, sampleLiveTracks, type LiveTrack } from "./track-lerp";
import { stampTrainsDia } from "./yahoo";
import type { LineRuntime, Train } from "./types";

const INTERVAL_MS = 10_000;
const TIMEOUT_MS = 10_000;

export async function fetchLive(lines: LineRuntime[], odptKey = ""): Promise<{
  trains: Train[];
  source: "odpt" | "live" | "sim";
  error: string | null;
}> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/live", {
      signal: ctrl.signal,
      headers: odptKey.trim() ? { "x-odpt-key": odptKey.trim() } : undefined,
    });
    const data = (await res.json()) as LivePayload;
    const trains = stampTrainsDia(liveToTrains(lines, data.trains ?? []), data.dia ?? []);
    if (!data.ok) {
      return { trains, source: "sim", error: data.error ?? "live" };
    }
    return {
      trains,
      source: data.source === "sim" ? "sim" : data.source,
      error: null,
    };
  } catch {
    return { trains: [], source: "sim", error: "timeout" };
  } finally {
    window.clearTimeout(timer);
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
    if (!lines.length || cancelled) return;
    const result = await fetchLive(lines, getKey());
    if (cancelled) return;
    if (result.trains.length) {
      lastGood = result.trains;
      onTick({ ...result, stale: false });
      return;
    }
    onTick({ trains: lastGood, source: lastGood.length ? result.source : "sim", error: result.error, stale: true });
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
