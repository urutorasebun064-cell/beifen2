import { createFileRoute } from "@tanstack/react-router";
import { parseJmaList, parseP2pList, type Quake, type QuakePayload } from "@/lib/quake";

let cache: { at: number; quakes: Quake[] } = { at: 0, quakes: [] };

async function pullJson(url: string, timeout = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function loadQuakes(): Promise<Quake[]> {
  try {
    const rows = (await pullJson("https://www.jma.go.jp/bosai/quake/data/list.json")) as unknown[];
    const parsed = parseJmaList(rows as Parameters<typeof parseJmaList>[0], 5);
    if (parsed.length) return parsed;
  } catch {
    /* P2P fallback */
  }
  const rows = (await pullJson("https://api.p2pquake.net/v2/history?codes=551&limit=8")) as unknown[];
  return parseP2pList(rows as Parameters<typeof parseP2pList>[0], 5);
}

export const Route = createFileRoute("/api/quake")({
  server: {
    handlers: {
      GET: async () => {
        const now = Date.now();
        if (now - cache.at < 45_000 && cache.quakes.length) {
          return Response.json({ ok: true, quakes: cache.quakes } satisfies QuakePayload);
        }
        try {
          const quakes = await loadQuakes();
          cache = { at: now, quakes };
          return Response.json({ ok: quakes.length > 0, quakes, error: quakes.length ? undefined : "empty" } satisfies QuakePayload);
        } catch {
          return Response.json({
            ok: cache.quakes.length > 0,
            quakes: cache.quakes,
            error: "upstream",
          } satisfies QuakePayload);
        }
      },
    },
  },
});
