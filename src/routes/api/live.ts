import { createFileRoute } from "@tanstack/react-router";
import { fetchAllGtfsRt } from "@/lib/rail/gtfs-rt";
import { odptKeyFrom } from "@/lib/rail/keys.server";
import { parseOdptCatalog, type LivePayload, type LiveTrainJson } from "@/lib/rail/live";
import { fetchOpenSky } from "@/lib/rail/opensky";
import { fetchYahooDiaInfo } from "@/lib/rail/yahoo";

const BASE = "https://api.odpt.org/api/v4";
const OPERATORS = [
  "odpt.Operator:JR-East",
  "odpt.Operator:TokyoMetro",
  "odpt.Operator:Toei",
  "odpt.Operator:Tokyu",
  "odpt.Operator:Odakyu",
  "odpt.Operator:Keio",
  "odpt.Operator:Seibu",
  "odpt.Operator:Tobu",
  "odpt.Operator:Keisei",
];
const BUS_OPS = [
  "odpt.Operator:Toei",
  "odpt.Operator:JR-Bus-Kanto",
  "odpt.Operator:OdakyuBus",
  "odpt.Operator:KeioBus",
  "odpt.Operator:TokyuBus",
  "odpt.Operator:SeibuBus",
];

type Cache = { at: number; trains: LiveTrainJson[]; stationsAt: number; stations: unknown[]; railways: unknown[] };
const cache = new Map<string, Cache>();
let skyCache: { at: number; flights: LiveTrainJson[] } = { at: 0, flights: [] };
let gtfsCache: { at: number; trains: LiveTrainJson[]; key: string } = { at: 0, trains: [], key: "" };

