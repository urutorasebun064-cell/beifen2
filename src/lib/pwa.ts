type PromptEvt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: PromptEvt | null = null;
const listeners = new Set<() => void>();

function ping() {
  for (const fn of listeners) fn();
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function canPromptInstall() {
  return Boolean(deferred);
}

export function watchInstall(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function registerPwa() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvt;
    ping();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    ping();
  });
  try {
    const seen = localStorage.getItem("jb-sw-v11");
    const regs = await navigator.serviceWorker.getRegistrations();
    if (seen !== "1") {
      await Promise.all(regs.map((r) => r.unregister()));
      localStorage.setItem("jb-sw-v11", "1");
    }
    await navigator.serviceWorker.register("/sw.js?v=11", { scope: "/", updateViaCache: "none" });
  } catch {
    /* ignore */
  }
}

export async function promptInstall() {
  if (!deferred) return false;
  const ev = deferred;
  deferred = null;
  ping();
  await ev.prompt();
  const choice = await ev.userChoice;
  return choice.outcome === "accepted";
}
