import { copies, displayName } from "@/lib/i18n";
import type { Quake } from "@/lib/quake";
import { useMapStore } from "@/store/map-store";
import { closeLayer, openLayer } from "@/lib/menu-view";
import { RadarPanel } from "@/components/app/radar-scale";

export function focusQuake(quake: Quake) {
  const s = useMapStore.getState();
  if (s.selectedQuake?.id === quake.id) {
    s.selectQuake(null);
    return;
  }
  s.exclusiveOpen("quake");
  s.selectTrain(null);
  s.setFollowTrainId(null);
  s.selectStation(null);
  s.setSheetOpen(false);
  s.selectQuake(quake);
  s.requestFlyTo({
    lng: quake.lng,
    lat: quake.lat,
    zoom: 8.8,
    bearing: 0,
    pitch: 0.92,
  });
}

export function QuakePanel() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const quakes = useMapStore((s) => s.quakes);
  const selected = useMapStore((s) => s.selectedQuake);
  const open = useMapStore((s) => s.quakeMenuOpen);

  return (
    <div className="flex flex-row items-start gap-1">
      <button
        type="button"
        className={`inline-flex min-h-36 w-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-md [writing-mode:vertical-rl] ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
        onClick={() => {
          if (open) closeLayer("quake");
          else openLayer("quake");
        }}
      >
        {t.quakePanel}
      </button>
      <RadarPanel />
      {open ? (
        <div className="w-52 overflow-hidden rounded-[var(--radius-md)] bg-surface/96 shadow-[var(--shadow-border)] backdrop-blur-md">
          <p className="px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-fg-muted">{t.quakeTitle}</p>
          {quakes.length ? (
            quakes.map((q) => {
              const on = selected?.id === q.id;
              const place = lang === "en" ? q.placeEn : lang === "zh" ? displayName(q.place, "zh") : q.place;
              return (
                <button
                  key={q.id}
                  type="button"
                  className={`flex w-full flex-col gap-0.5 border-t border-border px-3 py-2.5 text-left hover:bg-fg/6 ${on ? "bg-fg/8" : ""}`}
                  onClick={() => focusQuake(q)}
                >
                  <span className="flex items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: "#e11d2a" }} />
                    <span className={`truncate text-sm font-medium ${on ? "text-accent" : "text-fg"}`}>{place}</span>
                  </span>
                  <span className="pl-4 text-xs tabular-nums text-fg-muted">
                    M{q.mag.toFixed(1)} · {t.shindo} {q.shindo} · {q.time}
                  </span>
                  <span className="pl-4 text-xs text-fg-subtle">
                    {t.depth} {Math.round(q.depthKm)}km
                  </span>
                </button>
              );
            })
          ) : (
            <p className="border-t border-border px-3 py-3 text-xs text-fg-muted">{t.noQuake}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
