export type CamSave = { lng: number; lat: number; zoom: number; yaw: number; tilt: number };

export type PersonalSave = {
  v: 1;
  at: number;
  cam?: CamSave;
  lang?: "ja" | "zh" | "en";
  nick?: string;
  lastRoom?: string;
  stars?: string[];
};

const KEY = "jb-save";
const UID = "jb-party-uid";
let timer = 0;
let inflight = false;
let started = false;

function uid() {
  try {
    const hit = localStorage.getItem(UID);
    if (hit) return hit.slice(0, 80);
    const id = crypto.randomUUID();
    localStorage.setItem(UID, id);
    return id;
  } catch {
    return "";
  }
}

export function readSave(): PersonalSave | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PersonalSave;
    if (!v || v.v !== 1) return null;
    return v;
  } catch {
    return null;
  }
}

function writeLocal(save: PersonalSave) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* */
  }
}

export function patchSave(partial: Partial<PersonalSave>) {
  const prev = readSave() ?? { v: 1 as const, at: 0 };
  const next: PersonalSave = { ...prev, ...partial, v: 1, at: Date.now() };
  writeLocal(next);
  schedulePush();
  return next;
}

function schedulePush() {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    void pushCloud();
  }, 2400);
}

async function pushCloud() {
  if (inflight) {
    schedulePush();
    return;
  }
  const save = readSave();
  const id = uid();
  if (!save || !id) return;
  inflight = true;
  try {
    await fetch("/api/save", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: id, save }),
      keepalive: true,
    });
  } catch {
    /* stay local */
  } finally {
    inflight = false;
  }
}

async function pullCloud() {
  const id = uid();
  if (!id) return;
  try {
    const res = await fetch(`/api/save?uid=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { save?: PersonalSave };
    const cloud = data.save;
    if (!cloud || cloud.v !== 1 || !cloud.at) return;
    const local = readSave();
    if (local && local.at >= cloud.at) return;
    writeLocal(cloud);
    applySave(cloud);
  } catch {
    /* */
  }
}

function applySave(save: PersonalSave) {
  try {
    if (save.lang) localStorage.setItem("jb-lang", save.lang);
    if (save.nick) localStorage.setItem("jb-party-nick", save.nick);
    if (save.lastRoom) {
      const prev = localStorage.getItem("jb-party-last");
      if (!prev) localStorage.setItem("jb-party-last", JSON.stringify({ name: save.lastRoom }));
    }
  } catch {
    /* */
  }
  for (const fn of listeners) {
    try {
      fn(save);
    } catch {
      /* */
    }
  }
}

const listeners = new Set<(save: PersonalSave) => void>();

export function onSave(fn: (save: PersonalSave) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshotLocals() {
  const cur = readSave() ?? { v: 1 as const, at: Date.now() };
  try {
    const lang = localStorage.getItem("jb-lang");
    if (lang === "ja" || lang === "zh" || lang === "en") cur.lang = lang;
    const nick = localStorage.getItem("jb-party-nick") || "";
    if (nick) cur.nick = nick.slice(0, 12);
    const last = localStorage.getItem("jb-party-last");
    if (last) {
      const o = JSON.parse(last) as { name?: string };
      if (o?.name) cur.lastRoom = String(o.name).slice(0, 24);
    }
  } catch {
    /* */
  }
  writeLocal({ ...cur, at: cur.at || Date.now() });
}

export function startSaveSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  snapshotLocals();
  void pullCloud();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void pushCloud();
  });
  window.addEventListener("pagehide", () => {
    void pushCloud();
  });
}
