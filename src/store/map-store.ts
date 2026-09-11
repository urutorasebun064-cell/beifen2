import { create } from "zustand";
import { detectLang, type Lang } from "@/lib/i18n";
import { dateAtTokyoClock, nearestStationsFrom, NODA } from "@/lib/rail/geo";
import type { Departure, Journey, LineRuntime, StationHit, Train } from "@/lib/rail/types";
import type { Stay } from "@/data/stays";
import type { KonbiniBrand, KonbiniStore } from "@/lib/konbini";
import type { Peak } from "@/data/peaks";
import type { Quake } from "@/lib/quake";
import type { WeatherSpot } from "@/lib/weather";
import { patchSave } from "@/lib/save-sync";

export type PitchMode = "3d" | "2d";
export type MenuKind = "quake" | "radar" | "stay" | "peaks";
export type MenuCam = { lng: number; lat: number; zoom: number; bearing: number; pitch: number };

type MapStore = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  lines: LineRuntime[];
  stationIndex: Map<string, StationHit>;
  ready: boolean;
  loadError: string | null;
  setDataset: (lines: LineRuntime[], index: Map<string, StationHit>) => void;
  setLoadError: (msg: string | null) => void;
  userLocation: { lng: number; lat: number } | null;
  locateStatus: "idle" | "pending" | "ok" | "denied" | "error" | "outside";
  setUserLocation: (
    loc: { lng: number; lat: number } | null,
    status: MapStore["locateStatus"],
  ) => void;
  headingDeg: number | null;
  headingFlat: boolean;
  setHeading: (deg: number | null, flat: boolean) => void;
  selectedStation: StationHit | null;
  selectStation: (station: StationHit | null) => void;
  selectedTrain: Train | null;
  selectTrain: (train: Train | null) => void;
  followTrainId: string | null;
  setFollowTrainId: (id: string | null) => void;
  hideGuide: boolean;
  watchTrain: (train: Train) => void;
  query: string;
  setQuery: (q: string) => void;
  pitchMode: PitchMode;
  setPitchMode: (mode: PitchMode) => void;
  flyTo: { lng: number; lat: number; zoom?: number; bearing?: number; pitch?: number; center?: boolean; ox?: number; oy?: number; nonce: number } | null;
  requestFlyTo: (target: { lng: number; lat: number; zoom?: number; bearing?: number; pitch?: number; center?: boolean; ox?: number; oy?: number }) => void;
  trainCount: number;
  setTrainCount: (n: number) => void;
  clock: string;
  setClock: (s: string) => void;
  originStation: StationHit | null;
  destStation: StationHit | null;
  journey: Journey | null;
  journeys: Journey[];
  journeyIndex: number;
  setOrigin: (station: StationHit | null) => void;
  setDest: (station: StationHit | null) => void;
  setJourney: (journey: Journey | null) => void;
  setJourneys: (journeys: Journey[], index?: number) => void;
  clearTrip: () => void;
  dismissPick: () => void;
  pickField: "from" | "to" | null;
  setPickField: (field: "from" | "to" | null) => void;
  timeMode: "depart" | "arrive";
  setTimeMode: (mode: "depart" | "arrive") => void;
  searching: boolean;
  setSearching: (v: boolean) => void;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  odptKey: string;
  setOdptKey: (key: string) => void;
  liveTrains: Train[];
  liveSource: "odpt" | "sim" | "live";
  liveError: string | null;
  setLive: (trains: Train[], source: "odpt" | "sim" | "live", error: string | null) => void;
  googleKey: string;
  setGoogleKey: (key: string) => void;
  googleDepartures: Departure[];
  googleTrains: Train[];
  setGoogleBoard: (departures: Departure[], trains: Train[]) => void;
  jrDepartures: Departure[];
  jrTrains: Train[];
  setJrBoard: (departures: Departure[], trains: Train[]) => void;
  selectedStay: Stay | null;
  selectStay: (stay: Stay | null) => void;
  stayLayer: boolean;
  setStayLayer: (on: boolean) => void;
  stayMenuOpen: boolean;
  setStayMenuOpen: (on: boolean) => void;
  partyMenuOpen: boolean;
  setPartyMenuOpen: (on: boolean) => void;
  partyCollapsed: boolean;
  setPartyCollapsed: (on: boolean) => void;
  partyInRoom: boolean;
  setPartyInRoom: (on: boolean) => void;
  partyAlert: boolean;
  setPartyAlert: (on: boolean) => void;
  partyPins: { id: string; nick: string; lng: number; lat: number; station?: string; mine?: boolean }[];
  setPartyPins: (pins: { id: string; nick: string; lng: number; lat: number; station?: string; mine?: boolean }[]) => void;
  selectedMate: { id: string; nick: string; lng: number; lat: number; station?: string } | null;
  selectMate: (mate: { id: string; nick: string; lng: number; lat: number; station?: string } | null) => void;
  mateWalk: boolean;
  setMateWalk: (on: boolean) => void;
  stayScreen: { x: number; y: number } | null;
  setStayScreen: (pos: { x: number; y: number } | null) => void;
  stayWalk: boolean;
  setStayWalk: (on: boolean) => void;
  stayChat: boolean;
  setStayChat: (on: boolean) => void;
  konbiniBrand: KonbiniBrand | "all" | null;
  setKonbiniBrand: (brand: KonbiniBrand | "all" | null) => void;
  konbiniStores: KonbiniStore[];
  setKonbiniStores: (stores: KonbiniStore[]) => void;
  konbiniLoading: boolean;
  setKonbiniLoading: (on: boolean) => void;
  selectedKonbini: KonbiniStore | null;
  selectKonbini: (store: KonbiniStore | null) => void;
  konbiniScreen: { x: number; y: number } | null;
  setKonbiniScreen: (pos: { x: number; y: number } | null) => void;
  konbiniChat: boolean;
  setKonbiniChat: (on: boolean) => void;
  shopChatCollapsed: boolean;
  setShopChatCollapsed: (on: boolean) => void;
  konbiniWalk: boolean;
  setKonbiniWalk: (on: boolean) => void;
  quakes: Quake[];
  selectedQuake: Quake | null;
  setQuakes: (quakes: Quake[]) => void;
  selectQuake: (quake: Quake | null) => void;
  quakeMenuOpen: boolean;
  setQuakeMenuOpen: (on: boolean) => void;
  weatherSpots: WeatherSpot[];
  setWeatherSpots: (spots: WeatherSpot[]) => void;
  radarEnabled: boolean;
  setRadarEnabled: (on: boolean) => void;
  radarHidden: number[];
  toggleRadarBand: (band: number) => void;
  ringMode: "auto" | "on" | "off";
  setRingMode: (mode: "auto" | "on" | "off") => void;
  mountainLayer: boolean;
  setMountainLayer: (on: boolean) => void;
  selectedPeak: Peak | null;
  selectPeak: (peak: Peak | null) => void;
  peakScreen: { x: number; y: number } | null;
  setPeakScreen: (pos: { x: number; y: number } | null) => void;
  exclusiveOpen: (kind: MenuKind) => void;
  menuView: Partial<Record<MenuKind, MenuCam>>;
  stashMenuView: (kind: MenuKind, cam: MenuCam) => void;
  takeMenuView: (kind: MenuKind) => MenuCam | null;
  nearestStations: { station: StationHit; km: number }[];
  viewTime: string | null;
  clockOffsetMs: number;
  setViewTime: (hhmm: string | null) => void;
};

