import { useEffect } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { JapanMap } from "@/components/map/japan-map";
import { SearchPanel, locateUser, startTransitRefresh, mergeCalibratedLive } from "@/components/app/search-panel";
import { StayBar, StayBubble, StayCatalog, StayChat } from "@/components/app/stay-catalog";
import { KonbiniBar, KonbiniBubble, KonbiniChat, KonbiniLoadingChip } from "@/components/app/konbini-panel";
import { PeakBubble, PeakCatalog } from "@/components/app/peak-catalog";
import { PartyButton, PartySafe, MateBar } from "@/components/app/party-panel";
import { BootSplash } from "@/components/app/boot-splash";
import { QuakePanel } from "@/components/app/quake-panel";
import { WeatherChip } from "@/components/app/weather-chip";
import { InstallChip } from "@/components/app/install-app";
import { DetailPanel, FollowCard } from "@/components/app/timetable-panel";
import { Button } from "@/components/ui/button";
import { copies } from "@/lib/i18n";
import { isNightService } from "@/lib/rail/simulate";
import { startLivePoll } from "@/lib/rail/realtime";
import { startQuakePoll } from "@/lib/quake";
import { startWeatherPoll } from "@/lib/weather";
import { startRadarPoll } from "@/lib/radar";
import { tokyoParts } from "@/lib/rail/geo";
import { prepareLine, buildStationIndex, unpackRails, type CompactRails } from "@/lib/rail/normalize";
import { useMapStore, simNow } from "@/store/map-store";
import { registerPwa } from "@/lib/pwa";

