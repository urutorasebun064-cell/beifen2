const R = 6371;

export const NODA = { lng: 139.875, lat: 35.955 };
export const NEAR_STATION_KM = 1.8;

export function haversine(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a[1]);
  const φ2 = toRad(b[1]);
  const Δλ = toRad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function lerpCoord(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function pointAlong(
  path: [number, number][],
  cum: number[],
  totalKm: number,
  t: number,
): { coord: [number, number]; bearing: number; seg: number } {
  if (path.length < 2 || totalKm <= 0) {
    return { coord: path[0] ?? [0, 0], bearing: 0, seg: 0 };
  }
  const dist = Math.max(0, Math.min(1, t)) * totalKm;
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1]! <= dist) i++;
  const segLen = Math.max(1e-6, (cum[i + 1] ?? totalKm) - (cum[i] ?? 0));
  const local = (dist - (cum[i] ?? 0)) / segLen;
  const a = path[i] ?? path[0]!;
  const b = path[i + 1] ?? a;
  return { coord: lerpCoord(a, b, local), bearing: bearingDeg(a, b), seg: i };
}

export function dateAtTokyoClock(hhmm: string, base = new Date()): Date {
  const [hh, mm] = hhmm.split(":").map(Number);
  const cur = tokyoParts(base);
  const target = (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0);
  const curMin = cur.hour * 60 + cur.minute;
  return new Date(base.getTime() + (target - curMin) * 60_000 - cur.second * 1000);
}

export function tokyoParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));
  return {
    hour,
    minute,
    second,
    minutes: hour * 60 + minute + second / 60,
    weekday: get("weekday"),
    hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    hhmmss: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}

export function isInJapan(lng: number, lat: number): boolean {
  return lng > 122.5 && lng < 154 && lat > 20 && lat < 46.2;
}

export function inBounds(
  lng: number,
  lat: number,
  b: { west: number; south: number; east: number; north: number },
  pad = 0,
) {
  return lng >= b.west - pad && lng <= b.east + pad && lat >= b.south - pad && lat <= b.north + pad;
}

export function formatUntil(minutesUntil: number, arriving: string, minLabel: string, departed?: string): string {
  if (minutesUntil < -0.6) return `${departed ?? arriving} ${Math.round(-minutesUntil)}${minLabel}`;
  if (minutesUntil <= 0.2) return departed ?? arriving;
  if (minutesUntil < 0.85) return arriving;
  if (minutesUntil < 1.5) return `1${minLabel}`;
  return `${Math.round(minutesUntil)}${minLabel}`;
}

export function arriveHhmmOf(train: { etaMin?: number; arrUnix?: number; alightHhmm?: string }, now = new Date()) {
  if (train.alightHhmm && /^\d{1,2}:\d{2}$/.test(train.alightHhmm)) return train.alightHhmm;
  if (train.etaMin != null && Number.isFinite(train.etaMin)) {
    return toHhmm(tokyoParts(now).minutes + Math.max(0, train.etaMin));
  }
  if (train.arrUnix && train.arrUnix > 1_000) return tokyoParts(new Date(train.arrUnix * 1000)).hhmm;
  return "";
}

export function parseHhmmMin(s?: string): number | null {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes until a locked clock time. Keeps now+eta constant so the arrival minute does not flicker. */
export function etaFromHhmm(hhmm: string | undefined, now = new Date(), delayMin = 0): number | undefined {
  const plan = parseHhmmMin(hhmm);
  if (plan == null) return undefined;
  const nowMin = tokyoParts(now).minutes;
  let d = plan + delayMin - nowMin;
  if (d < -720) d += 1440;
  if (d > 1260) d -= 1440;
  return Math.max(0, d);
}

export function toHhmm(minutesFromMidnight: number): string {
  let m = ((Math.round(minutesFromMidnight) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function nearestStationsFrom<T extends { lng: number; lat: number }>(
  index: Map<string, T>,
  lng: number,
  lat: number,
  count = 2,
  maxKm = NEAR_STATION_KM,
) {
  const rows = [...index.values()].map((station) => ({
    station,
    km: haversine([lng, lat], [station.lng, station.lat]),
  }));
  rows.sort((a, b) => a.km - b.km);
  return rows.filter((r) => r.km <= maxKm).slice(0, count);
}

export function stationsNearPlace<T extends { lng: number; lat: number }>(
  index: Map<string, T>,
  lng: number,
  lat: number,
  count = 2,
) {
  return nearestStationsFrom(index, lng, lat, count, 1e9);
}

export function walkMinutes(km: number) {
  return Math.max(1, Math.round((km * 1000) / 80));
}

export function formatKm(km: number) {
  if (km < 0.095) return `${Math.max(1, Math.round(km * 1000))}m`;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

export function compass8(deg: number, lang: "ja" | "zh" | "en") {
  const i = Math.round(((((deg % 360) + 360) % 360) / 45)) % 8;
  if (lang === "zh") return ["北", "东北", "东", "东南", "南", "西南", "西", "西北"][i]!;
  if (lang === "en") return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][i]!;
  return ["北", "北東", "東", "南東", "南", "南西", "西", "北西"][i]!;
}
