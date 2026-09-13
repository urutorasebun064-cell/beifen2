import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createECDH, createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { hanFold } from "@/lib/han";

const PARTY_MAX = 5;
const AWAY_MS = 90 * 1000;
const MSG_MAX = 70;
const MSG_DROP = 20;
const MSG_BONUS = 300;
const DAY_MS = 24 * 3600 * 1000;
const LIVE_MS = 3 * DAY_MS;
const CAP_MS = 7 * DAY_MS;
const FILE = join(process.cwd(), ".data", "party-rooms.json");
const GONE_FILE = join(process.cwd(), ".data", "party-gone.json");
const VAPID_FILE = join(process.cwd(), ".data", "party-vapid.json");

type PushSub = { endpoint: string; p256dh: string; auth: string };
type Member = { id: string; nick: string; token: string; last: number; online: boolean; host?: boolean; lng?: number; lat?: number; pinAt?: number; near?: string; pinOff?: boolean; push?: PushSub };
type Msg = { id: number; nick: string; body: string; at: string; uid?: string; tr?: { ja?: string; en?: string; zh?: string } };
type Room = { name: string; pass: string; hostId: string; members: Member[]; messages: Msg[]; msgId: number; msgTotal: number; expiresAt: number; born?: number; boundNicks?: Record<string, string>; clearedAt?: number; memRev?: number; leftIds?: string[] };
type Saved = Room & { key: string };

type G = typeof globalThis & { __jbPartyRooms?: Map<string, Room>; __jbPartyGone?: Map<string, number> };
const rooms: Map<string, Room> =
  (globalThis as G).__jbPartyRooms ?? ((globalThis as G).__jbPartyRooms = new Map<string, Room>());
const gone: Map<string, number> =
  (globalThis as G).__jbPartyGone ?? ((globalThis as G).__jbPartyGone = new Map<string, number>());

type Vapid = { publicKey: string; privateKey: string };
type GV = typeof globalThis & { __jbPartyVapid?: Vapid };

function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function makeVapid(): Vapid {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return { publicKey: b64url(curve.getPublicKey()), privateKey: b64url(curve.getPrivateKey()) };
}

function loadVapid(): Vapid {
  const g = globalThis as GV;
  if (g.__jbPartyVapid?.publicKey && g.__jbPartyVapid.privateKey) return g.__jbPartyVapid;
  try {
    const raw = JSON.parse(readFileSync(VAPID_FILE, "utf8")) as Vapid;
    if (raw?.publicKey && raw.privateKey) {
      g.__jbPartyVapid = raw;
      return raw;
    }
  } catch {
    /* */
  }
  const keys = makeVapid();
  g.__jbPartyVapid = keys;
  try {
    mkdirSync(dirname(VAPID_FILE), { recursive: true });
    writeFileSync(VAPID_FILE, JSON.stringify(keys));
  } catch {
    /* */
  }
  return keys;
}

function vapidPub() {
  try {
    return loadVapid().publicKey;
  } catch {
    return "";
  }
}

async function vapidOut() {
  try {
    const k = await ensureVapid();
    return k?.publicKey || vapidPub();
  } catch {
    return vapidPub();
  }
}

async function ensureVapid() {
  const g = globalThis as GV;
  try {
    const sql = await getSql();
    await sql.query("create table if not exists party_meta (k text primary key, v text not null)");
    const rows = await sql.query<{ v: string }>("select v from party_meta where k = 'vapid'");
    const raw = rows[0]?.v ? (JSON.parse(rows[0].v) as Vapid) : null;
    if (raw?.publicKey && raw.privateKey) {
      g.__jbPartyVapid = raw;
      return raw;
    }
    const keys = loadVapid();
    await sql.query("insert into party_meta (k, v) values ('vapid', $1) on conflict (k) do nothing", [JSON.stringify(keys)]);
    const again = await sql.query<{ v: string }>("select v from party_meta where k = 'vapid'");
    const stored = again[0]?.v ? (JSON.parse(again[0].v) as Vapid) : null;
    if (stored?.publicKey && stored.privateKey) g.__jbPartyVapid = stored;
    return g.__jbPartyVapid ?? keys;
  } catch {
    try {
      return loadVapid();
    } catch {
      return null;
    }
  }
}

type GP = typeof globalThis & { __jbPartyPush?: Map<string, { uid: string; room: string; endpoint: string; p256dh: string; auth: string }> };
const partyPush: Map<string, { uid: string; room: string; endpoint: string; p256dh: string; auth: string }> =
  (globalThis as GP).__jbPartyPush ?? ((globalThis as GP).__jbPartyPush = new Map());

async function rememberPush(roomKey: string, uid: string, sub: PushSub) {
  if (!roomKey || !uid || !sub.endpoint) return;
  const row = { uid, room: roomKey, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth };
  partyPush.set(`${roomKey}:${uid}`, row);
  try {
    const sql = await getSql();
    await sql.query("create table if not exists party_push (k text primary key, room text, uid text, endpoint text, p256dh text, auth text)");
    await sql.query(
      "insert into party_push (k, room, uid, endpoint, p256dh, auth) values ($1,$2,$3,$4,$5,$6) on conflict (k) do update set endpoint=$4, p256dh=$5, auth=$6",
      [`${roomKey}:${uid}`, roomKey, uid, sub.endpoint, sub.p256dh, sub.auth],
    );
  } catch {
    /* */
  }
}

async function forgetPush(roomKey: string, uid: string) {
  if (!roomKey || !uid) return;
  for (const [k, p] of [...partyPush.entries()]) {
    if (p.room === roomKey && (p.uid === uid || k.endsWith(`:${uid}`))) partyPush.delete(k);
  }
  try {
    const sql = await getSql();
    await sql.query("delete from party_push where room = $1 and uid = $2", [roomKey, uid]);
  } catch {
    /* */
  }
}

async function listPushes(roomKey: string) {
  const out: { uid: string; endpoint: string; p256dh: string; auth: string }[] = [];
  for (const p of partyPush.values()) {
    if (p.room === roomKey) out.push(p);
  }
  try {
    const sql = await getSql();
    await sql.query("create table if not exists party_push (k text primary key, room text, uid text, endpoint text, p256dh text, auth text)");
    const rows = await sql.query<{ uid: string; endpoint: string; p256dh: string; auth: string }>(
      "select uid, endpoint, p256dh, auth from party_push where room = $1",
      [roomKey],
    );
    for (const r of rows) {
      if (!r.endpoint || out.some((p) => p.endpoint === r.endpoint)) continue;
      out.push({ uid: r.uid, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth });
    }
  } catch {
    /* */
  }
  return out;
}

