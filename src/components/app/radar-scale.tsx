import { copies } from "@/lib/i18n";
import { RADAR_BANDS, RADAR_JAPAN_LAT, RADAR_JAPAN_LNG, RADAR_JAPAN_ZOOM, refreshRadarMeta } from "@/lib/radar";
import { useMapStore } from "@/store/map-store";
import { closeLayer, openLayer } from "@/lib/menu-view";

export function RadarPanel() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const open = useMapStore((s) => s.radarEnabled);
  const hidden = useMapStore((s) => s.radarHidden);
  const bands = [...RADAR_BANDS].reverse();
  return (
    <div className="flex flex-row items-start gap-1">
      <button
        type="button"
        className={`inline-flex min-h-36 w-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-md [writing-mode:vertical-rl] ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
        aria-pressed={open}
        onClick={() => {
          const next = !open;
          if (next) {
            openLayer("radar");
            void refreshRadarMeta(true);
            const s = useMapStore.getState();
            s.requestFlyTo({
              lng: RADAR_JAPAN_LNG,
              lat: RADAR_JAPAN_LAT,
              zoom: RADAR_JAPAN_ZOOM,
              bearing: 0,
              pitch: 0,
              center: true,
            });
          } else {
            closeLayer("radar");
          }
        }}
      >
        {t.radar}
      </button>
      {open ? (
        <div className="flex w-11 flex-col items-center gap-1 rounded-[var(--radius-md)] bg-surface/96 px-1 py-1.5 shadow-[var(--shadow-border)] backdrop-blur-md">
          <p className="text-[9px] font-medium tracking-wide text-fg-muted">{t.radarUnit}</p>
          {bands.map((band) => {
            const off = hidden.includes(band.id);
            return (
              <button
                key={band.id}
                type="button"
                aria-pressed={!off}
                aria-label={`${band.label} mm/h`}
                className={`flex h-9 w-9 flex-col items-center justify-center rounded-[var(--radius-xs)] text-[9px] font-semibold tabular-nums leading-none ${
                  off ? "opacity-30" : "opacity-100"
                }`}
                style={{ background: band.hex, color: band.id >= 2 ? "#1a1408" : "#f7f4ea" }}
                onClick={() => useMapStore.getState().toggleRadarBand(band.id)}
              >
                {band.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
