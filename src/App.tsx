import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Database,
  FolderOpen,
  Play,
  X,
} from "lucide-react";

import { TitleBar } from "./components/TitleBar";
import { CalibrationPanel } from "./components/CalibrationPanel";
import logoUrl from "../asset/LOGO.svg";
import { ColumnDialog } from "./components/ColumnDialog";
import { HistoryPanel } from "./components/HistoryPanel";
import { ParameterPanel } from "./components/ParameterPanel";
import { ResultsTable } from "./components/ResultsTable";
import { SignalChart } from "./components/SignalChart";
import { SummaryPanel } from "./components/SummaryPanel";
import {
  chooseChartPath,
  chooseDataFile,
  chooseResultsPath,
  chooseWaveformPath,
  exportChart,
  exportResults,
  exportWaveform,
  inspectDataFile,
  isTauriRuntime,
  loadDataFile,
  runAnalysis,
} from "./lib/bridge";
import { errorMessage, formatPointCount } from "./lib/format";
import type { CalibrationLibrary } from "./lib/calibration";
import {
  HISTORY_KEY,
  appendHistory,
  createHistoryEntry,
  exportHistoryCsv,
  loadHistory,
  saveHistory,
  type HistoryEntry,
  type HistoryOrigin,
} from "./lib/history";
import { SAMPLE_DROPLET_RESULT, SAMPLE_SUMMARY } from "./lib/sample";
import {
  DEFAULT_REQUEST,
  currentAnalysisRequest,
  type AnalysisRequest,
  type AnalysisResponse,
  type DatasetSummary,
  type FileInspection,
} from "./types";

const LARGE_DATA_THRESHOLD = 1_000_000;
const ANALYSIS_DEBOUNCE_MS = 350;

interface PendingFile {
  path: string;
  inspection: FileInspection;
}

function cloneDefaultRequest(): AnalysisRequest {
  return structuredClone(DEFAULT_REQUEST);
}

/** Summary line for a finished run, phrased for the mode that produced it. */
function completionStatus(result: AnalysisResponse): string {
  if (result.mode === "droplet") {
    const count = result.dropletMeasurements.length;
    return count > 0
      ? `分析完成，测得 ${count} 个液滴的校正信号 Δ。`
      : "分析完成：当前参数下未得到可配对的液滴。";
  }
  return result.statistics.featureCount > 0
    ? `分析完成，检测到 ${result.statistics.featureCount} 个平台。`
    : "分析完成，当前参数下未检测到平台。";
}

