import type { Journey, RouteLeg, RouteStop, Train } from "./types";

type YahooEdge = {
  stationName?: string;
  pointName?: string;
  railName?: string;
  destination?: string;
  timeInfo?: Array<{ time?: string; type?: number; trackName?: string; platform?: string }>;
  pointIcon?: number;
  trackNo?: string | number;
  trackNumber?: string | number;
  platformNo?: string | number;
  noriba?: string | number;
  departureTrack?: string | number;
  arrivalTrack?: string | number;
  ridingPositionInfo?: { departure?: string[]; arrival?: string[]; position?: string[] };
  preCautionalComment?: string;
  diaInfoStatus?: unknown;
};

type YahooFeature = {
  summaryInfo?: {
    departureTime?: string;
    arrivalTime?: string;
    totalTime?: string;
    transferCount?: string | number;
    delayTime?: string | number;
    delayMinute?: string | number;
    delay?: string | number;
    status?: string;
  };
  edgeInfoList?: YahooEdge[];
};

function parseMinutes(s: string | undefined): number {
  const t = String(s ?? "");
  const h = t.match(/(\d+)\s*時間/);
  const m = t.match(/(\d+)\s*分/);
  let n = 0;
  if (h) n += Number(h[1]) * 60;
  if (m) n += Number(m[1]);
  if (!n) {
    const d = Number(t.replace(/[^\d]/g, ""));
    n = Number.isFinite(d) && d > 0 ? d : 0;
  }
  return n > 0 ? n : 1;
}

function isWalk(name: string): boolean {
  return /徒歩|歩いて|walk/i.test(name);
}

function railColor(name: string): string {
  if (name.includes("山手")) return "#80c269";
  if (name.includes("中央")) return "#f15a22";
  if (name.includes("京浜") || name.includes("根岸")) return "#00b2e5";
  if (name.includes("総武")) return "#ffd400";
  if (name.includes("埼京") || name.includes("川越")) return "#00ac9b";
  if (name.includes("京葉")) return "#c60c30";
  if (name.includes("東海道") && name.includes("新")) return "#0a7ad1";
  if (name.includes("新幹線")) return "#0a7ad1";
  if (name.includes("バス")) return "#e85d4c";
  if (name.includes("地下鉄") || name.includes("メトロ")) return "#f4c04a";
  return "#7ec8e3";
}

function prefOfName(name: string) {
  const m = String(name || "").match(/[（(]([^）)]{1,12})[）)]$/u);
  return m ? m[1]!.replace(/[都道府県]$/u, "") : "";
}

function sameStem(a: string, b: string) {
  const x = a.replace(/駅$/u, "").replace(/[（(][^）)]{1,12}[）)]$/u, "").trim();
  const y = b.replace(/駅$/u, "").replace(/[（(][^）)]{1,12}[）)]$/u, "").trim();
  return Boolean(x && y) && x === y;
}

function stop(name: string, origin: RouteStop, dest: RouteStop): RouteStop {
  const raw = name || "";
  if (raw && (sameStem(raw, origin.name) || raw === origin.name)) {
    return { name: raw, lng: origin.lng, lat: origin.lat, prefecture: origin.prefecture };
  }
  if (raw && (sameStem(raw, dest.name) || raw === dest.name)) {
    return { name: raw, lng: dest.lng, lat: dest.lat, prefecture: dest.prefecture };
  }
  return { name: raw, lng: 0, lat: 0, prefecture: prefOfName(raw) };
}

function numFrom(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    const n = String(v[0] ?? "").match(/(\d{1,2})/);
    return n?.[1];
  }
  const n = String(v ?? "").match(/(\d{1,2})/);
  return n?.[1];
}

function pickPlatform(edge: YahooEdge, kind: "dep" | "arr"): string | undefined {
  const ride = edge.ridingPositionInfo;
  const fromRide = kind === "dep" ? numFrom(ride?.departure) : numFrom(ride?.arrival);
  if (fromRide) return fromRide;
  const want = kind === "dep" ? 1 : 2;
  for (const t of edge.timeInfo ?? []) {
    if (Number(t.type) === want) {
      const n = numFrom(t.trackName ?? t.platform);
      if (n) return n;
    }
  }
  const rec = edge as Record<string, unknown>;
  const keys =
    kind === "dep"
      ? ["departureTrack", "trackNo", "trackNumber", "platformNo", "noriba", "trackName", "platform"]
      : ["arrivalTrack", "trackNo", "trackNumber", "platformNo", "noriba", "trackName", "platform"];
  for (const k of keys) {
    const n = numFrom(rec[k]);
    if (n) return n;
  }
  for (const t of edge.timeInfo ?? []) {
    const n = numFrom(t.trackName ?? t.platform);
    if (n) return n;
  }
  return undefined;
}

