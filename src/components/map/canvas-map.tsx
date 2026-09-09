import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LocateFixed, RotateCcw, RotateCw } from "lucide-react";
import { AIRPORT_BY_ID, AIRPORTS, FLIGHT_ROUTES } from "@/data/flights";
import { CITY_MARKS, JAPAN_LAND, JAPAN_WATER, cityMinZoom } from "@/data/japan-land";
import { MARINE_ACTORS, marineLod, marinePose, zoneHits } from "@/data/marine";
import { bedFill, benioffPoint, BOX_FLOOR, crustKm, DEPTH_MARKS, depthAlt, geoFill, insideLand, oceanFill, RIDGE_AXES, seafloorAlt, seafloorKm, slabFill, slabKm, TRENCH_AXES } from "@/data/bathymetry";
import { copies, displayName, type Copy, type Lang } from "@/lib/i18n";
import type { Quake } from "@/lib/quake";
import { formatKm, haversine, nearestStationsFrom, NODA, stationsNearPlace, arriveHhmmOf, etaFromHhmm, parseHhmmMin } from "@/lib/rail/geo";
import { lineVisible, nearestTrainAt, parseTrainId, poseWithDelay, simulateTrains, trainById } from "@/lib/rail/simulate";
import { mergeLive } from "@/lib/rail/live";
import { delaySeconds } from "@/lib/rail/delay";
import { getOfficialDia, getPinnedTrain, pinLivePosition, smoothLiveOnTrack } from "@/lib/rail/realtime";
import { stampTrainsDia } from "@/lib/rail/yahoo";
import type { LiveTrack } from "@/lib/rail/track-lerp";
import {
  drawWeatherParticles,
  nearestWeather,
  tickWeatherParticles,
  weatherVeil,
  type WeatherSpot,
  type WxParticle,
} from "@/lib/weather";
import type { Journey, LineRuntime, RouteLeg, StationHit, Train } from "@/lib/rail/types";
import { Button } from "@/components/ui/button";
import { applyMateTrip, calibrateTrain, calibrateStation, fillPickedStation, locateUser } from "@/components/app/search-panel";
import { findLineForLeg, locateStation, sliceRailPath } from "@/lib/rail/graph";
import { placeTrainOnLeg, stopIndexByName } from "@/lib/rail/timetable-snap";
import { arrivalCompare, journeyGuide, rideHeadline } from "@/components/app/route-panel";
import { focusStay } from "@/components/app/stay-catalog";
import { focusKonbini } from "@/components/app/konbini-panel";
import { KONBINI_META, konbiniLabel, konbiniRingM, metersTo, pullKonbini } from "@/lib/konbini";
import { drawRadarLayer, RADAR_JAPAN_LAT, RADAR_JAPAN_LNG, RADAR_JAPAN_ZOOM } from "@/lib/radar";
import { drawRoads, pullRoads, SHOW_ZOOM } from "@/lib/roads";
import { STAYS, stayLabel } from "@/data/stays";
import { PEAKS, FUJI_H, peakLabel, type Peak } from "@/data/peaks";
import { useMapStore, simNow } from "@/store/map-store";

type Cam = { lng: number; lat: number; zoom: number; yaw: number; tilt: number };

const OCEAN = "#000000";
const LAND = "#7ea36c";
const LAND_SIDE = "#4e7a48";
const LAND_EDGE = "#6d9460";
const INK = "#0a120c";
const CREAM = "#f7f4ea";
const MIN_ZOOM = 4.4;
const MAX_ZOOM = 18.25;
const MAP_LO = 5.6;
const MAP_HI = 8.15;
const BOX_WEST = 123;
const BOX_EAST = 150.5;
const BOX_SOUTH = 24;
const BOX_NORTH = 46.2;
const BOX_W = 1;
const BOX_D = ((BOX_NORTH - BOX_SOUTH) / (BOX_EAST - BOX_WEST)) * 0.84;
const BOX_H = 0.48;

const JAPAN_LNG = 137.6;
const JAPAN_LAT = 36.2;
const HOME_ZOOM = 16.4;
const HOME_TILT = 0.55;
const SNAP_ZOOM = 15.8;

function liftColor(hex: string, amt = 0.38) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amt < 0) {
    const k = 1 + amt;
    r = Math.max(0, Math.round(r * k));
    g = Math.max(0, Math.round(g * k));
    b = Math.max(0, Math.round(b * k));
  } else {
    r = Math.min(255, Math.round(r * (1 - amt) + 255 * amt));
    g = Math.min(255, Math.round(g * (1 - amt) + 255 * amt));
    b = Math.min(255, Math.round(b * (1 - amt) + 255 * amt));
  }
  return `rgb(${r},${g},${b})`;
}

