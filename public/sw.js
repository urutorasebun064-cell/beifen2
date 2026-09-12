/* J PWA — never hijack navigations or scripts. Old interceptors caused a black screen. */
const SW_VER = "j-v27";
const TILES = "jb-tiles-v1";
const STATIC = "jb-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== TILES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticGet(req) {
  if (req.method !== "GET") return false;
  if (req.mode === "navigate") return false;
  const dest = req.destination;
  if (dest === "document" || dest === "script" || dest === "style" || dest === "manifest" || dest === "worker") return false;
  let u;
  try {
    u = new URL(req.url);
  } catch {
    return false;
  }
  if (u.origin === self.location.origin) {
    if (u.pathname === "/data/rails.min.json") return "static";
    if (u.pathname === "/api/radar") return "tiles";
    return false;
  }
  if (u.hostname === "tile.openstreetmap.jp" || u.hostname === "cyberjapandata.gsi.go.jp") return "tiles";
  return false;
}

async function cacheFirst(req, bucket) {
  const cache = await caches.open(bucket);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) {
    try {
      await cache.put(req, res.clone());
    } catch {
      /* quota */
    }
  }
  return res;
}

async function staleRails(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (event) => {
  const kind = isStaticGet(event.request);
  if (!kind) return;
  event.respondWith(
    (kind === "static" ? staleRails(event.request) : cacheFirst(event.request, TILES)).catch(() => fetch(event.request)),
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let body = "•";
      try {
        const data = event.data ? event.data.json() : null;
        if (data && data.body) body = String(data.body).slice(0, 80);
      } catch {
        try {
          const raw = event.data ? event.data.text() : "";
          if (raw) body = raw.slice(0, 80);
        } catch {
          /* */
        }
      }
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      list.forEach((c) => c.postMessage({ type: "party-alert" }));
      try {
        if (self.navigator?.setAppBadge) await self.navigator.setAppBadge(1);
      } catch {
        /* */
      }
      const open = list.some((c) => c.visibilityState === "visible");
      if (open) return;
      await self.registration.showNotification("J", {
        body,
        tag: "jb-party-" + Date.now(),
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        silent: false,
        renotify: true,
        vibrate: [40, 80, 40],
        data: { type: "party-alert" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const hit = list.find((c) => "focus" in c) ?? list[0];
      if (hit) {
        hit.postMessage({ type: "party-open" });
        return hit.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
