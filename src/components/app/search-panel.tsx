import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, MapPin, Search, X } from "lucide-react";
import { copies, displayName } from "@/lib/i18n";
import { tokyoParts, toHhmm, arriveHhmmOf, NODA, isInJapan, haversine, stationsNearPlace, walkMinutes } from "@/lib/rail/geo";
import { liveDelayFor, stampJourneyDelay } from "@/lib/rail/delay";
import { railsMatch } from "@/lib/rail/yahoo";
import { planJourney, stationKey, ensureConnections } from "@/lib/rail/route";
import { departuresAt } from "@/lib/rail/schedule";
import { FIRST_MIN, isNightService, lineSlots, minutesUntilDepart, stopFrac } from "@/lib/rail/simulate";
import { snapToRoad, onRoads } from "@/lib/roads";
import { lockJourneyTrain } from "@/components/app/route-panel";
import { attachTrack, locateStation, resolveStationQuery } from "@/lib/rail/graph";
import type { Journey, LineRuntime, RouteLeg, RouteStop, StationHit, Train } from "@/lib/rail/types";
import type { Stay } from "@/data/stays";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore, simNow } from "@/store/map-store";

function pinJourneyDest(j: Journey, dest: StationHit): Journey {
  const d = { name: dest.name, lng: dest.lng, lat: dest.lat, prefecture: dest.prefecture };
  const dn = dest.name.replace(/駅$/u, "");
  const legs = j.legs.map((leg, i, arr) => {
    if (i !== arr.length - 1) return leg;
    const tn = (leg.to.name || "").replace(/駅$/u, "");
    if (tn && tn !== dn && !dn.startsWith(tn) && !tn.startsWith(dn)) return leg;
    return { ...leg, to: { ...leg.to, ...d } };
  });
  return { ...j, dest: d, origin: j.origin, legs };
}

function journeyEndsNear(j: Journey, dest: StationHit, km = 40) {
  const end = j.legs[j.legs.length - 1]?.to ?? j.dest;
  if (!end) return false;
  return haversine([end.lng, end.lat], [dest.lng, dest.lat]) < km;
}

function pushJourney(list: Journey[], seen: Set<string>, j: Journey | null | undefined) {
  if (!j) return;
  const store = useMapStore.getState();
  const track = attachTrack(j, store.lines, store.stationIndex);
  const official = j.source === "yahoo" || j.source === "google";
  let lined = official ? track : ensureConnections(track, store.stationIndex);
  const ride = lined.legs.find((l) => l.kind === "ride");
  if (ride?.lineId || ride?.lineName) lined = stampJourneyDelay(lined, store.liveTrains);
  const id = `${lined.source ?? "local"}|${lined.departHhmm}|${lined.arriveHhmm}|${lined.transfers}|${lined.legs.map((l) => l.lineName ?? l.kind).join(",")}`;
  if (seen.has(id)) return;
  seen.add(id);
  list.push(lined);
}

function routeShape(j: Journey) {
  return j.legs.map((l) => `${l.kind}:${l.lineName ?? ""}:${l.from.name}:${l.to.name}`).join("|");
}

function preferOfficial(list: Journey[]) {
  const official = list.filter((j) => j.source === "yahoo" || j.source === "google");
  if (!official.length) {
    sortJourneys(list);
    return list;
  }
  const keys = new Set(official.map(routeShape));
  const extra = list.filter((j) => j.source !== "yahoo" && j.source !== "google" && !keys.has(routeShape(j)));
  sortJourneys(official);
  sortJourneys(extra);
  return official.concat(extra);
}

function sortJourneys(list: Journey[]) {
  const nowMin = tokyoParts(simNow()).minutes;
  list.sort((a, b) => {
    const aa = departDue(a.arriveHhmm, nowMin);
    const bb = departDue(b.arriveHhmm, nowMin);
    if (aa !== bb) return aa - bb;
    if (a.totalMinutes !== b.totalMinutes) return a.totalMinutes - b.totalMinutes;
    const da = departDue(a.departHhmm, nowMin) + (a.delayMin ?? 0);
    const db = departDue(b.departHhmm, nowMin) + (b.delayMin ?? 0);
    return da - db;
  });
}

function liveDelay(lineId: string, dest: string) {
  return liveDelayFor(useMapStore.getState().liveTrains, lineId, dest);
}

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function shiftHhmm(hhmm: string | undefined, delta: number) {
  if (!hhmm) return hhmm;
  return toHhmm(minutesOf(hhmm) + delta);
}

function shiftJourney(j: Journey, delta: number): Journey {
  const departHhmm = shiftHhmm(j.departHhmm, delta) ?? j.departHhmm;
  const arriveHhmm = shiftHhmm(j.arriveHhmm, delta) ?? j.arriveHhmm;
  let dur = minutesOf(arriveHhmm) - minutesOf(departHhmm);
  if (dur < 0) dur += 24 * 60;
  return {
    ...j,
    departHhmm,
    arriveHhmm,
    totalMinutes: Math.max(1, dur),
    legs: j.legs.map((leg) => ({
      ...leg,
      departHhmm: shiftHhmm(leg.departHhmm, delta),
      arriveHhmm: shiftHhmm(leg.arriveHhmm, delta),
    })),
  };
}

function isLastDepart(hhmm: string) {
  const h = Number(hhmm.split(":")[0]);
  return h >= 22 || h < 3;
}

