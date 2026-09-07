import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { hanFold } from "@/lib/han";

const PARTY_MAX = 5;
const AWAY_MS = 90 * 1000;
const MSG_MAX = 50;
const MSG_DROP = 20;
const FILE = join(process.cwd(), ".data", "party-rooms.json");

type Member = { id: string; nick: string; token: string; last: number; online: boolean; host?: boolean };
type Msg = { id: number; nick: string; body: string; at: string; uid?: string };
type Room = { name: string; pass: string; hostId: string; members: Member[]; messages: Msg[]; msgId: number };
type Saved = Room & { key: string };

type G = typeof globalThis & { __jbPartyRooms?: Map<string, Room> };
const rooms: Map<string, Room> =
  (globalThis as G).__jbPartyRooms ?? ((globalThis as G).__jbPartyRooms = new Map<string, Room>());

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
  while (room.messages.length >= MSG_MAX) room.messages.splice(0, MSG_DROP);
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
  };
}

function mergeRoom(key: string, incoming: Room) {
  const next = normalizeRoom(incoming);
  const cur = rooms.get(key);
  if (!cur) {
    rooms.set(key, next);
    collapseMembers(next);
    return next;
  }
  if (next.messages.length > cur.messages.length) cur.messages = next.messages.slice(-MSG_MAX);
  if (next.msgId > cur.msgId) cur.msgId = next.msgId;
  if (next.pass && !cur.pass) cur.pass = next.pass;
  if (next.hostId && !cur.hostId) cur.hostId = next.hostId;
  for (const m of next.members) {
    const have = cur.members.find((x) => x.id === m.id || (m.token && x.token === m.token) || (m.nick && x.nick === m.nick && x.online));
    if (have) {
      if ((m.last ?? 0) >= (have.last ?? 0)) {
        have.last = m.last;
        have.token = m.token || have.token;
        have.nick = m.nick || have.nick;
        have.online = m.online;
      }
      have.id = have.id || m.id;
    } else if (cur.members.length < PARTY_MAX) {
      cur.members.push(m);
    }
  }
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
      if (!key || !row.name) continue;
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
    `insert into party_rooms (key, name, pass, members, messages, msg_id, updated_at)
     values ($1, $2, $3, $4, $5, $6, now())
     on conflict (key) do update set
       name = excluded.name,
       pass = excluded.pass,
       members = excluded.members,
       messages = excluded.messages,
       msg_id = excluded.msg_id,
       updated_at = now()`,
    [key, room.name, room.pass, JSON.stringify(room.members), JSON.stringify(room.messages), room.msgId],
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
    updated_at timestamptz not null default now()
  )`);
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
      }>("select key, name, pass, members, messages, msg_id from party_rooms");
      for (const row of rows) {
        const key = String(row.key ?? "").trim();
        if (!key) continue;
        mergeRoom(
          key,
          normalizeRoom({
            name: String(row.name ?? key),
            pass: String(row.pass ?? ""),
            members: asList<Member>(row.members),
            messages: asList<Msg>(row.messages),
            msgId: Number(row.msg_id) || 1,
            hostId: "",
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
  rooms.delete(key);
  flushFile();
  try {
    const sql = await ensureTable();
    await sql.query("delete from party_rooms where key = $1", [key]);
  } catch {
    /* */
  }
}

async function getRoom(key: string) {
  hydrateFile();
  await hydrateSql();
  if (rooms.has(key)) return rooms.get(key) ?? null;
  for (const [k, r] of rooms) {
    if (sameRoom(k, key) || sameRoom(r.name, key)) return r;
  }
  return null;
}

function pickRoom(key: string, raw: string) {
  const exact = rooms.get(key);
  if (exact) return { key, room: exact };
  const hits = [...rooms.entries()].filter(([k, r]) => sameRoom(k, key) || sameRoom(r.name, raw) || sameRoom(r.name, key));
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
  const now = Date.now();
  for (const m of room.members) {
    if (now - (m.last || 0) > AWAY_MS) m.online = false;
  }
}

function collapseMembers(room: Room, keepId?: string) {
  const byId = new Map<string, Member>();
  for (const m of room.members) {
    const id = m.id || m.token;
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, m);
      continue;
    }
    const score = (x: Member) =>
      (keepId && (x.id === keepId || x.token === keepId) ? 100 : 0) + (x.online ? 10 : 0) + (x.last || 0) / 1e12;
    if (score(m) >= score(prev)) {
      if (prev.id === room.hostId) room.hostId = m.id;
      byId.set(id, m);
    }
  }
  room.members = [...byId.values()];
  for (const m of room.members) m.host = m.id === room.hostId;
}

function publicOf(room: Room, touchId?: string, was = "") {
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
      online: Boolean(m.online && Date.now() - m.last <= AWAY_MS),
      host: m.id === room.hostId,
    })),
    messages: room.messages.slice(-MSG_MAX),
    seats: PARTY_MAX,
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

function wasNicks(was: string) {
  return was
    .split(/[,、|/]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isLive(m: Member) {
  return m.online !== false && Date.now() - (m.last || 0) <= AWAY_MS;
}

function nickTaken(room: Room, nick: string, exceptId?: string) {
  const n = nick.trim();
  if (!n) return false;
  const fold = hanFold(n);
  return room.members.some((m) => {
    if (exceptId && (m.id === exceptId || m.token === exceptId)) return false;
    const mn = (m.nick || "").trim();
    return mn === n || hanFold(mn) === fold;
  });
}

function dropOldSelf(room: Room, keep: Member, uid: string, token: string, was: string) {
  room.members = room.members.filter((m) => {
    if (m === keep) return true;
    if (uid && m.id === uid) return false;
    if (token && m.token && m.token === token) return false;
    return true;
  });
}

function takeSeat(room: Room, nick: string, token: string, uid: string, was = "") {
  markAway(room);
  const id = uid || token;
  const have =
    (id ? room.members.find((m) => m.id === id) : undefined) ??
    (token ? room.members.find((m) => m.token === token) : undefined) ??
    null;
  if (have) {
    if (nick && nickTaken(room, nick, have.id)) return "nick" as const;
    const wasHost = have.id === room.hostId || Boolean(have.host);
    have.last = Date.now();
    have.online = true;
    if (nick) have.nick = nick;
    if (token) have.token = token;
    if (uid) have.id = uid;
    if (wasHost) {
      room.hostId = have.id;
      have.host = true;
    } else {
      have.host = have.id === room.hostId;
    }
    dropOldSelf(room, have, uid, token, was);
    collapseMembers(room, have.id);
    return have;
  }
  if (nickTaken(room, nick)) return "nick" as const;
  if (room.members.length >= PARTY_MAX) {
    room.members = room.members.filter((m) => m.id === room.hostId || (m.online && Date.now() - m.last <= AWAY_MS));
  }
  if (room.members.length >= PARTY_MAX) return null;
  const member: Member = {
    id: uid || crypto.randomUUID(),
    nick,
    token: token || crypto.randomUUID(),
    last: Date.now(),
    online: true,
    host: false,
  };
  if (!room.hostId) {
    room.hostId = member.id;
    member.host = true;
  }
  room.members.push(member);
  dropOldSelf(room, member, uid, token, was);
  collapseMembers(room, member.id);
  return member;
}

export const Route = createFileRoute("/api/party")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("list") === "1") {
          hydrateFile();
          void hydrateSql();
          for (const [k, r] of [...rooms.entries()]) {
            if (!r.members.length) await dropRoom(k);
          }
          const q = url.searchParams.get("q") ?? "";
          const rows = [...rooms.values()].sort((a, b) => {
            const am = q && sameRoom(a.name, q) ? 0 : 1;
            const bm = q && sameRoom(b.name, q) ? 0 : 1;
            return am - bm;
          });
          return json({
            ok: true,
            rooms: rows.map((r) => {
              markAway(r);
              return {
                name: r.name,
                n: r.members.length,
                seats: PARTY_MAX,
              };
            }),
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
        const wasQ = (url.searchParams.get("was") ?? "").trim().slice(0, 120);
        const n0 = room.members.length;
        dropOldSelf(room, me, uid, token, wasQ);
        collapseMembers(room, me.id);
        if (room.members.length !== n0) void saveRoom(key, room);
        return json({ ok: true, ...publicOf(room, me.id, wasQ), you: me.nick, youId: me.id, host: me.id === room.hostId });
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
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "bad-json" }, 400);
        }
        const action = String(body.action ?? "");
        const name = String(body.room ?? "").trim().slice(0, 20);
        const key = keyOf(name);
        const pass = String(body.pass ?? "").trim().slice(0, 32);
        const nickRaw = String(body.nick ?? "").trim().slice(0, 12);
        const nick = nickRaw || "ゲスト";
        const token = String(body.token ?? "").slice(0, 80);
        const uid = String(body.uid ?? "").slice(0, 80);
        const text = String(body.text ?? "").trim().slice(0, 160);
        const was = String(body.was ?? "").trim().slice(0, 120);

        if (action === "create" || action === "join") {
          if (!key || !pass) return json({ ok: false, error: "need" }, 400);
          const found = await lookup(key, name);
          let room = found.room;
          let roomKey = found.key;
          if (action === "create") {
            if (room) {
              markAway(room);
              if (room.members.length) return json({ ok: false, error: "exists" }, 409);
              await dropRoom(found.key);
            }
            const clash = rooms.get(key) ?? [...rooms.values()].find((r) => keyOf(r.name) === key);
            if (clash && clash.members.length) return json({ ok: false, error: "exists" }, 409);
            room = { name, pass: hashPass(pass), hostId: "", members: [], messages: [], msgId: 1 };
            roomKey = key;
            rooms.set(key, room);
          } else {
            if (!room) return json({ ok: false, error: "missing" }, 404);
            markAway(room);
            if (!passOk(room.pass, pass)) return json({ ok: false, error: "pass" }, 403);
            if (room.pass !== hashPass(pass)) room.pass = hashPass(pass);
          }
          const member = takeSeat(room, nick, token, uid, was);
          if (member === "nick") return json({ ok: false, error: "nick" }, 409);
          if (!member) return json({ ok: false, error: "full" }, 409);
          await saveRoom(roomKey, room);
          return json({
            ok: true,
            token: member.token,
            you: member.nick,
            youId: member.id,
            host: member.id === room.hostId,
            ...publicOf(room, member.id, was),
          });
        }

        if (!key || (!token && !uid)) return json({ ok: false, error: "auth" }, 403);
        const found = await lookup(key, name);
        const room = found.room;
        if (!room) return json({ ok: false, error: "missing" }, 404);
        const me = findMember(room, token, uid);
        if (!me) return json({ ok: false, error: "auth" }, 403);

        if (action === "leave") {
          room.members = room.members.filter((m) => m.id !== me.id && m.token !== me.token);
          if (!room.members.length) {
            await dropRoom(found.key);
            return json({ ok: true, gone: true });
          }
          if (!room.members.some((m) => m.id === room.hostId)) {
            room.hostId = room.members[0]!.id;
          }
          for (const m of room.members) m.host = m.id === room.hostId;
          await saveRoom(found.key, room);
          return json({ ok: true });
        }
        me.last = Date.now();
        me.online = true;
        if (nickRaw) {
          if (nickTaken(room, nickRaw, me.id)) return json({ ok: false, error: "nick" }, 409);
          me.nick = nickRaw;
        }
        dropOldSelf(room, me, uid, token, was);

        if (action === "beat") {
          await saveRoom(found.key, room, false);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "send") {
          if (!text) return json({ ok: false, error: "need" }, 400);
          room.messages.push({
            id: room.msgId++,
            nick: me.nick,
            body: text,
            at: new Date().toISOString(),
            uid: me.id,
          });
          trimMessages(room);
          await saveRoom(found.key, room);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: me.id === room.hostId });
        }
        if (action === "clear") {
          if (me.id !== room.hostId) return json({ ok: false, error: "host" }, 403);
          room.messages = [];
          await saveRoom(found.key, room);
          return json({ ok: true, ...publicOf(room, me.id, was), you: me.nick, youId: me.id, host: true });
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
          if (!room.members.length) {
            await dropRoom(found.key);
            return json({ ok: true, gone: true });
          }
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
