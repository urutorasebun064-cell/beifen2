import { Cloud, CloudLightning, CloudRain, CloudSnow, Sun, Tornado } from "lucide-react";
import { copies, type Copy } from "@/lib/i18n";
import { nearestWeather, weatherName, type WxKind } from "@/lib/weather";
import { useMapStore } from "@/store/map-store";

function kindLabel(kind: WxKind, t: Copy) {
  if (kind === "tornado") return t.weatherTornado;
  if (kind === "thunder") return t.weatherThunder;
  if (kind === "rain") return t.weatherRain;
  if (kind === "snow") return t.weatherSnow;
  if (kind === "cloud") return t.weatherCloud;
  return t.weatherSun;
}

function KindIcon({ kind }: { kind: WxKind }) {
  if (kind === "tornado") return <Tornado className="size-4 text-[#c45c2a]" />;
  if (kind === "thunder") return <CloudLightning className="size-4 text-[#e8c040]" />;
  if (kind === "rain") return <CloudRain className="size-4" />;
  if (kind === "snow") return <CloudSnow className="size-4" />;
  if (kind === "cloud") return <Cloud className="size-4" />;
  return <Sun className="size-4" />;
}

export function WeatherChip() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const spots = useMapStore((s) => s.weatherSpots);
  const user = useMapStore((s) => s.userLocation);
  if (!spots.length) return null;
  const nearest = nearestWeather(spots, user?.lng ?? 139.76, user?.lat ?? 35.68);
  if (!nearest) return null;
  const spot = nearest.kind === "thunder" ? { ...nearest, kind: "rain" as const } : nearest;
  const alert = spots.find((s) => s.kind === "tornado");
  const severe = spot.kind === "tornado";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-surface/92 px-3 py-2 shadow-[var(--shadow-border)] backdrop-blur-md">
        <KindIcon kind={spot.kind} />
        <div className="min-w-0">
          <p className="text-xs leading-tight text-fg-muted">{weatherName(spot, lang)}</p>
          <p className={`text-sm leading-tight font-medium tabular-nums ${severe ? "text-[#e4453a]" : "text-fg"}`}>
            {Math.round(spot.temp)}° {kindLabel(spot.kind, t)}
          </p>
        </div>
      </div>
      {alert && alert.id !== spot.id ? (
        <div className="flex items-center gap-1.5 rounded-[var(--radius-lg)] bg-[#3a1410]/92 px-3 py-1.5 text-xs font-medium text-[#ffd0c4] shadow-[var(--shadow-border)]">
          <KindIcon kind={alert.kind} />
          <span>
            {weatherName(alert, lang)} {kindLabel(alert.kind, t)}
          </span>
        </div>
      ) : null}
    </div>
  );
}