import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, MessageCircle, Navigation, Store, X } from "lucide-react";
import { copies } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore } from "@/store/map-store";
import { locateUser } from "@/components/app/search-panel";
import { NODA } from "@/lib/rail/geo";
import { openLayer } from "@/lib/menu-view";
import {
  insideKonbiniFence,
  konbiniLabel,
  konbiniRingM,
  metersTo,
  pullKonbini,
  storesOfBrand,
  KONBINI_BRANDS,
  KONBINI_CHAT_M,
  KONBINI_META,
  type KonbiniBrand,
  type KonbiniStore,
} from "@/lib/konbini";

export function focusKonbini(store: KonbiniStore) {
  const s = useMapStore.getState();
  if (s.selectedKonbini?.id === store.id) {
    s.selectKonbini(null);
    return;
  }
  s.selectTrain(null);
  s.setFollowTrainId(null);
  s.selectStation(null);
  s.selectStay(null);
  s.selectKonbini(store);
  s.setKonbiniChat(true);
  s.setShopChatCollapsed(false);
  s.requestFlyTo({ lng: store.lng, lat: store.lat, zoom: 16.2, bearing: 0, pitch: 0.55 });
}

export function pickKonbiniBrand(brand: KonbiniBrand) {
  const s = useMapStore.getState();
  openLayer("stay");
  s.setKonbiniBrand(brand);
  s.selectKonbini(null);
  const loc = s.userLocation ?? NODA;
  s.requestFlyTo({ lng: loc.lng, lat: loc.lat, bearing: 0, pitch: 0.55 });
  if (s.locateStatus !== "ok") locateUser(false);
}

export function openKonbiniLayer() {
  const s = useMapStore.getState();
  openLayer("stay");
  if (!s.konbiniBrand) s.setKonbiniBrand("all");
  const loc = s.userLocation ?? NODA;
  s.requestFlyTo({ lng: loc.lng, lat: loc.lat, bearing: 0, pitch: 0.55 });
  if (s.locateStatus !== "ok") locateUser(false);
}

type ChatMsg = { id: number; nick: string; body: string; created_at: string; uid?: string };
type ChatPerson = { id: string; nick: string };

function shopUid() {
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

function shopNickMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem("jb-shop-nicks");
    const v = raw ? (JSON.parse(raw) as unknown) : {};
    if (!v || typeof v !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const name = String(n ?? "").trim().slice(0, 16);
      if (k && name && !["ゲスト", "旅人", "Traveler"].includes(name) && !/^ゲスト\d+$/u.test(name)) out[k] = name;
    }
    return out;
  } catch {
    return {};
  }
}

function shopNickOf(storeId: string) {
  const map = shopNickMap();
  return map[storeId] || "";
}

function rememberShopNick(storeId: string, nick: string) {
  const name = nick.trim().slice(0, 16);
  if (!storeId || !name || ["ゲスト", "旅人", "Traveler"].includes(name) || /^ゲスト\d+$/u.test(name)) return;
  try {
    const map = shopNickMap();
    map[storeId] = name;
    localStorage.setItem("jb-shop-nicks", JSON.stringify(map));
  } catch {
    /* */
  }
}

