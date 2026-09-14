import { TrainFront, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { RoutePanel, journeyGuide, rideHeadline, arrivalCompare } from "@/components/app/route-panel";
import { flightCode, flightRoute } from "@/components/map/canvas-map";
import { copies, displayName } from "@/lib/i18n";
import { liveDelayOnTrain, liveDelayFor, delaySeconds, liveDelaySeconds, journeyDelaySeconds } from "@/lib/rail/delay";
import { bearingDeg, compass8, formatKm, formatUntil, toHhmm, tokyoParts, arriveHhmmOf } from "@/lib/rail/geo";
import { departuresAt, flightsNear } from "@/lib/rail/schedule";
import { jrItemsToDepartures, jrItemsToTrains, untilFromHhmm, type JrBoardItem } from "@/lib/rail/jreast";
import { isNightService, nearestTrainOnLine, trainById } from "@/lib/rail/simulate";
import type { Departure, StationHit, Train } from "@/lib/rail/types";
import { Button } from "@/components/ui/button";
import { useMapStore, simNow } from "@/store/map-store";

export function FollowCard() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const train = useMapStore((s) => s.selectedTrain);
  const followTrainId = useMapStore((s) => s.followTrainId);
  const journey = useMapStore((s) => s.journey);
  const liveTrains = useMapStore((s) => s.liveTrains);
  if (!train && !journey) return null;
  const live = Boolean(train && followTrainId === train.id);
  const realtimeSec = liveDelaySeconds(train, liveTrains);
  const tripSec = journeyDelaySeconds(journey);
  const guide = journey && train?.kind !== "flight" ? journeyGuide(journey, train, t) : null;
  const head =
    train?.kind === "flight"
      ? flightCode(train)
      : guide?.head ||
        (train
          ? rideHeadline(
              { lineName: train.lineName, toward: train.dest, to: { name: train.dest, lng: 0, lat: 0, prefecture: "" } },
              t,
              lang,
            )
          : t.route);
  const sub = train?.kind === "flight" ? flightRoute(train, lang) : "";
  const arrLine = train && train.kind !== "flight" ? arrivalCompare(train, simNow(), t, lang) : "";
  const nextName = train ? displayName(train.nextStop || train.dest || train.prevStop, lang) : "";
  const lateLook = /晚|遅|late|見合わせ|停运|suspend/i.test(arrLine);
  const officialLate = Boolean(train && (delaySeconds(train) > 0 || train.delayAlert));
  const gpsOn = Boolean(train && train.kind !== "flight" && (train.posStatus === "live" || train.gps));
  const gpsRunning = Boolean(gpsOn && !train?.liveLate && delaySeconds(train) <= 0 && !train?.delayAlert);
  const statusText =
    !train || train.kind === "flight"
      ? ""
      : gpsRunning
        ? t.posLiveOk
        : gpsOn && (train.liveLate || officialLate)
          ? t.posLiveLate
          : gpsOn
            ? t.posLive
            : "";
  const haltText =
    !gpsRunning && (train?.suspended || journey?.suspended) ? t.suspend : !gpsOn && officialLate ? `${t.delay}${realtimeSec > 0 ? ` ${realtimeSec}${t.sec}` : ""}` : "";
  return (
    <section className="rounded-[var(--radius-xl)] bg-surface/96 p-3 shadow-[var(--shadow-border)] backdrop-blur-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            {train?.kind === "flight" ? t.kindFlight : t.follow}
          </p>
          <div className="mt-0.5 flex items-start gap-2">
            <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: train?.color ?? journey?.legs.find((l) => l.color)?.color }} />
            <div className="min-w-0">
              <p className="text-sm leading-snug font-medium text-fg">{head}</p>
              {sub ? <p className="mt-1 text-[15px] leading-snug font-medium text-fg">{sub}</p> : null}
              {train && train.kind !== "flight" ? (
                <p className={`mt-1 text-sm ${lateLook ? "font-medium text-[#e4453a]" : "text-fg-muted"}`}>
                  {t.nextStop} {nextName}
                  {arrLine ? `  ${arrLine}` : ""}
                </p>
              ) : null}
              {!guide && !arrLine && realtimeSec > 0 ? (
                <p className="mt-1 text-sm font-medium text-[#e4453a]">
                  {t.delay} {realtimeSec}
                  {t.sec}
                </p>
              ) : !guide && !arrLine && tripSec > 0 ? (
                <p className="mt-1 text-sm font-medium text-[#e4453a]">
                  {t.delay} {tripSec}
                  {t.sec}
                </p>
              ) : null}
              {statusText ? <p className="mt-1 text-[11px] leading-snug text-fg-muted">{statusText}</p> : null}
              {haltText ? <p className="mt-1 text-sm font-medium text-[#e4453a]">{haltText}</p> : null}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={t.close}
          onClick={() => {
            const s = useMapStore.getState();
            s.dismissPick();
            s.clearTrip();
            s.setOrigin(null);
            s.setSheetOpen(false);
          }}
        >
          <X />
        </Button>
      </div>
      <div className="mt-3 flex gap-2">
        {train ? (
          <Button
            variant={live ? "solid" : "quiet"}
            size="sm"
            className="min-w-0 flex-1"
            onClick={() => {
              const s = useMapStore.getState();
              if (live) {
                s.setFollowTrainId(null);
                return;
              }
              s.setFollowTrainId(train.id);
              s.requestFlyTo({ lng: train.lng, lat: train.lat, zoom: 14, bearing: 0, pitch: 0.55 });
            }}
          >
            <TrainFront />
            {live ? t.unfollow : t.lockFollow}
          </Button>
        ) : null}
        {journey ? (
          <Button
            variant="quiet"
            size="sm"
            className="min-w-0 flex-1"
            onClick={() => {
              const s = useMapStore.getState();
              s.selectTrain(null);
              s.setFollowTrainId(null);
              s.setSheetOpen(true);
            }}
          >
            {t.otherTrains}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function boardTargets(station: StationHit) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of station.lines) {
    const ends = [line.stops[0], line.stops[line.stops.length - 1]];
    for (const s of ends) {
      if (!s || s.n === station.name || seen.has(s.n)) continue;
      seen.add(s.n);
      out.push(`${s.lat},${s.lng},${s.n}`);
      if (out.length >= 5) return out;
    }
  }
  return out;
}

