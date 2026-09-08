export type RailKind = "shinkansen" | "jr" | "subway" | "private" | "bus";
export type VehicleKind = RailKind | "flight";

export type Stop = {
  n: string;
  lng: number;
  lat: number;
  pf: string;
  pv: string | null;
  nx: string | null;
};

export type LineJson = {
  id: string;
  name: string;
  color: string;
  kind: RailKind;
  headway: number;
  speed: number;
  loop: boolean;
  path: [number, number][];
  stops: Stop[];
};

export type LineRuntime = LineJson & {
  cum: number[];
  stopKm: number[];
  totalKm: number;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  drawPath: [number, number][];
};

export type Train = {
  id: string;
  lineId: string;
  lineName: string;
  color: string;
  kind: VehicleKind;
  lng: number;
  lat: number;
  bearing: number;
  dir: 0 | 1;
  dest: string;
  nextStop: string;
  prevStop: string;
  delayMin: number;
  delaySec?: number;
  delayAlert?: boolean;
  progress: number;
  stopIndex: number;
  etaMin?: number;
  arrUnix?: number;
  gtfsStatus?: number;
  /** True when the live feed had its own coordinates (not a station pin). */
  gps?: boolean;
  fromPlatform?: string;
  toPlatform?: string;
  boardHhmm?: string;
  alightHhmm?: string;
  posStatus?: "live" | "dia" | "timetable" | "crowd";
  liveLate?: boolean;
};

export type StationHit = {
  name: string;
  lng: number;
  lat: number;
  prefecture: string;
  lines: LineRuntime[];
  keys?: string[];
};

export type Departure = {
  id: string;
  lineId: string;
  lineName: string;
  color: string;
  dest: string;
  dir: 0 | 1;
  minutesUntil: number;
  hhmm: string;
  delayMin: number;
  trainId: string;
  prevStop: string;
  nextStop: string;
};

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RouteStop = {
  name: string;
  lng: number;
  lat: number;
  prefecture: string;
};

export type RouteLeg = {
  kind: "ride" | "walk";
  lineId?: string;
  lineName?: string;
  color?: string;
  toward?: string;
  trainType?: string;
  fromPlatform?: string;
  toPlatform?: string;
  from: RouteStop;
  to: RouteStop;
  stops: RouteStop[];
  minutes: number;
  departHhmm?: string;
  arriveHhmm?: string;
  path?: [number, number][];
};

export type Journey = {
  origin: RouteStop;
  dest: RouteStop;
  legs: RouteLeg[];
  totalMinutes: number;
  transfers: number;
  departHhmm: string;
  arriveHhmm: string;
  walkFromGpsMin?: number;
  walkToDestMin?: number;
  source?: "google" | "local" | "yahoo";
  delayMin?: number;
  delaySec?: number;
  /** Line-level 運行情報 delay with no numeric seconds (Yahoo 列車遅延). */
  delayAlert?: boolean;
};