export default function App() {
  const [selection, setSelection] = useState<{ result: AnalysisResponse; number: number; revision: number } | null>(null);
  const desktopRuntime = isTauriRuntime();
  const [panel, setPanel] = useState<"analysis" | "calibration" | "history">("analysis");
  const [request, setRequest] = useState<AnalysisRequest>(cloneDefaultRequest);
  const [summary, setSummary] = useState<DatasetSummary | null>(
    desktopRuntime ? null : SAMPLE_SUMMARY,
  );
  const [result, setResult] = useState<AnalysisResponse | null>(
    desktopRuntime ? null : SAMPLE_DROPLET_RESULT,
  );
  const [datasetKey, setDatasetKey] = useState(0);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState<"data" | "chart" | "waveform" | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(
    desktopRuntime ? "未加载数据" : "浏览器构图预览 · 当前为合成演示数据",
  );
  const [error, setError] = useState<string | null>(null);
  const [initialHistory] = useState(loadHistory);
  const [history, setHistory] = useState<HistoryEntry[]>(initialHistory.entries);
  const [historyError, setHistoryError] = useState(initialHistory.error);
  const [calibrationLibrary, setCalibrationLibrary] = useState<CalibrationLibrary>({ version: 1, curves: [] });
  const [historyCurveId, setHistoryCurveId] = useState(() => {
    try { return localStorage.getItem(`${HISTORY_KEY}.curve`) ?? ""; }
    catch { return ""; }
  });
  const historyCurve = calibrationLibrary.curves.find(curve => curve.id === historyCurveId);
  const [loadedOrigin, setLoadedOrigin] = useState<HistoryOrigin | null>(null);
  const historyWritable = useRef(!initialHistory.error);
  /** Origin of the dataset whose initial analysis is about to finish, if any. */
  const recordOrigin = useRef<HistoryOrigin | null>(null);

  const requestRef = useRef(request);
  const summaryRef = useRef(summary);
  const analysisSequence = useRef(0);
  const skipNextAutoRun = useRef(false);
  const running = useRef(false);
  const queued = useRef<AnalysisRequest | null>(null);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);
  // A corrupted store is never overwritten: historyWritable stays false until the
  // operator explicitly resets it, so recorded work cannot be lost to a parse error.
  useEffect(() => {
    if (!historyWritable.current) return;
    try {
      saveHistory(history);
    } catch (storageError) {
      historyWritable.current = false;
      setHistoryError(`历史记录写入失败，已停止写入以保护原存储：${errorMessage(storageError)}`);
    }
  }, [history]);

  // Browser preview uses synthetic data; desktop runs use the loaded file.
  useEffect(() => {
    if (desktopRuntime) return;
    const preview = SAMPLE_DROPLET_RESULT;
    setResult(preview);
    setSummary({ ...SAMPLE_SUMMARY, pointCount: preview.plot.x.length });
  }, [desktopRuntime]);

  const handleRequestChange = (next: AnalysisRequest) => {
    ++analysisSequence.current;
    queued.current = null;
    requestRef.current = next;
    setDirty(true);
    setRequest(next);
  };

  const executeAnalysis = useCallback(
    async (candidate?: AnalysisRequest) => {
      if (!desktopRuntime || !summaryRef.current) return;
      if (running.current) { queued.current = candidate ?? requestRef.current; return; }
      running.current = true;
      const sequence = ++analysisSequence.current;
      const currentRequest = candidate ?? requestRef.current;
      setAnalyzing(true);
      setDirty(true);
      setError(null);
      setStatus("正在后台分析信号…");
      try {
        const nextResult = await runAnalysis(currentRequest);
        if (sequence !== analysisSequence.current) return;
        setResult(nextResult);
        setDirty(false);
        setStatus(completionStatus(nextResult));
        const origin = recordOrigin.current;
        const analysedSummary = summaryRef.current;
        if (origin && analysedSummary) {
          recordOrigin.current = null;
          const entry = createHistoryEntry({ result: nextResult, summary: analysedSummary, request: currentRequest, origin });
          setHistory((previous) => appendHistory(previous, entry));
        }
      } catch (analysisError) {
        if (sequence !== analysisSequence.current) return;
        recordOrigin.current = null;
        const message = errorMessage(analysisError);
        setError(message);
        setStatus("分析失败，请检查参数或重新加载数据。");
      } finally {
        running.current = false;
        setAnalyzing(false);
        const pending = queued.current;
        queued.current = null;
        if (pending) void executeAnalysis(pending);
      }
    },
    [desktopRuntime],
  );

  /**
   * Adopt a freshly loaded dataset: reset the session, run the initial analysis and
   * record its result once, whatever triggered the load (file picker or history).
   */
  const applyDataset = useCallback(
    async (loaded: DatasetSummary, nextRequest: AnalysisRequest, origin: HistoryOrigin) => {
      skipNextAutoRun.current = true;
      requestRef.current = nextRequest;
      summaryRef.current = loaded;
      setRequest(nextRequest);
      setSummary(loaded);
      setResult(null);
      setDatasetKey((key) => key + 1);
      setPendingFile(null);
      setLoadedOrigin(origin);
      const shouldAutoRefresh = loaded.pointCount <= LARGE_DATA_THRESHOLD;
      setAutoRefresh(shouldAutoRefresh);
      setStatus(
        loaded.droppedRows > 0
          ? `数据已加载；已忽略 ${formatPointCount(loaded.droppedRows)} 行非数值或空数据。`
          : "数据已加载，正在运行初始分析…",
      );
      recordOrigin.current = origin;
      await executeAnalysis(nextRequest);
      if (!shouldAutoRefresh) {
        setStatus("初始分析已完成；数据量较大，后续参数变更需手动运行。");
      }
    },
    [executeAnalysis],
  );

  useEffect(() => {
    if (!desktopRuntime || !summary) return;
    if (skipNextAutoRun.current) {
      skipNextAutoRun.current = false;
      return;
    }
    setDirty(true);
    if (!autoRefresh) {
      setStatus("参数已更改，点击“运行分析”更新结果。");
      return;
    }
    setStatus("参数已更改，等待自动刷新…");
    const timer = window.setTimeout(() => void executeAnalysis(request), ANALYSIS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [autoRefresh, desktopRuntime, executeAnalysis, request, summary]);

  const handleChooseFile = useCallback(async () => {
    if (running.current) { setStatus("请等待当前分析完成后再更换文件。"); return; }
    if (!desktopRuntime) {
      setStatus("文件选择仅在 Tauri 桌面应用中可用；当前显示合成构图预览。");
      return;
    }
    setFileBusy(true);
    setError(null);
    try {
      const path = await chooseDataFile();
      if (!path) return;
      setStatus("正在读取文件结构…");
      const inspection = await inspectDataFile(path);
      setPendingFile({ path, inspection });
      setStatus("请选择信号列和可选时间列。");
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      setStatus("无法读取所选文件。");
    } finally {
      setFileBusy(false);
    }
  }, [desktopRuntime]);

  const handleColumnConfirm = async (signalColumn: number, timeColumn: number | null) => {
    if (!pendingFile) return;
    setFileBusy(true);
    setError(null);
    try {
      const loaded = await loadDataFile(pendingFile.path, signalColumn, timeColumn);
      const nextRequest = { ...requestRef.current, xRange: null };
      await applyDataset(loaded, nextRequest, { path: pendingFile.path, signalColumn, timeColumn });
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      setStatus("数据加载失败，请重新选择文件和列。");
    } finally {
      setFileBusy(false);
    }
  };

  const handleExportData = async () => {
    if (!desktopRuntime || !summary || !result) return;
    const path = await chooseResultsPath(summary.fileName);
    if (!path) return;
    setExporting("data");
    setError(null);
    try {
      const exported = await exportResults(path);
      setStatus(`分析数据已导出到 ${exported.path}`);
    } catch (exportError) {
      setError(errorMessage(exportError));
      setStatus("Excel 导出失败，请确认目标文件未被占用。");
    } finally {
      setExporting(null);
    }
  };

  const handleExportWaveform = async () => {
    if (!desktopRuntime || !summary || !result || dirty || analyzing || fileBusy || exporting) return;
    const resultId = result.resultId;
    setExporting("waveform");
    setError(null);
    try {
      const path = await chooseWaveformPath(summary.fileName);
      if (!path) return;
      const exported = await exportWaveform(path, resultId);
      setStatus(`处理后波形已导出到 ${exported.path}`);
    } catch (exportError) {
      setError(errorMessage(exportError));
      setStatus("波形导出失败，请检查分析结果和保存路径。");
    } finally {
      setExporting(null);
    }
  };

  const handleExportChart = async () => {
    if (!desktopRuntime || !summary || !result) return;
    const path = await chooseChartPath(summary.fileName);
    if (!path) return;
    setExporting("chart");
    setError(null);
    try {
      const exported = await exportChart(path);
      setStatus(`分析图表已导出到 ${exported.path}`);
    } catch (exportError) {
      setError(errorMessage(exportError));
      setStatus("图表导出失败，请选择 PNG 或 SVG 文件。");
    } finally {
      setExporting(null);
    }
  };

  const handleRecordCurrent = () => {
    if (!summary || !result || dirty || analyzing) {
      setStatus("请等待与当前参数同步的分析结果后再记录。");
      return;
    }
    const entry = createHistoryEntry({ result, summary, request: requestRef.current, origin: loadedOrigin });
    setHistory((previous) => appendHistory(previous, entry));
    setStatus(`已把 ${summary.fileName} 的当前结果记入处理历史。`);
  };

  const handleUpdateHistory = (id: string, patch: Partial<Pick<HistoryEntry, "source" | "note">>) => {
    setHistory((previous) => previous.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  };

  const handleRemoveHistory = (id: string) => {
    setHistory((previous) => previous.filter((entry) => entry.id !== id));
    setStatus("已删除所选历史记录。");
  };

  const handleClearHistory = () => {
    setHistory([]);
    setStatus("处理历史已清空。");
  };

  const handleResetHistoryStorage = () => {
    if (!window.confirm("清空本机历史记录存储并重新开始记录？原有内容将被删除。")) return;
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // Removing is best-effort: the in-memory list is cleared either way.
    }
    historyWritable.current = true;
    setHistoryError("");
    setHistory([]);
    setStatus("历史记录存储已重置，可以继续记录。");
  };

  const handleExportHistory = async () => {
    try {
      if (await exportHistoryCsv(history, historyCurve)) setStatus(`已导出 ${history.length} 条处理记录${historyCurve ? "及浓度结果" : ""}。`);
    } catch (exportError) {
      setError(errorMessage(exportError));
      setStatus("处理历史导出失败，请确认目标文件未被占用。");
    }
  };

  const handleHistoryCurveChange = (id: string) => {
    setHistoryCurveId(id);
    try { localStorage.setItem(`${HISTORY_KEY}.curve`, id); }
    catch (storageError) { setError(`工作曲线选择无法记忆：${errorMessage(storageError)}`); }
  };

  const handleReloadHistory = async (entry: HistoryEntry) => {
    if (!entry.filePath || entry.signalColumn == null) {
      setError("该记录没有保存文件路径或列信息，无法重新载入；请用“加载数据”手动选择文件。");
      return;
    }
    if (running.current) {
      setStatus("请等待当前分析完成后再重新载入。");
      return;
    }
    setFileBusy(true);
    setError(null);
    try {
      setStatus(`正在重新载入 ${entry.fileName}…`);
      const loaded = await loadDataFile(entry.filePath, entry.signalColumn, entry.timeColumn);
      const nextRequest = entry.parameters
        ? currentAnalysisRequest(entry.parameters)
        : { ...requestRef.current, xRange: null };
      await applyDataset(loaded, nextRequest, {
        path: entry.filePath, signalColumn: entry.signalColumn, timeColumn: entry.timeColumn,
      });
      setPanel("analysis");
    } catch (reloadError) {
      setError(errorMessage(reloadError));
      setStatus("重新载入失败：文件可能已被移动、改名或被其他程序占用。");
    } finally {
      setFileBusy(false);
    }
  };

  const handleReuseHistoryParameters = (entry: HistoryEntry) => {
    if (!entry.parameters) return;
    const sameFile = summary?.fileName === entry.fileName;
    const next: AnalysisRequest = {
      ...currentAnalysisRequest(entry.parameters),
      xRange: sameFile ? entry.parameters.xRange ?? null : null,
    };
    ++analysisSequence.current;
    queued.current = null;
    requestRef.current = next;
    setDirty(true);
    setRequest(next);
    setPanel("analysis");
    setStatus(sameFile
      ? (autoRefresh ? "已套用该记录的处理参数，正在重新分析…" : "已套用该记录的处理参数，请点击“运行分析”。")
      : (autoRefresh ? "已套用该记录的处理参数；当前文件不同，横坐标范围未恢复。" : "已套用该记录的处理参数；当前文件不同，横坐标范围未恢复，请点击“运行分析”。"));
  };

  return (
    <div className="app-shell">
      <TitleBar />
      <header className="app-bar">
        <div className="brand-lockup">
          <img src={logoUrl} alt="" />
          <strong>微液滴光谱分析仪</strong>
        </div>

        <div className="dataset-state" title={summary?.fileName}>
          <Database size={16} aria-hidden="true" />
          <span>{summary ? summary.fileName : "等待实验数据"}</span>
          {summary && <small>{formatPointCount(summary.pointCount)} 点</small>}
        </div>


        <div className="app-actions">
          <button className="button secondary" type="button" onClick={handleChooseFile} disabled={fileBusy}>
            <FolderOpen size={17} aria-hidden="true" />
            加载数据
          </button>
          <button
            className="button primary run-button"
            type="button"
            disabled={!desktopRuntime || !summary || analyzing || fileBusy}
            onClick={() => void executeAnalysis()}
          >
            {analyzing ? <span className="button-spinner" aria-hidden="true" /> : <Play size={17} aria-hidden="true" fill="currentColor" />}
            {analyzing ? "分析中…" : "运行分析"}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          <button className="icon-button" type="button" onClick={() => setError(null)} aria-label="关闭错误提示">
            <X size={17} />
          </button>
        </div>
      )}

      <div className="functional-shell">
      <nav className="functional-nav" aria-label="功能面板">
        <button type="button" aria-current={panel === "analysis" ? "page" : undefined} onClick={() => setPanel("analysis")}>数据处理</button>
        <button type="button" aria-current={panel === "calibration" ? "page" : undefined} onClick={() => setPanel("calibration")}>工作曲线</button>
        <button type="button" aria-current={panel === "history" ? "page" : undefined} onClick={() => setPanel("history")}>历史记录</button>
      </nav>
      <div className="functional-content">
      <CalibrationPanel active={panel === "calibration"} desktop={desktopRuntime} hidden={panel === "history"}
        result={dirty || analyzing || fileBusy ? null : result} summary={summary} request={request}
        onOpen={() => setPanel("calibration")} onLibraryChange={setCalibrationLibrary} />
      <HistoryPanel
        active={panel === "history"}
        entries={history}
        error={historyError}
        curves={calibrationLibrary.curves}
        curve={historyCurve}
        onSelectCurve={handleHistoryCurveChange}
        canRecord={desktopRuntime && !!summary && !!result && !dirty && !analyzing && !fileBusy}
        onRecord={handleRecordCurrent}
        onReload={(entry) => void handleReloadHistory(entry)}
        onReuseParameters={handleReuseHistoryParameters}
        onUpdate={handleUpdateHistory}
        onRemove={handleRemoveHistory}
        onClear={handleClearHistory}
        onResetStorage={handleResetHistoryStorage}
        onExport={() => void handleExportHistory()}
      />
      <main className="app-main" hidden={panel !== "analysis"}>
        <div className="workspace-grid">
          <ParameterPanel
            summary={summary}
            request={request}
            disabled={!desktopRuntime || fileBusy}
            autoRefresh={autoRefresh}
            showLabels={showLabels}
            onRequestChange={handleRequestChange}
            onChooseFile={() => void handleChooseFile()}
            onAutoRefreshChange={(enabled) => { if (!enabled) queued.current = null; setAutoRefresh(enabled); }}
            onShowLabelsChange={setShowLabels}
          />
          <SignalChart
            key={datasetKey}
            result={result}
            thresholdLow={request.plateau.thresholdLow}
            thresholdHigh={request.plateau.thresholdHigh}
            amplitudeBands={request.mode === "droplet" ? request.droplet.amplitudeBands : null}
            onAmplitudeBandsChange={fileBusy ? undefined : amplitudeBands => handleRequestChange({
              ...requestRef.current, droplet: { ...requestRef.current.droplet, amplitudeBands },
            })}
            hasRealTime={summary?.hasRealTime ?? false}
            showLabels={showLabels}
            selectedSegment={selection?.result === result ? selection.number : null}
            selectionRevision={selection?.revision}
            onSelectSegment={(number) => { if (result) setSelection(previous => ({ result, number, revision: (previous?.revision ?? 0) + 1 })); }}
          />
          <SummaryPanel result={result} busy={analyzing} dirty={dirty}
            selectedSegment={selection?.result === result ? selection.number : null}
            onSelectSegment={(number) => { if (result) setSelection(previous => ({ result, number, revision: (previous?.revision ?? 0) + 1 })); }} />
        </div>

        <ResultsTable
          selectedSegment={selection?.result === result ? selection.number : null}
          onSelectSegment={(number) => { if (result) setSelection(previous => ({ result, number, revision: (previous?.revision ?? 0) + 1 })); }}
          result={dirty || analyzing || fileBusy ? null : result}
          exporting={exporting}
          onExportData={() => void handleExportData()}
          onExportWaveform={() => void handleExportWaveform()}
          onExportChart={() => void handleExportChart()}
        />
      </main>
      </div>
      </div>

      <footer className="status-bar">
        <span className={analyzing ? "status-dot running" : error ? "status-dot error" : "status-dot ready"} />
        <span>{status}</span>
      </footer>

      {pendingFile && (
        <ColumnDialog
          inspection={pendingFile.inspection}
          busy={fileBusy}
          onCancel={() => setPendingFile(null)}
          onConfirm={(signalColumn, timeColumn) => void handleColumnConfirm(signalColumn, timeColumn)}
        />
      )}
    </div>
  );
}
