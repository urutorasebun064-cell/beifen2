import type { LiveTrainJson } from "./live";

/** Public + ODPT GTFS-RT vehicle feeds. Kanto ODPT JSON is fetched separately. */
export type GtfsRtFeed = {
  id: string;
  region: "kanto" | "other";
  kind: "rail" | "bus";
  title: string;
  /** Absolute URL, or a function when a consumer key is required. */
  url: string | ((key: string) => string);
  public?: boolean;
};

export const GTFS_RT_FEEDS: GtfsRtFeed[] = [
  {
    id: "toei-bus",
    region: "kanto",
    kind: "bus",
    title: "都営バス",
    url: "https://api-public.odpt.org/api/v4/gtfs/realtime/ToeiBus",
    public: true,
  },
  {
    id: "toei-bus-odpt",
    region: "kanto",
    kind: "bus",
    title: "都営バス",
    url: (key) => `https://api.odpt.org/api/v4/gtfs/realtime/ToeiBus?acl:consumerKey=${encodeURIComponent(key)}`,
  },
  {
    id: "tokyometro-gtfs",
    region: "kanto",
    kind: "rail",
    title: "東京メトロ",
    url: (key) =>
      `https://api.odpt.org/api/v4/gtfs/realtime/odpt.Challenge2020:TokyoMetro.TrainStandard?acl:consumerKey=${encodeURIComponent(key)}`,
  },
  {
    id: "jreast-gtfs",
    region: "kanto",
    kind: "rail",
    title: "JR東日本",
    url: (key) =>
      `https://api.odpt.org/api/v4/gtfs/realtime/odpt.Challenge2020:JR-East.TrainStandard?acl:consumerKey=${encodeURIComponent(key)}`,
  },
  {
    id: "toei-subway-gtfs",
    region: "kanto",
    kind: "rail",
    title: "都営地下鉄",
    url: (key) =>
      `https://api.odpt.org/api/v4/gtfs/realtime/odpt.Challenge2020:Toei.TrainStandard?acl:consumerKey=${encodeURIComponent(key)}`,
  },
  {
    id: "jreast-gtfs-tu",
    region: "kanto",
    kind: "rail",
    title: "JR東日本",
    url: (key) =>
      `https://api.odpt.org/api/v4/gtfs/realtime/odpt.Challenge2020:JR-East.TrainUpdate?acl:consumerKey=${encodeURIComponent(key)}`,
  },
  {
    id: "tokyometro-gtfs-tu",
    region: "kanto",
    kind: "rail",
    title: "東京メトロ",
    url: (key) =>
      `https://api.odpt.org/api/v4/gtfs/realtime/odpt.Challenge2020:TokyoMetro.TrainUpdate?acl:consumerKey=${encodeURIComponent(key)}`,
  },
  {
    id: "toei-subway-gtfs-tu",
    region: "kanto",
    kind: "rail",
    title: "都営地下鉄",
    url: (key) =>
      `https://api.odpt.org/api/v4/gtfs/realtime/odpt.Challenge2020:Toei.TrainUpdate?acl:consumerKey=${encodeURIComponent(key)}`,
  },
];

type PbField = { n: number; w: 0 | 1 | 2 | 5; v: number; b?: Uint8Array };

function u8(buf: Uint8Array) {
  return buf;
}

function readVarint(buf: Uint8Array, i: number): [number, number] {
  let s = 0;
  let sh = 0;
  while (i < buf.length) {
    const b = buf[i]!;
    i += 1;
    s += (b & 0x7f) * 2 ** sh;
    if (b < 0x80) return [s, i];
    sh += 7;
    if (sh > 56) return [s, i];
  }
  return [s, i];
}

function readFields(buf: Uint8Array): PbField[] {
  const out: PbField[] = [];
  let i = 0;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (i < buf.length) {
    const [key, j] = readVarint(buf, i);
    i = j;
    const n = key >>> 3;
    const w = (key & 7) as 0 | 1 | 2 | 5;
    if (w === 0) {
      const [v, k] = readVarint(buf, i);
      i = k;
      out.push({ n, w, v });
    } else if (w === 2) {
      const [len, k] = readVarint(buf, i);
      i = k;
      out.push({ n, w, v: len, b: buf.subarray(i, i + len) });
      i += len;
    } else if (w === 5) {
      if (i + 4 > buf.length) break;
      out.push({ n, w, v: view.getFloat32(i, true) });
      i += 4;
    } else if (w === 1) {
      if (i + 8 > buf.length) break;
      out.push({ n, w, v: Number(view.getBigUint64(i, true)) });
      i += 8;
    } else {
      break;
    }
  }
  return out;
}

function str(f?: PbField) {
  if (!f?.b) return "";
  try {
    return new TextDecoder().decode(f.b);
  } catch {
    return "";
  }
}

