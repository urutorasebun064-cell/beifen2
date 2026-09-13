import { Component, FormEvent, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Navigation, X } from "lucide-react";
import { copies, type Lang } from "@/lib/i18n";
import { hanFold } from "@/lib/han";
import { isInJapan, stationsNearPlace } from "@/lib/rail/geo";
import { applyMateTrip } from "@/components/app/search-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore } from "@/store/map-store";
import { patchSave } from "@/lib/save-sync";

type Member = { id: string; nick: string; online?: boolean; host?: boolean; lng?: number; lat?: number; pinAt?: number; near?: string };
type Msg = { id: number; nick: string; body: string; at: string; uid?: string; tr?: { ja?: string; en?: string; zh?: string } };
type RoomState = { name: string; members: Member[]; messages: Msg[]; seats: number; you?: string; youId?: string; host?: boolean; hostId?: string; expiresAt?: number; vapid?: string; cleared?: number };

function foldMembers(list: Member[], meId: string, you: string) {
  const best = new Map<string, Member>();
  for (const m of list) {
    const id = (m.id || "").trim();
    const nick = (m.nick || "").trim();
    const k = id || nick;
    if (!k) continue;
    const prev = best.get(k);
    if (!prev) {
      best.set(k, m);
      continue;
    }
    const score = (x: Member) => (x.id === meId || x.nick === you ? 8 : 0) + (x.online === true ? 2 : 0) + (Number.isFinite(x.lng) ? 1 : 0);
    if (score(m) >= score(prev)) {
      best.set(k, {
        ...prev,
        ...m,
        nick: m.nick || prev.nick,
        lng: Number.isFinite(m.lng) ? m.lng : prev.lng,
        lat: Number.isFinite(m.lat) ? m.lat : prev.lat,
        near: m.near || prev.near,
      });
    }
  }
  const seenNick = new Set<string>();
  const out: Member[] = [];
  for (const m of best.values()) {
    const nick = (m.nick || "").trim();
    if (nick && seenNick.has(nick) && m.id !== meId) continue;
    if (nick) seenNick.add(nick);
    out.push(m);
  }
  return out;
}

function myNicks(): string[] {
  const extra = ["ゲスト", "旅人", "Traveler"];
  try {
    const raw = localStorage.getItem("jb-party-nicks");
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    const stored = Array.isArray(v) ? v.map((x) => String(x).slice(0, 12)).filter(Boolean) : [];
    return [...new Set([...stored, ...extra])];
  } catch {
    return extra;
  }
}

function rememberNick(n: string) {
  const name = n.trim().slice(0, 12);
  if (!name) return;
  try {
    localStorage.setItem("jb-party-nicks", JSON.stringify([name, ...myNicks().filter((x) => x !== name)].slice(0, 8)));
  } catch {
    /* */
  }
}

function roomNickMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem("jb-party-room-nicks");
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    if (!v || typeof v !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const name = String(n ?? "").trim().slice(0, 12);
      if (k && name) out[k] = name;
    }
    return out;
  } catch {
    return {};
  }
}

function roomNickOf(room: string) {
  const map = roomNickMap();
  const key = hanFold(room.trim()) || room.trim();
  return map[key] || map[room.trim()] || "";
}

function rememberRoomNick(room: string, nick: string) {
  const name = nick.trim().slice(0, 12);
  const key = hanFold(room.trim()) || room.trim();
  if (!key || !name) return;
  try {
    const map = roomNickMap();
    map[key] = name;
    localStorage.setItem("jb-party-room-nicks", JSON.stringify(map));
  } catch {
    /* */
  }
}

function userId() {
  try {
    const hit = localStorage.getItem("jb-party-uid");
    if (hit) return hit.slice(0, 80);
    const id = crypto.randomUUID();
    localStorage.setItem("jb-party-uid", id);
    return id;
  } catch {
    return "";
  }
}

function realNick(n?: string) {
  const s = String(n ?? "").trim().slice(0, 12);
  if (!s || ["ゲスト", "旅人", "Traveler"].includes(s)) return "";
  return s;
}

function nickOf() {
  try {
    return realNick(sessionStorage.getItem("jb-party-nick") || localStorage.getItem("jb-party-nick"));
  } catch {
    return "";
  }
}

type Session = { room: string; token: string; nick: string; open?: boolean; pass?: string };

function readStore(store: Storage): Session | null {
  try {
    const raw = store.getItem("jb-party-session");
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Session> & { pass?: string };
    if (!v.room || !v.token) return null;
    return {
      room: String(v.room),
      token: String(v.token),
      nick: String(v.nick ?? ""),
      open: Boolean(v.open),
      pass: String(v.pass ?? ""),
    };
  } catch {
    return null;
  }
}

function loadSession(): Session | null {
  try {
    return readStore(sessionStorage) ?? readStore(localStorage);
  } catch {
    return null;
  }
}

function saveSession(session: Session) {
  const raw = JSON.stringify(session);
  try {
    sessionStorage.setItem("jb-party-session", raw);
    if (session.nick) {
      sessionStorage.setItem("jb-party-nick", session.nick);
      rememberNick(session.nick);
    }
  } catch {
    /* */
  }
  try {
    localStorage.setItem("jb-party-session", raw);
    if (session.nick) {
      localStorage.setItem("jb-party-nick", session.nick);
      rememberNick(session.nick);
    }
  } catch {
    /* */
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem("jb-party-session");
  } catch {
    /* */
  }
  try {
    localStorage.removeItem("jb-party-session");
  } catch {
    /* */
  }
}

function loadLast(): { room: string; pass: string; nick: string } | null {
  for (const store of [sessionStorage, localStorage]) {
    try {
      const raw = store.getItem("jb-party-last");
      if (!raw) continue;
      const v = JSON.parse(raw) as { room?: string; pass?: string; nick?: string };
      if (!v.room) continue;
      return {
        room: String(v.room).slice(0, 20),
        pass: String(v.pass ?? "").slice(0, 32),
        nick: String(v.nick ?? "").slice(0, 12),
      };
    } catch {
      /* */
    }
  }
  return null;
}

