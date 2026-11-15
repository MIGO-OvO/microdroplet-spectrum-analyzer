import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { isTauriRuntime } from "../lib/bridge";

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  const desktop = isTauriRuntime();
  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    const refresh = () => void appWindow.isMaximized().then((value) => {
      if (!disposed) setMaximized(value);
    }).catch(() => {});
    refresh();
    const listener = appWindow.onResized(refresh);
    return () => { disposed = true; void listener.then((unlisten) => unlisten()); };
  }, [desktop]);
  const act = (action: "minimize" | "toggleMaximize" | "close") => {
    if (desktop) void getCurrentWindow()[action]().catch(() => setError("窗口操作失败，请重试"));
  };
  return <div className="title-bar">
    <div className="title-drag" data-tauri-drag-region>微液滴光谱分析仪 · 0.1.2</div>
    {error && <span role="alert">{error}</span>}
    <div className="window-controls">
      <button type="button" aria-label="最小化窗口" disabled={!desktop} onClick={() => act("minimize")}><Minus size={15} /></button>
      <button type="button" aria-label={maximized ? "还原窗口" : "最大化窗口"} disabled={!desktop} onClick={() => act("toggleMaximize")}>{maximized ? <Copy size={14} /> : <Square size={14} />}</button>
      <button type="button" className="window-close" aria-label="关闭窗口" disabled={!desktop} onClick={() => act("close")}><X size={17} /></button>
    </div>
  </div>;
}