function appendLastTrains(shown: Journey[], last: Journey[], nowMin: number) {
  const due = (j: Journey) => departDue(j.departHhmm, nowMin) + (j.delayMin ?? 0);
  const tail = last.filter((j) => due(j) >= 0 && isLastDepart(j.departHhmm));
  sortJourneys(tail);
  const lastIds = new Set(tail.map((j) => `${j.departHhmm}|${routeShape(j)}`));
  const head = shown.filter((j) => !lastIds.has(`${j.departHhmm}|${routeShape(j)}`));
  const out = head.slice();
  const seen = new Set(out.map((j) => `${j.departHhmm}|${routeShape(j)}`));
  for (const j of tail) {
    const id = `${j.departHhmm}|${routeShape(j)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(j);
  }
  return out;
}

function afterLastTrain(minutes: number) {
  return isNightService(minutes);
}

function lastTrainWindow(nowMin: number) {
  return nowMin >= 21 * 60 || nowMin < 70;
}

function firstTrainWindow(nowMin: number) {
  return nowMin >= 21 * 60 || nowMin < FIRST_MIN;
}

function departDue(hhmm: string, nowMin: number) {
  return minutesUntilDepart(hhmm, nowMin);
}

function journeyLive(j: Journey, nowMin: number) {
  const delay = Math.max(0, j.delayMin ?? 0);
  const dep = departDue(j.departHhmm, nowMin) + delay;
  if (dep < 0) return false;
  const horizon = firstTrainWindow(nowMin) ? 12 * 60 : 180;
  if (dep > horizon) return false;
  return true;
}

function localJourneys(origin: StationHit | { lng: number; lat: number }, dest: StationHit) {
  const { lines, stationIndex } = useMapStore.getState();
  const out: Journey[] = [];
  const seen = new Set<string>();
  const now = simNow();
  const nowMin = tokyoParts(now).minutes;
  const night = afterLastTrain(nowMin);
  const late = firstTrainWindow(nowMin);
  const toMorning = nowMin >= FIRST_MIN ? 1440 - nowMin + FIRST_MIN : FIRST_MIN - nowMin;
  const queryAt = late ? new Date(now.getTime() + toMorning * 60_000) : now;
  const template = planJourney(lines, stationIndex, origin, dest, late ? queryAt : now, night || late ? -0.2 : -20);
  if (template) {
    const ride = template.legs.find((l) => l.kind === "ride");
    const fromHit =
      (ride ? stationIndex.get(stationKey(ride.from)) : undefined) ??
      ("name" in origin ? origin : null);
    const deps = fromHit ? departuresAt(fromHit, late ? queryAt : now, late ? 6 : 14) : [];
    const lined = ride?.lineId ? deps.filter((d) => d.lineId === ride.lineId) : deps;
    const use = (lined.length ? lined : deps).filter((d) => !d.trainId.startsWith("fly:"));
    const baseWait = minutesOf(template.departHhmm) - tokyoParts(late ? queryAt : now).minutes;
    const wrap = (d: number) => (d < -720 ? d + 1440 : d > 720 ? d - 1440 : d);
    for (const d of use) {
      if (!late && d.minutesUntil > 180) continue;
      const due = d.minutesUntil + Math.max(0, d.delayMin);
      if (due < 0) continue;
      const shifted = shiftJourney(template, wrap(d.minutesUntil - baseWait));
      shifted.delayMin = Math.max(d.delayMin, liveDelay(d.lineId, d.dest));
      pushJourney(out, seen, shifted);
    }
  }
  if (out.length < (late ? 3 : 4)) {
    const base = (late ? queryAt : now).getTime();
    const steps = late ? [0, 8, 16, 24, 36, 50] : [0, 10, 20, 35, 55, 80];
    for (const add of steps) {
      pushJourney(out, seen, planJourney(lines, stationIndex, origin, dest, new Date(base + add * 60_000), -0.2));
    }
  }
  sortJourneys(out);
  const list = out.filter((j) => journeyLive(j, nowMin));
  return { list: late ? list.slice(0, 6) : list, seen };
}

function stopOf(s: { n?: string; name?: string; lng: number; lat: number; pf?: string; prefecture?: string }): RouteStop {
  return { name: s.name ?? s.n ?? "", lng: s.lng, lat: s.lat, prefecture: s.prefecture ?? s.pf ?? "" };
}

function liveJourneys(origin: StationHit | { lng: number; lat: number }, dest: StationHit): Journey[] {
  const store = useMapStore.getState();
  const origins: StationHit[] =
    "name" in origin
      ? [origin]
      : stationsNearPlace(store.stationIndex, origin.lng, origin.lat, 6)
          .filter((r) => r.km <= 3.2)
          .map((r) => r.station as StationHit);
  if (!origins.length) return [];
  const now = simNow();
  const nowMin = tokyoParts(now).minutes;
  const weekday = tokyoParts(now).weekday;
  const out: Journey[] = [];
  const seen = new Set<string>();
  for (const t of store.liveTrains) {
    if (t.kind === "bus" || t.kind === "flight") continue;
    const line = store.lines.find((l) => l.id === t.lineId);
    if (!line || line.stops.length < 2) continue;
    const iTo = line.stops.findIndex((s) => s.n === dest.name);
    if (iTo < 0) continue;
    const iFrom = origins
      .map((o) => line.stops.findIndex((s) => s.n === o.name))
      .find((i) => i >= 0);
    if (iFrom == null || iFrom < 0 || iFrom === iTo) continue;
    const south = iTo > iFrom;
    if (!line.loop) {
      if (t.dir === 0 && !south) continue;
      if (t.dir === 1 && south) continue;
    }
    const p = t.progress ?? 0;
    const fFrom = stopFrac(line, iFrom);
    const fTo = stopFrac(line, iTo);
    const toward = t.dir === 1 && !line.loop ? p - fTo : fTo - p;
    if (toward < -0.008) continue;
    const fromSpan = t.dir === 1 && !line.loop ? p - fFrom : fFrom - p;
    const passedOrigin = fromSpan <= 0.01;
    const { oneWayMin } = lineSlots(line, nowMin, weekday);
    const etaTo = Math.max(0.4, toward * oneWayMin);
    const wait = passedOrigin ? 0 : Math.max(0, fromSpan * oneWayMin);
    const fromStop = line.stops[iFrom]!;
    const toStop = line.stops[iTo]!;
    const rideMin = Math.max(1, Math.round(etaTo - wait));
    const j: Journey = {
      origin: stopOf(fromStop),
      dest: stopOf(toStop),
      legs: [
        {
          kind: "ride",
          lineId: line.id,
          lineName: line.name,
          color: line.color,
          toward: t.dest,
          from: stopOf(fromStop),
          to: stopOf(toStop),
          stops: [],
          minutes: rideMin,
          departHhmm: toHhmm(nowMin + wait),
          arriveHhmm: toHhmm(nowMin + etaTo),
        },
      ],
      totalMinutes: rideMin,
      transfers: 0,
      departHhmm: toHhmm(nowMin + wait),
      arriveHhmm: toHhmm(nowMin + etaTo),
      source: "local",
      delayMin: t.delayMin,
      delaySec: t.delaySec,
      delayAlert: t.delayAlert,
    };
    pushJourney(out, seen, j);
  }
  return out;
}

export async function applyTrip(origin: StationHit | { lng: number; lat: number }, dest: StationHit, opts?: { silent?: boolean; skipCamera?: boolean }) {
  if ("name" in origin && stationKey(origin) === stationKey(dest)) {
    useMapStore.getState().setDest(dest);
    useMapStore.getState().setJourneys([]);
    return;
  }
  const silent = Boolean(opts?.silent);
  useMapStore.getState().setDest(dest);
  if (!silent) {
    useMapStore.getState().setSearching(true);
    useMapStore.getState().setSheetOpen(true);
  }

  const oName =
    "name" in origin && origin.name
      ? origin.name
      : stationsNearPlace(useMapStore.getState().stationIndex, origin.lng, origin.lat, 1)[0]?.station.name ?? "";
  const nowMin = tokyoParts(simNow()).minutes;
  const night = afterLastTrain(nowMin);
  const time = tokyoClockParams();
  const journeys: Journey[] = [];
  const lastTrains: Journey[] = [];
  const firstTrains: Journey[] = [];
  const seen = new Set<string>();
  const jobs: Promise<void>[] = [];
  const ingest = (data: { ok?: boolean; journey?: Journey; journeys?: Journey[] }, into: Journey[], unique = false) => {
    if (data.ok === false) return;
    const list = data.journeys?.length ? data.journeys : data.journey ? [data.journey] : [];
    for (const j of list) {
      if (!j) continue;
      const pinned = pinJourneyDest(j, dest);
      if (unique) pushJourney(into, seen, pinned);
      else into.push(pinned);
    }
  };
  if (oName) {
    const qs = new URLSearchParams({
      from: oName,
      to: dest.name,
      olat: String(origin.lat),
      olng: String(origin.lng),
      dlat: String(dest.lat),
      dlng: String(dest.lng),
      opf: "prefecture" in origin ? origin.prefecture ?? "" : "",
      dpf: dest.prefecture ?? "",
      hh: String(time.hour),
      mm: String(time.minute),
      type: "1",
    });
    jobs.push(
      fetch(`/api/transit?${qs}`, { signal: AbortSignal.timeout(14000) })
        .then((res) => res.json() as Promise<{ ok?: boolean; journey?: Journey; journeys?: Journey[] }>)
        .then((data) => ingest(data, journeys, true))
        .catch(() => undefined),
    );
    if (lastTrainWindow(nowMin)) {
      const lastQs = new URLSearchParams(qs);
      lastQs.set("type", "4");
      jobs.push(
        fetch(`/api/transit?${lastQs}`, { signal: AbortSignal.timeout(14000) })
          .then((res) => res.json() as Promise<{ ok?: boolean; journey?: Journey; journeys?: Journey[] }>)
          .then((data) => ingest(data, lastTrains))
          .catch(() => undefined),
      );
    }
    if (firstTrainWindow(nowMin)) {
      const firstQs = new URLSearchParams(qs);
      firstQs.set("type", "3");
      firstQs.set("hh", "4");
      firstQs.set("mm", "50");
      jobs.push(
        fetch(`/api/transit?${firstQs}`, { signal: AbortSignal.timeout(14000) })
          .then((res) => res.json() as Promise<{ ok?: boolean; journey?: Journey; journeys?: Journey[] }>)
          .then((data) => ingest(data, firstTrains))
          .catch(() => undefined),
      );
      const mornQs = new URLSearchParams(qs);
      mornQs.set("type", "1");
      mornQs.set("hh", "4");
      mornQs.set("mm", "50");
      jobs.push(
        fetch(`/api/transit?${mornQs}`, { signal: AbortSignal.timeout(14000) })
          .then((res) => res.json() as Promise<{ ok?: boolean; journey?: Journey; journeys?: Journey[] }>)
          .then((data) => ingest(data, firstTrains))
          .catch(() => undefined),
      );
    }
  }
  {
    const { googleKey, lang } = useMapStore.getState();
    const key = googleKey.trim();
    const params = new URLSearchParams({
      olat: String(origin.lat),
      olng: String(origin.lng),
      dlat: String(dest.lat),
      dlng: String(dest.lng),
      oname: oName,
      dname: dest.name,
      lang,
    });
    if (night) params.set("at", String(Math.floor(simNow().getTime() / 1000)));
    jobs.push(
      fetch(`/api/google?${params}`, {
        ...(key ? { headers: { "x-google-key": key } } : {}),
        signal: AbortSignal.timeout(5000),
      })
        .then((res) => res.json() as Promise<{ ok?: boolean; journey?: Journey; journeys?: Journey[] }>)
        .then((data) => {
          if (data.ok === false) return;
          if (data.journeys?.length) data.journeys.forEach((j) => pushJourney(journeys, seen, pinJourneyDest(j, dest)));
          else if (data.journey) pushJourney(journeys, seen, pinJourneyDest(data.journey, dest));
        })
        .catch(() => undefined),
    );
  }
  try {
    await Promise.all(jobs);
  } finally {
    const nowMin = tokyoParts(simNow()).minutes;
    const usable = (j: Journey) => journeyLive(j, nowMin) && journeyEndsNear(j, dest);
    const yahoo = journeys.filter((j) => j.source === "yahoo" && usable(j));
    const google = journeys.filter((j) => j.source === "google" && usable(j));
    const firsts = firstTrains.filter(usable);
    let live: Journey[] = [];
    if (yahoo.length) live = preferOfficial(yahoo);
    else if (google.length) live = preferOfficial(google);
    if (!live.length && firsts.length) live = preferOfficial(firsts);
    if (!live.length) {
      const local = localJourneys(origin, dest);
      for (const j of liveJourneys(origin, dest)) pushJourney(local.list, local.seen, j);
      live = preferOfficial(local.list).filter(usable);
    }
    const store = useMapStore.getState();
    if (!live.length) {
      store.setJourneys([]);
      if (!silent) store.setSearching(false);
      return;
    }
    const tonight = lastTrainWindow(nowMin) && live.some((j) => departDue(j.departHhmm, nowMin) < 180);
    const merged = tonight
      ? appendLastTrains(live.slice(0, 10), lastTrains.filter(usable), nowMin)
      : live.slice(0, 10);
    const shown = merged.map((j) => stampJourneyDelay(j, store.liveTrains)).filter((j) => journeyLive(j, nowMin));
    if (!shown.length) {
      store.setJourneys([]);
      if (!silent) store.setSearching(false);
      return;
    }
    if (silent) {
      const cur = store.journey;
      const idx = cur
        ? shown.findIndex((j) => j.departHhmm === cur.departHhmm && routeShape(j) === routeShape(cur))
        : -1;
      if (idx >= 0) store.setJourneys(shown, idx);
      void calibrateCorridor(shown);
      return;
    }
    store.setJourneys(shown, 0);
    store.setSearching(false);
    if (shown[0]) lockJourneyTrain(shown[0], { camera: !silent });
    void calibrateCorridor(shown);
  }
}

const calibrating = new Set<string>();
const CAL_TTL = 180_000;
const calibrated = new Map<string, { t: Train; at: number }>();

function calKey(t: Train) {
  return `${t.lineId}:${t.dir}:${t.nextStop}:${t.prevStop}`;
}

export function rememberCalibrated(t: Train) {
  const rec = { t, at: Date.now() };
  calibrated.set(t.id, rec);
  calibrated.set(calKey(t), rec);
}

export function mergeCalibratedLive(live: Train[]): Train[] {
  const now = Date.now();
  for (const [k, v] of calibrated) {
    if (now - v.at > CAL_TTL) calibrated.delete(k);
  }
  return live.map((t) => {
    const hit = calibrated.get(t.id) ?? calibrated.get(calKey(t));
    if (!hit) return t;
    const c = hit.t;
    return {
      ...t,
      delayMin: Math.max(t.delayMin, c.delayMin),
      delaySec: Math.max(t.delaySec ?? 0, c.delaySec ?? 0, Math.max(t.delayMin, c.delayMin) * 60),
      delayAlert: Boolean(t.delayAlert || c.delayAlert),
      etaMin: t.kind === "shinkansen" ? t.etaMin : (t.etaMin ?? c.etaMin),
      nextStop: c.nextStop || t.nextStop,
      prevStop: c.prevStop || t.prevStop,
      dest: c.dest || t.dest,
      fromPlatform: c.fromPlatform ?? t.fromPlatform,
      toPlatform: c.toPlatform ?? t.toPlatform,
      boardHhmm: c.boardHhmm ?? t.boardHhmm,
      alightHhmm: t.kind === "shinkansen" ? t.alightHhmm : (c.alightHhmm ?? t.alightHhmm),
    };
  });
}

async function calibrateLineMates(seed: Train) {
  const s = useMapStore.getState();
  const delaySec = Math.max(seed.delaySec ?? 0, seed.delayMin * 60);
  const next = s.liveTrains.map((t) => {
    if (t.kind === "flight" || t.kind === "bus" || t.lineId !== seed.lineId) return t;
    const patched = {
      ...t,
      delayMin: Math.max(t.delayMin, seed.delayMin),
      delaySec: Math.max(t.delaySec ?? 0, delaySec),
    };
    rememberCalibrated(patched);
    return patched;
  });
  s.setLive(next, s.liveSource, s.liveError);
  const mates = next.filter((t) => t.lineId === seed.lineId && t.id !== seed.id && t.kind !== "flight" && t.kind !== "bus").slice(0, 8);
  await Promise.all(mates.map((t) => calibrateTrain(t, { silent: true })));
}

export async function calibrateTrain(train: Train, opts?: { silent?: boolean }) {
  if (train.kind === "flight" || train.kind === "bus") return;
  if (calibrating.has(train.id)) return;
  const store = useMapStore.getState();
  const nextNameKeep = train.nextStop;
  const prevNameKeep = train.prevStop;
  const destNameKeep = train.dest;
  const fromName = prevNameKeep || nextNameKeep;
  const toName = nextNameKeep && nextNameKeep !== fromName ? nextNameKeep : destNameKeep;
  if (!fromName || !toName || fromName === toName) return;
  const fallback: RouteStop = { name: "", lng: train.lng, lat: train.lat, prefecture: "" };
  const from = locateStation(fromName, store.lines, store.stationIndex, { ...fallback, name: fromName });
  const to = locateStation(toName, store.lines, store.stationIndex, { ...fallback, name: toName });
  if (!from.name || !to.name) return;
  calibrating.add(train.id);
  try {
    const clock = tokyoClockParams();
    let qmin = clock.hour * 60 + clock.minute - 10;
    if (qmin < 0) qmin += 1440;
    const qs = new URLSearchParams({
      from: from.name,
      to: to.name,
      olat: String(from.lat || train.lat),
      olng: String(from.lng || train.lng),
      dlat: String(to.lat || train.lat),
      dlng: String(to.lng || train.lng),
      hh: String(Math.floor(qmin / 60) % 24),
      mm: String(qmin % 60),
      type: "1",
    });
    const data = (await fetch(`/api/transit?${qs}`, { signal: AbortSignal.timeout(14000) }).then((res) => res.json())) as {
      ok?: boolean;
      journey?: Journey;
      journeys?: Journey[];
    };
    if (!data.ok) return;
    const list = data.journeys?.length ? data.journeys : data.journey ? [data.journey] : [];
    const nowMin = tokyoParts(simNow()).minutes;
    const linedUp = list.map((j) => attachTrack(j, store.lines, store.stationIndex));
    const sameStop = (a: string, b: string) => {
      const x = a.replace(/駅$/u, "").trim();
      const y = b.replace(/駅$/u, "").trim();
      return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
    };
    const minOf = (s?: string) => {
      const m = s?.match(/(\d{1,2}):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const wrapDiff = (a: number, b: number) => {
      let d = a - b;
      if (d > 720) d -= 1440;
      if (d < -720) d += 1440;
      return d;
    };
    const liveArr =
      minOf(arriveHhmmOf(train, simNow())) ?? nowMin + Math.max(0, train.etaMin ?? 1);
    const win = train.kind === "shinkansen" ? 4.5 : 2.5;
    const rideOf = (j: Journey) =>
      j.legs.find(
        (l) =>
          l.kind === "ride" &&
          sameStop(l.to.name, nextNameKeep) &&
          (!l.lineName ||
            railsMatch(l.lineName, train.lineName) ||
            train.lineName.includes(l.lineName) ||
            l.lineName.includes(train.lineName.replace(/^JR/u, ""))),
      ) ??
      j.legs.find((l) => l.kind === "ride" && sameStop(l.to.name, nextNameKeep));
    const destOk = (ride: { toward?: string }) => {
      if (!ride.toward) return true;
      const a = ride.toward.replace(/行$/u, "");
      const b = destNameKeep.replace(/行$/u, "");
      return sameStop(a, b) || b.includes(a) || a.includes(b);
    };
    const close = linedUp
      .map((j) => {
        const ride = rideOf(j);
        const arr = minOf(ride?.arriveHhmm);
        if (!ride || arr == null) return null;
        if (!destOk(ride)) return null;
        const dep = minOf(ride.departHhmm);
        if (dep != null && wrapDiff(dep, nowMin) > 1.2) return null;
        const d = wrapDiff(arr, liveArr);
        if (train.kind === "shinkansen" && train.etaMin != null && ride.minutes) {
          if (ride.minutes > train.etaMin + 8 && d > 2) return null;
        }
        return { j, ride, d };
      })
      .filter((x): x is { j: Journey; ride: NonNullable<ReturnType<typeof rideOf>>; d: number } => Boolean(x))
      .filter((x) => x.d >= -1 && x.d <= win)
      .sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
    const lineDelaySec = linedUp.reduce((best, j) => {
      const ride = j.legs.find(
        (l) => l.kind === "ride" && l.lineName && railsMatch(l.lineName, train.lineName),
      );
      if (!ride && !j.delayAlert && !(j.delaySec || j.delayMin)) return best;
      if (!ride) return best;
      return Math.max(best, j.delaySec ?? 0, (j.delayMin ?? 0) * 60);
    }, 0);
    const hit = close[0];
    if (!hit && lineDelaySec <= 0 && train.delayMin <= 0 && !(train.delaySec && train.delaySec > 0)) return;
    const match = hit?.j;
    const ride = hit?.ride;
    const s = useMapStore.getState();
    const silent = Boolean(opts?.silent);
    if (!silent && s.selectedTrain?.id !== train.id) return;
    const cur = s.selectedTrain?.id === train.id ? s.selectedTrain : train;
    let eta = cur.etaMin;
    const planLocked = /^\d{1,2}:\d{2}$/.test(cur.alightHhmm ?? "");
    const simClock = planLocked ? cur.alightHhmm! : arriveHhmmOf(cur, simNow());
    let planHhmm = simClock;
    if (ride?.arriveHhmm) {
      const y = minOf(ride.arriveHhmm);
      const sMin = minOf(simClock);
      if (y != null && sMin != null) {
        if (Math.abs(wrapDiff(y, sMin)) <= 2) planHhmm = ride.arriveHhmm;
      } else if (!simClock) {
        planHhmm = ride.arriveHhmm;
      }
    }
    const yahooSec = Math.max(
      0,
      match?.delaySec ?? 0,
      (match?.delayMin ?? 0) * 60,
      lineDelaySec,
      cur.delaySec ?? 0,
      cur.delayMin * 60,
    );
    const yahooDelay = yahooSec > 0 ? Math.max(1, Math.round(yahooSec / 60)) : 0;
    const planMin = minOf(planHhmm);
    if (planMin != null) {
      let d = planMin - nowMin;
      if (d < -720) d += 1440;
      if (d > 1260) d -= 1440;
      eta = Math.max(0, d);
    }
    const next: Train = {
      ...cur,
      nextStop: nextNameKeep || cur.nextStop,
      prevStop: prevNameKeep || cur.prevStop,
      dest: destNameKeep || cur.dest,
      delayMin: Math.max(cur.delayMin, yahooDelay),
      delaySec: Math.max(cur.delaySec ?? 0, yahooSec, yahooDelay * 60, cur.delayMin * 60),
      delayAlert: Boolean(cur.delayAlert || match?.delayAlert || yahooSec > 0),
      etaMin: eta,
      fromPlatform: cur.fromPlatform ?? ride?.fromPlatform,
      toPlatform: cur.toPlatform ?? ride?.toPlatform,
      boardHhmm: cur.boardHhmm ?? ride?.departHhmm,
      alightHhmm: planHhmm || cur.alightHhmm,
    };
    rememberCalibrated(next);
    if (!silent || s.selectedTrain?.id === train.id) s.selectTrain(next);
    s.setLive(
      mergeCalibratedLive(
        s.liveTrains.map((t) =>
          t.id === train.id
            ? {
                ...t,
                delayMin: next.delayMin,
                delaySec: next.delaySec,
                delayAlert: next.delayAlert,
                fromPlatform: next.fromPlatform,
                toPlatform: next.toPlatform,
                boardHhmm: next.boardHhmm,
                ...(train.kind === "shinkansen"
                  ? {}
                  : { etaMin: next.etaMin, alightHhmm: next.alightHhmm }),
              }
            : t,
        ),
      ),
      s.liveSource,
      s.liveError,
    );
    if (!silent && next.kind !== "shinkansen") void calibrateLineMates(next);
  } catch {
    /* keep current */
  } finally {
    calibrating.delete(train.id);
  }
}

export function startTransitRefresh() {
  return () => {};
}

function corridorLineIds(journeys: Journey[], lines: LineRuntime[], index: Map<string, StationHit>) {
  const prefs = new Set<string>();
  const hubLines = new Set<string>();
  const all = new Set<string>();
  const addHit = (name: string, fallbackPf = "") => {
    const key = name.replace(/駅$/u, "");
    let hit: StationHit | undefined;
    for (const s of index.values()) {
      if (s.name === name || s.name === key) {
        hit = s;
        break;
      }
    }
    if (hit?.prefecture) prefs.add(hit.prefecture);
    else if (fallbackPf) prefs.add(fallbackPf);
    if (hit) for (const l of hit.lines) hubLines.add(l.id);
  };
  for (const j of journeys) {
    addHit(j.origin.name, j.origin.prefecture);
    addHit(j.dest.name, j.dest.prefecture);
    for (const leg of j.legs) {
      addHit(leg.from.name, leg.from.prefecture);
      addHit(leg.to.name, leg.to.prefecture);
      if (leg.lineId) {
        hubLines.add(leg.lineId);
        all.add(leg.lineId);
      }
    }
  }
  for (const l of lines) {
    if (l.stops.some((s) => prefs.has(s.pf))) all.add(l.id);
  }
  for (const id of hubLines) all.add(id);
  return { all, hub: hubLines };
}

async function calibrateCorridor(journeys: Journey[]) {
  if (!journeys.length) return;
  const s = useMapStore.getState();
  const { hub } = corridorLineIds(journeys, s.lines, s.stationIndex);
  if (!hub.size) return;
  const seen = new Set<string>();
  const probes: Train[] = [];
  for (const t of s.liveTrains) {
    if (t.kind === "flight" || t.kind === "bus" || !hub.has(t.lineId) || seen.has(t.lineId)) continue;
    seen.add(t.lineId);
    probes.push(t);
    if (probes.length >= 8) break;
  }
  await Promise.all(probes.map((t) => shadowDelay(t)));
}

async function shadowDelay(train: Train) {
  if (calibrating.has(train.id)) return;
  const store = useMapStore.getState();
  const fromName = train.prevStop || train.nextStop;
  const toName = train.dest || train.nextStop;
  if (!fromName || !toName || fromName === toName) return;
  const fallback: RouteStop = { name: "", lng: train.lng, lat: train.lat, prefecture: "" };
  const from = locateStation(fromName, store.lines, store.stationIndex, { ...fallback, name: fromName });
  const to = locateStation(toName, store.lines, store.stationIndex, { ...fallback, name: toName });
  if (!from.name || !to.name) return;
  calibrating.add(train.id);
  try {
    const time = tokyoClockParams();
    const qs = new URLSearchParams({
      from: from.name,
      to: to.name,
      olat: String(from.lat || train.lat),
      olng: String(from.lng || train.lng),
      dlat: String(to.lat || train.lat),
      dlng: String(to.lng || train.lng),
      hh: String(time.hour),
      mm: String(time.minute),
      type: "1",
    });
    const data = (await fetch(`/api/transit?${qs}`, { signal: AbortSignal.timeout(14000) }).then((res) => res.json())) as {
      ok?: boolean;
      journey?: Journey;
      journeys?: Journey[];
    };
    if (!data.ok) return;
    const list = data.journeys?.length ? data.journeys : data.journey ? [data.journey] : [];
    let delaySec = 0;
    let alert = false;
    for (const j of list) {
      delaySec = Math.max(delaySec, j.delaySec ?? 0, (j.delayMin ?? 0) * 60);
      alert = alert || Boolean(j.delayAlert);
    }
    if (delaySec <= 0 && !alert) return;
    const delay = delaySec > 0 ? Math.max(1, Math.round(delaySec / 60)) : 0;
    const s = useMapStore.getState();
    s.setLive(
      s.liveTrains.map((t) =>
        t.lineId === train.lineId || railsMatch(t.lineName, train.lineName)
          ? {
              ...t,
              delayMin: Math.max(t.delayMin, delay),
              delaySec: Math.max(t.delaySec ?? 0, delaySec),
              delayAlert: Boolean(t.delayAlert || alert || delaySec > 0),
            }
          : t,
      ),
      s.liveSource,
      s.liveError,
    );
  } catch {
    /* keep current */
  } finally {
    calibrating.delete(train.id);
  }
}

function walkLeg(from: RouteStop, to: RouteStop, minutes: number): RouteLeg {
  return {
    kind: "walk",
    from,
    to,
    stops: [from, to],
    minutes,
    path: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
  };
}

function addStayWalks(
  journey: Journey,
  originWalk?: { min: number; from: RouteStop; to: RouteStop },
  shopWalk?: { min: number; from: RouteStop; to: RouteStop },
): Journey {
  const legs = [...journey.legs];
  let extra = 0;
  let walkFromGpsMin = journey.walkFromGpsMin;
  let walkToDestMin = journey.walkToDestMin;
  if (originWalk && legs[0]?.kind !== "walk") {
    legs.unshift(walkLeg(originWalk.from, originWalk.to, originWalk.min));
    extra += originWalk.min;
    walkFromGpsMin = originWalk.min;
  } else if (legs[0]?.kind === "walk") {
    walkFromGpsMin = Math.max(1, Math.round(legs[0].minutes));
  }
  if (shopWalk && legs[legs.length - 1]?.to.name !== shopWalk.to.name) {
    legs.push(walkLeg(shopWalk.from, shopWalk.to, shopWalk.min));
    extra += shopWalk.min;
    walkToDestMin = shopWalk.min;
  }
  return { ...journey, legs, totalMinutes: journey.totalMinutes + extra, walkFromGpsMin, walkToDestMin };
}

export async function applyStayTrip(stay: Stay) {
  const s = useMapStore.getState();
  const loc = s.userLocation ?? NODA;
  const fromNear = stationsNearPlace(s.stationIndex, loc.lng, loc.lat, 1)[0];
  const toNear = stationsNearPlace(s.stationIndex, stay.lng, stay.lat, 1)[0];
  if (!fromNear || !toNear) return false;
  s.selectStay(stay);
  s.setStayLayer(true);
  s.setStayWalk(true);
  s.selectTrain(null);
  s.setFollowTrainId(null);
  s.setOrigin(fromNear.station);
  s.setDest(toNear.station);
  await applyTrip(fromNear.station, toNear.station);
  const gps: RouteStop = { name: "", lng: loc.lng, lat: loc.lat, prefecture: "" };
  const originStop: RouteStop = {
    name: fromNear.station.name,
    lng: fromNear.station.lng,
    lat: fromNear.station.lat,
    prefecture: fromNear.station.prefecture,
  };
  const destStop: RouteStop = {
    name: toNear.station.name,
    lng: toNear.station.lng,
    lat: toNear.station.lat,
    prefecture: toNear.station.prefecture,
  };
  const shopStop: RouteStop = { name: stay.name, lng: stay.lng, lat: stay.lat, prefecture: stay.regionJa };
  const originWalk =
    fromNear.km >= 0.08 ? { min: walkMinutes(fromNear.km), from: gps, to: originStop } : undefined;
  const shopKm = haversine([toNear.station.lng, toNear.station.lat], [stay.lng, stay.lat]);
  const shopWalk = shopKm >= 0.05 ? { min: walkMinutes(shopKm), from: destStop, to: shopStop } : undefined;
  const st = useMapStore.getState();
  const patched = st.journeys.length
    ? st.journeys.map((j) => addStayWalks(j, originWalk, shopWalk))
    : shopWalk
      ? [
          addStayWalks(
            {
              origin: originStop,
              dest: shopStop,
              legs: [],
              totalMinutes: 0,
              transfers: 0,
              departHhmm: "",
              arriveHhmm: "",
              source: "local",
            },
            originWalk,
            shopWalk,
          ),
        ]
      : [];
  if (patched.length) st.setJourneys(patched, Math.min(st.journeyIndex, patched.length - 1));
  return true;
}

function tokyoClockParams() {
  const vt = useMapStore.getState().viewTime;
  if (vt) {
    const [hh, mm] = vt.split(":").map(Number);
    if (Number.isFinite(hh) && Number.isFinite(mm)) return { hour: hh, minute: mm };
  }
  const p = tokyoParts(simNow());
  return { hour: p.hour, minute: p.minute };
}

function copyStation(hit: StationHit): StationHit {
  return {
    name: hit.name,
    lng: hit.lng,
    lat: hit.lat,
    prefecture: hit.prefecture,
    lines: hit.lines,
    keys: hit.keys,
  };
}

function hitFromEl(el: HTMLElement, rows: StationHit[]): StationHit | null {
  const lng = Number(el.dataset.lng);
  const lat = Number(el.dataset.lat);
  const name = el.dataset.name ?? "";
  const pf = el.dataset.pf ?? "";
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return (
    rows.find((h) => h.name === name && Math.abs(h.lng - lng) < 0.0005 && Math.abs(h.lat - lat) < 0.0005) ?? {
      name,
      lng,
      lat,
      prefecture: pf,
      lines: [],
    }
  );
}

export function fillPickedStation(hit: StationHit, field?: "from" | "to") {
  const s = useMapStore.getState();
  const which = field ?? s.pickField;
  if (which !== "from" && which !== "to") return false;
  const chosen = copyStation(hit);
  if (which === "from") s.setOrigin(chosen);
  else s.setDest(chosen);
  s.selectStation(chosen);
  s.setPickField(null);
  s.requestFlyTo({ lng: chosen.lng, lat: chosen.lat, zoom: 14.2, bearing: 0, pitch: 0.55, center: true });
  const after = useMapStore.getState();
  if (after.originStation && after.destStation) void applyTrip(after.originStation, after.destStation, { skipCamera: true });
  else void calibrateStation(chosen);
  return true;
}

function stationNameMatch(a: string, b: string) {
  const na = a.replace(/駅$/u, "");
  const nb = b.replace(/駅$/u, "");
  return na === nb || a === b;
}

export function calibrateStation(hit: StationHit) {
  const s = useMapStore.getState();
  const mates = s.liveTrains.filter(
    (t) =>
      t.kind !== "flight" &&
      t.kind !== "bus" &&
      (stationNameMatch(t.nextStop, hit.name) ||
        stationNameMatch(t.prevStop, hit.name) ||
        stationNameMatch(t.dest, hit.name)),
  );
  void Promise.all(mates.slice(0, 6).map((t) => calibrateTrain(t, { silent: true })));
}

function currentOrigin(): StationHit | { lng: number; lat: number } | null {
  const s = useMapStore.getState();
  if (s.originStation) return s.originStation;
  if (s.userLocation && s.locateStatus === "ok") return s.userLocation;
  return null;
}

function resolveStation(index: Map<string, StationHit>, text: string, fallback: StationHit | null) {
  const q = text.trim();
  if (!q) return fallback;
  if (fallback && stationTextMatch(fallback, q)) return fallback;
  const near = useMapStore.getState().userLocation;
  return resolveStationQuery(index, q, fallback, near).match ?? fallback;
}

function stationTextMatch(st: StationHit, text: string) {
  const q = text.trim().replace(/駅$/u, "");
  if (!q) return false;
  const name = st.name.replace(/駅$/u, "");
  if (name === q || st.name === text.trim()) return true;
  const lang = useMapStore.getState().lang;
  if (displayName(st.name, lang) === text.trim() || displayName(name, lang) === q) return true;
  return false;
}

function resolvePicked(
  index: Map<string, StationHit>,
  text: string,
  known: StationHit | null,
  selected: StationHit | null,
) {
  if (known && stationTextMatch(known, text) && Number.isFinite(known.lng)) return known;
  if (selected && stationTextMatch(selected, text) && Number.isFinite(selected.lng)) return selected;
  return resolveStation(index, text, known ?? selected);
}

export function SearchPanel() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const index = useMapStore((s) => s.stationIndex);
  const locateStatus = useMapStore((s) => s.locateStatus);
  const originStation = useMapStore((s) => s.originStation);
  const destStation = useMapStore((s) => s.destStation);
  const pickField = useMapStore((s) => s.pickField);
  const searching = useMapStore((s) => s.searching);
  const journeys = useMapStore((s) => s.journeys);
  const [focus, setFocus] = useState<"from" | "to" | null>(null);
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");

  useEffect(() => {
    if (originStation?.name) setFromText(displayName(originStation.name, lang));
  }, [originStation?.name, lang]);

  useEffect(() => {
    if (destStation?.name) setToText(displayName(destStation.name, lang));
  }, [destStation?.name, lang]);

  const q = focus === "from" ? fromText : focus === "to" ? toText : "";
  const showHits = Boolean(focus) && q.trim().length > 0;
  const resolved = showHits
    ? resolveStationQuery(index, q, null, useMapStore.getState().userLocation)
    : null;
  const hits = resolved?.suggestions ?? [];
  const hitsRef = useRef(hits);
  hitsRef.current = hits;

  const pick = (hit: StationHit) => {
    const field = useMapStore.getState().pickField ?? focus ?? "to";
    if (field !== "from" && field !== "to") return;
    const chosen = copyStation(hit);
    fillPickedStation(chosen, field);
    if (field === "from") setFromText(displayName(chosen.name, lang));
    else setToText(displayName(chosen.name, lang));
    setFocus(null);
  };

  const clearFrom = () => {
    setFromText("");
    setFocus("from");
    useMapStore.getState().setOrigin(null);
    useMapStore.getState().setPickField("from");
    useMapStore.getState().setJourneys([]);
  };

  const clearTo = () => {
    setToText("");
    setFocus("to");
    useMapStore.getState().setDest(null);
    useMapStore.getState().setPickField("to");
    useMapStore.getState().setJourneys([]);
  };

  const runSearch = () => {
    const dest = resolvePicked(index, toText, destStation, useMapStore.getState().selectedStation);
    const originPick = resolvePicked(index, fromText, originStation, null);
    const origin = originPick ?? currentOrigin();
    if (!origin || !dest) return;
    if (dest.name) setToText(displayName(dest.name, lang));
    if ("name" in origin && typeof origin.name === "string") setFromText(displayName(origin.name, lang));
    void applyTrip(origin, dest);
  };

  const swap = () => {
    const nextFrom = toText;
    const nextTo = fromText;
    setFromText(nextFrom);
    setToText(nextTo);
    const dest = destStation;
    const origin = originStation;
    useMapStore.getState().setOrigin(dest);
    useMapStore.getState().setDest(origin);
    const o = dest ?? resolveStation(index, nextFrom, null) ?? currentOrigin();
    const d = origin ?? resolveStation(index, nextTo, null);
    if (o && d) void applyTrip(o, d);
  };

  const lockOn = (which: "from" | "to") => {
    const text = which === "from" ? fromText : toText;
    const known = which === "from" ? originStation : destStation;
    const st = resolvePicked(index, text, known, useMapStore.getState().selectedStation);
    if (!st) return;
    if (which === "from") {
      setFromText(displayName(st.name, lang));
      useMapStore.getState().setOrigin(st);
    } else {
      setToText(displayName(st.name, lang));
      useMapStore.getState().setDest(st);
    }
    const s = useMapStore.getState();
    s.selectStay(null);
    s.selectTrain(null);
    s.setFollowTrainId(null);
    s.selectStation(st);
    s.requestFlyTo({ lng: st.lng, lat: st.lat, zoom: 14.2, bearing: 0, pitch: 0.55 });
  };

  const canSearch = Boolean(toText.trim()) && Boolean(fromText.trim() || originStation || locateStatus === "ok");

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-fg-muted">{t.from}</span>
          <span className="relative block">
            <Input
              value={fromText}
              onChange={(e) => {
                const v = e.target.value;
                setFocus("from");
                setFromText(v);
                useMapStore.getState().setPickField("from");
                if (!v) useMapStore.getState().setOrigin(null);
              }}
              onFocus={() => {
                setFocus("from");
                useMapStore.getState().setPickField("from");
              }}
              placeholder={t.fromPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            {fromText ? (
              <button
                type="button"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-fg-muted hover:text-fg"
                aria-label={t.close}
                onClick={clearFrom}
              >
                <X className="size-4" />
              </button>
            ) : null}
          </span>
        </label>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t.lockStation}
          disabled={!fromText.trim() && !originStation}
          onClick={() => lockOn("from")}
        >
          <MapPin />
        </Button>
        <Button variant="outline" size="icon" className="shrink-0" aria-label={t.swap} onClick={swap}>
          <ArrowUpDown />
        </Button>
      </div>

      <div className="flex items-end gap-2">
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-xs text-fg-muted">{t.to}</span>
        <span className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={toText}
            onChange={(e) => {
              const v = e.target.value;
              setFocus("to");
              setToText(v);
              useMapStore.getState().setPickField("to");
              if (!v) useMapStore.getState().setDest(null);
            }}
            onFocus={() => {
              setFocus("to");
              useMapStore.getState().setPickField("to");
            }}
            placeholder={t.toPlaceholder}
            className="pr-9 pl-9"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {toText ? (
            <button
              type="button"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-fg-muted hover:text-fg"
              aria-label={t.close}
              onClick={clearTo}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </span>
      </label>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t.lockStation}
          disabled={!toText.trim() && !destStation}
          onClick={() => lockOn("to")}
        >
          <MapPin />
        </Button>
      </div>

      <Button variant="solid" className="w-full" disabled={searching || !canSearch} onClick={runSearch}>
        <Search />
        {searching ? t.searching : t.searchRoute}
      </Button>

      {pickField && !showHits ? <p className="text-sm text-accent">{t.tapMapStation}</p> : null}

      {showHits ? (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain">
          {hits.length === 0 ? (
            <p className="px-1 py-2 text-sm text-fg-muted">{t.noResult}</p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.name}|${hit.prefecture}|${hit.lng.toFixed(5)}|${hit.lat.toFixed(5)}|${i}`}
                type="button"
                data-i={String(i)}
                data-name={hit.name}
                data-pf={hit.prefecture}
                data-lng={String(hit.lng)}
                data-lat={String(hit.lat)}
                className="relative z-10 flex min-h-12 w-full shrink-0 items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-3 text-left hover:bg-fg/6"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const st = hitFromEl(e.currentTarget as HTMLElement, hitsRef.current);
                  if (st) pick(st);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{displayName(hit.name, lang)}</span>
                  <span className="block truncate text-xs text-fg-muted">
                    {displayName(hit.prefecture, lang)} · {hit.lines.map((l) => displayName(l.name, lang)).slice(0, 2).join(" / ")}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      ) : !pickField ? (
        <p className="text-sm text-fg-muted">{t.destHint}</p>
      ) : null}

      {locateStatus === "outside" ? <p className="text-xs text-fg-muted">{t.outside}</p> : null}
      {locateStatus === "pending" ? <p className="text-xs text-fg-muted">{t.locating}</p> : null}
      {!searching && destStation && journeys.length === 0 && afterLastTrain(tokyoParts(simNow()).minutes) ? (
        <p className="text-sm text-fg-muted">{t.nightClosed}</p>
      ) : null}
    </div>
  );
}

