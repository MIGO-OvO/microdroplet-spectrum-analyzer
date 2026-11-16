import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

import { buildAxisTicks, formatMeasurement, formatQualityFlag, formatReferenceMode } from "../lib/format";
import { AMPLITUDE_BOUNDARIES, clampRange, moveAmplitudeBoundary, nearestIndex, xBounds } from "../lib/chart";
import { isTauriRuntime, loadPlotView } from "../lib/bridge";
import { indexDroplets, segmentId, segmentUse, lowId } from "../lib/droplet";
import type { AmplitudeBands, DropletMeasurement, PlotSeries, AnalysisResponse } from "../types";

interface SignalChartProps {
  result: AnalysisResponse | null;
  thresholdLow: number;
  thresholdHigh: number;
  amplitudeBands?: AmplitudeBands | null;
  onAmplitudeBandsChange?: (bands: AmplitudeBands) => void;
  hasRealTime: boolean;
  showLabels: boolean;
  selectedSegment?: number | null;
  selectionRevision?: number;
  onSelectSegment?: (number: number) => void;
}

interface HoverPoint {
  left: number;
  top: number;
  x: number;
  original: number;
  processed: number;
}

interface DragState {
  pointerId: number;
  clientX: number;
  range: [number, number];
}

interface BandDragState {
  pointerId: number;
  key: keyof AmplitudeBands;
  clientY: number;
  unitsPerPixel: number;
  bands: AmplitudeBands;
}

const MARGIN = { top: 35, right: 24, bottom: 50, left: 78 };

/// Marker colours: Platform is the upper state, Bottom the lower one, and an
/// unclassified stable segment is deliberately a third, warning colour.
const PLATFORM_COLOR = "#24866a";
const BOTTOM_COLOR = "#1668c1";
const UNKNOWN_COLOR = "#c98a1b";
const DELTA_COLOR = "#a2407a";

