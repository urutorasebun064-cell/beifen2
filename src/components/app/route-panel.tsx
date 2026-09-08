import { ArrowRight, Footprints, TrainFront, X } from "lucide-react";
import { copies, displayName, type Copy, type Lang } from "@/lib/i18n";
import { journeyDelaySeconds, journeyShowsDelay, stampJourneyDelay } from "@/lib/rail/delay";
import { haversine, tokyoParts, arriveHhmmOf } from "@/lib/rail/geo";
import { trainForSchedule, minutesUntilDepart } from "@/lib/rail/simulate";
import { ensureConnections } from "@/lib/rail/route";
import { placeTrainOnLeg, rideWaiting } from "@/lib/rail/timetable-snap";
import { sliceRailPath } from "@/lib/rail/graph";
import type { Journey, RouteLeg, Train } from "@/lib/rail/types";
import { Button } from "@/components/ui/button";
import { useMapStore, simNow } from "@/store/map-store";

function findLine(leg: Pick<RouteLeg, "lineName" | "to"> & Partial<Pick<RouteLeg, "lineId" | "from">>) {
  const store = useMapStore.getState();
  const lines = store.lines;
  if (leg.lineId) {
    const exact = lines.find((l) => l.id === leg.lineId);
    if (exact) return exact;
  }
  const name = (leg.lineName ?? "").replace(/^JR/u, "");
  if (name) {
    const hit =
      lines.find((l) => l.name === leg.lineName) ??
      lines.find((l) => l.name === name) ??
      lines.find((l) => l.name.includes(name) || name.includes(l.name.replace(/^JR/u, "")));
    if (hit) return hit;
  }
  const origin = leg.from?.name ? [...store.stationIndex.values()].find((s) => s.name === leg.from!.name) : undefined;
  if (origin?.lines.length) {
    const viaDest = origin.lines.find((l) => l.stops.some((s) => s.n === leg.to.name));
    if (viaDest) return viaDest;
    if (name) {
      const named = origin.lines.find((l) => l.name.includes(name) || name.includes(l.name.replace(/^JR/u, "")));
      if (named) return named;
    }
    return origin.lines[0] ?? null;
  }
  return null;
}

const LINE_NOS: [RegExp, string][] = [
  [/都営浅草|浅草線/, "1"],
  [/日比谷線/, "2"],
  [/銀座線/, "3"],
  [/丸ノ内/, "4"],
  [/東西線|东西线/, "5"],
  [/都営三田|三田線/, "6"],
  [/南北線/, "7"],
  [/有楽町線|有乐町/, "8"],
  [/千代田線/, "9"],
  [/都営新宿/, "10"],
  [/半蔵門|半藏门/, "11"],
  [/大江戸|大江户/, "12"],
  [/副都心/, "13"],
  [/大阪御堂筋/, "1"],
  [/大阪谷町/, "2"],
  [/大阪四つ橋/, "3"],
  [/大阪中央線/, "4"],
  [/大阪千日前/, "5"],
  [/大阪堺筋/, "6"],
  [/大阪長堀/, "7"],
  [/大阪今里筋/, "8"],
  [/大阪南港/, "9"],
];

const LINE_LETTER: Record<string, string> = {
  A: "1",
  H: "2",
  G: "3",
  M: "4",
  T: "5",
  I: "6",
  N: "7",
  Y: "8",
  C: "9",
  S: "10",
  Z: "11",
  E: "12",
  F: "13",
};

function formatLineNo(n: string, lang: Lang) {
  if (lang === "en") return `Line ${n}`;
  return lang === "zh" ? `${n}号线` : `${n}号線`;
}

function extractLineNo(name: string, lang: Lang) {
  const m = name.match(/(\d+)\s*号/u);
  if (m) return formatLineNo(m[1]!, lang);
  const letter = name.trim().match(/^([A-Z])(?:\d+)?$/);
  if (letter && LINE_LETTER[letter[1]!]) return formatLineNo(LINE_LETTER[letter[1]!]!, lang);
  const city = /札幌|京都|仙台|神戸/.test(name);
  for (const [re, n] of LINE_NOS) {
    if (!re.test(name)) continue;
    if (city && /東西|南北|三田|东西/.test(re.source)) continue;
    return formatLineNo(n, lang);
  }
  return "";
}

