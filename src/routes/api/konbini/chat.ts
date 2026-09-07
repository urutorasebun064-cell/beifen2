import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createFileRoute } from "@tanstack/react-router";
import { haversine } from "@/lib/rail/geo";
import { hanFold } from "@/lib/han";
import { KONBINI_CHAT_M } from "@/lib/konbini";

type Row = { id: number; nick: string; body: string; created_at: string; uid?: string };
type Person = { id: string; nick: string; last: number };
type Channel = { members: Person[]; messages: Row[]; msgId: number };

const MSG_MAX = 30;
const LIVE_MS = 20 * 1000;
const FILE = join(process.cwd(), ".data", "shop-chat.json");

type G = typeof globalThis & { __jbShopChat?: Map<string, Channel> };
const channels: Map<string, Channel> =
  (globalThis as G).__jbShopChat ?? ((globalThis as G).__jbShopChat = new Map<string, Channel>());

function fence(storeLng: number, storeLat: number, lng: number, lat: number) {
  if (![storeLng, storeLat, lng, lat].every(Number.isFinite)) return false;
  return haversine([lng, lat], [storeLng, storeLat]) * 1000 <= KONBINI_CHAT_M;
}

function hydrate() {
  try {
    const rows = JSON.parse(readFileSync(FILE, "utf8")) as { key: string; members: Person[]; messages: Row[]; msgId: number }[];
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!row.key) continue;
      const incoming: Channel = {
        members: Array.isArray(row.members) ? row.members : [],
        messages: Array.isArray(row.messages) ? row.messages : [],
        msgId: Number(row.msgId) || 1,
      };
      const cur = channels.get(row.key);
      if (!cur) {
        channels.set(row.key, incoming);
        continue;
      }
      const by = new Map(cur.members.map((m) => [m.id, m]));
      for (const m of incoming.members) {
        const prev = by.get(m.id);
        if (!prev || m.last > prev.last) by.set(m.id, m);
      }
      cur.members = [...by.values()];
      if (incoming.messages.length >= cur.messages.length) cur.messages = incoming.messages;
      cur.msgId = Math.max(cur.msgId, incoming.msgId);
    }
  } catch {
    /* first run */
  }
}

function flush() {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const rows = [...channels.entries()].map(([key, ch]) => ({ key, ...ch }));
    const tmp = `${FILE}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rows));
    renameSync(tmp, FILE);
  } catch {
    /* */
  }
}

function roomOf(id: string) {
  let ch = channels.get(id);
  if (!ch) {
    ch = { members: [], messages: [], msgId: 1 };
    channels.set(id, ch);
  }
  return ch;
}

function pruneMembers(ch: Channel) {
  const now = Date.now();
  ch.members = ch.members.filter((m) => now - m.last <= LIVE_MS);
  if (ch.messages.length > MSG_MAX) ch.messages.splice(0, ch.messages.length - MSG_MAX);
}

function dropIfEmpty(key: string, ch: Channel) {
  if (ch.members.length) return ch;
  ch.messages = [];
  channels.delete(key);
  flush();
  return null;
}

function nickTaken(ch: Channel, nick: string, uid: string) {
  const fold = hanFold(nick);
  return ch.members.some((m) => m.id !== uid && (m.nick === nick || hanFold(m.nick) === fold));
}

function publicOf(ch: Channel) {
  return {
    ok: true,
    members: ch.members.map((m) => ({ id: m.id, nick: m.nick })),
    n: ch.members.length,
    messages: ch.messages.slice(-MSG_MAX),
  };
}

export const Route = createFileRoute("/api/konbini/chat")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        hydrate();
        const store = new URL(request.url).searchParams.get("store")?.slice(0, 80) ?? "";
        if (!store) return Response.json({ ok: false, messages: [], members: [], n: 0 }, { status: 400 });
        const ch = channels.get(store);
        if (!ch) return Response.json({ ok: true, messages: [], members: [], n: 0 });
        pruneMembers(ch);
        const live = dropIfEmpty(store, ch);
        if (!live) return Response.json({ ok: true, messages: [], members: [], n: 0 });
        return Response.json(publicOf(live));
      },
      POST: async ({ request }) => {
        hydrate();
        let body: {
          action?: string;
          store?: string;
          nick?: string;
          text?: string;
          uid?: string;
          lng?: number;
          lat?: number;
          storeLng?: number;
          storeLat?: number;
        } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, error: "bad-json" }, { status: 400 });
        }
        const store = String(body.store ?? "").slice(0, 80);
        const uid = String(body.uid ?? "").slice(0, 80);
        const nick = String(body.nick ?? "").trim().slice(0, 16);
        const text = String(body.text ?? "").trim().slice(0, 160);
        const action = String(body.action ?? (text ? "send" : "beat"));
        if (!store) return Response.json({ ok: false, error: "missing" }, { status: 400 });

        if (action === "leave") {
          const ch = channels.get(store);
          if (!ch) return Response.json({ ok: true, messages: [], members: [], n: 0 });
          ch.members = ch.members.filter((m) => m.id !== uid && m.nick !== nick);
          pruneMembers(ch);
          const live = dropIfEmpty(store, ch);
          if (!live) return Response.json({ ok: true, gone: true, messages: [], members: [], n: 0 });
          flush();
          return Response.json(publicOf(live));
        }

        if (!uid || !nick) return Response.json({ ok: false, error: "need" }, { status: 400 });
        if (!fence(Number(body.storeLng), Number(body.storeLat), Number(body.lng), Number(body.lat))) {
          const ch = channels.get(store);
          if (ch) {
            ch.members = ch.members.filter((m) => m.id !== uid);
            pruneMembers(ch);
            dropIfEmpty(store, ch);
          }
          return Response.json({ ok: false, error: "far" }, { status: 403 });
        }

        const ch = roomOf(store);
        pruneMembers(ch);
        if (nickTaken(ch, nick, uid)) return Response.json({ ok: false, error: "nick" }, { status: 409 });
        const now = Date.now();
        const mine = ch.members.find((m) => m.id === uid);
        if (mine) {
          mine.nick = nick;
          mine.last = now;
        } else ch.members.push({ id: uid, nick, last: now });

        if (action === "send") {
          if (!text) return Response.json({ ok: false, error: "missing" }, { status: 400 });
          ch.messages.push({ id: ch.msgId++, nick, body: text, created_at: new Date().toISOString(), uid });
          if (ch.messages.length > MSG_MAX) ch.messages.splice(0, ch.messages.length - MSG_MAX);
        }
        flush();
        return Response.json(publicOf(ch));
      },
    },
  },
});
