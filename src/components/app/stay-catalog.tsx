import { FormEvent, useEffect, useState } from "react";
import { CalendarClock, ChevronUp, MessageCircle, Navigation, Phone, UtensilsCrossed, X } from "lucide-react";
import { CHIBA_VIEW, STAYS, stayAddress, stayKind, stayLabel, stayRegion, type Stay } from "@/data/stays";
import { applyStayTrip } from "@/components/app/search-panel";
import { KonbiniBrandList, openKonbiniLayer, ShopChat } from "@/components/app/konbini-panel";
import { copies } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMapStore } from "@/store/map-store";
import { closeLayer, openLayer } from "@/lib/menu-view";

export function focusStay(stay: Stay) {
  const s = useMapStore.getState();
  if (s.selectedStay?.id === stay.id) {
    s.selectStay(null);
    return;
  }
  s.selectTrain(null);
  s.setFollowTrainId(null);
  s.selectStation(null);
  s.selectStay(stay);
  s.setStayLayer(true);
  s.setStayWalk(false);
  s.requestFlyTo({
    lng: CHIBA_VIEW.lng,
    lat: CHIBA_VIEW.lat,
    zoom: CHIBA_VIEW.zoom,
    bearing: 0,
    pitch: 0.62,
  });
}

export function closeStay() {
  useMapStore.getState().selectStay(null);
}

async function sendReserve(payload: {
  shop: string;
  name: string;
  contact: string;
  date: string;
  time: string;
  guests: string;
  note: string;
}) {
  const subject = `【JB map新预约】目标店铺：${payload.shop} | 预约时间：${payload.date} ${payload.time} | 客户信息：${payload.name}`;
  const message = [
    `目标店铺：${payload.shop}`,
    `预约时间：${payload.date} ${payload.time}`,
    `人数：${payload.guests}`,
    `客户姓名：${payload.name}`,
    `联系方式：${payload.contact}`,
    `备注：${payload.note || "（无）"}`,
  ].join("\n");
  const fd = new FormData();
  fd.append("_subject", subject);
  fd.append("_template", "table");
  fd.append("_captcha", "false");
  fd.append("shop", payload.shop);
  fd.append("name", payload.name);
  fd.append("contact", payload.contact);
  fd.append("date", payload.date);
  fd.append("time", payload.time);
  fd.append("guests", payload.guests);
  fd.append("note", payload.note || "（无）");
  fd.append("message", message);
  try {
    const direct = await fetch("https://formsubmit.co/ajax/zhangj31095@gmail.com", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: fd,
    });
    const json = (await direct.json()) as { success?: boolean | string; message?: string };
    if (json.success === true || json.success === "true") return "ok" as const;
    if (String(json.message ?? "").toLowerCase().includes("confirm") || String(json.message ?? "").toLowerCase().includes("activation")) {
      return "ok" as const;
    }
  } catch {
    /* fall through */
  }
  const res = await fetch("/api/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { ok?: boolean };
  if (res.ok && json.ok) return "ok" as const;
  return "fail" as const;
}

