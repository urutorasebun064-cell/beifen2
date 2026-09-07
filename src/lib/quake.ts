export type Quake = {
  id: string;
  at: number;
  time: string;
  place: string;
  placeEn: string;
  mag: number;
  shindo: string;
  shindoRank: number;
  lng: number;
  lat: number;
  depthKm: number;
};

export type QuakePayload = { ok: boolean; quakes: Quake[]; error?: string };

const SHINDO_FROM_MAXI: Record<string, { label: string; rank: number }> = {
  "1": { label: "1", rank: 1 },
  "2": { label: "2", rank: 2 },
  "3": { label: "3", rank: 3 },
  "4": { label: "4", rank: 4 },
  "5-": { label: "5弱", rank: 5 },
  "5+": { label: "5強", rank: 6 },
  "6-": { label: "6弱", rank: 7 },
  "6+": { label: "6強", rank: 8 },
  "7": { label: "7", rank: 9 },
};

export function scaleToShindo(scale: number) {
  if (scale >= 70) return { label: "7", rank: 9 };
  if (scale >= 60) return { label: "6強", rank: 8 };
  if (scale >= 55) return { label: "6弱", rank: 7 };
  if (scale >= 50) return { label: "5強", rank: 6 };
  if (scale >= 45) return { label: "5弱", rank: 5 };
  if (scale >= 40) return { label: "4", rank: 4 };
  if (scale >= 30) return { label: "3", rank: 3 };
  if (scale >= 20) return { label: "2", rank: 2 };
  if (scale >= 10) return { label: "1", rank: 1 };
  return { label: "0", rank: 0 };
}

export function maxiToShindo(maxi: string) {
  return SHINDO_FROM_MAXI[maxi] ?? { label: maxi || "—", rank: 0 };
}

export function shindoColor(rank: number) {
  if (rank >= 8) return "#f472b6";
  if (rank >= 7) return "#ef4444";
  if (rank >= 6) return "#f97316";
  if (rank >= 5) return "#fb923c";
  if (rank >= 4) return "#fbbf24";
  if (rank >= 3) return "#facc15";
  if (rank >= 2) return "#7dd3fc";
  return "#94a3b8";
}

export function parseCod(cod: string): { lat: number; lng: number; depthKm: number } | null {
  const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+)/.exec(cod);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  const raw = Number(m[3]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const depthKm = Math.abs(raw) >= 200 ? Math.abs(raw) / 1000 : Math.abs(raw);
  return { lat, lng, depthKm };
}

function tokyoClock(ms: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

function parseMag(raw: unknown) {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && n > 0 && n < 12 ? n : null;
}

type JmaRow = {
  eid?: string;
  at?: string;
  anm?: string;
  en_anm?: string;
  mag?: string;
  maxi?: string;
  cod?: string;
};

export function parseJmaList(rows: JmaRow[], limit = 5): Quake[] {
  const seen = new Set<string>();
  const out: Quake[] = [];
  for (const row of rows) {
    const mag = parseMag(row.mag);
    const geo = row.cod ? parseCod(row.cod) : null;
    if (!mag || !geo) continue;
    const id = String(row.eid || row.at || `${geo.lat},${geo.lng},${mag}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const at = Date.parse(row.at ?? "") || Date.now();
    const shindo = maxiToShindo(String(row.maxi ?? ""));
    out.push({
      id,
      at,
      time: tokyoClock(at),
      place: row.anm || "震源",
      placeEn: row.en_anm || row.anm || "Epicenter",
      mag,
      shindo: shindo.label,
      shindoRank: shindo.rank,
      lng: geo.lng,
      lat: geo.lat,
      depthKm: geo.depthKm,
    });
    if (out.length >= limit) break;
  }
  return out;
}

type P2PRow = {
  id?: string;
  earthquake?: {
    time?: string;
    maxScale?: number;
    hypocenter?: { name?: string; latitude?: number; longitude?: number; magnitude?: number; depth?: number };
  };
};

export function parseP2pList(rows: P2PRow[], limit = 5): Quake[] {
  const out: Quake[] = [];
  for (const row of rows) {
    const h = row.earthquake?.hypocenter;
    const mag = parseMag(h?.magnitude);
    if (!h || mag == null || h.latitude == null || h.longitude == null) continue;
    const at = Date.parse(String(row.earthquake?.time ?? "").replaceAll("/", "-").replace(" ", "T") + "+09:00") || Date.now();
    const shindo = scaleToShindo(row.earthquake?.maxScale ?? 0);
    out.push({
      id: String(row.id || `${h.latitude},${h.longitude},${at}`),
      at,
      time: tokyoClock(at),
      place: h.name || "震源",
      placeEn: h.name || "Epicenter",
      mag,
      shindo: shindo.label,
      shindoRank: shindo.rank,
      lng: h.longitude,
      lat: h.latitude,
      depthKm: typeof h.depth === "number" ? h.depth : 10,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function fetchQuakes(): Promise<QuakePayload> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("/api/quake", { signal: ctrl.signal });
    const data = (await res.json()) as QuakePayload;
    if (!data.ok) return { ok: false, quakes: data.quakes ?? [], error: data.error ?? "quake" };
    return { ok: true, quakes: data.quakes.slice(0, 5) };
  } catch {
    return { ok: false, quakes: [], error: "timeout" };
  } finally {
    clearTimeout(timer);
  }
}

export function startQuakePoll(onTick: (next: Quake[]) => void) {
  let cancelled = false;
  const pull = async () => {
    const data = await fetchQuakes();
    if (cancelled) return;
    if (data.quakes.length) onTick(data.quakes);
  };
  void pull();
  const id = window.setInterval(pull, 30_000);
  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}
