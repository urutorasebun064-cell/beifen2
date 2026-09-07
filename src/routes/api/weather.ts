import { createFileRoute } from "@tanstack/react-router";
import { jmaCodeKind, WEATHER_CITIES, wmoKind, type WeatherPayload, type WeatherSpot } from "@/lib/weather";

let cache: { at: number; spots: WeatherSpot[] } = { at: 0, spots: [] };

async function pullJson(url: string, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

type MeteoCurrent = {
  latitude: number;
  longitude: number;
  current?: { temperature_2m?: number; weather_code?: number; precipitation?: number; snowfall?: number };
};

async function fromOpenMeteo(): Promise<WeatherSpot[]> {
  const lats = WEATHER_CITIES.map((c) => c.lat).join(",");
  const lngs = WEATHER_CITIES.map((c) => c.lng).join(",");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}&current=temperature_2m,weather_code,precipitation,snowfall&timezone=Asia%2FTokyo`;
  const raw = (await pullJson(url)) as MeteoCurrent | MeteoCurrent[];
  const rows = Array.isArray(raw) ? raw : [raw];
  return WEATHER_CITIES.map((city, i) => {
    const cur = rows[i]?.current ?? {};
    const code = Number(cur.weather_code ?? 0);
    const precip = Number(cur.precipitation ?? 0);
    const snow = Number(cur.snowfall ?? 0);
    const wx = wmoKind(code, precip, snow);
    return {
      ...city,
      temp: Number.isFinite(cur.temperature_2m) ? Number(cur.temperature_2m) : 0,
      kind: wx.kind,
      intensity: wx.intensity,
      code,
    };
  });
}

const JMA_OFFICES: { office: string; cityId: string }[] = [
  { office: "016000", cityId: "sapporo" },
  { office: "040000", cityId: "sendai" },
  { office: "130000", cityId: "tokyo" },
  { office: "230000", cityId: "nagoya" },
  { office: "270000", cityId: "osaka" },
  { office: "340000", cityId: "hiroshima" },
  { office: "400000", cityId: "fukuoka" },
  { office: "471000", cityId: "naha" },
];

async function fromJma(): Promise<WeatherSpot[]> {
  const packs = await Promise.all(
    JMA_OFFICES.map(async (row) => {
      try {
        const data = (await pullJson(`https://www.jma.go.jp/bosai/forecast/data/forecast/${row.office}.json`)) as Array<{
          timeSeries?: Array<{ areas?: Array<{ weatherCodes?: string[]; temps?: string[] }> }>;
        }>;
        const series = data[0]?.timeSeries ?? [];
        const code = series[0]?.areas?.[0]?.weatherCodes?.[0] ?? "100";
        const temps = series.find((s) => s.areas?.[0]?.temps)?.areas?.[0]?.temps ?? [];
        const temp = Number(temps[0] ?? temps[1] ?? NaN);
        return { cityId: row.cityId, code, temp };
      } catch {
        return null;
      }
    }),
  );
  return WEATHER_CITIES.map((city) => {
    const hit = packs.find((p) => p && p.cityId === city.id);
    const kind = hit ? jmaCodeKind(hit.code) : "cloud";
    return {
      ...city,
      temp: hit && Number.isFinite(hit.temp) ? hit.temp : 0,
      kind,
      intensity: kind === "rain" || kind === "snow" || kind === "thunder" || kind === "tornado" ? 0.45 : 0,
      code: Number(hit?.code ?? 0),
    };
  });
}

export const Route = createFileRoute("/api/weather")({
  server: {
    handlers: {
      GET: async () => {
        const now = Date.now();
        if (now - cache.at < 6 * 60_000 && cache.spots.length) {
          return Response.json({ ok: true, spots: cache.spots } satisfies WeatherPayload);
        }
        try {
          const spots = await fromOpenMeteo();
          cache = { at: now, spots };
          return Response.json({ ok: true, spots } satisfies WeatherPayload);
        } catch {
          try {
            const spots = await fromJma();
            cache = { at: now, spots };
            return Response.json({ ok: true, spots } satisfies WeatherPayload);
          } catch {
            return Response.json({
              ok: cache.spots.length > 0,
              spots: cache.spots,
              error: "upstream",
            } satisfies WeatherPayload);
          }
        }
      },
    },
  },
});
