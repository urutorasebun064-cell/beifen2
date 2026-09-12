import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, MapPin, Search, X } from "lucide-react";
import { copies, displayName } from "@/lib/i18n";
import { toJa } from "@/lib/han";
import { tokyoParts, toHhmm, arriveHhmmOf, NODA, isInJapan, haversine, stationsNearPlace, walkMinutes } from "@/lib/rail/geo";
import { liveDelayFor, stampJourneyDelay } from "@/lib/rail/delay";
import { railsMatch } from "@/lib/rail/yahoo";
import { planJourney, stationKey, ensureConnections } from "@/lib/rail/route";
import { departuresAt } from "@/lib/rail/schedule";
import { FIRST_MIN, isNightService, lineSlots, minutesUntilDepart, stopFrac } from "@/lib/rail/simulate";
import { snapToRoad } from "@/lib/roads";
import { lockJourneyTrain } from "@/components/app/route-panel";
import { attachTrack, locateStation, resolveStationQuery } from "@/lib/rail/graph";
import type { Journey, LineRuntime, RouteLeg, RouteStop, StationHit, Train } from "@/lib/rail/types";
import type { Stay } from "@/data/stays";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore, simNow } from "@/store/map-store";

function nearestRailStop(lng: number, lat: number): StationHit | null {
  const rows = stationsNearPlace(useMapStore.getState().stationIndex, lng, lat, 8);
  if (!rows.length) return null;
  const best = rows[0]!.km;
  const close = rows.filter((r) => r.km <= best + 0.12);
  const tx = close.find((r) =>
    r.station.lines.some((l) => /つくば|TX/i.test(l.name) || /つくば|TX/i.test(l.id)),
  );
  if (tx) return tx.station as StationHit;
  return rows[0]!.station as StationHit;
}

function asSearchOrigin(origin: StationHit | { lng: number; lat: number }): StationHit | { lng: number; lat: number } {
  if ("name" in origin && origin.name) return origin;
  return nearestRailStop(origin.lng, origin.lat) ?? origin;
}

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

