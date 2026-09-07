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

export const Route = createFileRoute("/api/live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = odptKeyFrom(request);
        const now = Date.now();
        const flightsP = skyFlights();
        const gtfsP = gtfsRt(key);
        const diaP = fetchYahooDiaInfo().catch(() => []);
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
