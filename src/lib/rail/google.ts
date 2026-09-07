import { toHhmm, tokyoParts } from "./geo";
import type { Departure, Journey, RouteLeg, RouteStop, Train } from "./types";

export type GoogleDirectionsJson = {
  status: string;
  error_message?: string;
  routes?: Array<{
    overview_polyline?: { points?: string };
    legs?: Array<{
      duration?: { value?: number };
      departure_time?: { text?: string; value?: number };
      arrival_time?: { text?: string; value?: number };
      start_address?: string;
      end_address?: string;
      steps?: GoogleStep[];
    }>;
  }>;
};

type GoogleStep = {
  travel_mode?: string;
  duration?: { value?: number };
  start_location?: { lat: number; lng: number };
  end_location?: { lat: number; lng: number };
  polyline?: { points?: string };
  html_instructions?: string;
  transit_details?: {
    headsign?: string;
    num_stops?: number;
    departure_stop?: { name?: string; location?: { lat: number; lng: number } };
    arrival_stop?: { name?: string; location?: { lat: number; lng: number } };
    departure_time?: { text?: string; value?: number };
    arrival_time?: { text?: string; value?: number };
    line?: {
      name?: string;
      short_name?: string;
      color?: string;
      vehicle?: { type?: string; name?: string };
    };
  };
};