async function pingPush(room: Room, exceptId: string) {
  const keys = await ensureVapid();
  if (!keys?.publicKey || !keys.privateKey) return;
  type WP = {
    setVapidDetails: (a: string, b: string, c: string) => void;
    sendNotification: (sub: unknown, payload: string, opts?: { TTL?: number; urgency?: string }) => Promise<unknown>;
  };
  let wp: WP | null = null;
  try {
    const mod = (await import("web-push")) as { default?: WP } & WP;
    wp = mod.sendNotification ? mod : mod.default ?? null;
  } catch {
    return;
  }
  if (!wp?.sendNotification || !wp.setVapidDetails) return;
  try {
    wp.setVapidDetails("mailto:party@jbmap.app", keys.publicKey, keys.privateKey);
  } catch {
    return;
  }
  const last = room.messages[room.messages.length - 1];
  const preview = last ? `${last.nick}: ${(last.body || "•").slice(0, 40)}` : "•";
  const payload = JSON.stringify({ title: "J", body: preview, tag: "jb-party" });
  const roomKey = keyOf(room.name);
  const bag = new Map<string, { uid: string; endpoint: string; p256dh: string; auth: string }>();
  for (const m of room.members) {
    if (!m.push?.endpoint || m.id === exceptId) continue;
    bag.set(m.push.endpoint, { uid: m.id, endpoint: m.push.endpoint, p256dh: m.push.p256dh, auth: m.push.auth });
  }
  for (const p of await listPushes(roomKey)) {
    if (p.uid === exceptId || !p.endpoint) continue;
    if (!bag.has(p.endpoint)) bag.set(p.endpoint, p);
  }
  for (const p of partyPush.values()) {
    if (p.uid === exceptId || !p.endpoint) continue;
    if (p.room !== roomKey) continue;
    if (!bag.has(p.endpoint)) bag.set(p.endpoint, p);
  }
  const jobs = [...bag.values()].map((p) =>
    wp
      .sendNotification({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, payload, { TTL: 86400, urgency: "high" })
      .catch((err: { statusCode?: number }) => {
        const code = Number(err?.statusCode);
        if (code === 404 || code === 410) {
          const hit = room.members.find((m) => m.push?.endpoint === p.endpoint);
          if (hit) hit.push = undefined;
          partyPush.delete(`${roomKey}:${p.uid}`);
        }
      }),
  );
  if (!jobs.length) return;
  await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, 2500))]);
}

function loadGoneFile() {
  try {
    const rows = JSON.parse(readFileSync(GONE_FILE, "utf8")) as unknown;
    if (!Array.isArray(rows)) return;
    for (const k of rows) {
      const key = String(k ?? "").trim();
      if (key) gone.set(key, Date.now());
    }
  } catch {
    /* */
  }
}

function saveGoneFile() {
  try {
    mkdirSync(dirname(GONE_FILE), { recursive: true });
    writeFileSync(GONE_FILE, JSON.stringify([...gone.keys()]));
  } catch {
    /* */
  }
}

loadGoneFile();

function markGone(key: string) {
  gone.set(key, Date.now());
  saveGoneFile();
  void saveGoneSql();
}

function unmarkGone(key: string) {
  if (!gone.delete(key)) return;
  saveGoneFile();
  void saveGoneSql();
}

function stillGone(key: string) {
  return gone.has(key);
}

async function saveGoneSql() {
  try {
    const sql = await getSql();
    await sql.query("create table if not exists party_meta (k text primary key, v text not null)");
    await sql.query("insert into party_meta (k, v) values ('gone', $1) on conflict (k) do update set v = excluded.v", [
      JSON.stringify([...gone.keys()]),
    ]);
  } catch {
    /* */
  }
}

async function hydrateGoneSql() {
  try {
    const sql = await getSql();
    await sql.query("create table if not exists party_meta (k text primary key, v text not null)");
    const rows = await sql.query<{ v: string }>("select v from party_meta where k = 'gone'");
    const raw = rows[0]?.v ? (JSON.parse(rows[0].v) as unknown) : [];
    if (!Array.isArray(raw)) return;
    for (const k of raw) {
      const key = String(k ?? "").trim();
      if (key) gone.set(key, Date.now());
    }
  } catch {
    /* */
  }
}

function gtxLang(lang: string) {
  if (lang === "zh") return "zh-CN";
  if (lang === "en") return "en";
  return "ja";
}