export function DetailPanel() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const station = useMapStore((s) => s.selectedStation);
  const train = useMapStore((s) => s.selectedTrain);
  const followTrainId = useMapStore((s) => s.followTrainId);
  const nearestStations = useMapStore((s) => s.nearestStations);
  const userLocation = useMapStore((s) => s.userLocation);
  const journey = useMapStore((s) => s.journey);
  const destStation = useMapStore((s) => s.destStation);
  const lines = useMapStore((s) => s.lines);
  const [rows, setRows] = useState<Departure[]>([]);
  const [night, setNight] = useState(false);
  const viewTime = useMapStore((s) => s.viewTime);

  useEffect(() => {
    if (!station || journey) {
      setRows([]);
      return;
    }
    useMapStore.getState().setGoogleBoard([], []);
    useMapStore.getState().setJrBoard([], []);
    let cancelled = false;
    const pullGoogle = async () => {
      const targets = boardTargets(station);
      if (!targets.length) return;
      const params = new URLSearchParams({
        mode: "board",
        olat: String(station.lat),
        olng: String(station.lng),
        oname: station.name,
        targets: targets.join(";"),
        lang: useMapStore.getState().lang,
      });
      const vt = useMapStore.getState().viewTime;
      if (vt) params.set("at", String(Math.floor(simNow().getTime() / 1000)));
      try {
        const res = await fetch(`/api/google?${params}`);
        const data = (await res.json()) as { ok?: boolean; departures?: Departure[]; trains?: Train[] };
        if (cancelled) return;
        if (data.ok && data.departures?.length) {
          useMapStore.getState().setGoogleBoard(data.departures, data.trains ?? []);
        }
      } catch {
        /* keep sim */
      }
    };
    const pullJr = async () => {
      if (useMapStore.getState().viewTime) return;
      const hasJr = station.lines.some((l) => l.kind === "jr" || l.kind === "shinkansen");
      if (!hasJr) return;
      try {
        const res = await fetch(`/api/jr?name=${encodeURIComponent(station.name)}`);
        const data = (await res.json()) as { ok?: boolean; station?: string; items?: JrBoardItem[] };
        if (cancelled || !data.ok || !data.items?.length) return;
        if (data.station && data.station !== station.name && !station.name.startsWith(data.station) && !data.station.startsWith(station.name)) {
          return;
        }
        const minutes = tokyoParts().minutes;
        const items = data.items.map((it) => ({ ...it, minutesUntil: untilFromHhmm(it.hhmm, minutes) }));
        useMapStore.getState().setJrBoard(jrItemsToDepartures(items, station), jrItemsToTrains(items, station, minutes));
      } catch {
        /* keep other sources */
      }
    };
    void pullJr();
    void pullGoogle();
    const tick = () => {
      const now = simNow();
      setNight(isNightService(tokyoParts(now).minutes));
      const minutes = tokyoParts(now).minutes;
      const night = isNightService(minutes);
      const horizon = night ? 8 * 60 : 180;
      const live = useMapStore.getState().viewTime ? [] : useMapStore.getState().liveTrains;
      const jr = useMapStore.getState().jrDepartures.map((d) => ({
        ...d,
        minutesUntil: untilFromHhmm(d.hhmm, minutes),
        delayMin: Math.max(d.delayMin, liveDelayFor(live, d.lineId, d.dest)),
      })).filter((d) => d.minutesUntil >= 0 && d.minutesUntil < horizon);
      const extra = live
        .filter((t) => t.kind === "flight")
        .filter((t) => t.prevStop === station.name || t.nextStop === station.name)
        .slice(0, 8)
        .map((t) => ({
          id: t.id,
          lineId: t.lineId,
          lineName: t.lineName,
          color: t.color,
          dest: t.dest,
          dir: t.dir,
          minutesUntil: t.etaMin ?? 0,
          hhmm: toHhmm(tokyoParts(now).minutes + (t.etaMin ?? 0)),
          delayMin: t.delayMin,
          trainId: t.id,
          prevStop: t.prevStop,
          nextStop: t.nextStop,
        }));
      const flights = flightsNear(station.lng, station.lat, now);
      const google = useMapStore.getState().googleDepartures;
      const sim = departuresAt(station, now, 14).map((d) => ({
        ...d,
        delayMin: Math.max(d.delayMin, liveDelayFor(live, d.lineId, d.dest)),
      }));
      const timed = Boolean(useMapStore.getState().viewTime);
      const base = timed ? sim : jr.length ? jr.concat(flights) : google.length ? google.concat(flights) : sim;
      const merged = timed ? sim.concat(google) : jr.length ? jr.concat(extra, flights) : extra.concat(base);
      const seen = new Set<string>();
      const aligned = merged
        .map((d) => {
          const sched = untilFromHhmm(d.hhmm, minutes);
          return { ...d, minutesUntil: sched + Math.max(0, d.delayMin) };
        })
        .filter((d) => d.minutesUntil >= 0 && d.minutesUntil < horizon)
        .sort((a, b) => a.minutesUntil - b.minutesUntil || a.hhmm.localeCompare(b.hhmm))
        .filter((d) => (seen.has(`${d.lineId}|${d.hhmm}|${d.dest}`) ? false : (seen.add(`${d.lineId}|${d.hhmm}|${d.dest}`), true)));
      setRows(aligned.slice(0, 80));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [station, journey, viewTime]);

  const grouped = useMemo(() => {
    const map = new Map<string, Departure[]>();
    for (const row of rows) {
      const list = map.get(row.lineId) ?? [];
      list.push(row);
      map.set(row.lineId, list);
    }
    return [...map.entries()]
      .map(([id, deps]) => [id, deps.slice().sort((a, b) => a.minutesUntil - b.minutesUntil)] as const)
      .sort((a, b) => (a[1][0]?.minutesUntil ?? 0) - (b[1][0]?.minutesUntil ?? 0));
  }, [rows]);

  const watchDeparture = (d: Departure) => {
    const store = useMapStore.getState();
    const pools = store.jrTrains.concat(store.googleTrains, store.liveTrains);
    const exact = pools.find((t) => t.id === d.trainId);
    const byLine = pools.find(
      (t) => t.lineId === d.lineId && (t.dest === d.dest || t.nextStop === d.nextStop || t.nextStop === d.dest),
    );
    const sim = trainById(lines, simNow(), d.trainId);
    const line =
      lines.find((l) => l.id === d.lineId) ??
      lines.find((l) => l.name === d.lineName || l.name.includes(d.lineName) || d.lineName.includes(l.name.replace(/^JR/u, "")));
    const near =
      line && station ? nearestTrainOnLine(line, simNow(), station.lng, station.lat, d.dest) : null;
    const live =
      exact ??
      byLine ??
      sim ??
      near ??
      (station
        ? {
            id: d.trainId,
            lineId: d.lineId,
            lineName: d.lineName,
            color: d.color,
            kind: (line?.kind ?? "jr") as Train["kind"],
            lng: station.lng,
            lat: station.lat,
            bearing: 0,
            dir: d.dir,
            dest: d.dest,
            nextStop: d.nextStop || d.dest,
            prevStop: d.prevStop || station.name,
            delayMin: d.delayMin,
            progress: 0,
            stopIndex: 0,
          }
        : null);
    if (!live) return;
    store.selectTrain({
      ...live,
      delayMin: Math.max(live.delayMin, d.delayMin, liveDelayOnTrain(live, store.liveTrains)),
    });
    store.setFollowTrainId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {journey ? <RoutePanel journey={journey} /> : null}

      {destStation && !journey && !train ? (
        <p className="px-1 py-2 text-sm text-fg-muted">{t.noRoute}</p>
      ) : null}

      {!journey && !station && !train ? (
        <p className="px-1 py-2 text-sm text-fg-muted">{t.tapTrain}</p>
      ) : null}

      {!journey && station ? (
        <section>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-medium tracking-tight text-fg">{displayName(station.name, lang)}</h2>
              <p className="text-xs text-fg-muted">
                {displayName(station.prefecture, lang)}
                <span className="mx-1.5 text-fg-subtle">·</span>
                {station.lines.length}
                {t.line}
              </p>
              {(() => {
                const near = nearestStations.find((r) => r.station.name === station.name);
                if (!near || !userLocation) return null;
                const deg = bearingDeg([userLocation.lng, userLocation.lat], [station.lng, station.lat]);
                return (
                  <p className="mt-1 text-xs text-accent">
                    {t.nearestYou} · {t.fromYou} {formatKm(near.km)} {compass8(deg, lang)}
                  </p>
                );
              })()}
            </div>
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={t.close}
              onClick={() => useMapStore.getState().selectStation(null)}
            >
              <X />
            </Button>
          </div>
          {night && !viewTime ? (
            <p className="rounded-[var(--radius-sm)] bg-bg-subtle px-3 py-2 text-sm text-fg-muted">{t.night}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {grouped.map(([lineId, deps]) => {
                const first = deps[0]!;
                return (
                  <li key={lineId} className="rounded-[var(--radius-md)] bg-bg-subtle p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="h-3 w-1.5 rounded-full" style={{ background: first.color }} />
                      <p className="truncate text-xs font-medium text-fg">{displayName(first.lineName, lang)}</p>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {deps.map((d, i) => {
                        const active = followTrainId === d.trainId;
                        const imminent = i < 2;
                        return (
                          <li key={d.id}>
                            <button
                              type="button"
                              className={`w-full rounded-[var(--radius-sm)] px-1 py-1.5 text-left hover:bg-fg/6 ${active ? "bg-fg/10" : ""}`}
                              onClick={() => watchDeparture(d)}
                            >
                              <span className="flex w-full items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-sm text-fg">
                                {displayName(d.dest, lang)}
                                <span className="ml-1 text-xs text-fg-subtle">{t.terminal}</span>
                                {d.nextStop && d.nextStop !== d.dest ? (
                                  <span className="mt-0.5 block truncate text-xs text-fg-muted">
                                    {t.nextStop} {displayName(d.nextStop, lang)}
                                    <span className="mx-1 text-fg-subtle">·</span>
                                    {t.departAt} {d.hhmm}
                                  </span>
                                ) : (
                                  <span className="mt-0.5 block truncate text-xs text-fg-muted">
                                    {t.departAt} {d.hhmm}
                                  </span>
                                )}
                              </span>
                              <span className="flex shrink-0 items-baseline gap-2">
                                <span className={`text-xs tabular-nums ${imminent ? "time-blink font-semibold" : "text-fg-muted"}`}>{d.hhmm}</span>
                                <span className={`min-w-10 text-right text-sm font-medium tabular-nums ${imminent ? "time-blink" : "text-fg"}`}>
                                  {active ? t.watching : formatUntil(d.minutesUntil, t.arriving, t.min, t.departed)}
                                </span>
                              </span>
                              </span>
                              {d.delayMin > 0 ? (
                                <p className="mt-1 text-xs font-medium text-[#e4453a]">
                                  {t.delay} {Math.round(d.delayMin * 60)}
                                  {t.sec}
                                </p>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}