export function StayCatalog() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const selected = useMapStore((s) => s.selectedStay);
  const stayLayer = useMapStore((s) => s.stayLayer);
  const open = useMapStore((s) => s.stayMenuOpen);
  const [groupOpen, setGroupOpen] = useState(false);
  const [konbiniOpen, setKonbiniOpen] = useState(false);
  const konbiniBrand = useMapStore((s) => s.konbiniBrand);
  useEffect(() => {
    if (selected || stayLayer) {
      useMapStore.getState().exclusiveOpen("stay");
      setGroupOpen(true);
    }
  }, [selected, stayLayer]);
  useEffect(() => {
    if (konbiniBrand) {
      useMapStore.getState().exclusiveOpen("stay");
      setKonbiniOpen(true);
    } else {
      setKonbiniOpen(false);
    }
  }, [konbiniBrand]);

  return (
    <div className="flex flex-row items-start gap-1">
      <button
        type="button"
        className={`inline-flex min-h-36 w-11 items-center justify-center rounded-[var(--radius-md)] bg-surface/94 py-3 text-xs font-medium text-fg shadow-[var(--shadow-border)] backdrop-blur-md [writing-mode:vertical-rl] ${lang === "zh" ? "tracking-normal" : "tracking-[0.18em]"}`}
        onClick={() => {
          if (open) closeLayer("stay");
          else openLayer("stay");
        }}
      >
        {t.stayIndex}
      </button>
      {open ? (
        <div className="w-44 overflow-hidden rounded-[var(--radius-md)] bg-surface/96 shadow-[var(--shadow-border)] backdrop-blur-md">
          <div>
            <button
              type="button"
              className={`flex w-full items-center justify-between gap-1 px-3 py-2.5 text-left text-xs font-medium ${stayLayer ? "text-accent" : "text-fg"}`}
              onClick={() => {
                const next = !groupOpen;
                setGroupOpen(next);
                if (STAYS.length) useMapStore.getState().setStayLayer(next);
              }}
            >
              {t.stayGroup}
              <ChevronUp className={`size-3.5 text-fg-muted transition-transform ${groupOpen ? "" : "rotate-180"}`} />
            </button>
            {groupOpen
              ? STAYS.map((stay) => (
                  <button
                    key={stay.id}
                    type="button"
                    className={`flex w-full border-t border-border px-3 py-2.5 text-left text-sm font-medium hover:bg-fg/6 ${selected?.id === stay.id ? "bg-fg/8 text-accent" : "text-fg"}`}
                    onClick={() => focusStay(stay)}
                  >
                    {stayLabel(stay, lang)}
                  </button>
                ))
              : null}
          </div>
          <div className="border-t border-border">
            <button
              type="button"
              className={`flex w-full items-center justify-between gap-1 px-3 py-2.5 text-left text-xs font-medium ${konbiniBrand ? "text-accent" : "text-fg"}`}
              onClick={() => {
                setKonbiniOpen((v) => {
                  const next = !v;
                  if (next) openKonbiniLayer();
                  else {
                    const s = useMapStore.getState();
                    s.setKonbiniBrand(null);
                    s.selectKonbini(null);
                    s.setKonbiniStores([]);
                    s.setKonbiniWalk(false);
                    s.setKonbiniChat(false);
                  }
                  return next;
                });
              }}
            >
              {t.konbiniGroup}
              <ChevronUp className={`size-3.5 text-fg-muted transition-transform ${konbiniOpen ? "" : "rotate-180"}`} />
            </button>
            {konbiniOpen ? <KonbiniBrandList /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function StayBubble() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const stay = useMapStore((s) => s.selectedStay);
  const screen = useMapStore((s) => s.stayScreen);
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState(0);
  useEffect(() => {
    setOpen(false);
    setShot(0);
  }, [stay?.id]);
  if (!stay || !screen) return null;
  const media = stay.photos ?? [];
  const photo = media[Math.min(shot, Math.max(0, media.length - 1))];
  const left = Math.min(
    Math.max(screen.x, open ? 148 : 22),
    typeof window !== "undefined" ? window.innerWidth - (open ? 148 : 22) : screen.x,
  );
  const placeAbove = screen.y > (open ? 280 : 40);
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
        {open ? (
          <article className="w-[276px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-border)]">
            <div className="relative h-40 bg-bg-subtle">
              {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : null}
              <button
                type="button"
                className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-surface/90 text-fg shadow-[var(--shadow-border)]"
                aria-label={t.close}
                onClick={() => setOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            {media.length > 1 ? (
              <div className="flex gap-1 overflow-x-auto px-2 pt-2">
                {media.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    className={`h-9 w-12 shrink-0 overflow-hidden rounded-[var(--radius-xs)] ${shot === i ? "ring-2 ring-accent" : "opacity-80"}`}
                    onClick={() => setShot(i)}
                  >
                    <img src={src} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
            <div className="px-3 py-2.5">
              <p className="text-sm leading-snug font-medium text-fg">{stayLabel(stay, lang)}</p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {stayRegion(stay, lang)} · {stayKind(stay, lang)}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-fg">{stayAddress(stay, lang)}</p>
              {stay.phone ? (
                <a href={`tel:${stay.phone.replace(/[^\d+]/g, "")}`} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-accent">
                  <Phone className="size-3.5" />
                  {stay.phone}
                </a>
              ) : null}
            </div>
          </article>
        ) : (
          <button
            type="button"
            className="size-8 overflow-hidden rounded-full bg-surface shadow-[var(--shadow-border)]"
            aria-label={stayLabel(stay, lang)}
            onClick={() => setOpen(true)}
          >
            {media[0] ? <img src={media[0]} alt="" className="size-full object-cover" /> : null}
          </button>
        )}
      </div>
    </div>
  );
}

export function StayBar() {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const stay = useMapStore((s) => s.selectedStay);
  const walking = useMapStore((s) => s.stayWalk);
  const [form, setForm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  useEffect(() => {
    setForm(false);
    setToast(null);
    setRouting(false);
  }, [stay?.id]);
  if (!stay) return null;
  const goRoute = async () => {
    setRouting(true);
    useMapStore.getState().setStayWalk(true);
    const ok = await applyStayTrip(stay);
    setRouting(false);
    if (!ok) setToast(t.noNearStation);
  };
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto relative mx-auto flex w-full max-w-md gap-2">
          <button
            type="button"
            className="absolute -top-2 right-0 z-10 flex size-8 items-center justify-center rounded-full bg-surface text-fg-muted shadow-[var(--shadow-border)]"
            aria-label={t.close}
            onClick={() => closeLayer("stay")}
          >
            <X className="size-4" />
          </button>
          <button
            type="button"
            className="inline-flex h-12 min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-accent px-3 text-sm font-medium text-accent-fg"
            onClick={() => useMapStore.getState().setStayChat(true)}
          >
            <MessageCircle className="size-4" />
            {t.konbiniChat}
          </button>
          <button
            type="button"
            className="inline-flex h-12 min-h-12 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-surface px-3 text-sm font-medium text-fg shadow-[var(--shadow-border)]"
            onClick={() => setForm(true)}
          >
            <UtensilsCrossed className="size-4" />
            {t.lineConsult}
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
      </div>
      {form ? <ReserveForm stay={stay} onClose={() => setForm(false)} onSent={(msg) => { setForm(false); setToast(msg); }} /> : null}
      {toast ? <ReserveToast message={toast} /> : null}
    </>
  );
}

export function StayChat() {
  const lang = useMapStore((s) => s.lang);
  const stay = useMapStore((s) => s.selectedStay);
  const open = useMapStore((s) => s.stayChat);
  if (!open || !stay) return null;
  return (
    <ShopChat
      open={open}
      storeId={`stay:${stay.id}`}
      title={stayLabel(stay, lang)}
      lng={stay.lng}
      lat={stay.lat}
      onClose={() => useMapStore.getState().setStayChat(false)}
    />
  );
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function ReserveToast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))] z-50 flex justify-center px-4">
      <p className="max-w-sm rounded-[var(--radius-md)] bg-surface px-4 py-3 text-center text-sm leading-relaxed text-fg shadow-[var(--shadow-border)]">
        {message}
      </p>
    </div>
  );
}

function ReserveForm({
  stay,
  onClose,
  onSent,
}: {
  stay: Stay;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      shop: stay.name,
      name: String(fd.get("name") ?? "").trim(),
      contact: String(fd.get("contact") ?? "").trim(),
      date: String(fd.get("date") ?? "").trim(),
      time: String(fd.get("time") ?? "").trim(),
      guests: String(fd.get("guests") ?? "").trim(),
      note: String(fd.get("note") ?? "").trim(),
    };
    if (!payload.name || !payload.contact || !payload.date || !payload.time || !payload.guests) {
      setErr(t.reserveFail);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const result = await sendReserve(payload);
      if (result !== "ok") throw new Error("fail");
      onSent(t.reserveOk);
      window.setTimeout(() => closeStay(), 1600);
    } catch {
      setErr(t.reserveFail);
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-bg/45 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:items-center">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex w-full max-w-md flex-col gap-3 rounded-[var(--radius-xl)] bg-surface p-4 shadow-[var(--shadow-border)]"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-fg-muted uppercase">{t.reserveTitle}</p>
            <p className="mt-1 text-sm font-medium text-fg">{stayLabel(stay, lang)}</p>
          </div>
          <button type="button" className="flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-fg-muted" onClick={onClose} aria-label={t.close}>
            <X className="size-4" />
          </button>
        </div>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t.reserveName}
          <Input name="name" required autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t.reserveContact}
          <Input name="contact" required autoComplete="tel" inputMode="tel" placeholder="email / LINE / tel" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t.reserveDate}
            <Input name="date" type="date" required defaultValue={tomorrow()} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-fg-muted">
            {t.reserveTime}
            <Input name="time" type="time" required defaultValue="18:00" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t.reserveGuests}
          <Input name="guests" type="number" min={1} max={20} required defaultValue={2} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          {t.reserveNote}
          <textarea
            name="note"
            rows={3}
            className="w-full resize-none rounded-[var(--radius-md)] bg-surface px-3.5 py-2.5 text-sm text-fg shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {err ? <p className="text-xs text-fg">{err}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          <CalendarClock className="size-4" />
          {busy ? t.reserveSending : t.reserveSend}
        </Button>
      </form>
    </div>
  );
}