function shouldSkipTr(src: string, tl: string) {
  if (tl === "ja" && /[\u3040-\u30ff]/.test(src) && !/[A-Za-z]/.test(src)) return true;
  if (tl === "en" && /^[A-Za-z0-9\s.,!?'"+\-:/]+$/.test(src) && !/[\u3040-\u9fff]/.test(src)) return true;
  return false;
}

function badTr(s: string) {
  const u = s.toUpperCase();
  return u.includes("INVALID SOURCE LANGUAGE") || u.includes("LANGPAIR=") || u.includes("MYMEMORY WARNING") || u.includes("PLEASE SELECT TWO DISTINCT");
}

type GT = typeof globalThis & { __jbChatTr?: Map<string, string> };
const chatTr: Map<string, string> =
  (globalThis as GT).__jbChatTr ?? ((globalThis as GT).__jbChatTr = new Map<string, string>());

function parseGtx(data: unknown): { text: string; sl: string } {
  if (typeof data === "string") return { text: data.trim(), sl: "" };
  if (!Array.isArray(data) || !data.length) return { text: "", sl: "" };
  const a = data[0];
  if (typeof a === "string") return { text: a.trim(), sl: typeof data[1] === "string" ? data[1] : "" };
  if (Array.isArray(a)) {
    if (typeof a[0] === "string") return { text: String(a[0]).trim(), sl: typeof a[1] === "string" ? a[1] : "" };
    if (Array.isArray(a[0])) {
      const text = a
        .map((row) => (Array.isArray(row) ? String(row[0] ?? "") : ""))
        .join("")
        .trim();
      const sl = typeof data[2] === "string" ? data[2] : typeof a[0][1] === "string" ? a[0][1] : "";
      return { text, sl };
    }
  }
  return { text: "", sl: "" };
}

async function translateOne(text: string, lang: string) {
  const src = text.slice(0, 160);
  if (!src) return "";
  const key = `v4:${lang}:${src}`;
  const hit = chatTr.get(key);
  if (hit && !badTr(hit) && hit !== "__miss__") return hit;
  const tl = gtxLang(lang);
  if (shouldSkipTr(src, tl)) {
    chatTr.set(key, src);
    return src;
  }
  let out = "";
  const tlShort = tl === "zh-CN" ? "zh" : tl;
  const urls = [
    `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(tl)}&q=${encodeURIComponent(src)}`,
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(src)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36" },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const ctype = res.headers.get("content-type") || "";
      const raw = await res.text();
      if (!raw || ctype.includes("text/html")) continue;
      const parsed = parseGtx(JSON.parse(raw) as unknown);
      if (parsed.text && !badTr(parsed.text) && parsed.text !== src) {
        out = parsed.text;
        break;
      }
      if (parsed.text && !badTr(parsed.text)) out = parsed.text;
    } catch {
      /* next */
    }
  }
  if (!out.trim() || badTr(out) || out === src) {
    try {
      const res = await fetch(`https://lingva.ml/api/v1/auto/${encodeURIComponent(tlShort)}/${encodeURIComponent(src)}`, {
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const data = (await res.json()) as { translation?: string };
        const textOut = String(data.translation ?? "").trim();
        if (textOut && !badTr(textOut)) out = textOut;
      }
    } catch {
      /* */
    }
  }
  if (!out.trim() || badTr(out)) return src;
  chatTr.set(key, out.trim());
  return out.trim();
}

async function translateMany(texts: string[], lang: string) {
  const map: Record<string, string> = {};
  const uniq = [...new Set(texts.map((t) => String(t ?? "").trim()).filter(Boolean))].slice(0, 40);
  for (const t of uniq) map[t] = await translateOne(t, lang);
  return map;
}

function seedTtl(now = Date.now()) {
  return now + LIVE_MS;
}

function bumpTtl(room: Room) {
  room.msgTotal = (room.msgTotal || 0) + 1;
  if (room.msgTotal % MSG_BONUS !== 0) return;
  const now = Date.now();
  const left = Math.max(0, (room.expiresAt || now) - now);
  room.expiresAt = now + Math.min(CAP_MS, left + DAY_MS);
}

function expired(room: Room, now = Date.now()) {
  return now >= (room.expiresAt || 0);
}

function hashPass(raw: string) {
  const s = raw.trim();
  if (!s) return "";
  if (/^[a-f0-9]{64}$/i.test(s)) return s.toLowerCase();
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function passOk(stored: string, given: string) {
  if (!stored || !given) return false;
  if (stored === given) return true;
  const g = hashPass(given);
  return stored === g || hashPass(stored) === g;
}
function keyOf(name: string) {
  const folded = hanFold(name).replace(/\s+/g, "");
  return (folded || name.normalize("NFKC").replace(/\s+/g, "").toLowerCase()).slice(0, 20);
}

function sameRoom(a: string, b: string) {
  if (!a || !b) return false;
  const fa = keyOf(a);
  const fb = keyOf(b);
  return fa === fb || fa.includes(fb) || fb.includes(fa) || a.includes(b) || b.includes(a);
}

function packMembers(room: Room) {
  return JSON.stringify({ v: 2, members: room.members, nicks: room.boundNicks || {}, rev: room.memRev || 0, left: room.leftIds || [] });
}

function unpackMembers(raw: unknown): { members: Member[]; nicks: Record<string, string>; rev: number; left: string[] } {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw) as unknown;
    } catch {
      v = raw;
    }
  }
  if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { members?: unknown }).members)) {
    const rec = v as { members: unknown; nicks?: Record<string, string>; rev?: number; left?: string[] };
    return {
      members: asList<Member>(rec.members),
      nicks: rec.nicks && typeof rec.nicks === "object" ? rec.nicks : {},
      rev: Number(rec.rev) || 0,
      left: Array.isArray(rec.left) ? rec.left.map(String).filter(Boolean).slice(-80) : [],
    };
  }
  return { members: asList<Member>(raw), nicks: {}, rev: 0, left: [] };
}

function asList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function trimMessages(room: Room) {
  while (room.messages.length > MSG_MAX) room.messages.splice(0, MSG_DROP);
}

function asMember(raw: Partial<Member> & { uid?: string }): Member | null {
  const id = String(raw.id || raw.uid || "").slice(0, 80);
  if (!id && !raw.token) return null;
  return {
    id: id || String(raw.token ?? "").slice(0, 80),
    nick: String(raw.nick ?? "").slice(0, 12) || "ゲスト",
    token: String(raw.token ?? "").slice(0, 80),
    last: Number(raw.last) || 0,
    online: raw.online !== false,
    host: Boolean(raw.host),
    lng: Number.isFinite(Number(raw.lng)) ? Number(raw.lng) : undefined,
    lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : undefined,
    pinAt: Number(raw.pinAt) || undefined,
    near: String(raw.near ?? "").trim().slice(0, 20) || undefined,
    pinOff: Boolean(raw.pinOff),
    push:
      raw.push && String(raw.push.endpoint || "").startsWith("http")
        ? {
            endpoint: String(raw.push.endpoint).slice(0, 512),
            p256dh: String(raw.push.p256dh || "").slice(0, 200),
            auth: String(raw.push.auth || "").slice(0, 80),
          }
        : undefined,
  };
}

function normalizeRoom(row: Partial<Room> & { name: string }): Room {
  const members = (Array.isArray(row.members) ? row.members : []).map((m) => asMember(m)).filter((m): m is Member => Boolean(m));
  const hostId = String(row.hostId || members.find((m) => m.host)?.id || members[0]?.id || "");
  for (const m of members) m.host = m.id === hostId;
  return {
    name: String(row.name),
    pass: String(row.pass ?? ""),
    hostId,
    members,
    messages: Array.isArray(row.messages) ? row.messages.slice() : [],
    msgId: Number(row.msgId) || 1,
    msgTotal: Math.max(0, Number(row.msgTotal) || 0),
    expiresAt: Number((row as Room).expiresAt) || seedTtl(),
    boundNicks: row.boundNicks && typeof row.boundNicks === "object" ? { ...row.boundNicks } : {},
    clearedAt: Number(row.clearedAt) || 0,
    memRev: Number((row as Room).memRev) || 0,
    leftIds: Array.isArray((row as Room).leftIds) ? (row as Room).leftIds!.map(String).filter(Boolean).slice(-80) : [],
  };
}

