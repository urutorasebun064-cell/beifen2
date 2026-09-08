import { createFileRoute } from "@tanstack/react-router";
import { tokyoParts } from "@/lib/rail/geo";
import { journeysFromYahoo, fetchYahooDiaInfo, stampYahooDia } from "@/lib/rail/yahoo";
import type { Journey, RouteStop } from "@/lib/rail/types";

const cache = new Map<string, { at: number; journey: unknown; journeys: unknown }>();

function ymdTokyo(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function yahooName(name: string, pf: string) {
  const n = name.replace(/駅$/u, "").trim();
  const p = pf.trim();
  return p ? `${n}(${p})` : n;
}

async function yahooPage(
  from: string,
  to: string,
  y: string,
  mo: string,
  d: string,
  hh: number,
  mm: number,
  type: string,
  origin: RouteStop,
  dest: RouteStop,
): Promise<Journey[]> {
  const qs = new URLSearchParams({
    from,
    to,
    y,
    m: mo,
    d,
    hh: String(hh).padStart(2, "0"),
    m1: String(Math.floor(mm / 10)),
    m2: String(mm % 10),
    type,
    ticket: "ic",
    expkind: "1",
    ws: "3",
    s: "0",
    al: "1",
    shin: "1",
    ex: "1",
    hb: "1",
  });
  const res = await fetch(`https://transit.yahoo.co.jp/search/result?${qs}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "ja",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  return journeysFromYahoo(await res.text(), origin, dest);
}

export const Route = createFileRoute("/api/transit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const from = (url.searchParams.get("from") ?? "").trim();
        const to = (url.searchParams.get("to") ?? "").trim();
        const olat = Number(url.searchParams.get("olat") ?? 0);
        const olng = Number(url.searchParams.get("olng") ?? 0);
        const dlat = Number(url.searchParams.get("dlat") ?? 0);
        const dlng = Number(url.searchParams.get("dlng") ?? 0);
        const opf = (url.searchParams.get("opf") ?? "").trim();
        const dpf = (url.searchParams.get("dpf") ?? "").trim();
        if (!from || !to) return Response.json({ ok: false, error: "missing" });
        const clock = tokyoParts();
        const rawType = url.searchParams.get("type") ?? "1";
        const type = rawType === "4" || rawType === "3" || rawType === "2" ? rawType : "1";
        const hh = type === "1" ? clock.hour : Number(url.searchParams.get("hh") ?? clock.hour);
        const mm = type === "1" ? clock.minute : Number(url.searchParams.get("mm") ?? clock.minute);
        const qmin = hh * 60 + mm;
        const tomorrow = clock.minutes >= 21 * 60 && (type === "3" || qmin < 6 * 60);
        const [y, mo, d] = ymdTokyo(tomorrow ? new Date(Date.now() + 12 * 3600 * 1000) : new Date()).split("-");
        const fromQ = yahooName(from, opf);
        const toQ = yahooName(to, dpf);
        const cacheId = `${fromQ}|${toQ}|${y}-${mo}-${d}|${olat.toFixed(3)}|${dlat.toFixed(3)}|${type}|${hh}:${String(mm).padStart(2, "0")}`;
        const hit = cache.get(cacheId);
        if (hit && Date.now() - hit.at < 12_000) return Response.json({ ok: true, journey: hit.journey, journeys: hit.journeys });
        const origin: RouteStop = { name: from, lng: olng, lat: olat, prefecture: opf };
        const dest: RouteStop = { name: to, lng: dlng, lat: dlat, prefecture: dpf };
        try {
          const diaP = fetchYahooDiaInfo();
          const first = await yahooPage(fromQ, toQ, y ?? "", mo ?? "", d ?? "", hh, mm, type, origin, dest);
          const dia = await diaP.catch(() => []);
          const journeys = first.map((j) => stampYahooDia(j, dia));
          cache.set(cacheId, { at: Date.now(), journey: journeys[0], journeys });
          return Response.json({ ok: true, journey: journeys[0] ?? null, journeys });
        } catch {
          return Response.json({ ok: false, error: "transit" });
        }
      },
    },
  },
});