function uniqueDeparts(list: Journey[]) {
  const seen = new Set<string>();
  const out: Journey[] = [];
  for (const j of list) {
    const ride = j.legs.find((l) => l.kind === "ride");
    const k = `${j.departHhmm}|${ride?.lineName ?? ""}|${ride?.to.name ?? ""}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(j);
  }
  return out;
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
  origin = asSearchOrigin(origin);
  if ("name" in origin && stationKey(origin) === stationKey(dest)) {
    useMapStore.getState().setDest(dest);
    useMapStore.getState().setJourneys([]);
    return;
  }
  const silent = Boolean(opts?.silent);
  const skipCamera = Boolean(opts?.skipCamera);
  if ("name" in origin && origin.name) useMapStore.getState().setOrigin(origin);
  useMapStore.getState().setDest(dest);
  if (!silent) {
    useMapStore.getState().setSearching(true);
    useMapStore.getState().setSheetOpen(true);
  }

  const oName =
    "name" in origin && origin.name
      ? toJa(origin.name)
      : stationsNearPlace(useMapStore.getState().stationIndex, origin.lng, origin.lat, 1)[0]?.station.name ?? "";
  const destName = toJa(dest.name);
  const journeys: Journey[] = [];
  const ingest = (data: { ok?: boolean; journey?: Journey; journeys?: Journey[] }, into: Journey[]) => {
    const list = data.journeys?.length ? data.journeys : data.journey ? [data.journey] : [];
    for (const j of list) {
      if (!j?.legs?.length) continue;
      into.push(pinJourneyDest({ ...j, source: j.source || "yahoo" }, dest));
    }
  };
  const abortAfter = (ms: number) => {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
    const c = new AbortController();
    window.setTimeout(() => c.abort(), ms);
    return c.signal;
  };
  const pullYahoo = async (type: string, hh?: number, mm?: number, bare = false) => {
    const qs = new URLSearchParams({
      from: oName,
      to: destName,
      olat: String(origin.lat),
      olng: String(origin.lng),
      dlat: String(dest.lat),
      dlng: String(dest.lng),
      opf: bare ? "" : "prefecture" in origin ? toJa(origin.prefecture ?? "") : "",
      dpf: bare ? "" : toJa(dest.prefecture ?? ""),
      type,
    });
    if (hh != null) qs.set("hh", String(hh));
    if (mm != null) qs.set("mm", String(mm));
    const rows: Journey[] = [];
    try {
      const res = await fetch(`/api/transit?${qs}`, { signal: abortAfter(24000) });
      ingest((await res.json()) as { ok?: boolean; journey?: Journey; journeys?: Journey[] }, rows);
    } catch {
      /* keep empty */
    }
    return rows;
  };
  try {
    if (oName && destName) {
      const clock = tokyoParts(simNow());
      const nowMin = clock.hour * 60 + clock.minute;
      const notPassed = (j: Journey) => departDue(j.departHhmm, nowMin) + Math.max(0, j.delayMin ?? 0) >= 0;
      let yahoo = await pullYahoo("1", clock.hour, clock.minute);
      if (!yahoo.length) yahoo = await pullYahoo("1", clock.hour, clock.minute, true);
      let live = uniqueDeparts(yahoo.filter(notPassed));
      if (live.length) {
        const last = live[live.length - 1]!;
        const [lh, lm] = last.departHhmm.split(":").map(Number);
        let h = Number(lh) || clock.hour;
        let m = (Number(lm) || 0) + 1;
        if (m >= 60) {
          h += 1;
          m = 0;
        }
        const more = uniqueDeparts((await pullYahoo("1", h % 24, m)).filter(notPassed));
        const seen = new Set(live.map((j) => `${j.departHhmm}|${routeShape(j)}`));
        for (const j of more) {
          const k = `${j.departHhmm}|${routeShape(j)}`;
          if (seen.has(k)) continue;
          seen.add(k);
          live.push(j);
          if (live.length >= 12) break;
        }
      }
      if (!live.length && (nowMin >= 21 * 60 || nowMin < FIRST_MIN)) {
        const firsts = await pullYahoo("3", 4, 50);
        live = uniqueDeparts(firsts.filter(notPassed));
      }
      if (live.length) journeys.push(...live);
    }
  } finally {
    const clock = tokyoParts(simNow());
    const nowMin = clock.hour * 60 + clock.minute;
    const stillDue = (j: Journey) => departDue(j.departHhmm, nowMin) + Math.max(0, j.delayMin ?? 0) >= 0;
    const store = useMapStore.getState();
    let live: Journey[] = journeys.filter(stillDue);
    if (!live.length) {
      store.setJourneys([]);
      if (!silent) store.setSearching(false);
      return;
    }
    const shown = live.slice(0, 12).map((j) => stampJourneyDelay(j, store.liveTrains));
    const keep = shown.filter(stillDue);
    const final = keep.length ? keep : shown;
    if (!final.length) {
      store.setJourneys([]);
      if (!silent) store.setSearching(false);
      return;
    }
    if (silent) {
      const cur = store.journey;
      const idx = cur
        ? final.findIndex((j) => j.departHhmm === cur.departHhmm && routeShape(j) === routeShape(cur))
        : -1;
      if (idx >= 0) store.setJourneys(final, idx);
      void calibrateCorridor(final);
      return;
    }
    store.setSearching(false);
    store.setPickField(null);
    const upcoming = final.find((j) => departDue(j.departHhmm, nowMin) + Math.max(0, j.delayMin ?? 0) >= 0) ?? final[0];
    const idx = Math.max(0, upcoming ? final.indexOf(upcoming) : 0);
    store.setJourneys(final, idx);
    if (upcoming) lockJourneyTrain(upcoming, { camera: !silent && !skipCamera, keepSheet: false });
    store.setSheetOpen(false);
    void calibrateCorridor(final);
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
    const hit = close[0];
    if (!hit && train.delayMin <= 0 && !(train.delaySec && train.delaySec > 0)) return;
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
  const dest = shopWalk?.to ?? journey.dest;
  return { ...journey, dest, legs, totalMinutes: journey.totalMinutes + extra, walkFromGpsMin, walkToDestMin };
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

export async function applyMateTrip(mate: { nick: string; lng: number; lat: number }) {
  const s = useMapStore.getState();
  const loc = s.userLocation ?? NODA;
  const meetKm = haversine([loc.lng, loc.lat], [mate.lng, mate.lat]);
  if (meetKm < 0.05) {
    s.setMateWalk(false);
    s.requestFlyTo({ lng: mate.lng, lat: mate.lat, bearing: 0, pitch: 0.55 });
    return true;
  }
  const fromNear = stationsNearPlace(s.stationIndex, loc.lng, loc.lat, 1)[0];
  const toNear = stationsNearPlace(s.stationIndex, mate.lng, mate.lat, 1)[0];
  if (!fromNear || !toNear) return false;
  s.setMateWalk(true);
  s.selectTrain(null);
  s.setFollowTrainId(null);
  s.setOrigin(fromNear.station);
  s.setDest(toNear.station);
  const sameStop =
    fromNear.station.name === toNear.station.name ||
    haversine([fromNear.station.lng, fromNear.station.lat], [toNear.station.lng, toNear.station.lat]) < 0.25;
  if (sameStop) useMapStore.getState().setJourneys([]);
  else await applyTrip(fromNear.station, toNear.station);
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
  const mateStop: RouteStop = { name: mate.nick, lng: mate.lng, lat: mate.lat, prefecture: "" };
  const originWalk =
    fromNear.km >= 0.08 ? { min: walkMinutes(fromNear.km), from: gps, to: originStop } : undefined;
  const mateKm = haversine([toNear.station.lng, toNear.station.lat], [mate.lng, mate.lat]);
  const shopWalk = mateKm >= 0.05 ? { min: walkMinutes(mateKm), from: destStop, to: mateStop } : undefined;
  const st = useMapStore.getState();
  const patched = st.journeys.length
    ? st.journeys.map((j) => addStayWalks(j, originWalk, shopWalk))
    : shopWalk
      ? [
          addStayWalks(
            {
              origin: originStop,
              dest: mateStop,
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
  const after = useMapStore.getState();
  if (after.originStation && after.destStation) {
    void applyTrip(after.originStation, after.destStation, { skipCamera: true });
  } else {
    s.requestFlyTo({ lng: chosen.lng, lat: chosen.lat, zoom: 14.2, bearing: 0, pitch: 0.55, center: true });
    void calibrateStation(chosen);
  }
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
  const fieldLocked =
    focus === "from"
      ? Boolean(originStation && stationTextMatch(originStation, fromText))
      : focus === "to"
        ? Boolean(destStation && stationTextMatch(destStation, toText))
        : false;
  const showHits = Boolean(focus) && q.trim().length > 0 && !fieldLocked;
  const resolved = showHits
    ? resolveStationQuery(index, q, null, useMapStore.getState().userLocation)
    : null;
  const hits = resolved?.suggestions ?? [];
  const hitsRef = useRef(hits);
  hitsRef.current = hits;

  const blurFields = () => {
    setFocus(null);
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const pick = (hit: StationHit) => {
    const field = useMapStore.getState().pickField ?? focus ?? "to";
    if (field !== "from" && field !== "to") return;
    const chosen = copyStation(hit);
    fillPickedStation(chosen, field);
    if (field === "from") setFromText(displayName(chosen.name, lang));
    else setToText(displayName(chosen.name, lang));
    blurFields();
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
    const dest = resolvePicked(index, toText, destStation, null);
    const originPick = resolvePicked(index, fromText, originStation, null);
    const origin = originPick ?? currentOrigin();
    if (!origin || !dest) return;
    if (dest.name) setToText(displayName(dest.name, lang));
    if ("name" in origin && typeof origin.name === "string") setFromText(displayName(origin.name, lang));
    blurFields();
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

let headingWatch = false;
const gpsHold = { lng: 0, lat: 0, acc: 9e9, t: 0, on: false, move: 0 };
let fineTimer = 0;
let watchId: number | null = null;
let visBound = false;
let streetZoom = false;
let lastFixAt = 0;
let gpsHdgAt = 0;

export function noteStreetZoom(on: boolean) {
  streetZoom = on;
}

function blendGps(pos: GeolocationPosition) {
  const lng = pos.coords.longitude;
  const lat = pos.coords.latitude;
  if (!isInJapan(lng, lat)) return null;
  const acc = Math.max(4, pos.coords.accuracy || 40);
  const t = pos.timestamp || Date.now();
  const reported = Number.isFinite(pos.coords.speed) ? Math.max(0, pos.coords.speed as number) : -1;
  if (!gpsHold.on) {
    gpsHold.lng = lng;
    gpsHold.lat = lat;
    gpsHold.acc = acc;
    gpsHold.t = t;
    gpsHold.on = true;
    gpsHold.move = reported > 2.2 ? 10 : 0;
    return { lng, lat, acc };
  }
  const dt = Math.max(0.2, (t - gpsHold.t) / 1000);
  const d = haversine([gpsHold.lng, gpsHold.lat], [lng, lat]) * 1000;
  const speed = d / dt;
  if (speed > 130 && d > acc * 3 && !(reported > 8)) {
    gpsHold.t = t;
    return { lng: gpsHold.lng, lat: gpsHold.lat, acc: gpsHold.acc };
  }
  const rolling = reported > 2.2 || speed > 3.2 || d > 28;
  gpsHold.move = rolling ? 10 : Math.max(0, gpsHold.move - 1);
  if (!rolling && acc > gpsHold.acc * 1.6 && acc > 22 && d < 25) {
    gpsHold.t = t;
    return { lng: gpsHold.lng, lat: gpsHold.lat, acc: gpsHold.acc };
  }
  const dead = rolling ? 1.2 : Math.max(4, Math.min(acc, gpsHold.acc) * 0.35);
  if (d < dead) {
    gpsHold.acc = Math.min(gpsHold.acc, acc);
    gpsHold.t = t;
    return { lng: gpsHold.lng, lat: gpsHold.lat, acc: gpsHold.acc };
  }
  const k = rolling ? (d > 50 ? 0.94 : 0.88) : acc <= 12 ? 0.55 : acc <= 22 ? 0.35 : 0.22;
  gpsHold.lng += (lng - gpsHold.lng) * k;
  gpsHold.lat += (lat - gpsHold.lat) * k;
  gpsHold.acc = rolling ? acc : gpsHold.acc * 0.55 + acc * 0.45;
  gpsHold.t = t;
  return { lng: gpsHold.lng, lat: gpsHold.lat, acc: gpsHold.acc };
}

function pushFix(pos: GeolocationPosition) {
  const hit = blendGps(pos);
  if (!hit) return false;
  let { lng, lat, acc } = hit;
  if (acc > 28 && gpsHold.move <= 0) {
    const snapped = snapToRoad(lng, lat, 16);
    if (snapped) {
      lng = snapped.lng;
      lat = snapped.lat;
      gpsHold.lng = lng;
      gpsHold.lat = lat;
    }
  }
  lastFixAt = Date.now();
  useMapStore.getState().setUserLocation({ lng, lat }, "ok");
  const spd = pos.coords.speed;
  const course = pos.coords.heading;
  if (Number.isFinite(spd) && (spd as number) > 2.8 && Number.isFinite(course) && (course as number) >= 0) {
    gpsHdgAt = Date.now();
    useMapStore.getState().setHeading(course as number, useMapStore.getState().headingFlat);
  }
  return true;
}

function startWatch() {
  if (watchId != null || typeof navigator === "undefined" || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      pushFix(pos);
    },
    () => {},
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 400 },
  );
}

function stopWatch() {
  if (watchId == null || typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function bindWatchVis() {
  if (visBound || typeof document === "undefined") return;
  visBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") startWatch();
    else stopWatch();
  });
}

function armFineLocate() {
  bindWatchVis();
  startWatch();
  if (fineTimer || typeof window === "undefined") return;
  fineTimer = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (useMapStore.getState().locateStatus !== "ok") return;
    const moving = gpsHold.move > 0;
    const wait = watchId != null ? (moving ? 8000 : streetZoom ? 16000 : 24000) : moving ? 1600 : streetZoom ? 8000 : 16000;
    if (Date.now() - lastFixAt < wait) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        pushFix(pos);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: moving ? 400 : 4000 },
    );
  }, 2000);
}

function startHeading() {
  if (headingWatch || typeof window === "undefined") return;
  headingWatch = true;
  let absAt = 0;
  const apply = (e: DeviceOrientationEvent) => {
    const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    const abs = Boolean(e.absolute) || e.type === "deviceorientationabsolute";
    let deg: number | null = null;
    if (typeof webkit === "number" && Number.isFinite(webkit)) {
      deg = webkit;
      absAt = Date.now();
    } else if (abs && typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
      deg = (360 - e.alpha) % 360;
      absAt = Date.now();
    } else if (Date.now() - absAt > 1200 && typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
      deg = (360 - e.alpha) % 360;
    }
    const beta = e.beta ?? 90;
    const gamma = e.gamma ?? 90;
    const flat = Math.abs(beta) < 48 && Math.abs(gamma) < 42;
    const rideHdg = Date.now() - gpsHdgAt < 2500;
    if (rideHdg) {
      useMapStore.getState().setHeading(useMapStore.getState().headingDeg, flat);
      return;
    }
    if (deg != null) {
      if (deg < 0) deg += 360;
      useMapStore.getState().setHeading(deg, flat);
    } else useMapStore.getState().setHeading(useMapStore.getState().headingDeg, flat);
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
    gpsHold.on = false;
    useMapStore.getState().setUserLocation(NODA, status);
    goHome(NODA.lng, NODA.lat);
  };
  if (useMapStore.getState().locateStatus !== "ok") {
    useMapStore.getState().setUserLocation(useMapStore.getState().userLocation ?? NODA, "pending");
  }
  if (!navigator.geolocation) {
    goNoda("error");
    return;
  }
  const apply = (pos: GeolocationPosition) => {
    if (!pushFix(pos) && !isInJapan(pos.coords.longitude, pos.coords.latitude)) {
      useMapStore.getState().setUserLocation(NODA, "outside");
    }
  };
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      apply(pos);
      const here = useMapStore.getState().userLocation;
      if (here && isInJapan(here.lng, here.lat)) goHome(here.lng, here.lat);
      else goHome(NODA.lng, NODA.lat);
      if (!fly) {
        navigator.geolocation.getCurrentPosition(apply, () => {}, { enableHighAccuracy: true, timeout: 14000, maximumAge: 2000 });
      }
      armFineLocate();
    },
    (err) => {
      goNoda(err.code === 1 ? "denied" : "error");
    },
    fly
      ? { enableHighAccuracy: true, timeout: 14000, maximumAge: 3000 }
      : { enableHighAccuracy: false, timeout: 8000, maximumAge: 20000 },
  );
}