function first(fields: PbField[], n: number) {
  return fields.find((f) => f.n === n);
}

function all(fields: PbField[], n: number) {
  return fields.filter((f) => f.n === n);
}

function decodePosition(buf: Uint8Array): { lat: number; lng: number; bearing: number } | null {
  const fs = readFields(buf);
  let lat = NaN;
  let lng = NaN;
  let bearing = 0;
  for (const f of fs) {
    if (f.n === 1 && f.w === 5) lat = f.v;
    if (f.n === 2 && f.w === 5) lng = f.v;
    if (f.n === 3 && f.w === 5) bearing = f.v;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 20 || lat > 46.5 || lng < 122 || lng > 154) return null;
  return { lat, lng, bearing };
}

function decodeTrip(buf: Uint8Array) {
  const fs = readFields(buf);
  return {
    tripId: str(first(fs, 1)),
    routeId: str(first(fs, 2)),
    directionId: first(fs, 3)?.v ?? 0,
    startTime: str(first(fs, 4)),
    startDate: str(first(fs, 5)),
  };
}

function decodeVehicleDesc(buf: Uint8Array) {
  const fs = readFields(buf);
  return { id: str(first(fs, 1)), label: str(first(fs, 2)) };
}

function decodeStopTimeEvent(buf: Uint8Array) {
  const fs = readFields(buf);
  return { delay: first(fs, 1)?.v ?? 0, time: first(fs, 2)?.v ?? 0 };
}

function lastSeg(id: string) {
  const s = id.split(":").pop() ?? id;
  return (s.split(".").pop() ?? s).replace(/駅$/u, "");
}

type StopHint = { stopId: string; delaySec: number; arrUnix: number; depUnix: number };

function decodeStopTimeUpdate(buf: Uint8Array): StopHint | null {
  const sfs = readFields(buf);
  const stopId = str(first(sfs, 2));
  const arr = first(sfs, 3)?.b ? decodeStopTimeEvent(first(sfs, 3)!.b!) : null;
  const dep = first(sfs, 4)?.b ? decodeStopTimeEvent(first(sfs, 4)!.b!) : null;
  const delaySec = arr?.delay || dep?.delay || 0;
  const arrUnix = arr?.time || 0;
  const depUnix = dep?.time || 0;
  if (!stopId && !delaySec && !arrUnix && !depUnix) return null;
  return { stopId, delaySec, arrUnix, depUnix };
}

function decodeTripUpdate(buf: Uint8Array): {
  delaySec: number;
  tripId: string;
  routeId: string;
  stopId: string;
  prevStop: string;
  nextStop: string;
  dest: string;
  arrUnix: number;
} {
  const fs = readFields(buf);
  const trip = first(fs, 1)?.b ? decodeTrip(first(fs, 1)!.b!) : { tripId: "", routeId: "", directionId: 0, startTime: "", startDate: "" };
  let delaySec = first(fs, 5)?.v ?? 0;
  const stops: StopHint[] = [];
  for (const stu of all(fs, 3)) {
    if (!stu.b) continue;
    const row = decodeStopTimeUpdate(stu.b);
    if (row) stops.push(row);
  }
  const now = Date.now() / 1000;
  const next = stops.find((s) => (s.arrUnix || s.depUnix) > now - 20) ?? stops[0];
  const prevI = next ? Math.max(0, stops.indexOf(next) - 1) : 0;
  const prev = stops[prevI];
  if (next?.delaySec) delaySec = next.delaySec;
  else if (stops[0]?.delaySec) delaySec = stops[0]!.delaySec;
  const last = stops[stops.length - 1];
  return {
    delaySec,
    tripId: trip.tripId,
    routeId: trip.routeId,
    stopId: next?.stopId ?? "",
    prevStop: prev?.stopId ?? next?.stopId ?? "",
    nextStop: next?.stopId ?? "",
    dest: last?.stopId ?? "",
    arrUnix: next?.arrUnix || next?.depUnix || 0,
  };
}

export type GtfsVehicle = {
  id: string;
  tripId: string;
  routeId: string;
  stopId: string;
  prevStop: string;
  nextStop: string;
  dest: string;
  lat: number;
  lng: number;
  bearing: number;
  delaySec: number;
  timestamp: number;
  arrUnix: number;
  status: number;
};

