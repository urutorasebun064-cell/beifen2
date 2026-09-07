import { AIRPORTS, type Airport } from "@/data/flights";
import { bearingDeg, haversine } from "./geo";
import type { LiveTrainJson } from "./live";

type RawAir = { id: string; call: string; lng: number; lat: number; track: number };

function headingDelta(track: number, brng: number) {
  let d = Math.abs(brng - track) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function nearestAirport(lng: number, lat: number, skip?: string) {
  let best = AIRPORTS[0]!;
  let bestD = Infinity;
  for (const ap of AIRPORTS) {
    if (skip && ap.n === skip) continue;
    const d = haversine([lng, lat], [ap.lng, ap.lat]);
    if (d < bestD) {
      bestD = d;
      best = ap;
    }
  }
  return { ap: best, km: bestD };
}

function airportByHeading(lng: number, lat: number, track: number, mode: "ahead" | "behind") {
  let best: Airport | null = null;
  let bestScore = Infinity;
  for (const ap of AIRPORTS) {
    const km = haversine([lng, lat], [ap.lng, ap.lat]);
    if (km < 22) continue;
    const brng = bearingDeg([lng, lat], [ap.lng, ap.lat]);
    const d = headingDelta(track, brng);
    const aligned = mode === "ahead" ? d <= 48 : d >= 132;
    if (!aligned) continue;
    const score = (mode === "ahead" ? d : 180 - d) + Math.min(km, 9000) / 140;
    if (score < bestScore) {
      bestScore = score;
      best = ap;
    }
  }
  return best;
}

function toJson(rows: RawAir[]): LiveTrainJson[] {
  const out: LiveTrainJson[] = [];
  for (const row of rows) {
    const dest = airportByHeading(row.lng, row.lat, row.track, "ahead");
    const origin = airportByHeading(row.lng, row.lat, row.track, "behind");
    const near = nearestAirport(row.lng, row.lat, dest?.n);
    const from = origin && origin.n !== dest?.n ? origin.n : near.ap.n;
    const to = dest && dest.n !== from ? dest.n : nearestAirport(row.lng, row.lat, from).ap.n;
    out.push({
      id: `air:${row.id}`,
      railway: "flight",
      railwayTitle: row.call,
      from,
      to,
      dest: to,
      delaySec: 0,
      lng: row.lng,
      lat: row.lat,
      bearing: row.track,
      kind: "flight",
    });
    if (out.length >= 140) break;
  }
  return out;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function fromAdsb(): Promise<RawAir[]> {
  const hubs = [
    [35.68, 139.76],
    [34.86, 136.81],
    [34.75, 135.44],
    [33.59, 130.45],
    [43.06, 141.35],
    [26.2, 127.65],
  ];
  const chunks = await Promise.all(
    hubs.map(([lat, lon]) =>
      getJson(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/220`).catch(() => null),
    ),
  );
  const seen = new Set<string>();
  const buckets: RawAir[][] = hubs.map(() => []);
  chunks.forEach((chunk, i) => {
    const ac = (chunk as { ac?: Array<Record<string, unknown>> } | null)?.ac ?? [];
    const bucket = buckets[i]!;
    for (const a of ac) {
      const hex = String(a.hex ?? "");
      const lng = typeof a.lon === "number" ? a.lon : null;
      const lat = typeof a.lat === "number" ? a.lat : null;
      if (!hex || lng == null || lat == null || seen.has(hex)) continue;
      if (a.alt_baro === "ground") continue;
      seen.add(hex);
      bucket.push({
        id: hex,
        call: String(a.flight ?? a.r ?? hex).trim(),
        lng,
        lat,
        track: typeof a.track === "number" ? a.track : 0,
      });
      if (bucket.length >= 40) break;
    }
  });
  const out: RawAir[] = [];
  let more = true;
  while (more) {
    more = false;
    for (const bucket of buckets) {
      const row = bucket.shift();
      if (!row) continue;
      more = true;
      out.push(row);
    }
  }
  return out;
}

async function fromOpenSky(): Promise<RawAir[]> {
  const data = (await getJson(
    "https://opensky-network.org/api/states/all?lamin=24.2&lomin=122.9&lamax=45.6&lomax=146.0",
  )) as { states?: Array<Array<string | number | boolean | null>> | null };
  const out: RawAir[] = [];
  for (const row of data.states ?? []) {
    const lng = typeof row[5] === "number" ? row[5] : null;
    const lat = typeof row[6] === "number" ? row[6] : null;
    if (lng == null || lat == null || row[8] === true) continue;
    out.push({
      id: String(row[0] ?? out.length),
      call: String(row[1] ?? row[0] ?? "ICAO").trim(),
      lng,
      lat,
      track: typeof row[10] === "number" ? row[10] : 0,
    });
  }
  return out;
}

export async function fetchOpenSky(): Promise<LiveTrainJson[]> {
  try {
    const adsb = await fromAdsb();
    if (adsb.length) return toJson(adsb);
  } catch {
    /* try opensky */
  }
  try {
    const sky = await fromOpenSky();
    if (sky.length) return toJson(sky);
  } catch {
    /* empty */
  }
  return [];
}
