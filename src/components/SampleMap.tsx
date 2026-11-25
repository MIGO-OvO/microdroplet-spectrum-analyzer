import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { LayerMode, MapLayers, Position } from "../lib/sample-surface";

interface Props {
  desktop: boolean;
  layers: MapLayers;
  mode: LayerMode;
  focused: number | null;
  onFocus: (id: number) => void;
}

type Pixel = { x: number; y: number };
type Project = (position: Position) => Pixel;

const projectOn = (map: MapLibreMap): Project => ({ lng, lat }) => map.project([lng, lat]);

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

function fitPoints(map: MapLibreMap, points: MapLayers["points"]) {
  if (!points.length) return;
  const latitudes = points.map(point => point.position.lat), longitudes = points.map(point => point.position.lng);
  const [west, south, east, north] = [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
  if (west === east && south === north) {
    map.jumpTo({ center: [west, south], zoom: 17 });
    return;
  }
  map.fitBounds([west, south, east, north], { padding: 44, maxZoom: 17, duration: 0 });
}

export function SampleMap(props: Props) {
  const { desktop, layers, mode } = props;
  const frame = useRef(props);
  const mapHost = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState(desktop ? "正在加载卫星底图…" : "坐标预览");

  const redraw = useCallback(() => {
    const canvas = overlay.current;
    if (!canvas) return;
    const { clientWidth: width, clientHeight: height } = canvas;
    const project = map.current ? projectOn(map.current) : previewProjection(width, height, frame.current.layers.points);
    draw(canvas, width, height, project, frame.current);
  }, []);

  useEffect(() => {
    frame.current = props;
    redraw();
  }, [props, redraw]);

  useEffect(() => {
    const host = mapHost.current;
    if (!host) return;
    const size = new ResizeObserver(() => { map.current?.resize(); redraw(); });
    size.observe(host);
    if (!desktop) return () => size.disconnect();
    let cancelled = false;
    void import("../lib/sample-basemap").then(({ createSampleBasemap }) => {
      if (cancelled) return;
      const viewport = createSampleBasemap(host);
      map.current = viewport;
      let hasImagery = false;
      viewport.on("sourcedata", event => {
        if (event.sourceId === "satellite" && event.tile?.state === "loaded" && !hasImagery) {
          hasImagery = true;
          setStatus("");
        }
      });
      viewport.on("error", () => {
        if (!hasImagery) setStatus("卫星底图暂不可用");
      });
      viewport.on("render", redraw);
      viewport.on("click", event => {
        pickPoint(event.point, projectOn(viewport), frame.current);
      });
      fitPoints(viewport, frame.current.layers.points);
      setReady(true);
      redraw();
    }).catch(() => { if (!cancelled) setStatus("卫星底图初始化失败，显示坐标预览。"); });
    return () => {
      cancelled = true;
      size.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, [desktop, redraw]);

  useEffect(() => { if (map.current) fitPoints(map.current, layers.points); }, [layers.points]);

  return <div className="sampling-map-display" data-layer={mode}>
    <div ref={mapHost} className="sample-satellite" role="region" aria-label="Google 卫星地图" aria-hidden={!ready} />
    <canvas ref={overlay} className="sample-map-overlay" data-on-map={ready} aria-label="采样点图层" onClick={event => {
      const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
      pickPoint({ x: event.clientX - left, y: event.clientY - top }, previewProjection(width, height, layers.points), props);
    }} />
    {status && <span className="sample-map-status" role="status">{status}</span>}
    {!layers.points.length && <div className="sample-map-empty">从采样库添加带坐标的记录</div>}
    {layers.points.length > 0 && mode !== "points" && layers.message && <div className="sample-map-empty">{layers.message}</div>}
    {mode !== "points" && !layers.message && mode === "contours" && !layers.contours.length &&
      <div className="sample-map-empty">所选样本的浓度相同</div>}
  </div>;
}