export function AppShell() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const ready = useMapStore((s) => s.ready);
  const sheetOpen = useMapStore((s) => s.sheetOpen);
  const originStation = useMapStore((s) => s.originStation);
  const destStation = useMapStore((s) => s.destStation);
  const selectedStay = useMapStore((s) => s.selectedStay);
  const selectedKonbini = useMapStore((s) => s.selectedKonbini);
  const selectedMate = useMapStore((s) => s.selectedMate);
  const selectedPeak = useMapStore((s) => s.selectedPeak);
  const selectedTrain = useMapStore((s) => s.selectedTrain);
  const odptKey = useMapStore((s) => s.odptKey);
  const night = isNightService(tokyoParts(simNow()).minutes);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang === "zh" ? "zh-CN" : lang === "en" ? "en" : "ja";
    html.classList.toggle("lang-zh", lang === "zh");
    html.classList.toggle("lang-ja", lang === "ja");
    html.classList.toggle("lang-en", lang === "en");
  }, [lang]);

  useEffect(() => {
    const tick = () => useMapStore.getState().setClock(tokyoParts(simNow()).hhmmss);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    locateUser(false);
  }, []);

  useEffect(() => {
    void registerPwa();
  }, []);

  useEffect(() => {
    let y0 = 0;
    const allows = (target: EventTarget | null, dy: number) => {
      const el = target instanceof Element ? target : null;
      if (el?.closest("input, textarea, select, button, [role='slider']")) return true;
      let n: HTMLElement | null = el instanceof HTMLElement ? el : el?.parentElement ?? null;
      while (n && n !== document.body) {
        const oy = window.getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll" || oy === "overlay") && n.scrollHeight > n.clientHeight + 1) {
          if (dy > 0 && n.scrollTop > 0) return true;
          if (dy < 0 && n.scrollTop + n.clientHeight < n.scrollHeight - 1) return true;
          return false;
        }
        n = n.parentElement;
      }
      return false;
    };
    const onStart = (e: TouchEvent) => {
      y0 = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const y = e.touches[0]?.clientY ?? y0;
      if (allows(e.target, y0 - y)) return;
      e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    document.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.addEventListener("touchmove", onMove, { capture: true, passive: false });
    document.addEventListener("gesturestart", onGesture, { capture: true, passive: false });
    return () => {
      document.removeEventListener("touchstart", onStart, true);
      document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("gesturestart", onGesture, true);
    };
  }, []);

  useEffect(() => {
    const stay = () => {
      if (window.history.state?.jb !== "app") history.pushState({ jb: "app" }, "");
    };
    history.replaceState({ jb: "guard" }, "");
    history.pushState({ jb: "app" }, "");
    const stepBack = () => {
      const s = useMapStore.getState();
      if (s.sheetOpen) {
        s.setSheetOpen(false);
        return;
      }
      if (s.selectedTrain || s.followTrainId) {
        s.selectTrain(null);
        s.setFollowTrainId(null);
        return;
      }
      if (s.journey || s.destStation || s.journeys.length) {
        s.clearTrip();
        return;
      }
      if (s.pickField) {
        s.setPickField(null);
        return;
      }
      if (s.selectedStay) {
        if (s.stayChat) s.setStayChat(false);
        else s.selectStay(null);
        return;
      }
      if (s.selectedKonbini) {
        if (s.konbiniChat) s.setKonbiniChat(false);
        else s.selectKonbini(null);
        return;
      }
      if (s.selectedPeak) {
        s.selectPeak(null);
        return;
      }
      if (s.selectedStation) {
        s.selectStation(null);
        return;
      }
      if (s.partyMenuOpen) {
        s.setPartyMenuOpen(false);
        return;
      }
      if (s.stayMenuOpen) {
        s.setStayMenuOpen(false);
        return;
      }
      if (s.quakeMenuOpen) {
        s.setQuakeMenuOpen(false);
        return;
      }
      if (s.radarEnabled) {
        s.setRadarEnabled(false);
        return;
      }
      if (s.mountainLayer) {
        s.setMountainLayer(false);
      }
    };
    const onPop = () => {
      stepBack();
      stay();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const res = await fetch("/data/rails.min.json");
        if (!res.ok || cancelled) return;
        const compact = (await res.json()) as CompactRails;
        if (cancelled) return;
        await new Promise((r) => window.setTimeout(r, 0));
        if (cancelled) return;
        const raw = unpackRails(compact);
        const lines = [];
        for (let i = 0; i < raw.length; i++) {
          lines.push(prepareLine(raw[i]!));
          if (i % 48 === 0) await new Promise((r) => window.setTimeout(r, 0));
          if (cancelled) return;
        }
        const index = buildStationIndex(lines);
        if (cancelled) return;
        useMapStore.getState().setDataset(lines, index);
      } catch {
        /* map already visible */
      }
    };
    const id = window.setTimeout(() => void boot(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    return startLivePoll(
      () => useMapStore.getState().lines,
      () => useMapStore.getState().odptKey,
      ({ trains, source, error, stale }) => {
        if (!trains.length && stale) {
          useMapStore.getState().setLive(useMapStore.getState().liveTrains, "sim", error);
          return;
        }
        useMapStore.getState().setLive(mergeCalibratedLive(trains), trains.length ? source : "sim", stale ? error : null);
      },
    );
  }, [odptKey, ready]);

  useEffect(() => startQuakePoll((quakes) => useMapStore.getState().setQuakes(quakes)), []);
  useEffect(() => startWeatherPoll((spots) => useMapStore.getState().setWeatherSpots(spots)), []);
  useEffect(() => startRadarPoll(), []);
  useEffect(() => {
    if (!ready) return;
    return startTransitRefresh();
  }, [ready]);

  return (
    <div className="relative h-[100svh] min-h-[100svh] w-full overflow-hidden overscroll-none bg-bg text-fg">
      <BootSplash />
      <JapanMap />
      <KonbiniLoadingChip />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start gap-3 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          <div
            className="flex size-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 shadow-[var(--shadow-border)] backdrop-blur-md"
            aria-label={t.title}
          >
            <span
              className="leading-none font-black"
              style={{
                color: "#ff6a1a",
                fontFamily: '"Hiragino Maru Gothic ProN", "Arial Rounded MT Bold", "Nunito", ui-rounded, system-ui, sans-serif',
                fontSize: "1.85rem",
                letterSpacing: "0.02em",
                transform: "scale(1.12, 1.05)",
              }}
            >
              J
            </span>
          </div>
          {selectedStay || selectedKonbini ? null : <WeatherChip />}
          <InstallChip />
        </div>
      </header>

      <div className="pointer-events-none absolute top-[4.75rem] left-3 z-20 flex flex-col items-start gap-2 pt-[env(safe-area-inset-top)]">
        {selectedStay || selectedKonbini ? null : (
          <div className="pointer-events-auto">
            <QuakePanel />
          </div>
        )}
        <div className="pointer-events-auto flex flex-row items-start gap-1">
          <PeakCatalog />
          <StayCatalog />
        </div>
        <div className="pointer-events-auto">
          <PartyButton />
        </div>
      </div>

      {selectedPeak && !selectedStay && !selectedKonbini ? <PeakBubble /> : null}

      {selectedStay ? (
        <>
          <StayBubble />
          <StayBar />
          <StayChat />
        </>
      ) : selectedKonbini ? (
        <>
          <KonbiniBubble />
          <KonbiniBar />
          <KonbiniChat />
        </>
      ) : selectedMate ? (
        <MateBar />
      ) : (
      <aside className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:inset-y-0 md:top-0 md:right-auto md:w-[360px] md:p-4 md:pt-24 ${selectedTrain ? "max-md:hidden" : ""}`}>
        <div
          className={`pointer-events-auto flex flex-col overflow-hidden rounded-[var(--radius-xl)] bg-surface/94 shadow-[var(--shadow-border)] backdrop-blur-md ${
            sheetOpen ? "max-h-[56vh] gap-3 p-3 md:max-h-[calc(100dvh-7.5rem)] md:p-4" : "p-2 md:p-3"
          }`}
        >
          <div className="relative flex w-full items-center justify-center py-1">
            <button
              type="button"
              className="flex items-center justify-center py-1 text-fg-muted"
              aria-label={sheetOpen ? t.panelClose : t.panelOpen}
              onClick={() => useMapStore.getState().setSheetOpen(!sheetOpen)}
            >
              {sheetOpen ? <ChevronDown className="size-5" /> : <ChevronUp className="size-5" />}
            </button>
            <button
              type="button"
              className="absolute top-0 right-0 rounded-full p-1.5 text-fg-muted hover:bg-fg/8 hover:text-fg"
              aria-label={t.close}
              onClick={() => {
                const s = useMapStore.getState();
                s.setOrigin(null);
                s.setDest(null);
                s.setJourney(null);
                s.setJourneys([]);
                s.setPickField(null);
                s.selectTrain(null);
                s.setFollowTrainId(null);
                s.selectStation(null);
                s.setSheetOpen(false);
              }}
            >
              <X className="size-4" />
            </button>
          </div>
          {sheetOpen ? (
            <>
              <SearchPanel />
              <div className="h-px bg-border" />
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                {night ? <p className="mb-2 text-sm text-fg-muted">{t.night}</p> : null}
                <DetailPanel />
              </div>
              <p className="text-[11px] leading-snug text-fg-subtle">{t.estimated}</p>
            </>
          ) : (
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-2 pb-1 text-left"
              onClick={() => useMapStore.getState().setSheetOpen(true)}
            >
              <span className="min-w-0 truncate text-sm text-fg">
                {originStation?.name ?? t.from}
                <span className="mx-1.5 text-fg-subtle">→</span>
                {destStation?.name ?? t.toPlaceholder}
              </span>
              <span className="shrink-0 text-xs text-fg-muted">{t.panelOpen}</span>
            </button>
          )}
        </div>
      </aside>
      )}

      {selectedTrain && !selectedStay && !selectedKonbini ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto mx-auto w-full max-w-md">
            <FollowCard />
          </div>
        </div>
      ) : null}

      <PartySafe />
    </div>
  );
}
