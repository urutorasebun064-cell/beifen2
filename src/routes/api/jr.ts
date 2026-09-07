import { createFileRoute } from "@tanstack/react-router";
import { tokyoParts } from "@/lib/rail/geo";
import {
  fetchText,
  isHoliday,
  parseJrList,
  parseJrTimes,
  resolveJrHref,
  searchJrStation,
  type JrBoardItem,
} from "@/lib/rail/jreast";

const searchCache = new Map<string, { at: number; id: string; name: string }>();
const listCache = new Map<string, { at: number; html: string }>();
const pageCache = new Map<string, { at: number; html: string }>();

async function cached(url: string, map: Map<string, { at: number; html: string }>, ttl: number) {
  const hit = map.get(url);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.html;
  const html = await fetchText(url);
  map.set(url, { at: now, html });
  return html;
}

export const Route = createFileRoute("/api/jr")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = (url.searchParams.get("name") ?? "").replace(/駅$/u, "").trim();
        if (!name) return Response.json({ ok: false, error: "missing" });
        try {
          const now = Date.now();
          let st = searchCache.get(name);
          if (!st || now - st.at > 12 * 60 * 60_000) {
            const found = await searchJrStation(name);
            if (!found) return Response.json({ ok: false, error: "station" });
            st = { at: now, id: found.id, name: found.name };
            searchCache.set(name, st);
          }
          if (st.name !== name && !name.startsWith(st.name) && !st.name.startsWith(name)) {
            return Response.json({ ok: false, error: "station" });
          }
          const listHtml = await cached(`https://timetables.jreast.co.jp/timetable/list${st.id}.html`, listCache, 6 * 60 * 60_000);
          const holiday = isHoliday();
          const routes = parseJrList(listHtml, holiday);
          if (!routes.length) return Response.json({ ok: false, error: "empty" });
          const { minutes } = tokyoParts();
          const pages = await Promise.all(
            routes.map((r) => cached(resolveJrHref(r.href), pageCache, 20 * 60_000).catch(() => "")),
          );
          const items: JrBoardItem[] = [];
          routes.forEach((r, i) => {
            const html = pages[i];
            if (!html) return;
            items.push(...parseJrTimes(html, r.lineName, r.dest, minutes));
          });
          items.sort((a, b) => a.minutesUntil - b.minutesUntil);
          const upcoming = items.filter((it) => it.minutesUntil >= 0).slice(0, 24);
          const running = items.filter((it) => it.minutesUntil < 0).slice(-24);
          return Response.json({
            ok: upcoming.length > 0 || running.length > 0,
            source: "jreast",
            station: st.name,
            items: upcoming.concat(running),
          });
        } catch {
          return Response.json({ ok: false, error: "jr" });
        }
      },
    },
  },
});
