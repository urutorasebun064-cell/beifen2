import { createRequire } from "node:module";
import { googleKeyFrom } from "@/lib/rail/keys.server";

const require = createRequire(import.meta.url);
const Pbf = require("pbf") as new (buf: Buffer) => unknown;
const { VectorTile } = require("@mapbox/vector-tile") as {
  VectorTile: new (pbf: unknown) => {
    layers: Record<
      string,
      {
        length: number;
        extent: number;
        feature: (i: number) => {
          type: number;
          properties: Record<string, unknown>;
          loadGeometry: () => { x: number; y: number }[][];
        };
      }
    >;
  };
};

type Road = { id: string; c: number; w: number; m: number; n: string; l: number[] };

const cache = new Map<string, { at: number; roads: Road[] }>();

function tileLng(x: number, z: number, px: number, extent: number) {
  return ((x + px / extent) / 2 ** z) * 360 - 180;
}

function tileLat(y: number, z: number, py: number, extent: number) {
  const n = Math.PI - (2 * Math.PI * (y + py / extent)) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function decode(buf: Buffer, z: number, x: number, y: number): Road[] {
  const tile = new VectorTile(new Pbf(buf));
  const layer = tile.layers.road;
  if (!layer) return [];
  const ext = layer.extent || 4096;
  const out: Road[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue;
    const p = f.properties;
    const geom = f.loadGeometry();
    for (const line of geom) {
      if (line.length < 2) continue;
      const l: number[] = [];
      for (const pt of line) {
        l.push(Number(tileLng(x, z, pt.x, ext).toFixed(5)), Number(tileLat(y, z, pt.y, ext).toFixed(5)));
      }
      out.push({
        id: `${z}/${x}/${y}/${i}-${out.length}`,
        c: Number(p.rdCtg) || 2,
        w: Number(p.rnkWidth) || 0,
        m: Number(p.motorway) === 0 ? 1 : 0,
        n: String(p.rdName ?? p.name ?? p.n ?? ""),
        l,
      });
    }
  }
  return out;
}

export async function handleRoads(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "snap") {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    const key = googleKeyFrom(request);
    if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ ok: false });
    try {
      const g = new URL("https://roads.googleapis.com/v1/snapToRoads");
      g.searchParams.set("path", `${lat},${lng}`);
      g.searchParams.set("interpolate", "false");
      g.searchParams.set("key", key);
      const res = await fetch(g);
      const data = (await res.json()) as { snappedPoints?: Array<{ location?: { latitude?: number; longitude?: number } }> };
      const pt = data.snappedPoints?.[0]?.location;
      if (!pt || pt.latitude == null || pt.longitude == null) return Response.json({ ok: false });
      return Response.json({ ok: true, lat: pt.latitude, lng: pt.longitude });
    } catch {
      return Response.json({ ok: false });
    }
  }
  if (url.searchParams.get("mode") === "png") {
    const z = Number(url.searchParams.get("z"));
    const x = Number(url.searchParams.get("x"));
    const y = Number(url.searchParams.get("y"));
    if (![z, x, y].every((n) => Number.isInteger(n)) || z < 8 || z > 18) return new Response("no", { status: 404 });
    try {
      const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/pale/${z}/${x}/${y}.png`);
      if (!res.ok) return new Response("no", { status: 404 });
      return new Response(res.body, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
        },
      });
    } catch {
      return new Response("no", { status: 404 });
    }
  }
  const z = Number(url.searchParams.get("z"));
  const x = Number(url.searchParams.get("x"));
  const y = Number(url.searchParams.get("y"));
  if (![z, x, y].every((n) => Number.isInteger(n)) || z < 5 || z > 16) return Response.json({ ok: false });
  const id = `${z}/${x}/${y}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 6 * 60 * 60_000) return Response.json({ ok: true, roads: hit.roads });
  try {
    const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${z}/${x}/${y}.pbf`);
    if (!res.ok) return Response.json({ ok: false });
    const buf = Buffer.from(await res.arrayBuffer());
    const roads = decode(buf, z, x, y);
    if (cache.size > 480) cache.clear();
    cache.set(id, { at: Date.now(), roads });
    return Response.json({ ok: true, roads });
  } catch {
    return Response.json({ ok: false });
  }
}
