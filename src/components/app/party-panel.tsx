import { Component, FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { copies } from "@/lib/i18n";
import { hanFold } from "@/lib/han";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore } from "@/store/map-store";

type Member = { id: string; nick: string; online?: boolean; host?: boolean };
type Msg = { id: number; nick: string; body: string; at: string; uid?: string };
type RoomState = { name: string; members: Member[]; messages: Msg[]; seats: number; you?: string; youId?: string; host?: boolean; hostId?: string };

function foldMembers(list: Member[], meId: string, you: string) {
  const me = you.trim();
  const aliases = new Set(
    myNicks()
      .concat(you)
      .concat(["ゲスト", "旅人", "Traveler"])
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const best = new Map<string, Member>();
  for (const m of list) {
    const k = (m.nick || m.id || "").trim();
    if (!k) continue;
    const prev = best.get(k);
    if (!prev) {
      best.set(k, m);
      continue;
    }
    const score = (x: Member) => (x.id === meId || x.nick === you ? 8 : 0) + (x.online === true ? 2 : 0);
    if (score(m) >= score(prev)) best.set(k, m);
  }
  const renamed = Boolean(me && !["ゲスト", "旅人", "Traveler"].includes(me));
  return [...best.values()].filter((m) => {
    if (m.id === meId || (m.nick || "").trim() === me) return true;
    if (m.online === false) return false;
    const nick = (m.nick || "").trim();
    const away = m.online !== true;
    if (away && aliases.has(nick)) return false;
    if (renamed && away && (nick === "ゲスト" || nick === "旅人" || nick === "Traveler")) return false;
    return true;
  });
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

function nickOf(lang: "ja" | "zh" | "en") {
  try {
    const saved = sessionStorage.getItem("jb-party-nick");
    if (saved) return saved.slice(0, 12);
  } catch {
    /* */
  }
  return lang === "zh" ? "旅人" : lang === "en" ? "Traveler" : "ゲスト";
}

type Session = { room: string; token: string; nick: string; open?: boolean };

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

async function partyPost(body: Record<string, string>) {
  const was = myNicks()
    .filter((n) => n && n !== body.nick)
    .join(",");
  const res = await fetch("/api/party", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, uid: userId(), ...(was ? { was } : {}) }),
  });
  const data = (await res.json()) as RoomState & { ok?: boolean; error?: string; token?: string; gone?: boolean };
  return { res, data };
}

