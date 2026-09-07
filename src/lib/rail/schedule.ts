import { AIRPORT_BY_ID, AIRPORTS, FLIGHT_ROUTES } from "@/data/flights";
import { toHhmm, tokyoParts } from "./geo";
import { firstServiceDate, isNightService, isTripRunning, lineSlots, makeTrain } from "./simulate";
import type { Departure, LineRuntime, StationHit } from "./types";

function stopIndex(line: LineRuntime, station: StationHit): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < line.stops.length; i++) {
    const s = line.stops[i]!;
    if (s.n !== station.name) continue;
    const d = (s.lng - station.lng) ** 2 + (s.lat - station.lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best >= 0) return best;
  return line.stops.findIndex((s) => s.n === station.name);
}

function destFor(line: LineRuntime, dir: 0 | 1, fromIndex: number): string {
  if (line.loop) {
    const n = line.stops.length;
    const ahead = line.stops[(fromIndex + (dir === 0 ? 4 : n - 4) + n) % n];
    return ahead?.n ?? line.name;
  }
  if (dir === 0) return line.stops[line.stops.length - 1]?.n ?? line.name;
  return line.stops[0]?.n ?? line.name;
}

export function departuresAt(station: StationHit, now = new Date(), perDir = 6): Departure[] {
  const { minutes, weekday } = tokyoParts(now);
  const flights = flightsNear(station.lng, station.lat, now);
  if (isNightService(minutes)) {
    const morning = firstServiceDate(now);
    const wait = (morning.getTime() - now.getTime()) / 60_000;
    return departuresAt(station, morning, Math.min(3, perDir))
      .filter((d) => !d.trainId.startsWith("fly:"))
      .map((d) => ({ ...d, minutesUntil: d.minutesUntil + wait }))
      .concat(flights);
  }
  const out: Departure[] = [];

  for (const line of station.lines) {
    const { headway, oneWayMin, offset, first, last } = lineSlots(line, minutes, weekday);
    const nowMin = last > 1440 && minutes < 210 ? minutes + 1440 : minutes;
    const idx = stopIndex(line, station);
    if (idx < 0 || line.totalKm <= 0) continue;
    const dirs: Array<0 | 1> = line.loop ? [0] : [0, 1];

    for (const dir of dirs) {
      if (!line.loop) {
        if (dir === 0 && idx >= line.stops.length - 1) continue;
        if (dir === 1 && idx <= 0) continue;
      }
      const frac = line.totalKm > 0 ? (line.stopKm?.[idx] ?? 0) / line.totalKm : 0;
      const travel = Math.round(line.loop ? frac * oneWayMin : dir === 0 ? frac * oneWayMin : (1 - frac) * oneWayMin);
      const dirOff = dir === 1 && !line.loop ? Math.floor(headway / 2) : 0;
      if (nowMin < first - 2 && !(last > 1440 && minutes < 210)) continue;
      if (nowMin > last + oneWayMin + 8) continue;
      let i = Math.ceil((nowMin - travel - first - offset - dirOff) / headway - 1e-6) - 1;
      if (i < 0) i = 0;
      let added = 0;
      while (added < perDir && i < 240) {
        const dep = first + offset + dirOff + i * headway;
        if (dep > last) break;
        const until = dep + travel - nowMin;
        if (until >= -40 && until < 180) {
          const trainId = `${line.id}:${dir}:${i}`;
          const train = isTripRunning(line, minutes, dir, i, weekday)
            ? makeTrain(line, minutes, 0, dir, i, weekday)
            : null;
          out.push({
            id: `${trainId}:${Math.round(minutes + until)}`,
            lineId: line.id,
            lineName: line.name,
            color: line.color,
            dest: destFor(line, dir, idx),
            dir,
            minutesUntil: until,
            hhmm: toHhmm(minutes + until),
            delayMin: 0,
            trainId,
            prevStop: train?.prevStop ?? station.name,
            nextStop: train?.nextStop ?? destFor(line, dir, idx),
          });
          added += 1;
        }
        i += 1;
      }
    }
  }

  out.sort((a, b) => a.minutesUntil - b.minutesUntil);
  out.push(...flights);
  out.sort((a, b) => a.minutesUntil - b.minutesUntil);
  return out;
}

export function flightsNear(lng: number, lat: number, now = new Date()): Departure[] {
  const { minutes } = tokyoParts(now);
  const out: Departure[] = [];
  for (const ap of AIRPORTS) {
    const d = (ap.lng - lng) ** 2 + (ap.lat - lat) ** 2;
    if (d > 0.012) continue;
    for (const route of FLIGHT_ROUTES) {
      const dirs: Array<{ from: string; to: string; dir: 0 | 1 }> = [];
      if (route.from === ap.id) dirs.push({ from: route.from, to: route.to, dir: 0 });
      if (route.to === ap.id) dirs.push({ from: route.to, to: route.from, dir: 1 });
      for (const leg of dirs) {
        const dest = AIRPORT_BY_ID.get(leg.to)?.n ?? leg.to;
        const every = Math.max(20, route.every);
        const elapsed = minutes % every;
        const until = (every - elapsed) % every;
        const trainId = `fly:${route.id}:${leg.dir}:0`;
        out.push({
          id: `${trainId}:${Math.round(minutes + until)}`,
          lineId: route.id,
          lineName: `${ap.n} → ${dest}`,
          color: route.color,
          dest,
          dir: leg.dir,
          minutesUntil: until,
          hhmm: toHhmm(minutes + until),
          delayMin: 0,
          trainId,
          prevStop: ap.n,
          nextStop: dest,
        });
      }
    }
  }
  out.sort((a, b) => a.minutesUntil - b.minutesUntil);
  return out.slice(0, 16);
}