export function parseGtfsRt(buf: Uint8Array): GtfsVehicle[] {
  const root = readFields(u8(buf));
  const updates = new Map<string, ReturnType<typeof decodeTripUpdate>>();
  const out: GtfsVehicle[] = [];
  const seen = new Set<string>();
  for (const ent of all(root, 2)) {
    if (!ent.b) continue;
    const efs = readFields(ent.b);
    const eid = str(first(efs, 1));
    const tu = first(efs, 3)?.b;
    if (tu) {
      const d = decodeTripUpdate(tu);
      if (d.tripId) updates.set(d.tripId, d);
      if (eid) updates.set(eid, d);
    }
    const veh = first(efs, 4)?.b;
    if (!veh) continue;
    const vfs = readFields(veh);
    const trip = first(vfs, 1)?.b ? decodeTrip(first(vfs, 1)!.b!) : { tripId: "", routeId: "", directionId: 0, startTime: "", startDate: "" };
    const vdesc = first(vfs, 2)?.b ? decodeVehicleDesc(first(vfs, 2)!.b!) : { id: "", label: "" };
    const pos = first(vfs, 3)?.b ? decodePosition(first(vfs, 3)!.b!) : null;
    const stopSeq = first(vfs, 4)?.v ?? 0;
    const stopId = str(first(vfs, 5));
    const status = first(vfs, 6)?.v ?? -1;
    const timestamp = first(vfs, 7)?.v ?? 0;
    void stopSeq;
    const id = vdesc.id || eid || trip.tripId;
    if (!id) continue;
    const upd = updates.get(trip.tripId) ?? updates.get(id) ?? updates.get(eid);
    seen.add(trip.tripId || id);
    out.push({
      id,
      tripId: trip.tripId,
      routeId: trip.routeId || upd?.routeId || "",
      stopId: stopId || upd?.stopId || "",
      prevStop: upd?.prevStop || stopId,
      nextStop: upd?.nextStop || stopId,
      dest: upd?.dest || "",
      lat: pos?.lat ?? 0,
      lng: pos?.lng ?? 0,
      bearing: pos?.bearing ?? 0,
      delaySec: upd?.delaySec ?? 0,
      timestamp,
      arrUnix: upd?.arrUnix ?? 0,
      status,
    });
  }
  for (const [key, upd] of updates) {
    if (seen.has(key) || seen.has(upd.tripId)) continue;
    if (!upd.tripId && !upd.stopId) continue;
    const id = upd.tripId || key;
    seen.add(id);
    out.push({
      id,
      tripId: upd.tripId,
      routeId: upd.routeId,
      stopId: upd.stopId,
      prevStop: upd.prevStop,
      nextStop: upd.nextStop,
      dest: upd.dest,
      lat: 0,
      lng: 0,
      bearing: 0,
      delaySec: upd.delaySec,
      timestamp: 0,
      arrUnix: upd.arrUnix,
      status: -1,
    });
  }
  return out;
}

export function gtfsToLive(rows: GtfsVehicle[], feed: GtfsRtFeed): LiveTrainJson[] {
  return rows.map((row) => ({
    id: `gtfs:${feed.id}:${row.id}`,
    railway: row.routeId || feed.id,
    railwayTitle: feed.title,
    from: lastSeg(row.prevStop || row.stopId),
    to: lastSeg(row.nextStop || row.stopId),
    dest: lastSeg(row.dest),
    delaySec: row.delaySec,
    lng: row.lng || undefined,
    lat: row.lat || undefined,
    bearing: row.bearing,
    kind: feed.kind === "bus" ? "bus" : "rail",
    arrUnix: row.arrUnix || undefined,
    status: row.status,
    gps: Boolean(row.lng && row.lat),
  }));
}

export async function fetchGtfsRtFeed(feed: GtfsRtFeed, key = "", timeoutMs = 7000): Promise<LiveTrainJson[]> {
  const url = typeof feed.url === "function" ? (key ? feed.url(key) : "") : feed.url;
  if (!url) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/octet-stream,application/x-protobuf,*/*" } });
    if (!res.ok) return [];
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 8) return [];
    return gtfsToLive(parseGtfsRt(buf), feed);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllGtfsRt(key = ""): Promise<{ trains: LiveTrainJson[]; feeds: string[] }> {
  const jobs = GTFS_RT_FEEDS.filter((f) => f.public || key).map(async (feed) => {
    const trains = await fetchGtfsRtFeed(feed, key);
    return { feed: feed.id, trains };
  });
  const settled = await Promise.all(jobs);
  const trains: LiveTrainJson[] = [];
  const feeds: string[] = [];
  const seen = new Map<string, number>();
  for (const row of settled) {
    if (!row.trains.length) continue;
    feeds.push(row.feed);
    for (const t of row.trains) {
      const key = t.id.replace(/^gtfs:[^:]+:/u, "") || `${t.railway}|${t.from}|${t.to}`;
      const i = seen.get(key);
      if (i != null) {
        if (t.lng != null && trains[i] && trains[i]!.lng == null) trains[i] = t;
        if (t.delaySec) trains[i] = { ...trains[i]!, delaySec: trains[i]!.delaySec || t.delaySec, arrUnix: trains[i]!.arrUnix || t.arrUnix, from: trains[i]!.from || t.from, to: trains[i]!.to || t.to };
        continue;
      }
      seen.set(key, trains.length);
      trains.push(t);
    }
  }
  return { trains, feeds };
}