function rideClass(rail: string, dest: string) {
  const m = `${rail} ${dest}`.match(/各駅停車|各停|普通|快速|急行|特急|準急|通勤快速|区間快速/);
  return m?.[0];
}

function pickTime(edge: YahooEdge, kind: "dep" | "arr"): string | undefined {
  const list = edge.timeInfo ?? [];
  const want = kind === "dep" ? 1 : 2;
  const hit =
    list.find((t) => Number(t.type) === want) ??
    list.find((t) => (kind === "dep" ? String(t.type).includes("発") : String(t.type).includes("着"))) ??
    (kind === "dep" ? list[0] : list[list.length - 1]);
  const time = String(hit?.time ?? "").trim();
  return /^\d{1,2}:\d{2}$/.test(time) ? time : undefined;
}

export function journeysFromYahoo(
  html: string,
  origin: RouteStop,
  dest: RouteStop,
): Journey[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let features: YahooFeature[] = [];
  try {
    const json = JSON.parse(m[1]!) as {
      props?: { pageProps?: { naviSearchParam?: { featureInfoList?: YahooFeature[] } } };
    };
    features = json.props?.pageProps?.naviSearchParam?.featureInfoList ?? [];
  } catch {
    return [];
  }
  return features.map((feat) => featureToJourney(feat, origin, dest)).filter((j): j is Journey => Boolean(j));
}

export function journeyFromYahoo(
  html: string,
  origin: RouteStop,
  dest: RouteStop,
): Journey | null {
  return journeysFromYahoo(html, origin, dest)[0] ?? null;
}

function diaStatusTexts(dia: unknown): string[] {
  if (dia == null || dia === "") return [];
  if (typeof dia === "string") return [dia];
  if (Array.isArray(dia)) return dia.flatMap(diaStatusTexts);
  if (typeof dia === "object") {
    const rec = dia as Record<string, unknown>;
    const out: string[] = [];
    if (Array.isArray(rec.messages)) out.push(...rec.messages.map(String));
    for (const k of ["status", "message", "situation", "statusSup1", "statusSup2", "statusSup", "text"]) {
      if (rec[k]) out.push(String(rec[k]));
    }
    return out.length ? out : [];
  }
  return [String(dia)];
}

function parseDelayText(blob: string): { delaySec: number; alert: boolean } | null {
  if (!blob) return null;
  if (/平常運転/.test(blob) && !/列車遅延/.test(blob)) return null;
  if (/ほぼ平常|平常通り/.test(blob) && !/遅れが出|列車遅延/.test(blob)) return null;
  if (/運転見合わせ/.test(blob)) return null;
  if (/運休/.test(blob) && !/遅延|遅れ/.test(blob)) return null;
  if (!/遅延|遅れ|ダイヤ乱れ/.test(blob)) return null;
  const secHit = blob.match(/(\d+)\s*秒(?:程度)?(?:の)?(?:遅延|遅れ)/) || blob.match(/遅延\s*(\d+)\s*秒/);
  const minHit =
    blob.match(/(\d+)\s*分(?:以上)?(?:程度)?(?:以内)?(?:の)?(?:遅延|遅れ)/) ||
    blob.match(/遅れ(?:て)?[^\d]{0,8}(\d+)\s*分/) ||
    blob.match(/遅延\s*(\d+)\s*分/) ||
    blob.match(/約\s*(\d+)\s*分(?:以上)?(?:の)?(?:遅|遅れ)/);
  let delaySec = 0;
  if (secHit) delaySec = Number(secHit[1]);
  else if (minHit) delaySec = Number(minHit[1]) * 60;
  if (!Number.isFinite(delaySec) || delaySec < 0) delaySec = 0;
  return { delaySec, alert: true };
}