export function ShopChat({
  open,
  storeId,
  title,
  lng,
  lat,
  onClose,
}: {
  open: boolean;
  storeId: string;
  title: string;
  lng: number;
  lat: number;
  onClose: () => void;
}) {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const loc = useMapStore((s) => s.userLocation);
  const gpsOk = useMapStore((s) => s.locateStatus) === "ok";
  const collapsed = useMapStore((s) => s.shopChatCollapsed);
  const [nick, setNick] = useState(() => shopNickOf(storeId));
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ChatMsg[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const meId = shopUid();
  const nickRef = useRef(nick);
  nickRef.current = nick;
  const inside = insideKonbiniFence({ lng, lat }, loc);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNick(shopNickOf(storeId));
    setErr("");
    setRows([]);
    setPeople([]);
  }, [storeId]);

  const apply = (data: { messages?: ChatMsg[]; members?: ChatPerson[] }) => {
    if (Array.isArray(data.messages)) {
      setRows((prev) => {
        const next = data.messages!.slice(-30);
        return next.length >= prev.length ? next : prev;
      });
    }
    if (Array.isArray(data.members)) setPeople(data.members);
  };

  const post = (action: "beat" | "send" | "leave", body = "") => {
    const here = useMapStore.getState().userLocation;
    return fetch("/api/konbini/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        store: storeId,
        nick: nickRef.current.trim().slice(0, 16),
        text: body,
        uid: meId,
        lng: here?.lng,
        lat: here?.lat,
        storeLng: lng,
        storeLat: lat,
      }),
    });
  };

  useEffect(() => {
    if (!open || !storeId) return;
    let live = true;
    const tick = async () => {
      try {
        const s = useMapStore.getState();
        const here = s.userLocation;
        const gps = s.locateStatus === "ok";
        const inFence = insideKonbiniFence({ lng, lat }, here);
        if (gps && inFence) {
          const res = await post("beat");
          const data = (await res.json()) as { messages?: ChatMsg[]; members?: ChatPerson[]; error?: string; nick?: string };
          if (!live) return;
          if (res.status === 409) {
            if (data.error === "nickkeep") {
              const keep = String(data.nick || shopNickOf(storeId) || "").trim();
              if (keep) {
                setNick(keep);
                nickRef.current = keep;
                rememberShopNick(storeId, keep);
              }
              setErr(t.konbiniNickKeep.replace("{n}", keep || "—"));
              return;
            }
            setErr(t.konbiniNickTaken);
            return;
          }
          if (res.status === 403) {
            setPeople([]);
            return;
          }
          apply(data);
          setErr("");
        } else {
          const data = (await fetch(`/api/konbini/chat?store=${encodeURIComponent(storeId)}`).then((r) => r.json())) as {
            messages?: ChatMsg[];
            members?: ChatPerson[];
          };
          if (!live) return;
          apply(data);
        }
      } catch {
        /* */
      }
    };
    void tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [open, storeId, lng, lat, t.konbiniNickKeep, t.konbiniNickTaken]);

  useEffect(() => {
    if (!open || !storeId) return;
    return () => {
      void post("leave");
    };
  }, [open, storeId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, open]);

  if (!open || collapsed) return null;
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!gpsOk) {
      setErr(t.konbiniNeedGps);
      locateUser(false);
      return;
    }
    if (!inside) {
      setErr(t.konbiniTooFar.replace("{m}", String(KONBINI_CHAT_M)));
      return;
    }
    const body = text.trim();
    if (!body) return;
    const name = nick.trim();
    if (!name) {
      setErr(t.konbiniNeedNick);
      return;
    }
    setBusy(true);
    setErr("");
    nickRef.current = name;
    const pending: ChatMsg = { id: Date.now(), nick: name, body, created_at: new Date().toISOString(), uid: meId };
    setRows((prev) => [...prev, pending].slice(-30));
    setText("");
    setPeople((prev) => (prev.some((p) => p.id === meId) ? prev : [...prev, { id: meId, nick: name }]));
    try {
      const res = await post("send", body);
      const data = (await res.json()) as { messages?: ChatMsg[]; members?: ChatPerson[]; error?: string; nick?: string };
      if (res.status === 403) {
        setRows((prev) => prev.filter((m) => m.id !== pending.id));
        setErr(t.konbiniTooFar.replace("{m}", String(KONBINI_CHAT_M)));
        return;
      }
      if (res.status === 409) {
        setRows((prev) => prev.filter((m) => m.id !== pending.id));
        if (data.error === "nickkeep") {
          const keep = String(data.nick || shopNickOf(storeId) || "").trim();
          if (keep) {
            setNick(keep);
            nickRef.current = keep;
            rememberShopNick(storeId, keep);
          }
          setErr(t.konbiniNickKeep.replace("{n}", keep || "—"));
          return;
        }
        setErr(t.konbiniNickTaken);
        return;
      }
      if (!res.ok) {
        setRows((prev) => prev.filter((m) => m.id !== pending.id));
        setErr(t.reserveFail);
        return;
      }
      rememberShopNick(storeId, name);
      apply(data);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-bg/45 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center">
      <div className="flex max-h-[78vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="truncate text-sm font-medium text-fg">{title}</p>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="rounded-full p-1 text-fg-muted"
              onClick={() => useMapStore.getState().setShopChatCollapsed(true)}
              aria-label={t.panelClose}
            >
              <ChevronDown className="size-4" />
            </button>
            <button type="button" className="rounded-full p-1 text-fg-muted" onClick={onClose} aria-label={t.close}>
              <X className="size-4" />
            </button>
          </div>
        </div>
        <p className="px-3 pt-2 text-[11px] text-fg-muted">{gpsOk && inside ? t.konbiniInRange : t.konbiniTooFar.replace("{m}", String(KONBINI_CHAT_M))}</p>
        <p className="px-3 pt-1 text-[11px] font-medium text-fg-muted">{t.konbiniOnline.replace("{n}", String(people.length))}</p>
        {people.length ? (
          <p className="truncate px-3 pb-1 text-[11px] text-fg">{people.map((p) => p.nick).join(" · ")}</p>
        ) : null}
        <div ref={logRef} className="flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
          {rows.length ? (
            rows.map((row) => {
              const mine = row.uid ? row.uid === meId : row.nick === nick;
              return (
                <div key={`${row.id}-${row.created_at}`} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-[var(--radius-sm)] px-3 py-2 ${mine ? "bg-accent/15" : "bg-fg/5"}`}>
                    <p className={`text-[10px] font-medium text-fg-muted ${mine ? "text-right" : "text-left"}`}>{row.nick}</p>
                    <p className="text-sm text-fg">{row.body}</p>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="py-6 text-center text-xs text-fg-muted">{t.konbiniEmpty}</p>
          )}
        </div>
        <form onSubmit={(e) => void send(e)} className="flex flex-col gap-2 border-t border-border p-3">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            {t.konbiniNick}
            <Input value={nick} onChange={(e) => setNick(e.target.value.slice(0, 16))} className="h-9" placeholder="" />
          </label>
          <div className="flex gap-2">
            <Input value={text} onChange={(e) => setText(e.target.value.slice(0, 160))} disabled={!inside || !gpsOk} />
            <Button type="submit" disabled={busy || !inside || !gpsOk || !text.trim() || !nick.trim()}>
              {t.konbiniSend}
            </Button>
          </div>
          {err ? <p className="text-xs text-fg">{err}</p> : null}
        </form>
      </div>
    </div>
  );
}

export function KonbiniBrandList() {
  const lang = useMapStore((s) => s.lang);
  const brand = useMapStore((s) => s.konbiniBrand);
  return (
    <div>
      {KONBINI_BRANDS.map((id) => {
        const meta = KONBINI_META[id];
        const on = brand === id;
        const label = lang === "zh" ? meta.zh : lang === "en" ? meta.en : meta.ja;
        return (
          <button
            key={id}
            type="button"
            className={`flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-left text-sm font-medium hover:bg-fg/6 ${on ? "bg-fg/8 text-accent" : "text-fg"}`}
            onClick={() => pickKonbiniBrand(id)}
          >
            <span className="inline-flex size-5 items-center justify-center rounded-full text-[10px] font-black text-white" style={{ background: meta.color }}>
              {meta.short}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function KonbiniBubble() {
  const lang = useMapStore((s) => s.lang);
  const store = useMapStore((s) => s.selectedKonbini);
  const screen = useMapStore((s) => s.konbiniScreen);
  const loc = useMapStore((s) => s.userLocation);
  if (!store || !screen) return null;
  const meta = KONBINI_META[store.brand];
  const m = metersTo(store, loc);
  const left = Math.min(Math.max(screen.x, 22), typeof window !== "undefined" ? window.innerWidth - 22 : screen.x);
  const placeAbove = screen.y > 40;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        className="pointer-events-auto absolute"
        style={{
          left,
          top: screen.y,
          transform: placeAbove ? "translate(-50%, calc(-100% - 14px))" : "translate(-50%, 18px)",
        }}
      >
        <article className="w-[220px] overflow-hidden rounded-[var(--radius-md)] bg-surface shadow-[var(--shadow-border)]">
          <div className="flex items-start gap-2 px-3 py-2.5">
            <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: meta.color }}>
              {meta.short}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg">{konbiniLabel(store, lang)}</p>
              <p className="text-[11px] text-fg-muted">{Number.isFinite(m) && m < 1e8 ? `${Math.round(m)}m` : store.address}</p>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}

export function KonbiniBar() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const store = useMapStore((s) => s.selectedKonbini);
  const walking = useMapStore((s) => s.konbiniWalk);
  if (!store) return null;
  const goRoute = () => {
    const s = useMapStore.getState();
    const here = s.userLocation ?? NODA;
    s.setKonbiniWalk(true);
    s.setKonbiniChat(false);
    s.requestFlyTo({ lng: here.lng, lat: here.lat, bearing: 0, pitch: 0.5 });
  };
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto relative mx-auto flex w-full max-w-md gap-2">
          <button
            type="button"
            className="absolute -top-2 right-0 z-10 flex size-8 items-center justify-center rounded-full bg-surface text-fg-muted shadow-[var(--shadow-border)]"
            aria-label={t.close}
            onClick={() => {
              const s = useMapStore.getState();
              s.selectKonbini(null);
              s.setKonbiniWalk(false);
              s.setKonbiniChat(false);
            }}
          >
            <X className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-12 min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-accent px-3 text-sm font-medium text-accent-fg"
            onClick={() => {
              const s = useMapStore.getState();
              s.setKonbiniChat(true);
              s.setShopChatCollapsed(false);
            }}
          >
            <MessageCircle className="size-4" />
            {t.konbiniChat}
          </button>
          <button
            type="button"
            className={`inline-flex h-12 min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 text-sm font-medium shadow-[var(--shadow-border)] ${walking ? "bg-accent/15 text-accent" : "bg-surface text-fg"}`}
            onClick={goRoute}
          >
            <Navigation className="size-4" />
            {t.stayGuide}
          </button>
        </div>
      </div>
    </>
  );
}

export function ShopCommunityButton() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const shopOpen = useMapStore((s) => s.konbiniChat || s.stayChat);
  const collapsed = useMapStore((s) => s.shopChatCollapsed);
  if (!shopOpen || !collapsed) return null;
  return (
    <button
      type="button"
      className={`inline-flex min-h-36 w-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium text-accent shadow-[var(--shadow-border)] [writing-mode:vertical-rl] ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
      onClick={() => useMapStore.getState().setShopChatCollapsed(false)}
    >
      {t.shopCommunity}
    </button>
  );
}

export function KonbiniChat() {
  const lang = useMapStore((s) => s.lang);
  const store = useMapStore((s) => s.selectedKonbini);
  const open = useMapStore((s) => s.konbiniChat);
  if (!open || !store) return null;
  return (
    <ShopChat
      open={open}
      storeId={store.id}
      title={konbiniLabel(store, lang)}
      lng={store.lng}
      lat={store.lat}
      onClose={() => useMapStore.getState().setKonbiniChat(false)}
    />
  );
}

export function KonbiniLoadingChip() {
  const lang = useMapStore((s) => s.lang);
  const brand = useMapStore((s) => s.konbiniBrand);
  const loading = useMapStore((s) => s.konbiniLoading);
  const loc = useMapStore((s) => s.userLocation);
  const nearest = useMapStore((s) => s.nearestStations);
  useEffect(() => {
    if (!brand) return;
    const here = loc ?? NODA;
    const ring = konbiniRingM(here, useMapStore.getState().stationIndex, nearest);
    useMapStore.getState().setKonbiniLoading(true);
    pullKonbini(here.lng, here.lat, ring, brand, (rows, done) => {
      const s = useMapStore.getState();
      if (s.konbiniBrand !== brand) return;
      s.setKonbiniStores(rows.length ? rows : storesOfBrand(s.konbiniStores, brand));
      s.setKonbiniLoading(!done);
    });
  }, [brand, loc?.lng, loc?.lat, nearest[0]?.km]);
  if (!brand || !loading) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] z-20 flex justify-center">
      <p className="rounded-full bg-surface/94 px-3 py-1.5 text-xs text-fg shadow-[var(--shadow-border)] backdrop-blur-md">
        <Store className="mr-1 inline size-3.5" />
        {copies[lang].konbiniLoading}
      </p>
    </div>
  );
}
