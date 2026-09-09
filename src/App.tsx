import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FolderOpen,
  Play,
  X,
} from "lucide-react";

import { TitleBar } from "./components/TitleBar";
import logoUrl from "../asset/LOGO.svg";
import { ColumnDialog } from "./components/ColumnDialog";
import { ParameterPanel } from "./components/ParameterPanel";
import { ResultsTable } from "./components/ResultsTable";
import { SignalChart } from "./components/SignalChart";
import { SummaryPanel } from "./components/SummaryPanel";
import {
  chooseChartPath,
  chooseDataFile,
  chooseResultsPath,
  exportChart,
  exportResults,
  inspectDataFile,
  isTauriRuntime,
  loadDataFile,
  runAnalysis,
  suggestParameters,
} from "./lib/bridge";
import { errorMessage, formatPointCount } from "./lib/format";
import { SAMPLE_RESULT, SAMPLE_SUMMARY } from "./lib/sample";
import {
  DEFAULT_REQUEST,
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
  return {
    ...DEFAULT_REQUEST,
    preprocess: { ...DEFAULT_REQUEST.preprocess },
    plateau: { ...DEFAULT_REQUEST.plateau },
  };
}

export default function App() {
  const desktopRuntime = isTauriRuntime();
  const [request, setRequest] = useState<AnalysisRequest>(cloneDefaultRequest);
  const [summary, setSummary] = useState<DatasetSummary | null>(
    desktopRuntime ? null : SAMPLE_SUMMARY,
  );
  const [result, setResult] = useState<AnalysisResponse | null>(
    desktopRuntime ? null : SAMPLE_RESULT,
  );
  const [datasetKey, setDatasetKey] = useState(0);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [exporting, setExporting] = useState<"data" | "chart" | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(
    desktopRuntime ? "未加载数据" : "浏览器构图预览 · 当前为合成演示数据",
  );
  const [error, setError] = useState<string | null>(null);

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

  const executeAnalysis = useCallback(
    async (candidate?: AnalysisRequest) => {
      if (!desktopRuntime || !summaryRef.current) return;
      if (running.current) { queued.current = candidate ?? requestRef.current; return; }
      running.current = true;
      const sequence = ++analysisSequence.current;
      const currentRequest = candidate ?? requestRef.current;
      setAnalyzing(true);
      setError(null);
      setStatus("正在后台分析信号…");
      try {
        const nextResult = await runAnalysis(currentRequest);
        if (sequence !== analysisSequence.current) return;
        setResult(nextResult);
        setDirty(false);
        setStatus(
          nextResult.statistics.featureCount > 0
            ? `分析完成，检测到 ${nextResult.statistics.featureCount} 个平台。`
            : `分析完成，当前参数下未检测到平台。`,
        );
      } catch (analysisError) {
        if (sequence !== analysisSequence.current) return;
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
      let nextRequest = requestRef.current;
      if (nextRequest.mode === "plateau") {
        const suggestion = await suggestParameters(nextRequest.preprocess);
        if (suggestion.ok && suggestion.plateau) {
          nextRequest = { ...nextRequest, plateau: suggestion.plateau };
        }
      }
      skipNextAutoRun.current = true;
      requestRef.current = nextRequest;
      summaryRef.current = loaded;
      setRequest(nextRequest);
      setSummary(loaded);
      setResult(null);
      setDatasetKey((key) => key + 1);
      setPendingFile(null);
      const shouldAutoRefresh = loaded.pointCount <= LARGE_DATA_THRESHOLD;
      setAutoRefresh(shouldAutoRefresh);
      setStatus(
        loaded.droppedRows > 0
          ? `数据已加载；已忽略 ${formatPointCount(loaded.droppedRows)} 行非数值或空数据。`
          : "数据已加载，正在运行初始分析…",
      );
      await executeAnalysis(nextRequest);
      if (!shouldAutoRefresh) {
        setStatus("初始分析已完成；数据量较大，后续参数变更需手动运行。 ");
      }
    } catch (loadError) {
      const message = errorMessage(loadError);
      setError(message);
      setStatus("数据加载失败，请重新选择文件和列。");
    } finally {
      setFileBusy(false);
    }
  };

  const handleSuggest = async () => {
    if (!desktopRuntime || !summary) return;
    setSuggesting(true);
    setError(null);
    try {
      const suggestion = await suggestParameters(requestRef.current.preprocess);
      setStatus(suggestion.message);
      if (suggestion.ok && suggestion.plateau) {
        setRequest((current) => ({ ...current, plateau: suggestion.plateau! }));
      }
    } catch (suggestionError) {
      const message = errorMessage(suggestionError);
      setError(message);
      setStatus("无法根据当前数据生成参数建议。");
    } finally {
      setSuggesting(false);
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


  return (
    <div className="app-shell">
      <TitleBar />
      <header className="app-bar">
        <div className="brand-lockup">
          <img src={logoUrl} alt="" />
          <div>
            <strong>微液滴光谱分析仪</strong>
            <span>Microdroplet Spectrum Analyzer</span>
          </div>
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

      <main className="app-main">
        <div className="workspace-grid">
          <ParameterPanel
            summary={summary}
            request={request}
            disabled={!desktopRuntime || fileBusy}
            autoRefresh={autoRefresh}
            showLabels={showLabels}
            suggesting={suggesting}
            onRequestChange={(next) => { ++analysisSequence.current; queued.current = null; requestRef.current = next; setDirty(true); setRequest(next); }}
            onChooseFile={() => void handleChooseFile()}
            onSuggest={() => void handleSuggest()}
            onAutoRefreshChange={(enabled) => { if (!enabled) queued.current = null; setAutoRefresh(enabled); }}
            onShowLabelsChange={setShowLabels}
          />
          <SignalChart
            key={datasetKey}
            result={result}
            thresholdLow={request.plateau.thresholdLow}
            thresholdHigh={request.plateau.thresholdHigh}
            hasRealTime={summary?.hasRealTime ?? false}
            showLabels={showLabels}
          />
          <SummaryPanel result={result} busy={analyzing} dirty={dirty} status={status} />
        </div>

        <ResultsTable
          result={dirty || analyzing || fileBusy ? null : result}
          exporting={exporting}
          onExportData={() => void handleExportData()}
          onExportChart={() => void handleExportChart()}
        />
      </main>

      <footer className="status-bar">
        <span className={analyzing ? "status-dot running" : error ? "status-dot error" : "status-dot ready"} />
        <span>{status}</span>
        <span className="status-runtime">
          {desktopRuntime ? (
            <><CheckCircle2 size={14} aria-hidden="true" /> 本地桌面模式</>
          ) : (
            "合成构图预览"
          )}
        </span>
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