let flyNonce = 0;

export const useMapStore = create<MapStore>((set, get) => ({
  lang: detectLang(),
  setLang: (lang) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("jb-lang", lang);
      patchSave({ lang });
    }
    set({ lang });
  },
  lines: [],
  stationIndex: new Map(),
  ready: true,
  loadError: null,
  setDataset: (lines, stationIndex) =>
    set((s) => ({
      lines,
      stationIndex,
      ready: true,
      loadError: null,
      nearestStations: s.userLocation
        ? nearestStationsFrom(stationIndex, s.userLocation.lng, s.userLocation.lat, 1, 1e9)
        : [],
    })),
  setLoadError: (loadError) => set({ loadError }),
  userLocation: NODA,
  locateStatus: "idle",
  setUserLocation: (userLocation, locateStatus) =>
    set((s) => ({
      userLocation,
      locateStatus,
      nearestStations: userLocation
        ? nearestStationsFrom(s.stationIndex, userLocation.lng, userLocation.lat, 1, 1e9)
        : [],
    })),
  headingDeg: null,
  headingFlat: false,
  setHeading: (headingDeg, headingFlat) => set({ headingDeg, headingFlat }),
  selectedStation: null,
  selectStation: (selectedStation) => set({ selectedStation }),
  selectedTrain: null,
  selectTrain: (selectedTrain) =>
    set((s) => ({
      selectedTrain,
      followTrainId: selectedTrain && s.followTrainId ? selectedTrain.id : selectedTrain ? s.followTrainId : null,
      hideGuide: selectedTrain ? s.hideGuide : false,
    })),
  followTrainId: null,
  hideGuide: false,
  setFollowTrainId: (followTrainId) => set({ followTrainId, hideGuide: Boolean(followTrainId) }),
  watchTrain: (train) => set({ selectedTrain: train, followTrainId: train.id, sheetOpen: true }),
  query: "",
  setQuery: (query) => set({ query }),
  pitchMode: "3d",
  setPitchMode: (pitchMode) => set({ pitchMode }),
  flyTo: null,
  requestFlyTo: (target) => set({ flyTo: { ...target, nonce: ++flyNonce } }),
  trainCount: 0,
  setTrainCount: (trainCount) => set({ trainCount }),
  clock: "--:--:--",
  setClock: (clock) => set({ clock }),
  originStation: null,
  destStation: null,
  journey: null,
  journeys: [],
  journeyIndex: 0,
  setOrigin: (originStation) => set({ originStation }),
  setDest: (destStation) => set({ destStation }),
  setJourney: (journey) => set({ journey, journeys: journey ? [journey] : [], journeyIndex: 0 }),
  setJourneys: (journeys, index = 0) =>
    set({
      journeys,
      journeyIndex: Math.max(0, Math.min(index, Math.max(0, journeys.length - 1))),
      journey: journeys[index] ?? journeys[0] ?? null,
    }),
  clearTrip: () => set({ destStation: null, journey: null, journeys: [], journeyIndex: 0 }),
  dismissPick: () =>
    set({
      selectedTrain: null,
      followTrainId: null,
      selectedStation: null,
      selectedStay: null,
      selectedKonbini: null,
      konbiniChat: false,
      konbiniWalk: false,
      selectedQuake: null,
      sheetOpen: false,
      selectedPeak: null,
      peakScreen: null,
    }),
  pickField: null,
  setPickField: (pickField) => set({ pickField }),
  timeMode: "depart",
  setTimeMode: (timeMode) => set({ timeMode }),
  searching: false,
  setSearching: (searching) => set({ searching }),
  sheetOpen: false,
  setSheetOpen: (sheetOpen) => set({ sheetOpen }),
  odptKey: typeof window !== "undefined" ? window.localStorage.getItem("odpt-key") ?? "" : "",
  setOdptKey: (odptKey) => {
    if (typeof window !== "undefined") window.localStorage.setItem("odpt-key", odptKey);
    set({ odptKey });
  },
  liveTrains: [],
  liveSource: "sim",
  liveError: null,
  setLive: (liveTrains, liveSource, liveError) => set({ liveTrains, liveSource, liveError }),
  googleKey: typeof window !== "undefined" ? window.localStorage.getItem("google-key") ?? "" : "",
  setGoogleKey: (googleKey) => {
    if (typeof window !== "undefined") window.localStorage.setItem("google-key", googleKey);
    set({ googleKey });
  },
  googleDepartures: [],
  googleTrains: [],
  setGoogleBoard: (googleDepartures, googleTrains) => set({ googleDepartures, googleTrains }),
  jrDepartures: [],
  jrTrains: [],
  setJrBoard: (jrDepartures, jrTrains) => set({ jrDepartures, jrTrains }),
  selectedStay: null,
  selectStay: (selectedStay) =>
    set((s) => ({
      selectedStay,
      sheetOpen: selectedStay ? false : s.sheetOpen,
      selectedTrain: selectedStay ? null : s.selectedTrain,
      followTrainId: selectedStay ? null : s.followTrainId,
      selectedQuake: selectedStay ? null : s.selectedQuake,
      selectedKonbini: selectedStay ? null : s.selectedKonbini,
      stayScreen: selectedStay ? s.stayScreen : null,
      stayWalk: selectedStay ? s.stayWalk : false,
      stayChat: selectedStay ? s.stayChat : false,
    })),
  stayLayer: false,
  setStayLayer: (stayLayer) =>
    set((s) => ({
      stayLayer,
      selectedStay: stayLayer ? s.selectedStay : null,
      stayScreen: stayLayer ? s.stayScreen : null,
      stayWalk: stayLayer ? s.stayWalk : false,
      stayChat: stayLayer ? s.stayChat : false,
      ...(stayLayer
        ? {
            konbiniBrand: null,
            konbiniStores: [],
            konbiniLoading: false,
            selectedKonbini: null,
            konbiniScreen: null,
            konbiniChat: false,
            konbiniWalk: false,
          }
        : {}),
    })),
  stayMenuOpen: false,
  setStayMenuOpen: (stayMenuOpen) => set({ stayMenuOpen }),
  partyMenuOpen: false,
  setPartyMenuOpen: (partyMenuOpen) => set({ partyMenuOpen }),
  partyCollapsed: false,
  setPartyCollapsed: (partyCollapsed) => set({ partyCollapsed }),
  partyInRoom: false,
  setPartyInRoom: (partyInRoom) => set({ partyInRoom }),
  partyAlert: false,
  setPartyAlert: (partyAlert) => set({ partyAlert }),
  partyPins: [],
  setPartyPins: (partyPins) => set({ partyPins }),
  selectedMate: null,
  selectMate: (selectedMate) =>
    set((s) => ({
      selectedMate,
      mateWalk: selectedMate ? s.mateWalk : false,
      selectedStay: selectedMate ? null : s.selectedStay,
      selectedKonbini: selectedMate ? null : s.selectedKonbini,
      selectedTrain: selectedMate ? null : s.selectedTrain,
      followTrainId: selectedMate ? null : s.followTrainId,
    })),
  mateWalk: false,
  setMateWalk: (mateWalk) => set({ mateWalk }),
  stayScreen: null,
  setStayScreen: (stayScreen) => set({ stayScreen }),
  stayWalk: false,
  setStayWalk: (stayWalk) => set({ stayWalk }),
  stayChat: false,
  setStayChat: (stayChat) => set({ stayChat, shopChatCollapsed: false }),
  konbiniBrand: null,
  setKonbiniBrand: (konbiniBrand) =>
    set((s) => {
      const dropStay = Boolean(konbiniBrand && (s.stayWalk || s.selectedStay || s.stayLayer || s.journey?.walkToDestMin));
      return {
        konbiniBrand,
        konbiniStores: !konbiniBrand
          ? []
          : konbiniBrand === "all"
            ? s.konbiniStores
            : s.konbiniStores.filter((row) => row.brand === konbiniBrand),
        konbiniLoading: Boolean(konbiniBrand),
        konbiniWalk: konbiniBrand ? s.konbiniWalk : false,
        selectedKonbini: konbiniBrand === "all" ? s.selectedKonbini : konbiniBrand && s.selectedKonbini?.brand === konbiniBrand ? s.selectedKonbini : null,
        konbiniScreen: konbiniBrand ? s.konbiniScreen : null,
        konbiniChat: konbiniBrand ? s.konbiniChat : false,
        ...(konbiniBrand
          ? {
              stayLayer: false,
              selectedStay: null,
              stayScreen: null,
              stayWalk: false,
              stayChat: false,
            }
          : {}),
        ...(dropStay
          ? {
              destStation: null,
              journey: null,
              journeys: [],
              journeyIndex: 0,
              selectedTrain: null,
              followTrainId: null,
            }
          : {}),
      };
    }),
  konbiniStores: [],
  setKonbiniStores: (konbiniStores) => set({ konbiniStores }),
  konbiniLoading: false,
  setKonbiniLoading: (konbiniLoading) => set({ konbiniLoading }),
  selectedKonbini: null,
  selectKonbini: (selectedKonbini) =>
    set((s) => ({
      selectedKonbini,
      selectedStay: selectedKonbini ? null : s.selectedStay,
      sheetOpen: selectedKonbini ? false : s.sheetOpen,
      selectedTrain: selectedKonbini ? null : s.selectedTrain,
      followTrainId: selectedKonbini ? null : s.followTrainId,
      konbiniScreen: selectedKonbini ? s.konbiniScreen : null,
      konbiniChat: selectedKonbini ? s.konbiniChat : false,
      konbiniWalk: selectedKonbini ? s.konbiniWalk : false,
    })),
  konbiniScreen: null,
  setKonbiniScreen: (konbiniScreen) => set({ konbiniScreen }),
  konbiniChat: false,
  setKonbiniChat: (konbiniChat) => set({ konbiniChat, shopChatCollapsed: false }),
  shopChatCollapsed: false,
  setShopChatCollapsed: (shopChatCollapsed) => set({ shopChatCollapsed }),
  konbiniWalk: false,
  setKonbiniWalk: (konbiniWalk) => set({ konbiniWalk }),
  quakes: [],
  selectedQuake: null,
  setQuakes: (quakes) => set({ quakes }),
  selectQuake: (selectedQuake) => set({ selectedQuake }),
  quakeMenuOpen: false,
  setQuakeMenuOpen: (quakeMenuOpen) => set({ quakeMenuOpen }),
  weatherSpots: [],
  setWeatherSpots: (weatherSpots) => set({ weatherSpots }),
  radarEnabled: false,
  setRadarEnabled: (radarEnabled) => set({ radarEnabled, radarHidden: radarEnabled ? [] : [] }),
  radarHidden: [],
  toggleRadarBand: (band) =>
    set((s) => ({
      radarHidden: s.radarHidden.includes(band) ? s.radarHidden.filter((id) => id !== band) : [...s.radarHidden, band],
    })),
  ringMode: "auto",
  setRingMode: (ringMode) => set({ ringMode }),
  mountainLayer: false,
  setMountainLayer: (mountainLayer) =>
    set((s) => ({
      mountainLayer,
      selectedPeak: mountainLayer ? s.selectedPeak : null,
      peakScreen: mountainLayer ? s.peakScreen : null,
    })),
  selectedPeak: null,
  selectPeak: (selectedPeak) =>
    set((s) => ({
      selectedPeak,
      peakScreen: selectedPeak ? s.peakScreen : null,
    })),
  peakScreen: null,
  setPeakScreen: (peakScreen) => set({ peakScreen }),
  menuView: {},
  stashMenuView: (kind, cam) =>
    set((s) => ({ menuView: s.menuView[kind] ? s.menuView : { ...s.menuView, [kind]: cam } })),
  takeMenuView: (kind) => {
    const cam = get().menuView[kind] ?? null;
    set((s) => {
      if (!s.menuView[kind]) return s;
      const next = { ...s.menuView };
      delete next[kind];
      return { menuView: next };
    });
    return cam;
  },
  exclusiveOpen: (kind) =>
    set(() => {
      if (kind === "quake") {
        return {
          quakeMenuOpen: true,
          stayMenuOpen: false,
          stayLayer: false,
          selectedStay: null,
          stayScreen: null,
          stayWalk: false,
          stayChat: false,
          konbiniBrand: null,
          konbiniStores: [],
          konbiniLoading: false,
          selectedKonbini: null,
          konbiniScreen: null,
          konbiniChat: false,
          konbiniWalk: false,
          mountainLayer: false,
          selectedPeak: null,
          peakScreen: null,
        };
      }
      if (kind === "radar") {
        return {
          radarEnabled: true,
          radarHidden: [],
          stayMenuOpen: false,
          stayLayer: false,
          selectedStay: null,
          stayScreen: null,
          stayWalk: false,
          stayChat: false,
          konbiniBrand: null,
          konbiniStores: [],
          konbiniLoading: false,
          selectedKonbini: null,
          konbiniScreen: null,
          konbiniChat: false,
          konbiniWalk: false,
          mountainLayer: false,
          selectedPeak: null,
          peakScreen: null,
        };
      }
      if (kind === "stay") {
        return {
          stayMenuOpen: true,
          quakeMenuOpen: false,
          radarEnabled: false,
          radarHidden: [],
          mountainLayer: false,
          selectedPeak: null,
          peakScreen: null,
          selectedQuake: null,
        };
      }
      return {
        mountainLayer: true,
        stayMenuOpen: false,
        stayLayer: false,
        selectedStay: null,
        stayScreen: null,
        stayWalk: false,
        stayChat: false,
        konbiniBrand: null,
        konbiniStores: [],
        konbiniLoading: false,
        selectedKonbini: null,
        konbiniScreen: null,
        konbiniChat: false,
        konbiniWalk: false,
        quakeMenuOpen: false,
        radarEnabled: false,
        radarHidden: [],
        selectedQuake: null,
      };
    }),
  nearestStations: [],
  viewTime: null,
  clockOffsetMs: 0,
  setViewTime: (viewTime) => {
    if (!viewTime) {
      set({ viewTime: null, clockOffsetMs: 0 });
      return;
    }
    set({ viewTime, clockOffsetMs: dateAtTokyoClock(viewTime).getTime() - Date.now() });
  },
}));

export function simNow(): Date {
  return new Date(Date.now() + useMapStore.getState().clockOffsetMs);
}
