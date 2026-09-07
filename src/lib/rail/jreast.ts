import { tokyoParts } from "./geo";
import { lineSlots, stopFrac } from "./simulate";
import type { Departure, LineRuntime, StationHit, Train } from "./types";

export type JrBoardItem = {
  lineName: string;
  dest: string;
  hhmm: string;
  minutesUntil: number;
  dirHint: string;
};

const BASE = "https://timetables.jreast.co.jp";
const UA = "Mozilla/5.0 (compatible; Densha3D/1.0; +https://jreast.co.jp/timetable)";

const DEST_MARK: Record<string, string> = {
  新: "新大阪",
  博: "博多",
  仙: "仙台",
  秋: "秋田",
  山: "山形",
  新潟: "新潟",
  金: "金沢",
  敦: "敦賀",
  長: "長野",
  熱: "熱海",
  修: "修善寺",
  沼: "沼津",
  小: "小田原",
  品: "品川",
  横浜: "横浜",
  青: "青梅",
  高: "高尾",
  八: "八王子",
  松: "松本",
  千葉: "千葉",
  成: "成田空港",
  大船: "大船",
  新宿: "新宿",
  池: "池袋",
  上野: "上野",
  大宮: "大宮",
  高崎: "高崎",
  宇: "宇都宮",
  取: "取手",
};

function expandDest(raw: string, dirHint: string): string {
  const hint = dirHint.replace(/方面.*/, "").replace(/[（(].*/, "").split("・")[0]?.trim() ?? dirHint;
  if (!raw || raw === "無印") return hint || dirHint;
  const first = raw.split(/[,、]/)[0]!.trim();
  return DEST_MARK[first] ?? (first.length >= 2 ? first : hint || first);
}

export function untilFromHhmm(hhmm: string, nowMin: number): number {
  const [h, m] = hhmm.split(":").map(Number);
  const dep = (h ?? 0) * 60 + (m ?? 0);
  let d = dep - nowMin;
  if (d < -90) d += 1440;
  if (d > 1260) d -= 1440;
  return d;
}

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

export async function searchJrStation(name: string): Promise<{ id: string; name: string } | null> {
  const q = name.replace(/駅$/u, "").trim();
  if (!q) return null;
  const params = new URLSearchParams({ mode: "0", ekimei: q });
  const html = await fetchText(`${BASE}/cgi-bin/st_search.cgi?${params}`);
  const hits = [...html.matchAll(/href="\/timetable\/list(\d+)\.html">([^<]+)</g)].map((h) => ({
    id: h[1]!,
    label: h[2]!,
    name: h[2]!.replace(/[（(].*/u, "").replace(/駅$/u, "").trim(),
  }));
  const exact = hits.find((h) => h.name === q);
  if (exact) return { id: exact.id, name: exact.name };
  const real = hits.filter((h) => /[（(]/u.test(h.label));
  const starts = real.find((h) => h.name.startsWith(q) || q.startsWith(h.name));
  if (starts) return { id: starts.id, name: starts.name };
  if (real[0]) return { id: real[0].id, name: real[0].name };
  return null;
}

export function parseJrList(html: string, holiday: boolean): Array<{ lineName: string; dest: string; href: string }> {
  const out: Array<{ lineName: string; dest: string; href: string }> = [];
  const re =
    /<tr>\s*<th>([^<]+)<\/th>\s*<td>([^<]*)<\/td>\s*<td class="weekday"><a href="([^"]+)"[^>]*>平日<\/a><\/td>\s*<td class="holiday"><a href="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out.push({ lineName: m[1]!.trim(), dest: m[2]!.trim(), href: holiday ? m[4]! : m[3]! });
  }
  return out;
}

export function resolveJrHref(href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return BASE + href;
  return `${BASE}/${href.replace(/^\.\.\//, "")}`;
}

export function parseJrTimes(html: string, lineName: string, dirHint: string, nowMin: number): JrBoardItem[] {
  const out: JrBoardItem[] = [];
  const hourBlocks = html.split(/<tr id="time_(\d+)">/);
  for (let i = 1; i < hourBlocks.length; i += 2) {
    const hour = Number(hourBlocks[i]);
    const chunk = hourBlocks[i + 1] ?? "";
    const mins = [...chunk.matchAll(/data-dest="([^"]*)"[^>]*>[\s\S]{0,280}?<span class="minute">(\d{1,2})<\/span>/g)];
    for (const row of mins) {
      const minute = Number(row[2]);
      let dep = hour * 60 + minute;
      if (hour < 3) dep += 24 * 60;
      let until = dep - nowMin;
      if (until < -80) until += 24 * 60;
      if (until < -80 || until > 90) continue;
      out.push({
        lineName,
        dest: expandDest(row[1] ?? "", dirHint),
        hhmm: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        minutesUntil: until,
        dirHint,
      });
    }
  }
  return out.sort((a, b) => a.minutesUntil - b.minutesUntil);
}

