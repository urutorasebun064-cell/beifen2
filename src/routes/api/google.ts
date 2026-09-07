import { createFileRoute } from "@tanstack/react-router";
import {
  boardFromGoogle,
  googleBoardToDepartures,
  googleBoardToTrains,
  journeysFromGoogle,
  type GoogleBoardItem,
  type GoogleDirectionsJson,
} from "@/lib/rail/google";
import { googleKeyFrom } from "@/lib/rail/keys.server";
import type { RouteStop } from "@/lib/rail/types";

const boardCache = new Map<string, { at: number; items: GoogleBoardItem[] }>();

async function fetchDirections(
  key: string,
  origin: string,
  dest: string,
  lang: string,
  at?: string | null,
  arrive?: boolean,
): Promise<GoogleDirectionsJson> {
  const gUrl = new URL("https://maps.googleapis.com/maps/api/directions/json");
  gUrl.searchParams.set("origin", origin);
  gUrl.searchParams.set("destination", dest);
  gUrl.searchParams.set("mode", "transit");
  gUrl.searchParams.set("transit_mode", "bus|rail|subway|train|tram");
  gUrl.searchParams.set("region", "jp");
  gUrl.searchParams.set("language", lang === "en" ? "en" : lang === "zh" ? "zh-CN" : "ja");
  if (arrive && at && /^\d+$/.test(at)) gUrl.searchParams.set("arrival_time", at);
  else gUrl.searchParams.set("departure_time", at && /^\d+$/.test(at) ? at : "now");
  gUrl.searchParams.set("alternatives", "true");
  gUrl.searchParams.set("key", key);
  const res = await fetch(gUrl);
  return (await res.json()) as GoogleDirectionsJson;
}

export const Route = createFileRoute("/api/google")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = googleKeyFrom(request);
        const url = new URL(request.url);
        const olat = url.searchParams.get("olat");
        const olng = url.searchParams.get("olng");
        const dlat = url.searchParams.get("dlat");
        const dlng = url.searchParams.get("dlng");
        const oname = url.searchParams.get("oname") ?? "";
        const dname = url.searchParams.get("dname") ?? "";
        const lang = url.searchParams.get("lang") ?? "ja";
        const mode = url.searchParams.get("mode") ?? "route";
        const at = url.searchParams.get("at");
        const arrive = url.searchParams.get("arrive") === "1";
        if (!key) return Response.json({ ok: false, error: "missing" });
        if (mode === "board") {
          if (!olat || !olng) return Response.json({ ok: false, error: "missing" });
          const targets = (url.searchParams.get("targets") ?? "")
            .split(";")
            .map((row) => {
              const [lat, lng, name] = row.split(",");
              if (!lat || !lng) return null;
              return { lat: lat.trim(), lng: lng.trim(), name: (name ?? "").trim() };
            })
            .filter((x): x is { lat: string; lng: string; name: string } => Boolean(x))
            .slice(0, 5);
          if (!targets.length) return Response.json({ ok: false, error: "empty" });
          const cacheId = `${Number(olat).toFixed(3)},${Number(olng).toFixed(3)}:${targets.map((t) => t.name).join("|")}:${at ?? "now"}`;
          const hit = boardCache.get(cacheId);
          const now = Date.now();
          let items = hit && now - hit.at < 45_000 ? hit.items : null;
          if (!items) {
            const chunks = await Promise.all(
              targets.map((t) =>
                fetchDirections(key, `${olat},${olng}`, `${t.lat},${t.lng}`, lang, at, arrive).catch(
                  () => ({ status: "ZERO_RESULTS" }) as GoogleDirectionsJson,
                ),
              ),
            );
            const seen = new Set<string>();
            items = [];
            for (const data of chunks) {
              if (data.status !== "OK") continue;
              for (const it of boardFromGoogle(data)) {
                if (seen.has(it.id)) continue;
                seen.add(it.id);
                items.push(it);
              }
            }
            boardCache.set(cacheId, { at: now, items });
          }
          const nowUnix = at && /^\d+$/.test(at) ? Number(at) : Date.now() / 1000;
          return Response.json({
            ok: items.length > 0,
            source: "google",
            departures: googleBoardToDepartures(items, nowUnix),
            trains: googleBoardToTrains(items, nowUnix),
          });
        }
        if (!olat || !olng || !dlat || !dlng) {
          return Response.json({ ok: false, error: "missing" });
        }
        try {
          const data = await fetchDirections(key, `${olat},${olng}`, `${dlat},${dlng}`, lang, at, arrive);
          if (data.status !== "OK") {
            return Response.json({ ok: false, error: data.status, message: data.error_message ?? "" });
          }
          const origin: RouteStop = { name: oname, lng: Number(olng), lat: Number(olat), prefecture: "" };
          const dest: RouteStop = { name: dname, lng: Number(dlng), lat: Number(dlat), prefecture: "" };
          const journeys = journeysFromGoogle(data, origin, dest);
          if (!journeys.length) return Response.json({ ok: false, error: "empty" });
          return Response.json({ ok: true, journey: journeys[0], journeys });
        } catch {
          return Response.json({ ok: false, error: "google" }, { status: 502 });
        }
      },
    },
  },
});