function validHhmm(s?: string) {
  return Boolean(s && /^\d{1,2}:\d{2}$/.test(s));
}

function hhmmToMin(s: string) {
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Locked official plan vs live ETA: `14:04着（遅1分）`. On-time shows plan only. */
export function arrivalCompare(train: Train, now: Date, t: Copy, lang: Lang) {
  const plan = validHhmm(train.alightHhmm) ? train.alightHhmm! : "";
  const live = arriveHhmmOf(train, now);
  const planMin = plan ? hhmmToMin(plan) : null;
  const liveMin = live ? hhmmToMin(live) : null;
  let lateMin = 0;
  if (liveMin != null && planMin != null) {
    let d = liveMin - planMin;
    if (d < -720) d += 1440;
    if (d > 720) d -= 1440;
    lateMin = Math.max(0, Math.round(d));
  }
  if (lateMin <= 0 && train.delayMin > 0) lateMin = Math.round(train.delayMin);
  const shown = plan || live;
  if (!shown) return "";
  if (lateMin <= 0) {
    if (train.delayAlert) return `${shown}${t.arriveAt}（${t.delay}）`;
    return `${shown}${t.arriveAt}`;
  }
  const tag = lang === "en" ? `${lateMin} min late` : lang === "zh" ? `晚${lateMin}分` : `遅${lateMin}分`;
  return `${shown}${t.arriveAt}（${tag}）`;
}

function withTimes(journey: Journey): RouteLeg[] {
  if (journey.source === "yahoo" || journey.source === "google") return journey.legs;
  const index = useMapStore.getState().stationIndex;
  return ensureConnections(journey, index, simNow()).legs;
}

export function rideHeadline(leg: Pick<RouteLeg, "lineName" | "toward" | "to"> & Partial<Pick<RouteLeg, "lineId" | "from">>, t: Copy, lang: Lang) {
  const line = prettyLine(findLine(leg)?.name || leg.lineName || t.line, lang);
  const toward = displayName(cleanBound(leg.toward || leg.to?.name || ""), lang);
  if (!toward) return line;
  if (lang === "en") return `${line} ${t.boundFor} ${toward}`;
  return `${line} ${toward}行`;
}

export function rideLabel(leg: RouteLeg, t: Copy) {
  if (leg.kind === "walk") return t.walk;
  return rideHeadline(leg, t, useMapStore.getState().lang);
}

export type GuideStep = { kind: "alight" | "xfer" | "time" | "head"; text: string; extra?: string; extraAlert?: boolean };

function cleanBound(s: string) {
  return s.replace(/(行き|行|方面|方向)+$/gu, "").trim();
}

function prettyLine(raw: string, lang: Lang) {
  let n = (raw || "").trim().replace(/[Ｊｊ][Ｒｒ]/gu, "JR");
  n = n.replace(/アーバンパーク(?:ライン)?/u, "野田");
  n = n.replace(/スカイツリー(?:ライン)?/u, "伊勢崎");
  n = n.replace(/[（(][^）)]{0,48}[）)]/gu, "");
  n = n.replace(/各駅停車|各停|普通|快速|急行|特急|準急|通勤快速|区間快速|快速列車/gu, "");
  if (/[・･]/.test(n)) {
    const parts = n.split(/[・･]/u).map((p) => p.trim()).filter(Boolean);
    const withSen = parts.find((p) => /[線线]/.test(p));
    if (withSen) n = withSen;
  }
  n = n.replace(/[・･][^・･]*行$/u, "");
  n = n.replace(/^(?:JR[\s\u3000]*)+(?:(?:東日本|西日本|東海|北海道|九州|四国)(?:旅客鉄道)?(?![道線线]))?/iu, "");
  n = n.replace(/^東京地下鉄/u, "メトロ").replace(/^東京メトロ/u, "メトロ");
  n = n.replace(/^東武鉄道/u, "東武").replace(/^西武鉄道/u, "西武");
  n = n.replace(/^京成電鉄/u, "京成").replace(/^京王電鉄/u, "京王");
  n = n.replace(/^京浜急行(?:電鉄)?/u, "京急").replace(/^東急電鉄|^東京急行電鉄/u, "東急");
  n = n.replace(/^小田急電鉄/u, "小田急").replace(/^名古屋鉄道/u, "名鉄");
  n = n.replace(/^近畿日本鉄道/u, "近鉄").replace(/^南海電気鉄道/u, "南海");
  n = n.replace(/^阪急電鉄/u, "阪急").replace(/^阪神電気鉄道/u, "阪神").replace(/^相模鉄道/u, "相鉄");
  n = n.replace(/^[・･\s\u3000]+/u, "");
  n = n.replace(/線線/gu, "線").replace(/线线/gu, "线").trim();
  const privateOp = /地下鉄|メトロ|都営|東武|西武|京成|京急|東急|小田急|京王|名鉄|近鉄|南海|阪急|阪神/.test(n);
  const jr =
    !privateOp &&
    /山手|中央|総武|京浜|根岸|埼京|京葉|常磐|東海道|横須賀|宇都宮|高崎|湘南|南武|武蔵野|青梅|横浜|内房|外房|成田|常盘/.test(n);
  let shown = displayName(jr ? `JR${n}` : n, lang).replace(/[Ｊｊ][Ｒｒ]/gu, "JR");
  shown = shown.replace(/^(?:JR[\s\u3000]*)+/iu, "JR");
  if (shown && !/線|线|新幹線|新干线|Line/i.test(shown)) shown += lang === "zh" ? "线" : lang === "en" ? "" : "線";
  if (lang !== "en") shown = shown.replace(/\s+/g, "");
  return shown;
}

