import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { PEAKS, PEAK_FOCUS_ZOOM, peakArea, peakLabel, type Peak } from "@/data/peaks";
import { copies } from "@/lib/i18n";
import { RADAR_JAPAN_LAT, RADAR_JAPAN_LNG, RADAR_JAPAN_ZOOM } from "@/lib/radar";
import { useMapStore } from "@/store/map-store";
import { closeLayer, openLayer } from "@/lib/menu-view";

export function focusPeak(peak: Peak) {
  const s = useMapStore.getState();
  s.exclusiveOpen("peaks");
  s.selectTrain(null);
  s.setFollowTrainId(null);
  s.selectStation(null);
  s.setSheetOpen(false);
  s.selectPeak(peak);
  s.requestFlyTo({
    lng: peak.lng,
    lat: peak.lat,
    zoom: PEAK_FOCUS_ZOOM,
    bearing: 0,
    pitch: 0.72,
    center: true,
    ox: typeof window !== "undefined" && window.innerWidth < 520 ? 0.72 : 0.64,
    oy: 0.46,
  });
}

export function PeakCatalog() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const open = useMapStore((s) => s.mountainLayer);
  const selected = useMapStore((s) => s.selectedPeak);

  return (
    <div className="flex flex-row items-start gap-1">
      <button
        type="button"
        className={`inline-flex min-h-36 w-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-md [writing-mode:vertical-rl] ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
        aria-pressed={open}
        onClick={() => {
          const next = !open;
          if (next) {
            openLayer("peaks");
            useMapStore.getState().requestFlyTo({
              lng: RADAR_JAPAN_LNG,
              lat: RADAR_JAPAN_LAT,
              zoom: RADAR_JAPAN_ZOOM,
              bearing: 0,
              pitch: 0,
              center: true,
            });
          } else {
            closeLayer("peaks");
          }
        }}
      >
        {t.peaks}
      </button>
      {open ? (
        <div className="max-h-[min(52vh,28rem)] w-40 overflow-y-auto rounded-[var(--radius-md)] bg-surface/96 shadow-[var(--shadow-border)] backdrop-blur-md">
          {PEAKS.map((peak, i) => {
            const on = selected?.id === peak.id;
            return (
              <button
                key={peak.id}
                type="button"
                className={`flex w-full border-border px-3 py-2.5 text-left text-sm font-medium hover:bg-fg/6 ${i ? "border-t" : ""} ${on ? "bg-fg/8 text-accent" : "text-fg"}`}
                onClick={() => focusPeak(peak)}
              >
                {peakLabel(peak, lang)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function PeakBubble() {
  const peak = useMapStore((s) => s.selectedPeak);
  const screen = useMapStore((s) => s.peakScreen);
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState(0);
  useEffect(() => {
    setOpen(false);
    setShot(0);
  }, [peak?.id]);
  if (!peak || !screen) return null;
  const media = peak.photos ?? [];
  const photo = media[Math.min(shot, Math.max(0, media.length - 1))];
  const left = Math.min(
    Math.max(screen.x, open ? 148 : 22),
    typeof window !== "undefined" ? window.innerWidth - (open ? 148 : 22) : screen.x,
  );
  const placeAbove = screen.y > (open ? 280 : 40);
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        className="pointer-events-auto absolute"
        style={{
          left,
          top: screen.y,
          transform: placeAbove ? "translate(-50%, calc(-100% - 14px))" : "translate(-50%, 18px)",
        }}
      >
        {open ? (
          <article className="w-[276px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-border)]">
            <div className="relative h-40 bg-bg-subtle">
              {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : null}
              <button
                type="button"
                className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-surface/90 text-fg shadow-[var(--shadow-border)]"
                aria-label={t.close}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            {media.length > 1 ? (
              <div className="flex gap-1 overflow-x-auto px-2 pt-2">
                {media.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    className={`h-9 w-12 shrink-0 overflow-hidden rounded-[var(--radius-xs)] ${shot === i ? "ring-2 ring-accent" : "opacity-80"}`}
                    onClick={() => setShot(i)}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="px-3 py-2.5">
              <p className="text-sm leading-snug font-medium text-fg">{peakLabel(peak, lang)}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {peakArea(peak, lang)} · {peak.h.toLocaleString()} m
              </p>
            </div>
          </article>
        ) : (
          <button
            type="button"
            className="size-8 overflow-hidden rounded-full bg-surface shadow-[var(--shadow-border)]"
            aria-label={peakLabel(peak, lang)}
            onClick={() => setOpen(true)}
          >
            {media[0] ? <img src={media[0]} alt="" className="size-full object-cover" /> : null}
          </button>
        )}
      </div>
    </div>
  );
}