function dropLeft(room: Room) {
  const left = new Set(room.leftIds || []);
  if (!left.size) return;
  room.members = room.members.filter((m) => !left.has(m.id) && !(m.token && left.has(m.token)));
}

function markLeft(room: Room, ids: string[]) {
  const bag = new Set(room.leftIds || []);
  for (const id of ids) if (id) bag.add(id);
  room.leftIds = [...bag].slice(-80);
  dropLeft(room);
}

function unmarkLeft(room: Room, ids: string[]) {
  if (!room.leftIds?.length) return;
  const drop = new Set(ids.filter(Boolean));
  if (!drop.size) return;
  room.leftIds = room.leftIds.filter((id) => !drop.has(id));
}

function unionMsgs(a: Msg[], b: Msg[]) {
  const map = new Map<number, Msg>();
  for (const row of a.concat(b)) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    map.set(id, row);
  }
  return [...map.values()].sort((x, y) => x.id - y.id).slice(-MSG_MAX);
}

function mergeRoom(key: string, incoming: Room) {
  if (stillGone(key)) return rooms.get(key) ?? incoming;
  const next = normalizeRoom(incoming);
  const cur = rooms.get(key);
  if (!cur) {
    seedBound(next);
    rooms.set(key, next);
    dropLeft(next);
    collapseMembers(next);
    return next;
  }
  if (cur.born) {
    if ((Number(next.clearedAt) || 0) > (Number(cur.clearedAt) || 0)) {
      cur.clearedAt = next.clearedAt;
      cur.messages = next.messages.slice(-MSG_MAX);
    }
  } else {
    const nextWipe = Number(next.clearedAt) || 0;
    const curWipe = Number(cur.clearedAt) || 0;
    if (nextWipe > curWipe) {
      cur.clearedAt = nextWipe;
      cur.messages = next.messages.slice(-MSG_MAX);
    } else {
      cur.messages = unionMsgs(cur.messages, next.messages);
    }
  }
  if (next.msgId > cur.msgId) cur.msgId = next.msgId;
  if ((next.msgTotal || 0) > (cur.msgTotal || 0)) cur.msgTotal = next.msgTotal;
  if (next.pass && !cur.pass) cur.pass = next.pass;
  if (next.hostId && !cur.hostId) cur.hostId = next.hostId;
  if (next.expiresAt && next.expiresAt > (cur.expiresAt || 0)) cur.expiresAt = next.expiresAt;
  const nextRev = Number(next.memRev) || 0;
  const curRev = Number(cur.memRev) || 0;
  cur.leftIds = [...new Set([...(cur.leftIds || []), ...(next.leftIds || [])])].slice(-80);
  if (nextRev > curRev) {
    cur.members = next.members.slice();
    cur.memRev = nextRev;
    if (next.hostId) cur.hostId = next.hostId;
  } else {
    for (const m of next.members) {
      const have = cur.members.find((x) => x.id === m.id || (m.token && x.token === m.token));
      if (!have) continue;
      if ((m.last ?? 0) >= (have.last ?? 0)) {
        have.last = m.last;
        have.token = m.token || have.token;
        have.nick = m.nick || have.nick;
        have.online = m.online;
      }
      have.id = have.id || m.id;
      have.push = m.push || have.push;
      const incomingPin = Number(m.pinAt) || 0;
      const havePin = Number(have.pinAt) || 0;
      if (incomingPin < havePin) continue;
      if (Number.isFinite(m.lng) && Number.isFinite(m.lat) && !m.pinOff) {
        have.lng = m.lng;
        have.lat = m.lat;
        have.pinAt = incomingPin;
        have.pinOff = false;
        if (m.near) have.near = m.near;
      } else if (m.pinOff) {
        have.lng = undefined;
        have.lat = undefined;
        have.near = undefined;
        have.pinAt = incomingPin;
        have.pinOff = true;
      }
    }
  }
  dropLeft(cur);
  collapseMembers(cur);
  for (const m of cur.members) m.host = m.id === cur.hostId;
  return cur;
}

function hydrateFile() {
  try {
    const rows = JSON.parse(readFileSync(FILE, "utf8")) as Saved[];
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      const key = String(row.key ?? "").trim();
      if (!key || !row.name || stillGone(key)) continue;
      mergeRoom(key, normalizeRoom(row));
    }
  } catch {
    /* first run */
  }
}

function flushFile() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const rows: Saved[] = [...rooms.entries()].map(([key, room]) => ({ key, ...room }));
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows));
    renameSync(tmp, FILE);
  } catch {
    /* */
  }
}

let fileSoon: ReturnType<typeof setTimeout> | null = null;
const sqlSoon = new Map<string, Room>();
let sqlTimer: ReturnType<typeof setTimeout> | null = null;

function flushFileSoon() {
  if (fileSoon) return;
  fileSoon = setTimeout(() => {
    fileSoon = null;
    flushFile();
  }, 320);
}

async function writeSql(key: string, room: Room) {
  const sql = await ensureTable();
  await sql.query(
    `insert into party_rooms (key, name, pass, members, messages, msg_id, msg_total, host_id, expires_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), now())
     on conflict (key) do update set
       name = excluded.name,
       pass = excluded.pass,
       members = excluded.members,
       messages = excluded.messages,
       msg_id = excluded.msg_id,
       msg_total = excluded.msg_total,
       host_id = excluded.host_id,
       expires_at = excluded.expires_at,
       updated_at = now()`,
    [key, room.name, room.pass, packMembers(room), JSON.stringify(room.messages), room.msgId, room.msgTotal || 0, room.hostId, room.expiresAt],
  );
}

function saveSqlSoon(key: string, room: Room) {
  sqlSoon.set(key, room);
  if (sqlTimer) return;
  sqlTimer = setTimeout(() => {
    sqlTimer = null;
    const batch = [...sqlSoon.entries()];
    sqlSoon.clear();
    void (async () => {
      for (const [k, r] of batch) {
        try {
          await writeSql(k, r);
        } catch {
          /* */
        }
      }
    })();
  }, 900);
}

async function saveRoom(key: string, room: Room, urgent = true) {
  rooms.set(key, room);
  if (urgent) {
    if (fileSoon) {
      clearTimeout(fileSoon);
      fileSoon = null;
    }
    flushFile();
    try {
      await writeSql(key, room);
    } catch {
      /* */
    }
    return;
  }
  flushFileSoon();
  saveSqlSoon(key, room);
}