function rideTitle(leg: RouteLeg, t: Copy, lang: Lang) {
  return rideHeadline(leg, t, lang);
}

function platformLabel(n: string | undefined, lang: Lang, t: Copy) {
  if (!n) return "";
  if (lang === "en") return `${t.platform} ${n}`;
  return `${n}${t.platform}`;
}

function timeRow(leg: RouteLeg, t: Copy, lang: Lang) {
  const dep = validHhmm(leg.departHhmm) ? leg.departHhmm : "";
  const arr = validHhmm(leg.arriveHhmm) ? leg.arriveHhmm : "";
  if (!dep && !arr) return "";
  const from = displayName(leg.from.name, lang);
  const to = displayName(leg.to.name, lang);
  const fp = platformLabel(leg.fromPlatform, lang, t);
  const tp = platformLabel(leg.toPlatform, lang, t);
  const depBit = dep ? `${dep} ${from}${fp ? ` ${fp}` : ""}${t.departAt}` : "";
  const arrBit = arr ? `${arr} ${to}${tp ? ` ${tp}` : ""} ${t.arriveAt}` : "";
  return [depBit, arrBit].filter(Boolean).join(" ── ");
}

function stopsAway(leg: RouteLeg, train: Train | null) {
  if (!train) return null;
  const line = findLine(leg);
  if (!line) return null;
  const toI = line.stops.findIndex((s) => s.n === leg.to.name || s.n === train.dest);
  const nowI = line.stops.findIndex((s) => s.n === train.nextStop);
  if (toI < 0 || nowI < 0) return null;
  return Math.max(0, Math.abs(toI - nowI));
}

function trainForLeg(leg: RouteLeg, train: Train | null, live: Train[]) {
  if (
    train &&
    train.kind !== "flight" &&
    ((leg.lineId && train.lineId === leg.lineId) ||
      (leg.lineName && (train.lineName.includes(leg.lineName) || leg.lineName.includes(train.lineName))))
  ) {
    return train;
  }
  return (
    live.find(
      (tr) =>
        tr.kind !== "flight" &&
        ((leg.lineId && tr.lineId === leg.lineId) ||
          (leg.lineName && (tr.lineName.includes(leg.lineName) || leg.lineName.includes(tr.lineName)))),
    ) ?? null
  );
}

