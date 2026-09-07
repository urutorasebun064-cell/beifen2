export type WxKind = "sun" | "cloud" | "rain" | "snow" | "thunder" | "tornado";

export type WeatherSpot = {
  id: string;
  nameJa: string;
  nameZh: string;
  nameEn: string;
  lng: number;
  lat: number;
  temp: number;
  kind: WxKind;
  intensity: number;
  code: number;
};

export const WEATHER_CITIES: Omit<WeatherSpot, "temp" | "kind" | "intensity" | "code">[] = [
  { id: "sapporo", nameJa: "札幌", nameZh: "札幌", nameEn: "Sapporo", lng: 141.35, lat: 43.06 },
  { id: "kushiro", nameJa: "釧路", nameZh: "钏路", nameEn: "Kushiro", lng: 144.38, lat: 42.98 },
  { id: "sendai", nameJa: "仙台", nameZh: "仙台", nameEn: "Sendai", lng: 140.87, lat: 38.27 },
  { id: "niigata", nameJa: "新潟", nameZh: "新潟", nameEn: "Niigata", lng: 139.04, lat: 37.92 },
  { id: "kanazawa", nameJa: "金沢", nameZh: "金泽", nameEn: "Kanazawa", lng: 136.66, lat: 36.56 },
  { id: "tokyo", nameJa: "東京", nameZh: "东京", nameEn: "Tokyo", lng: 139.76, lat: 35.68 },
  { id: "nagoya", nameJa: "名古屋", nameZh: "名古屋", nameEn: "Nagoya", lng: 136.91, lat: 35.18 },
  { id: "osaka", nameJa: "大阪", nameZh: "大阪", nameEn: "Osaka", lng: 135.5, lat: 34.69 },
  { id: "hiroshima", nameJa: "広島", nameZh: "广岛", nameEn: "Hiroshima", lng: 132.46, lat: 34.39 },
  { id: "kochi", nameJa: "高知", nameZh: "高知", nameEn: "Kochi", lng: 133.53, lat: 33.56 },
  { id: "fukuoka", nameJa: "福岡", nameZh: "福冈", nameEn: "Fukuoka", lng: 130.4, lat: 33.59 },
  { id: "kagoshima", nameJa: "鹿児島", nameZh: "鹿儿岛", nameEn: "Kagoshima", lng: 130.56, lat: 31.6 },
  { id: "naha", nameJa: "那覇", nameZh: "那霸", nameEn: "Naha", lng: 127.68, lat: 26.21 },
];

export function wmoKind(code: number, precip: number, snow: number): { kind: WxKind; intensity: number } {
  if (code === 19) return { kind: "tornado", intensity: 1 };
  if (code >= 95) {
    return { kind: "thunder", intensity: Math.min(1, 0.55 + precip / 5 + 0.25) };
  }
  if (snow > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { kind: "snow", intensity: Math.min(1, 0.4 + snow / 3.5 + (code >= 85 ? 0.25 : 0)) };
  }
  if (precip > 0 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return {
      kind: "rain",
      intensity: Math.min(1, 0.3 + precip / 5 + (code >= 80 ? 0.22 : 0)),
    };
  }
  if (code >= 2) return { kind: "cloud", intensity: 0 };
  return { kind: "sun", intensity: 0 };
}

export function jmaCodeKind(code: string): WxKind {
  const n = Number(code);
  if (n === 19) return "tornado";
  if (n === 28 || (n >= 206 && n <= 209) || (n >= 214 && n <= 219) || (n >= 228 && n <= 229)) return "thunder";
  if (n >= 400 && n < 500) return "snow";
  if ((n >= 300 && n < 400) || n >= 500) return "rain";
  if (n >= 200) return "cloud";
  return "sun";
}

export function wxFalls(kind: WxKind) {
  return kind === "rain" || kind === "snow" || kind === "thunder" || kind === "tornado";
}

export function nearestWeather(spots: WeatherSpot[], lng: number, lat: number) {
  let best: WeatherSpot | null = spots[0] ?? null;
  let d = Infinity;
  for (const s of spots) {
    const dd = (s.lng - lng) ** 2 * 0.7 + (s.lat - lat) ** 2;
    if (dd < d) {
      d = dd;
      best = s;
    }
  }
  return best;
}

export function weatherName(spot: WeatherSpot, lang: "ja" | "zh" | "en") {
  if (lang === "zh") return spot.nameZh;
  if (lang === "en") return spot.nameEn;
  return spot.nameJa;
}

export type WeatherPayload = { ok: boolean; spots: WeatherSpot[]; error?: string };

export async function fetchWeather(): Promise<WeatherPayload> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch("/api/weather", { signal: ctrl.signal });
    const data = (await res.json()) as WeatherPayload;
    return { ok: Boolean(data.ok && data.spots?.length), spots: data.spots ?? [], error: data.error };
  } catch {
    return { ok: false, spots: [], error: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}

export function startWeatherPoll(onTick: (spots: WeatherSpot[]) => void) {
  let cancelled = false;
  const pull = async () => {
    const data = await fetchWeather();
    if (!cancelled && data.spots.length) onTick(data.spots);
  };
  void pull();
  const id = window.setInterval(pull, 3 * 60_000);
  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}

export type WxParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  kind: "rain" | "snow";
  seed: number;
};

