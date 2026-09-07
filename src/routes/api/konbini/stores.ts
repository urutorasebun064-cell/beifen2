import { createFileRoute } from "@tanstack/react-router";
import { fetchKonbiniBbox, type KonbiniBrand } from "@/lib/konbini";
import { googleKeyFrom } from "@/lib/rail/keys.server";

const BRANDS = new Set<KonbiniBrand | "all">(["seven", "familymart", "lawson", "all"]);

export const Route = createFileRoute("/api/konbini/stores")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const brand = (url.searchParams.get("brand") || "all") as KonbiniBrand | "all";
        const west = Number(url.searchParams.get("west"));
        const south = Number(url.searchParams.get("south"));
        const east = Number(url.searchParams.get("east"));
        const north = Number(url.searchParams.get("north"));
        const radius = Number(url.searchParams.get("radius") || 800);
        if (!BRANDS.has(brand)) return Response.json({ ok: false, stores: [] }, { status: 400 });
        if (![west, south, east, north].every(Number.isFinite)) return Response.json({ ok: false, stores: [] }, { status: 400 });
        if (east - west > 0.08 || north - south > 0.07) return Response.json({ ok: true, stores: [] });
        const ring = Number.isFinite(radius) ? Math.max(700, Math.min(1800, radius)) : 800;
        const stores = await fetchKonbiniBbox({ west, south, east, north }, brand, ring, undefined, googleKeyFrom(request));
        return Response.json({ ok: true, stores });
      },
    },
  },
});