export function PartyButton() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const open = useMapStore((s) => s.partyMenuOpen);
  return (
    <button
      type="button"
      className={`inline-flex min-h-36 w-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium shadow-[var(--shadow-border)] backdrop-blur-md [writing-mode:vertical-rl] ${open ? "text-accent" : "text-fg"} ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
      onClick={() => useMapStore.getState().setPartyMenuOpen(!open)}
    >
      {t.partyMenu}
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
  const [nick, setNick] = useState(() => nickOf(lang));
  const [token, setToken] = useState("");
  const [joined, setJoined] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [listed, setListed] = useState<{ name: string; n: number; seats: number }[]>([]);
  const [pending, setPending] = useState<Msg[]>([]);
  const [state, setState] = useState<RoomState | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const passRef = useRef(pass);
  const nickRef = useRef(nick);
  const joinedRef = useRef(joined);
  const tokenRef = useRef(token);
  passRef.current = pass;
  nickRef.current = nick;
  joinedRef.current = joined;
  tokenRef.current = token;

  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;
    setRoom(saved.room);
    if (saved.nick) setNick(saved.nick);
  }, []);

  useEffect(() => {
    const bye = (e: PageTransitionEvent) => {
      if (e.persisted) return;
      const room = joinedRef.current;
      const tok = tokenRef.current;
      if (!room || !tok) return;
      const body = JSON.stringify({ action: "leave", room, token: tok, uid: userId(), nick: nickRef.current });
      try {
        navigator.sendBeacon("/api/party", new Blob([body], { type: "application/json" }));
      } catch {
        void fetch("/api/party", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
      }
      clearSession();
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
    const id = window.setInterval(load, 1800);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [open, joined]);

  useEffect(() => {
    if (!joined || !token) return;
    let live = true;
    const resume = async () => {
      const key = passRef.current;
      const who = nickRef.current || nickOf(lang);
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
      });
      setToken(data.token);
      setJoined(data.name || joinedRef.current);
      setState(data);
      return true;
    };
    const pull = async () => {
      try {
        const res = await fetch(
          `/api/party?room=${encodeURIComponent(joinedRef.current)}&token=${encodeURIComponent(tokenRef.current)}&uid=${encodeURIComponent(userId())}&was=${encodeURIComponent(myNicks().filter((n) => n && n !== nickRef.current).join(","))}`,
        );
        const data = (await res.json()) as RoomState & { ok?: boolean; error?: string };
        if (!live) return;
        if (res.ok && data.ok !== false) {
          setState(data);
          setPending((rows) => {
            if (!(data.messages?.length)) return [];
            return rows.filter((p) => !data.messages?.some((m) => m.body === p.body && (m.uid === userId() || m.nick === p.nick)));
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
          setRoom("");
          setPass("");
          return;
        }
        await resume();
      } catch {
        /* stay in the room across blips / app switches */
      }
    };
    void pull();
    const id = window.setInterval(pull, 2000);
    const onShow = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      live = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [joined, token, lang, t.partyFull]);

  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [state?.messages.length]);

  const sawOpenRef = useRef(false);
  useEffect(() => {
    if (!sawOpenRef.current) {
      sawOpenRef.current = true;
      return;
    }
    const saved = loadSession();
    if (!saved?.token) return;
    saveSession({ ...saved, open });
  }, [open]);

  if (!open) return null;

  const fail = (code?: string) => {
    if (code === "full") setErr(t.partyFull);
    else if (code === "pass") setErr(t.partyBadPass);
    else if (code === "missing") {
      if (!joinedRef.current) setErr(t.partyMissing);
    } else if (code === "exists") setErr(t.partyExists);
    else if (code === "nick") setErr(t.partyNickTaken);
    else if (code === "need") setErr(t.partyNeed);
    else if (code) setErr(t.reserveFail);
  };

  const enter = async (e: FormEvent) => {
    e.preventDefault();
    if (!room.trim() || !pass.trim()) {
      setErr(t.partyNeed);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      let { res, data } = await partyPost({
        action: mode,
        room: room.trim(),
        pass: pass.trim(),
        nick: nick.trim() || nickOf(lang),
        token: tokenRef.current,
      });
      if (!res.ok || !data.ok || !data.token) {
        fail(data.error);
        return;
      }
      const who = nick.trim() || nickOf(lang);
      const roomName = data.name || room.trim();
      saveSession({ room: roomName, token: data.token, nick: who, open: true });
      setNick(who);
      setToken(data.token);
      setJoined(roomName);
      setState(data);
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
          });
          setToken(again.data.token);
          ({ res, data } = await ship(again.data.token));
        }
      }
      if (!res.ok || !data.ok) return;
      setState(data);
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
      });
    }
    useMapStore.getState().setPartyMenuOpen(false);
  };

  const leave = () => {
    if (joined && token) void partyPost({ action: "leave", room: joined, token, nick: nickRef.current || nick });
    clearSession();
    setJoined("");
    setToken("");
    setRoom("");
    setPass("");
    setState(null);
    setPending([]);
    useMapStore.getState().setPartyMenuOpen(false);
  };

  const hostAct = async (action: "clear" | "sweep" | "disband") => {
    if (!joined || !token) return;
    const { res, data } = await partyPost({ action, room: joined, token, nick: nickRef.current || nick });
    if (!res.ok || !data.ok) return;
    if (data.gone || action === "disband") {
      clearSession();
      setJoined("");
      setToken("");
      setState(null);
      setPending([]);
      useMapStore.getState().setPartyMenuOpen(false);
      return;
    }
    setState(data);
    setPending([]);
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

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-bg/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center">
      <div className={`rpg-frame flex w-full max-w-md flex-col overflow-hidden ${joined ? "h-[min(78vh,36rem)]" : "max-h-[78vh]"}`}>
        <div className="flex items-center justify-between border-b-2 border-fg px-3 py-2.5">
          <p className="flex min-w-0 items-center gap-0.5 text-sm font-medium text-fg">
            {joined ? (
              <span className="truncate">
                {t.partyParty} · {joined}
              </span>
            ) : (
              t.partyMenu
            )}
          </p>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 text-fg-muted"
            onClick={joined ? leave : hide}
            aria-label={t.close}
          >
            <X className="size-4" />
          </button>
        </div>

        {joined ? (
          <>
            <div className="border-b border-border px-3 py-2">
              <p className="mb-1.5 text-[11px] font-medium text-fg-muted">
                {t.partyMembers} · {t.partySeats.replace("{n}", String(members.length))}
              </p>
              <div className="flex items-stretch justify-between gap-1">
                {Array.from({ length: seats }, (_, i) => {
                  const m = members[i];
                  const mine = Boolean(m && m.id === meId);
                  return (
                    <div key={m?.id ?? `empty-${i}`} className={`rpg-slot ${mine ? "text-accent" : ""}`}>
                      {m ? (
                        <span>
                          {m.nick}
                          {mine ? ` · ${t.partyYou}` : ""}
                        </span>
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
              className="min-h-0 flex-1 overflow-y-scroll overscroll-contain px-3 py-2 [-webkit-overflow-scrolling:touch]"
              onScroll={() => {
                const el = logRef.current;
                if (!el) return;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
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
                          <p className="text-sm text-fg">{row.body}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-fg-muted">{t.partyEmpty}</p>
              )}
            </div>
            <form onSubmit={(e) => void send(e)} className="flex flex-col gap-2 border-t-2 border-fg p-3">
              <div className="flex gap-2">
                <Input value={text} onChange={(e) => setText(e.target.value.slice(0, 160))} />
                <Button type="submit" disabled={!text.trim()}>
                  {t.partySend}
                </Button>
              </div>
              {err ? <p className="text-xs text-fg">{err}</p> : null}
              {isHost ? (
                <button type="button" className="self-start text-xs text-fg-muted" onClick={() => void hostAct("clear")}>
                  {t.partyClear}
                </button>
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
                    }}
                  >
                    {row.name}
                    <span className="ml-2 text-xs opacity-70">
                      {row.n}/{row.seats}
                    </span>
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
