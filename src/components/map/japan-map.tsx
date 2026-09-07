import { useLayoutEffect, useRef, useState, type ComponentType } from "react";

const LAND = "#000000";
const loadMap = typeof window !== "undefined" ? import("./canvas-map") : null;

function paintHold(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const g = canvas.getContext("2d");
  if (!g) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = LAND;
  g.fillRect(0, 0, w, h);
}

export function JapanMap() {
  const [Map, setMap] = useState<ComponentType | null>(null);
  const hold = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    paintHold(hold.current);
    let live = true;
    const grab = () => {
      void (loadMap ?? import("./canvas-map"))
        .then((m) => {
          if (live) setMap(() => m.CanvasMap);
        })
        .catch(() => {
          if (live) window.setTimeout(grab, 400);
        });
    };
    grab();
    return () => {
      live = false;
    };
  }, []);
  if (!Map) return <canvas ref={hold} className="block h-full w-full touch-none" aria-label="map" style={{ background: LAND }} />;
  return <Map />;
}