function statusExtra(leg: RouteLeg, train: Train | null, t: Copy, lang: Lang, tripSec = 0, delayAlert = false) {
  const dep = validHhmm(leg.departHhmm) ? leg.departHhmm : "";
  const st = displayName(leg.from.name, lang);
  const head = [dep, `${st}${t.departAt}`].filter(Boolean).join(" ");
  const bits: string[] = [];
  const left = stopsAway(leg, train);
  const delayed = tripSec > 0 || delayAlert;
  const delayBit = tripSec > 0 ? `${t.delay} ${tripSec}${t.sec}` : t.delay;
  if (train && left != null) {
    if (delayed) bits.push(delayBit);
    else bits.push(t.runningNow);
    bits.push(t.stopsLeft.replace("{n}", String(left)));
  } else if (delayed) {
    bits.push(delayBit);
  } else bits.push(t.onTime);
  return { text: head ? `${head}（${bits.join("・")}）` : bits.join("・"), alert: delayed };
}

function walkBit(min: number, t: Copy) {
  const n = Math.round(min);
  if (n <= 0) return "";
  return `${t.walkAbout}${n}${t.min}`;
}

function xferWalkMinutes(legs: RouteLeg[], rideI: number) {
  let seen = -1;
  let prevAt = -1;
  for (let i = 0; i < legs.length; i++) {
    if (legs[i]!.kind !== "ride") continue;
    seen += 1;
    if (seen === rideI) {
      if (rideI <= 0 || prevAt < 0) return 0;
      let m = 0;
      for (let j = prevAt + 1; j < i; j++) {
        if (legs[j]!.kind === "walk") m += legs[j]!.minutes;
      }
      return m;
    }
    prevAt = i;
  }
  return 0;
}

export function journeyGuide(journey: Journey, train: Train | null, t: Copy) {
  const lang = useMapStore.getState().lang;
  const live = useMapStore.getState().liveTrains;
  const stamped = stampJourneyDelay(journey, live);
  const timed = withTimes(stamped);
  const rides = timed.filter((l) => l.kind === "ride");
  let idx = 0;
  if (train && train.kind !== "flight") {
    const hit = rides.findIndex(
      (l) =>
        (l.lineId && l.lineId === train.lineId) ||
        (l.lineName && (train.lineName.includes(l.lineName) || l.lineName.includes(train.lineName))),
    );
    if (hit >= 0) idx = hit;
  }
  const cur = rides[idx] ?? rides[0];
  const toward = cur?.toward || cur?.to.name || "";
  const head = cur
    ? rideHeadline({ lineName: cur.lineName, toward, to: cur.to, from: cur.from, lineId: cur.lineId }, t, lang)
    : train
      ? rideHeadline({ lineName: train.lineName, toward: train.dest, to: { name: train.dest, lng: 0, lat: 0, prefecture: "" } }, t, lang)
      : "";
  const next = train && train.kind !== "flight" ? `${t.nextStop} ${displayName(train.nextStop, lang)}` : "";
  const steps: GuideStep[] = [];
  const tripSec = journeyDelaySeconds(stamped);
  const delayAlert = Boolean(stamped.delayAlert);
  rides.forEach((leg, i) => {
    const liveTrain = trainForLeg(leg, i === idx ? train : null, live);
    const status = statusExtra(leg, liveTrain, t, lang, tripSec, delayAlert);
    const title = rideTitle(leg, t, lang);
    if (i === 0) steps.push({ kind: "head", text: title, extra: status.text, extraAlert: status.alert });
    else {
      const w = walkBit(xferWalkMinutes(timed, i), t);
      steps.push({ kind: "xfer", text: `${t.transferColon}${w ? `${w} ` : ""}${title}`, extra: status.text, extraAlert: status.alert });
    }
    const times = timeRow(leg, t, lang);
    if (times) steps.push({ kind: "time", text: times });
  });
  const alights = steps.map((s) => (s.extra ? `${s.text}  ${s.extra}` : s.text));
  return { head, next, alights, steps };
}

export function transferSteps(journey: Journey, t: Copy) {
  const rides = journey.legs.filter((l) => l.kind === "ride");
  const steps: string[] = [];
  rides.forEach((leg, i) => {
    if (i > 0) steps.push(`${displayName(leg.from.name, useMapStore.getState().lang)} ${t.transfer}`);
    steps.push(`${rideLabel(leg, t)} → ${displayName(leg.to.name, useMapStore.getState().lang)}`);
  });
  return steps;
}