async function ensureTable() {
  const sql = await getSql();
  await sql.query(`create table if not exists party_rooms (
    key text primary key,
    name text not null,
    pass text not null,
    members text not null default '[]',
    messages text not null default '[]',
    msg_id integer not null default 1,
    msg_total integer not null default 0,
    host_id text not null default '',
    expires_at timestamptz,
    updated_at timestamptz not null default now()
  )`);
  try {
    await sql.query("alter table party_rooms add column if not exists host_id text not null default ''");
  } catch {
    /* */
  }
  try {
    await sql.query("alter table party_rooms add column if not exists expires_at timestamptz");
  } catch {
    /* */
  }
  try {
    await sql.query("alter table party_rooms add column if not exists msg_total integer not null default 0");
  } catch {
    /* */
  }
  return sql;
}

async function hydrateSql() {
  try {
    const work = (async () => {
      const sql = await ensureTable();
      const rows = await sql.query<{
        key: string;
        name: string;
        pass: string;
        members: string;
        messages: string;
        msg_id: number;
        msg_total?: number;
        host_id?: string;
        expires_at?: string | Date | null;
      }>("select key, name, pass, members, messages, msg_id, msg_total, host_id, expires_at from party_rooms");
      for (const row of rows) {
        const key = String(row.key ?? "").trim();
        if (!key || stillGone(key)) continue;
        const exp = row.expires_at ? new Date(row.expires_at).getTime() : seedTtl();
        if (Number.isFinite(exp) && exp <= Date.now()) {
          markGone(key);
          try {
            await sql.query("delete from party_rooms where key = $1", [key]);
          } catch {
            /* */
          }
          continue;
        }
        const packed = unpackMembers(row.members);
        mergeRoom(
          key,
          normalizeRoom({
            name: String(row.name ?? key),
            pass: String(row.pass ?? ""),
            members: packed.members,
            messages: asList<Msg>(row.messages),
            msgId: Number(row.msg_id) || 1,
            msgTotal: Number(row.msg_total) || 0,
            hostId: String(row.host_id ?? ""),
            expiresAt: Number.isFinite(exp) ? exp : seedTtl(),
            boundNicks: packed.nicks,
            memRev: packed.rev,
            leftIds: packed.left,
          }),
        );
      }
    })();
    await Promise.race([
      work,
      new Promise((_, rej) => setTimeout(() => rej(new Error("sql")), 1200)),
    ]);
  } catch {
    /* */
  }
}

async function dropRoom(key: string) {
  markGone(key);
  rooms.delete(key);
  sqlSoon.delete(key);
  flushFile();
  try {
    const sql = await ensureTable();
    await sql.query("delete from party_rooms where key = $1", [key]);
  } catch {
    /* */
  }
}

async function purgeExpired() {
  const now = Date.now();
  for (const [k, r] of [...rooms.entries()]) {
    if (!r.expiresAt) r.expiresAt = seedTtl(now);
    if (expired(r, now) || stillGone(k)) await dropRoom(k);
  }
}

async function getRoom(key: string) {
  if (stillGone(key)) return null;
  hydrateFile();
  await hydrateSql();
  await purgeExpired();
  if (stillGone(key)) return null;
  if (rooms.has(key)) {
    const r = rooms.get(key) ?? null;
    if (r && expired(r)) {
      await dropRoom(key);
      return null;
    }
    return r;
  }
  for (const [k, r] of rooms) {
    if (stillGone(k) || expired(r)) continue;
    if (sameRoom(k, key) || sameRoom(r.name, key)) return r;
  }
  return null;
}

function pickRoom(key: string, raw: string) {
  if (stillGone(key)) return { key, room: null as Room | null };
  const exact = rooms.get(key);
  if (exact && !expired(exact) && !stillGone(key)) return { key, room: exact };
  const hits = [...rooms.entries()].filter(
    ([k, r]) => !stillGone(k) && !expired(r) && (sameRoom(k, key) || sameRoom(r.name, raw) || sameRoom(r.name, key)),
  );
  if (hits.length >= 1) {
    const best = hits.find(([k]) => k === key) ?? hits[0];
    return { key: best[0], room: best[1] };
  }
  return { key, room: null as Room | null };
}

async function lookup(key: string, raw: string) {
  await getRoom(key);
  hydrateFile();
  try {
    await hydrateSql();
  } catch {
    /* */
  }
  return pickRoom(key, raw);
}

function markAway(room: Room) {
  for (const m of room.members) m.online = true;
}

function collapseMembers(room: Room, keepId?: string) {
  const byId = new Map<string, Member>();
  const score = (x: Member) =>
    (keepId && (x.id === keepId || x.token === keepId) ? 100 : 0) + (x.online ? 10 : 0) + (x.last || 0) / 1e12;
  const put = (m: Member, key: string) => {
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, m);
      return;
    }
    if (score(m) >= score(prev)) {
      if (prev.id === room.hostId) room.hostId = m.id;
      m.token = m.token || prev.token;
      m.nick = keepId && prev.id === keepId && prev.nick ? prev.nick : m.nick || prev.nick;
      m.push = m.push || prev.push;
      if (!Number.isFinite(m.lng) && Number.isFinite(prev.lng)) {
        m.lng = prev.lng;
        m.lat = prev.lat;
        m.near = m.near || prev.near;
        m.pinAt = Math.max(Number(m.pinAt) || 0, Number(prev.pinAt) || 0);
      }
      byId.set(key, m);
    } else {
      prev.token = prev.token || m.token;
      prev.nick = keepId && m.id === keepId && m.nick ? m.nick : prev.nick || m.nick;
      prev.push = prev.push || m.push;
      if (!Number.isFinite(prev.lng) && Number.isFinite(m.lng)) {
        prev.lng = m.lng;
        prev.lat = m.lat;
        prev.near = prev.near || m.near;
        prev.pinAt = Math.max(Number(prev.pinAt) || 0, Number(m.pinAt) || 0);
      }
    }
  };
  for (const m of room.members) {
    const id = m.id || m.token;
    if (!id) continue;
    put(m, `id:${id}`);
  }
  const merged = [...byId.values()];
  const byTok = new Map<string, Member>();
  for (const m of merged) {
    const tok = m.token || m.id;
    if (!tok) continue;
    const prev = byTok.get(tok);
    if (!prev) {
      byTok.set(tok, m);
      continue;
    }
    if (score(m) >= score(prev)) {
      if (prev.id === room.hostId) room.hostId = m.id;
      m.token = m.token || prev.token;
      m.push = m.push || prev.push;
      if (!Number.isFinite(m.lng) && Number.isFinite(prev.lng)) {
        m.lng = prev.lng;
        m.lat = prev.lat;
        m.near = m.near || prev.near;
        m.pinAt = Math.max(Number(m.pinAt) || 0, Number(prev.pinAt) || 0);
      }
      byTok.set(tok, m);
    } else {
      prev.token = prev.token || m.token;
      prev.push = prev.push || m.push;
      if (!Number.isFinite(prev.lng) && Number.isFinite(m.lng)) {
        prev.lng = m.lng;
        prev.lat = m.lat;
        prev.near = prev.near || m.near;
        prev.pinAt = Math.max(Number(prev.pinAt) || 0, Number(m.pinAt) || 0);
      }
    }
  }
  room.members = [...byTok.values()];
  for (const m of room.members) m.host = m.id === room.hostId;
}