export function matchJrLine(lines: LineRuntime[], name: string): LineRuntime | null {
  const n = name.replace(/^JR/u, "").replace(/線$/u, "");
  let best: LineRuntime | null = null;
  let bestScore = 0;
  for (const line of lines) {
    if (line.kind !== "jr" && line.kind !== "shinkansen") continue;
    const ln = line.name.replace(/^JR/u, "").replace(/線$/u, "");
    let score = 0;
    if (ln === n || line.name === name) score = 10;
    else if (ln.includes(n) || n.includes(ln)) score = 6;
    else if (n.split("・").some((p) => p && ln.includes(p.replace(/線$/u, "")))) score = 5;
    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }
  return bestScore >= 5 ? best : null;
}

export function jrItemsToDepartures(items: JrBoardItem[], station: StationHit): Departure[] {
  return items
    .filter((d) => d.minutesUntil >= 0)
    .slice(0, 24)
    .map((it, i) => {
      const line = matchJrLine(station.lines, it.lineName);
      return {
        id: `jr:${it.lineName}:${it.hhmm}:${i}`,
        lineId: line?.id ?? it.lineName,
        lineName: line?.name ?? it.lineName,
        color: line?.color ?? "#00b2e5",
        dest: it.dest,
        dir: it.dirHint.includes("上り") || it.dirHint.includes("内回") || it.dirHint.includes("北行") ? 1 : 0,
        minutesUntil: it.minutesUntil,
        hhmm: it.hhmm,
        delayMin: 0,
        trainId: `jr:${line?.id ?? it.lineName}:${it.hhmm}:${it.dirHint.includes("上り") || it.dirHint.includes("内回") || it.dirHint.includes("北行") ? 1 : 0}`,
        prevStop: station.name,
        nextStop: it.dest,
      };
    });
}

export function jrItemsToTrains(items: JrBoardItem[], station: StationHit, minutes: number): Train[] {
  const out: Train[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const line = matchJrLine(station.lines, it.lineName);
    if (!line) continue;
    const idx = line.stops.findIndex((s) => s.n === station.name);
    if (idx < 0) continue;
    const dir: 0 | 1 = it.dirHint.includes("上り") || it.dirHint.includes("内回") || it.dirHint.includes("北行") ? 1 : 0;
    const { oneWayMin } = lineSlots(line, minutes);
    const elapsed = -it.minutesUntil;
    if (elapsed > oneWayMin) continue;
    const f0 = stopFrac(line, idx);
    let t = dir === 1 && !line.loop ? f0 - elapsed / Math.max(1, oneWayMin) : f0 + elapsed / Math.max(1, oneWayMin);
    if (line.loop) t = ((t % 1) + 1) % 1;
    else t = Math.max(0, Math.min(1, t));
    const id = `jr:${line.id}:${it.hhmm}:${dir}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const km = t * line.totalKm;
    let coord: [number, number] = [station.lng, station.lat];
    const path = line.path;
    if (path.length && line.cum.length) {
      let i = 0;
      while (i < line.cum.length - 1 && (line.cum[i + 1] ?? 0) < km) i += 1;
      const a = path[i] ?? path[0]!;
      const b = path[i + 1] ?? a;
      const seg = Math.max(1e-6, (line.cum[i + 1] ?? km) - (line.cum[i] ?? 0));
      const u = (km - (line.cum[i] ?? 0)) / seg;
      coord = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    }
    out.push({
      id,
      lineId: line.id,
      lineName: line.name,
      color: line.color,
      kind: line.kind,
      lng: coord[0],
      lat: coord[1],
      bearing: 0,
      dir,
      dest: it.dest,
      nextStop: it.dest,
      prevStop: station.name,
      delayMin: 0,
      progress: t,
      stopIndex: idx,
    });
    if (out.length >= 48) break;
  }
  return out;
}

export function isHoliday(now = new Date()): boolean {
  const { weekday } = tokyoParts(now);
  return weekday === "Sat" || weekday === "Sun";
}