function delayFromDiaText(status: string, message: string, situation: string) {
  if (/平常運転/.test(status)) return null;
  if (/運転見合わせ/.test(status)) return null;
  if (/運休/.test(status) && !/遅延/.test(status)) return null;
  return parseDelayText(`${status} ${message} ${situation}`);
}

function delayFromFeat(feat: YahooFeature): { delayMin: number; delaySec: number; delayAlert: boolean } {
  const s = feat.summaryInfo ?? {};
  const parts: string[] = [];
  for (const k of ["delayMinute", "delayTime", "delay", "status"] as const) {
    const v = s[k];
    if (v != null && String(v) !== "") parts.push(String(v));
  }
  for (const e of feat.edgeInfoList ?? []) {
    if (e.preCautionalComment) parts.push(String(e.preCautionalComment));
    parts.push(...diaStatusTexts(e.diaInfoStatus));
    const rec = e as Record<string, unknown>;
    for (const k of ["delayMinute", "delayTime", "delay", "delaySec", "status"]) {
      if (rec[k]) parts.push(String(rec[k]));
    }
  }
  const parsed = parseDelayText(parts.join(" "));
  let delaySec = parsed?.delaySec ?? 0;
  const delayAlert = Boolean(parsed?.alert);
  if (delaySec <= 0) {
    const n = Number(String(s.delayMinute ?? s.delayTime ?? s.delay ?? "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) delaySec = n > 180 ? n : n * 60;
  }
  if (!delayAlert && delaySec <= 0) return { delayMin: 0, delaySec: 0, delayAlert: false };
  return {
    delayMin: delaySec > 0 ? Math.max(1, Math.round(delaySec / 60)) : 0,
    delaySec: delaySec > 0 ? Math.round(delaySec) : 0,
    delayAlert: delayAlert || delaySec > 0,
  };
}

function clockSpan(dep?: string, arr?: string): number {
  if (!dep || !arr || !/^\d{1,2}:\d{2}$/.test(dep) || !/^\d{1,2}:\d{2}$/.test(arr)) return 0;
  const [dh, dm] = dep.split(":").map(Number);
  const [ah, am] = arr.split(":").map(Number);
  let minutes = (ah ?? 0) * 60 + (am ?? 0) - ((dh ?? 0) * 60 + (dm ?? 0));
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function featureToJourney(feat: YahooFeature, origin: RouteStop, dest: RouteStop): Journey | null {
  const summary = feat.summaryInfo;
  const edges = feat.edgeInfoList ?? [];
  if (!summary?.departureTime || edges.length < 2) return null;
  const legs: RouteLeg[] = [];
  const pushRide = (leg: RouteLeg) => {
    const prev = legs[legs.length - 1];
    if (
      prev &&
      prev.kind === "ride" &&
      leg.kind === "ride" &&
      railKey(prev.lineName || "") === railKey(leg.lineName || "") &&
      (prev.to.name || "") === (leg.from.name || "")
    ) {
      prev.to = leg.to;
      prev.arriveHhmm = leg.arriveHhmm;
      prev.toPlatform = leg.toPlatform;
      prev.minutes += leg.minutes;
      return;
    }
    if (prev && prev.kind === "ride" && leg.kind === "ride") {
      const gap = clockSpan(prev.arriveHhmm, leg.departHhmm);
      const sameStop = (prev.to.name || "").replace(/駅$/u, "") === (leg.from.name || "").replace(/駅$/u, "");
      if (gap > 0 && !sameStop) {
        legs.push({
          kind: "walk",
          from: prev.to,
          to: leg.from,
          stops: [prev.to, leg.from],
          minutes: gap,
          path: [
            [prev.to.lng, prev.to.lat],
            [leg.from.lng, leg.from.lat],
          ],
        });
      }
    }
    legs.push(leg);
  };
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const rail = a.railName ?? "";
    const walk = isWalk(rail);
    const from = stop(a.stationName || a.pointName || origin.name, origin, dest);
    const to = stop(b.stationName || b.pointName || dest.name, origin, dest);
    const dep = pickTime(a, "dep");
    const arr = pickTime(b, "arr") ?? pickTime(b, "dep");
    const minutes = Math.max(1, clockSpan(dep, arr) || 1);
    const destName = a.destination ?? "";
    const leg: RouteLeg = {
      kind: walk ? "walk" : "ride",
      lineName: walk ? undefined : (a.railName ?? "").replace(/・[^・]*行$/u, "") || undefined,
      color: walk ? undefined : railColor(rail),
      toward: destName.replace(/行$/u, "").replace(/^(普通|快速|急行|特急|各停|各駅停車)[・･]?/u, ""),
      trainType: walk ? undefined : rideClass(rail, destName),
      from,
      to,
      fromPlatform: walk ? undefined : pickPlatform(a, "dep"),
      toPlatform: walk ? undefined : pickPlatform(b, "arr"),
      stops: [from, to],
      minutes,
      departHhmm: walk ? undefined : dep,
      arriveHhmm: walk ? undefined : arr,
    };
    if (walk) {
      const prev = legs[legs.length - 1];
      if (prev && prev.kind === "walk") {
        prev.to = to;
        prev.minutes += minutes;
        prev.stops = [prev.from, to];
        continue;
      }
      legs.push(leg);
    } else {
      pushRide(leg);
    }
  }
  if (!legs.length) return null;
  const xferRaw = Number(summary.transferCount);
  const transfers = Number.isFinite(xferRaw) ? Math.max(0, xferRaw) : Math.max(0, legs.filter((l) => l.kind === "ride").length - 1);
  const delay = delayFromFeat(feat);
  const span = clockSpan(summary.departureTime, summary.arrivalTime);
  return {
    origin,
    dest,
    legs,
    totalMinutes: span || parseMinutes(summary.totalTime),
    transfers,
    departHhmm: summary.departureTime,
    arriveHhmm: summary.arrivalTime ?? dest.name,
    source: "yahoo",
    fast: Boolean(summary.isFast),
    easy: Boolean(summary.isEasy),
    cheap: Boolean(summary.isCheap),
    delayMin: delay.delayMin || undefined,
    delaySec: delay.delaySec || undefined,
    delayAlert: delay.delayAlert || undefined,
  };
}

export type YahooDiaDelay = {
  name: string;
  delaySec: number;
  alert: boolean;
};

function railKey(name: string) {
  return name
    .replace(/[・･].*$/u, "")
    .replace(/[（(][^）)]{0,40}[）)]/gu, "")
    .replace(/[［\[][^］\]]*[］\]]/gu, "")
    .replace(/^[ＪJ][ＲR](東日本|西日本|東海|北海道|九州|四国)?/u, "")
    .replace(/^(東京メトロ|東京地下鉄|地下鉄|都営|東武|西武|京成|京急|京王|小田急|東急|相鉄|名鉄|近鉄|阪神|阪急|南海)/u, "")
    .replace(/アーバンパーク(?:ライン)?/u, "野田")
    .replace(/スカイツリー(?:ライン)?/u, "伊勢崎")
    .replace(/(各駅停車|各停|普通|快速|急行|特急|準急|通勤快速|区間快速).*$/u, "")
    .replace(/\s/g, "")
    .replace(/ライン$/u, "")
    .replace(/線$/u, "");
}