function glow(hex: string, a: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(255,255,220,${a})`;
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

function stationFullName(n: string) {
  if (/[駅站]$/u.test(n) || /station$/i.test(n)) return n;
  return `${n}駅`;
}

function mapFont(px: number, weight: number | string = 700) {
  const zh = useMapStore.getState().lang === "zh";
  return `${weight} ${px}px ${zh ? '"Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif' : "ui-sans-serif, sans-serif"}`;
}

function lineShort(line: LineRuntime) {
  const n = line.name.replace(/（.*?）/g, "").replace(/\(.*?\)/g, "");
  if (line.kind === "shinkansen") return n.replace(/新幹線/g, "新");
  if (line.kind === "bus") return n.slice(0, 8);
  if (line.kind === "subway") {
    return n
      .replace(/^東京メトロ/, "メトロ")
      .replace(/^東京都交通局/, "都営")
      .replace(/線$/u, "");
  }
  if (line.kind === "jr") {
    const m = n.match(/(山手|中央総武|中央|京浜東北|埼京|湘南新宿|総武快速|総武|京葉|常磐|高崎|宇都宮|東海道|横須賀|南武|武蔵野|京浜|根岸|横浜|内房|外房|総武本|成田|青梅|五日市)/);
    return m ? `JR${m[1]}` : "JR";
  }
  const p = n.match(/^(西武|東武|京王|小田急|京急|京成|東急|相鉄|名鉄|近鉄|南海|阪急|阪神|京阪|新京成|北総|つくばエクスプレス|TX|東京臨海|横浜高速|北大阪|神戸|西鉄|JR)/);
  if (p) return p[1] === "つくばエクスプレス" ? "TX" : p[1]!;
  return n.replace(/線$/u, "").slice(0, 4);
}

function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

function zoomToFitKm(km: number, h: number) {
  const padKm = Math.max(0.55, km * 2.35);
  const spanDeg = padKm / 111;
  const z = Math.log2((0.62 * Math.max(280, h) * 360) / (256 * Math.max(1e-4, spanDeg)));
  return clampZoom(Math.min(16.5, Math.max(10.2, z)));
}

function zoomToFitNearbyStations(lng: number, lat: number, h: number) {
  const index = useMapStore.getState().stationIndex;
  const near = index.size ? nearestStationsFrom(index, lng, lat, 4, 12) : [];
  const km = near.length ? Math.max(...near.map((r) => r.km), 1.8) : 2.6;
  const padKm = Math.max(3.2, km * 3.6);
  const spanDeg = padKm / 111;
  const z = Math.log2((0.58 * Math.max(280, h) * 360) / (256 * Math.max(1e-4, spanDeg)));
  return clampZoom(Math.min(13.4, Math.max(11.6, z)));
}

function clampTilt(tilt: number) {
  return Math.max(0, Math.min(Math.PI / 2, tilt));
}

function inJapan(lng: number, lat: number) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng > 122.5 && lng < 154 && lat > 20 && lat < 46.2;
}

function keepJapanInView(cam: Cam) {
  cam.lng = Math.max(127.2, Math.min(146.4, cam.lng));
  cam.lat = Math.max(24.2, Math.min(45.7, cam.lat));
}

const CAM_KEY = "jb-cam";
let camSaveAt = 0;

function readSessionCam(): Cam | null {
  try {
    const raw = sessionStorage.getItem(CAM_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Cam;
    if (!inJapan(v.lng, v.lat) || !Number.isFinite(v.zoom)) return null;
    return {
      lng: v.lng,
      lat: v.lat,
      zoom: clampZoom(v.zoom),
      yaw: Number.isFinite(v.yaw) ? v.yaw : 0,
      tilt: Number.isFinite(v.tilt) ? clampTilt(v.tilt) : HOME_TILT,
    };
  } catch {
    return null;
  }
}

function rememberCam(cam: Cam) {
  const now = Date.now();
  if (now - camSaveAt < 400) return;
  camSaveAt = now;
  try {
    sessionStorage.setItem(CAM_KEY, JSON.stringify(cam));
  } catch {
    /* private mode */
  }
}

function panGain(zoom: number) {
  if (zoom <= 5.6) return 1.48;
  if (zoom >= 12.2) return 0.48;
  return 1.48 - ((zoom - 5.6) / 6.6) * 1.0;
}

function panCam(cam: Cam, dx: number, dy: number, gain = 1) {
  const world = 256 * 2 ** cam.zoom;
  const ct = Math.max(0.2, Math.cos(effectiveTilt(cam)));
  const x = -dx * gain;
  const z = (-dy / ct) * gain;
  const c = Math.cos(cam.yaw);
  const s = Math.sin(cam.yaw);
  const wx = x * c + z * s;
  const wz = -x * s + z * c;
  const [cx, cy] = mercator(cam.lng, cam.lat);
  const nx = cx + wx / world;
  const ny = cy + wz / world;
  cam.lng = nx * 360 - 180;
  const n = Math.PI * (1 - 2 * ny);
  cam.lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  keepJapanInView(cam);
}

type CamLerp = {
  slng: number;
  slat: number;
  szoom: number;
  syaw: number;
  stilt: number;
  tlng: number;
  tlat: number;
  tzoom: number;
  tyaw: number;
  ttilt: number;
  t0: number;
  dur: number;
};

function shortestYaw(from: number, to: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

function beginLerp(from: Cam, to: Cam, dur: number): CamLerp {
  return {
    slng: from.lng,
    slat: from.lat,
    szoom: from.zoom,
    syaw: from.yaw,
    stilt: from.tilt,
    tlng: to.lng,
    tlat: to.lat,
    tzoom: to.zoom,
    tyaw: shortestYaw(from.yaw, to.yaw),
    ttilt: to.tilt,
    t0: performance.now(),
    dur,
  };
}

function easeInOutCubic(u: number) {
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
}

function lerpTarget(anim: CamLerp): Cam {
  return {
    lng: anim.tlng,
    lat: anim.tlat,
    zoom: anim.tzoom,
    yaw: anim.tyaw,
    tilt: anim.ttilt,
  };
}

function zoomCenterOn(cam: Cam, sx: number, sy: number, w: number, h: number, nextZoom: number): Cam {
  const [lng, lat] = unproject(sx, sy, cam, w, h);
  const next: Cam = { ...cam, zoom: clampZoom(nextZoom) };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return next;
  if (mapBlend(next.zoom) > 0.72) {
    next.lng = lng;
    next.lat = lat;
    keepJapanInView(next);
    return next;
  }
  const [nlng, nlat] = unproject(sx, sy, next, w, h);
  if (Number.isFinite(nlng) && Math.abs(lng - nlng) < 12 && Math.abs(lat - nlat) < 12) {
    next.lng += lng - nlng;
    next.lat += lat - nlat;
  }
  for (let i = 0; i < 10; i++) {
    const [px, py] = project(lng, lat, next, w, h);
    if (!Number.isFinite(px) || !Number.isFinite(py)) break;
    const dx = w / 2 - px;
    const dy = h / 2 - py;
    if (Math.hypot(dx, dy) < 1.5) break;
    panCam(next, dx * 0.28, dy * 0.28, 1);
  }
  keepJapanInView(next);
  return next;
}

function placeAtScreen(lng: number, lat: number, zoom: number, w: number, h: number, fx: number, fy: number, yaw: number, tilt: number): Cam {
  const cam: Cam = { lng, lat, zoom: clampZoom(zoom), yaw, tilt };
  const tx = w * fx;
  const ty = h * fy;
  for (let i = 0; i < 12; i++) {
    const [px, py] = project(lng, lat, cam, w, h, 0);
    if (!Number.isFinite(px) || !Number.isFinite(py)) break;
    const dx = tx - px;
    const dy = ty - py;
    if (Math.hypot(dx, dy) < 1.2) break;
    panCam(cam, dx, dy, 1);
  }
  return cam;
}

function zoomTowardPoint(cam: Cam, sx: number, sy: number, w: number, h: number, nextZoom: number): Cam {
  const [lng, lat] = unproject(sx, sy, cam, w, h);
  const next: Cam = { ...cam, zoom: clampZoom(nextZoom) };
  const [nlng, nlat] = unproject(sx, sy, next, w, h);
  if (Number.isFinite(lng) && Number.isFinite(nlng) && Math.abs(lng - nlng) < 12 && Math.abs(lat - nlat) < 12) {
    next.lng += lng - nlng;
    next.lat += lat - nlat;
  }
  keepJapanInView(next);
  return next;
}

const ZOOM_STEP = 0.32;

function mapBlend(zoom: number) {
  return Math.max(0, Math.min(1, (zoom - MAP_LO) / (MAP_HI - MAP_LO)));
}

function effectiveTilt(cam: Cam) {
  return cam.tilt;
}

function mercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [x, y];
}

function geoToLocal(lng: number, lat: number, alt: number) {
  return {
    x: ((lng - BOX_WEST) / (BOX_EAST - BOX_WEST) - 0.5) * BOX_W,
    y: alt * BOX_H,
    z: (0.5 - (lat - BOX_SOUTH) / (BOX_NORTH - BOX_SOUTH)) * BOX_D,
  };
}

function viewBasis(cam: Cam) {
  const tilt = effectiveTilt(cam);
  const dist = Math.max(0.32, 1.58 * 2 ** ((6.35 - cam.zoom) * 0.52));
  const look = geoToLocal(cam.lng, cam.lat, 0);
  const ox = dist * Math.sin(tilt) * Math.sin(cam.yaw);
  const oy = dist * Math.cos(tilt);
  const oz = dist * Math.sin(tilt) * Math.cos(cam.yaw);
  const eye = { x: look.x + ox, y: look.y + oy, z: look.z + oz };
  let fx = look.x - eye.x;
  let fy = look.y - eye.y;
  let fz = look.z - eye.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let ux = 0;
  let uy = 1;
  let uz = 0;
  if (Math.abs(fy) > 0.93) {
    ux = -Math.sin(cam.yaw);
    uy = 0;
    uz = -Math.cos(cam.yaw);
  }
  let rx = fy * uz - fz * uy;
  let ry = fz * ux - fx * uz;
  let rz = fx * uy - fy * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  ux = ry * fz - rz * fy;
  uy = rz * fx - rx * fz;
  uz = rx * fy - ry * fx;
  return { eye, rx, ry, rz, ux, uy, uz, fx, fy, fz };
}

function project3d(lng: number, lat: number, cam: Cam, w: number, h: number, alt = 0): [number, number] {
  const p = geoToLocal(lng, lat, alt);
  const b = viewBasis(cam);
  const dx = p.x - b.eye.x;
  const dy = p.y - b.eye.y;
  const dz = p.z - b.eye.z;
  const vx = dx * b.rx + dy * b.ry + dz * b.rz;
  const vy = dx * b.ux + dy * b.uy + dz * b.uz;
  const vz = dx * b.fx + dy * b.fy + dz * b.fz;
  const focal = 1.08 * Math.min(w, h);
  const s = focal / Math.max(0.14, vz);
  return [w / 2 + vx * s, h / 2 - vy * s];
}

function projectMap(lng: number, lat: number, cam: Cam, w: number, h: number, alt = 0): [number, number] {
  const world = 256 * 2 ** cam.zoom;
  const [mx, my] = mercator(lng, lat);
  const [cx, cy] = mercator(cam.lng, cam.lat);
  let x = (mx - cx) * world;
  let z = (my - cy) * world;
  if (cam.yaw) {
    const c = Math.cos(cam.yaw);
    const s = Math.sin(cam.yaw);
    const rx = x * c - z * s;
    const rz = x * s + z * c;
    x = rx;
    z = rz;
  }
  const tilt = effectiveTilt(cam);
  const y = alt * (40 + cam.zoom * 6);
  const sy = z * Math.cos(tilt) - y * Math.sin(tilt);
  return [x + w / 2, sy + h / 2];
}

function project(lng: number, lat: number, cam: Cam, w: number, h: number, alt = 0): [number, number] {
  const t = mapBlend(cam.zoom);
  if (t <= 0.001) return project3d(lng, lat, cam, w, h, alt);
  if (t >= 0.999) return projectMap(lng, lat, cam, w, h, alt);
  const a = project3d(lng, lat, cam, w, h, alt);
  const b = projectMap(lng, lat, cam, w, h, alt);
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t];
}

function depthOf(lng: number, lat: number, cam: Cam, alt = 0) {
  if (mapBlend(cam.zoom) > 0.55) return -projectMap(lng, lat, cam, 100, 100, alt)[1];
  const p = geoToLocal(lng, lat, alt);
  const b = viewBasis(cam);
  return (p.x - b.eye.x) * b.fx + (p.y - b.eye.y) * b.fy + (p.z - b.eye.z) * b.fz;
}

function unprojectMap(px: number, py: number, cam: Cam, w: number, h: number): [number, number] {
  const world = 256 * 2 ** cam.zoom;
  const [cx, cy] = mercator(cam.lng, cam.lat);
  let x = px - w / 2;
  let sy = py - h / 2;
  const ct = Math.cos(effectiveTilt(cam));
  let z = Math.abs(ct) > 0.12 ? sy / ct : sy;
  if (cam.yaw) {
    const c = Math.cos(cam.yaw);
    const s = Math.sin(cam.yaw);
    const rx = x * c + z * s;
    const rz = -x * s + z * c;
    x = rx;
    z = rz;
  }
  const mx = cx + x / world;
  const my = cy + z / world;
  const lng = mx * 360 - 180;
  const n = Math.PI * (1 - 2 * my);
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
}

function unproject3d(px: number, py: number, cam: Cam, w: number, h: number): [number, number] {
  const b = viewBasis(cam);
  const focal = 1.08 * Math.min(w, h);
  const vx = (px - w / 2) / focal;
  const vy = -(py - h / 2) / focal;
  const dx = vx * b.rx + vy * b.ux + b.fx;
  const dy = vx * b.ry + vy * b.uy + b.fy;
  const dz = vx * b.rz + vy * b.uz + b.fz;
  if (Math.abs(dy) < 1e-5) return [cam.lng, cam.lat];
  const t = (0 - b.eye.y) / dy;
  if (t < 0.04) return [cam.lng, cam.lat];
  const hx = b.eye.x + dx * t;
  const hz = b.eye.z + dz * t;
  const lng = BOX_WEST + (hx / BOX_W + 0.5) * (BOX_EAST - BOX_WEST);
  const lat = BOX_SOUTH + (0.5 - hz / BOX_D) * (BOX_NORTH - BOX_SOUTH);
  return [lng, lat];
}

function unproject(px: number, py: number, cam: Cam, w: number, h: number): [number, number] {
  return mapBlend(cam.zoom) > 0.5 ? unprojectMap(px, py, cam, w, h) : unproject3d(px, py, cam, w, h);
}

function placeUpper(lng: number, lat: number, zoom: number, w: number, h: number): Cam {
  if (mapBlend(zoom) > 0.5) {
    const mobile = typeof window !== "undefined" && window.innerWidth < 768;
    const targetY = mobile ? 0.28 : 0.44;
    const world = 256 * 2 ** zoom;
    const [, my] = mercator(lng, lat);
    const cy = my - ((targetY - 0.5) * h) / world;
    const n = Math.PI * (1 - 2 * cy);
    return {
      lng,
      lat: Math.max(20, Math.min(46, (180 / Math.PI) * Math.atan(Math.sinh(n)))),
      zoom: clampZoom(zoom),
      yaw: 0,
      tilt: 0.55,
    };
  }
  return {
    lng,
    lat: Math.max(20, Math.min(46, lat)),
    zoom: clampZoom(zoom),
    yaw: 0,
    tilt: 1.05,
  };
}

function placeCenter(lng: number, lat: number, zoom: number, w: number, h: number): Cam {
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;
  const targetY = mobile ? 0.38 : 0.48;
  const world = 256 * 2 ** clampZoom(zoom);
  const [, my] = mercator(lng, lat);
  const cy = my - ((targetY - 0.5) * h) / world;
  const n = Math.PI * (1 - 2 * cy);
  return {
    lng,
    lat: Math.max(20, Math.min(46, (180 / Math.PI) * Math.atan(Math.sinh(n)))),
    zoom: clampZoom(zoom),
    yaw: 0,
    tilt: 0,
  };
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (typeof g.roundRect === "function") {
    g.roundRect(x, y, w, h, rad);
    return;
  }
  g.rect(x, y, w, h);
}

function landPath(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number, alt = 0) {
  g.beginPath();
  for (const ring of JAPAN_LAND) {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = project(lng, lat, cam, w, h, alt);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
  }
}

function drawSeafloor(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  const cols = 30;
  const rows = 24;
  const cells: { pts: [number, number][]; z: number; km: number }[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng0 = BOX_WEST + (i / cols) * (BOX_EAST - BOX_WEST);
      const lat0 = BOX_SOUTH + (j / rows) * (BOX_NORTH - BOX_SOUTH);
      const lng1 = BOX_WEST + ((i + 1) / cols) * (BOX_EAST - BOX_WEST);
      const lat1 = BOX_SOUTH + ((j + 1) / rows) * (BOX_NORTH - BOX_SOUTH);
      const corners: [number, number][] = [
        [lng0, lat0],
        [lng1, lat0],
        [lng1, lat1],
        [lng0, lat1],
      ];
      const km =
        (seafloorKm(lng0, lat0) + seafloorKm(lng1, lat0) + seafloorKm(lng1, lat1) + seafloorKm(lng0, lat1)) / 4;
      if (km < 0.18) continue;
      const midLng = (lng0 + lng1) / 2;
      const midLat = (lat0 + lat1) / 2;
      if (insideLand(midLng, midLat)) continue;
      const pts = corners.map(([lng, lat]) => project(lng, lat, cam, w, h, seafloorAlt(lng, lat))) as [number, number][];
      cells.push({ pts, z: depthOf(midLng, midLat, cam, seafloorAlt(midLng, midLat)), km });
    }
  }
  cells.sort((a, b) => a.z - b.z);
  for (const cell of cells) {
    const a = cell.pts[0]!;
    const b = cell.pts[1]!;
    const c = cell.pts[2]!;
    const d = cell.pts[3]!;
    g.fillStyle = bedFill(cell.km);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.lineTo(c[0], c[1]);
    g.lineTo(d[0], d[1]);
    g.closePath();
    g.fill();
  }
}

function drawTrenchAxes(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  const stroke = (pts: [number, number][], width: number, color: string, km: number) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.beginPath();
    pts.forEach(([lng, lat], i) => {
      const alt = -Math.min(1, km / 10);
      const [x, y] = project(lng, lat, cam, w, h, alt);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  };
  for (const t of TRENCH_AXES) {
    stroke(t.pts, 3.2, "rgba(56, 36, 22, 0.28)", t.km);
    stroke(t.pts, 1.2, "rgba(48, 28, 16, 0.5)", t.km);
  }
  for (const r of RIDGE_AXES) {
    stroke(r.pts, 1.3, "rgba(140, 112, 84, 0.35)", 1.3);
  }
}

function fillQuad(
  g: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
  fill: string,
) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(a[0], a[1]);
  g.lineTo(b[0], b[1]);
  g.lineTo(c[0], c[1]);
  g.lineTo(d[0], d[1]);
  g.closePath();
  g.fill();
}

function drawIslandRoots(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  const cols = 22;
  const rows = 18;
  const cells: { pts: [number, number][]; z: number; km: number }[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng0 = BOX_WEST + (i / cols) * (BOX_EAST - BOX_WEST);
      const lat0 = BOX_SOUTH + (j / rows) * (BOX_NORTH - BOX_SOUTH);
      const lng1 = BOX_WEST + ((i + 1) / cols) * (BOX_EAST - BOX_WEST);
      const lat1 = BOX_SOUTH + ((j + 1) / rows) * (BOX_NORTH - BOX_SOUTH);
      const corners: [number, number][] = [
        [lng0, lat0],
        [lng1, lat0],
        [lng1, lat1],
        [lng0, lat1],
      ];
      if (corners.some(([lng, lat]) => !insideLand(lng, lat))) continue;
      const kms = corners.map(([lng, lat]) => crustKm(lng, lat));
      const km = kms.reduce((s, n) => s + n, 0) / 4;
      const pts = corners.map(([lng, lat], n) => project(lng, lat, cam, w, h, depthAlt(kms[n]!))) as [number, number][];
      cells.push({ pts, z: depthOf((lng0 + lng1) / 2, (lat0 + lat1) / 2, cam, depthAlt(km)), km });
    }
  }
  cells.sort((a, b) => a.z - b.z);
  for (const cell of cells) {
    fillQuad(g, cell.pts[0]!, cell.pts[1]!, cell.pts[2]!, cell.pts[3]!, geoFill(cell.km, 0.9));
  }
}

function spline1d(values: number[], alive: number[]) {
  const pts: [number, number][] = [];
  for (let i = 0; i < values.length; i++) {
    if (alive[i]) pts.push([i, values[i]!]);
  }
  if (pts.length < 3) return values.slice();
  const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  };
  const out = values.slice();
  for (let s = 0; s < pts.length - 1; s++) {
    const a = pts[Math.max(0, s - 1)]!;
    const b = pts[s]!;
    const c = pts[s + 1]!;
    const d = pts[Math.min(pts.length - 1, s + 2)]!;
    const i0 = b[0];
    const i1 = c[0];
    const span = Math.max(1, i1 - i0);
    for (let i = i0; i <= i1; i++) {
      out[i] = catmull(a[1], b[1], c[1], d[1], (i - i0) / span);
    }
  }
  return out;
}

type SlabFace = { c: [number, number, number][]; km: number };

let SLAB_FACES: SlabFace[] | null = null;
let slabWarming = false;

function warmSlabFaces() {
  if (SLAB_FACES || slabWarming) return;
  slabWarming = true;
  window.setTimeout(() => {
    try {
      getSlabFaces();
    } catch {
      /* keep map alive */
    }
  }, 60);
}

function getSlabFaces(): SlabFace[] {
  if (SLAB_FACES) return SLAB_FACES;
  const cols = 40;
  const rows = 32;
  const nx = cols + 1;
  const ny = rows + 1;
  const thick = 12;
  const field: (number | null)[][] = Array.from({ length: ny }, () => Array<number | null>(nx).fill(null));
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const lng = BOX_WEST + (i / cols) * (BOX_EAST - BOX_WEST);
      const lat = BOX_SOUTH + (j / rows) * (BOX_NORTH - BOX_SOUTH);
      const km = slabKm(lng, lat);
      field[j]![i] = km == null ? null : Math.min(150, km);
    }
  }
  const blur = (src: (number | null)[][], holes: boolean) => {
    const out = src.map((row) => row.slice());
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const v = src[j + dj]?.[i + di];
            if (v == null) continue;
            s += v;
            n += 1;
          }
        }
        const cur = src[j]![i];
        if (cur == null) {
          if (holes && n >= 6) out[j]![i] = s / n;
          continue;
        }
        if (n) out[j]![i] = cur * 0.4 + (s / n) * 0.6;
      }
    }
    return out;
  };
  let top = blur(blur(field, true), true);
  top = blur(blur(top, false), false);

  const envelope: number[] = Array(nx).fill(0);
  const envN: number[] = Array(nx).fill(0);
  const toeJ: number[] = Array(nx).fill(-1);
  for (let i = 0; i < nx; i++) {
    let mx = 0;
    let n = 0;
    let tj = -1;
    for (let j = 0; j < ny; j++) {
      const v = top[j]![i];
      if (v == null) continue;
      n += 1;
      if (v >= mx) {
        mx = v;
        tj = j;
      }
    }
    envelope[i] = n ? mx + thick : 0;
    envN[i] = n;
    toeJ[i] = tj;
  }
  for (let k = 0; k < 4; k++) {
    const next = envelope.slice();
    for (let i = 1; i < nx - 1; i++) {
      if (!envN[i]) continue;
      const a = envN[i - 1] ? envelope[i - 1]! : envelope[i]!;
      const c = envN[i + 1] ? envelope[i + 1]! : envelope[i]!;
      next[i] = a * 0.22 + envelope[i]! * 0.56 + c * 0.22;
    }
    for (let i = 0; i < nx; i++) envelope[i] = next[i]!;
  }
  const envAlive = envN.map((n) => (n ? 1 : 0));
  const envSmooth = spline1d(envelope, envAlive);
  const toeSmooth = spline1d(
    toeJ.map((v) => (v < 0 ? 0 : v)),
    envAlive,
  );
  for (let i = 0; i < nx; i++) {
    if (!envN[i]) continue;
    envelope[i] = Math.max(24, Math.min(158, envSmooth[i]!));
    toeJ[i] = Math.max(0, Math.min(ny - 1, toeSmooth[i]!));
  }
  for (let k = 0; k < 2; k++) {
    const next = toeJ.slice();
    for (let i = 1; i < nx - 1; i++) {
      if (!envN[i] || !envN[i - 1] || !envN[i + 1]) continue;
      next[i] = toeJ[i - 1]! * 0.25 + toeJ[i]! * 0.5 + toeJ[i + 1]! * 0.25;
    }
    for (let i = 0; i < nx; i++) toeJ[i] = next[i]!;
  }

  const bot: (number | null)[][] = Array.from({ length: ny }, () => Array<number | null>(nx).fill(null));
  for (let i = 0; i < nx; i++) {
    if (!envN[i]) continue;
    const cap = envelope[i]!;
    const edge = toeJ[i]!;
    for (let j = 0; j < ny; j++) {
      const t = top[j]![i];
      if (t == null && j > edge + 0.6) continue;
      if (t == null && j < edge - 8) continue;
      if (t == null && Math.abs(j - edge) > 1.2) continue;
      const use = t ?? (j <= edge + 0.35 ? cap - thick : null);
      if (use == null) continue;
      top[j]![i] = top[j]![i] ?? Math.max(8, cap - thick - Math.abs(j - edge) * 4);
      bot[j]![i] = cap;
    }
  }
  for (let k = 0; k < 2; k++) {
    const next = bot.map((row) => row.slice());
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (bot[j]![i] == null) continue;
        let s = 0;
        let n = 0;
        for (let di = -2; di <= 2; di++) {
          const v = bot[j]![i + di];
          if (v == null) continue;
          const wgt = 3 - Math.abs(di);
          s += v * wgt;
          n += wgt;
        }
        if (n) next[j]![i] = s / n;
      }
    }
    for (let j = 0; j < ny; j++) bot[j] = next[j]!;
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const t = top[j]![i];
      const b = bot[j]![i];
      if (t == null || b == null) continue;
      bot[j]![i] = Math.max(t + 10, Math.min(158, b));
    }
  }

  const lngAt = (i: number) => BOX_WEST + (i / cols) * (BOX_EAST - BOX_WEST);
  const latAt = (j: number) => BOX_SOUTH + (j / rows) * (BOX_NORTH - BOX_SOUTH);
  const valid = (j: number, i: number) => top[j]?.[i] != null && bot[j]?.[i] != null;
  const faces: SlabFace[] = [];
  const push = (c: [number, number, number][], km: number) => {
    if (c.some((p) => !Number.isFinite(p[2]))) return;
    faces.push({ c, km });
  };

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (!valid(j, i) || !valid(j, i + 1) || !valid(j + 1, i + 1) || !valid(j + 1, i)) continue;
      const corners: [number, number][] = [
        [lngAt(i), latAt(j)],
        [lngAt(i + 1), latAt(j)],
        [lngAt(i + 1), latAt(j + 1)],
        [lngAt(i), latAt(j + 1)],
      ];
      const ts = [top[j]![i]!, top[j]![i + 1]!, top[j + 1]![i + 1]!, top[j + 1]![i]!];
      const bs = [bot[j]![i]!, bot[j]![i + 1]!, bot[j + 1]![i + 1]!, bot[j + 1]![i]!];
      push(
        corners.map(([lng, lat], n) => [lng, lat, ts[n]!] as [number, number, number]),
        (ts[0]! + ts[2]!) * 0.5,
      );
      push(
        corners.map(([lng, lat], n) => [lng, lat, bs[n]!] as [number, number, number]),
        (bs[0]! + bs[2]!) * 0.5,
      );
    }
  }
  const wall = (j0: number, i0: number, j1: number, i1: number) => {
    if (!valid(j0, i0) || !valid(j1, i1)) return;
    push(
      [
        [lngAt(i0), latAt(j0), top[j0]![i0]!],
        [lngAt(i1), latAt(j1), top[j1]![i1]!],
        [lngAt(i1), latAt(j1), bot[j1]![i1]!],
        [lngAt(i0), latAt(j0), bot[j0]![i0]!],
      ],
      (top[j0]![i0]! + top[j1]![i1]!) * 0.5,
    );
  };
  for (let i = 0; i < nx - 1; i++) {
    if (!envN[i] || !envN[i + 1]) continue;
    const j0 = Math.max(0, Math.min(ny - 1, Math.round(toeJ[i]!)));
    const j1 = Math.max(0, Math.min(ny - 1, Math.round(toeJ[i + 1]!)));
    if (valid(j0, i) && valid(j1, i + 1)) wall(j0, i, j1, i + 1);
    let s0 = -1;
    let s1 = -1;
    for (let j = 0; j < ny; j++) {
      if (s0 < 0 && valid(j, i)) s0 = j;
      if (s1 < 0 && valid(j, i + 1)) s1 = j;
    }
    if (s0 >= 0 && s1 >= 0) wall(s0, i, s1, i + 1);
  }
  SLAB_FACES = faces;
  return faces;
}

function drawSlab(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  try {
    if (!SLAB_FACES) {
      warmSlabFaces();
      return;
    }
    const faces = SLAB_FACES;
    const floor = BOX_FLOOR + 0.05;
    const cells: { pts: [number, number][]; z: number; km: number }[] = [];
    for (const f of faces) {
      const pts = f.c.map(([lng, lat, km]) => project(lng, lat, cam, w, h, Math.max(floor, depthAlt(km)))) as [number, number][];
      const a = f.c[0]!;
      cells.push({ pts, z: depthOf(a[0], a[1], cam, depthAlt(a[2])), km: f.km });
    }
    cells.sort((a, b) => a.z - b.z);
    for (const cell of cells) {
      fillQuad(g, cell.pts[0]!, cell.pts[1]!, cell.pts[2]!, cell.pts[3]!, slabFill(cell.km));
    }
  } catch {
    /* keep map alive */
  }
}

function drawOceanSurface(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  const blend = mapBlend(cam.zoom);
  g.save();
  g.beginPath();
  if (blend < 0.72) {
    const box: [number, number][] = [
      [BOX_WEST, BOX_SOUTH],
      [BOX_EAST, BOX_SOUTH],
      [BOX_EAST, BOX_NORTH],
      [BOX_WEST, BOX_NORTH],
    ];
    box.forEach(([lng, lat], i) => {
      const [x, y] = project(lng, lat, cam, w, h, 0);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
  } else {
    g.rect(-8, -8, w + 16, h + 16);
  }
  for (const ring of JAPAN_LAND) {
    ring.forEach(([lng, lat], i) => {
      const [x, y] = project(lng, lat, cam, w, h, 0);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.closePath();
  }
  g.clip("evenodd");
  g.fillStyle = "#1e6490";
  g.fillRect(-8, -8, w + 16, h + 16);
  const cols = cam.zoom < 9.2 ? 22 : 16;
  const rows = cam.zoom < 9.2 ? 18 : 12;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lng0 = BOX_WEST + (i / cols) * (BOX_EAST - BOX_WEST);
      const lat0 = BOX_SOUTH + (j / rows) * (BOX_NORTH - BOX_SOUTH);
      const lng1 = BOX_WEST + ((i + 1) / cols) * (BOX_EAST - BOX_WEST);
      const lat1 = BOX_SOUTH + ((j + 1) / rows) * (BOX_NORTH - BOX_SOUTH);
      const midLng = (lng0 + lng1) / 2;
      const midLat = (lat0 + lat1) / 2;
      if (insideLand(midLng, midLat)) continue;
      const km =
        (seafloorKm(lng0, lat0) + seafloorKm(lng1, lat0) + seafloorKm(lng1, lat1) + seafloorKm(lng0, lat1)) / 4;
      const corners: [number, number][] = [
        [lng0, lat0],
        [lng1, lat0],
        [lng1, lat1],
        [lng0, lat1],
      ];
      g.fillStyle = oceanFill(km);
      g.beginPath();
      corners.forEach(([lng, lat], n) => {
        const [x, y] = project(lng, lat, cam, w, h, 0);
        if (n === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.closePath();
      g.fill();
    }
  }
  g.restore();
}
const CLOUDS: { lng: number; lat: number; alt: number; rx: number; ry: number; drift: number; seed: number }[] = [
  { lng: 129.6, lat: 31.8, alt: 0.62, rx: 3.2, ry: 1.35, drift: 0.028, seed: 1 },
  { lng: 131.4, lat: 33.2, alt: 0.74, rx: 3.8, ry: 1.55, drift: 0.022, seed: 2 },
  { lng: 133.6, lat: 34.6, alt: 0.58, rx: 3.4, ry: 1.4, drift: 0.031, seed: 3 },
  { lng: 135.4, lat: 34.9, alt: 0.7, rx: 4.1, ry: 1.65, drift: 0.019, seed: 4 },
  { lng: 136.8, lat: 36.4, alt: 0.82, rx: 3.0, ry: 1.25, drift: 0.026, seed: 5 },
  { lng: 138.2, lat: 35.2, alt: 0.54, rx: 4.4, ry: 1.7, drift: 0.024, seed: 6 },
  { lng: 139.1, lat: 37.4, alt: 0.68, rx: 3.3, ry: 1.38, drift: 0.03, seed: 7 },
  { lng: 139.8, lat: 35.7, alt: 0.76, rx: 3.6, ry: 1.48, drift: 0.021, seed: 8 },
  { lng: 141.2, lat: 38.6, alt: 0.6, rx: 3.9, ry: 1.52, drift: 0.027, seed: 9 },
  { lng: 141.8, lat: 40.8, alt: 0.78, rx: 3.1, ry: 1.3, drift: 0.023, seed: 10 },
  { lng: 143.4, lat: 43.1, alt: 0.56, rx: 4.2, ry: 1.62, drift: 0.02, seed: 11 },
  { lng: 145.0, lat: 43.8, alt: 0.7, rx: 3.5, ry: 1.42, drift: 0.029, seed: 12 },
  { lng: 128.8, lat: 32.4, alt: 0.84, rx: 2.8, ry: 1.18, drift: 0.033, seed: 13 },
  { lng: 134.2, lat: 33.4, alt: 0.5, rx: 3.7, ry: 1.5, drift: 0.025, seed: 14 },
  { lng: 140.2, lat: 34.4, alt: 0.88, rx: 3.4, ry: 1.36, drift: 0.018, seed: 15 },
];

function drawClouds(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number, ts: number) {
  const tilt = effectiveTilt(cam);
  const blend = mapBlend(cam.zoom);
  const far = cam.zoom < 7.4;
  const vis =
    Math.min(1, 0.22 + tilt * 0.7) *
    (blend < 0.94 ? 1 : 0.35) *
    (far ? Math.max(0.12, (cam.zoom - 4.6) / 6) : 1);
  if (vis < 0.07) return;
  const unit = far ? 11 + cam.zoom * 0.6 : 14 + cam.zoom * 0.55;
  const t = ts * 0.001;
  const span = BOX_EAST - BOX_WEST + 10;
  g.save();
  for (const c of CLOUDS) {
    if (cam.zoom < 6.2 && c.seed % 3 !== 1) continue;
    if (cam.zoom < 7.6 && c.seed % 2 === 0) continue;
    const lng = BOX_WEST - 5 + ((((c.lng - (BOX_WEST - 5) + t * c.drift) % span) + span) % span);
    const bob = Math.sin(t * 0.35 + c.seed) * 0.04;
    const [x, y] = project(lng, c.lat + bob * 0.15, cam, w, h, c.alt + bob);
    if (x < -160 || y < -120 || x > w + 160 || y > h + 120) continue;
    const rx = c.rx * unit;
    const ry = c.ry * unit;
    const sway = Math.sin(t * 0.4 + c.seed * 0.7) * 0.08;
    g.fillStyle = "#f3f7fb";
    const puffs: [number, number, number, number, number][] = [
      [0, 0, 1, 1, 0.16 + sway],
      [-0.42, 0.1, 0.72, 0.82, -0.22],
      [0.4, -0.08, 0.68, 0.78, 0.3],
      [0.08, -0.22, 0.58, 0.7, 0.08],
    ];
    for (const [dx, dy, sx, sy, rot] of puffs) {
      g.globalAlpha = (far ? 0.11 : 0.18) * vis;
      g.beginPath();
      g.ellipse(x + dx * rx, y + dy * ry, rx * sx, ry * sy, rot, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function nearestPathIndex(pts: [number, number][], lng: number, lat: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = (pts[i]![0] - lng) * 91;
    const dy = (pts[i]![1] - lat) * 111;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function pathBetween(line: LineRuntime, from: { lng: number; lat: number }, to: { lng: number; lat: number }) {
  const a = nearestPathIndex(line.path, from.lng, from.lat);
  const b = nearestPathIndex(line.path, to.lng, to.lat);
  if (a === b) return [[from.lng, from.lat], [to.lng, to.lat]] as [number, number][];
  const step = a < b ? 1 : -1;
  const out: [number, number][] = [];
  for (let i = a; ; i += step) {
    out.push(line.path[i]!);
    if (i === b) break;
  }
  return out;
}

function clipFromTrain(pts: [number, number][], lng: number, lat: number) {
  if (pts.length < 2) return pts;
  const i = nearestPathIndex(pts, lng, lat);
  const rest = pts.slice(i);
  if (!rest.length) return [[lng, lat] as [number, number]];
  if (rest[0]![0] !== lng || rest[0]![1] !== lat) rest.unshift([lng, lat]);
  return rest;
}

function lineMatchesLeg(t: Train, leg: RouteLeg) {
  if (t.kind === "flight" || t.kind === "bus" || leg.kind !== "ride") return false;
  if (leg.lineId && t.lineId === leg.lineId) return true;
  const a = (leg.lineName ?? "").replace(/^JR/u, "").replace(/線$/u, "");
  const b = t.lineName.replace(/^JR/u, "").replace(/線$/u, "");
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function journeyAnchorNames(journey: Journey) {
  const names = new Set<string>();
  names.add(journey.origin.name);
  names.add(journey.dest.name);
  const rides = journey.legs.filter((l) => l.kind === "ride");
  rides.forEach((leg, i) => {
    if (i === 0) names.add(leg.from.name);
    names.add(leg.to.name);
    if (i > 0) names.add(leg.from.name);
  });
  return names;
}

function sameWay(t: Train, leg: RouteLeg, lines: LineRuntime[]) {
  const toward = (leg.toward ?? "").replace(/行き$/u, "").replace(/行$/u, "");
  if (toward && (t.dest === toward || t.dest.includes(toward) || toward.includes(t.dest))) return true;
  if (t.nextStop === leg.to.name) return true;
  if (t.prevStop === leg.to.name && t.nextStop !== leg.from.name) return false;
  const line = (leg.lineId ? lines.find((l) => l.id === leg.lineId) : undefined) ?? lines.find((l) => l.id === t.lineId);
  if (!line) return false;
  const fromI = line.stops.findIndex((s) => s.n === leg.from.name);
  const toI = line.stops.findIndex((s) => s.n === leg.to.name);
  if (fromI < 0 || toI < 0 || fromI === toI) return false;
  const want: 0 | 1 = toI > fromI ? 0 : 1;
  return t.dir === want;
}

function relatedTrainsForJourney(all: Train[], journey: Journey, selected: Train | null, lines: LineRuntime[]) {
  const now = simNow();
  const delay = journey.delayMin ?? 0;
  const index = useMapStore.getState().stationIndex;
  const used = new Set<string>();
  const out: Train[] = [];
  for (const leg of journey.legs) {
    if (leg.kind !== "ride") continue;
    const from = locateStation(leg.from.name, lines, index, leg.from);
    const to = locateStation(leg.to.name, lines, index, leg.to);
    const line = findLineForLeg(lines, index, { ...leg, from, to });
    let path = line ? sliceRailPath(line, from, to) : [];
    if (path.length < 3 && leg.path && leg.path.length > 2) path = leg.path.slice();
    const placed = placeTrainOnLeg({ ...leg, from, to }, line, path, now, delay);
    if (!placed) continue;
    if (used.has(placed.id)) continue;
    out.push(placed);
    used.add(placed.id);
  }
  if (selected && selected.kind !== "flight" && selected.id.startsWith("trip:") && !used.has(selected.id)) {
    const still = out.find((t) => t.lineName === selected.lineName);
    if (!still) out.unshift(selected);
  }
  return out;
}

function overlaySelectedTrain(list: Train[], sel: Train | null) {
  if (!sel || sel.kind === "flight") return list;
  const i = list.findIndex((t) => t.id === sel.id);
  if (i >= 0) {
    const cur = list[i]!;
    list[i] = {
      ...cur,
      delayMin: Math.max(cur.delayMin, sel.delayMin),
      delaySec: Math.max(cur.delaySec ?? 0, sel.delaySec ?? 0),
      delayAlert: Boolean(cur.delayAlert || sel.delayAlert),
      dest: sel.dest || cur.dest,
      boardHhmm: sel.boardHhmm ?? cur.boardHhmm,
      alightHhmm: sel.alightHhmm ?? cur.alightHhmm,
      fromPlatform: sel.fromPlatform ?? cur.fromPlatform,
      toPlatform: sel.toPlatform ?? cur.toPlatform,
    };
  } else if (inJapan(sel.lng, sel.lat)) list.push({ ...sel });
  return list;
}

let segsCache: { key: string; segs: { color: string; pts: [number, number][]; walk: boolean; minutes?: number; shop?: boolean }[] } = {
  key: "",
  segs: [],
};

function lineWithBoth(lines: LineRuntime[], fromName: string, toName: string, preferName = "") {
  const prefer = preferName.replace(/^JR/u, "").replace(/線$/u, "").replace(/アーバンパーク(?:ライン)?/u, "野田").trim();
  let named: LineRuntime | null = null;
  let namedSpan = Infinity;
  let any: LineRuntime | null = null;
  let anySpan = Infinity;
  for (const line of lines) {
    const ia = stopIndexByName(line, fromName);
    const ib = stopIndexByName(line, toName);
    if (ia < 0 || ib < 0 || ia === ib) continue;
    const span = Math.abs(ib - ia);
    const hit = Boolean(prefer) && (line.name.includes(prefer) || prefer.includes(line.name.replace(/^JR/u, "").replace(/線$/u, "")));
    if (hit && span < namedSpan) {
      named = line;
      namedSpan = span;
    }
    if (span < anySpan) {
      any = line;
      anySpan = span;
    }
  }
  return named ?? any;
}

function rideGlowPath(
  line: LineRuntime | null,
  fromName: string,
  toName: string,
): [number, number][] {
  if (!line) return [];
  const ia = stopIndexByName(line, fromName);
  const ib = stopIndexByName(line, toName);
  if (ia < 0 || ib < 0 || ia === ib) return [];
  const a = line.stops[ia]!;
  const b = line.stops[ib]!;
  return sliceRailPath(line, { lng: a.lng, lat: a.lat, name: a.n }, { lng: b.lng, lat: b.lat, name: b.n });
}

function remainingJourneySegs(lines: LineRuntime[]) {
  const store = useMapStore.getState();
  const journey = store.journey;
  const train = store.selectedTrain;
  const segs: { color: string; pts: [number, number][]; walk: boolean; minutes?: number; shop?: boolean }[] = [];
  const index = store.stationIndex;
  const here = store.userLocation;
  const key = journey
    ? `j:${journey.origin.name}|${journey.dest.name}|${journey.departHhmm}|${journey.arriveHhmm}|${journey.legs.map((l) => `${l.kind}:${l.from.name}>${l.to.name}`).join(",")}|${store.stayWalk ? 1 : 0}|${store.mateWalk ? 1 : 0}|${train?.id ?? ""}|${train ? train.lng.toFixed(3) : ""}|${here ? here.lng.toFixed(3) : ""}|${here ? here.lat.toFixed(3) : ""}|${lines.length}`
    : train && train.kind !== "flight"
      ? `t:${train.id}|${train.dest}|${train.lng.toFixed(3)}|${train.lat.toFixed(3)}|${lines.length}`
      : "";
  if (key && key === segsCache.key) return segsCache.segs;

  if (!journey) {
    if (!train || train.kind === "flight") {
      segsCache = { key, segs };
      return segs;
    }
    const line = lines.find((l) => l.id === train.lineId);
    if (!line) {
      segsCache = { key, segs };
      return segs;
    }
    const dest =
      line.stops.find((s) => s.n === train.dest) ??
      (train.dir === 1 && !line.loop ? line.stops[0] : line.stops[line.stops.length - 1]);
    if (!dest) {
      segsCache = { key, segs };
      return segs;
    }
    let pts = sliceRailPath(line, { lng: train.lng, lat: train.lat }, dest);
    if (pts.length >= 2) pts = clipFromTrain(pts, train.lng, train.lat);
    if (pts.length >= 2) segs.push({ color: train.color, pts, walk: false });
    segsCache = { key, segs };
    return segs;
  }

  const shopTrip = Boolean(journey.walkToDestMin);
  for (let i = 0; i < journey.legs.length; i++) {
    const leg = journey.legs[i]!;
    if (leg.kind === "walk") {
      const from =
        shopTrip && Number.isFinite(leg.from.lng) ? leg.from : locateStation(leg.from.name, lines, index, leg.from);
      const to = shopTrip && Number.isFinite(leg.to.lng) ? leg.to : locateStation(leg.to.name, lines, index, leg.to);
      const start = here && haversine([here.lng, here.lat], [to.lng, to.lat]) < haversine([from.lng, from.lat], [to.lng, to.lat]) + 0.02
        ? here
        : from;
      const hop = haversine([start.lng, start.lat], [to.lng, to.lat]);
      const shop = shopTrip && i === journey.legs.length - 1;
      if (shop && store.stayWalk) continue;
      if (!shop && hop > 1.8) continue;
      if (hop < 0.05) continue;
      const pts: [number, number][] = [
        [start.lng, start.lat],
        [to.lng, to.lat],
      ];
      segs.push({
        color: shop ? "#ffe08a" : CREAM,
        pts,
        walk: true,
        minutes: shop ? Math.max(1, Math.round(leg.minutes || journey.walkToDestMin || 0)) : undefined,
        shop,
      });
      continue;
    }
    const from = locateStation(leg.from.name, lines, index, leg.from);
    const to = locateStation(leg.to.name, lines, index, leg.to);
    const line = lineWithBoth(lines, leg.from.name, leg.to.name, leg.lineName ?? "");
    let pts = rideGlowPath(line, leg.from.name, leg.to.name);
    if (pts.length >= 2 && train && train.kind !== "flight") {
      const near = nearestPathIndex(pts, train.lng, train.lat);
      const d = haversine(pts[near] ?? pts[0]!, [train.lng, train.lat]);
      if (d < 1.2) pts = clipFromTrain(pts, train.lng, train.lat);
    }
    if (pts.length < 2 && shopTrip) {
      pts = [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ];
    }
    if (pts.length < 2) continue;
    segs.push({ color: line?.color || leg.color || CREAM, pts, walk: false });
  }
  segsCache = { key, segs };
  return segs;
}

function addPoly(path: Path2D, pts: [number, number][], cam: Cam, w: number, h: number, minPx: number) {
  const pad = 96;
  const min2 = minPx * minPx;
  let pen = false;
  let lx = 0;
  let ly = 0;
  const last = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = project(pts[i]![0], pts[i]![1], cam, w, h);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -pad || y < -pad || x > w + pad || y > h + pad) {
      pen = false;
      continue;
    }
    if (!pen) {
      path.moveTo(x, y);
      pen = true;
      lx = x;
      ly = y;
      continue;
    }
    const dx = x - lx;
    const dy = y - ly;
    if (i !== last && dx * dx + dy * dy < min2) continue;
    path.lineTo(x, y);
    lx = x;
    ly = y;
  }
}

function drawJourneyPulse(
  g: CanvasRenderingContext2D,
  cam: Cam,
  w: number,
  h: number,
  ts: number,
  lines: LineRuntime[],
  kind: "ride" | "walk" | "all" = "all",
) {
  const segs = remainingJourneySegs(lines).filter((seg) => kind === "all" || (kind === "walk" ? seg.walk : !seg.walk));
  if (!segs.length) return;
  const pulse = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(ts / 260));
  const minPx = cam.zoom >= 14.6 ? 1.4 : cam.zoom >= 12.4 ? 2.2 : 3.2;
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const seg of segs) {
    if (seg.walk) {
      if (seg.pts.length >= 2) {
        const a = seg.pts[0]!;
        const b = seg.pts[seg.pts.length - 1]!;
        const [x0, y0] = project(a[0], a[1], cam, w, h);
        const [x1, y1] = project(b[0], b[1], cam, w, h);
        if (Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1)) {
          const m = Math.round(haversine(a, b) * 1000);
          drawWalkGuide(g, x0, y0, x1, y1, seg.color, m);
        }
      }
      continue;
    }
    const path = new Path2D();
    addPoly(path, seg.pts, cam, w, h, minPx);
    g.globalAlpha = 0.28 + 0.4 * pulse;
    g.strokeStyle = glow(seg.color, 0.6);
    g.lineWidth = 12 + 6 * pulse;
    g.stroke(path);
    g.globalAlpha = 0.82 + 0.18 * pulse;
    g.strokeStyle = seg.color;
    g.lineWidth = 5.2 + 2.2 * pulse;
    g.stroke(path);
  }
  const delay = delaySeconds(useMapStore.getState().selectedTrain) || Math.round((useMapStore.getState().journey?.delayMin ?? 0) * 60);
  if (delay > 0) {
    const ride = segs.find((s) => !s.walk) ?? segs[0];
    if (ride?.pts.length) {
      const pt = ride.pts[Math.floor(ride.pts.length / 2)]!;
      const [x, y] = project(pt[0], pt[1], cam, w, h);
      drawDelayChip(g, x, y - 4, delay, useMapStore.getState().lang);
    }
  }
  g.restore();
}

function drawVolume(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  const floor = BOX_FLOOR;
  const corners: [number, number, number][] = [
    [BOX_WEST, BOX_SOUTH, floor],
    [BOX_EAST, BOX_SOUTH, floor],
    [BOX_EAST, BOX_NORTH, floor],
    [BOX_WEST, BOX_NORTH, floor],
    [BOX_WEST, BOX_SOUTH, 0],
    [BOX_EAST, BOX_SOUTH, 0],
    [BOX_EAST, BOX_NORTH, 0],
    [BOX_WEST, BOX_NORTH, 0],
  ];
  const pts = corners.map(([lng, lat, alt]) => {
    const [x, y] = project(lng, lat, cam, w, h, alt);
    return { x, y, z: depthOf(lng, lat, cam, alt) };
  });
  const faces: { i: number[]; fill: string }[] = [
    { i: [0, 1, 2, 3], fill: "#071c36" },
    { i: [0, 1, 5, 4], fill: "rgba(22, 86, 132, 0.78)" },
    { i: [1, 2, 6, 5], fill: "rgba(18, 74, 118, 0.82)" },
    { i: [2, 3, 7, 6], fill: "rgba(16, 68, 110, 0.8)" },
    { i: [3, 0, 4, 7], fill: "rgba(20, 80, 124, 0.76)" },
    { i: [4, 5, 6, 7], fill: "rgba(48, 128, 180, 0.12)" },
  ];
  faces.sort((a, b) => {
    const za = a.i.reduce((s, i) => s + pts[i]!.z, 0);
    const zb = b.i.reduce((s, i) => s + pts[i]!.z, 0);
    return zb - za;
  });
  for (const face of faces) {
    const a = pts[face.i[0]!]!;
    const b = pts[face.i[1]!]!;
    const c = pts[face.i[2]!]!;
    const d = pts[face.i[3]!]!;
    g.fillStyle = face.fill;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.lineTo(c.x, c.y);
    g.lineTo(d.x, d.y);
    g.closePath();
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 1;
    g.stroke();
  }
  g.strokeStyle = "rgba(255,255,255,0.04)";
  g.lineWidth = 0.7;
  for (let lng = 125; lng <= 145; lng += 5) {
    g.beginPath();
    const [x0, y0] = project(lng, BOX_SOUTH, cam, w, h, 0);
    const [x1, y1] = project(lng, BOX_NORTH, cam, w, h, 0);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.beginPath();
    const [x2, y2] = project(lng, BOX_SOUTH, cam, w, h, floor);
    g.moveTo(x0, y0);
    g.lineTo(x2, y2);
    g.stroke();
  }
  for (let lat = 25; lat <= 45; lat += 5) {
    g.beginPath();
    const [x0, y0] = project(BOX_WEST, lat, cam, w, h, 0);
    const [x1, y1] = project(BOX_EAST, lat, cam, w, h, 0);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  const walls: [[number, number], [number, number]][] = [
    [
      [BOX_WEST, BOX_SOUTH],
      [BOX_EAST, BOX_SOUTH],
    ],
    [
      [BOX_EAST, BOX_SOUTH],
      [BOX_EAST, BOX_NORTH],
    ],
    [
      [BOX_EAST, BOX_NORTH],
      [BOX_WEST, BOX_NORTH],
    ],
    [
      [BOX_WEST, BOX_NORTH],
      [BOX_WEST, BOX_SOUTH],
    ],
  ];
  g.lineCap = "round";
  const bands = [0, 50, 100, 200];
  for (let i = 0; i < bands.length - 1; i++) {
    const a0 = i === 0 ? 0 : depthAlt(bands[i]!);
    const a1 = depthAlt(bands[i + 1]!);
    g.fillStyle = geoFill((bands[i]! + bands[i + 1]!) / 2, 0.22);
    for (const [a, b] of walls) {
      const p0 = project(a[0], a[1], cam, w, h, a0);
      const p1 = project(b[0], b[1], cam, w, h, a0);
      const p2 = project(b[0], b[1], cam, w, h, a1);
      const p3 = project(a[0], a[1], cam, w, h, a1);
      fillQuad(g, p0, p1, p2, p3, geoFill((bands[i]! + bands[i + 1]!) / 2, 0.2));
    }
  }
  for (const km of DEPTH_MARKS) {
    const alt = depthAlt(km);
    g.strokeStyle = "rgba(186, 220, 255, 0.38)";
    g.lineWidth = km === 200 ? 1.15 : 0.7;
    for (const [a, b] of walls) {
      const [x0, y0] = project(a[0], a[1], cam, w, h, alt);
      const [x1, y1] = project(b[0], b[1], cam, w, h, alt);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
  }
  g.font = "600 10px ui-sans-serif, sans-serif";
  g.textAlign = "left";
  g.textBaseline = "middle";
  for (const km of DEPTH_MARKS) {
    const alt = depthAlt(km);
    const [x, y] = project(BOX_EAST, BOX_SOUTH, cam, w, h, alt);
    const label = `-${km}km`;
    g.fillStyle = "rgba(8, 24, 40, 0.62)";
    g.fillRect(x + 5, y - 7, 52, 14);
    g.fillStyle = "rgba(210, 232, 255, 0.92)";
    g.fillText(label, x + 8, y);
  }
}

function trackAngle(bearing: number, yaw: number) {
  const br = (bearing * Math.PI) / 180;
  const fx = Math.sin(br);
  const fy = -Math.cos(br);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return Math.atan2(fx * s + fy * c, fx * c - fy * s);
}

function fillBoxAlong(
  og: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  L: number,
  W: number,
  H: number,
  color: string,
) {
  og.fillStyle = liftColor(color, -0.3);
  og.beginPath();
  og.moveTo(x0 - L / 2, y0 + W / 2);
  og.lineTo(x0 + L / 2, y0 + W / 2);
  og.lineTo(x0 + L / 2 + 1.3, y0 + W / 2 + H * 0.42);
  og.lineTo(x0 - L / 2 + 1.3, y0 + W / 2 + H * 0.42);
  og.closePath();
  og.fill();
  og.fillStyle = liftColor(color, 0.22);
  og.beginPath();
  roundRectPath(og, x0 - L / 2, y0 - W / 2 - H, L, W, 1);
  og.fill();
  og.fillStyle = color;
  og.beginPath();
  roundRectPath(og, x0 - L / 2, y0 - W / 2 - H * 0.28, L, W, 1);
  og.fill();
}

function strokeBoxAlong(
  og: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  L: number,
  W: number,
  H: number,
) {
  og.beginPath();
  roundRectPath(og, x0 - L / 2, y0 - W / 2 - H * 0.28, L, W, 1);
  og.stroke();
}

type RailBodyKind = "shinkansen" | "jr" | "subway" | "bus";

function railDims(kind: RailBodyKind) {
  if (kind === "shinkansen") return { L: 13.4, W: 3.3, H: 2.75, pan: true };
  if (kind === "subway") return { L: 7.5, W: 4.35, H: 3.2, pan: false };
  if (kind === "bus") return { L: 10.2, W: 5.3, H: 4.4, pan: false };
  return { L: 12.2, W: 4.65, H: 3.8, pan: true };
}

function railKindOf(kind: Train["kind"]): RailBodyKind {
  if (kind === "shinkansen") return "shinkansen";
  if (kind === "subway") return "subway";
  if (kind === "bus") return "bus";
  return "jr";
}

function drawWindows(og: CanvasRenderingContext2D, L: number, W: number, H: number, n: number) {
  og.fillStyle = "rgba(18, 32, 48, 0.42)";
  const pad = Math.max(2.4, L * 0.12);
  const span = L - pad * 2;
  const ww = Math.max(1.1, span / n - 0.7);
  const y = -W / 2 - H * 0.62;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + pad + i * (span / n);
    og.fillRect(x, y, ww, W * 0.34);
  }
}

function drawPantograph(og: CanvasRenderingContext2D, x: number, roof: number, k: number) {
  og.strokeStyle = "rgba(24, 28, 32, 0.8)";
  og.lineWidth = 0.9;
  og.beginPath();
  og.moveTo(x - 2.4 * k, roof);
  og.lineTo(x, roof - 3.1 * k);
  og.lineTo(x + 2.4 * k, roof);
  og.stroke();
  og.beginPath();
  og.moveTo(x - 2.1 * k, roof - 3.1 * k);
  og.lineTo(x + 2.1 * k, roof - 3.1 * k);
  og.stroke();
}

function drawRailBody(
  og: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  color: string,
  kind: RailBodyKind,
  scale: number,
  followed: boolean,
) {
  const d = railDims(kind);
  const k = scale;
  const L = d.L * k;
  const W = d.W * k;
  const H = d.H * k;
  og.save();
  og.translate(x, y);
  og.rotate(ang);
  og.fillStyle = glow(color, followed ? 0.38 : 0.14);
  og.beginPath();
  og.arc(0, 0, (followed ? 11 : 4.8) * Math.max(0.55, k), 0, Math.PI * 2);
  og.fill();
  og.fillStyle = "rgba(0,0,0,0.28)";
  og.beginPath();
  og.ellipse(1.1, 2.0, L * 0.4, W * 0.34, 0, 0, Math.PI * 2);
  og.fill();
  fillBoxAlong(og, 0, 0, L, W, H, color);
  const roof = -W / 2 - H;
  if (kind === "shinkansen") {
    const n = L * 0.3;
    og.fillStyle = liftColor(color, 0.2);
    og.beginPath();
    og.moveTo(L / 2 - 0.4, -W / 2 - H * 0.28);
    og.lineTo(L / 2 + n, -H * 0.22);
    og.lineTo(L / 2 - 0.4, W / 2 - H * 0.28);
    og.closePath();
    og.fill();
    og.fillStyle = liftColor(color, -0.28);
    og.beginPath();
    og.moveTo(L / 2 - 0.4, W / 2);
    og.lineTo(L / 2 + n, W * 0.12);
    og.lineTo(L / 2 - 0.4, W / 2 + H * 0.4);
    og.closePath();
    og.fill();
    og.strokeStyle = liftColor(color, -0.55);
    og.lineWidth = 0.85;
    og.beginPath();
    og.moveTo(L / 2 - 0.4, -W / 2 - H * 0.28);
    og.lineTo(L / 2 + n, -H * 0.22);
    og.lineTo(L / 2 - 0.4, W / 2 - H * 0.28);
    og.stroke();
    og.fillStyle = liftColor(color, 0.45);
    og.fillRect(-L * 0.32, -W / 2 - H * 0.18, L * 0.72, 1.05 * k);
    drawWindows(og, L * 0.82, W, H, 8);
  } else if (kind === "subway") {
    og.fillStyle = liftColor(color, 0.12);
    og.beginPath();
    og.ellipse(L / 2, -H * 0.18, W * 0.42, W * 0.48, 0, -Math.PI / 2, Math.PI / 2);
    og.fill();
    og.beginPath();
    og.ellipse(-L / 2, -H * 0.18, W * 0.38, W * 0.46, 0, Math.PI / 2, -Math.PI / 2);
    og.fill();
    drawWindows(og, L * 0.78, W, H, 3);
  } else if (kind === "bus") {
    og.fillStyle = "rgba(18, 28, 38, 0.5)";
    og.fillRect(L / 2 - 2.4 * k, -W / 2 - H * 0.7, 2 * k, W * 0.42);
    og.fillStyle = liftColor(color, -0.45);
    og.beginPath();
    og.ellipse(-L * 0.28, W / 2 + 0.6, 1.5 * k, 1.05 * k, 0, 0, Math.PI * 2);
    og.ellipse(L * 0.26, W / 2 + 0.6, 1.5 * k, 1.05 * k, 0, 0, Math.PI * 2);
    og.fill();
    drawWindows(og, L * 0.84, W, H, 4);
  } else {
    og.fillStyle = liftColor(color, 0.16);
    og.beginPath();
    og.moveTo(L / 2, -W / 2 - H * 0.28);
    og.lineTo(L / 2 + 2.2 * k, -H * 0.05);
    og.lineTo(L / 2, W / 2 - H * 0.28);
    og.closePath();
    og.fill();
    drawWindows(og, L * 0.8, W, H, 5);
  }
  if (d.pan) drawPantograph(og, -L * 0.16, roof, k);
  if (followed) {
    og.strokeStyle = CREAM;
    og.lineWidth = 1.1;
    og.beginPath();
    roundRectPath(og, -L / 2 - 1.4, roof - 1.2, L + 2.8, W + H + 2.2, 1.5);
    og.stroke();
  }
  og.restore();
}

function findAirport(name?: string) {
  if (!name) return null;
  return AIRPORTS.find((a) => a.n === name || a.id === name) ?? null;
}

function airportKm(lng: number, lat: number, ap: { lng: number; lat: number } | null) {
  if (!ap) return Infinity;
  return haversine([lng, lat], [ap.lng, ap.lat]);
}

function nearestAirportKm(lng: number, lat: number) {
  let best = Infinity;
  for (const ap of AIRPORTS) {
    const d = haversine([lng, lat], [ap.lng, ap.lat]);
    if (d < best) best = d;
  }
  return best;
}

const FLIGHT_CRUISE = 0.56;

function altClimb(km: number) {
  if (km < 1.1) return 0.016 + km * 0.035;
  if (km < 10) return 0.055 + (km - 1.1) * 0.032;
  if (km < 36) return 0.34 + (km - 10) * 0.0075;
  return FLIGHT_CRUISE;
}

function altLand(km: number) {
  if (km < 1.4) return 0.012 + km * 0.012;
  if (km < 7) return 0.03 + (km - 1.4) * 0.02;
  if (km < 22) return 0.142 + (km - 7) * 0.011;
  if (km < 70) return 0.307 + (km - 22) * 0.0051;
  return FLIGHT_CRUISE;
}

function flightProfile(t: Train) {
  const dest = findAirport(t.dest) ?? findAirport(t.nextStop);
  const from = findAirport(t.prevStop);
  const kmDest = airportKm(t.lng, t.lat, dest);
  const kmFrom = airportKm(t.lng, t.lat, from);
  const near = Math.min(kmDest, kmFrom, nearestAirportKm(t.lng, t.lat));
  const landing = kmDest < 85 && kmDest <= kmFrom + 6;
  const takingOff = !landing && kmFrom < 42;
  const alt = landing ? altLand(kmDest) : takingOff ? altClimb(kmFrom) : near < 18 ? altLand(near) : FLIGHT_CRUISE;
  const slack = Math.max(0, (FLIGHT_CRUISE - alt) / FLIGHT_CRUISE);
  const pitch = takingOff ? 0.46 * slack : landing ? -0.4 * slack : 0;
  return { alt, pitch };
}

function vehicleAlt(t: Train) {
  if (t.kind !== "flight") return 0;
  return flightProfile(t).alt;
}

function flightPitchOf(t: Train) {
  return flightProfile(t).pitch;
}

function flightRoll(bearing: number, progress: number) {
  return Math.sin((bearing * Math.PI) / 90 + progress * 5.4) * 0.22;
}

export function flightCode(t: Train): string {
  if (!t.id.startsWith("fly:")) {
    const call = t.lineName.replace(/[^A-Za-z0-9]/g, "");
    if (call.length >= 3 && call.length <= 8) return call.toUpperCase();
    return t.lineName || t.id.slice(-6);
  }
  let seed = 0;
  for (let i = 0; i < t.id.length; i++) seed = (seed * 33 + t.id.charCodeAt(i)) >>> 0;
  const carriers = ["JL", "NH", "MM", "GK", "BC"];
  return `${carriers[seed % carriers.length]}${100 + (seed % 880)}`;
}

export function flightRoute(t: Train, lang: Lang) {
  let from = displayName(t.prevStop, lang) || t.prevStop;
  let to = displayName(t.dest || t.nextStop, lang) || t.dest || t.nextStop;
  if ((!from || !to || from === to) && t.lineName.includes("–")) {
    const [a, b] = t.lineName.split("–");
    from = from && from !== to ? from : displayName((a ?? "").trim(), lang);
    to = to && to !== from ? to : displayName((b ?? "").trim(), lang);
  }
  if (from && to && from !== to) {
    return lang === "en" ? `${from} → ${to}` : lang === "zh" ? `${from} → ${to}` : `${from}発 → ${to}着`;
  }
  if (to) return lang === "zh" ? `飞往${to}` : lang === "en" ? `To ${to}` : `${to}行き`;
  if (from) return lang === "zh" ? `${from}出发` : lang === "en" ? `From ${from}` : `${from}発`;
  return "";
}

function drawPlane(og: CanvasRenderingContext2D, x: number, y: number, gx: number, gy: number, color: string, bearing: number, followed: boolean, zoom: number, yaw = 0, tilt = 0.55, scale = 1, pitch = 0) {
  if (zoom < 7.2 && !followed) {
    const r = zoom < 5.6 ? 1.4 : zoom < 6.4 ? 1.65 : 2;
    og.save();
    og.fillStyle = color;
    og.beginPath();
    og.arc(x, y, r, 0, Math.PI * 2);
    og.fill();
    og.restore();
    return;
  }
  const k = (followed ? 1.22 : 1) * (0.92 + Math.min(0.62, Math.max(0, zoom - 7.2) * 0.11)) * Math.max(0.9, scale);
  const heading = trackAngle(bearing, yaw);
  const vis = Math.hypot(x - gx, y - gy);
  const mix = Math.min(1, vis / 16);
  const inv = vis > 0.001 ? 1 / vis : 0;
  let ux = mix * (x - gx) * inv;
  let uy = mix * (y - gy) * inv + (1 - mix) * -1;
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul;
  uy /= ul;
  const roll = flightRoll(bearing, 0.5);
  const fx0 = Math.cos(heading);
  const fy0 = Math.sin(heading);
  const rx0 = -fy0;
  const ry0 = fx0;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const fx = fx0 * cp + ux * sp;
  const fy = fy0 * cp + uy * sp;
  const ux1 = ux * cp - fx0 * sp;
  const uy1 = uy * cp - fy0 * sp;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const rx = rx0 * cr + ux1 * sr;
  const ry = ry0 * cr + uy1 * sr;
  const ux2 = ux1 * cr - rx0 * sr;
  const uy2 = uy1 * cr - ry0 * sr;
  const basis = { fx, fy, rx, ry, ux: ux2, uy: uy2 };
  const squash = 0.42 + 0.58 * Math.cos(Math.min(1.2, tilt));
  og.save();
  drawPlaneMesh(og, x, y, basis, k, squash, color, followed);
  og.restore();
}

function p3(
  b: { fx: number; fy: number; rx: number; ry: number; ux: number; uy: number },
  ox: number,
  oy: number,
  f: number,
  r: number,
  u: number,
): [number, number] {
  return [ox + b.fx * f + b.rx * r + b.ux * u, oy + b.fy * f + b.ry * r + b.uy * u];
}

function fillPoly(g: CanvasRenderingContext2D, pts: [number, number][], color: string) {
  if (pts.length < 3) return;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
  g.fill();
}

function strokePoly(g: CanvasRenderingContext2D, pts: [number, number][], color: string, width: number) {
  if (pts.length < 2) return;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
  g.closePath();
  g.stroke();
}

function drawBox3(
  g: CanvasRenderingContext2D,
  b: { fx: number; fy: number; rx: number; ry: number; ux: number; uy: number },
  ox: number,
  oy: number,
  f0: number,
  f1: number,
  r0: number,
  r1: number,
  u0: number,
  u1: number,
  color: string,
  outline = true,
) {
  const P = (f: number, r: number, u: number) => p3(b, ox, oy, f, r, u);
  const bot: [number, number][] = [P(f0, r0, u0), P(f1, r0, u0), P(f1, r1, u0), P(f0, r1, u0)];
  const top: [number, number][] = [P(f0, r0, u1), P(f1, r0, u1), P(f1, r1, u1), P(f0, r1, u1)];
  const sideL: [number, number][] = [P(f0, r0, u0), P(f1, r0, u0), P(f1, r0, u1), P(f0, r0, u1)];
  const sideR: [number, number][] = [P(f0, r1, u0), P(f1, r1, u0), P(f1, r1, u1), P(f0, r1, u1)];
  const nose: [number, number][] = [P(f1, r0, u0), P(f1, r1, u0), P(f1, r1, u1), P(f1, r0, u1)];
  const tail: [number, number][] = [P(f0, r0, u0), P(f0, r1, u0), P(f0, r1, u1), P(f0, r0, u1)];
  fillPoly(g, bot, liftColor(color, -0.48));
  fillPoly(g, tail, liftColor(color, -0.32));
  fillPoly(g, sideL, liftColor(color, -0.24));
  fillPoly(g, sideR, liftColor(color, -0.06));
  fillPoly(g, nose, liftColor(color, 0.16));
  fillPoly(g, top, liftColor(color, 0.2));
  if (outline) strokePoly(g, top, liftColor(color, -0.55), 0.85);
}

function drawPlaneMesh(
  g: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  b: { fx: number; fy: number; rx: number; ry: number; ux: number; uy: number },
  k: number,
  squash: number,
  color: string,
  followed: boolean,
) {
  const s = k * (0.78 + squash * 0.22);
  const body = liftColor(color, 0.06);
  drawBox3(g, b, ox, oy, -6.6 * s, 6.4 * s, -1.45 * s, 1.45 * s, -1.05 * s, 1.15 * s, body);
  drawBox3(g, b, ox, oy, -1.15 * s, 1.35 * s, -7.4 * s, 7.4 * s, -0.32 * s, 0.38 * s, liftColor(color, -0.04));
  drawBox3(g, b, ox, oy, -6.5 * s, -4.7 * s, -0.28 * s, 0.28 * s, 0.2 * s, 3.4 * s, liftColor(color, 0.1));
  drawBox3(g, b, ox, oy, -6.45 * s, -5.05 * s, -2.7 * s, 2.7 * s, 0.55 * s, 1.05 * s, liftColor(color, 0.02));
  const nose: [number, number][] = [
    p3(b, ox, oy, 6.4 * s, -1.1 * s, -0.4 * s),
    p3(b, ox, oy, 6.4 * s, 1.1 * s, -0.4 * s),
    p3(b, ox, oy, 8.1 * s, 0, 0.15 * s),
  ];
  fillPoly(g, nose, liftColor(color, 0.28));
  strokePoly(g, nose, liftColor(color, -0.5), 0.8);
  g.fillStyle = "rgba(190, 220, 235, 0.55)";
  for (let i = -3; i <= 3; i++) {
    const f = i * 1.15 * s;
    const win: [number, number][] = [
      p3(b, ox, oy, f - 0.28 * s, -1.15 * s, 0.35 * s),
      p3(b, ox, oy, f + 0.28 * s, -1.15 * s, 0.35 * s),
      p3(b, ox, oy, f + 0.28 * s, -1.15 * s, 0.78 * s),
      p3(b, ox, oy, f - 0.28 * s, -1.15 * s, 0.78 * s),
    ];
    fillPoly(g, win, "rgba(210, 232, 244, 0.7)");
  }
  if (followed) {
    g.strokeStyle = CREAM;
    g.globalAlpha = 0.85;
    g.lineWidth = 1.05;
    g.beginPath();
    g.arc(ox, oy, 9.2 * s, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }
}

function drawFlightGround(
  g: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  x: number,
  y: number,
  heading: number,
  alt: number,
  zoom: number,
  tilt: number,
  followed: boolean,
  ts: number,
) {
  if (zoom < 6.2 && !followed) return;
  const k = 0.7 + Math.min(0.35, Math.max(0, zoom - 6.5) * 0.08);
  const rx = (2.1 * k) * (1 + alt * 0.55) * (followed ? 1.12 : 1);
  const ry = Math.max(0.9, rx * (0.28 + 0.22 * Math.cos(Math.min(1.25, tilt))));
  const alpha = (followed ? 0.28 : 0.18) / (0.85 + alt * 1.4);
  g.save();
  g.translate(gx, gy);
  g.rotate(heading);
  g.fillStyle = `rgba(4, 8, 14, ${alpha})`;
  g.beginPath();
  g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  if (!followed && zoom < 8.2) return;

  const glowA = (followed ? 0.34 : 0.2) + alt * 0.18;
  g.save();
  g.strokeStyle = `rgba(186, 220, 255, ${glowA * 0.55})`;
  g.lineWidth = followed ? 2.4 : 1.7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(gx, gy);
  g.lineTo(x, y);
  g.stroke();
  g.strokeStyle = `rgba(236, 248, 255, ${0.32 + alt * 0.28 + (followed ? 0.12 : 0)})`;
  g.lineWidth = 0.8;
  g.setLineDash([2.6, 3.8]);
  g.lineDashOffset = -(ts / 90);
  g.beginPath();
  g.moveTo(gx, gy);
  g.lineTo(x, y);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = `rgba(210, 232, 255, ${0.4 + (followed ? 0.2 : 0)})`;
  g.beginPath();
  g.ellipse(gx, gy, 2.1 * k, Math.max(1.1, 2.1 * k * 0.45), heading, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawMarineLife(
  g: CanvasRenderingContext2D,
  cam: Cam,
  w: number,
  h: number,
  ts: number,
  bounds: { west: number; east: number; south: number; north: number },
) {
  const lod = marineLod(cam.zoom, cam.tilt);
  if (lod < 0.04) return;
  const tSec = ts * 0.001;
  const k = 1.7 + Math.min(2.4, Math.max(0, cam.zoom - 7) * 0.28);
  const drawn: {
    actor: (typeof MARINE_ACTORS)[number];
    x: number;
    y: number;
    alt: number;
    ang: number;
    pose: ReturnType<typeof marinePose>;
  }[] = [];
  for (const actor of MARINE_ACTORS) {
    if (!zoneHits(actor.zone, bounds)) continue;
    const pose = marinePose(actor, tSec);
    if (insideLand(pose.lng, pose.lat)) continue;
    const floor = seafloorAlt(pose.lng, pose.lat);
    const alt = actor.floor ? Math.min(floor + 0.022, -0.035) : Math.min(-0.025, Math.max(floor + 0.07, pose.alt));
    const [x, y] = project(pose.lng, pose.lat, cam, w, h, alt);
    if (x < -48 || y < -48 || x > w + 48 || y > h + 48) continue;
    drawn.push({ actor, x, y, alt, ang: trackAngle(pose.bearing, cam.yaw) + pose.roll * 0.35, pose });
  }
  drawn.sort((a, b) => a.alt - b.alt);
  g.save();
  g.globalAlpha = 0.82 + 0.18 * lod;
  for (const d of drawn) {
    const { actor, x, y, ang, pose } = d;
    if (actor.kind === "humpback" || actor.kind === "sperm") drawWhale(g, x, y, ang, k, actor.kind === "sperm", pose.beat, pose.surface, pose.pitch);
  }
  g.restore();
}

function drawWhale(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  ang: number,
  k: number,
  sperm: boolean,
  beat: number,
  surface: boolean,
  pitch: number,
) {
  const color = sperm ? "#3a4652" : "#5e7384";
  const L = (sperm ? 26 : 22) * k;
  const W = (sperm ? 7.2 : 5.6) * k * (1 + pitch * 0.12);
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.fillStyle = "rgba(8, 18, 28, 0.22)";
  g.beginPath();
  g.ellipse(2 * k, 7 * k, L * 0.38, W * 0.35, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(sperm ? 1.6 * k : 0.6 * k, 0, L * 0.5, W * 0.5, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = liftColor(color, sperm ? 0.1 : 0.14);
  g.beginPath();
  g.ellipse(L * 0.28, 0, (sperm ? 7.2 : 5.4) * k, (sperm ? 4.4 : 3.4) * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = liftColor(color, -0.06);
  g.beginPath();
  g.ellipse(0.4 * k, W * 0.15, 2.6 * k, (sperm ? 6.2 : 8.4) * k, beat * 0.08, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(-L * 0.48, 0);
  g.rotate(beat * 0.42);
  g.fillStyle = liftColor(color, -0.1);
  g.beginPath();
  g.moveTo(1.4 * k, 0);
  g.lineTo(-3.8 * k, -7.8 * k);
  g.lineTo(-1.2 * k, 0);
  g.lineTo(-3.8 * k, 7.8 * k);
  g.closePath();
  g.fill();
  g.strokeStyle = liftColor(color, -0.45);
  g.lineWidth = 1;
  g.stroke();
  g.restore();
  g.strokeStyle = liftColor(color, -0.52);
  g.lineWidth = Math.max(1, 0.95 * k * 0.16);
  g.beginPath();
  g.ellipse(sperm ? 1.6 * k : 0.6 * k, 0, L * 0.5, W * 0.5, 0, 0, Math.PI * 2);
  g.stroke();
  if (surface) {
    g.fillStyle = "rgba(230, 244, 252, 0.55)";
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.arc(L * 0.22 + i * 1.1 * k, -W * 0.7 - (i % 3) * 1.4 * k, (0.7 + (i % 2) * 0.45) * k, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}

function drawWhaleShark(g: CanvasRenderingContext2D, x: number, y: number, ang: number, k: number, beat: number) {
  const color = "#2c5162";
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.fillStyle = "rgba(8, 18, 28, 0.2)";
  g.beginPath();
  g.ellipse(0, 6.5 * k, 10 * k, 2.4 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(0.8 * k, 0, 13.2 * k, 3.2 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = liftColor(color, 0.12);
  g.beginPath();
  g.ellipse(9.4 * k, 0, 4.2 * k, 3.6 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = liftColor(color, 0.04);
  g.beginPath();
  g.ellipse(1.2 * k, 0, 2.2 * k, 6.8 * k, beat * 0.06, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(-11.4 * k, 0);
  g.rotate(beat * 0.28);
  g.fillStyle = liftColor(color, -0.08);
  g.beginPath();
  g.moveTo(1.2 * k, 0);
  g.lineTo(-3.2 * k, -5.6 * k);
  g.lineTo(-0.6 * k, 0);
  g.lineTo(-3.2 * k, 5.6 * k);
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = "rgba(236, 232, 214, 0.82)";
  for (const [dx, dy] of [
    [-5.6, -0.8],
    [-2.2, 0.9],
    [1.4, -0.7],
    [4.8, 0.8],
    [0.2, -1.4],
    [7.2, -0.2],
    [-3.6, 1.2],
    [6.2, 1.1],
  ] as const) {
    g.beginPath();
    g.arc(dx * k, dy * k, 0.78 * k, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = liftColor(color, -0.48);
  g.lineWidth = 1.05;
  g.beginPath();
  g.ellipse(0.8 * k, 0, 13.2 * k, 3.2 * k, 0, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function drawRay(g: CanvasRenderingContext2D, x: number, y: number, ang: number, k: number, beat: number) {
  const color = "#c4a06a";
  const flap = 1 + beat * 0.16;
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.fillStyle = "rgba(40, 24, 10, 0.28)";
  g.beginPath();
  g.ellipse(0, 3.2 * k, 8 * k, 2.2 * k, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(7.2 * k, 0);
  g.quadraticCurveTo(0, -9.4 * k * flap, -4.2 * k, 0);
  g.quadraticCurveTo(0, 9.4 * k * flap, 7.2 * k, 0);
  g.fill();
  g.fillStyle = liftColor(color, -0.12);
  g.beginPath();
  g.moveTo(-3.6 * k, 0);
  g.lineTo(-12.2 * k, -0.6 * k);
  g.lineTo(-3.6 * k, 0.8 * k);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(48, 28, 12, 0.75)";
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(7.2 * k, 0);
  g.quadraticCurveTo(0, -9.4 * k * flap, -4.2 * k, 0);
  g.quadraticCurveTo(0, 9.4 * k * flap, 7.2 * k, 0);
  g.stroke();
  g.restore();
}

function drawBottomFish(g: CanvasRenderingContext2D, x: number, y: number, ang: number, k: number, seed: number, tSec: number) {
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.fillStyle = "rgba(40, 24, 10, 0.22)";
  g.beginPath();
  g.ellipse(0, 4 * k, 9 * k, 2.4 * k, 0, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 6; i++) {
    const dart = 0.55 + 0.45 * Math.max(0, Math.sin(tSec * 1.4 + seed * 6 + i));
    const a = seed * 5 + i * 1.05 + tSec * 0.22 * dart;
    const fx = Math.cos(a) * 6.2 * k * dart;
    const fy = Math.sin(a * 0.8) * 2.8 * k;
    g.save();
    g.translate(fx, fy);
    g.rotate(Math.sin(a) * 0.35);
    g.fillStyle = i % 2 ? "#d7b56a" : "#9a7a48";
    g.beginPath();
    g.ellipse(0, 0, 4.4 * k, 1.7 * k, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(40, 24, 8, 0.7)";
    g.lineWidth = 0.8;
    g.stroke();
    g.restore();
  }
  g.restore();
}

function quakeAlt(q: Quake) {
  return depthAlt(q.depthKm);
}

function drawQuakeMarks(
  g: CanvasRenderingContext2D,
  cam: Cam,
  w: number,
  h: number,
  ts: number,
  quakes: Quake[],
  selectedId: string | null,
) {
  const ordered = [...quakes].sort((a, b) => a.depthKm - b.depthKm);
  const red = "#e11d2a";
  type Mark = { q: Quake; gx: number; gy: number; hx: number; hy: number; selected: boolean; far: boolean };
  const marks: Mark[] = [];
  for (const q of ordered) {
    const [gx, gy] = project(q.lng, q.lat, cam, w, h, 0);
    const hypo = benioffPoint(q.lng, q.lat, q.depthKm);
    let [hx, hy] = project(hypo.lng, hypo.lat, cam, w, h, hypo.alt);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
    const selected = q.id === selectedId;
    const epiOn = gx >= -48 && gy >= -48 && gx <= w + 48 && gy <= h + 48;
    if (!epiOn && !selected) continue;
    if (!Number.isFinite(hx) || !Number.isFinite(hy)) {
      hx = gx;
      hy = gy + 56;
    }
    const pad = 30;
    const hypoOn = hx >= pad && hy >= pad && hx <= w - pad && hy <= h - pad;
    if (!hypoOn) {
      let t0 = 0;
      let t1 = 1;
      for (let i = 0; i < 14; i++) {
        const t = (t0 + t1) / 2;
        const x = hx + (gx - hx) * t;
        const y = hy + (gy - hy) * t;
        if (x >= pad && y >= pad && x <= w - pad && y <= h - pad) t1 = t;
        else t0 = t;
      }
      hx += (gx - hx) * t1;
      hy += (gy - hy) * t1;
    }
    marks.push({ q, gx, gy, hx, hy, selected, far: cam.zoom < 7.6 });
  }
  type Slot = { x: number; y: number; tw: number; th: number; mark: Mark; label: string };
  const slots: Slot[] = [];
  g.font = "700 11px ui-sans-serif, sans-serif";
  const hits = (x: number, y: number, tw: number, th: number) =>
    slots.some((s) => Math.abs(x - s.x) < (tw + s.tw) * 0.5 + 6 && Math.abs(y - s.y) < th * 0.5 + s.th * 0.5 + 4);
  const labeled = [...marks].sort((a, b) => (Number(b.selected) - Number(a.selected)) || b.q.mag - a.q.mag);
  for (const mark of labeled) {
    const label = `M${mark.q.mag.toFixed(1)}  ${Math.round(mark.q.depthKm)}km`;
    g.font = `700 ${mark.selected || mark.far ? 12 : 10}px ui-sans-serif, sans-serif`;
    const tw = g.measureText(label).width + 10;
    const th = 16;
    const tries: [number, number][] = [
      [0, -22],
      [tw * 0.55 + 10, -8],
      [-(tw * 0.55 + 10), -8],
      [0, 18],
      [tw * 0.4, -36],
      [-(tw * 0.4), -36],
      [0, -50],
      [tw * 0.7, 16],
      [-(tw * 0.7), 16],
    ];
    let placed = false;
    for (const [dx, dy] of tries) {
      const x = mark.hx + dx;
      const y = mark.hy + dy;
      if (x < 8 || y < 8 || x > w - 8 || y > h - 8) continue;
      if (hits(x, y, tw, th)) continue;
      slots.push({ x, y, tw, th, mark, label });
      placed = true;
      break;
    }
    if (!placed) {
      let y = mark.hy - 22;
      let guard = 0;
      while (hits(mark.hx, y, tw, th) && guard++ < 12) y -= th + 4;
      slots.push({ x: mark.hx, y, tw, th, mark, label });
    }
  }
  for (const mark of marks) {
    const { q, gx, gy, hx, hy, selected, far } = mark;
    const pulse = ((ts / 1100 + q.at / 60000) % 1 + 1) % 1;
    const k = far ? 1.85 : 1;
    g.save();
    for (let i = 0; i < 3; i++) {
      const t = (pulse + i / 3) % 1;
      const rx = (14 + t * 62) * (selected ? 1.12 : 1) * k;
      const ry = rx * (0.36 + cam.tilt * 0.2);
      g.strokeStyle = red;
      g.globalAlpha = (selected ? 0.7 : far ? 0.58 : 0.42) * (1 - t);
      g.lineWidth = (selected ? 2.4 : far ? 2.2 : 1.4) * (far ? 1.15 : 1);
      g.beginPath();
      g.ellipse(gx, gy, rx, Math.max(3.5, ry), 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = selected ? 0.95 : 0.86;
    g.strokeStyle = red;
    g.lineWidth = selected ? 2.4 : far ? 2 : 1.35;
    g.setLineDash([2.4, 3.2]);
    g.beginPath();
    g.moveTo(gx, gy);
    g.lineTo(hx, hy);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = red;
    g.beginPath();
    g.arc(gx, gy, selected ? 4.2 : far ? 4.4 : 2.7, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(hx, hy, selected ? 5.2 : far ? 5 : 3.5, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,220,220,0.7)";
    g.lineWidth = 0.9;
    g.stroke();
    g.restore();
  }
  for (const slot of slots) {
    const { mark, label, x, y, tw } = slot;
    g.save();
    g.globalAlpha = mark.selected ? 1 : 0.96;
    if (Math.hypot(x - mark.hx, y - mark.hy) > 16) {
      g.strokeStyle = "rgba(255, 180, 180, 0.55)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(mark.hx, mark.hy);
      g.lineTo(x, y);
      g.stroke();
    }
    g.font = `700 ${mark.selected || mark.far ? 12 : 10}px ui-sans-serif, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "rgba(24,8,8,0.82)";
    g.beginPath();
    roundRectPath(g, x - tw / 2, y - 8, tw, 16, 5);
    g.fill();
    g.fillStyle = "#ffd6d6";
    g.fillText(label, x, y);
    g.restore();
  }
}

