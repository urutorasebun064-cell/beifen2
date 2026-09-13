import { createFileRoute } from "@tanstack/react-router";
import { tokyoParts } from "@/lib/rail/geo";
import { journeysFromYahoo, fetchYahooDiaInfo, stampYahooDia } from "@/lib/rail/yahoo";
import type { Journey, RouteStop } from "@/lib/rail/types";

const cache = new Map<string, { at: number; journey: unknown; journeys: unknown }>();
const LAST_RUN = 80;

function ymdTokyo(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function yahooName(name: string, _pf = "") {
  return name.replace(/駅$/u, "").trim();
}

function shortPf(pf: string) {
  return pf.replace(/[都道府県]$/u, "").trim();
}

function nameForms(name: string, pf = "") {
  const n = name.replace(/駅$/u, "").trim();
  const ke = n.replace(/ヶ/g, "ケ");
  const ge = n.replace(/ケ/g, "ヶ");
  const p = shortPf(pf);
  const out: string[] = [];
  const add = (x: string) => {
    const v = x.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  if (p) {
    add(`${n}（${p}）`);
    add(`${n}（${p}県）`);
  }
  add(n);
  add(`${n}駅`);
  add(ke);
  add(ge);
  return out.slice(0, 6);
}

function stopStem(s: string) {
  let t = String(s || "").trim().split("/")[0]!.trim();
  t = t.replace(/駅$/u, "").replace(/[（(][^）)]{1,12}[）)]$/u, "").replace(/駅$/u, "");
  return t.trim();
}

function prefTag(s: string) {
  const m = s.match(/[（(]([^）)]{1,12})[）)]$/u);
  return m ? m[1]!.replace(/[都道府県]$/u, "") : "";
}

function sameStop(a: string, b: string) {
  return stopStem(a) === stopStem(b);
}

function stopMatches(stopName: string, want: RouteStop) {
  if (!sameStop(stopName, want.name)) return false;
  const tagged = prefTag(stopName);
  const p = shortPf(want.prefecture || "");
  if (tagged && p && tagged !== p) return false;
  return true;
}

function journeysForStations(list: Journey[], origin: RouteStop, dest: RouteStop) {
  return list.filter((j) => {
    if (!j.legs.length) return false;
    const first = j.legs[0]!;
    const last = j.legs[j.legs.length - 1]!;
    const rides = j.legs.filter((l) => l.kind === "ride");
    if (!rides.length) return false;
    const startOk = stopMatches(first.from.name, origin) || stopMatches(rides[0]!.from.name, origin);
    const endOk = stopMatches(last.to.name, dest) || stopMatches(rides[rides.length - 1]!.to.name, dest);
    if (first.kind === "walk" && (first.minutes ?? 0) >= 12 && !startOk) return false;
    return startOk && endOk;
  });
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
    signal: AbortSignal.timeout(18000),
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

function pickCode(list: St[], pf: string, name: string) {
  if (!list.length) return "";
  const p = shortPf(pf);
  const n = stopStem(name);
  const blob = (x: St) => `${x.name ?? ""}${x.label ?? ""}`;
  const stem = (x: St) => stopStem(x.name ?? "") || stopStem(x.label ?? "");
  const exact = list.filter((x) => stem(x) === n);
  if (!exact.length) return "";
  const hit =
    exact.find((x) => p && blob(x).includes(p)) ??
    exact.find((x) => pf && blob(x).includes(pf)) ??
    (exact.length === 1 ? exact[0] : undefined);
  if (!hit) return "";
  if (hit.code) return `,,${hit.code}`;
  return hit.value && /,,\d/.test(hit.value) ? hit.value : "";
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
          const pairs: Array<{ from: string; to: string; extra?: { flatlon?: string; tlatlon?: string } }> = [];
          const addPair = (f: string, t: string, extra?: { flatlon?: string; tlatlon?: string }) => {
            if (!f || !t) return;
            if (pairs.some((p) => p.from === f && p.to === t && (p.extra?.flatlon ?? "") === (extra?.flatlon ?? "") && (p.extra?.tlatlon ?? "") === (extra?.tlatlon ?? ""))) return;
            pairs.push({ from: f, to: t, extra });
          };
          addPair(froms[0] ?? fromQ, tos[0] ?? toQ);
          addPair(fromQ, toQ);
          addPair(froms[1] ?? `${fromQ}駅`, tos[1] ?? `${toQ}駅`);
          let usedExtra: { flatlon?: string; tlatlon?: string } | undefined;
          for (const pair of pairs) {
            usedFrom = pair.from;
            usedTo = pair.to;
            usedExtra = pair.extra;
            const page = await yahooPage(usedFrom, usedTo, y ?? "", mo ?? "", d ?? "", hh, mm, type, origin, dest, pair.extra);
            let rows = journeysForStations(page.journeys, origin, dest);
            const fc = pickCode(page.fromList, opf, from);
            const tc = pickCode(page.toList, dpf, to);
            if (fc || tc) {
              usedExtra = {
                flatlon: fc || pair.extra?.flatlon,
                tlatlon: tc || pair.extra?.tlatlon,
              };
              const coded = await yahooPage(usedFrom, usedTo, y ?? "", mo ?? "", d ?? "", hh, mm, type, origin, dest, usedExtra);
              const codedRows = journeysForStations(coded.journeys, origin, dest);
              if (codedRows.length) rows = codedRows;
            }
            first = rows;
            if (first.length) break;
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