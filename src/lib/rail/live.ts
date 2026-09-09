import { pointAlong } from "./geo";
import { delayMinutes } from "./delay";
import { stopFrac } from "./simulate";
import { snapTrainToTimetable } from "./timetable-snap";
import type { LineRuntime, Train } from "./types";

export type LivePayload = {
  ok: boolean;
  source: "odpt" | "sim" | "live";
  error?: string;
  trains: LiveTrainJson[];
  dia?: Array<{ name: string; delaySec: number; alert: boolean }>;
};

export type LiveTrainJson = {
  id: string;
  railway: string;
  railwayTitle: string;
  from: string;
  to: string;
  dest: string;
  delaySec: number;
  lng?: number;
  lat?: number;
  bearing?: number;
  kind?: "rail" | "bus" | "flight";
  arrUnix?: number;
  status?: number;
  /** True only when the feed sent its own coordinates (not a station pin). */
  gps?: boolean;
};

type StationRec = { name: string; lng?: number; lat?: number };
type RailwayRec = { title: string };

function lastSeg(id: string) {
  const s = id.split(":").pop() ?? id;
  return s.split(".").pop() ?? s;
}

function cleanName(s: string) {
  return s.replace(/駅$/u, "").trim();
}

function findLine(lines: LineRuntime[], railwayTitle: string, from: string, to: string): LineRuntime | null {
  const title = railwayTitle.replace(/^JR/u, "").replace(/線$/u, "");
  const named = lines.filter((l) => {
    const n = l.name.replace(/^JR/u, "").replace(/線$/u, "");
    return Boolean(title) && (n.includes(title) || title.includes(n));
  });
  const pool = named.length ? named : lines;
  const scored = pool
    .map((l) => {
      const fi = from ? l.stops.findIndex((s) => s.n === from) : -1;
      const ti = to ? l.stops.findIndex((s) => s.n === to) : -1;
      let score = named.includes(l) ? 2 : 0;
      if (fi >= 0) score += 4;
      if (ti >= 0) score += 4;
      if (fi >= 0 && ti >= 0) score += 6;
      return { l, score, fi, ti };
    })
    .filter((x) => x.score >= 6)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.l ?? named[0] ?? null;
}

export function nearestOnPath(line: LineRuntime, lng: number, lat: number) {
  let bestI = 0;
  let best = Infinity;
  for (let i = 0; i < line.path.length; i++) {
    const p = line.path[i]!;
    const d = (p[0] - lng) ** 2 + (p[1] - lat) ** 2;
    if (d < best) {
      best = d;
      bestI = i;
    }
  }
  const km = line.cum[bestI] ?? 0;
  const t = line.totalKm > 0 ? km / line.totalKm : 0;
  const pose = pointAlong(line.path, line.cum, line.totalKm, t);
  return { t, coord: pose.coord, bearing: pose.bearing, km };
}

