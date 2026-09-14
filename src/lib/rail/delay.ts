import type { Journey, Train } from "./types";
import { railsMatch } from "./yahoo";

export function delayMinutes(delaySec: number) {
  if (!delaySec || delaySec <= 0) return 0;
  return Math.max(1, Math.round(delaySec / 60));
}

/** Prefer GTFS/Yahoo seconds; fall back to stored minutes. */
export function delaySeconds(train: { delayMin?: number; delaySec?: number } | null | undefined) {
  if (!train) return 0;
  const sec = train.delaySec && train.delaySec > 0 ? train.delaySec : 0;
  const fromMin = train.delayMin && train.delayMin > 0 ? train.delayMin * 60 : 0;
  return Math.round(Math.max(sec, fromMin));
}

export function liveDelayFor(
  live: Train[],
  lineId: string,
  dest?: string,
  lineName?: string,
) {
  let best = 0;
  const ln = (lineName || "").replace(/\s/g, "");
  for (const t of live) {
    if (t.kind === "flight" || t.kind === "bus") continue;
    const sameLine =
      (lineId && t.lineId === lineId) ||
      (ln && railsMatch(t.lineName, lineName || ln)) ||
      (ln && (t.lineName.replace(/\s/g, "").includes(ln) || ln.includes(t.lineName.replace(/\s/g, ""))));
    if (!sameLine) continue;
    best = Math.max(best, delaySeconds(t));
  }
  return delayMinutes(best);
}

export function liveDelayOnTrain(train: Train, live: Train[]) {
  return Math.max(train.delayMin || 0, liveDelayFor(live, train.lineId, train.dest));
}

export function liveDelaySeconds(train: Train | null | undefined, live: Train[]) {
  if (!train) return 0;
  let sec = delaySeconds(train);
  for (const t of live) {
    if (t.id === train.id) sec = Math.max(sec, delaySeconds(t));
  }
  return sec;
}

export function journeyDelaySeconds(journey: { delayMin?: number; delaySec?: number } | null | undefined) {
  if (!journey) return 0;
  const sec = journey.delaySec && journey.delaySec > 0 ? journey.delaySec : 0;
  const fromMin = journey.delayMin && journey.delayMin > 0 ? journey.delayMin * 60 : 0;
  return Math.round(Math.max(sec, fromMin));
}

export function journeyShowsDelay(journey: Journey | null | undefined) {
  if (!journey) return false;
  return journeyDelaySeconds(journey) > 0 || Boolean(journey.delayAlert);
}

export function stampJourneyDelay(journey: Journey, _live: Train[]): Journey {
  return journey;
}

export function withTrainDelay(journey: Journey, train: Train): Journey {
  const sec = Math.max(journeyDelaySeconds(journey), delaySeconds(train));
  if (sec <= 0 && !train.delayAlert && !journey.delayAlert) return journey;
  const delayMin = sec > 0 ? Math.max(journey.delayMin ?? 0, Math.max(1, Math.round(sec / 60))) : journey.delayMin;
  const delaySec = sec > 0 ? Math.max(journey.delaySec ?? 0, sec) : journey.delaySec;
  const delayAlert = Boolean(journey.delayAlert || train.delayAlert || sec > 0);
  if (delayMin === journey.delayMin && delaySec === journey.delaySec && delayAlert === Boolean(journey.delayAlert)) return journey;
  return { ...journey, delayMin, delaySec, delayAlert };
}
