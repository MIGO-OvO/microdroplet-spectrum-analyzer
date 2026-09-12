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
import { clampRange, nearestIndex, xBounds } from "../lib/chart";
import { isTauriRuntime, loadPlotView } from "../lib/bridge";
import type { DropletMeasurement, PlotSeries, AnalysisResponse } from "../types";

interface SignalChartProps {
  result: AnalysisResponse | null;
  thresholdLow: number;
  thresholdHigh: number;
  hasRealTime: boolean;
  showLabels: boolean;
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

const MARGIN = { top: 35, right: 22, bottom: 42, left: 64 };

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
  hasRealTime,
  showLabels,
}: SignalChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const yBounds = useRef<{ range: [number, number]; min: number; max: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [size, setSize] = useState({ width: 900, height: 520 });
  const [range, setRange] = useState<[number, number]>([0, 1]);
  const [detail, setDetail] = useState<{ result: AnalysisResponse; range: [number, number]; plot: PlotSeries } | null>(null);
  const [detailError, setDetailError] = useState(false);
  const plot = detail?.result === result && detail?.range === range ? detail.plot : result?.plot;
  const [hover, setHover] = useState<HoverPoint | null>(null);

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
    // The plateau mode always wants its amplitude window on screen; the droplet
    // mode has no amplitude window at all and frames the data instead.
    let yMin = result.mode === "plateau" ? Math.min(thresholdLow, thresholdHigh) : Infinity;
    let yMax = result.mode === "plateau" ? Math.max(thresholdLow, thresholdHigh) : -Infinity;
    for (let i = start; i <= end; i++) {
      yMin = Math.min(yMin, plot.original[i], plot.processed[i]);
      yMax = Math.max(yMax, plot.original[i], plot.processed[i]);
    }
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    const padding = yMin === yMax ? 0.5 : (yMax - yMin) * 0.1;
    if (range[1] - range[0] === 1 || yBounds.current?.range !== range) {
      yBounds.current = { range, min: yMin - padding, max: yMax + padding };
    }
    return { start, end: Math.min(length - 1, end), xMin, xMax, yMin: yBounds.current.min, yMax: yBounds.current.max };
  }, [range, result, plot, thresholdHigh, thresholdLow]);

  // The droplet under the pointer, if any. Hovering is the only time the local
  // reference construction is drawn, so the plot stays readable at rest.
  const activeMeasurement = useMemo<DropletMeasurement | null>(() => {
    if (!hover || !result || result.mode !== "droplet" || !visible) return null;
    let best: DropletMeasurement | null = null;
    let bestDistance = Infinity;
    for (const measurement of result.dropletMeasurements) {
      const distance = Math.abs(measurement.center - hover.x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = measurement;
      }
    }
    const tolerance = (visible.xMax - visible.xMin) * 0.05 || 1;
    return bestDistance <= tolerance ? best : null;
  }, [hover, result, visible]);

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
      context.font = "13px system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("加载数据后显示原始信号与处理后信号", size.width / 2, size.height / 2);
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

    context.restore();
    context.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
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
    if (result.mode === "plateau") {
      context.save();
      context.setLineDash([6, 4]);
      context.lineWidth = 1;
      for (const [value, color] of [
        [thresholdLow, "#d69027"],
        [thresholdHigh, "#d69027"],
      ] as const) {
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
      for (const segment of result.stableSegments) {
        if (segment.center < visible.xMin || segment.center > visible.xMax) continue;
        const x = scaleX(segment.center);
        const y = scaleY(segment.level);
        const color =
          segment.kind === "platform"
            ? PLATFORM_COLOR
            : segment.kind === "bottom"
              ? BOTTOM_COLOR
              : UNKNOWN_COLOR;
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

      // Corrected Δ: the vertical distance from the interpolated Platform reference
      // down to the Bottom level, at the Bottom's own x position.
      for (const measurement of result.dropletMeasurements) {
        if (measurement.center < visible.xMin || measurement.center > visible.xMax) continue;
        const x = scaleX(measurement.center);
        const referenceY = scaleY(measurement.platformReference);
        const bottomY = scaleY(measurement.bottomLevel);
        context.save();
        context.strokeStyle = DELTA_COLOR;
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(x, referenceY);
        context.lineTo(x, bottomY);
        context.stroke();
        context.beginPath();
        context.arc(x, referenceY, 3, 0, Math.PI * 2);
        context.fillStyle = DELTA_COLOR;
        context.fill();
        context.restore();
        if (showLabels && measurement.number % 5 === 1) {
          const label = `Δ ${formatMeasurement(measurement.correctedSignal, 4)}`;
          context.font = "600 10px system-ui, sans-serif";
          context.textAlign = "center";
          const textWidth = context.measureText(label).width;
          const anchorY = Math.max(MARGIN.top + 12, (referenceY + bottomY) / 2);
          context.fillStyle = "rgba(255, 255, 255, 0.94)";
          context.fillRect(x - textWidth / 2 - 4, anchorY - 11, textWidth + 8, 15);
          context.fillStyle = DELTA_COLOR;
          context.fillText(label, x, anchorY);
        }
      }

      // On hover, show how that one reference was built: the two Platform levels
      // and the interpolation between them.
      if (activeMeasurement) {
        const measurement = activeMeasurement;
        const x = scaleX(measurement.center);
        context.save();
        context.strokeStyle = DELTA_COLOR;
        context.setLineDash([4, 4]);
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(scaleX(measurement.center - (visible.xMax - visible.xMin) * 0.08), scaleY(measurement.platformReference));
        context.lineTo(x, scaleY(measurement.platformReference));
        context.stroke();
        if (measurement.leftPlatformLevel != null) {
          context.beginPath();
          context.moveTo(MARGIN.left, scaleY(measurement.leftPlatformLevel));
          context.lineTo(x, scaleY(measurement.leftPlatformLevel));
          context.stroke();
        }
        if (measurement.rightPlatformLevel != null) {
          context.beginPath();
          context.moveTo(x, scaleY(measurement.rightPlatformLevel));
          context.lineTo(MARGIN.left + plotWidth, scaleY(measurement.rightPlatformLevel));
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
          context.font = "600 10px system-ui, sans-serif";
          const textWidth = context.measureText(label).width;
          labelRight = x + textWidth / 2;
          context.fillStyle = "rgba(255, 255, 255, 0.94)";
          context.fillRect(x - textWidth / 2 - 4, y - 22, textWidth + 8, 15);
          context.fillStyle = "#1e2a32";
          context.textAlign = "center";
          context.fillText(label, x, y - 11);
        }
      }
    }

    context.restore();
    context.fillStyle = "#42535e";
    context.font = "12px system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(hasRealTime ? "时间" : "数据点", MARGIN.left + plotWidth / 2, size.height - 8);
    context.save();
    context.translate(15, MARGIN.top + plotHeight / 2);
    context.rotate(-Math.PI / 2);
    context.fillText("信号强度", 0, 0);
    context.restore();
  }, [activeMeasurement, hasRealTime, result, plot, showLabels, size, thresholdHigh, thresholdLow, visible]);

  const plotGeometry = () => {
    const rectangle = canvasRef.current?.getBoundingClientRect();
    if (!rectangle) return null;
    return {
      rectangle,
      width: rectangle.width - MARGIN.left - MARGIN.right,
    };
  };

  const updateHover = (event: ReactPointerEvent<HTMLCanvasElement>) => {
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

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!result) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, range };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) {
      updateHover(event);
      return;
    }
    const geometry = plotGeometry();
    if (!geometry || geometry.width <= 0) return;
    const span = drag.range[1] - drag.range[0];
    const shift = ((drag.clientX - event.clientX) / geometry.width) * span;
    setRange(clampRange(drag.range[0] + shift, drag.range[1] + shift));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    updateHover(event);
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
    if (!result) return;
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
          <span>{result?.mode === "droplet" ? "液滴双电平检测" : "平台区间检测"}</span>
        </div>
        <div className="chart-legend" aria-label="图例">
          <span><i className="legend-line original" />原始信号</span>
          <span><i className="legend-line processed" />处理后信号</span>
          {result?.mode === "droplet" ? (
            <>
              <span><i className="legend-square platform" />Platform</span>
              <span><i className="legend-dot bottom" />Bottom</span>
              <span><i className="legend-dot unknown" />Unknown</span>
              <span><i className="legend-delta" />Corrected ΔSignal</span>
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
          <button type="button" className="icon-button" onClick={() => zoom(0.78)} disabled={!result} aria-label="放大图表">
            <ZoomIn size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => zoom(1.28)} disabled={!result} aria-label="缩小图表">
            <ZoomOut size={17} />
          </button>
          <button type="button" className="icon-button" onClick={() => setRange([0, 1])} disabled={!result} aria-label="重置图表范围">
            <RotateCcw size={16} />
          </button>
        </div>
      </header>
      <div ref={containerRef} className="chart-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="signal-canvas"
          role="img"
          aria-label={
            result?.mode === "droplet"
              ? "原始信号、处理后信号、稳定区段电平与校正信号 Δ 图；悬停查看单个液滴的参考构造；滚轮缩放，拖动平移，按 0 重置"
              : "原始信号、处理后信号、检测结果和检测范围图；滚轮缩放，拖动平移，按 0 重置"
          }
          tabIndex={0}
          onWheel={handleWheel}
          onDoubleClick={() => setRange([0, 1])}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => (dragRef.current = null)}
          onPointerLeave={() => !dragRef.current && setHover(null)}
          onKeyDown={handleKeyboard}
        />
        {hover && result && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(size.width - 176, Math.max(72, hover.left + 12)),
              top: Math.max(42, hover.top - 72),
            }}
          >
            <strong>{hasRealTime ? "时间" : "数据点"} {formatMeasurement(hover.x, 4)}</strong>
            <span>原始 {formatMeasurement(hover.original, 6)}</span>
            <span>处理后 {formatMeasurement(hover.processed, 6)}</span>
            {activeMeasurement && (
              <div className="tooltip-droplet">
                <em>液滴 #{activeMeasurement.number}</em>
                <span>中心 {formatMeasurement(activeMeasurement.center, 4)}</span>
                <span>Bottom {formatMeasurement(activeMeasurement.bottomLevel, 6)}</span>
                <span>
                  左 Platform {formatMeasurement(activeMeasurement.leftPlatformLevel ?? null, 6)}
                  {" · "}
                  右 Platform {formatMeasurement(activeMeasurement.rightPlatformLevel ?? null, 6)}
                </span>
                <span>
                  Platform Reference {formatMeasurement(activeMeasurement.platformReference, 6)}
                </span>
                <span className="tooltip-delta">
                  Corrected ΔSignal {formatMeasurement(activeMeasurement.correctedSignal, 6)}
                </span>
                <span>参考方式 {formatReferenceMode(activeMeasurement.referenceMode)}</span>
                <span>置信度 {activeMeasurement.confidence.toFixed(3)}</span>
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
      <footer className="chart-help">
        <span>
          {detailError
            ? "局部细节读取失败，请稍后缩放重试"
            : result?.mode === "droplet"
              ? "滚轮缩放 · 拖动平移 · 双击重置 · 悬停液滴查看参考构造"
              : "滚轮缩放 · 拖动平移 · 双击重置 · 调参保留缩放"}
        </span>
        <span>当前显示 {Number(((range[1] - range[0]) * 100).toPrecision(3))}% 数据范围</span>
      </footer>
    </section>
  );
}
