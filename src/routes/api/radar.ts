import { createFileRoute } from "@tanstack/react-router";

const TIMES = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
const HEAD = {
  "User-Agent": "Mozilla/5.0 (compatible; JBmap/1.0)",
  Accept: "*/*",
};

type TimesRow = { basetime: string; validtime: string; elements?: string[] };

let timesCache: { at: number; row: TimesRow | null } = { at: 0, row: null };
const tileCache = new Map<string, { at: number; body: ArrayBuffer }>();

async function latestTime(): Promise<TimesRow | null> {
  if (timesCache.row && Date.now() - timesCache.at < 25_000) return timesCache.row;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(TIMES, { headers: HEAD, signal: ctrl.signal });
    if (!res.ok) throw new Error("times");
    const rows = (await res.json()) as TimesRow[];
    const row = rows.find((r) => r.elements?.includes("hrpns")) ?? rows[0] ?? null;
    timesCache = { at: Date.now(), row };
    return row;
  } catch {
    return timesCache.row;
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute("/api/radar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const z = url.searchParams.get("z");
        const x = url.searchParams.get("x");
        const y = url.searchParams.get("y");
        if (z == null || x == null || y == null) {
          if (url.searchParams.get("fresh") === "1") timesCache = { at: 0, row: timesCache.row };
          const row = await latestTime();
          if (!row) return Response.json({ ok: false, error: "radar" });
          return Response.json({ ok: true, basetime: row.basetime, validtime: row.validtime });
        }
        const zi = Number(z);
        const xi = Number(x);
        const yi = Number(y);
        if (!Number.isFinite(zi) || !Number.isFinite(xi) || !Number.isFinite(yi) || zi < 4 || zi > 10) {
          return new Response(null, { status: 400 });
        }
        const row = await latestTime();
        if (!row) return new Response(null, { status: 502 });
        const b = url.searchParams.get("b") || row.basetime;
        const v = url.searchParams.get("v") || row.validtime;
        const key = `${b}|${v}|${zi}|${xi}|${yi}`;
        const hit = tileCache.get(key);
        if (hit && Date.now() - hit.at < 240_000) {
          return new Response(hit.body, {
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=120" },
          });
        }
        const src = `https://www.jma.go.jp/bosai/jmatile/data/nowc/${b}/none/${v}/surf/hrpns/${zi}/${xi}/${yi}.png`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
          const res = await fetch(src, { headers: HEAD, signal: ctrl.signal });
          if (!res.ok) return new Response(null, { status: 204 });
          const body = await res.arrayBuffer();
          tileCache.set(key, { at: Date.now(), body });
          if (tileCache.size > 220) {
            const first = tileCache.keys().next().value;
            if (first) tileCache.delete(first);
          }
          return new Response(body, {
            headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=120" },
          });
        } catch {
          return new Response(null, { status: 502 });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