let geoWatch = 0;
let headingWatch = false;
let lastRaw: { lng: number; lat: number } | null = null;

function startHeading() {
  if (headingWatch || typeof window === "undefined") return;
  headingWatch = true;
  const apply = (e: DeviceOrientationEvent) => {
    const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    let deg: number | null = null;
    if (typeof webkit === "number" && Number.isFinite(webkit)) deg = webkit;
    else if (typeof e.alpha === "number" && Number.isFinite(e.alpha)) deg = (360 - e.alpha) % 360;
    const beta = e.beta ?? 90;
    const gamma = e.gamma ?? 90;
    const flat = Math.abs(beta) < 32 && Math.abs(gamma) < 28;
    if (deg != null) {
      if (deg < 0) deg += 360;
      useMapStore.getState().setHeading(deg, flat);
    } else useMapStore.getState().setHeading(null, flat);
  };
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  const bind = () => {
    window.addEventListener("deviceorientationabsolute", apply as EventListener, true);
    window.addEventListener("deviceorientation", apply as EventListener, true);
  };
  if (typeof DOE?.requestPermission === "function") {
    void DOE.requestPermission()
      .then(() => bind())
      .catch(() => bind());
  } else bind();
}

export function locateUser(fly: boolean) {
  startHeading();
  const goHome = (lng: number, lat: number) => {
    if (fly) {
      useMapStore.getState().requestFlyTo({ lng, lat, bearing: 0, pitch: 0.55 });
    }
  };
  const goNoda = (status: "denied" | "error" | "outside") => {
    useMapStore.getState().setUserLocation(NODA, status);
    goHome(NODA.lng, NODA.lat);
  };
  useMapStore.getState().setUserLocation(useMapStore.getState().userLocation ?? NODA, "pending");
  if (!navigator.geolocation) {
    goNoda("error");
    return;
  }
  const apply = (pos: GeolocationPosition) => {
    let lng = pos.coords.longitude;
    let lat = pos.coords.latitude;
    if (!isInJapan(lng, lat)) {
      useMapStore.getState().setUserLocation(NODA, "outside");
      return;
    }
    lastRaw = { lng, lat };
    const snapped = snapToRoad(lng, lat, 16);
    if (snapped) {
      lng = snapped.lng;
      lat = snapped.lat;
    }
    useMapStore.getState().setUserLocation({ lng, lat }, "ok");
  };
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      apply(pos);
      const lng = pos.coords.longitude;
      const lat = pos.coords.latitude;
      if (isInJapan(lng, lat)) goHome(lng, lat);
      else goHome(NODA.lng, NODA.lat);
    },
    (err) => {
      goNoda(err.code === 1 ? "denied" : "error");
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 1000 },
  );
  if (!geoWatch) {
    geoWatch = navigator.geolocation.watchPosition(apply, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 800,
      timeout: 12000,
    });
    onRoads(() => {
      if (!lastRaw) return;
      const snapped = snapToRoad(lastRaw.lng, lastRaw.lat, 16);
      if (snapped) useMapStore.getState().setUserLocation(snapped, "ok");
    });
  }
}
