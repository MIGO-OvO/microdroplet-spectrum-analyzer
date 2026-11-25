import { useEffect, useRef, useState } from "react";
import type { LayerMode, MapLayers, Position } from "../lib/sample-surface";

interface Props {
  apiKey: string;
  layers: MapLayers;
  mode: LayerMode;
  focused: number | null;
  onFocus: (id: number) => void;
}

type Pixel = { x: number; y: number };
type Project = (position: Position) => Pixel;
let loaded: { key: string; promise: Promise<google.maps.MapsLibrary> } | null = null;
let authDenied = false;
const authListeners = new Set<() => void>();

function loadMaps(key: string) {
  const mapWindow = window as typeof window & { initializeSampleSatellite?: () => void; gm_authFailure?: () => void };
  if (loaded && loaded.key !== key) return Promise.reject(new Error("请重启应用以使用新密钥。"));
  if (authDenied) return Promise.reject(new Error("Google Maps 授权失败。请检查密钥、计费和网站来源限制。"));
  if (loaded) return loaded.promise;
  const promise = new Promise<google.maps.MapsLibrary>((resolve, reject) => {
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.search = new URLSearchParams({ key, v: "weekly", loading: "async", callback: "initializeSampleSatellite" }).toString();
    script.src = url.toString();
    script.async = true;
    const failed = () => {
      window.clearTimeout(timeout);
      script.remove();
      loaded = null;
      delete mapWindow.initializeSampleSatellite;
      reject(new Error("卫星底图加载失败，请检查网络后重试。"));
    };
    const timeout = window.setTimeout(failed, 20_000);
    script.addEventListener("error", failed, { once: true });
    mapWindow.gm_authFailure = () => {
      authDenied = true;
      authListeners.forEach(listener => listener());
    };
    mapWindow.initializeSampleSatellite = () => {
      window.clearTimeout(timeout);
      delete mapWindow.initializeSampleSatellite;
      void (google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>).then(resolve, reject);
    };
    document.head.append(script);
  });
  loaded = { key, promise };
  return promise;
}

function draw(canvas: HTMLCanvasElement, width: number, height: number, project: Project, { layers, mode, focused }: Props) {
  const scale = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width * scale), pixelHeight = Math.round(height * scale);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || !width || !height) return;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (mode === "heat") {
    ctx.globalAlpha = 0.68;
    for (const cell of layers.cells) {
      const start = project(cell.northwest), end = project(cell.southeast);
      ctx.fillStyle = cell.color;
      ctx.fillRect(start.x, start.y, end.x - start.x + 0.35, end.y - start.y + 0.35);
    }
    ctx.globalAlpha = 1;
  }
  if (mode === "contours") {
    ctx.lineCap = "round";
    for (const contour of layers.contours) {
      ctx.beginPath();
      for (const [from, to] of contour.segments) {
        const a = project(from), b = project(to);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#192b36";
      ctx.stroke();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = contour.color;
      ctx.stroke();
    }
  }
  const points = [...layers.points.filter(point => point.id !== focused), ...layers.points.filter(point => point.id === focused)];
  for (const point of points) {
    const { x, y } = project(point.position);
    const active = point.id === focused;
    ctx.beginPath();
    ctx.arc(x, y, active ? 8 : 6, 0, 2 * Math.PI);
    ctx.lineWidth = active ? 3 : 2;
    ctx.strokeStyle = active ? "#f0b44d" : "#f5fafc";
    ctx.fillStyle = point.simulated ? "#a7772c" : point.color;
    ctx.fill();
    ctx.stroke();
  }
}

function previewProjection(width: number, height: number, points: MapLayers["points"]): Project {
  if (!points.length) return () => ({ x: width / 2, y: height / 2 });
  const latitudes = points.map(point => point.position.lat), longitudes = points.map(point => point.position.lng);
  const lat = (Math.max(...latitudes) + Math.min(...latitudes)) / 2;
  const lng = (Math.max(...longitudes) + Math.min(...longitudes)) / 2;
  const ratio = Math.max(0.001, Math.cos(lat * Math.PI / 180));
  const widthDegrees = Math.max(0.00005, (Math.max(...longitudes) - Math.min(...longitudes)) * ratio);
  const heightDegrees = Math.max(0.00005, Math.max(...latitudes) - Math.min(...latitudes));
  const factor = Math.max(1, Math.min((width - 80) / widthDegrees, (height - 80) / heightDegrees));
  return position => ({ x: width / 2 + (position.lng - lng) * ratio * factor, y: height / 2 - (position.lat - lat) * factor });
}

function pickPoint(pixel: Pixel, project: Project, props: Props) {
  let closest: number | null = null;
  let distance = 15;
  for (const point of props.layers.points) {
    const { x, y } = project(point.position);
    const d = Math.hypot(x - pixel.x, y - pixel.y);
    if (d < distance) { closest = point.id; distance = d; }
  }
  if (closest !== null) props.onFocus(closest);
}