function spawn(w: number, h: number, kind: "rain" | "snow", cx: number, cy: number, rad: number, slant: number): WxParticle {
  const ang = Math.random() * Math.PI * 2;
  const r = Math.random() * rad;
  return {
    x: cx + Math.cos(ang) * r,
    y: cy + Math.sin(ang) * r * 0.55 - Math.random() * 40,
    vx: kind === "rain" ? slant : slant * 0.25,
    vy: kind === "rain" ? 520 + Math.random() * 420 : 36 + Math.random() * 40,
    len: kind === "rain" ? 9 + Math.random() * 14 : 1.8 + Math.random() * 2.6,
    kind,
    seed: Math.random() * Math.PI * 2,
  };
}

export function tickWeatherParticles(
  pool: WxParticle[],
  spots: WeatherSpot[],
  project: (lng: number, lat: number) => [number, number],
  w: number,
  h: number,
  zoom: number,
  yaw: number,
  dt: number,
  center: WeatherSpot | null,
) {
  const slant = Math.sin(yaw) * 220 + 90;
  type Zone = { kind: "rain" | "snow"; cx: number; cy: number; rad: number; n: number };
  const zones: Zone[] = [];
  const fillKind =
    center && zoom >= 8.15 && wxFalls(center.kind) ? (center.kind === "snow" ? "snow" : "rain") : null;
  const far = zoom < 7.6;
  if (fillKind && center) {
    const n = Math.round((fillKind === "rain" ? 90 : 180) * (0.45 + center.intensity));
    zones.push({ kind: fillKind, cx: w * 0.5, cy: h * 0.28, rad: Math.max(w, h) * 0.72, n });
  } else {
    for (const s of spots) {
      if (!wxFalls(s.kind)) continue;
      const [x, y] = project(s.lng, s.lat);
      if (x < -80 || y < -80 || x > w + 80 || y > h + 80) continue;
      const fall: "rain" | "snow" = s.kind === "snow" ? "snow" : "rain";
      const rad = (far ? 72 : 42 + (11 - Math.min(11, zoom)) * 18) * (0.75 + s.intensity);
      const n = Math.round((fall === "rain" ? (far ? 55 : 70) : far ? 110 : 48) * (0.45 + s.intensity));
      zones.push({ kind: fall, cx: x, cy: y, rad, n });
    }
  }
  const want = Math.min(far ? 220 : 460, zones.reduce((a, z) => a + z.n, 0));
  if (!want) {
    pool.length = 0;
    return;
  }
  while (pool.length < want) {
    const z = zones[pool.length % zones.length]!;
    pool.push(spawn(w, h, z.kind, z.cx, z.cy, z.rad, slant));
  }
  if (pool.length > want) pool.length = want;
  const gdt = Math.min(0.05, dt);
  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    const z = zones[i % zones.length]!;
    p.kind = z.kind;
    if (p.kind === "snow") {
      p.x += (p.vx + Math.sin(p.seed + p.y * 0.02) * 38) * gdt;
      p.y += p.vy * gdt;
    } else {
      p.x += p.vx * gdt;
      p.y += p.vy * gdt;
    }
    if (p.y > h + 16 || p.x < -30 || p.x > w + 30) {
      const n = spawn(w, h, z.kind, z.cx, z.cy - z.rad * 0.7, z.rad, slant);
      pool[i] = n;
    }
  }
}

export function drawWeatherParticles(g: CanvasRenderingContext2D, pool: WxParticle[], ts: number) {
  if (!pool.length) return;
  g.save();
  g.lineCap = "round";
  for (const p of pool) {
    if (p.kind === "rain") {
      g.strokeStyle = "rgba(210, 232, 245, 0.42)";
      g.lineWidth = 1.35;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.018, p.y - p.len);
      g.stroke();
    } else {
      const flicker = 0.55 + 0.35 * Math.sin(ts * 0.004 + p.seed);
      g.fillStyle = `rgba(236, 244, 252, ${flicker})`;
      g.beginPath();
      g.arc(p.x, p.y, p.len, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

export function weatherVeil(kind: WxKind, intensity: number, zoom = 10) {
  const far = zoom < 7.5 ? 1.55 : 1;
  if (kind === "tornado") return `rgba(48, 28, 12, ${(0.1 + intensity * 0.12) * far})`;
  if (kind === "thunder") return `rgba(8, 10, 28, ${(0.1 + intensity * 0.14) * far})`;
  if (kind === "rain") return `rgba(6, 12, 22, ${(0.06 + intensity * 0.1) * far})`;
  if (kind === "snow") return `rgba(198, 216, 230, ${(0.06 + intensity * 0.1) * far})`;
  if (kind === "cloud") return `rgba(8, 12, 18, ${0.05 * far})`;
  return null;
}
