import { useEffect } from "react";

function hideBoot() {
  const el = document.getElementById("j-boot");
  if (!el) return;
  el.classList.add("off");
  el.style.setProperty("opacity", "0", "important");
  el.style.setProperty("visibility", "hidden", "important");
  el.style.setProperty("display", "none", "important");
  el.style.pointerEvents = "none";
}

function ping() {
  try {
    if (window.parent) {
      window.parent.postMessage({ channel: "grok-preview-bridge", version: 1, type: "ready" }, "*");
    }
  } catch {
    /* */
  }
}

export function BootSplash() {
  useEffect(() => {
    ping();
    hideBoot();
    const hide = () => {
      hideBoot();
      ping();
    };
    const times = [0, 50, 200, 500, 1000, 2000, 4000].map((ms) => window.setTimeout(hide, ms));
    return () => {
      for (const id of times) window.clearTimeout(id);
    };
  }, []);
  return null;
}