function decodePolyline(encoded: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  while (i < encoded.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

function stopFrom(name: string, loc?: { lat: number; lng: number }, fallback?: { lng: number; lat: number }): RouteStop {
  return {
    name,
    lng: loc?.lng ?? fallback?.lng ?? 0,
    lat: loc?.lat ?? fallback?.lat ?? 0,
    prefecture: "",
  };
}

function hhmmFromUnix(sec?: number, text?: string): string {
  if (sec) return tokyoParts(new Date(sec * 1000)).hhmm;
  return text?.replace(/[^\d:]/g, "").slice(0, 5) ?? "--:--";
}

function lineColor(step: GoogleStep): string {
  const c = step.transit_details?.line?.color;
  if (c && /^#?[0-9a-fA-F]{6}$/.test(c)) return c.startsWith("#") ? c : `#${c}`;
  const type = step.transit_details?.line?.vehicle?.type ?? "";
  if (type.includes("BUS")) return "#e85d4c";
  if (type.includes("SUBWAY") || type.includes("METRO")) return "#f4c04a";
  if (type.includes("HIGH_SPEED")) return "#0a7ad1";
  return "#7ec8e3";
}

export function journeysFromGoogle(
  data: GoogleDirectionsJson,
  origin: RouteStop,
  dest: RouteStop,
): Journey[] {
  if (data.status !== "OK" || !data.routes?.length) return [];
  return data.routes.map((route) => journeyFromRoute(route, origin, dest)).filter((j): j is Journey => Boolean(j));
}

export function journeyFromGoogle(
  data: GoogleDirectionsJson,
  origin: RouteStop,
  dest: RouteStop,
): Journey | null {
  return journeysFromGoogle(data, origin, dest)[0] ?? null;
}

function journeyFromRoute(
  route: NonNullable<GoogleDirectionsJson["routes"]>[number],
  origin: RouteStop,
  dest: RouteStop,
): Journey | null {
  const leg = route.legs?.[0];
  if (!leg?.steps?.length) return null;
  const legs: RouteLeg[] = [];
  let transfers = 0;
  for (const step of leg.steps) {
    const walk = (step.travel_mode ?? "").toUpperCase() !== "TRANSIT";
    const td = step.transit_details;
    const from = walk
      ? stopFrom("", step.start_location, origin)
      : stopFrom(td?.departure_stop?.name ?? "", td?.departure_stop?.location, step.start_location);
    const to = walk
      ? stopFrom("", step.end_location, dest)
      : stopFrom(td?.arrival_stop?.name ?? "", td?.arrival_stop?.location, step.end_location);
    if (!from.name) from.name = walk ? origin.name : from.name;
    if (!to.name) to.name = walk ? dest.name : to.name;
    const poly = step.polyline?.points ? decodePolyline(step.polyline.points) : [];
    const stops: RouteStop[] =
      poly.length > 1
        ? poly.map((p, i) => ({
            name: i === 0 ? from.name : i === poly.length - 1 ? to.name : "",
            lng: p[0],
            lat: p[1],
            prefecture: "",
          }))
        : [from, to];
    if (!walk) transfers += 1;
    legs.push({
      kind: walk ? "walk" : "ride",
      lineName: walk ? undefined : td?.line?.short_name || td?.line?.name,
      color: walk ? undefined : lineColor(step),
      toward: td?.headsign,
      from,
      to,
      stops,
      minutes: Math.max(1, Math.round((step.duration?.value ?? 60) / 60)),
      departHhmm: walk ? undefined : hhmmFromUnix(td?.departure_time?.value, td?.departure_time?.text),
      arriveHhmm: walk ? undefined : hhmmFromUnix(td?.arrival_time?.value, td?.arrival_time?.text),
    });
  }
  if (transfers > 0) transfers -= 1;
  return {
    origin: { ...origin, name: origin.name || leg.start_address?.split(",")[0] || origin.name },
    dest: { ...dest, name: dest.name || leg.end_address?.split(",")[0] || dest.name },
    legs,
    totalMinutes: Math.max(1, Math.round((leg.duration?.value ?? 0) / 60)),
    transfers,
    departHhmm: hhmmFromUnix(leg.departure_time?.value, leg.departure_time?.text),
    arriveHhmm: hhmmFromUnix(leg.arrival_time?.value, leg.arrival_time?.text),
    source: "google",
  };
}

export type GoogleBoardItem = {
  id: string;
  lineName: string;
  color: string;
  vehicle: "bus" | "subway" | "shinkansen" | "jr";
  dest: string;
  from: string;
  to: string;
  depUnix: number;
  arrUnix: number;
  path: [number, number][];
  fromLng: number;
  fromLat: number;
  toLng: number;
  toLat: number;
};

function vehicleOf(step: GoogleStep): GoogleBoardItem["vehicle"] {
  const type = (step.transit_details?.line?.vehicle?.type ?? "").toUpperCase();
  if (type.includes("BUS")) return "bus";
  if (type.includes("SUBWAY") || type.includes("METRO")) return "subway";
  if (type.includes("HIGH_SPEED")) return "shinkansen";
  return "jr";
}

export function boardFromGoogle(data: GoogleDirectionsJson): GoogleBoardItem[] {
  const out: GoogleBoardItem[] = [];
  for (const route of data.routes ?? []) {
    for (const leg of route.legs ?? []) {
      for (const step of leg.steps ?? []) {
        if ((step.travel_mode ?? "").toUpperCase() !== "TRANSIT") continue;
        const td = step.transit_details;
        if (!td?.departure_time?.value) continue;
        const from = td.departure_stop?.name ?? "";
        const to = td.arrival_stop?.name ?? td.headsign ?? "";
        const path = step.polyline?.points ? decodePolyline(step.polyline.points) : [];
        const fromLoc = td.departure_stop?.location ?? step.start_location;
        const toLoc = td.arrival_stop?.location ?? step.end_location;
        const v = vehicleOf(step);
        const name = td.line?.short_name || td.line?.name || (v === "bus" ? "バス" : "電車");
        out.push({
          id: `ggl:${name}:${td.departure_time.value}:${from}`,
          lineName: name,
          color: lineColor(step),
          vehicle: v,
          dest: td.headsign || to,
          from,
          to,
          depUnix: td.departure_time.value,
          arrUnix: td.arrival_time?.value ?? td.departure_time.value + (step.duration?.value ?? 600),
          path,
          fromLng: fromLoc?.lng ?? 0,
          fromLat: fromLoc?.lat ?? 0,
          toLng: toLoc?.lng ?? 0,
          toLat: toLoc?.lat ?? 0,
        });
      }
    }
  }
  return out;
}

function along(path: [number, number][], u: number): { lng: number; lat: number; bearing: number } {
  if (path.length < 2) {
    const p = path[0] ?? [0, 0];
    return { lng: p[0], lat: p[1], bearing: 0 };
  }
  const t = Math.max(0, Math.min(1, u)) * (path.length - 1);
  const i = Math.min(path.length - 2, Math.floor(t));
  const f = t - i;
  const a = path[i]!;
  const b = path[i + 1]!;
  const lng = a[0] + (b[0] - a[0]) * f;
  const lat = a[1] + (b[1] - a[1]) * f;
  const bearing = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  return { lng, lat, bearing };
}

export function googleBoardToTrains(items: GoogleBoardItem[], nowUnix = Date.now() / 1000): Train[] {
  const out: Train[] = [];
  for (const it of items) {
    if (nowUnix > it.arrUnix + 20) continue;
    const travel = Math.max(45, it.arrUnix - it.depUnix);
    const path = it.path.length >= 2 ? it.path : ([[it.fromLng, it.fromLat], [it.toLng, it.toLat]] as [number, number][]);
    let u = 0;
    if (nowUnix < it.depUnix) u = 0;
    else u = Math.max(0, Math.min(0.98, (nowUnix - it.depUnix) / travel));
    const pos = along(path, u);
    out.push({
      id: it.id,
      lineId: it.id,
      lineName: it.lineName,
      color: it.color,
      kind: it.vehicle,
      lng: pos.lng,
      lat: pos.lat,
      bearing: pos.bearing,
      dir: 0,
      dest: it.dest,
      nextStop: it.to,
      prevStop: it.from,
      delayMin: 0,
      progress: u,
      stopIndex: 0,
    });
  }
  return out;
}

export function googleBoardToDepartures(items: GoogleBoardItem[], nowUnix = Date.now() / 1000): Departure[] {
  const minutes = tokyoParts(new Date(nowUnix * 1000)).minutes;
  return items
    .map((it) => {
      const until = (it.depUnix - nowUnix) / 60;
      return {
        id: it.id,
        lineId: it.id,
        lineName: it.lineName,
        color: it.color,
        dest: it.dest,
        dir: 0 as const,
        minutesUntil: until,
        hhmm: toHhmm(minutes + until),
        delayMin: 0,
        trainId: it.id,
        prevStop: it.from,
        nextStop: it.to,
      };
    })
    .filter((d) => d.minutesUntil >= 0 && d.minutesUntil < 90)
    .sort((a, b) => a.minutesUntil - b.minutesUntil);
}
