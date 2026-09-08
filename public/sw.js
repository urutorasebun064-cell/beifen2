/* J PWA — never hijack page opens. Old interceptors caused a black screen. */
const SW_VER = "j-v14";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", () => {
  /* never hijack — broken intercepts caused HTTP / black screen */
});

self.addEventListener("push", (event) => {
  let data = { title: "パーティ", body: "", tag: "jb-party" };
  try {
    data = { ...data, ...(event.data ? event.data.json() : {}) };
  } catch {
    try {
      const t = event.data ? event.data.text() : "";
      if (t) data.body = t;
    } catch {
      /* */
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "パーティ", {
      body: data.body || "",
      tag: data.tag || `jb-party-${Date.now()}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      renotify: true,
    }).then(() =>
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        list.forEach((c) => c.postMessage({ type: "party-alert", title: data.title, body: data.body }));
      }),
    ),
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