function drawWeatherBeacons(
  g: CanvasRenderingContext2D,
  spots: WeatherSpot[],
  cam: Cam,
  w: number,
  h: number,
  ts: number,
) {
  if (!spots.length) return;
  const k = cam.zoom < 6.2 ? 1.4 : 1.05;
  const loc = useMapStore.getState().lang;
  const t = copies[loc];
  g.save();
  g.textAlign = "center";
  g.textBaseline = "top";
  g.font = `700 ${cam.zoom < 6.4 ? 11 : 10}px ui-sans-serif, sans-serif`;
  for (const s of spots) {
    const severe = s.kind === "thunder" || s.kind === "tornado";
    if (cam.zoom > 8.7 && !severe) continue;
    const [x, y] = project(s.lng, s.lat, cam, w, h, 0.04);
    if (x < -40 || y < -40 || x > w + 40 || y > h + 40) continue;
    if (s.kind === "tornado") {
      g.strokeStyle = "rgba(220, 150, 80, 0.95)";
      g.lineWidth = 1.6 * k;
      g.beginPath();
      g.moveTo(x, y - 12 * k);
      g.lineTo(x + 5 * k, y + 6 * k);
      g.lineTo(x - 3 * k, y + 6 * k);
      g.closePath();
      g.stroke();
      g.fillStyle = "rgba(200, 120, 40, 0.35)";
      g.fill();
    } else if (s.kind === "thunder") {
      const flash = 0.45 + 0.55 * Math.max(0, Math.sin(ts / 90 + s.lat));
      g.fillStyle = `rgba(255, 220, 80, ${flash})`;
      g.beginPath();
      g.moveTo(x + 1 * k, y - 12 * k);
      g.lineTo(x - 4 * k, y - 1 * k);
      g.lineTo(x + 1 * k, y - 1 * k);
      g.lineTo(x - 2 * k, y + 8 * k);
      g.lineTo(x + 5 * k, y - 3 * k);
      g.lineTo(x, y - 3 * k);
      g.closePath();
      g.fill();
      continue;
    } else if (s.kind === "rain") {
      g.strokeStyle = "rgba(186, 224, 255, 0.88)";
      g.lineWidth = 1.6 * k;
      g.lineCap = "round";
      for (let i = 0; i < 5; i++) {
        const ox = (i - 2) * 3.4 * k;
        const drop = ((ts / 240 + i * 0.18) % 1) * 10 * k;
        g.beginPath();
        g.moveTo(x + ox, y - 10 * k + drop);
        g.lineTo(x + ox - 2.2 * k, y - 2 * k + drop);
        g.stroke();
      }
    } else if (s.kind === "snow") {
      g.fillStyle = "rgba(240, 248, 255, 0.92)";
      for (let i = 0; i < 6; i++) {
        const a = ts / 700 + i * 1.05;
        g.beginPath();
        g.arc(x + Math.cos(a) * 7 * k, y + Math.sin(a * 1.3) * 5 * k, 1.5 * k, 0, Math.PI * 2);
        g.fill();
      }
    } else if (s.kind === "cloud") {
      g.fillStyle = "rgba(210, 220, 230, 0.55)";
      g.beginPath();
      g.ellipse(x, y - 4 * k, 9 * k, 4.2 * k, 0, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = "rgba(255, 214, 120, 0.8)";
      g.beginPath();
      g.arc(x, y - 3 * k, 3.4 * k, 0, Math.PI * 2);
      g.fill();
    }
    const tag = severe
      ? `${Math.round(s.temp)}° ${s.kind === "tornado" ? t.weatherTornado : t.weatherThunder}`
      : `${Math.round(s.temp)}°`;
    const tw = g.measureText(tag).width;
    g.fillStyle = severe ? "rgba(80, 16, 10, 0.86)" : "rgba(10, 14, 20, 0.7)";
    g.beginPath();
    roundRectPath(g, x - tw / 2 - 4, y + 8 * k, tw + 8, 14, 4);
    g.fill();
    g.fillStyle = severe ? "#ffd4c4" : CREAM;
    g.fillText(tag, x, y + 10 * k);
  }
  g.restore();
}

const LANDMARKS: Array<{
  id: "tower" | "skytree";
  n: string;
  lng: number;
  lat: number;
  z: number;
}> = [
  { id: "tower", n: "東京タワー", lng: 139.7454, lat: 35.6586, z: 6.2 },
  { id: "skytree", n: "東京スカイツリー", lng: 139.8107, lat: 35.7101, z: 6.2 },
];

function landmarkScale(zoom: number) {
  return Math.max(0.55, Math.min(1.15, 0.62 + (zoom - 6) * 0.08));
}

function drawLandmarkLabel(g: CanvasRenderingContext2D, x: number, y: number, name: string) {
  const label = displayName(name, useMapStore.getState().lang);
  g.save();
  g.font = mapFont(10.5, 700);
  g.textAlign = "center";
  g.textBaseline = "top";
  const tw = g.measureText(label).width;
  const bw = tw + 10;
  const bh = 15;
  const bx = x - bw / 2;
  const by = y + 4;
  g.fillStyle = "rgba(18, 22, 16, 0.78)";
  g.beginPath();
  roundRectPath(g, bx, by, bw, bh, 7);
  g.fill();
  g.fillStyle = CREAM;
  g.fillText(label, x, by + 1.5);
  g.restore();
}

function peakScreen(
  cam: Cam,
  w: number,
  h: number,
  peak: Peak,
  k: number,
) {
  const scale = Math.max(0.28, peak.h / FUJI_H);
  const halfDeg = 0.09 * peak.width * Math.max(0.4, Math.pow(scale, 0.82));
  const alt = 0.072 * Math.max(0.3, scale);
  const [gx, gy] = project(peak.lng, peak.lat, cam, w, h, 0);
  const [lx] = project(peak.lng - halfDeg, peak.lat, cam, w, h, 0);
  const [rx] = project(peak.lng + halfDeg, peak.lat, cam, w, h, 0);
  const [, py] = project(peak.lng, peak.lat, cam, w, h, alt);
  const half = Math.max(cam.zoom < 7.2 ? 7 : 4, Math.min(48, Math.abs(rx - lx) / 2));
  const rise = Math.max(cam.zoom < 7.2 ? 8 : 6, Math.min(38, gy - py));
  return { gx, gy, half, rise, k, scale };
}

function pt(base: { gx: number; gy: number; half: number; rise: number }, x: number, y: number): [number, number] {
  return [base.gx + x * base.half, base.gy - y * base.rise];
}

function snowFill(g: CanvasRenderingContext2D, peak: Peak, base: { gx: number; gy: number; half: number; rise: number }, left: [number, number], summit: [number, number], right: [number, number]) {
  if (peak.h < 1700) return;
  const snow = peak.h >= 2800 ? 0.38 : peak.h >= 2200 ? 0.3 : 0.22;
  const sL: [number, number] = [summit[0] + (left[0] - summit[0]) * snow, summit[1] + (left[1] - summit[1]) * snow];
  const sR: [number, number] = [summit[0] + (right[0] - summit[0]) * snow, summit[1] + (right[1] - summit[1]) * snow];
  const sM: [number, number] = [summit[0] + (base.gx + 0.1 * base.half - summit[0]) * snow * 0.7, summit[1] + (base.gy - summit[1]) * snow * 0.7];
  fillPoly(g, [sL, summit, sM], "#e8e4dc");
  fillPoly(g, [sM, summit, sR], "#fffaf2");
}

function drawPeakMark(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number, k: number, peak: Peak, showName: boolean) {
  const geo = peakScreen(cam, w, h, peak, k);
  if (geo.gx < -90 || geo.gy < -90 || geo.gx > w + 90 || geo.gy > h + 90) return;
  const { gx, gy, half, rise } = geo;
  const P = (x: number, y: number) => pt(geo, x, y);
  const dark = peak.shape === "crater" ? "#6a7050" : peak.shape === "forest" ? "#4f7a45" : "#5f7d4c";
  const lite = peak.shape === "crater" ? "#8a9468" : peak.shape === "forest" ? "#6f9a58" : "#7ea35f";
  g.save();
  g.beginPath();
  g.ellipse(gx, gy + 2 * k, half * 0.92, 3.2 * k * Math.max(0.5, geo.scale), 0, 0, Math.PI * 2);
  g.fillStyle = "rgba(20, 32, 18, 0.22)";
  g.fill();

  if (peak.shape === "spear") {
    const L = P(-0.38, 0);
    const R = P(0.38, 0);
    const M = P(0.06, 0);
    const S = P(peak.lean, 1);
    fillPoly(g, [L, S, M], dark);
    fillPoly(g, [M, S, R], lite);
    snowFill(g, peak, geo, L, S, R);
    strokePoly(g, [L, S, R], "rgba(32, 28, 22, 0.35)", 1);
  } else if (peak.shape === "saw") {
    const a = P(-1, 0);
    const b = P(-0.55, 0.58);
    const c = P(-0.22, 0.34);
    const d = P(peak.lean * 0.2, 1);
    const e = P(0.38, 0.48);
    const f = P(0.62, 0.72);
    const z = P(1, 0);
    const mid = P(0.08, 0);
    fillPoly(g, [a, b, c, d, mid], dark);
    fillPoly(g, [mid, d, e, f, z], lite);
    if (peak.h >= 1800) {
      const S = d;
      const sL: [number, number] = [S[0] + (c[0] - S[0]) * 0.28, S[1] + (c[1] - S[1]) * 0.28];
      const sR: [number, number] = [S[0] + (e[0] - S[0]) * 0.28, S[1] + (e[1] - S[1]) * 0.28];
      fillPoly(g, [sL, S, sR], "#fffaf2");
    }
    strokePoly(g, [a, b, c, d, e, f, z], "rgba(32, 28, 22, 0.35)", 1);
  } else if (peak.shape === "ridge") {
    const a = P(-1.05, 0);
    const b = P(-0.62, 0.7);
    const c = P(-0.18, 0.52);
    const d = P(0.08 + peak.lean, 1);
    const e = P(0.55, 0.62);
    const f = P(1.05, 0);
    const mid = P(0.1, 0);
    fillPoly(g, [a, b, c, d, mid], dark);
    fillPoly(g, [mid, d, e, f], lite);
    snowFill(g, peak, geo, c, d, e);
    const s2 = P(-0.62, 0.7);
    if (peak.h >= 2000) fillPoly(g, [P(-0.78, 0.42), s2, P(-0.4, 0.42)], "#e8e4dc");
    strokePoly(g, [a, b, c, d, e, f], "rgba(32, 28, 22, 0.35)", 1);
  } else if (peak.shape === "crater") {
    const L = P(-1, 0);
    const R = P(1, 0);
    const mid = P(0.12, 0);
    const cl = P(-0.22 + peak.lean, 0.82);
    const cr = P(0.28 + peak.lean, 0.82);
    const dip = P(0.04 + peak.lean, 0.62);
    fillPoly(g, [L, cl, dip, mid], dark);
    fillPoly(g, [mid, dip, cr, R], lite);
    g.fillStyle = "#5a5348";
    g.beginPath();
    g.ellipse(gx + peak.lean * half, gy - rise * 0.7, half * 0.18, rise * 0.08, 0, 0, Math.PI * 2);
    g.fill();
    if (peak.id === "sakurajima" || peak.id === "asama") {
      g.fillStyle = "rgba(210, 210, 206, 0.55)";
      g.beginPath();
      g.ellipse(gx + peak.lean * half, gy - rise * 1.08, half * 0.16, rise * 0.14, 0, 0, Math.PI * 2);
      g.fill();
    }
    strokePoly(g, [L, cl, dip, cr, R], "rgba(32, 28, 22, 0.35)", 1);
  } else if (peak.shape === "caldera") {
    const a = P(-1.05, 0);
    const b = P(-0.72, 0.42);
    const c = P(-0.28, 0.22);
    const d = P(0.12 + peak.lean, 0.7);
    const e = P(0.55, 0.28);
    const f = P(0.82, 0.48);
    const z = P(1.05, 0);
    const mid = P(0.05, 0);
    fillPoly(g, [a, b, c, d, mid], dark);
    fillPoly(g, [mid, d, e, f, z], lite);
    g.fillStyle = "rgba(70, 90, 72, 0.35)";
    g.beginPath();
    g.ellipse(gx, gy - rise * 0.18, half * 0.42, rise * 0.1, 0, 0, Math.PI * 2);
    g.fill();
    strokePoly(g, [a, b, c, d, e, f, z], "rgba(32, 28, 22, 0.35)", 1);
  } else if (peak.shape === "forest") {
    const a = P(-1, 0);
    const b = P(-0.62, 0.55);
    const c = P(-0.18, 0.38);
    const d = P(0.08, 0.92);
    const e = P(0.48, 0.5);
    const f = P(0.78, 0.7);
    const z = P(1, 0);
    const mid = P(0.1, 0);
    fillPoly(g, [a, b, c, d, mid], dark);
    fillPoly(g, [mid, d, e, f, z], lite);
    g.fillStyle = "#3f6b3a";
    g.beginPath();
    g.arc(gx - half * 0.35, gy - rise * 0.22, half * 0.16, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(gx + half * 0.22, gy - rise * 0.18, half * 0.14, 0, Math.PI * 2);
    g.fill();
    strokePoly(g, [a, b, c, d, e, f, z], "rgba(32, 28, 22, 0.35)", 1);
  } else {
    const L = P(-1, 0);
    const R = P(1, 0);
    const M = P(0.12 + peak.lean * 0.2, 0);
    const S = P(peak.lean, 1);
    fillPoly(g, [L, S, M], dark);
    fillPoly(g, [M, S, R], lite);
    snowFill(g, peak, geo, L, S, R);
    strokePoly(g, [L, S, R], "rgba(32, 28, 22, 0.35)", 1);
  }
  g.restore();
  if (showName) drawLandmarkLabel(g, gx, gy + 3 * k, peakLabel(peak, useMapStore.getState().lang));
}

function drawTokyoTowerMark(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number, k: number) {
  const lng = 139.7454;
  const lat = 35.6586;
  const [gx, gy] = project(lng, lat, cam, w, h, 0);
  const [, ty] = project(lng, lat, cam, w, h, 0.0064);
  if (gx < -60 || gy < -60 || gx > w + 60 || gy > h + 60) return;
  const H = Math.max(6, Math.min(18, gy - ty));
  const base = Math.max(1.2, H * 0.2);
  g.save();
  g.fillStyle = "rgba(20, 24, 18, 0.2)";
  g.beginPath();
  g.ellipse(gx, gy + 1, base * 1.15, 1.6 * k, 0, 0, Math.PI * 2);
  g.fill();
  const x = gx;
  const y = gy;
  const body = (y0: number, y1: number, w0: number, w1: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x - w0, y0);
    g.lineTo(x + w0, y0);
    g.lineTo(x + w1, y1);
    g.lineTo(x - w1, y1);
    g.closePath();
    g.fill();
  };
  body(y, y - H * 0.38, base, base * 0.62, "#d4532a");
  body(y - H * 0.18, y - H * 0.26, base * 0.78, base * 0.7, "#f4efe4");
  body(y - H * 0.38, y - H * 0.62, base * 0.62, base * 0.38, "#e05d33");
  g.fillStyle = "#f4efe4";
  g.fillRect(x - base * 0.55, y - H * 0.48, base * 1.1, 2.2 * k);
  g.fillStyle = "#ffd089";
  g.beginPath();
  roundRectPath(g, x - base * 0.42, y - H * 0.7, base * 0.84, 3.4 * k, 1);
  g.fill();
  body(y - H * 0.7, y - H * 0.88, base * 0.22, base * 0.1, "#d4532a");
  g.strokeStyle = "#f7f1e6";
  g.lineWidth = 1.1 * k;
  g.beginPath();
  g.moveTo(x, y - H * 0.88);
  g.lineTo(x, y - H);
  g.stroke();
  g.fillStyle = "#ffe08a";
  g.beginPath();
  g.arc(x, y - H, 1.35 * k, 0, Math.PI * 2);
  g.fill();
  g.restore();
  drawLandmarkLabel(g, gx, gy + 3, "東京タワー");
}

function drawSkytreeMark(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number, k: number) {
  const lng = 139.8107;
  const lat = 35.7101;
  const [gx, gy] = project(lng, lat, cam, w, h, 0);
  const [, ty] = project(lng, lat, cam, w, h, 0.012);
  if (gx < -60 || gy < -60 || gx > w + 60 || gy > h + 60) return;
  const H = Math.max(8, Math.min(28, gy - ty));
  const base = Math.max(1.1, H * 0.11);
  g.save();
  g.fillStyle = "rgba(20, 24, 18, 0.2)";
  g.beginPath();
  g.ellipse(gx, gy + 1, base * 1.4, 1.5 * k, 0, 0, Math.PI * 2);
  g.fill();
  const x = gx;
  const y = gy;
  g.fillStyle = "#6aa3c2";
  g.beginPath();
  g.moveTo(x - base, y);
  g.lineTo(x + base, y);
  g.lineTo(x + base * 0.42, y - H * 0.55);
  g.lineTo(x - base * 0.42, y - H * 0.55);
  g.closePath();
  g.fill();
  g.fillStyle = "#8ec4dc";
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + base, y);
  g.lineTo(x + base * 0.42, y - H * 0.55);
  g.lineTo(x, y - H * 0.55);
  g.closePath();
  g.fill();
  g.fillStyle = "#f3f6f8";
  g.beginPath();
  g.ellipse(x, y - H * 0.62, Math.max(1.8, H * 0.14), Math.max(1.2, H * 0.1), 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(40, 64, 80, 0.35)";
  g.lineWidth = 0.8;
  g.stroke();
  g.fillStyle = "#5b97b6";
  g.beginPath();
  g.moveTo(x - base * 0.28, y - H * 0.7);
  g.lineTo(x + base * 0.28, y - H * 0.7);
  g.lineTo(x + 0.7 * k, y - H * 0.9);
  g.lineTo(x - 0.7 * k, y - H * 0.9);
  g.closePath();
  g.fill();
  g.strokeStyle = "#d7eef6";
  g.lineWidth = 1.05 * k;
  g.beginPath();
  g.moveTo(x, y - H * 0.9);
  g.lineTo(x, y - H);
  g.stroke();
  g.fillStyle = "#c8ecf6";
  g.beginPath();
  g.arc(x, y - H, 1.2 * k, 0, Math.PI * 2);
  g.fill();
  g.restore();
  drawLandmarkLabel(g, gx, gy + 3, "東京スカイツリー");
}

function drawLandmarks(g: CanvasRenderingContext2D, cam: Cam, w: number, h: number) {
  const k = landmarkScale(cam.zoom);
  const layer = useMapStore.getState().mountainLayer;
  const selected = useMapStore.getState().selectedPeak;
  const radarOn = useMapStore.getState().radarEnabled;
  if (!radarOn) {
    const ordered = PEAKS.map((p) => ({ p, z: depthOf(p.lng, p.lat, cam, 0) })).sort((a, b) => b.z - a.z);
    for (const { p } of ordered) {
      drawPeakMark(g, cam, w, h, k, p, Boolean(selected && selected.id === p.id));
    }
  }
  if (layer) return;
  const items = LANDMARKS.filter((m) => cam.zoom >= m.z - 0.8)
    .map((m) => ({ m, z: depthOf(m.lng, m.lat, cam, 0) }))
    .sort((a, b) => b.z - a.z);
  for (const { m } of items) {
    if (m.id === "tower") drawTokyoTowerMark(g, cam, w, h, k);
    else drawSkytreeMark(g, cam, w, h, k);
  }
}

function drawKonbiniPin(g: CanvasRenderingContext2D, x: number, y: number, color: string, short: string, selected: boolean, scale = 1) {
  g.save();
  g.translate(x, y);
  const s = Math.max(0.65, Math.min(2.8, scale));
  g.scale(s, s);
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, -2, selected ? 9 : 7, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = selected ? "#fff6d8" : "rgba(255,255,255,0.9)";
  g.lineWidth = selected ? 2 : 1.3;
  g.stroke();
  g.fillStyle = "#fff";
  g.font = `800 ${selected ? 11 : 9}px ui-sans-serif, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(short, 0, -1.5);
  g.restore();
}

function markScale(lng: number, lat: number, cam: Cam, w: number, h: number) {
  const [x, y] = project(lng, lat, cam, w, h);
  const [x2, y2] = project(lng, lat + 14 / 111_000, cam, w, h);
  return Math.max(0.7, Math.min(2.8, Math.hypot(x2 - x, y2 - y) / 11));
}

function drawWalkGuide(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  meters: number,
) {
  g.save();
  g.setLineDash([9, 6]);
  g.strokeStyle = color;
  g.globalAlpha = 0.95;
  g.lineWidth = 2.8;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const tip = `${Math.round(meters)}m`;
  g.font = mapFont(12, 700);
  g.textAlign = "center";
  g.textBaseline = "middle";
  const tw = g.measureText(tip).width;
  g.fillStyle = "rgba(12,18,24,0.88)";
  g.beginPath();
  roundRectPath(g, mx - tw / 2 - 7, my - 9, tw + 14, 18, 8);
  g.fill();
  g.fillStyle = CREAM;
  g.fillText(tip, mx, my);
  g.restore();
}

function drawStayPin(g: CanvasRenderingContext2D, x: number, y: number, selected: boolean, scale = 1) {
  g.save();
  g.translate(x, y);
  const s = Math.max(0.65, Math.min(2.8, scale));
  g.scale(s, s);
  g.fillStyle = selected ? "#ffe08a" : "#c9a15b";
  g.beginPath();
  g.moveTo(0, 7);
  g.quadraticCurveTo(9, -1, 0, -14);
  g.quadraticCurveTo(-9, -1, 0, 7);
  g.closePath();
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1.1;
  g.stroke();
  g.fillStyle = selected ? "#3a2a10" : "#1a140c";
  g.beginPath();
  g.moveTo(0, -12);
  g.lineTo(4.2, -6.5);
  g.lineTo(-4.2, -6.5);
  g.closePath();
  g.fill();
  g.fillStyle = selected ? "#fff6d8" : "#f3e6c4";
  g.fillRect(-2.6, -6.5, 5.2, 4.4);
  g.restore();
}

const DELAY_RED = "#e4453a";

function delayText(sec: number, lang: Lang) {
  const t = copies[lang];
  return `${t.delay} ${sec}${t.sec}`;
}

function tapStatusLine(t: Train, loc: Lang, txt: Copy) {
  const from = t.prevStop ? displayName(t.prevStop, loc) : "";
  const next = displayName(t.nextStop || t.dest || t.prevStop, loc);
  const arr = arrivalCompare(t, simNow(), txt, loc);
  const bits: string[] = [];
  if (from) bits.push(`${from}${txt.departAt}`);
  if (next) bits.push(`${txt.nextStop}${next}`);
  if (arr) bits.push(arr);
  return bits.join(" ");
}

type CardTone = "head" | "next" | "alight" | "xfer" | "delay" | "time";
type CardPart = { text: string; extra?: string; extraAlert?: boolean; tone: CardTone };

function trainCardParts(t: Train, loc: Lang, txt: Copy, journey: Journey | null, on: boolean): CardPart[] {
  const guide = journey && on && t.kind !== "flight" ? journeyGuide(journey, t, txt) : null;
  const parts: CardPart[] = guide
    ? guide.steps.map((s) => ({
        text: s.text,
        extra: s.extra,
        extraAlert: s.extraAlert,
        tone: (s.kind === "head" ? "head" : s.kind === "xfer" ? "xfer" : s.kind === "time" ? "time" : "alight") as CardTone,
      }))
    : t.kind === "flight"
      ? ([
          { text: flightCode(t), tone: "head" },
          { text: flightRoute(t, loc) || `${txt.flyTo} ${displayName(t.dest || t.nextStop, loc)}`, tone: "next" },
        ] as CardPart[]).filter((p) => p.text)
      : ([
          {
            text: rideHeadline(
              { lineName: t.lineName, toward: t.dest, to: { name: t.dest, lng: 0, lat: 0, prefecture: "" } },
              txt,
              loc,
            ),
            tone: "head",
          },
          {
            text: tapStatusLine(t, loc, txt),
            tone: delaySeconds(t) > 0 || t.delayAlert ? "delay" : "next",
          },
        ] as CardPart[]);
  return parts.filter((p) => p.text);
}

function cardZoomScale(zoom: number) {
  if (zoom < 9.2) return 0;
  if (zoom < 11) return (zoom - 9.2) / 1.8;
  return Math.min(2.15, 1 + (zoom - 11) * 0.16);
}

function drawTrainCard(
  ctx: CanvasRenderingContext2D,
  t: Train,
  x: number,
  y: number,
  viewW: number,
  parts: CardPart[],
  zoom = 12,
) {
  const sc = cardZoomScale(zoom);
  if (sc <= 0.04) return;
  ctx.save();
  ctx.translate(x, y + 12);
  ctx.scale(sc, sc);
  ctx.translate(-x, -(y + 12));
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const maxW = Math.min(460, Math.max(240, viewW * 0.88));
  const wrapRow = (row: string, font: string, limit: number) => {
    ctx.font = font;
    if (ctx.measureText(row).width <= limit) return [row];
    const lines: string[] = [];
    let cur = "";
    for (const ch of row) {
      const next = cur + ch;
      if (cur && ctx.measureText(next).width > limit) {
        lines.push(cur);
        cur = ch;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const isFly = t.kind === "flight";
  const extraFont = "500 11.5px ui-sans-serif, sans-serif";
  ctx.font = extraFont;
  const extraMax = Math.max(0, ...parts.map((p) => (p.extra ? ctx.measureText(p.extra).width : 0)));
  const titleLimit = Math.max(110, maxW - (extraMax ? extraMax + 14 : 0));
  const fitHead = (text: string) => {
    for (const px of [13, 12, 11, 10]) {
      const font = `700 ${px}px ui-sans-serif, sans-serif`;
      ctx.font = font;
      if (ctx.measureText(text).width <= titleLimit) return font;
    }
    return "700 10px ui-sans-serif, sans-serif";
  };
  const fontOf = (tone: string, text = "") =>
    tone === "head" || tone === "xfer"
      ? isFly
        ? "700 14px ui-sans-serif, sans-serif"
        : fitHead(text)
      : tone === "time"
        ? "500 12.5px ui-sans-serif, ui-monospace, monospace"
        : isFly
          ? "600 14.5px ui-sans-serif, sans-serif"
          : "500 12.5px ui-sans-serif, sans-serif";
  const rows: CardPart[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    if (part.tone === "head" || part.tone === "xfer") {
      rows.push(part);
      continue;
    }
    const wrapped = wrapRow(part.text, fontOf(part.tone, part.text), part.extra ? titleLimit : maxW);
    wrapped.forEach((text, i) =>
      rows.push({
        text,
        extra: i === 0 ? part.extra : undefined,
        extraAlert: i === 0 ? part.extraAlert : undefined,
        tone: part.tone,
      }),
    );
  }
  const tw = Math.max(
    0,
    ...rows.map((row) => {
      ctx.font = fontOf(row.tone, row.text);
      const left = ctx.measureText(row.text).width;
      ctx.font = extraFont;
      const right = row.extra ? ctx.measureText(row.extra).width + 12 : 0;
      return left + right;
    }),
  );
  const rowH = (tone: string) => (tone === "head" || tone === "xfer" ? 18 : 16);
  const cardW = Math.min(maxW + 24, Math.max(240, tw + 24));
  const cardH = 12 + rows.reduce((n, row) => n + rowH(row.tone), 0);
  const cx0 = Math.max(6, Math.min(viewW - cardW - 6, x - cardW / 2));
  const cy0 = y + 12;
  ctx.fillStyle = "rgba(10,14,24,0.94)";
  ctx.beginPath();
  ctx.moveTo(x, y + 7);
  ctx.lineTo(Math.max(cx0 + 8, Math.min(cx0 + cardW - 8, x - 5)), cy0);
  ctx.lineTo(Math.max(cx0 + 8, Math.min(cx0 + cardW - 8, x + 5)), cy0);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  roundRectPath(ctx, cx0, cy0, cardW, cardH, 6);
  ctx.fill();
  ctx.fillStyle = t.color;
  ctx.fillRect(cx0, cy0 + 4, 3.5, cardH - 8);
  let yy = cy0 + 6;
  rows.forEach((row) => {
    ctx.fillStyle =
      row.tone === "delay"
        ? DELAY_RED
        : "#ffffff";
    ctx.font = fontOf(row.tone, row.text);
    ctx.textAlign = "left";
    ctx.fillText(row.text, cx0 + 10, yy);
    if (row.extra) {
      ctx.font = extraFont;
      ctx.fillStyle = row.extraAlert ? DELAY_RED : "#ffffff";
      ctx.textAlign = "right";
      ctx.fillText(row.extra, cx0 + cardW - 8, yy + 2);
      ctx.textAlign = "left";
    }
    yy += rowH(row.tone);
  });
  ctx.restore();
}

function drawDelayChip(g: CanvasRenderingContext2D, x: number, y: number, sec: number, lang: Lang) {
  const text = sec > 0 ? delayText(sec, lang) : copies[lang].delay;
  g.save();
  g.font = "700 10px ui-sans-serif, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "top";
  const tw = g.measureText(text).width;
  const padX = 4.5;
  const w = tw + padX * 2;
  const h = 14;
  const bx = x - w / 2;
  const by = y + 7;
  g.fillStyle = "rgba(28, 8, 8, 0.82)";
  g.beginPath();
  roundRectPath(g, bx, by, w, h, 3);
  g.fill();
  g.fillStyle = DELAY_RED;
  g.fillText(text, x, by + 2);
  g.restore();
}

function vehicleZoomScale(zoom: number) {
  const t = 2 ** ((zoom - 11) * 0.28);
  return Math.max(0.34, Math.min(2.05, t));
}

function drawVehicle(
  og: CanvasRenderingContext2D,
  t: Train,
  x: number,
  y: number,
  followed: boolean,
  scale = 1,
  yaw = 0,
  zoom = 8,
  gx = x,
  gy = y,
  tilt = 0.55,
) {
  if (t.kind === "flight") {
    drawPlane(og, x, y, gx, gy, t.color, t.bearing, followed, zoom, yaw, tilt, 1, flightPitchOf(t));
    return;
  }
  const k = (followed ? 1.18 : 1) * scale;
  if (t.kind === "shinkansen") {
    drawRailBody(og, x, y, trackAngle(t.bearing, yaw), t.color, "shinkansen", k, followed);
    return;
  }
  const subway = t.kind === "subway";
  const L = (subway ? 7.8 : 10.2) * k;
  const W = (subway ? 4.05 : 4.35) * k;
  const H = (subway ? 3.15 : 3.45) * k;
  og.save();
  og.translate(x, y);
  og.rotate(trackAngle(t.bearing, yaw));
  og.fillStyle = "rgba(0,0,0,0.26)";
  og.beginPath();
  og.ellipse(0.6, 1.4, L * 0.36, W * 0.3, 0, 0, Math.PI * 2);
  og.fill();
  fillBoxAlong(og, 0, 0, L, W, H, t.color);
  if (followed) {
    og.strokeStyle = CREAM;
    og.lineWidth = 1;
    og.beginPath();
    roundRectPath(og, -L / 2 - 1, -W / 2 - H - 0.8, L + 2, W + H + 1.4, 1.2);
    og.stroke();
  }
  og.restore();
}

export function CanvasMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<Cam>({ lng: RADAR_JAPAN_LNG, lat: RADAR_JAPAN_LAT, zoom: RADAR_JAPAN_ZOOM, yaw: 0, tilt: 0.42 });
  const camLerpRef = useRef<CamLerp | null>(null);
  const introDoneRef = useRef(false);
  const [tiltUi, setTiltUi] = useState(0.42);
  const [zoomUi, setZoomUi] = useState(RADAR_JAPAN_ZOOM);

  useLayoutEffect(() => {
    const saved = readSessionCam();
    if (!saved) return;
    camRef.current = saved;
    introDoneRef.current = true;
    setZoomUi(saved.zoom);
    setTiltUi(saved.tilt);
  }, []);
  const lineRef = useRef<LineRuntime[]>([]);
  const trainsRef = useRef<Train[]>([]);
  const hoverIdRef = useRef<string | null>(null);
  const liveSmoothRef = useRef<Map<string, LiveTrack>>(new Map());
  const walkRef = useRef({ lng: 0, lat: 0, set: false, hdg: 0 });
  const lastLiveSnapRef = useRef<Train[] | null>(null);
  const lastPinRef = useRef<Train | null>(null);
  const wxPoolRef = useRef<WxParticle[]>([]);
  const lastWxTsRef = useRef(0);
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const drag = useRef<{
    x: number;
    y: number;
    lng: number;
    lat: number;
    pinching?: boolean;
    dist?: number;
    zoom?: number;
    rotating?: boolean;
    pinchLock?: boolean;
    angle?: number;
    yaw?: number;
    tilt?: number;
    mx?: number;
    my?: number;
    mode?: "pan";
  } | null>(null);

  const lines = useMapStore((s) => s.lines);
  lineRef.current = lines;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let raf = 0;
    let lastSim = 0;
    let lastCount = -1;
    let lastFly = -1;
    let radarWas = false;
    let lastFollow: { id: string; lng: number; lat: number } | null = null;
    let introHoldUntil = 0;
    let stayFade = 1;
    let bootHid = false;
    const base = document.createElement("canvas");
    const bg = base.getContext("2d", { alpha: false });
    if (!bg) return;
    let baseKey = "";

    const applyTransform = (g: CanvasRenderingContext2D, dpr: number) => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width || window.innerWidth || 1));
      const cssH = Math.max(1, Math.floor(rect.height || window.innerHeight || 1));
      const area = Math.max(1, cssW * cssH);
      const want = Math.min(2.25, window.devicePixelRatio || 1);
      const maxArea = 3_200_000;
      const dpr = area * want * want > maxArea ? Math.max(1, Math.sqrt(maxArea / area)) : want;
      sizeRef.current = { w: cssW, h: cssH, dpr };
      try {
        canvas.width = Math.max(1, Math.floor(cssW * dpr));
        canvas.height = Math.max(1, Math.floor(cssH * dpr));
        base.width = canvas.width;
        base.height = canvas.height;
      } catch {
        canvas.width = cssW;
        canvas.height = cssH;
        base.width = cssW;
        base.height = cssH;
        sizeRef.current.dpr = 1;
      }
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      applyTransform(ctx, sizeRef.current.dpr);
      applyTransform(bg, sizeRef.current.dpr);
      baseKey = "";
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const paintBase = (
      cam: Cam,
      w: number,
      h: number,
      bounds: { west: number; south: number; east: number; north: number },
    ) => {
      const journey = useMapStore.getState().journey;
      const loose = Boolean(drag.current) || Boolean(camLerpRef.current);
      const key = `${cam.lng.toFixed(loose ? 3 : 4)}|${cam.lat.toFixed(loose ? 3 : 4)}|${cam.zoom.toFixed(loose ? 2 : 3)}|${cam.yaw.toFixed(loose ? 2 : 3)}|${cam.tilt.toFixed(loose ? 2 : 3)}|${useMapStore.getState().pitchMode}|${w}|${h}|${journey?.dest.name ?? ""}|${lineRef.current.length}|${useMapStore.getState().selectedTrain?.id ?? ""}|${useMapStore.getState().selectedStation?.name ?? ""}|${useMapStore.getState().selectedStay?.id ?? ""}|${useMapStore.getState().stayLayer ? 1 : 0}|${useMapStore.getState().stayWalk ? 1 : 0}|${useMapStore.getState().selectedKonbini?.id ?? ""}|${useMapStore.getState().konbiniBrand ?? ""}|${useMapStore.getState().konbiniStores.length}|${useMapStore.getState().konbiniWalk ? 1 : 0}|${useMapStore.getState().selectedMate?.id ?? ""}|${useMapStore.getState().mateWalk ? 1 : 0}|${useMapStore.getState().lang}|${useMapStore.getState().radarEnabled ? 1 : 0}|${useMapStore.getState().mountainLayer ? 1 : 0}|${SLAB_FACES ? 1 : 0}`;
      if (key === baseKey) return;
      baseKey = key;
      applyTransform(bg, sizeRef.current.dpr);
      const blend = mapBlend(cam.zoom);
      bg.fillStyle = OCEAN;
      bg.fillRect(0, 0, w, h);
      if (blend < 0.78) {
        bg.save();
        bg.globalAlpha = Math.max(0, 1 - blend * 1.15);
        drawVolume(bg, cam, w, h);
        drawSeafloor(bg, cam, w, h);
        drawTrenchAxes(bg, cam, w, h);
        drawIslandRoots(bg, cam, w, h);
        drawSlab(bg, cam, w, h);
        drawOceanSurface(bg, cam, w, h);
        landPath(bg, cam, w, h, 0.01);
        bg.fillStyle = LAND;
        bg.fill();
        bg.strokeStyle = LAND_EDGE;
        bg.lineWidth = 1;
        bg.lineJoin = "round";
        bg.stroke();
        bg.restore();
      }
      if (blend > 0.22) {
        bg.save();
        bg.globalAlpha = Math.min(1, (blend - 0.22) / 0.5);
        if (effectiveTilt(cam) > 0.42) {
          drawSeafloor(bg, cam, w, h);
          drawTrenchAxes(bg, cam, w, h);
          drawIslandRoots(bg, cam, w, h);
          drawSlab(bg, cam, w, h);
        }
        drawOceanSurface(bg, cam, w, h);
        const slab = effectiveTilt(cam) > 0.2 ? 16 : 0;
        if (slab) {
          for (let i = slab; i > 0; i -= 8) {
            bg.save();
            bg.translate(0, i);
            landPath(bg, cam, w, h, 0);
            bg.fillStyle = i > slab * 0.55 ? "#3d5e3a" : LAND_SIDE;
            bg.fill();
            bg.restore();
          }
        }
        landPath(bg, cam, w, h, 0);
        bg.fillStyle = LAND;
        bg.fill();
        bg.strokeStyle = LAND_EDGE;
        bg.lineWidth = 1.15;
        bg.lineJoin = "round";
        bg.stroke();
        bg.restore();
      }
      bg.globalAlpha = 1;
      bg.fillStyle = "rgba(120, 188, 214, 0.22)";
      bg.strokeStyle = "rgba(160, 210, 226, 0.22)";
      bg.lineWidth = 0.7;
      for (const ring of JAPAN_WATER) {
        bg.beginPath();
        ring.forEach(([lng, lat], i) => {
          const [x, y] = project(lng, lat, cam, w, h);
          if (i === 0) bg.moveTo(x, y);
          else bg.lineTo(x, y);
        });
        bg.closePath();
        bg.fill();
        bg.stroke();
      }

      bg.lineCap = "round";
      bg.lineJoin = "round";
      const immersed = Boolean(useMapStore.getState().selectedStay);
      if (!immersed) {
      const zoomW = cam.zoom >= 14.6 ? 0.92 : cam.zoom >= 13.2 ? 1 : cam.zoom >= 12 ? 1 : 1;
      const strokeLine = (line: LineRuntime, width: number, color: string) => {
        bg.strokeStyle = color;
        bg.lineWidth = Math.max(1.8, width);
        const src = cam.zoom >= 14.6 ? line.path : line.drawPath.length >= 2 ? line.drawPath : line.path;
        const path = new Path2D();
        addPoly(path, src, cam, w, h, cam.zoom >= 13.2 ? 1.6 : 2.8);
        bg.stroke(path);
      };
      const ordered = [...lineRef.current].sort((a, b) => {
        const rank = (k: string) => (k === "bus" ? 0 : k === "subway" ? 1 : k === "private" ? 2 : k === "jr" ? 3 : 4);
        return rank(a.kind) - rank(b.kind);
      });
      for (const line of ordered) {
        if (useMapStore.getState().radarEnabled || useMapStore.getState().mountainLayer) continue;
        if (!lineVisible(line, bounds, cam.zoom)) continue;
        bg.globalAlpha = journey ? 0.38 : 0.7;
        if (line.kind === "shinkansen") {
          strokeLine(line, 3.6 * zoomW, "#c8c2b0");
          strokeLine(line, 2 * zoomW, line.color);
        } else if (line.kind === "subway") {
          strokeLine(line, 1.4 * zoomW, line.color);
        } else if (line.kind === "bus") {
          continue;
        } else {
          strokeLine(line, (line.kind === "jr" ? 2.25 : 1.6) * zoomW, line.color);
        }
      }
      bg.globalAlpha = 1;

      if (cam.zoom <= 13.6 && !useMapStore.getState().mountainLayer) {
        bg.setLineDash([5, 6]);
        bg.lineWidth = 1.15;
        bg.globalAlpha = 0.28;
        for (const route of FLIGHT_ROUTES) {
          const a = AIRPORT_BY_ID.get(route.from);
          const b = AIRPORT_BY_ID.get(route.to);
          if (!a || !b) continue;
          const [x1, y1] = project(a.lng, a.lat, cam, w, h);
          const [x2, y2] = project(b.lng, b.lat, cam, w, h);
          if ((x1 < -40 && x2 < -40) || (y1 < -40 && y2 < -40) || (x1 > w + 40 && x2 > w + 40) || (y1 > h + 40 && y2 > h + 40)) continue;
          bg.strokeStyle = route.color;
          bg.beginPath();
          let started = false;
          let lastX = 0;
          let lastY = 0;
          for (let u = 0; u <= 1.001; u += 0.06) {
            const tt = Math.min(1, u);
            let dLng = b.lng - a.lng;
            if (dLng > 180) dLng -= 360;
            if (dLng < -180) dLng += 360;
            let lng = a.lng + dLng * tt;
            if (lng > 180) lng -= 360;
            if (lng < -180) lng += 360;
            const lat = a.lat + (b.lat - a.lat) * tt;
            const [x, y] = project(lng, lat, cam, w, h, 0.04);
            if (started && Math.hypot(x - lastX, y - lastY) > 220) started = false;
            if (!started) {
              bg.moveTo(x, y);
              started = true;
            } else bg.lineTo(x, y);
            lastX = x;
            lastY = y;
          }
          bg.stroke();
        }
        bg.setLineDash([]);
        bg.globalAlpha = 1;
      }

      if (cam.zoom >= 8.6 && !useMapStore.getState().radarEnabled && !useMapStore.getState().mountainLayer) {
        const selTrain = useMapStore.getState().selectedTrain;
        const selStation = useMapStore.getState().selectedStation;
        const tripHot = useMapStore.getState().journey;
        const hot = tripHot
          ? journeyAnchorNames(tripHot)
          : new Set([selTrain?.nextStop, selTrain?.prevStop, selStation?.name].filter(Boolean) as string[]);
        for (const line of lineRef.current) {
          if (!lineVisible(line, bounds, cam.zoom)) continue;
          for (const s of line.stops) {
            if (s.lng < bounds.west || s.lng > bounds.east || s.lat < bounds.south || s.lat > bounds.north) continue;
            if (cam.zoom < 10.2 && cityMinZoom(s.n) > cam.zoom) continue;
            const [x, y] = project(s.lng, s.lat, cam, w, h);
            const hi = hot.has(s.n);
            const jr = line.kind === "jr" || line.kind === "shinkansen";
            const r = hi ? 4.4 : jr ? (cam.zoom >= 14.5 ? 3.15 : cam.zoom >= 12.5 ? 2.85 : 2.55) : cam.zoom >= 14.5 ? 2.4 : cam.zoom >= 12.5 ? 2.2 : 2;
            bg.fillStyle = hi ? "#ffe08a" : jr ? "#070b08" : "#1a241c";
            bg.beginPath();
            bg.arc(x, y, r, 0, Math.PI * 2);
            bg.fill();
            bg.fillStyle = hi ? "#1a241c" : jr ? "rgba(214,204,170,0.55)" : "rgba(236,228,200,0.78)";
            bg.beginPath();
            bg.arc(x, y, r * 0.42, 0, Math.PI * 2);
            bg.fill();
          }
        }
      }

      for (const ap of AIRPORTS) {
        const [x, y] = project(ap.lng, ap.lat, cam, w, h);
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        bg.fillStyle = CREAM;
        bg.beginPath();
        bg.moveTo(x, y - 4);
        bg.lineTo(x + 4, y);
        bg.lineTo(x, y + 4);
        bg.lineTo(x - 4, y);
        bg.closePath();
        bg.fill();
        bg.strokeStyle = INK;
        bg.lineWidth = 1;
        bg.stroke();
        if (cam.zoom >= 6.4 && cam.zoom <= 13.2) {
          bg.fillStyle = CREAM;
          bg.font = mapFont(10, 600);
          bg.textAlign = "left";
          bg.textBaseline = "middle";
          bg.fillText(displayName(ap.n, useMapStore.getState().lang), x + 6, y);
        }
      }
      }

      if (cam.zoom < 10.9) {
        bg.font = cam.zoom < 6.4 ? mapFont(13, 700) : mapFont(12, 600);
        bg.textAlign = "center";
        bg.textBaseline = "top";
        const loc = useMapStore.getState().lang;
        for (const c of CITY_MARKS) {
          if (cam.zoom < c.z) continue;
          const [x, y] = project(c.lng, c.lat, cam, w, h);
          if (x < -40 || y < -30 || x > w + 40 || y > h + 30) continue;
          bg.fillStyle = INK;
          bg.beginPath();
          bg.arc(x, y, cam.zoom < 6.2 ? 3.1 : 2.6, 0, Math.PI * 2);
          bg.fill();
          bg.fillStyle = CREAM;
          bg.fillText(displayName(c.n, loc), x, y + 5);
        }
      }
    };

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        if (!bootHid) {
          bootHid = true;
          const boot = document.getElementById("j-boot");
          if (boot) {
            boot.classList.add("off");
            boot.style.setProperty("opacity", "0", "important");
            boot.style.setProperty("visibility", "hidden", "important");
            boot.style.setProperty("display", "none", "important");
            boot.style.pointerEvents = "none";
          }
        }
        const { w, h, dpr } = sizeRef.current;
        if (w < 2 || h < 2) {
          resize();
          return;
        }
        const cam = camRef.current;
        const fly = useMapStore.getState().flyTo;
        if (fly && fly.nonce !== lastFly) {
          lastFly = fly.nonce;
          const stFly = useMapStore.getState();
          const z =
            fly.zoom ??
            (stFly.konbiniBrand
              ? zoomToFitKm(konbiniRingM(stFly.userLocation, stFly.stationIndex, stFly.nearestStations) / 1000, h)
              : zoomToFitNearbyStations(fly.lng, fly.lat, h));
          const dest =
            fly.ox != null
              ? placeAtScreen(fly.lng, fly.lat, z, w, h, fly.ox, fly.oy ?? 0.46, fly.bearing ?? 0, fly.pitch ?? 0.62)
              : fly.center || z < 9.2
                ? {
                    lng: fly.lng,
                    lat: fly.lat,
                    zoom: clampZoom(z),
                    yaw: fly.bearing ?? 0,
                    tilt: fly.pitch ?? 0.62,
                  }
                : {
                    ...placeUpper(fly.lng, fly.lat, z, w, h),
                    yaw: fly.bearing ?? 0,
                  };
          camLerpRef.current = {
            slng: camRef.current.lng,
            slat: camRef.current.lat,
            szoom: camRef.current.zoom,
            syaw: camRef.current.yaw,
            stilt: camRef.current.tilt,
            tlng: dest.lng,
            tlat: dest.lat,
            tzoom: dest.zoom,
            tyaw: dest.yaw ?? 0,
            ttilt: fly.pitch ?? dest.tilt,
            t0: ts,
            dur: fly.center && fly.pitch === 0 ? 380 : 1000,
          };
          if (fly.pitch === 0) setTiltUi(0);
          if (fly.zoom != null) setZoomUi(clampZoom(fly.zoom));
        }
        const radarOnNow = useMapStore.getState().radarEnabled;
        if (radarOnNow && !radarWas) {
          radarWas = true;
          camLerpRef.current = null;
          camRef.current = {
            lng: RADAR_JAPAN_LNG,
            lat: RADAR_JAPAN_LAT,
            zoom: RADAR_JAPAN_ZOOM,
            yaw: 0,
            tilt: 0,
          };
          setTiltUi(0);
          setZoomUi(RADAR_JAPAN_ZOOM);
        }
        if (!radarOnNow) radarWas = false;
        if (!introDoneRef.current && !radarOnNow && !camLerpRef.current) {
          const st = useMapStore.getState();
          const located =
            st.locateStatus === "ok" ||
            st.locateStatus === "outside" ||
            st.locateStatus === "denied" ||
            st.locateStatus === "error";
          if (located && st.userLocation && w > 2 && h > 2) {
            if (!introHoldUntil) introHoldUntil = ts + 820;
            if (ts >= introHoldUntil) {
              introDoneRef.current = true;
              const farKm = st.nearestStations.length
                ? Math.max(...st.nearestStations.map((r) => r.km), 0.7)
                : 2;
              const z = zoomToFitKm(farKm, h);
              const next = placeUpper(st.userLocation.lng, st.userLocation.lat, z, w, h);
              camLerpRef.current = {
                ...beginLerp(camRef.current, { ...next, yaw: 0, tilt: HOME_TILT }, 2680),
                t0: ts,
              };
              setTiltUi(HOME_TILT);
              setZoomUi(z);
            }
          }
        }
        const anim = camLerpRef.current;
        if (anim) {
          const u = Math.min(1, (ts - anim.t0) / anim.dur);
          const e = easeInOutCubic(u);
          camRef.current = {
            lng: anim.slng + (anim.tlng - anim.slng) * e,
            lat: anim.slat + (anim.tlat - anim.slat) * e,
            zoom: anim.szoom + (anim.tzoom - anim.szoom) * e,
            yaw: anim.syaw + (anim.tyaw - anim.syaw) * e,
            tilt: anim.stilt + (anim.ttilt - anim.stilt) * e,
          };
          if (u >= 1) {
            camLerpRef.current = null;
            setTiltUi(camRef.current.tilt);
          }
        }
        if (introDoneRef.current) rememberCam(camRef.current);
        const span = Math.max(1.4, 26 / 2 ** Math.max(0, camRef.current.zoom - 5));
        const blend = mapBlend(camRef.current.zoom);
        const bounds =
          blend > 0.4
            ? (() => {
                const c0 = unproject(0, 0, camRef.current, w, h);
                const c1 = unproject(w, 0, camRef.current, w, h);
                const c2 = unproject(0, h, camRef.current, w, h);
                const c3 = unproject(w, h, camRef.current, w, h);
                const lngs = [c0[0], c1[0], c2[0], c3[0]];
                const lats = [c0[1], c1[1], c2[1], c3[1]];
                return {
                  west: Math.min(...lngs) - 0.08,
                  east: Math.max(...lngs) + 0.08,
                  south: Math.min(...lats) - 0.08,
                  north: Math.max(...lats) + 0.08,
                };
              })()
            : {
                west: camRef.current.lng - span,
                east: camRef.current.lng + span,
                south: camRef.current.lat - span * 0.72,
                north: camRef.current.lat + span * 0.72,
              };
        if (useMapStore.getState().ready && introDoneRef.current && !camLerpRef.current) {
          const loc = useMapStore.getState().userLocation;
          const s = useMapStore.getState();
          const hideRing = Boolean(s.selectedTrain || s.journey || s.journeys.length || s.searching);
          const ringM = s.konbiniBrand ? konbiniRingM(loc, s.stationIndex, s.nearestStations) : undefined;
          if (loc && !hideRing && camRef.current.zoom >= SHOW_ZOOM - 0.85) pullRoads(loc.lng, loc.lat, camRef.current.zoom, ringM);
        }
        {
          const s = useMapStore.getState();
          if (s.konbiniBrand) {
            const here = s.userLocation ?? NODA;
            const ring = konbiniRingM(here, s.stationIndex, s.nearestStations);
            pullKonbini(here.lng, here.lat, ring, s.konbiniBrand, (rows, done) => {
              const cur = useMapStore.getState();
              if (cur.konbiniBrand !== s.konbiniBrand) return;
              cur.setKonbiniLoading(!done);
              const next = rows.length ? rows : cur.konbiniStores.filter((row) => s.konbiniBrand === "all" || row.brand === s.konbiniBrand);
              if (next.length === cur.konbiniStores.length && next[0]?.id === cur.konbiniStores[0]?.id) return;
              if (rows.length || cur.konbiniStores.length === 0) cur.setKonbiniStores(next);
            });
          }
        }

        const followId = useMapStore.getState().followTrainId;
        const busyCam = Boolean(drag.current) || Boolean(camLerpRef.current);
        const simDue = ts - lastSim > (followId && !busyCam ? 90 : busyCam ? 280 : 150);
        if (simDue) {
          lastSim = ts;
          const station = useMapStore.getState().selectedStation;
          const priority = new Set(station?.lines.map((l) => l.id) ?? []);
          const followedLine = followId ? parseTrainId(followId) : null;
          if (followedLine) priority.add(followedLine.lineId);
          const stayOn = Boolean(useMapStore.getState().selectedStay);
          const radarOn = useMapStore.getState().radarEnabled;
          const mountainOn = useMapStore.getState().mountainLayer;
          const z = camRef.current.zoom;
          if (stayOn || mountainOn) {
            trainsRef.current = [];
          } else if (radarOn) {
            const liveRaw = useMapStore.getState().viewTime ? [] : useMapStore.getState().liveTrains;
            trainsRef.current = liveRaw.filter((t) => t.kind === "flight");
          } else {
          const now = simNow();
          const cap = z < 5.5 ? 0 : z >= 15.6 ? 2200 : z >= 13.8 ? 1600 : z >= 12 ? 1400 : z >= 10 ? 1100 : z >= 8 ? 800 : 420;
          const liveRaw = useMapStore.getState().viewTime ? [] : useMapStore.getState().liveTrains;
          const flights = liveRaw.filter((t) => t.kind === "flight");
          const pin = getPinnedTrain();
          const extra = pin && pin.kind !== "flight" && pin.kind !== "bus" ? [pin] : [];
          const snap = flights.concat(extra);
          const fresh = lastLiveSnapRef.current !== liveRaw || pin !== lastPinRef.current;
          if (fresh) {
            lastLiveSnapRef.current = liveRaw;
            lastPinRef.current = pin;
          }
          const live = smoothLiveOnTrack(liveSmoothRef.current, fresh ? snap : null, lineRef.current, ts);
          let sim = simulateTrains(lineRef.current, now, bounds, z, cap, followId, priority, false);
          const dia = getOfficialDia();
          if (dia.length) sim = stampTrainsDia(sim, dia);
          sim = sim.map((t) => {
            if (t.kind === "flight" || t.kind === "bus") return t;
            if (t.delayMin <= 0) return t;
            const line = lineRef.current.find((l) => l.id === t.lineId);
            return line ? poseWithDelay(line, t, t.delayMin, now) : t;
          });
          trainsRef.current = mergeLive(sim, live).filter((t) => t.kind !== "bus");
          const trip = useMapStore.getState().journey;
          if (trip) {
            trainsRef.current = relatedTrainsForJourney(
              [...trainsRef.current, ...live.filter((t) => t.kind !== "flight" && t.kind !== "bus")],
              trip,
              useMapStore.getState().selectedTrain,
              lineRef.current,
            );
            const cur = useMapStore.getState().selectedTrain;
            if (cur && !trainsRef.current.some((t) => t.id === cur.id) && inJapan(cur.lng, cur.lat)) {
              trainsRef.current.unshift(cur);
            }
          }
          if (followId && !trip && !trainsRef.current.some((t) => t.id === followId)) {
            const sel = useMapStore.getState().selectedTrain;
            const extra =
              trainById(lineRef.current, now, followId) ??
              live.find((t) => t.id === followId) ??
              (sel && sel.id === followId && inJapan(sel.lng, sel.lat) ? sel : null);
            if (extra && inJapan(extra.lng, extra.lat)) trainsRef.current.push(extra);
          }
          const selId = useMapStore.getState().selectedTrain?.id;
          if (!trip && selId && !trainsRef.current.some((t) => t.id === selId)) {
            const sel = useMapStore.getState().selectedTrain;
            const extra =
              trainById(lineRef.current, now, selId) ??
              (sel && inJapan(sel.lng, sel.lat) ? sel : null);
            if (extra && inJapan(extra.lng, extra.lat)) trainsRef.current.push(extra);
          }
          overlaySelectedTrain(trainsRef.current, useMapStore.getState().selectedTrain);
          const tracked = trainsRef.current.find((x) => x.id === (followId || selId));
          if (tracked && inJapan(tracked.lng, tracked.lat)) {
            const prev = useMapStore.getState().selectedTrain;
            if (!prev || prev.id !== tracked.id) {
              const plan = parseHhmmMin(tracked.alightHhmm) != null ? tracked.alightHhmm! : arriveHhmmOf(tracked);
              useMapStore.getState().selectTrain({
                ...tracked,
                alightHhmm: plan || tracked.alightHhmm,
                etaMin: etaFromHhmm(plan) ?? tracked.etaMin,
              });
            } else if (
              prev.lng !== tracked.lng ||
              prev.lat !== tracked.lat ||
              prev.nextStop !== tracked.nextStop ||
              prev.progress !== tracked.progress ||
              (tracked.delaySec ?? 0) !== (prev.delaySec ?? 0) ||
              tracked.delayMin !== prev.delayMin ||
              (tracked.etaMin ?? -1) !== (prev.etaMin ?? -1)
            ) {
              const jumpKm = haversine([prev.lng, prev.lat], [tracked.lng, tracked.lat]);
              const shin = tracked.kind === "shinkansen" || prev.kind === "shinkansen";
              const gps = Boolean(tracked.gps || prev.gps);
              const chase = shin
                ? jumpKm > 12 ? 1 : jumpKm > 2.5 ? 0.5 : 0.32
                : gps
                  ? jumpKm > 12 ? 1 : jumpKm > 3 ? 0.35 : 0.16
                  : jumpKm > 14 ? 0 : jumpKm > 3 ? 0.2 : 0.12;
              const stopChanged = Boolean(tracked.nextStop && prev.nextStop && tracked.nextStop !== prev.nextStop);
              const prevPlan = parseHhmmMin(prev.alightHhmm) != null ? prev.alightHhmm! : "";
              const trackedPlan = parseHhmmMin(tracked.alightHhmm) != null ? tracked.alightHhmm! : "";
              const plan = !stopChanged && prevPlan ? prevPlan : trackedPlan || arriveHhmmOf(tracked);
              const etaKeep = etaFromHhmm(plan) ?? tracked.etaMin ?? prev.etaMin;
              useMapStore.getState().selectTrain({
                ...prev,
                lng: chase === 0 ? prev.lng : prev.lng + (tracked.lng - prev.lng) * chase,
                lat: chase === 0 ? prev.lat : prev.lat + (tracked.lat - prev.lat) * chase,
                bearing: tracked.bearing,
                nextStop: shin ? tracked.nextStop || prev.nextStop : prev.nextStop || tracked.nextStop,
                prevStop: shin ? tracked.prevStop || prev.prevStop : prev.prevStop || tracked.prevStop,
                progress: chase === 0 ? prev.progress : prev.progress + (tracked.progress - prev.progress) * chase,
                stopIndex: tracked.stopIndex,
                delayMin: Math.max(prev.delayMin, tracked.delayMin),
                delaySec: Math.max(prev.delaySec ?? 0, tracked.delaySec ?? 0),
                delayAlert: Boolean(prev.delayAlert || tracked.delayAlert),
                etaMin: etaKeep,
                boardHhmm: prev.boardHhmm ?? tracked.boardHhmm,
                alightHhmm: plan || prev.alightHhmm || tracked.alightHhmm,
                fromPlatform: prev.fromPlatform ?? tracked.fromPlatform,
                toPlatform: prev.toPlatform ?? tracked.toPlatform,
                gps: gps || prev.gps,
              });
            }
            if (followId && pointers.size === 0 && !drag.current && !camLerpRef.current) {
              if (lastFollow && lastFollow.id === followId) {
                camRef.current.lng += tracked.lng - lastFollow.lng;
                camRef.current.lat += tracked.lat - lastFollow.lat;
                keepJapanInView(camRef.current);
              }
              lastFollow = { id: followId, lng: tracked.lng, lat: tracked.lat };
            } else if (!followId) {
              lastFollow = null;
            }
          } else if (!followId) {
            lastFollow = null;
          }
          }
          if (trainsRef.current.length !== lastCount) {
            lastCount = trainsRef.current.length;
            useMapStore.getState().setTrainCount(lastCount);
          }
        }

        paintBase(camRef.current, w, h, bounds);
        applyTransform(ctx, dpr);
        ctx.drawImage(base, 0, 0, w, h);
        const stayOnNow =
          Boolean(useMapStore.getState().selectedStay) &&
          !useMapStore.getState().stayWalk &&
          !useMapStore.getState().journey;
        stayFade += ((stayOnNow ? 0 : 1) - stayFade) * 0.18;
        if (stayFade > 0.04) {
        ctx.save();
        ctx.globalAlpha = stayFade;
        const mountainOnNow = useMapStore.getState().mountainLayer;
        if (!mountainOnNow && camRef.current.zoom < 11.6) drawMarineLife(ctx, camRef.current, w, h, ts, bounds);
        const wxSpots = useMapStore.getState().weatherSpots;
        const wxNow = nearestWeather(wxSpots, camRef.current.lng, camRef.current.lat);
        const veil = !mountainOnNow && wxNow ? weatherVeil(wxNow.kind, wxNow.intensity, camRef.current.zoom) : null;
        if (veil) {
          ctx.fillStyle = veil;
          ctx.fillRect(0, 0, w, h);
        }
        if (camRef.current.zoom < 13.4) drawClouds(ctx, camRef.current, w, h, ts);
        {
          const st = useMapStore.getState();
            drawRadarLayer(
            ctx,
            camRef.current,
            w,
            h,
            bounds,
            (lng, lat, alt) => project(lng, lat, camRef.current, w, h, alt),
            stayFade,
            st.radarEnabled,
            st.radarHidden,
            ts,
          );
        }
        drawLandmarks(ctx, camRef.current, w, h);
        const followed = useMapStore.getState().followTrainId;
        const selectedTrainId = useMapStore.getState().selectedTrain?.id;
        const hoverId = hoverIdRef.current;
        const selected = useMapStore.getState().selectedStation;
        const ordered = [...trainsRef.current].sort((a, b) => {
          const da = depthOf(a.lng, a.lat, camRef.current, vehicleAlt(a));
          const db = depthOf(b.lng, b.lat, camRef.current, vehicleAlt(b));
          return db - da;
        });
        for (const t of ordered) {
          if (t.kind !== "flight") continue;
          const alt = vehicleAlt(t);
          const [gx, gy] = project(t.lng, t.lat, camRef.current, w, h, 0);
          const [ax, ay] = project(t.lng, t.lat, camRef.current, w, h, alt);
          drawFlightGround(
            ctx,
            gx,
            gy,
            ax,
            ay,
            trackAngle(t.bearing, camRef.current.yaw),
            alt,
            camRef.current.zoom,
            camRef.current.tilt,
            t.id === followed || t.id === selectedTrainId,
            ts,
          );
        }
        const trainCards: { t: Train; x: number; y: number; on: boolean }[] = [];
        const delayMarks: { x: number; y: number; sec: number }[] = [];
        const selNow = useMapStore.getState().selectedTrain;
        for (const t of ordered) {
          const on = t.id === followed || t.id === selectedTrainId;
          const hovering = t.id === hoverId;
          const shown = on && selNow && selNow.id === t.id ? { ...t, lng: selNow.lng, lat: selNow.lat, bearing: selNow.bearing, nextStop: selNow.nextStop, prevStop: selNow.prevStop, dest: selNow.dest, delayMin: selNow.delayMin, delaySec: selNow.delaySec, delayAlert: Boolean(t.delayAlert || selNow.delayAlert), etaMin: selNow.etaMin, arrUnix: selNow.arrUnix, progress: selNow.progress, fromPlatform: selNow.fromPlatform, toPlatform: selNow.toPlatform, boardHhmm: selNow.boardHhmm, alightHhmm: selNow.alightHhmm } : t;
          const arriving = Boolean(selected && (shown.nextStop === selected.name || shown.prevStop === selected.name));
          if (followed && !on) ctx.globalAlpha = 0.9;
          const alt = vehicleAlt(shown);
          const [gx, gy] = project(shown.lng, shown.lat, camRef.current, w, h, 0);
          const [x, y] = project(shown.lng, shown.lat, camRef.current, w, h, alt);
          const sc = vehicleZoomScale(camRef.current.zoom);
          if (on) {
            const pulse = 0.5 + 0.5 * Math.sin(ts / 260);
            ctx.save();
            ctx.strokeStyle = CREAM;
            ctx.globalAlpha = 0.35 + 0.5 * pulse;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.arc(x, y, 13 + 9 * pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.1 + 0.12 * pulse;
            ctx.fillStyle = shown.color;
            ctx.beginPath();
            ctx.arc(x, y, 16 + 7 * pulse, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
          drawVehicle(ctx, shown, x, y, on || arriving || hovering, sc, camRef.current.yaw, camRef.current.zoom, gx, gy, camRef.current.tilt);
          if (shown.kind !== "flight" && (delaySeconds(shown) > 0 || shown.delayAlert) && (on || hovering || camRef.current.zoom >= 9.8)) {
            delayMarks.push({ x, y, sec: delaySeconds(shown) });
          }
          ctx.globalAlpha = 1;
          if (hovering || on) trainCards.push({ t: shown, x, y, on });
        }

        for (const mark of delayMarks) {
          drawDelayChip(ctx, mark.x, mark.y, mark.sec, useMapStore.getState().lang);
        }

        if (camRef.current.zoom >= 8.8 && !useMapStore.getState().radarEnabled && !useMapStore.getState().mountainLayer) {
          const cam = camRef.current;
          const selTrain = useMapStore.getState().selectedTrain;
          const selStation = useMapStore.getState().selectedStation;
          const tripHot = useMapStore.getState().journey;
          const hot = tripHot
            ? journeyAnchorNames(tripHot)
            : new Set([selTrain?.nextStop, selTrain?.prevStop, selStation?.name].filter(Boolean) as string[]);
          const fontPx = cam.zoom >= 16.4 ? 13 : cam.zoom >= 14.8 ? 12 : cam.zoom >= 11.2 ? 11 : 10;
          const maxLabels = cam.zoom >= 16.2 ? 420 : cam.zoom >= 14.8 ? 260 : cam.zoom >= 13.2 ? 140 : cam.zoom >= 11.2 ? 80 : 36;
          const prec = cam.zoom >= 16.4 ? 5 : cam.zoom >= 14.6 ? 4 : 3;
          const marks = new Map<string, { n: string; lng: number; lat: number; tag: string }>();
          for (const line of lineRef.current) {
            if (!lineVisible(line, bounds, cam.zoom)) continue;
            for (const s of line.stops) {
              if (s.lng < bounds.west || s.lng > bounds.east || s.lat < bounds.south || s.lat > bounds.north) continue;
              if (cam.zoom < 11 && cityMinZoom(s.n) > cam.zoom) continue;
              const key = `${s.n}|${s.lng.toFixed(prec)}|${s.lat.toFixed(prec)}`;
              if (!marks.has(key)) marks.set(key, { n: s.n, lng: s.lng, lat: s.lat, tag: lineShort(line) });
            }
          }
          const nameHits = new Map<string, number>();
          for (const m of marks.values()) nameHits.set(m.n, (nameHits.get(m.n) ?? 0) + 1);
          const list = [...marks.values()].sort((a, b) => Number(hot.has(b.n)) - Number(hot.has(a.n)));
          const boxes: { x: number; y: number; w: number; h: number }[] = [];
          const hits = (x: number, y: number, w: number, h: number) =>
            boxes.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
          let n = 0;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          const boxSc = tripHot ? cardZoomScale(cam.zoom) : 1;
          for (const m of list) {
            const [x, y] = project(m.lng, m.lat, cam, w, h);
            const hi = hot.has(m.n);
            if (tripHot && !hi) continue;
            if (tripHot && boxSc <= 0.04) continue;
            if (!hi && n >= maxLabels) continue;
            const tag = (nameHits.get(m.n) ?? 0) > 1 ? m.tag : "";
            const loc = useMapStore.getState().lang;
            const raw = tag ? `${stationFullName(m.n)} ${tag}` : stationFullName(m.n);
            const label = displayName(raw, loc);
            const px = tripHot ? Math.max(10, Math.round((fontPx + 2) * boxSc)) : hi ? fontPx + 1 : fontPx;
            ctx.font = mapFont(px, 700);
            const tw = ctx.measureText(label).width;
            const pad = tripHot ? 6 * boxSc : 3;
            const bw = tw + (tripHot ? 16 * boxSc : 6);
            const bh = px + (tripHot ? 10 * boxSc : 6);
            const spots = [
              [x + 8, y],
              [x + 8, y - px - 6],
              [x + 8, y + px + 6],
              [x - bw - 8, y],
            ] as const;
            let placed: [number, number] | null = null;
            for (const [lx, ly] of spots) {
              if (hi || !hits(lx - pad, ly - bh / 2, bw, bh)) {
                placed = [lx, ly];
                break;
              }
            }
            if (!placed) continue;
            const [lx, ly] = placed;
            boxes.push({ x: lx - pad, y: ly - bh / 2, w: bw, h: bh });
            if (tripHot) {
              ctx.fillStyle = "rgba(10,14,24,0.94)";
              ctx.beginPath();
              roundRectPath(ctx, lx - pad, ly - bh / 2, bw, bh, 6 * boxSc);
              ctx.fill();
              ctx.fillStyle = "#ffe08a";
              ctx.fillText(label, lx, ly);
            } else {
              ctx.lineWidth = 3.4;
              ctx.strokeStyle = "rgba(8,12,10,0.88)";
              ctx.strokeText(label, lx, ly);
              ctx.fillStyle = hi ? "#ffe08a" : "#f6f3e8";
              ctx.fillText(label, lx, ly);
            }
            n += 1;
          }
        }

        drawJourneyPulse(ctx, camRef.current, w, h, ts, lineRef.current, "ride");

        if (trainCards.length) {
          const loc = useMapStore.getState().lang;
          const txt = copies[loc];
          const journey = useMapStore.getState().journey;
          for (const card of trainCards) {
            drawTrainCard(ctx, card.t, card.x, card.y, w, trainCardParts(card.t, loc, txt, journey, card.on), camRef.current.zoom);
          }
        }

        drawQuakeMarks(ctx, camRef.current, w, h, ts, useMapStore.getState().mountainLayer ? [] : useMapStore.getState().quakes, useMapStore.getState().selectedQuake?.id ?? null);
        if (!useMapStore.getState().mountainLayer) {
          const dt = lastWxTsRef.current ? Math.min(0.05, (ts - lastWxTsRef.current) / 1000) : 0.016;
          lastWxTsRef.current = ts;
          tickWeatherParticles(
            wxPoolRef.current,
            wxSpots,
            (lng, lat) => project(lng, lat, camRef.current, w, h),
            w,
            h,
            camRef.current.zoom,
            camRef.current.yaw,
            dt,
            wxNow,
          );
          drawWeatherParticles(ctx, wxPoolRef.current, ts);
          drawWeatherBeacons(ctx, wxSpots, camRef.current, w, h, ts);
        }
        ctx.restore();
        }

        const peakSel = useMapStore.getState().selectedPeak;
        const prevPeakScreen = useMapStore.getState().peakScreen;
        if (peakSel) {
          const alt = 0.072 * Math.max(0.3, peakSel.h / FUJI_H);
          const [px, py] = project(peakSel.lng, peakSel.lat, camRef.current, w, h, alt);
          if (Number.isFinite(px) && Number.isFinite(py)) {
            if (!prevPeakScreen || Math.abs(prevPeakScreen.x - px) > 0.6 || Math.abs(prevPeakScreen.y - py) > 0.6) {
              useMapStore.getState().setPeakScreen({ x: px, y: py });
            }
          }
        } else if (prevPeakScreen) {
          useMapStore.getState().setPeakScreen(null);
        }

        const user = useMapStore.getState().userLocation;
        if (user) {
          const walk = walkRef.current;
          if (!walk.set) {
            walk.lng = user.lng;
            walk.lat = user.lat;
            walk.set = true;
          } else {
            walk.lng += (user.lng - walk.lng) * 0.18;
            walk.lat += (user.lat - walk.lat) * 0.18;
          }
          const st = useMapStore.getState();
          const hideRing = Boolean(
            (st.selectedTrain || st.journey || st.journeys.length || st.searching) && !st.konbiniWalk && !st.stayWalk && !st.mateWalk,
          );
          if (!hideRing) {
            const ringM = st.konbiniBrand ? konbiniRingM(user, st.stationIndex, st.nearestStations) : undefined;
            drawRoads(ctx, camRef.current, w, h, (lng, lat, alt) => project(lng, lat, camRef.current, w, h, alt), walk, ringM);
          }
          drawJourneyPulse(ctx, camRef.current, w, h, ts, lineRef.current, "walk");
          const konbiniSel = st.selectedKonbini;
          let kPin: { x: number; y: number } | null = null;
          if (st.konbiniBrand && !st.mountainLayer) {
            const shops = st.konbiniStores;
            const ring = konbiniRingM(user, st.stationIndex, st.nearestStations);
            const langNow = st.lang;
            for (const shop of shops) {
              if (st.konbiniBrand !== "all" && shop.brand !== st.konbiniBrand) continue;
              if (metersTo(shop, user) > ring && konbiniSel?.id !== shop.id) continue;
              const [kx, ky] = project(shop.lng, shop.lat, camRef.current, w, h);
              if (!Number.isFinite(kx) || !Number.isFinite(ky)) continue;
              const on = konbiniSel?.id === shop.id;
              const meta = KONBINI_META[shop.brand];
              const sc = markScale(shop.lng, shop.lat, camRef.current, w, h);
              if (on) {
                ctx.globalAlpha = 0.22 + 0.28 * (0.5 + 0.5 * Math.sin(ts / 180));
                ctx.strokeStyle = meta.color;
                ctx.lineWidth = 2.4 * sc;
                ctx.beginPath();
                ctx.arc(kx, ky - 2 * sc, (12 + 8 * (0.5 + 0.5 * Math.sin(ts / 180))) * sc, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
                kPin = { x: kx, y: ky - 16 * sc };
              }
              drawKonbiniPin(ctx, kx, ky, meta.color, meta.short, on, sc);
              if (!on) {
                const label = konbiniLabel(shop, langNow);
                const fs = Math.max(9, Math.min(13, 10 * sc));
                ctx.font = `700 ${fs}px ui-sans-serif, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                const tw = ctx.measureText(label).width;
                ctx.fillStyle = "rgba(12,18,24,0.82)";
                ctx.beginPath();
                roundRectPath(ctx, kx - tw / 2 - 4, ky + 7 * sc, tw + 8, 14 * Math.max(0.85, sc), 4);
                ctx.fill();
                ctx.fillStyle = CREAM;
                ctx.fillText(label, kx, ky + 8 * sc);
              }
            }
          }
          const prevK = st.konbiniScreen;
          if (konbiniSel && kPin) {
            if (!prevK || Math.abs(prevK.x - kPin.x) > 0.6 || Math.abs(prevK.y - kPin.y) > 0.6) {
              st.setKonbiniScreen(kPin);
            }
          } else if (prevK && !konbiniSel) {
            st.setKonbiniScreen(null);
          }
          const staySel = st.selectedStay;
          const stayLayer = st.stayLayer;
          const lang = st.lang;
          let pinScreen: { x: number; y: number } | null = null;
          if (stayLayer && !st.mountainLayer) {
            ctx.globalAlpha = 1;
            for (const stay of STAYS) {
              const [sx, sy] = project(stay.lng, stay.lat, camRef.current, w, h);
              if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
              const on = staySel?.id === stay.id;
              const pulse = on ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(ts / 180)) : 1;
              const sc = markScale(stay.lng, stay.lat, camRef.current, w, h);
              if (on) {
                ctx.globalAlpha = 0.22 + 0.28 * pulse;
                ctx.strokeStyle = "#ffe08a";
                ctx.lineWidth = 2.4 * sc;
                ctx.beginPath();
                ctx.arc(sx, sy - 4 * sc, (11 + 10 * pulse) * sc, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
              }
              drawStayPin(ctx, sx, sy, on, sc);
              if (on) pinScreen = { x: sx, y: sy - 14 * sc };
              if (!on) {
                const label = stayLabel(stay, lang);
                const fs = Math.max(9, Math.min(13, 11 * sc));
                ctx.font = `700 ${fs}px ui-sans-serif, sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                const tw = ctx.measureText(label).width;
                ctx.fillStyle = "rgba(20,16,8,0.82)";
                ctx.beginPath();
                roundRectPath(ctx, sx - tw / 2 - 5, sy + 8 * sc, tw + 10, 16 * Math.max(0.85, sc), 5);
                ctx.fill();
                ctx.fillStyle = CREAM;
                ctx.fillText(label, sx, sy + 10 * sc);
              }
            }
          }
          if (staySel) {
            const shopNear = stationsNearPlace(st.stationIndex, staySel.lng, staySel.lat, 2);
            for (const row of shopNear) {
              const sta = row.station;
              const [nx, ny] = project(sta.lng, sta.lat, camRef.current, w, h);
              if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
              const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ts / 320));
              ctx.strokeStyle = `rgba(255, 214, 110, ${0.35 + 0.4 * pulse})`;
              ctx.lineWidth = 2.2;
              ctx.beginPath();
              ctx.arc(nx, ny, 11 + 8 * pulse, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = "#ffe08a";
              ctx.beginPath();
              ctx.arc(nx, ny, 3.4, 0, Math.PI * 2);
              ctx.fill();
              const tip = `${displayName(sta.name, lang)} · ${formatKm(row.km)}`;
              ctx.font = mapFont(11, 700);
              ctx.textAlign = "center";
              ctx.textBaseline = "bottom";
              const tw = ctx.measureText(tip).width;
              ctx.fillStyle = "rgba(28, 22, 8, 0.9)";
              ctx.beginPath();
              roundRectPath(ctx, nx - tw / 2 - 6, ny - 28, tw + 12, 16, 6);
              ctx.fill();
              ctx.fillStyle = "#ffe08a";
              ctx.fillText(tip, nx, ny - 14);
            }
          }
          const prevScreen = st.stayScreen;
          if (staySel && pinScreen) {
            if (!prevScreen || Math.abs(prevScreen.x - pinScreen.x) > 0.6 || Math.abs(prevScreen.y - pinScreen.y) > 0.6) {
              st.setStayScreen(pinScreen);
            }
          } else if (prevScreen && !staySel) {
            st.setStayScreen(null);
          }
          const [x, y] = project(walk.lng, walk.lat, camRef.current, w, h);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            const pulse = 0.7 + 0.3 * Math.sin(ts / 280);
            const r = camRef.current.zoom < 7.5 ? 1.25 : 1;
            ctx.fillStyle = `rgba(120,255,210,${0.18 + 0.14 * pulse})`;
            ctx.beginPath();
            ctx.arc(x, y, 18 * pulse * r, 0, Math.PI * 2);
            ctx.fill();
            const hdgT = useMapStore.getState().headingDeg;
            const flat = useMapStore.getState().headingFlat;
            if (hdgT != null && flat) {
              let d = hdgT - walk.hdg;
              while (d > 180) d -= 360;
              while (d < -180) d += 360;
              walk.hdg += d * 0.075;
            }
            if (hdgT != null) {
              const rad = (walk.hdg * Math.PI) / 180;
              const step = 0.00038;
              const clat = Math.cos((walk.lat * Math.PI) / 180);
              const [tx, ty] = project(walk.lng + (Math.sin(rad) * step) / Math.max(0.35, clat), walk.lat + Math.cos(rad) * step, camRef.current, w, h);
              const ang = Math.atan2(ty - y, tx - x);
              const len = 18 * r;
              ctx.fillStyle = "#7dffc9";
              ctx.strokeStyle = "#0a2018";
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.moveTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
              ctx.lineTo(x + Math.cos(ang + 2.45) * 8 * r, y + Math.sin(ang + 2.45) * 8 * r);
              ctx.lineTo(x + Math.cos(ang - 2.45) * 8 * r, y + Math.sin(ang - 2.45) * 8 * r);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
            ctx.fillStyle = "#9af0d4";
            ctx.beginPath();
            ctx.arc(x, y, 6.4 * r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#0a2018";
            ctx.lineWidth = 1.4;
            ctx.stroke();
            ctx.fillStyle = "#fff";
            ctx.beginPath();
            ctx.arc(x, y, 2.6 * r, 0, Math.PI * 2);
            ctx.fill();
          }
          const shop = st.konbiniWalk ? st.selectedKonbini : null;
          if (shop && Number.isFinite(x) && Number.isFinite(y)) {
            const [sx, sy] = project(shop.lng, shop.lat, camRef.current, w, h);
            if (Number.isFinite(sx) && Number.isFinite(sy)) {
              drawWalkGuide(ctx, x, y, sx, sy, KONBINI_META[shop.brand].color, metersTo(shop, user));
            }
          }
          const stayWalkTo = st.stayWalk ? st.selectedStay : null;
          if (stayWalkTo && Number.isFinite(x) && Number.isFinite(y)) {
            const [sx, sy] = project(stayWalkTo.lng, stayWalkTo.lat, camRef.current, w, h);
            if (Number.isFinite(sx) && Number.isFinite(sy)) {
              const m = haversine([user.lng, user.lat], [stayWalkTo.lng, stayWalkTo.lat]) * 1000;
              drawWalkGuide(ctx, x, y, sx, sy, "#ffe08a", m);
            }
          }
          const mateWalkTo = st.mateWalk ? st.selectedMate : null;
          if (mateWalkTo && Number.isFinite(x) && Number.isFinite(y)) {
            const [sx, sy] = project(mateWalkTo.lng, mateWalkTo.lat, camRef.current, w, h);
            if (Number.isFinite(sx) && Number.isFinite(sy)) {
              const m = haversine([user.lng, user.lat], [mateWalkTo.lng, mateWalkTo.lat]) * 1000;
              const near = stationsNearPlace(useMapStore.getState().stationIndex, user.lng, user.lat, 1)[0];
              const his = stationsNearPlace(useMapStore.getState().stationIndex, mateWalkTo.lng, mateWalkTo.lat, 1)[0];
              const sameStop = Boolean(near && his && near.station.name === his.station.name);
              if (m >= 50 && (sameStop || m < 1200)) drawWalkGuide(ctx, x, y, sx, sy, "#ffe08a", m);
            }
          }
        }

        const partyPins = useMapStore.getState().partyPins;
        for (const pin of partyPins) {
          const [px, py] = project(pin.lng, pin.lat, camRef.current, w, h);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          const pulse = 0.7 + 0.3 * Math.sin(ts / 280);
          ctx.fillStyle = `rgba(255, 214, 110, ${0.16 + 0.14 * pulse})`;
          ctx.beginPath();
          ctx.arc(px, py, 16 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#ffe08a";
          ctx.beginPath();
          ctx.arc(px, py, 6.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#0a2018";
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.beginPath();
          ctx.arc(px, py, 2.4, 0, Math.PI * 2);
          ctx.fill();
          const label = pin.nick;
          ctx.font = mapFont(14, 700);
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(10,16,14,0.78)";
          ctx.beginPath();
          roundRectPath(ctx, px - tw / 2 - 5, py - 28, tw + 10, 17, 5);
          ctx.fill();
          ctx.fillStyle = "#fff6d8";
          ctx.fillText(label, px, py - 14);
        }

        const nearest = useMapStore.getState().journey ? [] : useMapStore.getState().nearestStations;
        const nearLang = useMapStore.getState().lang;
        const tNear = copies[nearLang];
        const selSt = useMapStore.getState().selectedStation;
        for (const row of nearest) {
          const st = row.station;
          const [x, y] = project(st.lng, st.lat, camRef.current, w, h);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ts / 320));
          ctx.strokeStyle = `rgba(255, 214, 110, ${0.35 + 0.4 * pulse})`;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(x, y, 11 + 8 * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "#ffe08a";
          ctx.beginPath();
          ctx.arc(x, y, 3.4, 0, Math.PI * 2);
          ctx.fill();
          const tip = `${tNear.nearestYou} · ${formatKm(row.km)}`;
          ctx.font = mapFont(11, 700);
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          const tw = ctx.measureText(tip).width;
          ctx.fillStyle = "rgba(28, 22, 8, 0.9)";
          ctx.beginPath();
          roundRectPath(ctx, x - tw / 2 - 6, y - 28, tw + 12, 16, 6);
          ctx.fill();
          ctx.fillStyle = "#ffe08a";
          ctx.fillText(tip, x, y - 14);
          if (selSt?.name === st.name && user) {
            const [ux, uy] = project(user.lng, user.lat, camRef.current, w, h);
            if (Number.isFinite(ux) && Number.isFinite(uy)) {
              const m = haversine([user.lng, user.lat], [st.lng, st.lat]) * 1000;
              drawWalkGuide(ctx, ux, uy, x, y, "#ffe08a", m);
            }
          }
        }
      } catch {
        /* keep looping */
      }
    };
    raf = requestAnimationFrame(draw);

    const pointers = new Map<number, { x: number; y: number }>();
    let mapGesture = false;

    const breakAuto = () => {
      camLerpRef.current = null;
      introDoneRef.current = true;
      if (useMapStore.getState().followTrainId) useMapStore.getState().setFollowTrainId(null);
    };

    const pick = (sx: number, sy: number) => {
      const cam = camRef.current;
      const { w, h } = sizeRef.current;
      const picking = useMapStore.getState().pickField;
      const hitStationNear = (maxD: number) => {
        let bestSt: { n: string; lng: number; lat: number; pf: string } | null = null;
        let bestS = maxD;
        for (const line of lineRef.current) {
          for (const s of line.stops) {
            const [x, y] = project(s.lng, s.lat, cam, w, h);
            const d = Math.hypot(x - sx, y - sy);
            if (d < bestS) {
              bestS = d;
              bestSt = s;
            }
          }
        }
        if (!bestSt) return null;
        const idx = useMapStore.getState().stationIndex;
        const keyed = idx.get(`${bestSt.n}|${bestSt.pf}`);
        if (keyed && Math.hypot(keyed.lng - bestSt.lng, keyed.lat - bestSt.lat) < 0.05) return keyed;
        let bestHit: StationHit | null = null;
        let bestD = Infinity;
        for (const st of idx.values()) {
          if (st.name !== bestSt.n) continue;
          const d = Math.hypot(st.lng - bestSt.lng, st.lat - bestSt.lat);
          if (d < bestD) {
            bestD = d;
            bestHit = st;
          }
        }
        return (
          bestHit ?? {
            name: bestSt.n,
            lng: bestSt.lng,
            lat: bestSt.lat,
            prefecture: bestSt.pf,
            lines: [],
          }
        );
      };
      const rideHere = () => {
        const me = useMapStore.getState().userLocation;
        if (!me) return false;
        const [ux, uy] = project(me.lng, me.lat, cam, w, h);
        if (!Number.isFinite(ux) || Math.hypot(ux - sx, uy - sy) > 54) return false;
        let ride: Train | null = null;
        let bestKm = Infinity;
        for (const t of trainsRef.current) {
          if (t.kind === "flight" || t.kind === "bus") continue;
          const km = haversine([t.lng, t.lat], [me.lng, me.lat]);
          if (km < bestKm) {
            bestKm = km;
            ride = t;
          }
        }
        if (!ride || bestKm > 0.55) {
          const snap = nearestTrainAt(lineRef.current, simNow(), me.lng, me.lat);
          if (snap) {
            const d = haversine([snap.lng, snap.lat], [me.lng, me.lat]);
            if (d < 0.55) {
              ride = snap;
              bestKm = d;
            } else if (bestKm > 0.55) ride = null;
          } else if (bestKm > 0.55) ride = null;
        }
        if (!ride || bestKm > 0.55) return false;
        const s = useMapStore.getState();
        s.selectStay(null);
        s.selectStation(null);
        if (s.selectedTrain?.id === ride.id) {
          s.dismissPick();
        } else {
          s.selectTrain(ride);
          s.setFollowTrainId(null);
          if (ride.kind !== "flight") {
            void calibrateTrain(ride);
            void pinLivePosition(ride, lineRef.current, useMapStore.getState().odptKey).then((next) => {
              if (useMapStore.getState().selectedTrain?.id === ride.id) useMapStore.getState().selectTrain(next);
            });
          }
        }
        return true;
      };
      if (picking) {
        const hit = hitStationNear(52);
        if (hit && fillPickedStation(hit)) return;
        for (const ap of AIRPORTS) {
          const [x, y] = project(ap.lng, ap.lat, cam, w, h);
          if (Math.hypot(x - sx, y - sy) < 32) {
            fillPickedStation({ name: ap.n, lng: ap.lng, lat: ap.lat, prefecture: "空港", lines: [] });
            return;
          }
        }
        return;
      }
      for (const pin of useMapStore.getState().partyPins) {
        const [x, y] = project(pin.lng, pin.lat, cam, w, h);
        if (Math.hypot(x - sx, y - sy) < 28 || Math.hypot(x - sx, y - 18 - sy) < 22) {
          const s = useMapStore.getState();
          s.setPartyCollapsed(true);
          if (pin.mine) {
            s.requestFlyTo({ lng: pin.lng, lat: pin.lat, bearing: 0, pitch: 0.55 });
            return;
          }
          if (s.selectedMate?.id === pin.id && s.mateWalk) return;
          s.selectMate({ id: pin.id, nick: pin.nick, lng: pin.lng, lat: pin.lat, station: pin.station });
          s.setMateWalk(true);
          void applyMateTrip({ nick: pin.nick, lng: pin.lng, lat: pin.lat }).then((ok) => {
            if (!ok) useMapStore.getState().requestFlyTo({ lng: pin.lng, lat: pin.lat, bearing: 0, pitch: 0.55 });
          });
          return;
        }
      }
      for (const stay of STAYS) {
        if (!useMapStore.getState().stayLayer) break;
        const [x, y] = project(stay.lng, stay.lat, cam, w, h);
        const rad = 28 * markScale(stay.lng, stay.lat, cam, w, h);
        if (Math.hypot(x - sx, y - sy) < rad || Math.hypot(x - sx, y + 12 - sy) < rad) {
          if (useMapStore.getState().selectedStay?.id === stay.id) return;
          focusStay(stay);
          return;
        }
      }
      if (useMapStore.getState().konbiniBrand) {
        const here = useMapStore.getState().userLocation ?? NODA;
        const ring = konbiniRingM(here, useMapStore.getState().stationIndex, useMapStore.getState().nearestStations);
        for (const shop of useMapStore.getState().konbiniStores) {
          const brand = useMapStore.getState().konbiniBrand;
          if (brand && brand !== "all" && shop.brand !== brand) continue;
          if (metersTo(shop, here) > ring) continue;
          const [x, y] = project(shop.lng, shop.lat, cam, w, h);
          const rad = 22 * markScale(shop.lng, shop.lat, cam, w, h);
          if (Math.hypot(x - sx, y - sy) < rad) {
            focusKonbini(shop);
            return;
          }
        }
      }
      if (useMapStore.getState().selectedStay) {
        const stay = useMapStore.getState().selectedStay;
        const shopNear = stay
          ? stationsNearPlace(useMapStore.getState().stationIndex, stay.lng, stay.lat, 2)
          : [];
        for (const row of shopNear) {
          const [x, y] = project(row.station.lng, row.station.lat, cam, w, h);
          if (Math.hypot(x - sx, y - sy) < 36) {
            const s = useMapStore.getState();
            s.selectStay(null);
            s.selectTrain(null);
            s.setFollowTrainId(null);
            s.setDest(row.station);
            s.selectStation(row.station);
            s.setSheetOpen(true);
            return;
          }
        }
        return;
      }
      if (useMapStore.getState().selectedKonbini) return;
      {
        const quakes = useMapStore.getState().quakes;
        let hitQ: (typeof quakes)[number] | null = null;
        let best = 36;
        for (const q of quakes) {
          const [gx, gy] = project(q.lng, q.lat, cam, w, h, 0);
          const hypo = benioffPoint(q.lng, q.lat, q.depthKm);
          const [hx, hy] = project(hypo.lng, hypo.lat, cam, w, h, hypo.alt);
          const d = Math.min(Math.hypot(gx - sx, gy - sy), Math.hypot(hx - sx, hy - sy));
          if (d < best) {
            best = d;
            hitQ = q;
          }
        }
        if (hitQ) {
          const s = useMapStore.getState();
          s.selectStay(null);
          s.selectTrain(null);
          s.setFollowTrainId(null);
          s.selectStation(null);
          s.setSheetOpen(false);
          if (s.selectedQuake?.id === hitQ.id) s.selectQuake(null);
          else {
            s.selectQuake(hitQ);
            s.requestFlyTo({ lng: hitQ.lng, lat: hitQ.lat, zoom: 8.8, bearing: 0, pitch: 0.92 });
          }
          return;
        }
      }
      let bestTrain: Train | null = null;
      let bestScore = 1;
      for (const t of trainsRef.current) {
        const [x, y] = project(t.lng, t.lat, cam, w, h, vehicleAlt(t));
        let d = Math.hypot(x - sx, y - sy);
        if (t.kind === "flight") {
          const [gx, gy] = project(t.lng, t.lat, cam, w, h, 0);
          d = Math.min(d, Math.hypot(gx - sx, gy - sy));
        }
        const rad = t.kind === "flight" ? (cam.zoom < 7.2 ? 36 : 52) : 28;
        const score = d / rad;
        if (d <= rad && score < bestScore) {
          bestScore = score;
          bestTrain = t;
        }
      }
      if (bestTrain) {
        const s = useMapStore.getState();
        s.selectStay(null);
        if (s.selectedTrain?.id === bestTrain.id) {
          s.dismissPick();
        } else {
          s.selectTrain(bestTrain);
          s.setFollowTrainId(null);
          if (bestTrain.kind !== "flight") {
            void calibrateTrain(bestTrain);
            void pinLivePosition(bestTrain, lineRef.current, useMapStore.getState().odptKey).then((next) => {
              if (useMapStore.getState().selectedTrain?.id === bestTrain.id) useMapStore.getState().selectTrain(next);
            });
          }
        }
        return;
      }
      if (rideHere()) return;
      for (const ap of AIRPORTS) {
        const [x, y] = project(ap.lng, ap.lat, cam, w, h);
        if (Math.hypot(x - sx, y - sy) < 22) {
          const apHit = {
            name: ap.n,
            lng: ap.lng,
            lat: ap.lat,
            prefecture: "空港",
            lines: [],
          };
          if (fillPickedStation(apHit)) return;
          const s = useMapStore.getState();
          s.selectStay(null);
          s.selectTrain(null);
          s.setFollowTrainId(null);
          if (s.selectedStation?.name === apHit.name) s.selectStation(null);
          else s.selectStation(apHit);
          return;
        }
      }
      if (cam.zoom < 9.2) {
        for (const row of useMapStore.getState().nearestStations) {
          const [x, y] = project(row.station.lng, row.station.lat, cam, w, h);
          if (Math.hypot(x - sx, y - sy) < 36) {
            const s = useMapStore.getState();
            s.selectStay(null);
            s.selectTrain(null);
            s.setFollowTrainId(null);
            if (s.selectedStation?.name === row.station.name) s.selectStation(null);
            else {
              s.selectStation(row.station);
              void calibrateStation(row.station);
            }
            s.setSheetOpen(true);
            return;
          }
        }
        const s = useMapStore.getState();
        if (s.selectedMate || s.mateWalk) {
          s.selectMate(null);
          s.setMateWalk(false);
          s.clearTrip();
          return;
        }
        if (s.journey || s.journeys.length || s.selectedStay || s.selectedKonbini || s.stayWalk || s.konbiniWalk) return;
        s.dismissPick();
        return;
      }
      const hit = hitStationNear(28);
      if (hit && !fillPickedStation(hit)) {
        const s = useMapStore.getState();
        s.selectStay(null);
        s.selectTrain(null);
        s.setFollowTrainId(null);
        if (s.selectedStation?.name === hit.name && Math.hypot(s.selectedStation.lng - hit.lng, s.selectedStation.lat - hit.lat) < 0.02) s.selectStation(null);
        else {
          s.selectStation(hit);
          void calibrateStation(hit);
        }
        return;
      }
      {
        const s = useMapStore.getState();
        if (s.selectedMate || s.mateWalk) {
          s.selectMate(null);
          s.setMateWalk(false);
          s.clearTrip();
          return;
        }
        if (s.journey || s.journeys.length || s.selectedStay || s.selectedKonbini || s.stayWalk || s.konbiniWalk) return;
        s.dismissPick();
      }
    };

    const liveCam = () => (camLerpRef.current ? lerpTarget(camLerpRef.current) : camRef.current);

    const zoomAt = (cx: number, cy: number, next: number, dur = 220) => {
      const { w, h } = sizeRef.current;
      const src = liveCam();
      const dest = zoomTowardPoint(src, cx, cy, w, h, next);
      camLerpRef.current = beginLerp(camRef.current, dest, dur);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      breakAuto();
      const rect = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 800 : 1;
      const delta = (-e.deltaY * unit) * 0.00115;
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, liveCam().zoom + delta, 180);
    };

    let lastTap = 0;
    let pickTimer = 0;

    const zoomToScreen = (sx: number, sy: number) => {
      const { w, h } = sizeRef.current;
      const src = camRef.current;
      const nextZoom = Math.min(MAX_ZOOM, src.zoom + ZOOM_STEP);
      useMapStore.getState().setFollowTrainId(null);
      const dest = zoomCenterOn(src, sx, sy, w, h, nextZoom);
      camLerpRef.current = beginLerp(src, dest, 480);
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      camLerpRef.current = null;
      if (pointers.size === 1) {
        mapGesture = false;
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          lng: camRef.current.lng,
          lat: camRef.current.lat,
          yaw: camRef.current.yaw,
          tilt: camRef.current.tilt,
        };
      } else if (pointers.size === 2) {
        mapGesture = true;
        breakAuto();
        const pts = [...pointers.values()];
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          lng: camRef.current.lng,
          lat: camRef.current.lat,
          pinching: true,
          rotating: false,
          pinchLock: false,
          dist: Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y),
          zoom: camRef.current.zoom,
          yaw: camRef.current.yaw,
          tilt: camRef.current.tilt,
          angle: Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x),
          mx: (pts[0]!.x + pts[1]!.x) / 2,
          my: (pts[0]!.y + pts[1]!.y) / 2,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = drag.current;
      if (!d) return;
      if (pointers.size >= 2 && (d.pinching || d.rotating)) {
        mapGesture = true;
        breakAuto();
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        const mx = (pts[0]!.x + pts[1]!.x) / 2;
        const my = (pts[0]!.y + pts[1]!.y) / 2;
        const angle = Math.atan2(pts[1]!.y - pts[0]!.y, pts[1]!.x - pts[0]!.x);
        const rect = canvas.getBoundingClientRect();
        if (d.dist && d.zoom != null && dist > 8) {
          const ratio = dist / Math.max(12, d.dist);
          const delta = Math.log2(Math.max(0.28, Math.min(3.6, ratio))) * 0.68;
          const { w, h } = sizeRef.current;
          const src: Cam = {
            lng: d.lng,
            lat: d.lat,
            zoom: d.zoom,
            yaw: camRef.current.yaw,
            tilt: camRef.current.tilt,
          };
          const dest = zoomTowardPoint(src, mx - rect.left, my - rect.top, w, h, d.zoom + delta);
          camRef.current.lng = dest.lng;
          camRef.current.lat = dest.lat;
          camRef.current.zoom = dest.zoom;
        }
        let dAng = 0;
        if (d.angle != null) {
          dAng = angle - d.angle;
          if (dAng > Math.PI) dAng -= Math.PI * 2;
          if (dAng < -Math.PI) dAng += Math.PI * 2;
        }
        const scaleDelta = d.dist ? Math.abs(dist / d.dist - 1) : 0;
        if (scaleDelta > 0.04) d.pinchLock = true;
        if (!d.rotating && !d.pinchLock && Math.abs(dAng) > 0.78 && scaleDelta < 0.03) {
          d.rotating = true;
          d.angle = angle;
          d.yaw = camRef.current.yaw;
          dAng = 0;
        }
        if (d.rotating && !d.pinchLock && d.yaw != null) {
          camRef.current.yaw = d.yaw + dAng * 0.42;
        }
        if (!d.rotating && d.mx != null && d.my != null) {
          camRef.current.lng = d.lng;
          camRef.current.lat = d.lat;
          panCam(camRef.current, mx - d.mx, my - d.my, panGain(camRef.current.zoom));
        } else {
          keepJapanInView(camRef.current);
        }
        return;
      }
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const moved = Math.hypot(dx, dy);
      if (moved > 22) {
        mapGesture = true;
        breakAuto();
      }
      if (moved < 22 && !d.mode) return;
      d.mode = "pan";

      camRef.current.lng = d.lng;
      camRef.current.lat = d.lat;
      panCam(camRef.current, dx, dy, panGain(camRef.current.zoom));
    };

    const onPointerUp = (e: PointerEvent) => {
      const start = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && drag.current?.pinching) drag.current = null;
      if (pointers.size === 0) {
        if (!mapGesture && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 24) {
          const now = performance.now();
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          if (now - lastTap < 340) {
            lastTap = 0;
            window.clearTimeout(pickTimer);
            zoomToScreen(sx, sy);
          } else {
            lastTap = now;
            window.clearTimeout(pickTimer);
            pickTimer = window.setTimeout(() => pick(sx, sy), 340);
          }
        }
        drag.current = null;
        mapGesture = false;
        baseKey = "";
        setZoomUi(camRef.current.zoom);
      }
    };

    const onDblClick = (e: MouseEvent) => {
      e.preventDefault();
      lastTap = 0;
      window.clearTimeout(pickTimer);
      const rect = canvas.getBoundingClientRect();
      zoomToScreen(e.clientX - rect.left, e.clientY - rect.top);
    };

    const onHoverMove = (e: PointerEvent) => {
      if (pointers.size > 0 || e.buttons) {
        if (pointers.size > 0) hoverIdRef.current = null;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const cam = camRef.current;
      const { w, h } = sizeRef.current;
      let best: string | null = null;
      let bestScore = 1;
      for (const t of trainsRef.current) {
        const [x, y] = project(t.lng, t.lat, cam, w, h, vehicleAlt(t));
        let d = Math.hypot(x - sx, y - sy);
        if (t.kind === "flight") {
          const [gx, gy] = project(t.lng, t.lat, cam, w, h, 0);
          d = Math.min(d, Math.hypot(gx - sx, gy - sy));
        }
        const rad = t.kind === "flight" ? (cam.zoom < 7.2 ? 36 : 52) : 28;
        const score = d / rad;
        if (d <= rad && score < bestScore) {
          bestScore = score;
          best = t.id;
        }
      }
      hoverIdRef.current = best;
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointermove", onHoverMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("dblclick", onDblClick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.clearTimeout(pickTimer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointermove", onHoverMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, []);

  const lang = useMapStore((s) => s.lang);
  const t = copies[lang];
  const clock = useMapStore((s) => s.clock);

  const bumpYaw = (dir: 1 | -1) => {
    useMapStore.getState().setFollowTrainId(null);
    camLerpRef.current = null;
    const cam = camRef.current;
    camRef.current = { ...cam, yaw: cam.yaw + dir * 0.16 };
  };
  const goSelf = () => {
    const { w, h } = sizeRef.current;
    const store = useMapStore.getState();
    store.setFollowTrainId(null);
    store.selectTrain(null);
    store.selectStation(null);
    introDoneRef.current = true;
    const user = store.userLocation;
    if (user) {
      const farKm = store.nearestStations.length
        ? Math.max(...store.nearestStations.map((r) => r.km), 0.7)
        : 2;
      const z = zoomToFitKm(farKm, h);
      const next = placeUpper(user.lng, user.lat, z, w, h);
      camLerpRef.current = beginLerp(camRef.current, { ...next, yaw: 0, tilt: HOME_TILT }, 720);
      setTiltUi(HOME_TILT);
      setZoomUi(z);
      pullRoads(user.lng, user.lat, z);
      return;
    }
    locateUser(true);
  };
  const applyZoom = (raw: number) => {
    useMapStore.getState().setFollowTrainId(null);
    camLerpRef.current = null;
    const z = clampZoom(raw);
    const { w, h } = sizeRef.current;
    const dest = zoomTowardPoint(camRef.current, w / 2, h / 2, w, h, z);
    camRef.current = dest;
    setZoomUi(z);
  };
  const applyTilt = (raw: number) => {
    useMapStore.getState().setFollowTrainId(null);
    camLerpRef.current = null;
    const v = clampTilt(raw);
    camRef.current.tilt = v;
    setTiltUi(v);
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 h-full w-full overflow-hidden overscroll-none bg-bg">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="map" />
      <div className="pointer-events-auto absolute top-[max(0.7rem,env(safe-area-inset-top))] right-2 z-40 flex w-[6.75rem] flex-col items-center gap-1.5">
        <LangSwitch />
        <p className="text-[11px] leading-none font-medium tabular-nums tracking-tight text-fg">{clock}</p>
        <div className="flex w-full justify-center gap-1">
          <Button variant="outline" size="iconSm" className="bg-surface/80 shadow-[var(--shadow-border)] backdrop-blur-md" aria-label="rotate left" onClick={() => bumpYaw(-1)}>
            <RotateCcw />
          </Button>
          <Button variant="outline" size="iconSm" className="bg-surface/80 shadow-[var(--shadow-border)] backdrop-blur-md" aria-label="rotate right" onClick={() => bumpYaw(1)}>
            <RotateCw />
          </Button>
        </div>
        <div className="flex items-end justify-center gap-0.5">
          <div className="flex flex-col items-center gap-1">
            <span className="text-[11px] leading-none font-semibold text-fg">+</span>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(((zoomUi - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 1000)}
              aria-label={t.zoomSlider}
              className="h-32 w-6 cursor-pointer accent-[var(--accent)]"
              style={{ writingMode: "vertical-rl", direction: "rtl" }}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => applyZoom(MIN_ZOOM + (Number(e.target.value) / 1000) * (MAX_ZOOM - MIN_ZOOM))}
            />
            <span className="text-[11px] leading-none font-semibold text-fg">−</span>
            <span className="mt-0.5 text-[10px] font-medium tracking-wide text-fg-muted">{t.zoomSlider}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round((tiltUi / (Math.PI / 2)) * 1000)}
              aria-label={t.viewAngle}
              className="h-32 w-6 cursor-pointer accent-[var(--accent)]"
              style={{ writingMode: "vertical-rl", direction: "ltr" }}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => applyTilt((Number(e.target.value) / 1000) * (Math.PI / 2))}
            />
            <span className="mt-0.5 text-[10px] font-medium tracking-wide text-fg-muted">{t.viewAngle}</span>
          </div>
        </div>
        <Button variant="outline" size="iconSm" className="bg-surface/80 shadow-[var(--shadow-border)] backdrop-blur-md" aria-label={t.locate} onClick={goSelf}>
          <LocateFixed />
        </Button>
      </div>
    </div>
  );
}

function LangSwitch() {
  const lang = useMapStore((s) => s.lang);
  const items: { id: Lang; label: string }[] = [
    { id: "ja", label: "JP" },
    { id: "zh", label: "中" },
    { id: "en", label: "EN" },
  ];
  return (
    <div className="flex h-9 w-full items-center justify-center rounded-[var(--radius-md)] bg-surface/92 p-0.5 shadow-[var(--shadow-border)] backdrop-blur-md">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`h-8 min-w-8 flex-1 rounded-[var(--radius-sm)] px-1 text-[11px] font-medium ${
            lang === item.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"
          }`}
          onClick={() => useMapStore.getState().setLang(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
