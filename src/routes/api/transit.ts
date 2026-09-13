import { createFileRoute } from "@tanstack/react-router";
import { tokyoParts } from "@/lib/rail/geo";
import { journeysFromYahoo, fetchYahooDiaInfo, stampYahooDia } from "@/lib/rail/yahoo";
import type { Journey, RouteStop } from "@/lib/rail/types";

const cache = new Map<string, { at: number; journey: unknown; journeys: unknown }>();
const LAST_RUN = 80;

function ymdTokyo(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function yahooName(name: string, pf: string) {
  const n = name.replace(/駅$/u, "").trim();
  const p = pf.trim();
  return p ? `${n}(${p})` : n;
}

function shortPf(pf: string) {
  return pf.replace(/[都道府県]$/u, "").trim();
}

function nameForms(name: string, pf: string) {
  const n = name.replace(/駅$/u, "").trim();
  const ke = n.replace(/ヶ/g, "ケ");
  const ge = n.replace(/ケ/g, "ヶ");
  const out: string[] = [];
  const add = (x: string) => {
    const v = x.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  add(yahooName(n, pf));
  add(yahooName(n, shortPf(pf)));
  add(n);
  add(yahooName(ke, pf));
  add(ke);
  add(yahooName(ge, pf));
  add(ge);
  return out.slice(0, 4);
}

function parseHhmm(s: string | undefined) {
  const m = String(s ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return { hh: Number(m[1]), mm: Number(m[2]) };
}

function bumpMinute(hh: number, mm: number, add = 1) {
  let h = hh;
  let m = mm + add;
  while (m >= 60) {
    m -= 60;
    h += 1;
  }
  return { hh: h, mm: m };
}

function jid(j: Journey) {
  return `${j.departHhmm}|${j.arriveHhmm}|${j.legs.map((l) => l.lineName ?? l.kind).join(",")}`;
}

type St = { name?: string; code?: string; label?: string; value?: string };

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
  extra?: { flatlon?: string; tlatlon?: string },
): Promise<{ journeys: Journey[]; fromList: St[]; toList: St[] }> {
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
  if (extra?.flatlon) qs.set("flatlon", extra.flatlon);
  if (extra?.tlatlon) qs.set("tlatlon", extra.tlatlon);
  const res = await fetch(`https://transit.yahoo.co.jp/search/result?${qs}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "ja",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { journeys: [], fromList: [], toList: [] };
  const html = await res.text();
  return { journeys: journeysFromYahoo(html, origin, dest), ...stationLists(html) };
}

function stationLists(html: string): { fromList: St[]; toList: St[] } {
  try {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return { fromList: [], toList: [] };
    const json = JSON.parse(m[1]!) as {
      props?: { pageProps?: { naviSearchParam?: { otherQueryInfo?: { fromList?: St[]; toList?: St[] } } } };
    };
    const oi = json.props?.pageProps?.naviSearchParam?.otherQueryInfo;
    return { fromList: oi?.fromList ?? [], toList: oi?.toList ?? [] };
  } catch {
    return { fromList: [], toList: [] };
  }
}

function stemName(name: string) {
  return name.replace(/駅$/u, "").replace(/[（(][^）)]{1,12}[）)]$/u, "").trim();
}

function coordPin(lat: number, lng: number, name: string) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) < 20 || Math.abs(lng) < 120) return "";
  return `${lat.toFixed(6)},${lng.toFixed(6)},${stemName(name)}`;
}

function codeOf(hit: St | undefined) {
  if (!hit) return "";
  if (hit.code) return `,,${hit.code}`;
  if (hit.value && /(,,\d)|(\d+\.\d+\s*,\s*\d+\.\d+)/.test(hit.value)) return hit.value;
  return "";
}

function pickCode(list: St[], pf: string, name: string, lat = 0, lng = 0) {
  if (!list.length) return coordPin(lat, lng, name);
  const n = stemName(name);
  const p = shortPf(pf);
  const scored = list.map((x) => {
    const blob = `${x.name ?? ""}${x.label ?? ""}${x.value ?? ""}`;
    const xn = stemName(x.name ?? "");
    let s = 40;
    if (xn === n && ((p && blob.includes(p)) || (pf && blob.includes(pf)))) s = 0;
    else if (xn === n) s = 1;
    else if (n && xn.includes(n) && ((p && blob.includes(p)) || (pf && blob.includes(pf)))) s = 2;
    else if (n && xn.includes(n)) s = 3;
    return { x, s };
  });
  scored.sort((a, b) => a.s - b.s);
  const best = scored[0];
  if (best && best.s <= 3) return codeOf(best.x);
  return coordPin(lat, lng, name);
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
        const hhIn = url.searchParams.get("hh");
        const mmIn = url.searchParams.get("mm");
        let hh = hhIn != null && hhIn !== "" ? Number(hhIn) : clock.hour;
        let mm = mmIn != null && mmIn !== "" ? Number(mmIn) : clock.minute;
        if (!Number.isFinite(hh)) hh = clock.hour;
        if (!Number.isFinite(mm)) mm = clock.minute;
        const qmin = (hh % 24) * 60 + mm;
        const early = clock.minutes < LAST_RUN;
        const tomorrow = clock.minutes >= 21 * 60 && (type === "3" || qmin < 6 * 60);
        let at = Date.now();
        if (tomorrow) at += 12 * 3600 * 1000;
        else if (early && type !== "3") {
          at -= 12 * 3600 * 1000;
          if (hh < 12) hh += 24;
        }
        const [y, mo, d] = ymdTokyo(new Date(at)).split("-");
        const fromQ = yahooName(from, opf);
        const toQ = yahooName(to, dpf);
        const cacheId = `${fromQ}|${toQ}|${y}-${mo}-${d}|${olat.toFixed(3)}|${dlat.toFixed(3)}|${type}|${hh}:${String(mm).padStart(2, "0")}`;
        const hit = cache.get(cacheId);
        if (hit && Date.now() - hit.at < 12_000) return Response.json({ ok: true, journey: hit.journey, journeys: hit.journeys });
        const origin: RouteStop = { name: from, lng: olng, lat: olat, prefecture: opf };
        const dest: RouteStop = { name: to, lng: dlng, lat: dlat, prefecture: dpf };
        try {
          const diaP = fetchYahooDiaInfo();
          const froms = nameForms(from, opf);
          const tos = nameForms(to, dpf);
          let first: Journey[] = [];
          let usedFrom = fromQ;
          let usedTo = toQ;
          let usedExtra: { flatlon?: string; tlatlon?: string } | undefined;
          const pairs: Array<{ from: string; to: string; extra?: { flatlon?: string; tlatlon?: string } }> = [];
          const addPair = (f: string, t: string, extra?: { flatlon?: string; tlatlon?: string }) => {
            if (!f || !t) return;
            if (pairs.some((p) => p.from === f && p.to === t && (p.extra?.flatlon ?? "") === (extra?.flatlon ?? "") && (p.extra?.tlatlon ?? "") === (extra?.tlatlon ?? ""))) return;
            pairs.push({ from: f, to: t, extra });
          };
          addPair(fromQ, toQ);
          addPair(froms[1] ?? fromQ, tos[1] ?? toQ);
          addPair(froms[2] ?? from.replace(/駅$/u, ""), tos[2] ?? to.replace(/駅$/u, ""));
          for (const pair of pairs) {
            usedFrom = pair.from;
            usedTo = pair.to;
            const page = await yahooPage(usedFrom, usedTo, y ?? "", mo ?? "", d ?? "", hh, mm, type, origin, dest, pair.extra);
            first = page.journeys;
            const fc = pickCode(page.fromList, opf, from, olat, olng);
            const tc = pickCode(page.toList, dpf, to, dlat, dlng);
            const listed = page.fromList.length > 1 || page.toList.length > 1;
            if ((listed || !first.length) && (fc || tc)) {
              const coded = await yahooPage(usedFrom, usedTo, y ?? "", mo ?? "", d ?? "", hh, mm, type, origin, dest, {
                flatlon: fc || pair.extra?.flatlon,
                tlatlon: tc || pair.extra?.tlatlon,
              });
              if (coded.journeys.length) {
                first = coded.journeys;
                usedExtra = { flatlon: fc || pair.extra?.flatlon, tlatlon: tc || pair.extra?.tlatlon };
                break;
              }
            }
            if (first.length && !listed) {
              usedExtra = pair.extra;
              break;
            }
          }
          if (type === "1" && first.length) {
            const last = parseHhmm(first[first.length - 1]?.departHhmm);
            if (last && first.length < 5) {
              const n = bumpMinute(last.hh, last.mm, 1);
              const extra = await yahooPage(usedFrom, usedTo, y ?? "", mo ?? "", d ?? "", n.hh, n.mm, "1", origin, dest, usedExtra);
              if (extra.journeys.length) {
                const seen = new Set(first.map(jid));
                for (const j of extra.journeys) {
                  const id = jid(j);
                  if (seen.has(id)) continue;
                  seen.add(id);
                  first.push(j);
                }
              }
            }
          }
          const dia = await diaP.catch(() => []);
          const journeys = first.slice(0, 6).map((j) => stampYahooDia(j, dia));
          if (journeys.length) cache.set(cacheId, { at: Date.now(), journey: journeys[0], journeys });
          return Response.json({ ok: true, journey: journeys[0] ?? null, journeys });
        } catch {
          return Response.json({ ok: false, error: "transit" });
        }
      },
    },
  },
});