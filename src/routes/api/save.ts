import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";

const FILE = join(process.cwd(), ".data", "personal-saves.json");
const MAX = 8000;

type Save = { v: 1; at: number; cam?: object; lang?: string; nick?: string; lastRoom?: string; stars?: string[] };
type G = typeof globalThis & { __jbSaves?: Map<string, Save> };
const saves: Map<string, Save> = (globalThis as G).__jbSaves ?? ((globalThis as G).__jbSaves = new Map());

function load() {
  if (saves.size) return;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Save>;
    for (const [k, v] of Object.entries(raw)) {
      if (v?.v === 1) saves.set(k, v);
    }
  } catch {
    /* */
  }
}

function persist() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const out: Record<string, Save> = {};
    for (const [k, v] of saves) out[k] = v;
    writeFileSync(FILE, JSON.stringify(out));
  } catch {
    /* */
  }
}

function cleanUid(v: unknown) {
  return String(v ?? "")
    .trim()
    .slice(0, 80)
    .replace(/[^\w-]/g, "");
}

export const Route = createFileRoute("/api/save")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        load();
        const uid = cleanUid(new URL(request.url).searchParams.get("uid"));
        if (!uid) return Response.json({ save: null }, { status: 400 });
        return Response.json({ save: saves.get(uid) ?? null });
      },
      PUT: async ({ request }) => {
        load();
        let body: { uid?: string; save?: Save } = {};
        try {
          body = (await request.json()) as { uid?: string; save?: Save };
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        const uid = cleanUid(body.uid);
        const save = body.save;
        if (!uid || !save || save.v !== 1 || !Number.isFinite(save.at)) return Response.json({ ok: false }, { status: 400 });
        const raw = JSON.stringify(save);
        if (raw.length > MAX) return Response.json({ ok: false }, { status: 413 });
        const prev = saves.get(uid);
        if (prev && prev.at > save.at) return Response.json({ ok: true, save: prev });
        saves.set(uid, save);
        persist();
        return Response.json({ ok: true });
      },
    },
  },
});
