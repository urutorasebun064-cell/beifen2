import type { Train } from "./types";

const KEY = "jb-crowd-delay";
const TTL = 3 * 60 * 60_000;

type Rec = { min: number; at: number };

let mem: Record<string, Rec> | null = null;

function load(): Record<string, Rec> {
  if (mem) return mem;
  if (typeof window === "undefined") {
    mem = {};
    return mem;
  }
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, Rec>;
    const now = Date.now();
    const next: Record<string, Rec> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && v.min > 0 && now - v.at < TTL) next[k] = v;
    }
    mem = next;
    return mem;
  } catch {
    mem = {};
    return mem;
  }
}

function save(map: Record<string, Rec>) {
  mem = map;
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(map));
}

function keyOf(t: Pick<Train, "id" | "lineId" | "dir">) {
  return t.id || `${t.lineId}:${t.dir}`;
}

export function crowdDelayFor(train: Pick<Train, "id" | "lineId" | "dir">): number {
  return load()[keyOf(train)]?.min ?? 0;
}

export function setCrowdDelay(train: Pick<Train, "id" | "lineId" | "dir">, minutes: number) {
  const map = load();
  const k = keyOf(train);
  if (minutes <= 0) delete map[k];
  else map[k] = { min: Math.min(90, Math.round(minutes)), at: Date.now() };
  save(map);
}

export function addCrowdDelay(train: Pick<Train, "id" | "lineId" | "dir">, add: number) {
  setCrowdDelay(train, Math.max(0, crowdDelayFor(train) + add));
}