export function railsMatch(a: string, b: string) {
  const ka = railKey(a);
  const kb = railKey(b);
  if (!ka || !kb || ka.length < 2 || kb.length < 2) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

type TroubleRail = {
  routeInfo?: {
    property?: {
      displayName?: string;
      railName?: string;
      diainfo?: Array<{ status?: string; message?: string; situation?: string; statusSup1?: string; statusSup2?: string }>;
    };
  };
};

function collectTroubleRails(raw: unknown, out: TroubleRail[]) {
  if (!raw) return;
  if (Array.isArray(raw)) {
    for (const item of raw) collectTroubleRails(item, out);
    return;
  }
  if (typeof raw === "object" && (raw as TroubleRail).routeInfo) out.push(raw as TroubleRail);
}

export function parseYahooDia(html: string): YahooDiaDelay[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  let rails: TroubleRail[] = [];
  try {
    const json = JSON.parse(m[1]!) as {
      props?: { pageProps?: { troubleRails?: unknown; diainfoTrainFeatures?: unknown } };
    };
    const pp = json.props?.pageProps ?? {};
    collectTroubleRails(pp.troubleRails, rails);
    collectTroubleRails(pp.diainfoTrainFeatures, rails);
  } catch {
    return [];
  }
  const out: YahooDiaDelay[] = [];
  for (const item of rails) {
    const p = item.routeInfo?.property;
    if (!p) continue;
    const name = p.displayName || p.railName || "";
    if (!name) continue;
    let delaySec = 0;
    let alert = false;
    for (const info of p.diainfo ?? []) {
      const blob = [info.status, info.message, info.situation, info.statusSup1, info.statusSup2]
        .filter(Boolean)
        .join(" ");
      const hit = delayFromDiaText(info.status ?? "", blob, "");
      if (!hit) continue;
      alert = true;
      delaySec = Math.max(delaySec, hit.delaySec);
    }
    if (alert) out.push({ name, delaySec, alert });
  }
  return out;
}

let diaCache: { at: number; rows: YahooDiaDelay[] } = { at: 0, rows: [] };

async function yahooDiaArea(area: string): Promise<YahooDiaDelay[]> {
  const res = await fetch(`https://transit.yahoo.co.jp/traininfo/area/${area}/`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "ja",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  return parseYahooDia(await res.text());
}

export async function fetchYahooDiaInfo(): Promise<YahooDiaDelay[]> {
  const now = Date.now();
  if (now - diaCache.at < 45_000) return diaCache.rows;
  try {
    const lists = await Promise.all(["3", "4", "5", "6"].map((area) => yahooDiaArea(area).catch(() => [] as YahooDiaDelay[])));
    const merged = new Map<string, YahooDiaDelay>();
    for (const row of lists.flat()) {
      const prev = merged.get(row.name);
      if (!prev) merged.set(row.name, row);
      else merged.set(row.name, { name: row.name, delaySec: Math.max(prev.delaySec, row.delaySec), alert: prev.alert || row.alert });
    }
    diaCache = { at: now, rows: [...merged.values()] };
    return diaCache.rows;
  } catch {
    if (diaCache.at) return diaCache.rows;
    diaCache = { at: now, rows: [] };
    return [];
  }
}

export function stampYahooDia(journey: Journey, dia: YahooDiaDelay[]): Journey {
  if (!dia.length) return journey;
  let sec = journey.delaySec && journey.delaySec > 0 ? journey.delaySec : 0;
  if (journey.delayMin && journey.delayMin > 0) sec = Math.max(sec, journey.delayMin * 60);
  let alert = Boolean(journey.delayAlert);
  for (const leg of journey.legs) {
    if (leg.kind !== "ride" || !leg.lineName) continue;
    for (const d of dia) {
      if (!railsMatch(leg.lineName, d.name)) continue;
      alert = alert || d.alert;
      sec = Math.max(sec, d.delaySec);
    }
  }
  if (!alert && sec <= 0) return journey;
  const delayMin = sec > 0 ? Math.max(journey.delayMin ?? 0, Math.max(1, Math.round(sec / 60))) : journey.delayMin;
  const delaySec = sec > 0 ? Math.max(journey.delaySec ?? 0, sec) : journey.delaySec;
  if (delayMin === journey.delayMin && delaySec === journey.delaySec && alert === Boolean(journey.delayAlert)) return journey;
  return { ...journey, delayMin, delaySec, delayAlert: alert || sec > 0 };
}

export function stampTrainsDia(trains: Train[], dia: YahooDiaDelay[]): Train[] {
  if (!dia.length || !trains.length) return trains;
  let changed = false;
  const next = trains.map((t) => {
    if (t.kind === "flight" || t.kind === "bus") return t;
    let sec = t.delaySec && t.delaySec > 0 ? t.delaySec : 0;
    if (t.delayMin > 0) sec = Math.max(sec, t.delayMin * 60);
    let hit = false;
    let alert = Boolean(t.delayAlert);
    for (const d of dia) {
      if (!railsMatch(t.lineName, d.name) && !railsMatch(t.lineId, d.name)) continue;
      hit = true;
      alert = alert || d.alert;
      sec = Math.max(sec, d.delaySec);
    }
    if (!hit) return t;
    const delayMin = sec > 0 ? Math.max(t.delayMin, Math.max(1, Math.round(sec / 60))) : t.delayMin;
    const delaySec = sec > 0 ? Math.max(t.delaySec ?? 0, sec) : t.delaySec;
    const delayAlert = alert || sec > 0;
    if (delayMin === t.delayMin && delaySec === t.delaySec && delayAlert === Boolean(t.delayAlert)) return t;
    changed = true;
    return { ...t, delayMin, delaySec, delayAlert };
  });
  return changed ? next : trains;
}