export function liveToTrains(lines: LineRuntime[], raw: LiveTrainJson[]): Train[] {
  const out: Train[] = [];
  for (const row of raw) {
    if (row.kind === "flight" && row.lng != null && row.lat != null) {
      out.push({
        id: `live:${row.id}`,
        lineId: row.railway,
        lineName: row.railwayTitle || `${row.from}–${row.to}`,
        color: "#8eb4e8",
        kind: "flight",
        lng: row.lng,
        lat: row.lat,
        bearing: row.bearing ?? 0,
        dir: 0,
        dest: row.dest || row.to,
        nextStop: row.to || row.dest,
        prevStop: row.from,
        delayMin: delayMinutes(row.delaySec || 0),
        delaySec: Math.max(0, row.delaySec || 0),
        progress: 0,
        stopIndex: 0,
      });
      continue;
    }
    const from = cleanName(row.from);
    const to = cleanName(row.to);
    const dest = cleanName(row.dest) || to;
    const line = row.kind === "bus" ? null : findLine(lines, row.railwayTitle || row.railway, from, to);
    if (line) {
      const fi = from ? line.stops.findIndex((s) => s.n === from) : -1;
      const ti = to ? line.stops.findIndex((s) => s.n === to) : -1;
      let t = 0;
      let coord: [number, number];
      let bearing: number;
      if (row.lng != null && row.lat != null) {
        const snap = nearestOnPath(line, row.lng, row.lat);
        t = snap.t;
        coord = snap.coord;
        bearing = snap.bearing;
      } else {
        if (fi >= 0 && ti >= 0) t = stopFrac(line, fi) * 0.72 + stopFrac(line, ti) * 0.28;
        else if (fi >= 0) t = stopFrac(line, fi);
        else if (ti >= 0) t = stopFrac(line, ti);
        const pose = pointAlong(line.path, line.cum, line.totalKm, t);
        coord = pose.coord;
        bearing = pose.bearing;
      }
      const dir: 0 | 1 = fi >= 0 && ti >= 0 && ti < fi ? 1 : 0;
      const delayMin = delayMinutes(row.delaySec || 0);
      const delaySec = Math.max(0, row.delaySec || 0);
      const etaMin = row.arrUnix ? Math.max(0, (row.arrUnix * 1000 - Date.now()) / 60000) : undefined;
      const hasCoords = row.lng != null && row.lat != null;
      const hasGps = row.gps === true;
      const seed: Train = {
        id: `live:${row.id}`,
        lineId: line.id,
        lineName: line.name,
        color: line.color,
        kind: line.kind,
        lng: coord[0],
        lat: coord[1],
        bearing: dir === 1 && !line.loop ? (bearing + 180) % 360 : bearing,
        dir,
        dest: dest || line.name,
        nextStop: to || dest || line.stops[Math.min(line.stops.length - 1, Math.max(0, fi + 1))]?.n || line.name,
        prevStop: from || line.stops[Math.max(0, fi)]?.n || line.name,
        delayMin,
        delaySec,
        progress: t,
        stopIndex: fi >= 0 ? fi : 0,
        etaMin,
        arrUnix: row.arrUnix,
        gtfsStatus: row.status,
        gps: hasGps,
      };
      out.push(
        !hasCoords && fi >= 0 && ti >= 0
          ? snapTrainToTimetable(line, seed, Date.now(), {
              arrUnix: row.arrUnix,
              status: row.status,
              delaySec,
            })
          : seed,
      );
      continue;
    }
    if (row.lng == null || row.lat == null) continue;
    const busLine = row.kind === "bus" ? nearestLine(lines, row.lng, row.lat, "bus") : null;
    if (busLine) {
      const snap = nearestOnPath(busLine, row.lng, row.lat);
      out.push({
        id: `live:${row.id}`,
        lineId: busLine.id,
        lineName: row.railwayTitle || busLine.name,
        color: busLine.color,
        kind: row.kind === "bus" ? "bus" : busLine.kind,
        lng: snap.coord[0],
        lat: snap.coord[1],
        bearing: row.bearing || snap.bearing,
        dir: 0,
        dest: dest || busLine.name,
        nextStop: to || dest || busLine.name,
        prevStop: from || busLine.name,
        delayMin: delayMinutes(row.delaySec || 0),
        delaySec: Math.max(0, row.delaySec || 0),
        progress: snap.t,
        stopIndex: 0,
        gps: row.gps === true,
      });
      continue;
    }
    out.push({
      id: `live:${row.id}`,
      lineId: row.railway,
      lineName: row.railwayTitle || row.id,
      color: row.kind === "bus" ? "#e85d4c" : "#4aa3c7",
      kind: row.kind === "bus" ? "bus" : "jr",
      lng: row.lng,
      lat: row.lat,
      bearing: row.bearing ?? 0,
      dir: 0,
      dest: dest || row.railwayTitle,
      nextStop: to || dest,
      prevStop: from,
      delayMin: delayMinutes(row.delaySec || 0),
      delaySec: Math.max(0, row.delaySec || 0),
      progress: 0,
      stopIndex: 0,
      gps: row.gps === true,
    });
  }
  return out;
}

