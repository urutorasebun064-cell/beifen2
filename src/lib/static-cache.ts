const DB = "jb-static";
const STORE = "kv";
const VER = 1;
const TILES = "jb-tiles-v1";
const STATIC = "jb-static-v1";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VER);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const q = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      q.onsuccess = () => resolve((q.result as T) ?? null);
      q.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet(key: string, value: unknown) {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    /* quota */
  }
}

export async function cachePut(url: string, res: Response, bucket = STATIC) {
  if (typeof caches === "undefined" || !res || !(res.ok || res.type === "opaque")) return;
  try {
    const c = await caches.open(bucket);
    await c.put(url, res.clone());
  } catch {
    /* */
  }
}

export async function cacheMatch(url: string, bucket = STATIC) {
  if (typeof caches === "undefined") return null;
  try {
    const c = await caches.open(bucket);
    return (await c.match(url)) ?? null;
  } catch {
    return null;
  }
}

export async function loadStaticJson<T>(url: string, idbKey: string): Promise<{ data: T; fromCache: boolean } | null> {
  const cached = await idbGet<T>(idbKey);
  if (cached) {
    void refreshStaticJson(url, idbKey);
    return { data: cached, fromCache: true };
  }
  try {
    const hit = await cacheMatch(url);
    if (hit) {
      const data = (await hit.json()) as T;
      void idbSet(idbKey, data);
      void refreshStaticJson(url, idbKey);
      return { data, fromCache: true };
    }
  } catch {
    /* */
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const copy = res.clone();
    const data = (await res.json()) as T;
    void idbSet(idbKey, data);
    void cachePut(url, copy);
    return { data, fromCache: false };
  } catch {
    return null;
  }
}

async function refreshStaticJson(url: string, idbKey: string) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return;
    const copy = res.clone();
    const data = await res.json();
    void idbSet(idbKey, data);
    void cachePut(url, copy);
  } catch {
    /* keep stale */
  }
}

export function setTileSrc(img: HTMLImageElement, url: string) {
  const go = (src: string) => {
    img.src = src;
  };
  if (typeof caches === "undefined") {
    go(url);
    return;
  }
  void caches
    .open(TILES)
    .then(async (c) => {
      const hit = await c.match(url);
      if (hit) {
        const blob = await hit.blob();
        go(URL.createObjectURL(blob));
        return;
      }
      go(url);
      img.addEventListener(
        "load",
        () => {
          void fetch(url, { mode: "cors" })
            .then((r) => {
              if (r.ok) return c.put(url, r);
            })
            .catch(() => {
              /* cors — SW still caches the image request */
            });
        },
        { once: true },
      );
    })
    .catch(() => go(url));
}