export function transferLine(journey: Journey, t: Copy) {
  const lang = useMapStore.getState().lang;
  const rides = journey.legs.filter((l) => l.kind === "ride");
  return rides
    .map((leg, i) => {
      const title = rideHeadline(leg, t, lang);
      if (i === 0) return title;
      const w = walkBit(xferWalkMinutes(journey.legs, i), t);
      return w ? `${t.transfer} ${w} ${title}` : `${t.transfer} ${title}`;
    })
    .filter(Boolean)
    .join(" · ");
}

export function lockJourneyTrain(journey: Journey, opts?: { camera?: boolean }) {
  const store = useMapStore.getState();
  const stamped = stampJourneyDelay(journey, store.liveTrains);
  if (stamped.delaySec || stamped.delayMin || stamped.delayAlert) {
    const idx = store.journeys.findIndex(
      (j) => j.departHhmm === journey.departHhmm && j.arriveHhmm === journey.arriveHhmm && j.transfers === journey.transfers,
    );
    if (idx >= 0) {
      const next = store.journeys.slice();
      next[idx] = { ...next[idx]!, delayMin: stamped.delayMin, delaySec: stamped.delaySec, delayAlert: stamped.delayAlert };
      store.setJourneys(next, idx);
    }
  }
  const ride = stamped.legs.find((l) => l.kind === "ride") ?? stamped.legs[0];
  if (!ride) return;
  let pick = lockRide(ride);
  if (pick && ride.kind === "ride" && rideWaiting(ride, simNow(), stamped.delayMin ?? 0)) {
    pick = { ...pick, lng: ride.from.lng, lat: ride.from.lat };
    useMapStore.getState().selectTrain(pick);
  }
  if (opts?.camera !== false) fitJourneyCamera(stamped, pick);
}