function nearestLine(lines: LineRuntime[], lng: number, lat: number, kind?: LineRuntime["kind"]) {
  let best: LineRuntime | null = null;
  let bestD = 0.35;
  for (const line of lines) {
    if (kind && line.kind !== kind) continue;
    const snap = nearestOnPath(line, lng, lat);
    const d = Math.hypot((snap.coord[0] - lng) * 91, (snap.coord[1] - lat) * 111);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  return best;
}

const chase = new Map<string, { lng: number; lat: number; bearing: number; progress: number; at: number }>();

export function railDriftKm(line: LineRuntime, lng: number, lat: number) {
  const snap = nearestOnPath(line, lng, lat);
  return Math.hypot((snap.coord[0] - lng) * 91, (snap.coord[1] - lat) * 111);
}

export function mergeLive(sim: Train[], live: Train[]): Train[] {
  if (!live.length) return sim;
  const now = Date.now();
  for (const [id, v] of chase) {
    if (now - v.at > 5000) chase.delete(id);
  }
  const used = new Set<string>();
  const out: Train[] = [];
  for (const lv of live) {
    if (lv.kind === "flight") {
      out.push(lv);
      continue;
    }
    let best: Train | null = sim.find((s) => s.id === lv.id && s.kind !== "flight" && !used.has(s.id)) ?? null;
    let bestD = best ? 0 : lv.kind === "shinkansen" ? 4 : 1.6;
    if (!best) {
    for (const s of sim) {
      if (used.has(s.id) || s.kind === "flight") continue;
      if (lv.lineId && s.lineId !== lv.lineId) continue;
      if (lv.dir !== s.dir) continue;
      const cap = s.kind === "shinkansen" || lv.kind === "shinkansen" ? 4 : 1.6;
      const d = Math.hypot((s.lng - lv.lng) * 91, (s.lat - lv.lat) * 111);
      if (d <= cap && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    }
    if (best) {
      used.add(best.id);
      const liveGps = lv.gps === true;
      const prev = chase.get(best.id);
      const fromLng = prev?.lng ?? best.lng;
      const fromLat = prev?.lat ?? best.lat;
      const fromBr = prev?.bearing ?? best.bearing;
      const fromP = prev?.progress ?? best.progress;
      const gap = Math.hypot((fromLng - lv.lng) * 91, (fromLat - lv.lat) * 111);
      let lng = fromLng;
      let lat = fromLat;
      let bearing = fromBr;
      let progress = fromP;
      const shin = best.kind === "shinkansen" || lv.kind === "shinkansen";
      const railGap = Math.hypot((best.lng - lv.lng) * 91, (best.lat - lv.lat) * 111);
      const maxDrift = shin ? 2.5 : 0.8;
      if (liveGps && railGap <= maxDrift) {
        const a = 0.38;
        lng = fromLng + (lv.lng - fromLng) * a;
        lat = fromLat + (lv.lat - fromLat) * a;
        bearing = fromBr + ((((lv.bearing - fromBr + 540) % 360) - 180) * a);
        bearing = ((bearing % 360) + 360) % 360;
        progress = fromP + ((lv.progress || fromP) - fromP) * a;
      } else if (liveGps) {
        lng = best.lng;
        lat = best.lat;
        bearing = best.bearing;
        progress = best.progress;
      } else if (gap <= 18) {
        if (shin) {
          lng = best.lng;
          lat = best.lat;
          bearing = best.bearing;
          progress = best.progress;
        } else {
          const a = gap > 5 ? 0.2 : gap > 1.2 ? 0.12 : 0.08;
          lng = fromLng + (lv.lng - fromLng) * a;
          lat = fromLat + (lv.lat - fromLat) * a;
          bearing = fromBr + ((((lv.bearing - fromBr + 540) % 360) - 180) * a);
          bearing = ((bearing % 360) + 360) % 360;
          progress = fromP + ((lv.progress || fromP) - fromP) * a;
        }
      } else {
        lng = best.lng;
        lat = best.lat;
        bearing = best.bearing;
        progress = best.progress;
      }
      chase.set(best.id, { lng, lat, bearing, progress, at: now });
      const simEta = best.etaMin;
      const liveEta = lv.etaMin;
      const shinEta = best.kind === "shinkansen" || lv.kind === "shinkansen";
      let eta = simEta;
      if (liveEta != null && (simEta == null || Math.abs(liveEta - simEta) <= 3.5)) eta = liveEta;
      if (shinEta) {
        eta = simEta ?? liveEta;
        if (liveEta != null && simEta != null && liveEta <= simEta + 1.6 && liveEta + 3 >= simEta) eta = liveEta;
      }
      let arrUnix = best.arrUnix;
      if (lv.arrUnix) {
        const fromArr = (lv.arrUnix * 1000 - now) / 60000;
        if (simEta == null || Math.abs(fromArr - simEta) <= 3.5) arrUnix = lv.arrUnix;
        if (shinEta && simEta != null && fromArr > simEta + 1.6) arrUnix = best.arrUnix;
      }
      out.push({
        ...best,
        lng,
        lat,
        bearing,
        delayMin: Math.max(best.delayMin, lv.delayMin),
        delaySec: Math.max(best.delaySec ?? 0, lv.delaySec ?? 0, Math.max(best.delayMin, lv.delayMin) * 60),
        dest: lv.dest || best.dest,
        nextStop: best.nextStop || lv.nextStop,
        prevStop: best.prevStop || lv.prevStop,
        progress,
        etaMin: eta,
        arrUnix,
        gtfsStatus: lv.gtfsStatus,
        gps: liveGps || best.gps,
      });
    } else if (lv.kind === "shinkansen" && lv.gps !== true) {
      continue;
    } else {
      out.push(lv);
    }
  }
  for (const s of sim) {
    if (!used.has(s.id)) out.push(s);
  }
  return out;
}

export function parseOdptCatalog(
  trains: Array<Record<string, unknown>>,
  stations: Array<Record<string, unknown>>,
  railways: Array<Record<string, unknown>>,
): LiveTrainJson[] {
  const st = new Map<string, StationRec>();
  for (const s of stations) {
    const id = String(s["owl:sameAs"] ?? "");
    if (!id) continue;
    st.set(id, {
      name: cleanName(String(s["dc:title"] ?? lastSeg(id))),
      lng: typeof s["geo:long"] === "number" ? s["geo:long"] : undefined,
      lat: typeof s["geo:lat"] === "number" ? s["geo:lat"] : undefined,
    });
  }
  const rw = new Map<string, RailwayRec>();
  for (const r of railways) {
    const id = String(r["owl:sameAs"] ?? "");
    if (!id) continue;
    rw.set(id, { title: String(r["dc:title"] ?? lastSeg(id)) });
  }
  const out: LiveTrainJson[] = [];
  for (const t of trains) {
    const id = String(t["owl:sameAs"] ?? t["odpt:trainNumber"] ?? "");
    if (!id) continue;
    const railway = String(t["odpt:railway"] ?? "");
    const fromId = String(t["odpt:fromStation"] ?? "");
    const toId = String(t["odpt:toStation"] ?? "");
    const destIds = t["odpt:destinationStation"];
    const destId = Array.isArray(destIds) ? String(destIds[0] ?? "") : "";
    const from = st.get(fromId);
    const to = st.get(toId);
    const dest = st.get(destId);
    const delay = typeof t["odpt:delay"] === "number" ? t["odpt:delay"] : 0;
    const title = rw.get(railway)?.title ?? lastSeg(railway);
    const hasGeo = typeof t["geo:long"] === "number" && typeof t["geo:lat"] === "number";
    const shin = /新幹線|Shinkansen/i.test(title) || /新幹線|Shinkansen/i.test(railway);
    out.push({
      id,
      railway,
      railwayTitle: title,
      from: from?.name ?? cleanName(lastSeg(fromId)),
      to: to?.name ?? cleanName(lastSeg(toId)),
      dest: dest?.name ?? "",
      delaySec: delay,
      lng: hasGeo ? (t["geo:long"] as number) : shin ? undefined : from?.lng,
      lat: hasGeo ? (t["geo:lat"] as number) : shin ? undefined : from?.lat,
      gps: hasGeo,
    });
  }
  return out;
}
