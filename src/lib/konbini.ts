import { haversine, nearestStationsFrom } from "@/lib/rail/geo";
import type { StationHit } from "@/lib/rail/types";

export type KonbiniBrand = "seven" | "familymart" | "lawson";

export type KonbiniStore = {
  id: string;
  brand: KonbiniBrand;
  name: string;
  nameZh: string;
  nameEn: string;
  lng: number;
  lat: number;
  address: string;
};

export const KONBINI_BRANDS: KonbiniBrand[] = ["seven", "familymart", "lawson"];

export const KONBINI_META: Record<
  KonbiniBrand,
  { ja: string; zh: string; en: string; color: string; short: string; match: RegExp }
> = {
  seven: {
    ja: "セブン-イレブン",
    zh: "7-11",
    en: "7-Eleven",
    color: "#ee7a00",
    short: "7",
    match: /セブン|7-?eleven|7-?11|seven[-\s]?eleven/i,
  },
  familymart: {
    ja: "ファミリーマート",
    zh: "全家",
    en: "FamilyMart",
    color: "#009cd3",
    short: "F",
    match: /ファミリーマート|familymart|ファミマ|family\s*mart/i,
  },
  lawson: {
    ja: "ローソン",
    zh: "罗森",
    en: "Lawson",
    color: "#0068b7",
    short: "L",
    match: /ローソン|lawson/i,
  },
};

export const KONBINI_CHAT_M = 50;
export const KONBINI_MAX = 48;

export function konbiniLabel(store: KonbiniStore, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return store.nameZh;
  if (lang === "en") return store.nameEn;
  return store.name;
}

export function brandOfText(text: string): KonbiniBrand | null {
  const s = text || "";
  if (KONBINI_META.seven.match.test(s)) return "seven";
  if (KONBINI_META.familymart.match.test(s)) return "familymart";
  if (KONBINI_META.lawson.match.test(s)) return "lawson";
  return null;
}

export function metersTo(store: { lng: number; lat: number }, at: { lng: number; lat: number } | null) {
  if (!at) return Infinity;
  return haversine([at.lng, at.lat], [store.lng, store.lat]) * 1000;
}

export function insideKonbiniFence(store: { lng: number; lat: number }, at: { lng: number; lat: number } | null) {
  return metersTo(store, at) <= KONBINI_CHAT_M;
}

/** Same circle as locate: farthest of the nearest stations, at least 700m. */
export function stationRingM(src?: number | { km: number }[] | null) {
  let km = 0.7;
  if (Array.isArray(src) && src.length) km = Math.max(...src.map((r) => r.km), 0.7);
  else if (typeof src === "number" && Number.isFinite(src) && src > 0) km = Math.max(src, 0.7);
  return Math.round(Math.max(700, Math.min(1800, km * 1000)));
}

export function konbiniRingM(
  loc?: { lng: number; lat: number } | null,
  index?: Map<string, StationHit> | null,
  fallback?: { km: number }[] | null,
) {
  if (loc && index && index.size) return stationRingM(nearestStationsFrom(index, loc.lng, loc.lat, 3, 1e9));
  return stationRingM(fallback);
}

export function bboxAround(lng: number, lat: number, meters: number) {
  const pad = meters * 1.4;
  const dlat = pad / 111_000;
  const dlng = pad / (111_000 * Math.max(0.35, Math.cos((lat * Math.PI) / 180)));
  return { west: lng - dlng, east: lng + dlng, south: lat - dlat, north: lat + dlat };
}