function saveLast(room: string, pass: string, nick?: string) {
  const prev = loadLast();
  const first = (prev && prev.room === room && realNick(prev.nick) ? prev.nick : realNick(nick)) || "";
  const raw = JSON.stringify({ room, pass, nick: first });
  try {
    sessionStorage.setItem("jb-party-last", raw);
  } catch {
    /* */
  }
  try {
    localStorage.setItem("jb-party-last", raw);
  } catch {
    /* */
  }
  patchSave({ lastRoom: room.slice(0, 24), nick: first || undefined });
}

function url64(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function bindPush(room: string, token: string, vapid?: string) {
  if (!room || !token || !vapid) return false;
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") return false;
    await navigator.serviceWorker.register("/sw.js?v=29", { scope: "/", updateViaCache: "none" });
    const reg = await navigator.serviceWorker.ready;
    await reg.update().catch(() => undefined);
    const key = url64(vapid);
    let sub = await reg.pushManager.getSubscription();
    try {
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    } catch {
      try {
        await sub?.unsubscribe();
      } catch {
        /* */
      }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    const json = sub.toJSON();
    const endpoint = String(json.endpoint ?? "");
    const p256dh = String(json.keys?.p256dh ?? "");
    const auth = String(json.keys?.auth ?? "");
    if (!endpoint || !p256dh || !auth) return false;
    const { res } = await partyPost({ action: "push", room, token, nick: nickOf(), endpoint, p256dh, auth });
    return res.ok;
  } catch {
    return false;
  }
}

const trCache = new Map<string, string>();

function guessChatLang(s: string): Lang | "" {
  if (/[\u3040-\u30ff]/u.test(s)) return "ja";
  if (/[A-Za-z]/.test(s) && !/[\u3040-\u9fff]/u.test(s)) return "en";
  if (/[\u4e00-\u9fff]/u.test(s)) return "zh";
  return "";
}

function badTr(s: string) {
  const u = s.toUpperCase();
  return u.includes("INVALID SOURCE LANGUAGE") || u.includes("LANGPAIR=") || u.includes("MYMEMORY WARNING") || u.includes("PLEASE SELECT TWO DISTINCT");
}

function sameChatLang(s: string, lang: Lang) {
  const g = guessChatLang(s);
  if (lang === "en") return g === "en" || (/^[A-Za-z0-9\s.,!?'"+\-:/]+$/.test(s) && !/[\u3040-\u9fff]/u.test(s));
  if (lang === "ja") return g === "ja";
  return g === "zh" && !/[A-Za-z]/.test(s) && !/[\u3040-\u30ff]/u.test(s);
}

async function fillChatTr(bodies: string[], lang: Lang) {
  const uniq = [...new Set(bodies.map((b) => b.trim()).filter(Boolean))];
  const need: string[] = [];
  for (const b of uniq) {
    const k = `${lang}\t${b}`;
    const cached = trCache.get(k);
    if (cached && !badTr(cached) && cached !== b) continue;
    if (cached && badTr(cached)) trCache.delete(k);
    need.push(b);
  }
  if (!need.length) return false;
  let got = false;
  const apply = (map?: Record<string, string>) => {
    if (!map) return;
    for (const [src, dst] of Object.entries(map)) {
      const out = (dst || "").trim();
      if (out && !badTr(out) && out !== src) {
        trCache.set(`${lang}\t${src}`, out);
        got = true;
      }
    }
  };
  try {
    const res = await fetch("/api/party", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "translate", lang, texts: need.slice(0, 40) }),
    });
    const data = (await res.json()) as { ok?: boolean; map?: Record<string, string> };
    apply(data.map);
  } catch {
    /* try GET */
  }
  if (!got) {
    try {
      const q = encodeURIComponent(need.slice(0, 12).join("\n"));
      const res = await fetch(`/api/party?action=translate&lang=${encodeURIComponent(lang)}&q=${q}`);
      const data = (await res.json()) as { ok?: boolean; map?: Record<string, string> };
      apply(data.map);
    } catch {
      /* keep original */
    }
  }
  return got;
}

function shownChat(row: Msg, lang: Lang) {
  const fromTr = row.tr?.[lang];
  if (fromTr && !badTr(fromTr) && fromTr !== row.body) return fromTr;
  const hit = trCache.get(`${lang}\t${row.body}`) ?? trCache.get(`${lang}\t${row.body.trim()}`);
  if (!hit || badTr(hit) || hit === row.body) return row.body;
  return hit;
}

async function partyPost(body: Record<string, string>) {
  const was = myNicks()
    .filter((n) => n && n !== body.nick)
    .join(",");
  const res = await fetch("/api/party", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, uid: userId(), ...(was ? { was } : {}) }),
  });
  const data = (await res.json()) as RoomState & { ok?: boolean; error?: string; token?: string; gone?: boolean; nick?: string };
  return { res, data };
}

let audioCtx: AudioContext | null = null;
function unlockPing() {
  try {
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
  } catch {
    /* */
  }
}

function pingChat() {
  try {
    audioCtx ??= new AudioContext();
    void audioCtx.resume();
    const now = audioCtx.currentTime;
    const ding = (freq: number, at: number) => {
      const o = audioCtx!.createOscillator();
      const g = audioCtx!.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.05, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
      o.connect(g);
      g.connect(audioCtx!.destination);
      o.start(at);
      o.stop(at + 0.1);
    };
    ding(1568, now);
    ding(1976, now + 0.12);
  } catch {
    /* */
  }
}

function markUnread() {
  useMapStore.getState().setPartyAlert(true);
  try {
    localStorage.setItem("jb-party-unread", "1");
  } catch {
    /* */
  }
  try {
    void navigator.setAppBadge?.(1);
  } catch {
    /* */
  }
}