function fitPoints(map: google.maps.Map, points: MapLayers["points"]) {
  if (!points.length) return;
  if (points.every(point => point.position.lat === points[0].position.lat && point.position.lng === points[0].position.lng)) {
    map.setCenter(points[0].position);
    map.setZoom(17);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  points.forEach(point => bounds.extend(point.position));
  map.fitBounds(bounds, 44);
}

export function SampleMap(props: Props) {
  const { apiKey, layers, mode } = props;
  const frame = useRef(props);
  const mapHost = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const overlay = useRef<google.maps.OverlayView | null>(null);
  const [satellite, setSatellite] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    frame.current = props;
    overlay.current?.draw();
    const canvas = preview.current;
    if (!canvas || satellite) return;
    const redraw = () => {
      const { clientWidth: width, clientHeight: height } = canvas;
      draw(canvas, width, height, previewProjection(width, height, frame.current.layers.points), frame.current);
    };
    redraw();
    const size = new ResizeObserver(redraw);
    size.observe(canvas);
    return () => size.disconnect();
  }, [props, satellite]);

  useEffect(() => {
    setSatellite(false);
    setStatus("");
    const host = mapHost.current;
    if (!host || !apiKey) return;
    let cancelled = false;
    let tilesTimeout: number | undefined;
    let listener: google.maps.MapsEventListener | undefined;
    let tiles: google.maps.MapsEventListener | undefined;
    const denied = () => {
      setSatellite(false);
      window.clearTimeout(tilesTimeout);
      tiles?.remove();
      setStatus("Google Maps 授权失败。请检查密钥、计费和网站来源限制。");
    };
    authListeners.add(denied);
    setStatus("正在加载卫星底图…");
    void loadMaps(apiKey).then(({ Map, OverlayView, RenderingType }) => {
      if (cancelled || authDenied) return;
      const viewport = new Map(host, {
        mapTypeId: "satellite", renderingType: RenderingType.RASTER,
        center: { lat: 0, lng: 0 }, zoom: 2, maxZoom: 21, tilt: 0,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      });
      const canvas = document.createElement("canvas");
      canvas.className = "sample-satellite-layer";
      const layer = new class extends OverlayView {
        private size = new ResizeObserver(() => this.draw());
        onAdd() { this.getPanes()?.overlayLayer.append(canvas); this.size.observe(host); }
        draw() {
          const projection = this.getProjection();
          const corner = projection?.fromContainerPixelToLatLng(new google.maps.Point(0, 0));
          const origin = corner && projection.fromLatLngToDivPixel(corner);
          if (!origin) return;
          const { clientWidth: width, clientHeight: height } = host;
          Object.assign(canvas.style, { left: `${origin.x}px`, top: `${origin.y}px`, width: `${width}px`, height: `${height}px` });
          draw(canvas, width, height, position => projection.fromLatLngToContainerPixel(position)!, frame.current);
        }
        onRemove() { this.size.disconnect(); canvas.remove(); }
      }();
      map.current = viewport;
      overlay.current = layer;
      layer.setMap(viewport);
      listener = viewport.addListener("click", (event: google.maps.MapMouseEvent) => {
        const projection = layer.getProjection();
        const pixel = event.latLng && projection?.fromLatLngToContainerPixel(event.latLng);
        if (pixel) pickPoint(pixel, position => projection.fromLatLngToContainerPixel(position)!, frame.current);
      });
      tiles = viewport.addListener("tilesloaded", () => {
        if (authDenied) return;
        window.clearTimeout(tilesTimeout);
        setSatellite(true);
        setStatus("");
      });
      tilesTimeout = window.setTimeout(() => setStatus("卫星影像加载超时，当前显示坐标预览。"), 20_000);
      fitPoints(viewport, frame.current.layers.points);
    }).catch((error: unknown) => { if (!cancelled) setStatus(error instanceof Error ? error.message : "卫星底图加载失败。"); });
    return () => {
      cancelled = true;
      window.clearTimeout(tilesTimeout);
      authListeners.delete(denied);
      listener?.remove();
      tiles?.remove();
      overlay.current?.setMap(null);
      overlay.current = null;
      map.current = null;
      host.replaceChildren();
    };
  }, [apiKey]);

  useEffect(() => { if (map.current) fitPoints(map.current, layers.points); }, [layers.points]);

  return <div className="sampling-map-display" data-layer={mode}>
    <div ref={mapHost} className="sample-satellite" aria-label="Google 卫星地图" aria-hidden={!satellite} />
    {!satellite && <canvas ref={preview} className="sample-preview" aria-label="采样点坐标预览" onClick={event => {
      const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
      pickPoint({ x: event.clientX - left, y: event.clientY - top }, previewProjection(width, height, layers.points), props);
    }} />}
    <span className="sample-map-status" role="status">{satellite ? "Google 卫星地图" : status || "坐标预览"}</span>
    {!layers.points.length && <div className="sample-map-empty">从采样库添加带坐标的记录</div>}
    {layers.points.length > 0 && mode !== "points" && layers.message && <div className="sample-map-empty">{layers.message}</div>}
    {mode !== "points" && !layers.message && mode === "contours" && !layers.contours.length &&
      <div className="sample-map-empty">所选样本的浓度相同</div>}
  </div>;
}
