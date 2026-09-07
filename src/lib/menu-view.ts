import { useMapStore, type MenuCam, type MenuKind } from "@/store/map-store";

function readCam(): MenuCam | null {
  try {
    const raw = sessionStorage.getItem("jb-cam");
    if (!raw) return null;
    const v = JSON.parse(raw) as { lng?: number; lat?: number; zoom?: number; yaw?: number; tilt?: number };
    if (!Number.isFinite(v.lng) || !Number.isFinite(v.lat) || !Number.isFinite(v.zoom)) return null;
    return {
      lng: v.lng as number,
      lat: v.lat as number,
      zoom: v.zoom as number,
      bearing: Number.isFinite(v.yaw) ? (v.yaw as number) : 0,
      pitch: Number.isFinite(v.tilt) ? (v.tilt as number) : 0.55,
    };
  } catch {
    return null;
  }
}

function isOpen(kind: MenuKind) {
  const s = useMapStore.getState();
  if (kind === "stay") return s.stayMenuOpen;
  if (kind === "quake") return s.quakeMenuOpen;
  if (kind === "radar") return s.radarEnabled;
  return s.mountainLayer;
}

export function openLayer(kind: MenuKind) {
  const s = useMapStore.getState();
  if (!isOpen(kind)) {
    const cam = readCam();
    if (cam) s.stashMenuView(kind, cam);
  }
  s.exclusiveOpen(kind);
}

export function closeLayer(kind: MenuKind) {
  const s = useMapStore.getState();
  if (kind === "stay") {
    s.setStayMenuOpen(false);
    s.setStayLayer(false);
    s.selectStay(null);
    s.setStayWalk(false);
    s.setStayChat(false);
    s.setStayScreen(null);
    s.setKonbiniBrand(null);
    s.selectKonbini(null);
    s.setKonbiniStores([]);
    s.setKonbiniWalk(false);
    s.setKonbiniChat(false);
  } else if (kind === "quake") {
    s.setQuakeMenuOpen(false);
  } else if (kind === "radar") {
    s.setRadarEnabled(false);
  } else {
    s.setMountainLayer(false);
    s.selectPeak(null);
  }
  const cam = s.takeMenuView(kind);
  if (cam) {
    s.requestFlyTo({
      lng: cam.lng,
      lat: cam.lat,
      zoom: cam.zoom,
      bearing: cam.bearing,
      pitch: cam.pitch,
      center: true,
    });
  }
}