type OsmEl = {
  id?: number;
  type?: string;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function fromOsm(el: OsmEl): KonbiniStore | null {
  const lng = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (lng == null || lat == null || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const tags = el.tags ?? {};
  const blob = `${tags.brand ?? ""} ${tags["brand:en"] ?? ""} ${tags.name ?? ""} ${tags["name:en"] ?? ""} ${tags["name:ja"] ?? ""}`;
  const brand = brandOfText(blob);
  if (!brand) return null;
  const meta = KONBINI_META[brand];
  const name = tags.name || meta.ja;
  const branch = tags.branch || "";
  const full = branch && !name.includes(branch) ? `${name} ${branch}` : name;
  const addr = [tags["addr:full"], tags["addr:province"], tags["addr:city"], tags["addr:suburb"], tags["addr:quarter"], tags["addr:neighbourhood"], tags["addr:housenumber"]]
    .filter(Boolean)
    .join("");
  const kind = el.type === "way" ? "way" : el.type === "relation" ? "rel" : "node";
  return {
    id: `osm:${kind}:${el.id ?? `${lng.toFixed(5)},${lat.toFixed(5)}`}`,
    brand,
    name: full,
    nameZh: full.replace("セブン-イレブン", "7-11").replace("セブンイレブン", "7-11").replace("ファミリーマート", "全家").replace("ローソン", "罗森"),
    nameEn: tags["name:en"] || `${meta.en}${branch ? ` ${branch}` : ""}`,
    lng,
    lat,
    address: addr,
  };
}

const OVERPASS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.jp/api/interpreter",
];

function toStore(
  brand: KonbiniBrand,
  lng: number,
  lat: number,
  name: string,
  addr: string,
  id: string,
): KonbiniStore {
  const meta = KONBINI_META[brand];
  return {
    id,
    brand,
    name: name || meta.ja,
    nameZh: (name || meta.ja)
      .replace("セブン-イレブン", "7-11")
      .replace("セブンイレブン", "7-11")
      .replace("ファミリーマート", "全家")
      .replace("ローソン", "罗森"),
    nameEn: meta.en,
    lng,
    lat,
    address: addr,
  };
}

async function fromPhoton(
  bbox: { west: number; south: number; east: number; north: number },
  brand: KonbiniBrand,
  radiusM: number,
  signal?: AbortSignal,
): Promise<KonbiniStore[]> {
  const meta = KONBINI_META[brand];
  const lat = (bbox.south + bbox.north) / 2;
  const lng = (bbox.west + bbox.east) / 2;
  const here = { lng, lat };
  const qs = [meta.ja, meta.en];
  const out: KonbiniStore[] = [];
  const seen = new Set<string>();
  for (const q of qs) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lng}&limit=50&bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
      const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "J-Bmap/1 (konbini)" }, signal });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        features?: Array<{
          geometry?: { coordinates?: number[] };
          properties?: { osm_id?: number; osm_type?: string; name?: string; street?: string; city?: string; district?: string };
        }>;
      };
      for (const f of json.features ?? []) {
        const coords = f.geometry?.coordinates;
        const slng = coords?.[0];
        const slat = coords?.[1];
        if (slng == null || slat == null) continue;
        if (metersTo({ lng: slng, lat: slat }, here) > radiusM) continue;
        const name = f.properties?.name || meta.ja;
        const other = brandOfText(name);
        if (other && other !== brand) continue;
        const id = `osm:${f.properties?.osm_type ?? "node"}:${f.properties?.osm_id ?? `${slng.toFixed(5)},${slat.toFixed(5)}`}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const addr = [f.properties?.city, f.properties?.district, f.properties?.street].filter(Boolean).join("");
        out.push(toStore(brand, slng, slat, name, addr, id));
      }
    } catch {
      /* next query */
    }
  }
  return out;
}

async function fromOverpass(
  bbox: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
): Promise<KonbiniStore[]> {
  const q = `[out:json][timeout:8];nwr["shop"="convenience"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out center 80;`;
  for (const url of OVERPASS) {
    const local = new AbortController();
    const kill = setTimeout(() => local.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "J-Bmap/1 (konbini)" },
        body: `data=${encodeURIComponent(q)}`,
        signal: signal ?? local.signal,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { elements?: OsmEl[] };
      const out: KonbiniStore[] = [];
      const seen = new Set<string>();
      for (const el of json.elements ?? []) {
        const row = fromOsm(el);
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        out.push(row);
      }
      if (out.length) return out;
    } catch {
      /* next mirror */
    } finally {
      clearTimeout(kill);
    }
  }
  return [];
}

async function fromNominatim(
  bbox: { west: number; south: number; east: number; north: number },
  brand: KonbiniBrand,
  radiusM: number,
  signal?: AbortSignal,
): Promise<KonbiniStore[]> {
  const meta = KONBINI_META[brand];
  const here = { lng: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2 };
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(meta.ja)}&format=jsonv2&limit=30&viewbox=${bbox.west},${bbox.north},${bbox.east},${bbox.south}&bounded=1`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "J-Bmap/1 (konbini)" }, signal });
    if (!res.ok) return [];
    const rows = (await res.json()) as Array<{
      osm_id?: number;
      osm_type?: string;
      lat?: string;
      lon?: string;
      name?: string;
      display_name?: string;
    }>;
    const out: KonbiniStore[] = [];
    const seen = new Set<string>();
    for (const r of Array.isArray(rows) ? rows : []) {
      const slng = Number(r.lon);
      const slat = Number(r.lat);
      if (!Number.isFinite(slng) || !Number.isFinite(slat)) continue;
      if (metersTo({ lng: slng, lat: slat }, here) > radiusM) continue;
      const name = r.name || r.display_name?.split(",")[0] || meta.ja;
      const other = brandOfText(name);
      if (other && other !== brand) continue;
      const id = `osm:${r.osm_type ?? "node"}:${r.osm_id ?? `${slng.toFixed(5)},${slat.toFixed(5)}`}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(toStore(brand, slng, slat, name, "", id));
    }
    return out;
  } catch {
    return [];
  }
}

function mergeStores(parts: KonbiniStore[][], here: { lng: number; lat: number }, radiusM: number, brand: KonbiniBrand | "all") {
  const seen = new Set<string>();
  const stores: KonbiniStore[] = [];
  for (const part of parts) {
    for (const row of part) {
      if (brand !== "all" && row.brand !== brand) continue;
      if (metersTo(row, here) > radiusM) continue;
      const key = `${row.brand}|${row.lng.toFixed(5)}|${row.lat.toFixed(5)}`;
      if (seen.has(row.id) || seen.has(key)) continue;
      seen.add(row.id);
      seen.add(key);
      stores.push(row);
    }
  }
  stores.sort((a, b) => metersTo(a, here) - metersTo(b, here));
  return stores.slice(0, KONBINI_MAX);
}

async function fromGoogle(
  bbox: { west: number; south: number; east: number; north: number },
  brand: KonbiniBrand,
  radiusM: number,
  key: string,
  signal?: AbortSignal,
): Promise<KonbiniStore[]> {
  const meta = KONBINI_META[brand];
  const lat = (bbox.south + bbox.north) / 2;
  const lng = (bbox.west + bbox.east) / 2;
  const here = { lng, lat };
  const rad = Math.round(Math.max(200, Math.min(1800, radiusM)));
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${rad}&keyword=${encodeURIComponent(meta.ja)}&language=ja&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{
        place_id?: string;
        name?: string;
        vicinity?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") return [];
    const out: KonbiniStore[] = [];
    const seen = new Set<string>();
    for (const r of json.results ?? []) {
      const slng = r.geometry?.location?.lng;
      const slat = r.geometry?.location?.lat;
      if (slng == null || slat == null) continue;
      if (metersTo({ lng: slng, lat: slat }, here) > radiusM) continue;
      const name = r.name || meta.ja;
      const other = brandOfText(name);
      if (other && other !== brand) continue;
      const id = `g:${r.place_id ?? `${slng.toFixed(5)},${slat.toFixed(5)}`}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(toStore(brand, slng, slat, name, r.vicinity || "", id));
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchKonbiniBbox(
  bbox: { west: number; south: number; east: number; north: number },
  brand: KonbiniBrand | "all",
  radiusM: number,
  signal?: AbortSignal,
  googleKey?: string,
): Promise<KonbiniStore[]> {
  const here = { lng: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2 };
  const brands: KonbiniBrand[] = brand === "all" ? [...KONBINI_BRANDS] : [brand];
  const google = googleKey
    ? await Promise.all(brands.map((b) => fromGoogle(bbox, b, radiusM, googleKey, signal).catch(() => [] as KonbiniStore[])))
    : [];
  const photon = await Promise.all(brands.map((b) => fromPhoton(bbox, b, radiusM, signal).catch(() => [] as KonbiniStore[])));
  const nomi = await Promise.all(brands.map((b) => fromNominatim(bbox, b, radiusM, signal).catch(() => [] as KonbiniStore[])));
  const stores = mergeStores([...google, ...photon, ...nomi], here, radiusM, brand);
  if (stores.length >= 6 || google.some((g) => g.length)) return stores;
  const overpass = await fromOverpass(bbox, signal).catch(() => [] as KonbiniStore[]);
  return mergeStores([overpass, stores], here, radiusM, brand);
}

export function storesOfBrand(stores: KonbiniStore[], brand: KonbiniBrand | "all" | null) {
  if (!brand) return [];
  if (brand === "all") return stores;
  return stores.filter((row) => row.brand === brand);
}

const cache = new Map<string, { at: number; stores: KonbiniStore[] }>();
let inflightKey = "";
let inflight: AbortController | null = null;

export function pullKonbini(
  lng: number,
  lat: number,
  radiusM: number,
  brand: KonbiniBrand | "all" | null,
  apply: (rows: KonbiniStore[], done: boolean) => void,
) {
  if (!brand) {
    apply([], true);
    return;
  }
  const ring = Math.max(700, Math.min(1800, radiusM));
  const box = bboxAround(lng, lat, ring);
  const key = `${brand}|${lng.toFixed(4)}|${lat.toFixed(4)}|${Math.round(ring / 25)}`;
  const allKey = `all|${lng.toFixed(4)}|${lat.toFixed(4)}|${Math.round(ring / 25)}`;
  const hit = cache.get(key);
  const seed =
    (hit?.stores.length ? hit.stores : null) ??
    (brand !== "all" ? storesOfBrand(cache.get(allKey)?.stores ?? [], brand) : []);
  const fresh = hit && Date.now() - hit.at < 45_000 && hit.stores.length > 0;
  if (fresh) {
    apply(hit.stores, true);
    return;
  }
  if (inflightKey === key && inflight) return;
  inflight?.abort();
  const ctrl = new AbortController();
  inflight = ctrl;
  inflightKey = key;
  apply(seed, false);
  const t = window.setTimeout(() => ctrl.abort(), 18000);
  const here = { lng, lat };
  const gkey = typeof window !== "undefined" ? (window.localStorage.getItem("google-key") ?? "").trim() : "";
  void fetch(
    `/api/konbini/stores?brand=${brand}&west=${box.west}&south=${box.south}&east=${box.east}&north=${box.north}&radius=${Math.round(ring)}`,
    { signal: ctrl.signal, headers: gkey ? { "x-google-key": gkey } : {} },
  )
    .then((res) => res.json() as Promise<{ stores?: KonbiniStore[] }>)
    .then((data) => {
      const stores = mergeStores([Array.isArray(data.stores) ? data.stores : []], here, ring, brand);
      if (stores.length) cache.set(key, { at: Date.now(), stores });
      apply(stores.length ? stores : seed, true);
    })
    .catch(() => {
      if (!ctrl.signal.aborted) apply(seed, true);
    })
    .finally(() => {
      window.clearTimeout(t);
      if (inflight === ctrl) {
        inflight = null;
        inflightKey = "";
      }
    });
}