function clearPartyBadge() {
  useMapStore.getState().setPartyAlert(false);
  try {
    localStorage.removeItem("jb-party-unread");
  } catch {
    /* */
  }
  try {
    void navigator.clearAppBadge?.();
  } catch {
    /* */
  }
}

function seenKey(room: string) {
  return `jb-party-seen:${room}`;
}

function loadSeen(room: string) {
  try {
    return Number(localStorage.getItem(seenKey(room))) || 0;
  } catch {
    return 0;
  }
}

function saveSeen(room: string, id: number) {
  if (!room || !id) return;
  try {
    localStorage.setItem(seenKey(room), String(id));
  } catch {
    /* */
  }
}

async function partyNotify(preview = "•") {
  markUnread();
  pingChat();
  const s = useMapStore.getState();
  const viewing = !s.partyCollapsed && s.partyMenuOpen && document.visibilityState === "visible";
  if (viewing) return;
  if (document.visibilityState === "visible") return;
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("J", {
      body: preview,
      tag: "jb-party-" + Date.now(),
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      silent: false,
      renotify: true,
      vibrate: [40, 80, 40],
      data: { type: "party-alert" },
    });
  } catch {
    try {
      new Notification("J", { body: preview, silent: false });
    } catch {
      /* */
    }
  }
}

let pushNow: (() => void) | null = null;