function zoomToSpan(pts: [number, number][]) {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  for (const [lng, lat] of pts) {
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const km = Math.max(haversine([minLng, minLat], [maxLng, minLat]), haversine([minLng, minLat], [minLng, maxLat]));
  const padKm = Math.max(3.4, km * 1.55);
  const spanDeg = padKm / 111;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  const z = Math.log2((0.48 * Math.max(280, h) * 360) / (256 * Math.max(1e-4, spanDeg)));
  return {
    lng: (minLng + maxLng) / 2,
    lat: (minLat + maxLat) / 2,
    zoom: Math.max(8.2, Math.min(12.8, z)),
  };
}

export function fitJourneyCamera(journey: Journey, _train: Train | null) {
  const ride = journey.legs.find((l) => l.kind === "ride") ?? journey.legs[0];
  const origin = ride?.from ?? journey.origin;
  if (!origin) return;
  useMapStore.getState().requestFlyTo({
    lng: origin.lng,
    lat: origin.lat,
    zoom: 13.7,
    bearing: 0,
    pitch: 0.55,
    center: true,
  });
}

function fallbackTripTrain(leg: RouteLeg): Train {
  return {
    id: `trip:${leg.lineId || leg.lineName || "ride"}:${leg.from.name}:${leg.departHhmm || ""}`,
    lineId: leg.lineId ?? "",
    lineName: leg.lineName || "",
    color: leg.color || "#7ec8e3",
    kind: "jr",
    lng: leg.from.lng,
    lat: leg.from.lat,
    bearing: 0,
    dir: 0,
    dest: leg.toward || leg.to.name,
    nextStop: leg.to.name,
    prevStop: leg.from.name,
    delayMin: 0,
    progress: 0,
    stopIndex: 0,
    boardHhmm: leg.departHhmm,
    alightHhmm: leg.arriveHhmm,
  };
}

function pickTrainForLeg(leg: RouteLeg): Train | null {
  const store = useMapStore.getState();
  const line = findLine(leg);
  const from = { ...leg.from };
  const to = { ...leg.to };
  const path = line ? sliceRailPath(line, from, to) : leg.path;
  const placed = placeTrainOnLeg(leg, line, path, simNow(), store.journey?.delayMin ?? 0);
  if (placed) return placed;
  return line ? trainForSchedule(line, simNow(), leg.from.lng, leg.from.lat, leg.toward, leg.departHhmm, leg.to.name) : null;
}

function lockRide(leg: RouteLeg) {
  const store = useMapStore.getState();
  const pick = pickTrainForLeg(leg) ?? (leg.kind === "ride" ? fallbackTripTrain(leg) : null);
  if (pick) {
    store.selectStay(null);
    store.selectStation(null);
    store.selectTrain(pick);
    store.setFollowTrainId(null);
    store.setSheetOpen(false);
  }
  return pick;
}

function untilHhmm(hhmm: string, nowMin: number, delay = 0) {
  return minutesUntilDepart(hhmm, nowMin) + Math.max(0, delay);
}

export function RoutePanel({ journey }: { journey: Journey }) {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const journeys = useMapStore((s) => s.journeys);
  const journeyIndex = useMapStore((s) => s.journeyIndex);
  const liveTrains = useMapStore((s) => s.liveTrains);
  const view = stampJourneyDelay(journey, liveTrains);
  const nowMin = tokyoParts(simNow()).minutes;
  const upcoming = (journeys.length ? journeys : [journey]).filter((j) => untilHhmm(j.departHhmm, nowMin, j.delayMin ?? 0) >= 0);
  const list = upcoming.length ? upcoming : [];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={() => lockJourneyTrain(journey)}>
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {journey.source && journey.source !== "local" ? t.googleRoute : t.route}
          </p>
          <h2 className="mt-0.5 truncate text-base font-medium tracking-tight text-fg">
            {displayName(journey.origin.name, lang) || t.youAreHere}
            <span className="mx-1.5 text-fg-subtle">→</span>
            {displayName(journey.dest.name, lang)}
          </h2>
          <p className="mt-1 text-sm tabular-nums text-fg">
            <span className={untilHhmm(journey.departHhmm, nowMin, journey.delayMin ?? 0) >= 0 && list.slice(0, 2).some((j) => j.departHhmm === journey.departHhmm) ? "time-blink font-semibold" : ""}>
              {journey.departHhmm}
            </span>
            <span className="mx-1 text-fg-subtle">{t.departAt}</span>
            <span className="mx-1">→</span>
            {journey.arriveHhmm}
            <span className="mx-1 text-fg-subtle">{t.arriveAt}</span>
            <span className="ml-2">
              {t.about}
              {journey.totalMinutes}
              {t.min}
            </span>
            {journey.transfers > 0 ? (
              <span className="ml-2 text-fg-muted">
                {journey.transfers}
                {t.transfers}
              </span>
            ) : null}
            {journey.walkFromGpsMin ? (
              <span className="ml-2 text-fg-muted">
                {t.walkAbout}
                {Math.round(journey.walkFromGpsMin)}
                {t.min}
              </span>
            ) : null}
            {journey.walkToDestMin ? (
              <span className="ml-2 text-fg-muted">
                {t.walkAfter}
                {t.about}
                {Math.round(journey.walkToDestMin)}
                {t.min}
              </span>
            ) : null}
          </p>
          {journeyShowsDelay(view) ? (
            <p className="mt-1 text-sm font-medium text-[#e4453a]">
              {t.delay}
              {journeyDelaySeconds(view) > 0 ? ` ${journeyDelaySeconds(view)}${t.sec}` : ""}
            </p>
          ) : null}
        </button>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={t.close}
          onClick={() => useMapStore.getState().clearTrip()}
        >
          <X />
        </Button>
      </div>

      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {list.map((j, i) => {
          const shown = stampJourneyDelay(j, liveTrains);
          const active = journeys.length > 1 ? journeys.indexOf(j) === journeyIndex : true;
          const soon = i < 2;
          return (
            <li key={`${j.departHhmm}-${j.arriveHhmm}-${i}`}>
              <button
                type="button"
                className={`flex w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left ${active ? "bg-fg/10" : "hover:bg-fg/6"}`}
                onClick={() => {
                  const idx = journeys.indexOf(j);
                  if (idx >= 0) useMapStore.getState().setJourneys(journeys, idx);
                  lockJourneyTrain(j);
                }}
              >
                <span className="min-w-0">
                  <span className={`block text-sm tabular-nums ${soon ? "time-blink font-semibold" : "text-fg"}`}>
                    {j.departHhmm}
                    <span className="mx-1 text-fg-subtle">→</span>
                    {j.arriveHhmm}
                  </span>
                  <span className="block text-xs leading-relaxed text-fg-muted">
                    {transferLine(j, t)}
                    {j.walkToDestMin ? ` · ${t.walkAfter}${t.about}${Math.round(j.walkToDestMin)}${t.min}` : ""}
                  </span>
                  {journeyShowsDelay(shown) ? (
                    <span className="mt-1 block text-xs font-medium text-[#e4453a]">
                      {t.delay}
                      {journeyDelaySeconds(shown) > 0 ? ` ${journeyDelaySeconds(shown)}${t.sec}` : ""}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums text-fg">
                  {j.totalMinutes}
                  {t.min}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <ol className="flex flex-col gap-2">
        {journey.legs.map((leg, i) => {
          const prev = journey.legs[i - 1];
          const xfer = i > 0 && leg.kind === "ride" && (prev?.kind === "ride" || (prev?.kind === "walk" && journey.legs[i - 2]?.kind === "ride"));
          const xferMin = prev?.kind === "walk" && journey.legs[i - 2]?.kind === "ride" ? prev.minutes : 0;
          return (
          <li key={`${leg.kind}-${leg.from.name}-${leg.to.name}-${i}`}>
            {xfer ? (
              <p className="mb-1.5 px-1 text-xs text-fg-muted">
                {t.transfer}
                {xferMin ? ` ${walkBit(xferMin, t)}` : ""}
              </p>
            ) : null}
            <LegCard leg={leg} t={t} />
          </li>
          );
        })}
      </ol>
    </section>
  );
}

function LegCard({
  leg,
  t,
}: {
  leg: RouteLeg;
  t: Copy;
}) {
  const lang = useMapStore.getState().lang;
  const stopCount = Math.max(0, leg.stops.length - 1);
  return (
    <div className="rounded-[var(--radius-md)] bg-bg-subtle p-2.5">
      <button type="button" className="w-full text-left" onClick={() => lockRide(leg)}>
        <div className="flex items-center gap-2">
          {leg.kind === "walk" ? (
            <Footprints className="size-4 text-fg-muted" />
          ) : (
            <span className="h-3 w-1.5 rounded-full" style={{ background: leg.color }} />
          )}
          <p className="min-w-0 text-sm leading-snug font-medium text-fg">
            {leg.kind === "walk" ? t.walk : rideHeadline(leg, t, lang)}
          </p>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-fg-muted">
            {Math.round(leg.minutes)}
            {t.min}
          </span>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-fg">
          <span className="truncate">{leg.from.name || t.youAreHere}</span>
          <ArrowRight className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="truncate">{leg.to.name}</span>
        </p>
        {leg.kind === "ride" ? (
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            {leg.departHhmm ? `${leg.departHhmm}${t.departAt} ` : ""}
            {t.board}
            {leg.toward ? ` ${displayName(leg.toward, lang)}${lang === "zh" ? "行" : lang === "en" ? "" : "行き"}` : ""}
            <span className="mx-1.5 text-fg-subtle">·</span>
            {stopCount}
            {t.stopsCount}
            {leg.arriveHhmm ? (
              <>
                <span className="mx-1.5 text-fg-subtle">·</span>
                {leg.arriveHhmm}
                {t.getOff}
                {displayName(leg.to.name, lang)}
              </>
            ) : null}
          </p>
        ) : (
          <p className="mt-1 text-xs text-fg-muted">
            {t.walkAbout}
            {Math.round(leg.minutes)}
            {t.min}
            {leg.departHhmm ? ` · ${leg.departHhmm}` : ""}
          </p>
        )}
      </button>
      {leg.kind === "ride" ? (
        <Button variant="quiet" size="sm" className="mt-2 w-full" onClick={() => lockRide(leg)}>
          <TrainFront />
          {t.watch}
        </Button>
      ) : null}
    </div>
  );
}