export function SignalChart({
  result,
  thresholdLow,
  thresholdHigh,
  amplitudeBands: savedBands,
  onAmplitudeBandsChange,
  hasRealTime,
  showLabels,
  selectedSegment,
  selectionRevision,
  onSelectSegment,
}: SignalChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yBounds = useRef<{ range: [number, number]; min: number; max: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const bandDragRef = useRef<BandDragState | null>(null);
  const [bandDraft, setBandDraft] = useState<AmplitudeBands | null>(null);
  const [hoverBoundary, setHoverBoundary] = useState<keyof AmplitudeBands | null>(null);
  const amplitudeBands = bandDraft ?? savedBands;
  const canMoveBands = result?.mode === "droplet" && !!onAmplitudeBandsChange && !!amplitudeBands
    && amplitudeBands.lowMin < amplitudeBands.lowMax && amplitudeBands.lowMax < amplitudeBands.highMin
    && amplitudeBands.highMin < amplitudeBands.highMax;
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const [detail, setDetail] = useState<{ result: AnalysisResponse; range: [number, number]; plot: PlotSeries } | null>(null);
  const [detailError, setDetailError] = useState(false);
  const plot = detail?.result === result && detail?.range === range ? detail.plot : result?.plot;
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const evidence = useMemo(() => result ? indexDroplets(result) : null, [result]);

  useEffect(() => {
    const segment = evidence?.segments.get(selectedSegment ?? -1);
    if (!segment || !result || result.plot.x.length < 2) return;
    const measurement = evidence?.byHigh.get(segment.number);
    const related = [segment, evidence?.segments.get(measurement?.leftLowSegment ?? -1), evidence?.segments.get(measurement?.rightLowSegment ?? -1)].filter(s => s != null);
    const start = Math.min(...related.map(s => s.start));
    const end = Math.max(...related.map(s => s.end));
    const fullStart = result.plot.x[0];
    const fullSpan = result.plot.x[result.plot.x.length - 1] - fullStart;
    if (fullSpan <= 0) return;
    const padding = Math.max((end - start) * 0.15, fullSpan * 0.01);
    setRange(clampRange((start - padding - fullStart) / fullSpan, (end + padding - fullStart) / fullSpan));
    setHover(null);
  }, [selectedSegment, selectionRevision, evidence, result]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(320, Math.floor(entry.contentRect.width));
      const height = Math.max(280, Math.floor(entry.contentRect.height));
      setSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setHover(null);
  }, [result]);

  useEffect(() => {
    if (!result || !isTauriRuntime() || (range[0] === 0 && range[1] === 1)) return;
    let active = true;
    setDetailError(false);
    const timer = window.setTimeout(() => {
      const [xMin, xMax] = xBounds(result.plot.x, range);
      void loadPlotView(result.resultId, xMin, xMax).then((plot) => {
        if (active) setDetail({ result, range, plot });
      }).catch(() => { if (active) setDetailError(true); });
    }, 80);
    return () => { active = false; window.clearTimeout(timer); };
  }, [result, range]);

  const visible = useMemo(() => {
    if (!result || !plot || plot.x.length === 0) return null;
    const length = plot.x.length;
    const [xMin, xMax] = xBounds(result.plot.x, range);
    const start = Math.max(0, nearestIndex(plot.x, xMin) - 1);
    const end = Math.min(length - 1, nearestIndex(plot.x, xMax) + 1);
    // Frame explicit amplitude windows in both modes; automatic mode frames only data.
    let yMin = result.mode === "plateau" ? Math.min(thresholdLow, thresholdHigh) : Infinity;
    let yMax = result.mode === "plateau" ? Math.max(thresholdLow, thresholdHigh) : -Infinity;
    if (result.mode === "droplet" && amplitudeBands) {
      yMin = amplitudeBands.lowMin;
      yMax = amplitudeBands.highMax;
    }
    for (let i = start; i <= end; i++) {
      yMin = Math.min(yMin, plot.original[i], plot.processed[i]);
      yMax = Math.max(yMax, plot.original[i], plot.processed[i]);
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    const padding = yMin === yMax ? 0.5 : (yMax - yMin) * 0.1;
    if (!bandDraft && (range[1] - range[0] === 1 || yBounds.current?.range !== range
      || yMin < yBounds.current.min || yMax > yBounds.current.max)) {
      yBounds.current = { range, min: yMin - padding, max: yMax + padding };
    }
    const bounds = yBounds.current ?? { min: yMin - padding, max: yMax + padding };
    return { start, end: Math.min(length - 1, end), xMin, xMax, yMin: bounds.min, yMax: bounds.max };
  }, [range, result, plot, thresholdHigh, thresholdLow, amplitudeBands, bandDraft]);

  const hoveredSegment = useMemo(() => {
    if (!hover || !result || result.mode !== "droplet" || !visible) return null;
    const plotHeight = size.height - MARGIN.top - MARGIN.bottom;
    const plotWidth = size.width - MARGIN.left - MARGIN.right;
    const tolerance = (visible.xMax - visible.xMin) * 8 / Math.max(1, plotWidth);
    let best = null;
    let distance = 16;
    for (const segment of result.stableSegments) {
      if (hover.x < segment.start - tolerance || hover.x > segment.end + tolerance) continue;
      const y = MARGIN.top + (1 - (segment.level - visible.yMin) / (visible.yMax - visible.yMin)) * plotHeight;
      const delta = Math.abs(hover.top - y);
      if (delta < distance) { best = segment; distance = delta; }
    }
    return best;
  }, [hover, result, visible, size]);

  // Pin the selected high's true low-reference construction; hover is a preview.
  const activeMeasurement = useMemo<DropletMeasurement | null>(() => {
    return evidence?.byHigh.get(hoveredSegment?.number ?? selectedSegment ?? -1) ?? null;
  }, [hoveredSegment, selectedSegment, evidence]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    const chartType = window.getComputedStyle(canvas);
    const chartFont = `${chartType.fontSize} ${chartType.fontFamily}`;
    const markerFont = `600 ${chartFont}`;
    const labelSize = parseFloat(chartType.fontSize);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);

    const plotWidth = size.width - MARGIN.left - MARGIN.right;
    const plotHeight = size.height - MARGIN.top - MARGIN.bottom;
    if (!result || !plot || !visible || plotWidth <= 0 || plotHeight <= 0) {
      context.strokeStyle = "#d6dee3";
      context.setLineDash([5, 5]);
      context.strokeRect(MARGIN.left, MARGIN.top, Math.max(0, plotWidth), Math.max(0, plotHeight));
      context.setLineDash([]);
      context.fillStyle = "#63727c";
      context.font = chartFont;
      context.textAlign = "center";
      context.fillText("暂无信号", size.width / 2, size.height / 2);
      return;
    }

    const xSpan = visible.xMax - visible.xMin || 1;
    const ySpan = visible.yMax - visible.yMin || 1;
    const scaleX = (value: number) => MARGIN.left + ((value - visible.xMin) / xSpan) * plotWidth;
    const scaleY = (value: number) => MARGIN.top + (1 - (value - visible.yMin) / ySpan) * plotHeight;
    const xTicks = buildAxisTicks(
      visible.xMin,
      visible.xMax,
      Math.max(2, Math.min(6, Math.floor(plotWidth / 120))),
      !hasRealTime,
    );

    context.save();
    context.beginPath();
    context.rect(MARGIN.left, MARGIN.top, plotWidth, plotHeight);
    context.clip();
    if (result.mode === "plateau") {
      const top = scaleY(Math.max(thresholdLow, thresholdHigh));
      const bottom = scaleY(Math.min(thresholdLow, thresholdHigh));
      context.fillStyle = "rgba(214, 144, 39, 0.075)";
      context.fillRect(MARGIN.left, top, plotWidth, bottom - top);
    }
    if (result.mode === "droplet" && amplitudeBands) {
      for (const [lower, upper, color] of [
        [amplitudeBands.lowMin, amplitudeBands.lowMax, "rgba(22, 104, 193, 0.07)"],
        [amplitudeBands.highMin, amplitudeBands.highMax, "rgba(36, 134, 106, 0.07)"],
      ] as const) {
        context.fillStyle = color;
        context.fillRect(MARGIN.left, scaleY(upper), plotWidth, scaleY(lower) - scaleY(upper));
      }
    }

    context.restore();
    context.font = `${chartType.fontSize} Consolas, "Microsoft YaHei UI", monospace`;
    context.lineWidth = 1;
    context.strokeStyle = "#aebbc3";
    context.strokeRect(MARGIN.left, MARGIN.top, plotWidth, plotHeight);
    for (const tick of xTicks.values) {
      const x = scaleX(tick);
      context.strokeStyle = "#e4eaee";
      context.beginPath();
      context.moveTo(x, MARGIN.top);
      context.lineTo(x, MARGIN.top + plotHeight);
      context.stroke();
      context.fillStyle = "#5b6b75";
      context.textAlign = "center";
      context.fillText(
        tick.toLocaleString("zh-CN", { maximumFractionDigits: Math.min(12, xTicks.fractionDigits) }),
        x,
        MARGIN.top + plotHeight + 21,
      );
    }
    for (let tick = 0; tick <= 5; tick += 1) {
      const fraction = tick / 5;
      const y = MARGIN.top + (1 - fraction) * plotHeight;
      context.strokeStyle = tick === 0 ? "#aebbc3" : "#e4eaee";
      context.beginPath();
      context.moveTo(MARGIN.left, y);
      context.lineTo(MARGIN.left + plotWidth, y);
      context.stroke();
      context.fillStyle = "#5b6b75";
      context.textAlign = "right";
      context.fillText(
        formatMeasurement(visible.yMin + fraction * ySpan, 3),
        MARGIN.left - 9,
        y + 4,
      );
    }

    context.save();
    context.beginPath();
    context.rect(MARGIN.left, MARGIN.top, plotWidth, plotHeight);
    context.clip();
    if (result.mode === "plateau" || amplitudeBands) {
      context.save();
      context.setLineDash([6, 4]);
      context.lineWidth = 1;
      for (const [value, color] of (result.mode === "droplet" && amplitudeBands ? [
        [amplitudeBands.highMin, PLATFORM_COLOR], [amplitudeBands.highMax, PLATFORM_COLOR],
        [amplitudeBands.lowMin, BOTTOM_COLOR], [amplitudeBands.lowMax, BOTTOM_COLOR],
      ] as const : [
        [thresholdLow, "#d69027"],
        [thresholdHigh, "#d69027"],
      ] as const)) {
        const y = scaleY(value);
        context.strokeStyle = color;
        context.beginPath();
        context.moveTo(MARGIN.left, y);
        context.lineTo(MARGIN.left + plotWidth, y);
        context.stroke();
      }
      context.restore();
    }

    const drawSeries = (values: number[], color: string, width: number) => {
      context.beginPath();
      context.strokeStyle = color;
      context.lineWidth = width;
      for (let index = visible.start; index <= visible.end; index += 1) {
        const x = scaleX(plot.x[index]);
        const y = scaleY(values[index]);
        if (index === visible.start) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    };
    drawSeries(plot.original, "#71848f", 1);
    drawSeries(plot.processed, "#147d9a", 1.8);

    if (result.mode === "droplet") {
      // Stable-segment evidence: the level measured on the raw signal for every
      // segment, coloured by the two-state classification. Unknown segments are a
      // third colour on purpose — they are the ones a reviewer must look at.
      let labelRight = -Infinity;
      for (const segment of result.stableSegments) {
        if (segment.end < visible.xMin || segment.start > visible.xMax) continue;
        const x = scaleX(segment.center);
        const y = scaleY(segment.level);
        const color =
          segment.kind === "platform"
            ? PLATFORM_COLOR
            : segment.kind === "bottom"
              ? BOTTOM_COLOR
              : UNKNOWN_COLOR;
        const related = segment.number === selectedSegment || segment.number === hoveredSegment?.number
          || segment.number === activeMeasurement?.highSegment || segment.number === activeMeasurement?.leftLowSegment
          || segment.number === activeMeasurement?.rightLowSegment;
        context.strokeStyle = color;
        context.lineWidth = related ? 4 : 2;
        context.beginPath();
        context.moveTo(scaleX(segment.start), y);
        context.lineTo(scaleX(segment.end), y);
        context.stroke();
        if (related) {
          context.fillStyle = segment.kind === "platform" ? "rgba(36, 134, 106, 0.10)" : "rgba(22, 104, 193, 0.10)";
          context.fillRect(scaleX(segment.start), MARGIN.top, scaleX(segment.end) - scaleX(segment.start), plotHeight);
        }
        if ((showLabels && x > labelRight + 12) || related) {
          const label = segmentId(segment.kind, segment.number);
          context.font = markerFont;
          const width = context.measureText(label).width;
          const labelY = Math.max(MARGIN.top + labelSize + 3, Math.min(MARGIN.top + plotHeight - 4, y + (segment.kind === "bottom" ? labelSize + 9 : -12)));
          context.fillStyle = "rgba(255,255,255,0.95)";
          context.fillRect(x - width / 2 - 4, labelY - labelSize - 2, width + 8, labelSize + 7);
          context.fillStyle = color;
          context.textAlign = "center";
          context.fillText(label, x, labelY);
          labelRight = x + width / 2;
        }
        context.fillStyle = color;
        context.strokeStyle = "rgba(255, 255, 255, 0.9)";
        context.lineWidth = 1.5;
        context.beginPath();
        if (segment.kind === "platform") {
          // Platform reference: a small square so it never competes with the droplet.
          context.rect(x - 3, y - 3, 6, 6);
        } else {
          context.arc(x, y, segment.kind === "bottom" ? 4 : 3.6, 0, Math.PI * 2);
        }
        context.fill();
        context.stroke();
      }

      // Δ connects the measured high to the low baseline at the high's center.
      for (const measurement of result.dropletMeasurements) {
        if (measurement.center < visible.xMin || measurement.center > visible.xMax) continue;
        const x = scaleX(measurement.center);
        const referenceY = scaleY(measurement.baselineReference);
        const highY = scaleY(measurement.highLevel);
        context.save();
        context.strokeStyle = DELTA_COLOR;
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(x, referenceY);
        context.lineTo(x, highY);
        context.stroke();
        context.beginPath();
        context.arc(x, referenceY, 3, 0, Math.PI * 2);
        context.fillStyle = DELTA_COLOR;
        context.fill();
        context.restore();
        if (showLabels && measurement === activeMeasurement) {
          const label = `Δ ${formatMeasurement(measurement.correctedSignal, 4)}`;
          context.font = markerFont;
          context.textAlign = "center";
          const textWidth = context.measureText(label).width;
          const anchorY = Math.max(MARGIN.top + 12, (referenceY + highY) / 2);
          context.fillStyle = "rgba(255, 255, 255, 0.94)";
          context.fillRect(x - textWidth / 2 - 4, anchorY - labelSize - 2, textWidth + 8, labelSize + 7);
          context.fillStyle = DELTA_COLOR;
          context.fillText(label, x, anchorY);
        }
      }

      // Connect actual low centers, never the chart edges. Single-sided is horizontal.
      if (activeMeasurement) {
        const measurement = activeMeasurement;
        const x = scaleX(measurement.center);
        context.save();
        context.strokeStyle = DELTA_COLOR;
        context.setLineDash([4, 4]);
        context.lineWidth = 1;
        const left = evidence?.segments.get(measurement.leftLowSegment ?? -1);
        const right = evidence?.segments.get(measurement.rightLowSegment ?? -1);
        if (left) {
          context.beginPath();
          context.moveTo(scaleX(left.center), scaleY(left.level));
          context.lineTo(x, scaleY(measurement.baselineReference));
          context.stroke();
        }
        if (right) {
          context.beginPath();
          context.moveTo(x, scaleY(measurement.baselineReference));
          context.lineTo(scaleX(right.center), scaleY(right.level));
          context.stroke();
        }
        context.restore();
      }
    } else {
      const features = result.plateauFeatures.filter((feature) => feature.center >= visible.xMin && feature.center <= visible.xMax);
      let labelRight = -Infinity;
      for (const feature of features.slice(0, 200)) {
        const xValue = feature.center;
        if (xValue < visible.xMin || xValue > visible.xMax) continue;
        const x = scaleX(xValue);
        const y = scaleY(feature.height);
        context.fillStyle = PLATFORM_COLOR;
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(x, y, 4.5, 0, Math.PI * 2);
        context.fill();
        context.stroke();
        if (showLabels && x >= labelRight + 50) {
          const label = `${feature.number} · ${formatMeasurement(feature.height, 4)}`;
          context.font = markerFont;
          const textWidth = context.measureText(label).width;
          labelRight = x + textWidth / 2;
          context.fillStyle = "rgba(255, 255, 255, 0.94)";
          context.fillRect(x - textWidth / 2 - 4, y - labelSize - 13, textWidth + 8, labelSize + 7);
          context.fillStyle = "#1e2a32";
          context.textAlign = "center";
          context.fillText(label, x, y - 11);
        }
      }
    }

    context.restore();
    context.fillStyle = "#42535e";
    context.font = chartFont;
    context.textAlign = "center";
    context.fillText(hasRealTime ? "时间" : "数据点", MARGIN.left + plotWidth / 2, size.height - 8);
    context.save();
    context.translate(15, MARGIN.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("信号强度", 0, 0);
    context.restore();
  }, [activeMeasurement, selectedSegment, hoveredSegment, evidence, hasRealTime, result, plot, showLabels, size, thresholdHigh, thresholdLow, visible, amplitudeBands]);

  const plotGeometry = () => {
    const rectangle = canvasRef.current?.getBoundingClientRect();
    if (!rectangle) return null;
    return {
      rectangle,
      width: rectangle.width - MARGIN.left - MARGIN.right,
    };
  };

  const updateHover = (event: ReactPointerEvent<HTMLElement>) => {
    if (!result || !plot || !visible) return;
    const geometry = plotGeometry();
    if (!geometry || geometry.width <= 0) return;
    const localX = event.clientX - geometry.rectangle.left;
    if (localX < MARGIN.left || localX > MARGIN.left + geometry.width) {
      setHover(null);
      return;
    }
    const fraction = (localX - MARGIN.left) / geometry.width;
    const xValue = visible.xMin + fraction * (visible.xMax - visible.xMin);
    const index = nearestIndex(plot.x, xValue, visible.start, visible.end);
    setHover({
      left: localX,
      top: event.clientY - geometry.rectangle.top,
      x: plot.x[index],
      original: plot.original[index],
      processed: plot.processed[index],
    });
  };

  const boundaryAt = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canMoveBands || !amplitudeBands || !visible) return null;
    const geometry = plotGeometry();
    if (!geometry) return null;
    const x = event.clientX - geometry.rectangle.left;
    const y = event.clientY - geometry.rectangle.top;
    const height = geometry.rectangle.height - MARGIN.top - MARGIN.bottom;
    if (x < MARGIN.left || x > MARGIN.left + geometry.width || y < MARGIN.top || y > MARGIN.top + height) return null;
    let nearest: keyof AmplitudeBands | null = null;
    let distance = 8;
    for (const [key] of AMPLITUDE_BOUNDARIES) {
      const lineY = MARGIN.top + (visible.yMax - amplitudeBands[key]) / (visible.yMax - visible.yMin) * height;
      if (Math.abs(y - lineY) < distance) { nearest = key; distance = Math.abs(y - lineY); }
    }
    return nearest;
  };

  const startBoundaryDrag = (event: ReactPointerEvent<HTMLElement>, key: keyof AmplitudeBands) => {
    if (event.button !== 0 || bandDragRef.current || dragRef.current || !canMoveBands || !amplitudeBands || !visible) return;
    const geometry = plotGeometry();
    const height = geometry ? geometry.rectangle.height - MARGIN.top - MARGIN.bottom : 0;
    if (height <= 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    bandDragRef.current = { pointerId: event.pointerId, key, clientY: event.clientY,
      unitsPerPixel: (visible.yMax - visible.yMin) / height, bands: amplitudeBands };
    setBandDraft(amplitudeBands);
    setHoverBoundary(key);
    setHover(null);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!result || event.button !== 0 || bandDragRef.current || dragRef.current) return;
    const boundary = boundaryAt(event);
    if (boundary) { startBoundaryDrag(event, boundary); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, range };
  };

  const movedBands = (drag: BandDragState, clientY: number) => clientY === drag.clientY ? drag.bands : moveAmplitudeBoundary(
    drag.bands, drag.key, drag.bands[drag.key] + (drag.clientY - clientY) * drag.unitsPerPixel,
  );

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const bandDrag = bandDragRef.current;
    if (bandDrag) {
      if (bandDrag.pointerId === event.pointerId) setBandDraft(movedBands(bandDrag, event.clientY));
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      const boundary = boundaryAt(event);
      setHoverBoundary(boundary);
      if (boundary) setHover(null);
      else updateHover(event);
      return;
    }
    if (drag.pointerId !== event.pointerId) return;
    const geometry = plotGeometry();
    if (!geometry || geometry.width <= 0) return;
    const span = drag.range[1] - drag.range[0];
    const shift = ((drag.clientX - event.clientX) / geometry.width) * span;
    setRange(clampRange(drag.range[0] + shift, drag.range[1] + shift));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const bandDrag = bandDragRef.current;
    const adjustedBoundary = bandDrag?.pointerId === event.pointerId;
    if (adjustedBoundary) {
      const next = movedBands(bandDrag, event.clientY);
      bandDragRef.current = null;
      setBandDraft(null);
      if (next[bandDrag.key] !== bandDrag.bands[bandDrag.key]) onAmplitudeBandsChange?.(next);
    } else {
      const drag = dragRef.current;
      if (drag?.pointerId === event.pointerId) {
        if (Math.abs(event.clientX - drag.clientX) < 4 && hoveredSegment) onSelectSegment?.(hoveredSegment.number);
        dragRef.current = null;
      }
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (adjustedBoundary) setHover(null);
    else updateHover(event);
  };

  const cancelDrag = () => {
    bandDragRef.current = null;
    dragRef.current = null;
    setBandDraft(null);
    setHoverBoundary(null);
  };

  const handleBoundaryKey = (event: KeyboardEvent<HTMLButtonElement>, key: keyof AmplitudeBands) => {
    if (event.key === "Escape") { cancelDrag(); return; }
    if (!amplitudeBands || !visible || bandDragRef.current || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = (visible.yMax - visible.yMin) * (event.shiftKey ? 0.01 : 0.001);
    onAmplitudeBandsChange?.(moveAmplitudeBoundary(amplitudeBands, key,
      amplitudeBands[key] + (event.key === "ArrowUp" ? step : -step)));
  };

  const zoom = (factor: number, anchor = 0.5) => {
    setRange(([start, end]) => {
      const span = end - start;
      const nextSpan = span * factor;
      const pivot = start + span * anchor;
      return clampRange(pivot - nextSpan * anchor, pivot + nextSpan * (1 - anchor));
    });
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!result || bandDragRef.current) return;
    event.preventDefault();
    const geometry = plotGeometry();
    if (!geometry) return;
    const anchor = Math.max(
      0,
      Math.min(1, (event.clientX - geometry.rectangle.left - MARGIN.left) / geometry.width),
    );
    zoom(event.deltaY < 0 ? 0.78 : 1.28, anchor);
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") { cancelDrag(); return; }
    if (bandDragRef.current) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoom(0.78);
    } else if (event.key === "-") {
      event.preventDefault();
      zoom(1.28);
    } else if (event.key === "0") {
      event.preventDefault();
      setRange([0, 1]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setRange(([start, end]) => {
        const shift = (end - start) * (event.key === "ArrowLeft" ? -0.1 : 0.1);
        return clampRange(start + shift, end + shift);
      });
    }
  };

  return (
    <section className="chart-panel" aria-labelledby="chart-title">
      <header className="chart-heading">
        <div>
          <h2 id="chart-title">信号预览</h2>
        </div>
        <div className="chart-legend" aria-label="图例">
          <span><i className="legend-line original" />原始信号</span>
          <span><i className="legend-line processed" />处理后信号</span>
          {result?.mode !== "plateau" ? (
            <>
              <span><i className="legend-square platform" />H 高平台</span>
              <span><i className="legend-dot bottom" />L 低平台</span>
              <span><i className="legend-dot unknown" />U 未分类</span>
              <span><i className="legend-delta" />校正信号 Δ</span>
            </>
          ) : (
            <span><i className="legend-dot" />检测结果</span>
          )}
          {result?.mode === "plateau" && (
            <span>
              <i className="legend-range" />
              检测范围 {formatMeasurement(Math.min(thresholdLow, thresholdHigh), 3)}–
              {formatMeasurement(Math.max(thresholdLow, thresholdHigh), 3)}
            </span>
          )}
        </div>
        <div className="chart-tools" aria-label="图表缩放工具">
          <span className="chart-range" aria-label="图表显示比例">{Number(((range[1] - range[0]) * 100).toPrecision(3))}%</span>
          <button type="button" className="icon-button" onClick={() => zoom(0.78)} disabled={!result} aria-label="放大图表" title="放大图表">
            <ZoomIn size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => zoom(1.28)} disabled={!result} aria-label="缩小图表" title="缩小图表">
            <ZoomOut size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => setRange([0, 1])} disabled={!result} aria-label="重置图表范围" title="重置图表范围（0）">
            <RotateCcw size={16} />
          </button>
        </div>
      </header>
      <div ref={containerRef} className="chart-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="signal-canvas"
          style={{ cursor: bandDraft || hoverBoundary ? "ns-resize" : undefined }}
          role="img"
          aria-label={
            result?.mode !== "plateau"
              ? "原始信号、处理后信号、稳定区段电平与校正信号 Δ 图；拖动边界线调整高低平台上下限；滚轮缩放，空白处拖动平移，按 0 重置"
              : "原始信号、处理后信号、检测结果和检测范围图；滚轮缩放，拖动平移，按 0 重置"
          }
          tabIndex={0}
          onWheel={handleWheel}
          onDoubleClick={() => setRange([0, 1])}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onPointerLeave={() => { if (!dragRef.current && !bandDragRef.current) { setHover(null); setHoverBoundary(null); } }}
          onKeyDown={handleKeyboard}
        />
        {canMoveBands && amplitudeBands && visible && AMPLITUDE_BOUNDARIES.map(([key, label], index) => (
          <button key={key} type="button" role="slider" className={`chart-band-handle ${key.startsWith("high") ? "high" : "low"}`}
            aria-label={label} aria-orientation="vertical" aria-valuenow={amplitudeBands[key]}
            aria-valuemin={index > 0 ? amplitudeBands[AMPLITUDE_BOUNDARIES[index - 1][0]] : Math.min(visible.yMin, amplitudeBands[key])}
            aria-valuemax={index < 3 ? amplitudeBands[AMPLITUDE_BOUNDARIES[index + 1][0]] : Math.max(visible.yMax, amplitudeBands[key])}
            aria-valuetext={String(amplitudeBands[key])}
            title={`${label}：${amplitudeBands[key]}；上下拖动或按方向键微调，Shift 加速，Esc 取消拖动`}
            style={{ top: Math.max(MARGIN.top, Math.min(size.height - MARGIN.bottom,
              MARGIN.top + (visible.yMax - amplitudeBands[key]) / (visible.yMax - visible.yMin) * (size.height - MARGIN.top - MARGIN.bottom))),
              left: key.endsWith("Min") ? MARGIN.left + 4 : undefined,
              right: key.endsWith("Max") ? MARGIN.right + 4 : undefined }}
            onPointerDown={event => startBoundaryDrag(event, key)} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
            onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onDoubleClick={event => event.stopPropagation()}
            onKeyDown={event => handleBoundaryKey(event, key)}>
            {label} <span>{formatMeasurement(amplitudeBands[key], 6)}</span>
          </button>
        ))}
        {hover && result && !bandDraft && !hoverBoundary && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.max(4, Math.min(size.width - 300, hover.left + 12)),
              top: Math.max(4, Math.min(size.height - 245, hover.top - 72)),
            }}
          >
            <strong>{hasRealTime ? "时间" : "数据点"} {formatMeasurement(hover.x, 4)}</strong>
            <span>原始 {formatMeasurement(hover.original, 6)}</span>
            <span>处理后 {formatMeasurement(hover.processed, 6)}</span>
            {hoveredSegment && evidence && <strong>{segmentId(hoveredSegment.kind, hoveredSegment.number)} · {segmentUse(hoveredSegment, evidence)}</strong>}
            {activeMeasurement && hoveredSegment?.number === activeMeasurement.highSegment && (
              <div className="tooltip-droplet">
                <em>高平台 H{activeMeasurement.highSegment} · 测量 #{activeMeasurement.number}</em>
                <span>中心 {formatMeasurement(activeMeasurement.center, 4)}</span>
                <span>高平台实测值 {formatMeasurement(activeMeasurement.highLevel, 6)}</span>
                <span>
                  左低平台 {lowId(activeMeasurement.leftLowSegment)} · {formatMeasurement(activeMeasurement.leftLowLevel, 6)}
                  {" · "}
                  右低平台 {lowId(activeMeasurement.rightLowSegment)} · {formatMeasurement(activeMeasurement.rightLowLevel, 6)}
                </span>
                <span>
                  低平台基线 {formatMeasurement(activeMeasurement.baselineReference, 6)}
                </span>
                <span className="tooltip-delta">
                  校正信号 Δ {formatMeasurement(activeMeasurement.correctedSignal, 6)}
                </span>
                <span>参考方式 {formatReferenceMode(activeMeasurement.referenceMode)}</span>
                <span>规则评分 {activeMeasurement.confidence.toFixed(3)}</span>
                <span>
                  质量标记{" "}
                  {activeMeasurement.qualityFlags.length === 0
                    ? "—"
                    : activeMeasurement.qualityFlags.map(formatQualityFlag).join("、")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      {detailError && <div className="chart-error" role="alert">局部细节读取失败，请稍后缩放重试。</div>}
    </section>
  );
}
