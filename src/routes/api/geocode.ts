import { createFileRoute } from "@tanstack/react-router";
import { mapboxKeyFrom } from "@/lib/rail/keys.server";

type Place = { name: string; lng: number; lat: number; prefecture: string };

const cache = new Map<string, { at: number; places: Place[] }>();

function inJapan(lng: number, lat: number) {
  return lng > 122 && lng < 154 && lat > 24 && lat < 46;
}

function prefOf(blob: string) {
  const m = blob.match(/((?:北海道)|(?:東京都)|(?:大阪府)|(?:京都府)|(?:[\u4e00-\u9fff]{2,3}[都道府県]))/);
  return m ? m[1]! : "";
}

function take(list: Place[], q: string) {
  const seen = new Set<string>();
  const out: Place[] = [];
  const stationQ = /駅$|站$/.test(q.trim());
  const scored = list
    .filter((p) => inJapan(p.lng, p.lat) && p.name)
    .map((p) => {
      let s = 4;
      if (p.name === q) s = 0;
      else if (p.name.includes(q) || q.includes(p.name.replace(/[都道府県]/g, ""))) s = 1;
      else if (/丁目|番地|番/.test(q) && /丁目|番地/.test(p.name)) s = 0;
      if (/駅$/.test(p.name) && !stationQ) s += 8;
      return { p, s };
    })
    .sort((a, b) => a.s - b.s);
  for (const { p } of scored) {
    const k = `${p.name}|${p.lng.toFixed(5)}|${p.lat.toFixed(5)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

async function fromGsi(q: string): Promise<Place[]> {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "J-Bmap/1 (place-search)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    geometry?: { coordinates?: number[] };
    properties?: { title?: string };
  }>;
  const out: Place[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const slng = Number(r.geometry?.coordinates?.[0]);
    const slat = Number(r.geometry?.coordinates?.[1]);
    if (!Number.isFinite(slng) || !Number.isFinite(slat)) continue;
    const title = (r.properties?.title || q).trim();
    out.push({ name: title.slice(0, 60), lng: slng, lat: slat, prefecture: prefOf(title) });
  }
  return out;
}

async function fromNominatim(q: string, lat: number, lng: number): Promise<Place[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "jp");
  url.searchParams.set("limit", "8");
  url.searchParams.set("accept-language", "ja");
  if (Number.isFinite(lat) && Number.isFinite(lng) && inJapan(lng, lat)) {
    url.searchParams.set("viewbox", `${lng - 0.45},${lat + 0.38},${lng + 0.45},${lat - 0.38}`);
    url.searchParams.set("bounded", "0");
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "J-Bmap/1 (place-search)" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{
    lat?: string;
    lon?: string;
    name?: string;
    display_name?: string;
    address?: Record<string, string>;
  }>;
  const out: Place[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const slat = Number(r.lat);
    const slng = Number(r.lon);
    if (!Number.isFinite(slat) || !Number.isFinite(slng)) continue;
    const name = (r.name || r.display_name?.split(",")[0] || q).trim().slice(0, 48);
    const blob = `${r.address?.state ?? ""} ${r.address?.region ?? ""} ${r.display_name ?? ""}`;
    out.push({ name, lng: slng, lat: slat, prefecture: prefOf(blob) });
  }
  return out;
}

async function fromPhoton(q: string, lat: number, lng: number): Promise<Place[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  if (Number.isFinite(lat) && Number.isFinite(lng) && inJapan(lng, lat)) {
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: number[] };
      properties?: { name?: string; city?: string; state?: string; countrycode?: string };
    }>;
  };
  const out: Place[] = [];
  for (const f of json.features ?? []) {
    const slng = Number(f.geometry?.coordinates?.[0]);
    const slat = Number(f.geometry?.coordinates?.[1]);
    if (!Number.isFinite(slng) || !Number.isFinite(slat)) continue;
    const cc = (f.properties?.countrycode ?? "").toUpperCase();
    if (cc && cc !== "JP") continue;
    const name = (f.properties?.name || q).trim().slice(0, 48);
    out.push({ name, lng: slng, lat: slat, prefecture: prefOf(`${f.properties?.state ?? ""} ${f.properties?.city ?? ""}`) });
  }
  return out;
}

async function fromMapbox(q: string, lat: number, lng: number, token: string): Promise<Place[]> {
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("country", "jp");
  url.searchParams.set("language", "ja");
  url.searchParams.set("limit", "8");
  url.searchParams.set("types", "poi,address,place,locality,neighborhood");
  if (Number.isFinite(lat) && Number.isFinite(lng) && inJapan(lng, lat)) {
    url.searchParams.set("proximity", `${lng},${lat}`);
  }
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    features?: Array<{
      place_name?: string;
      text?: string;
      center?: number[];
      context?: Array<{ id?: string; text?: string }>;
    }>;
  };
  const out: Place[] = [];
  for (const f of json.features ?? []) {
    const slng = Number(f.center?.[0]);
    const slat = Number(f.center?.[1]);
    if (!Number.isFinite(slng) || !Number.isFinite(slat)) continue;
    const region = (f.context ?? []).map((c) => c.text ?? "").join(" ");
    out.push({ name: (f.text || f.place_name?.split(",")[0] || q).trim().slice(0, 48), lng: slng, lat: slat, prefecture: prefOf(`${region} ${f.place_name ?? ""}`) });
  }
  return out;
}

export const Route = createFileRoute("/api/geocode")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
        const lat = Number(url.searchParams.get("lat") ?? 0);
        const lng = Number(url.searchParams.get("lng") ?? 0);
        if (q.length < 1) return Response.json({ ok: true, places: [] });
        const cacheId = `${q}|${lat.toFixed(2)}|${lng.toFixed(2)}`;
        const hit = cache.get(cacheId);
        if (hit && Date.now() - hit.at < (hit.places.length ? 45_000 : 2_000)) return Response.json({ ok: true, places: hit.places });
        try {
          const token = mapboxKeyFrom(request);
          const parts = await Promise.all([
            fromGsi(q).catch(() => [] as Place[]),
            fromNominatim(q, lat, lng).catch(() => [] as Place[]),
            fromPhoton(q, lat, lng).catch(() => [] as Place[]),
            token ? fromMapbox(q, lat, lng, token).catch(() => [] as Place[]) : Promise.resolve([] as Place[]),
          ]);
          const places = take(parts.flat(), q);
          cache.set(cacheId, { at: Date.now(), places });
          return Response.json({ ok: true, places });
        } catch {
          return Response.json({ ok: true, places: [] });
        }
      },
    },
  },
});