function publicOf(room: Room, touchId?: string, was = "") {
  dropLeft(room);
  markAway(room);
  trimMessages(room);
  if (touchId) {
    const me = room.members.find((m) => m.id === touchId || m.token === touchId);
    if (me) {
      me.last = Date.now();
      me.online = true;
      if (was) dropOldSelf(room, me, me.id, me.token, was);
    }
  }
  collapseMembers(room, touchId);
  return {
    name: room.name,
    hostId: room.hostId,
    members: room.members.map((m) => ({
      id: m.id,
      nick: m.nick,
      online: true,
      host: m.id === room.hostId,
      ...(Number.isFinite(m.lng) && Number.isFinite(m.lat)
        ? { lng: m.lng, lat: m.lat, pinAt: m.pinAt, near: m.near }
        : {}),
    })),
    messages: room.messages.slice(-MSG_MAX),
    seats: PARTY_MAX,
    expiresAt: room.expiresAt,
    cleared: Number(room.clearedAt) || 0,
  };
}

function findMember(room: Room, token: string, uid?: string) {
  markAway(room);
  if (uid) {
    const byUid = room.members.find((m) => m.id === uid);
    if (byUid) return byUid;
  }
  if (token) return room.members.find((m) => m.token === token) ?? null;
  return null;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

const DEFAULT_NICKS = new Set(["ゲスト", "旅人", "Traveler"]);

function seedBound(room: Room) {
  if (!room.boundNicks) room.boundNicks = {};
  for (const m of room.members) {
    const n = (m.nick || "").trim();
    if (!n || DEFAULT_NICKS.has(n)) continue;
    if (m.id) room.boundNicks[m.id] = n;
    if (m.token) room.boundNicks[`t:${m.token}`] = n;
  }
  for (const msg of room.messages) {
    const n = (msg.nick || "").trim();
    const id = (msg.uid || "").trim();
    if (!id || !n || DEFAULT_NICKS.has(n) || room.boundNicks[id]) continue;
    room.boundNicks[id] = n;
  }
}

function keptNick(room: Room, uid: string, token: string) {
  if (!room.boundNicks) seedBound(room);
  if (uid && room.boundNicks?.[uid]) return room.boundNicks[uid]!;
  if (token && room.boundNicks?.[`t:${token}`]) return room.boundNicks[`t:${token}`]!;
  const m = room.members.find((x) => (uid && x.id === uid) || (token && x.token === token));
  const n = (m?.nick || "").trim();
  if (n && !DEFAULT_NICKS.has(n)) return n;
  if (uid) {
    for (let i = room.messages.length - 1; i >= 0; i--) {
      const msg = room.messages[i]!;
      if (msg.uid === uid && msg.nick && !DEFAULT_NICKS.has(msg.nick)) return msg.nick;
    }
  }
  return "";
}

function bindNick(room: Room, uid: string, token: string, nick: string) {
  const n = nick.trim();
  if (!n || DEFAULT_NICKS.has(n)) return;
  if (!room.boundNicks) room.boundNicks = {};
  if (uid) room.boundNicks[uid] = n;
  if (token) room.boundNicks[`t:${token}`] = n;
}

function wasNicks(was: string) {
  return was
    .split(/[,、|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLive(m: Member) {
  return m.online !== false;
}

function nickTaken(room: Room, nick: string, exceptId?: string) {
  const n = nick.trim();
  if (!n) return false;
  const fold = hanFold(n);
  return room.members.some((m) => {
    if (exceptId && (m.id === exceptId || m.token === exceptId)) return false;
    if (!isLive(m)) return false;
    const mn = (m.nick || "").trim();
    return mn === n || hanFold(mn) === fold;
  });
}

function keepPin(dst: Member, src: Member) {
  if (src.pinOff) {
    if ((Number(src.pinAt) || 0) >= (Number(dst.pinAt) || 0)) {
      dst.lng = undefined;
      dst.lat = undefined;
      dst.near = undefined;
      dst.pinAt = src.pinAt;
      dst.pinOff = true;
    }
    return;
  }
  if (!Number.isFinite(src.lng) || !Number.isFinite(src.lat) || dst.pinOff) return;
  if (!Number.isFinite(dst.lng) || (Number(src.pinAt) || 0) >= (Number(dst.pinAt) || 0)) {
    dst.lng = src.lng;
    dst.lat = src.lat;
    dst.near = src.near || dst.near;
    dst.pinAt = Math.max(Number(dst.pinAt) || 0, Number(src.pinAt) || 0);
  }
}

function dropOldSelf(room: Room, keep: Member, uid: string, token: string, was: string) {
  const fold = hanFold(keep.nick || "");
  const old = new Set(wasNicks(was).map((n) => hanFold(n)).filter(Boolean));
  for (const m of room.members) {
    if (m === keep) continue;
    if ((uid && m.id === uid) || (token && m.token && m.token === token)) keepPin(keep, m);
  }
  room.members = room.members.filter((m) => {
    if (m === keep) return true;
    if (uid && m.id === uid) return false;
    if (token && m.token && m.token === token) return false;
    const mn = (m.nick || "").trim();
    const mf = hanFold(mn);
    if (mf && (mf === fold || old.has(mf)) && (!isLive(m) || (uid && m.id === uid) || (token && m.token === token))) return false;
    return true;
  });
}

async function kickFromOthers(uid: string, token: string, keepKey: string) {
  if (!uid && !token) return;
  hydrateFile();
  try {
    await hydrateSql();
  } catch {
    /* */
  }
  for (const [k, r] of [...rooms.entries()]) {
    if (k === keepKey || stillGone(k)) continue;
    const hit = r.members.some((m) => (uid && m.id === uid) || (token && m.token && m.token === token));
    if (!hit) continue;
    r.members = r.members.filter((m) => !(uid && m.id === uid) && !(token && m.token && m.token === token));
    for (const m of r.members) m.host = m.id === r.hostId;
    await saveRoom(k, r);
  }
}

function takeSeat(room: Room, nick: string, token: string, uid: string, was = "") {
  unmarkLeft(room, [uid, token]);
  markAway(room);
  seedBound(room);
  const keep = keptNick(room, uid, token);
  if (keep && nick && hanFold(keep) !== hanFold(nick)) return "nickkeep" as const;
  const id = uid || token;
  const fold = nick ? hanFold(nick) : "";
  const old = wasNicks(was);
  const have =
    (id ? room.members.find((m) => m.id === id) : undefined) ??
    (token ? room.members.find((m) => m.token === token) : undefined) ??
    (nick
      ? room.members.find((m) => {
          const mn = (m.nick || "").trim();
          return !isLive(m) && (mn === nick || hanFold(mn) === fold);
        })
      : undefined) ??
    (old.length
      ? room.members.find((m) => {
          if (isLive(m) && m.id !== uid && m.token !== token) return false;
          const mn = (m.nick || "").trim();
          const mf = hanFold(mn);
          return old.some((w) => w === mn || hanFold(w) === mf);
        })
      : undefined) ??
    null;
  if (have) {
    const oldNick = (have.nick || "").trim();
    if (oldNick && nick && oldNick !== nick && hanFold(oldNick) !== hanFold(nick)) return "nickkeep" as const;
    if (nick && nickTaken(room, nick, have.id)) return "nick" as const;
    const wasHost = have.id === room.hostId || Boolean(have.host);
    have.last = Date.now();
    have.online = true;
    if (!have.nick && nick) have.nick = nick;
    if (token) have.token = token;
    if (uid) have.id = uid;
    if (wasHost || have.id === room.hostId || (uid && uid === room.hostId)) {
      room.hostId = have.id;
      have.host = true;
    } else {
      have.host = have.id === room.hostId;
    }
    dropOldSelf(room, have, uid, token, was);
    collapseMembers(room, have.id);
    bindNick(room, uid || have.id, have.token, have.nick);
    return have;
  }
  if (nickTaken(room, nick)) return "nick" as const;
  if (room.members.length >= PARTY_MAX) return null;
  const member: Member = {
    id: uid || crypto.randomUUID(),
    nick,
    token: token || crypto.randomUUID(),
    last: Date.now(),
    online: true,
    host: false,
  };
  if (!room.hostId || (uid && uid === room.hostId)) {
    room.hostId = member.id;
    member.host = true;
  }
  room.members.push(member);
  room.memRev = (room.memRev || 0) + 1;
  dropOldSelf(room, member, uid, token, was);
  collapseMembers(room, member.id);
  bindNick(room, member.id, member.token, member.nick);
  return member;
}

export const Route = createFileRoute("/api/party")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("action") === "translate") {
          const lang = url.searchParams.get("lang") ?? "ja";
          const texts = (url.searchParams.get("q") ?? "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 20);
          const map = await translateMany(texts, lang);
          return json({ ok: true, map });
        }
        if (url.searchParams.get("list") === "1") {
          await hydrateGoneSql();
          hydrateFile();
          await hydrateSql();
          await purgeExpired();
          const q = url.searchParams.get("q") ?? "";
          const rows = [...rooms.entries()]
            .filter(([k, r]) => {
              if (stillGone(k) || expired(r)) return false;
              dropLeft(r);
              collapseMembers(r);
              markAway(r);
              return true;
            })
            .map(([, r]) => r)
            .sort((a, b) => {
            const am = q && sameRoom(a.name, q) ? 0 : 1;
            const bm = q && sameRoom(b.name, q) ? 0 : 1;
            return am - bm;
          });
          return json({
            ok: true,
            rooms: rows.map((r) => ({
              name: r.name,
              n: r.members.length,
              seats: PARTY_MAX,
            })),
          });
        }
        const key = keyOf(url.searchParams.get("room") ?? "");
        const token = (url.searchParams.get("token") ?? "").slice(0, 80);
        const uid = (url.searchParams.get("uid") ?? "").slice(0, 80);
        if (!key) return json({ ok: false, error: "missing" }, 400);
        const room = await getRoom(key);
        if (!room) return json({ ok: false, error: "missing" }, 404);
        const me = findMember(room, token, uid);
        if (!me) return json({ ok: false, error: "auth" }, 403);
        markAway(room);
        me.last = Date.now();
        me.online = true;
        dropOldSelf(room, me, uid, token, "");
        collapseMembers(room, me.id);
        return json({ ok: true, vapid: await vapidOut(), ...publicOf(room, me.id), you: me.nick, youId: me.id, host: me.id === room.hostId });
      },
      POST: async ({ request }) => {
        let body: {
          action?: string;
          room?: string;
          pass?: string;
          nick?: string;
          token?: string;
          uid?: string;
          text?: string;
          was?: string;
          lng?: string | number;
          lat?: string | number;
          near?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          lang?: string;
          texts?: string[];
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const action = String(body.action ?? "");
        if (action === "translate") {
          const lang = String(body.lang ?? "ja");
          const texts = Array.isArray(body.texts) ? body.texts.map((x) => String(x ?? "")) : body.text ? [String(body.text)] : [];
          const map = await translateMany(texts, lang);
          return json({ ok: true, map });
        }
        const name = String(body.room ?? "").trim().slice(0, 20);
        const key = keyOf(name);
        const pass = String(body.pass ?? "").trim().slice(0, 32);
        const nickRaw = String(body.nick ?? "").trim().slice(0, 12);
        const nick = nickRaw;
        const token = String(body.token ?? "").slice(0, 80);
        const uid = String(body.uid ?? "").slice(0, 80);
        const text = String(body.text ?? "").trim().slice(0, 160);
        const was = String(body.was ?? "").trim().slice(0, 120);

        if (action === "create" || action === "join") {
          if (!key || !pass || !nick) return json({ ok: false, error: "need" }, 400);
          await hydrateGoneSql();
          await purgeExpired();
          if (action === "join" && stillGone(key)) return json({ ok: false, error: "missing" }, 404);
          const found = await lookup(key, name);
          let room = found.room;
          let roomKey = found.key;
          if (action === "create") {
            if (room && !expired(room) && !stillGone(found.key)) return json({ ok: false, error: "exists" }, 409);
            if (room) await dropRoom(found.key);
            const clash = [...rooms.entries()].find(([k, r]) => !stillGone(k) && !expired(r) && (k === key || keyOf(r.name) === key));
            if (clash) return json({ ok: false, error: "exists" }, 409);
            unmarkGone(key);
            room = { name, pass: hashPass(pass), hostId: "", members: [], messages: [], msgId: 1, msgTotal: 0, expiresAt: seedTtl(), born: Date.now(), clearedAt: Date.now() };
            roomKey = key;
            rooms.set(key, room);
          } else {
            if (!room || expired(room) || stillGone(found.key)) return json({ ok: false, error: "missing" }, 404);
            markAway(room);
            if (!passOk(room.pass, pass)) return json({ ok: false, error: "pass" }, 403);
            if (room.pass !== hashPass(pass)) room.pass = hashPass(pass);
          }
          await kickFromOthers(uid, token, roomKey);
          const member = takeSeat(room, nick, token, uid, was);
          if (member === "nick") return json({ ok: false, error: "nick" }, 409);
          if (member === "nickkeep") {
            const keep = keptNick(room, uid, token) || room.members.find((m) => m.id === uid || m.token === token)?.nick || "";
            return json({ ok: false, error: "nickkeep", nick: keep }, 409);
          }
          if (!member) return json({ ok: false, error: "full" }, 409);
          await saveRoom(roomKey, room);
          return json({
            ok: true,
            vapid: await vapidOut(),
            token: member.token,
            you: member.nick,
            youId: member.id,
            host: member.id === room.hostId,
            ...publicOf(room, member.id, was),
          });
        }

        if (!key || (!token && !uid)) return json({ ok: false, error: "auth" }, 403);
        await purgeExpired();
        if (stillGone(key)) return json({ ok: false, error: "missing" }, 404);
        const found = await lookup(key, name);
        const room = found.room;
        if (!room || expired(room) || stillGone(found.key)) return json({ ok: false, error: "missing" }, 404);
        const me = findMember(room, token, uid);
        if (action === "leave") {
          const ids = [me?.id, me?.token, uid, token].filter(Boolean);
          markLeft(room, ids);
          for (const m of room.members) m.host = m.id === room.hostId;
          room.memRev = (room.memRev || 0) + 1;
          for (const id of ids) {
            await forgetPush(found.key, id);
            if (found.key !== keyOf(room.name)) await forgetPush(keyOf(room.name), id);
          }
          await saveRoom(found.key, room);
          return json({ ok: true });
        }
        if (!me) return json({ ok: false, error: "auth" }, 403);
        me.last = Date.now();
        me.online = true;
        if (nickRaw && !me.nick) {
          if (nickTaken(room, nickRaw, me.id)) return json({ ok: false, error: "nick" }, 409);
          me.nick = nickRaw;
        }
        dropOldSelf(room, me, uid, token, was);

        if (action === "beat") {
          await saveRoom(found.key, room, false);
          return json({ ok: true, vapid: await vapidOut(), ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "push") {
          const endpoint = String(body.endpoint ?? "").trim().slice(0, 512);
          const p256dh = String(body.p256dh ?? "").trim().slice(0, 200);
          const auth = String(body.auth ?? "").trim().slice(0, 80);
          if (!endpoint.startsWith("http") || !p256dh || !auth) return json({ ok: false, error: "need" }, 400);
          me.push = { endpoint, p256dh, auth };
          await rememberPush(keyOf(room.name), me.id, me.push);
          if (found.key !== keyOf(room.name)) await rememberPush(found.key, me.id, me.push);
          await saveRoom(found.key, room);
          return json({ ok: true, vapid: await vapidOut(), ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "send") {
          if (!text) return json({ ok: false, error: "need" }, 400);
          const msg: Msg = {
            id: room.msgId++,
            nick: me.nick,
            body: text,
            at: new Date().toISOString(),
            uid: me.id,
          };
          room.messages.push(msg);
          trimMessages(room);
          bumpTtl(room);
          await saveRoom(found.key, room);
          const pushP = pingPush(room, me.id).catch(() => undefined);
          void (async () => {
            try {
              const [ja, en, zh] = await Promise.all([translateOne(text, "ja"), translateOne(text, "en"), translateOne(text, "zh")]);
              const hit = room.messages.find((m) => m.id === msg.id);
              if (hit) hit.tr = { ja, en, zh };
              await saveRoom(found.key, room, false);
            } catch {
              /* */
            }
          })();
          await pushP;
          return json({ ok: true, vapid: await vapidOut(), ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "share") {
          const lng = Number(body.lng);
          const lat = Number(body.lat);
          if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) {
            return json({ ok: false, error: "need" }, 400);
          }
          me.lng = lng;
          me.lat = lat;
          me.pinAt = Date.now();
          me.pinOff = false;
          me.near = String(body.near ?? "").trim().slice(0, 20) || undefined;
          await saveRoom(found.key, room);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "unshare") {
          me.lng = undefined;
          me.lat = undefined;
          me.near = undefined;
          me.pinOff = true;
          me.pinAt = Date.now();
          await saveRoom(found.key, room);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "clear") {
          if (me.id !== room.hostId) return json({ ok: false, error: "host" }, 403);
          room.messages = [];
          room.clearedAt = Date.now();
          for (const m of room.members) {
            m.lng = undefined;
            m.lat = undefined;
            m.near = undefined;
            m.pinAt = undefined;
          }
          await saveRoom(found.key, room);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: true, expiresAt: room.expiresAt });
        }
        if (action === "sweep") {
          if (me.id !== room.hostId) return json({ ok: false, error: "host" }, 403);
          markAway(room);
          room.members = room.members.filter((m) => m.online && Date.now() - m.last <= AWAY_MS);
          if (!room.members.some((m) => m.id === room.hostId) && room.members[0]) {
            room.hostId = room.members[0].id;
            room.members[0].host = true;
          }
          for (const m of room.members) m.host = m.id === room.hostId;
          await saveRoom(found.key, room);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "disband") {
          if (me.id !== room.hostId) return json({ ok: false, error: "host" }, 403);
          await dropRoom(found.key);
          return json({ ok: true, gone: true });
        }
        return json({ ok: false, error: "bad" }, 400);
      },
    },
  },
});
