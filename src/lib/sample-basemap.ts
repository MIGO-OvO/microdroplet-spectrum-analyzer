import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { readSatelliteTile } from "./bridge";

maplibregl.addProtocol("sampletiles", async (request, abort) => {
  const tile = new URL(request.url).searchParams;
  const data = await readSatelliteTile(Number(tile.get("z")), Number(tile.get("x")), Number(tile.get("y")));
  abort.signal.throwIfAborted();
  return { data };
});

export function createSampleBasemap(container: HTMLDivElement) {
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        satellite: {
          type: "raster",
          tiles: ["sampletiles://google?z={z}&x={x}&y={y}"],
          tileSize: 256,
          maxzoom: 20,
          attribution: "© Google",
        },
      },
      layers: [{ id: "imagery", type: "raster", source: "satellite" }],
    },
    center: [0, 0], zoom: 2, maxZoom: 20, maxPitch: 0,
    renderWorldCopies: false, dragRotate: false, touchPitch: false,
    attributionControl: { compact: true },
    locale: { "NavigationControl.ZoomIn": "放大", "NavigationControl.ZoomOut": "缩小" },
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  return map;
}