export function PartyButton() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const open = useMapStore((s) => s.partyMenuOpen);
  const inRoom = useMapStore((s) => s.partyInRoom);
  const collapsed = useMapStore((s) => s.partyCollapsed);
  const alert = useMapStore((s) => s.partyAlert);
  useEffect(() => {
    try {
      if (localStorage.getItem("jb-party-unread") === "1") useMapStore.getState().setPartyAlert(true);
    } catch {
      /* */
    }
  }, []);
  return (
    <button
      type="button"
      className={`jb-chip relative inline-flex min-h-36 w-11 items-center justify-center overflow-visible rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium shadow-[var(--shadow-border)] backdrop-blur-md [writing-mode:vertical-rl] ${open || inRoom ? "text-accent" : "text-fg"} ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
      onClick={() => {
        unlockPing();
        pushNow?.();
        const s = useMapStore.getState();
        if (s.partyInRoom) {
          if (s.partyCollapsed || !s.partyMenuOpen) {
            s.setPartyCollapsed(false);
            s.setPartyMenuOpen(true);
            clearPartyBadge();
          } else {
            s.setPartyCollapsed(true);
          }
          return;
        }
        s.setPartyMenuOpen(!s.partyMenuOpen);
      }}
    >
      {inRoom ? t.partyParty : t.partyMenu}
      {alert ? (
        <span className="absolute -right-1 -top-1 z-10 flex size-4 items-center justify-center rounded-full bg-[#e4453a] text-[11px] font-black leading-none text-white [writing-mode:horizontal-tb]">
          !
        </span>
      ) : null}
    </button>
  );
}

class PartyCatch extends Component<{ children: ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() {
    return { bad: true };
  }
  render() {
    return this.state.bad ? null : this.props.children;
  }
}

export function PartySafe() {
  return (
    <PartyCatch>
      <PartyWindow />
    </PartyCatch>
  );
}

export function PartyWindow() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const open = useMapStore((s) => s.partyMenuOpen);
  const [mode, setMode] = useState<"create" | "join">("join");
  const [room, setRoom] = useState("");
  const [pass, setPass] = useState("");
  const [nick, setNick] = useState(() => nickOf());
  const [token, setToken] = useState("");
  const [joined, setJoined] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [listed, setListed] = useState<{ name: string; n: number; seats: number }[]>([]);
  const [pending, setPending] = useState<Msg[]>([]);
  const [state, setState] = useState<RoomState | null>(null);
  const [sharing, setSharing] = useState(false);
  const [trTick, setTrTick] = useState(0);
  const collapsed = useMapStore((s) => s.partyCollapsed);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const passRef = useRef(pass);
  const nickRef = useRef(nick);
  const joinedRef = useRef(joined);
  const tokenRef = useRef(token);
  const lastHeardRef = useRef(0);
  const pushBoundRef = useRef("");
  const vapidRef = useRef("");
  const shareOffRef = useRef(false);
  const pinKeepRef = useRef<{ lng: number; lat: number; near?: string } | null>(null);
  const clearedRef = useRef(0);
  const msgsRef = useRef<Msg[]>([]);
  const memsRef = useRef<Member[]>([]);
  passRef.current = pass;
  nickRef.current = nick;
  joinedRef.current = joined;
  tokenRef.current = token;
  pushNow = () => {
    if (joinedRef.current && tokenRef.current && vapidRef.current) {
      void bindPush(joinedRef.current, tokenRef.current, vapidRef.current);
    }
  };

  const applyRoom = (data: RoomState) => {
    const wipe = Number(data.cleared) || 0;
    if (wipe > clearedRef.current) {
      clearedRef.current = wipe;
      msgsRef.current = (data.messages ?? []).filter((m) => m.id > 0);
      memsRef.current = data.members ?? [];
    } else if ((data.messages ?? []).some((m) => m.id > 0)) {
      const map = new Map<number, Msg>();
      for (const row of msgsRef.current) if (row.id > 0) map.set(row.id, row);
      for (const row of data.messages ?? []) if (row.id > 0) map.set(row.id, row);
      msgsRef.current = [...map.values()].sort((a, b) => a.id - b.id);
    }
    const incoming = data.members ?? [];
    memsRef.current = incoming;
    return { ...data, messages: msgsRef.current, members: memsRef.current };
  };

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "party-open") {
        useMapStore.getState().setPartyMenuOpen(true);
        useMapStore.getState().setPartyCollapsed(false);
        clearPartyBadge();
        return;
      }
      if (e.data?.type === "party-alert") {
        const viewing = !useMapStore.getState().partyCollapsed && useMapStore.getState().partyMenuOpen && document.visibilityState === "visible";
        if (viewing) {
          void navigator.serviceWorker?.ready.then((reg) => reg.getNotifications().then((ns) => ns.forEach((n) => n.close()))).catch(() => undefined);
          return;
        }
        markUnread();
        pingChat();
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setRoom(saved.room);
      setJoined(saved.room);
      setToken(saved.token);
      const last = loadLast();
      const first = realNick(saved.nick) || realNick(last && last.room === saved.room ? last.nick : "");
      if (first) setNick(first);
      if (saved.pass) setPass(saved.pass);
      else if (last?.pass) setPass(last.pass);
      useMapStore.getState().setPartyInRoom(true);
      useMapStore.getState().setPartyCollapsed(true);
      return;
    }
    const last = loadLast();
    if (!last) return;
    setRoom(last.room);
    if (last.pass) setPass(last.pass);
    if (realNick(last.nick)) setNick(last.nick);
  }, []);

  useEffect(() => {
    const bye = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      const room = joinedRef.current;
      const tok = tokenRef.current;
      if (!room || !tok) return;
      const body = JSON.stringify({
        action: "beat",
        room,
        token: tok,
        uid: userId(),
        nick: nickRef.current,
      });
      try {
        navigator.sendBeacon("/api/party", new Blob([body], { type: "application/json" }));
      } catch {
        void fetch("/api/party", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
      }
    };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);

  useEffect(() => {
    if (!open) return;
    const saved = loadSession();
    if (!saved?.token || !saved.room) return;
    setJoined(saved.room);
    setToken(saved.token);
    setRoom(saved.room);
    if (saved.nick) setNick(saved.nick);
    if (saved.pass) setPass(saved.pass);
    useMapStore.getState().setPartyInRoom(true);
  }, [open]);

  useEffect(() => {
    if (!open || joined) return;
    let live = true;
    const load = async () => {
      try {
        const res = await fetch("/api/party?list=1");
        const data = (await res.json()) as { rooms?: { name: string; n: number; seats: number }[] };
        if (live && Array.isArray(data.rooms)) setListed(data.rooms);
      } catch {
        /* */
      }
    };
    void load();
    let id = 0;
    const arm = () => {
      window.clearInterval(id);
      id = 0;
      if (document.visibilityState === "visible") id = window.setInterval(load, 8000);
    };
    arm();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        arm();
        void load();
      } else {
        window.clearInterval(id);
        id = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [open, joined]);

  useEffect(() => {
    if (!joined || !token) return;
    let live = true;
    const resume = async () => {
      const key = passRef.current;
      const who = nickRef.current || nickOf();
      if (!key) return false;
      const { res, data } = await partyPost({
        action: "join",
        room: joinedRef.current,
        pass: key,
        nick: who,
        token: tokenRef.current,
      });
      if (!live) return false;
      if (!res.ok || !data.ok || !data.token) return false;
      saveSession({
        room: data.name || joinedRef.current,
        token: data.token,
        nick: who,
        open: useMapStore.getState().partyMenuOpen,
        pass: passRef.current,
      });
      setToken(data.token);
      setJoined(data.name || joinedRef.current);
      setState(applyRoom(data));
      return true;
    };
    const pull = async () => {
      try {
        const res = await fetch(
          `/api/party?room=${encodeURIComponent(joinedRef.current)}&token=${encodeURIComponent(tokenRef.current)}&uid=${encodeURIComponent(userId())}&nick=${encodeURIComponent(nickRef.current || "")}`,
        );
        const data = (await res.json()) as RoomState & { ok?: boolean; error?: string };
        if (!live) return;
        if (res.ok && data.ok !== false) {
          const mine = userId();
          const msgs = data.messages ?? [];
          const top = msgs.reduce((n, m) => Math.max(n, m.id || 0), 0);
          const prev = lastHeardRef.current;
          const roomName = data.name || joinedRef.current;
          const seen = loadSeen(roomName);
          const viewing = !useMapStore.getState().partyCollapsed && useMapStore.getState().partyMenuOpen && document.visibilityState === "visible";
          if (viewing) {
            if (top) saveSeen(roomName, top);
            clearPartyBadge();
          } else if (top > seen) {
            const fresh = msgs.filter((m) => (m.id || 0) > Math.max(prev, seen) && m.uid !== mine && m.nick !== nickRef.current);
            if (fresh.length) {
              const row = fresh[fresh.length - 1]!;
              void partyNotify(`${row.nick}: ${(row.body || "•").slice(0, 40)}`);
              saveSeen(roomName, top);
            } else markUnread();
          }
          if (top) lastHeardRef.current = top;
          if (!shareOffRef.current && pinKeepRef.current && Array.isArray(data.members)) {
            const mine = userId();
            const who = nickRef.current;
            const keep = pinKeepRef.current;
            data.members = data.members.map((m) =>
              m.id === mine || m.nick === who
                ? {
                    ...m,
                    lng: Number.isFinite(Number(m.lng)) ? m.lng : keep.lng,
                    lat: Number.isFinite(Number(m.lat)) ? m.lat : keep.lat,
                    near: m.near || keep.near,
                  }
                : m,
            );
          }
          if (shareOffRef.current && Array.isArray(data.members)) {
            const mine = userId();
            data.members = data.members.map((m) =>
              m.id === mine || m.nick === nickRef.current ? { ...m, lng: undefined, lat: undefined, near: undefined } : m,
            );
          }
          setState(applyRoom(data));
          if (data.vapid) vapidRef.current = data.vapid;
          if (data.vapid) {
            void bindPush(roomName, tokenRef.current, data.vapid).then((ok) => {
              if (ok) pushBoundRef.current = tokenRef.current;
            });
          }
          setPending((rows) => {
            const server = msgsRef.current;
            if (!server.length) return rows;
            return rows.filter((p) => !server.some((m) => m.body === p.body && (m.uid === userId() || m.nick === p.nick)));
          });
          setErr("");
          return;
        }
        if (data.error === "full") setErr(t.partyFull);
        if (data.error === "missing") {
          clearSession();
          setJoined("");
          setToken("");
          setState(null);
          setPending([]);
          msgsRef.current = [];
          memsRef.current = [];
          clearedRef.current = 0;
          setRoom("");
          setPass("");
          setErr(t.partyMissing);
          useMapStore.getState().setPartyInRoom(false);
          useMapStore.getState().setPartyCollapsed(false);
          useMapStore.getState().setPartyPins([]);
          useMapStore.getState().selectMate(null);
          pinKeepRef.current = null;
          shareOffRef.current = false;
          return;
        }
        await resume();
      } catch {
        /* stay in the room across blips / app switches */
      }
    };
    void pull();
    let id = 0;
    const arm = () => {
      window.clearInterval(id);
      id = window.setInterval(pull, document.visibilityState === "visible" ? 900 : 4000);
    };
    arm();
    const onShow = () => {
      arm();
      void pull();
      if (joinedRef.current && tokenRef.current && vapidRef.current) {
        void bindPush(joinedRef.current, tokenRef.current, vapidRef.current);
      }
    };
    const onHide = () => {
      arm();
      if (joinedRef.current && tokenRef.current && vapidRef.current) {
        void bindPush(joinedRef.current, tokenRef.current, vapidRef.current);
      }
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("focus", onShow);
    return () => {
      live = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("focus", onShow);
    };
  }, [joined, token, lang, t.partyFull]);

  useLayoutEffect(() => {
    if (open && joined && !collapsed) stickRef.current = true;
  }, [open, joined, collapsed]);

  useLayoutEffect(() => {
    if (!open || collapsed || !joined || !stickRef.current) return;
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [open, collapsed, joined, state?.messages.at(-1)?.id, pending.length]);

  useEffect(() => {
    const el = logRef.current;
    if (!el || !joined || collapsed) return;
    let y0 = 0;
    let s0 = 0;
    const onStart = (e: TouchEvent) => {
      y0 = e.touches[0]?.clientY ?? 0;
      s0 = el.scrollTop;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? y0;
      el.scrollTop = s0 + (y0 - y);
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [joined, collapsed, open]);

  const sawOpenRef = useRef(false);
  useEffect(() => {
    if (!sawOpenRef.current) {
      sawOpenRef.current = true;
      return;
    }
    const saved = loadSession();
    if (!saved?.token) return;
    saveSession({ ...saved, open, pass: passRef.current || saved.pass });
  }, [open]);

  useEffect(() => {
    const mineId = state?.youId || userId();
    const rows = (state?.members ?? []).flatMap((m) => {
      const lng = Number(m.lng);
      const lat = Number(m.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !isInJapan(lng, lat)) return [];
      return [{ id: m.id, nick: m.nick, lng, lat, station: m.near, mine: m.id === mineId }];
    });
    const keep = pinKeepRef.current;
    if (keep && joined && !shareOffRef.current && isInJapan(keep.lng, keep.lat) && !rows.some((p) => p.mine)) {
      rows.push({ id: mineId, nick: nickRef.current || nick, lng: keep.lng, lat: keep.lat, station: keep.near, mine: true });
    }
    useMapStore.getState().setPartyPins(rows);
  }, [state?.members, joined, nick]);

  const chatBodies = `${(state?.messages ?? []).map((m) => `${m.id}:${m.body}:${m.tr?.[lang] ?? ""}`).join("|")}|${pending.map((m) => m.body).join("|")}`;
  useEffect(() => {
    if (!joined) return;
    let changed = false;
    for (const m of state?.messages ?? []) {
      const v = m.tr?.[lang];
      if (v && v !== m.body && !badTr(v)) {
        const k = `${lang}\t${m.body}`;
        if (trCache.get(k) !== v) {
          trCache.set(k, v);
          changed = true;
        }
      }
    }
    const bodies = [...(state?.messages ?? []).map((m) => m.body), ...pending.map((m) => m.body)];
    void fillChatTr(bodies, lang).then((g) => {
      if (g || changed) setTrTick((n) => n + 1);
    });
  }, [joined, lang, chatBodies]);

  if (!open) return null;

  const fail = (code?: string, keep?: string) => {
    if (code === "full") setErr(t.partyFull);
    else if (code === "pass") setErr(t.partyBadPass);
    else if (code === "missing") {
      if (!joinedRef.current) setErr(t.partyMissing);
    } else if (code === "exists") setErr(t.partyExists);
    else if (code === "nick") setErr(t.partyNickTaken);
    else if (code === "nickkeep") setErr(t.partyNickKeep.replace("{n}", keep || roomNickOf(room.trim()) || nick.trim() || "—"));
    else if (code === "need") setErr(t.partyNeed);
    else if (code) setErr(t.reserveFail);
  };

  const enter = async (e: FormEvent) => {
    e.preventDefault();
    unlockPing();
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch {
      /* */
    }
    if (!room.trim() || !pass.trim()) {
      setErr(t.partyNeed);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const roomName = room.trim();
      const who = nick.trim();
      const used = roomNickOf(roomName);
      if (used && who && used !== who && hanFold(used) !== hanFold(who)) {
        setErr(t.partyNickKeep.replace("{n}", used));
        setBusy(false);
        return;
      }
      nickRef.current = who;
      if (!who) {
        setErr(t.partyNeed);
        setBusy(false);
        return;
      }
      let { res, data } = await partyPost({
        action: mode,
        room: roomName,
        pass: pass.trim(),
        nick: who,
        token: tokenRef.current,
      });
      if (!res.ok || !data.ok || !data.token) {
        fail(data.error, data.nick);
        return;
      }
      const joinedName = data.name || roomName;
      saveSession({ room: joinedName, token: data.token, nick: who, open: true, pass: passRef.current });
      saveLast(joinedName, passRef.current, who);
      rememberRoomNick(joinedName, who);
      rememberNick(who);
      setNick(who);
      setToken(data.token);
      msgsRef.current = [];
      memsRef.current = [];
      clearedRef.current = 0;
      setJoined(joinedName);
      setState(applyRoom(data));
      lastHeardRef.current = (data.messages ?? []).reduce((n, m) => Math.max(n, m.id || 0), 0);
      unlockPing();
      try {
        if ("Notification" in window && Notification.permission === "default") {
          await Notification.requestPermission();
        }
      } catch {
        /* */
      }
      if (data.vapid) {
        vapidRef.current = data.vapid;
        const ok = await bindPush(joinedName, data.token, data.vapid);
        if (ok) pushBoundRef.current = data.token;
      }
      clearPartyBadge();
      useMapStore.getState().setPartyInRoom(true);
      useMapStore.getState().setPartyCollapsed(false);
    } finally {
      setBusy(false);
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !joined) return;
    const who = nickRef.current || nick;
    const local: Msg = { id: -Date.now(), nick: who, body, at: new Date().toISOString() };
    setText("");
    setErr("");
    stickRef.current = true;
    setPending((rows) => [...rows, local]);
    const ship = async (tok: string) =>
      partyPost({ action: "send", room: joinedRef.current, token: tok, text: body });
    try {
      let { res, data } = await ship(tokenRef.current);
      if ((!res.ok || !data.ok) && passRef.current) {
        const again = await partyPost({
          action: "join",
          room: joinedRef.current,
          pass: passRef.current,
          nick: who,
          token: tokenRef.current,
        });
        if (again.res.ok && again.data.ok && again.data.token) {
          saveSession({
            room: again.data.name || joinedRef.current,
            token: again.data.token,
            nick: who,
            open: true,
            pass: passRef.current,
          });
          setToken(again.data.token);
          ({ res, data } = await ship(again.data.token));
        }
      }
      if (!res.ok || !data.ok) {
        if (data.error === "missing") {
          clearSession();
          setJoined("");
          setToken("");
          setState(null);
          setPending([]);
          setErr(t.partyMissing);
        }
        return;
      }
      setState(applyRoom(data));
      setPending((rows) => rows.filter((p) => p.id !== local.id));
    } catch {
      /* keep the local bubble; next poll will retry */
    }
  };

  const hide = () => {
    if (joined && token) {
      saveSession({
        room: joined,
        token,
        nick: nickRef.current || nick,
        open: false,
        pass: passRef.current,
      });
    }
    useMapStore.getState().setPartyMenuOpen(false);
  };

  const leave = () => {
    const roomName = joined;
    const tok = token;
    const who = nickRef.current || nick;
    if (roomName) {
      const body = JSON.stringify({ action: "leave", room: roomName, token: tok, nick: who, uid: userId() });
      try {
        navigator.sendBeacon("/api/party", new Blob([body], { type: "application/json" }));
      } catch {
        void partyPost({ action: "leave", room: roomName, token: tok, nick: who });
      }
    }
    saveLast(joined || room, passRef.current, nickRef.current || nick);
    clearSession();
    setJoined("");
    setToken("");
    setState(null);
    setPending([]);
    msgsRef.current = [];
    memsRef.current = [];
    clearedRef.current = 0;
    useMapStore.getState().setPartyCollapsed(false);
    useMapStore.getState().setPartyPins([]);
    useMapStore.getState().setPartyInRoom(false);
    useMapStore.getState().setPartyCollapsed(false);
    useMapStore.getState().selectMate(null);
    useMapStore.getState().setMateWalk(false);
    pinKeepRef.current = null;
    shareOffRef.current = false;
    clearPartyBadge();
  };

  const hostAct = async (action: "clear" | "sweep" | "disband") => {
    if (!joined || !token) return;
    const { res, data } = await partyPost({ action, room: joined, token, nick: nickRef.current || nick });
    if (!res.ok || !data.ok) return;
    if (data.gone || action === "disband") {
      saveLast(joined || room, passRef.current, nickRef.current || nick);
      clearSession();
      setJoined("");
      setToken("");
      setState(null);
      setPending([]);
      msgsRef.current = [];
      memsRef.current = [];
      clearedRef.current = 0;
      useMapStore.getState().setPartyCollapsed(false);
      useMapStore.getState().setPartyPins([]);
      useMapStore.getState().setPartyInRoom(false);
      useMapStore.getState().setPartyCollapsed(false);
      useMapStore.getState().selectMate(null);
      useMapStore.getState().setMateWalk(false);
      pinKeepRef.current = null;
      shareOffRef.current = false;
      clearPartyBadge();
      return;
    }
    setState(applyRoom(data));
    setPending([]);
  };

  const shareLoc = () => {
    if (!joined || !token || sharing) return;
    if (!navigator.geolocation) {
      setErr(t.partyShareFail);
      return;
    }
    setSharing(true);
    setErr("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        if (isInJapan(lng, lat)) useMapStore.getState().setUserLocation({ lng, lat }, "ok");
        const near = stationsNearPlace(useMapStore.getState().stationIndex, lng, lat, 1)[0]?.station.name ?? "";
        void (async () => {
          try {
            const { res, data } = await partyPost({
              action: "share",
              room: joinedRef.current,
              token: tokenRef.current,
              nick: nickRef.current || nick,
              lng: String(lng),
              lat: String(lat),
              near,
            });
            if (res.ok && data.ok) {
              shareOffRef.current = false;
              pinKeepRef.current = { lng, lat, near: near || undefined };
              setState(applyRoom(data));
              useMapStore.getState().setPartyCollapsed(true);
              if (isInJapan(lng, lat)) {
                useMapStore.getState().requestFlyTo({ lng, lat, zoom: 14.2, bearing: 0, pitch: 0.55, center: true });
              }
            }
          } finally {
            setSharing(false);
          }
        })();
      },
      () => {
        setSharing(false);
        setErr(t.partyShareFail);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 8000 },
    );
  };

  const lockMate = (m: Member) => {
    const lng = Number(m.lng);
    const lat = Number(m.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const s = useMapStore.getState();
    s.setPartyCollapsed(true);
    s.requestFlyTo({ lng, lat, bearing: 0, pitch: 0.55 });
  };

  const stopShare = async () => {
    if (!joined || !token) return;
    const { res, data } = await partyPost({
      action: "unshare",
      room: joinedRef.current,
      token: tokenRef.current,
      nick: nickRef.current || nick,
    });
    if (res.ok && data.ok) {
      shareOffRef.current = true;
      pinKeepRef.current = null;
      const mine = userId();
      if (Array.isArray(data.members)) {
        data.members = data.members.map((m) =>
          m.id === mine ? { ...m, lng: undefined, lat: undefined, near: undefined } : m,
        );
      }
      setState(applyRoom(data));
      useMapStore.getState().setPartyPins(useMapStore.getState().partyPins.filter((p) => !p.mine));
    }
  };

  const you = state?.you || nick;
  const meId = state?.youId || userId();
  const isHost = Boolean(state?.host);
  const members = foldMembers(state?.members ?? [], meId, you);
  const seats = state?.seats ?? 5;
  const qn = room.trim();
  const shownRooms = listed.slice().sort((a, b) => {
    if (!qn) return 0;
    const am = hanFold(a.name).includes(hanFold(qn)) || a.name.includes(qn) ? 0 : 1;
    const bm = hanFold(b.name).includes(hanFold(qn)) || b.name.includes(qn) ? 0 : 1;
    return am - bm;
  });
  const messages = [
    ...(state?.messages ?? []),
    ...pending.filter((p) => !(state?.messages ?? []).some((m) => m.body === p.body && (m.uid === meId || m.nick === p.nick))),
  ];

  const sharingMe = members.some((m) => m.id === meId && Number.isFinite(m.lng) && Number.isFinite(m.lat));

  if (joined && collapsed) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-bg/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center">
      <div className={`rpg-frame flex w-full max-w-md flex-col overflow-hidden ${joined ? "h-[min(78vh,36rem)]" : "max-h-[78vh]"}`}>
        <div className="flex items-center justify-between border-b-2 border-fg px-3 py-2.5">
          <p className="flex min-w-0 items-center gap-0.5 text-sm font-medium text-fg">
            {joined ? (
              <span className="truncate">
                {t.partyParty} · {joined}
                {state?.expiresAt ? (
                  <span className="ml-2 font-normal text-fg-muted">
                    {(() => {
                      const left = Math.max(0, state.expiresAt - Date.now());
                      const days = Math.floor(left / 86400000);
                      const hours = Math.max(1, Math.ceil(left / 3600000));
                      return days >= 1 ? t.partyTtlD.replace("{n}", String(days)) : t.partyTtlH.replace("{n}", String(hours));
                    })()}
                  </span>
                ) : null}
              </span>
            ) : (
              t.partyMenu
            )}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            {joined ? (
              <button
                type="button"
                className="rounded-full p-1 text-fg-muted"
                onClick={() => {
                  clearPartyBadge();
                  useMapStore.getState().setPartyCollapsed(true);
                }}
                aria-label={t.panelClose}
              >
                <ChevronDown className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                className="rounded-full p-1 text-fg-muted"
                onClick={hide}
                aria-label={t.close}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        {joined ? (
          <>
            <div className="shrink-0 border-b border-border px-3 py-2">
              <p className="mb-1.5 text-[11px] font-medium text-fg-muted">
                {t.partyMembers} · {t.partySeats.replace("{n}", String(members.length))}
              </p>
              <div className="flex items-stretch justify-between gap-1">
                {Array.from({ length: seats }, (_, i) => {
                  const m = members[i];
                  const mine = Boolean(m && m.id === meId);
                  const has = Boolean(m && Number.isFinite(m.lng) && Number.isFinite(m.lat));
                  const label = m?.near ? t.partyNear.replace("{n}", m.near) : t.partyNoPin;
                  return (
                    <div key={m?.id ?? `empty-${i}`} className={`rpg-slot min-h-[3.4rem] flex-col justify-center gap-0.5 ${mine ? "text-accent" : ""}`}>
                      {m ? (
                        <>
                          <span>
                            {m.nick}
                            {mine ? ` · ${t.partyYou}` : m.online === false ? ` · ${t.partyOffline}` : ""}
                          </span>
                          {has ? (
                            <button
                              type="button"
                              className="max-w-full truncate text-[10px] font-medium leading-tight text-fg-muted"
                              onClick={() => lockMate(m)}
                            >
                              {label}
                            </button>
                          ) : (
                            <span className="text-[10px] font-medium leading-tight text-fg-muted">{t.partyNoPin}</span>
                          )}
                          {mine && has ? (
                            <button type="button" className="text-[10px] font-medium leading-tight text-fg-muted" onClick={() => void stopShare()}>
                              {t.partyUnshare}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <span className="font-medium text-fg-muted">{t.partySlot}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              ref={logRef}
              data-tr={trTick}
              className="party-log min-h-[8rem] flex-1 overflow-y-scroll px-3 py-2"
              style={{ height: 0, WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
              onScroll={() => {
                const el = logRef.current;
                if (!el) return;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
            >
              {messages.length ? (
                <div className="flex flex-col gap-2">
                  {messages.map((row) => {
                    const mine = row.uid ? row.uid === meId : row.nick === you || row.nick === nick;
                    return (
                      <div key={row.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-[var(--radius-sm)] px-3 py-2 ${mine ? "bg-accent/15" : "bg-fg/5"}`}>
                          <p className={`text-[10px] font-medium text-fg-muted ${mine ? "text-right" : "text-left"}`}>{row.nick}</p>
                          <p className="text-sm text-fg">{shownChat(row, lang)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-fg-muted">{t.partyEmpty}</p>
              )}
            </div>
            <form onSubmit={(e) => void send(e)} className="flex shrink-0 flex-col gap-2 border-t-2 border-fg p-3">
              <div className="flex gap-2">
                <Input value={text} onChange={(e) => setText(e.target.value.slice(0, 160))} />
                <Button type="submit" disabled={!text.trim()}>
                  {t.partySend}
                </Button>
              </div>
              <button
                type="button"
                className="inline-flex min-h-10 w-full items-center justify-center rounded-[var(--radius-sm)] bg-fg/8 px-3 text-xs font-medium text-fg"
                onClick={() => (sharingMe ? void stopShare() : shareLoc())}
                disabled={sharing}
              >
                {sharing ? t.partySharing : sharingMe ? t.partyUnshare : t.partyShare}
              </button>
              <button
                type="button"
                className="inline-flex min-h-10 w-full items-center justify-center rounded-[var(--radius-sm)] bg-fg/8 px-3 text-xs font-medium text-fg"
                onClick={leave}
              >
                {t.partyLeave}
              </button>
              {err ? <p className="text-xs text-fg">{err}</p> : null}
              {isHost ? (
                <div className="flex gap-3">
                  <button type="button" className="self-start text-xs text-fg-muted" onClick={() => void hostAct("clear")}>
                    {t.partyClear}
                  </button>
                  <button type="button" className="self-start text-xs text-fg-muted" onClick={() => void hostAct("disband")}>
                    {t.partyDisband}
                  </button>
                </div>
              ) : null}
            </form>
          </>
        ) : (
          <form autoComplete="off" onSubmit={(e) => void enter(e)} className="relative flex flex-col gap-3 p-3">
            <div className="flex gap-1">
              <button
                type="button"
                className={`flex-1 rounded-[var(--radius-sm)] px-2 py-2 text-sm font-medium ${mode === "create" ? "bg-accent text-accent-fg" : "bg-fg/6 text-fg"}`}
                onClick={() => setMode("create")}
              >
                {t.partyCreate}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-[var(--radius-sm)] px-2 py-2 text-sm font-medium ${mode === "join" ? "bg-accent text-accent-fg" : "bg-fg/6 text-fg"}`}
                onClick={() => setMode("join")}
              >
                {t.partyJoin}
              </button>
            </div>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t.partyRoom}
              <Input
                name="jb-room-title"
                value={room}
                onChange={(e) => setRoom(e.target.value.slice(0, 20))}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </label>
            <p className="text-[11px] font-medium text-fg-muted">{t.partyOpenRooms}</p>
            {shownRooms.length ? (
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto overscroll-contain">
                {shownRooms.map((row) => (
                  <button
                    key={row.name}
                    type="button"
                    className={`rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm ${room === row.name ? "bg-accent text-accent-fg" : "bg-fg/8 text-fg"}`}
                    onClick={() => {
                      setRoom(row.name);
                      setMode("join");
                      const last = loadLast();
                      if (last && last.room === row.name && last.pass) setPass(last.pass);
                      if (last && last.room === row.name && realNick(last.nick)) setNick(last.nick);
                    }}
                  >
                    {row.name}
                    <span className="ml-2 text-xs opacity-70">{t.partySeats.replace("{n}", String(row.n))}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-fg-muted">{t.partyNoRooms}</p>
            )}
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t.partyPass}
              <Input
                type="text"
                name="jb-room-key"
                value={pass}
                onChange={(e) => setPass(e.target.value.slice(0, 32))}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                data-form-type="other"
                style={{ WebkitTextSecurity: "disc" }}
              />
              <span className="text-[11px] leading-snug">{t.partyPassHint}</span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-fg-muted">
              {t.partyNick}
              <Input
                name="jb-handle"
                value={nick}
                onChange={(e) => setNick(e.target.value.slice(0, 12))}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
              />
            </label>
            <Button type="submit" disabled={busy}>
              {t.partyGo}
            </Button>
            {err ? <p className="text-xs text-fg">{err}</p> : null}
          </form>
        )}
      </div>
    </div>
  );
}

export function MateBar() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const mate = useMapStore((s) => s.selectedMate);
  const walking = useMapStore((s) => s.mateWalk);
  const [routing, setRouting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    setRouting(false);
    setToast(null);
  }, [mate?.id]);
  if (!mate) return null;
  const goRoute = async () => {
    setRouting(true);
    useMapStore.getState().setMateWalk(true);
    const ok = await applyMateTrip(mate);
    setRouting(false);
    if (!ok) setToast(t.noNearStation);
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto relative mx-auto flex w-full max-w-md gap-2">
        <button
          type="button"
          className="absolute -top-2 right-0 z-10 flex size-8 items-center justify-center rounded-full bg-surface text-fg-muted shadow-[var(--shadow-border)]"
          aria-label={t.close}
          onClick={() => {
            const s = useMapStore.getState();
            s.selectMate(null);
            s.setMateWalk(false);
            s.clearTrip();
          }}
        >
          <X className="size-4" />
        </button>
        <button
          type="button"
          className={`inline-flex h-12 min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium shadow-[var(--shadow-border)] ${walking ? "bg-accent/15 text-accent" : "bg-surface text-fg"}`}
          onClick={() => void goRoute()}
          disabled={routing}
        >
          <Navigation className="size-4" />
          {routing ? t.searching : t.stayGuide}
        </button>
      </div>
      {toast ? <p className="pointer-events-auto mx-auto mt-2 max-w-md rounded-[var(--radius-md)] bg-surface px-3 py-2 text-center text-xs text-fg shadow-[var(--shadow-border)]">{toast}</p> : null}
    </div>
  );
}