async function odpt(path: string, key: string, extra = "") {
  const url = `${BASE}/${path}?acl:consumerKey=${encodeURIComponent(key)}${extra}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as Array<Record<string, unknown>>;
  } finally {
    clearTimeout(timer);
  }
}

async function skyFlights() {
  const now = Date.now();
  if (now - skyCache.at < 20_000) return skyCache.flights;
  try {
    const flights = await fetchOpenSky();
    skyCache = { at: now, flights };
    return flights;
  } catch {
    return skyCache.flights;
  }
}

async function gtfsRt(key: string) {
  const now = Date.now();
  if (now - gtfsCache.at < 12_000 && gtfsCache.key === key) return gtfsCache.trains;
  const { trains } = await fetchAllGtfsRt(key);
  gtfsCache = { at: now, trains, key };
  return trains;
}

function busesFromOdpt(rows: Array<Record<string, unknown>>): LiveTrainJson[] {
  const out: LiveTrainJson[] = [];
  for (const b of rows) {
    const id = String(b["owl:sameAs"] ?? b["odpt:busNumber"] ?? "");
    const lng = typeof b["geo:long"] === "number" ? b["geo:long"] : undefined;
    const lat = typeof b["geo:lat"] === "number" ? b["geo:lat"] : undefined;
    if (!id || lng == null || lat == null) continue;
    out.push({
      id: `bus:${id}`,
      railway: String(b["odpt:busroute"] ?? "bus"),
      railwayTitle: String(b["dc:title"] ?? "バス"),
      from: String(b["odpt:fromBusstopPole"] ?? "").split(".").pop() ?? "",
      to: String(b["odpt:toBusstopPole"] ?? "").split(".").pop() ?? "",
      dest: "",
      delaySec: typeof b["odpt:delay"] === "number" ? b["odpt:delay"] : 0,
      lng,
      lat,
      kind: "bus",
      gps: true,
    });
  }
  return out;
}

function mergeRows(parts: LiveTrainJson[][]) {
  const seen = new Set<string>();
  const out: LiveTrainJson[] = [];
  for (const part of parts) {
    for (const row of part) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

function railish(a: string, b: string) {
  const x = a.replace(/[　\s線駅JR]/gu, "");
  const y = b.replace(/[　\s線駅JR]/gu, "");
  if (!x || !y || x.length < 2 || y.length < 2) return false;
  return x === y || x.includes(y) || y.includes(x);
}

function pickPin(
  rows: LiveTrainJson[],
  line: string,
  from: string,
  to: string,
  dest: string,
  lng: number,
  lat: number,
): LiveTrainJson | null {
  let best: LiveTrainJson | null = null;
  let bestScore = 0;
  for (const row of rows) {
    if (row.kind === "flight" || row.kind === "bus") continue;
    let score = 0;
    const title = row.railwayTitle || row.railway || "";
    if (line && railish(title, line)) score += 6;
    if (from && railish(row.from || "", from)) score += 4;
    if (to && railish(row.to || "", to)) score += 4;
    if (dest && railish(row.dest || "", dest)) score += 2;
    if (lng && lat && row.lng != null && row.lat != null) {
      const d = Math.hypot((row.lng - lng) * 91, (row.lat - lat) * 111);
      if (d <= 2.4) score += 10 - d * 2;
      else if (d > 12) continue;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return bestScore >= 6 ? best : null;
}

export const Route = createFileRoute("/api/live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const flightsOnly = url.searchParams.get("flights") === "1";
        const pin = url.searchParams.get("pin") === "1";
        const key = odptKeyFrom(request);
        const now = Date.now();
        const flightsP = skyFlights();
        const diaP = fetchYahooDiaInfo().catch(() => []);
        if (flightsOnly) {
          const [flights, dia] = await Promise.all([flightsP, diaP]);
          return Response.json({
            ok: flights.length > 0,
            source: flights.length ? "live" : "sim",
            trains: flights,
            dia,
          } satisfies LivePayload);
        }
        const gtfsP = gtfsRt(key);
        if (pin) {
          const line = (url.searchParams.get("line") ?? "").trim();
          const from = (url.searchParams.get("from") ?? "").trim();
          const to = (url.searchParams.get("to") ?? "").trim();
          const dest = (url.searchParams.get("dest") ?? "").trim();
          const lng = Number(url.searchParams.get("lng") ?? 0);
          const lat = Number(url.searchParams.get("lat") ?? 0);
          const rows: LiveTrainJson[] = [];
          try {
            const cacheId = request.headers.get("x-odpt-key")?.trim() ? `u:${key.slice(0, 8)}` : "shared";
            const hit = key ? cache.get(cacheId) : undefined;
            if (hit?.trains.length) rows.push(...hit.trains);
            else if (key) {
              const [trainChunks] = await Promise.all([
                Promise.all(OPERATORS.map((op) => odpt("odpt:Train", key, `&odpt:operator=${op}`).catch(() => []))),
              ]);
              const parsed = parseOdptCatalog(trainChunks.flat(), (hit?.stations ?? []) as Array<Record<string, unknown>>, (hit?.railways ?? []) as Array<Record<string, unknown>>);
              rows.push(...parsed);
            }
          } catch {
            /* fall through */
          }
          const [gtfs, dia] = await Promise.all([gtfsP, diaP]);
          rows.push(...gtfs);
          const picked = pickPin(rows, line, from, to, dest, lng, lat);
          return Response.json({
            ok: Boolean(picked),
            source: picked ? "live" : "sim",
            trains: picked ? [picked] : [],
            dia,
          } satisfies LivePayload);
        }
        if (!key) {
          const [flights, gtfs, dia] = await Promise.all([flightsP, gtfsP, diaP]);
          const trains = mergeRows([gtfs, flights]);
          return Response.json({
            ok: trains.length > 0,
            source: gtfs.length ? "live" : flights.length ? "live" : "sim",
            error: trains.length ? undefined : "missing",
            trains,
            dia,
          } satisfies LivePayload);
        }
        const cacheId = request.headers.get("x-odpt-key")?.trim() ? `u:${key.slice(0, 8)}` : "shared";
        const hit = cache.get(cacheId);
        if (hit && now - hit.at < 15_000) {
          const [flights, gtfs, dia] = await Promise.all([flightsP, gtfsP, diaP]);
          return Response.json({
            ok: true,
            source: "odpt",
            trains: mergeRows([hit.trains, gtfs, flights]),
            dia,
          } satisfies LivePayload);
        }
        try {
          let stations = hit?.stations ?? [];
          let railways = hit?.railways ?? [];
          if (!hit || now - hit.stationsAt > 6 * 60 * 60 * 1000) {
            const [st, rw] = await Promise.all([
              Promise.all(OPERATORS.map((op) => odpt("odpt:Station", key, `&odpt:operator=${op}`).catch(() => []))),
              Promise.all(OPERATORS.map((op) => odpt("odpt:Railway", key, `&odpt:operator=${op}`).catch(() => []))),
            ]);
            stations = st.flat();
            railways = rw.flat();
          }
          const [trainChunks, busChunks, flights, gtfs, dia] = await Promise.all([
            Promise.all(OPERATORS.map((op) => odpt("odpt:Train", key, `&odpt:operator=${op}`).catch(() => []))),
            Promise.all(BUS_OPS.map((op) => odpt("odpt:Bus", key, `&odpt:operator=${op}`).catch(() => []))),
            flightsP,
            gtfsP,
            diaP,
          ]);
          const trains = parseOdptCatalog(
            trainChunks.flat(),
            stations as Array<Record<string, unknown>>,
            railways as Array<Record<string, unknown>>,
          ).concat(busesFromOdpt(busChunks.flat()));
          cache.set(cacheId, { at: now, trains, stationsAt: hit?.stationsAt ?? now, stations, railways });
          return Response.json({
            ok: true,
            source: "odpt",
            trains: mergeRows([trains, gtfs, flights]),
            dia,
          } satisfies LivePayload);
        } catch {
          const [flights, gtfs, dia] = await Promise.all([flightsP, gtfsP, diaP]);
          const trains = mergeRows([gtfs, flights]);
          return Response.json({
            ok: trains.length > 0,
            source: trains.length ? "live" : "sim",
            error: "odpt",
            trains,
            dia,
          } satisfies LivePayload);
        }
      },
    },
  },
});
