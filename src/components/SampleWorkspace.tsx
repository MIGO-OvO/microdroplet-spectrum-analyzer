import { useEffect, useMemo, useState } from "react";
import { Crosshair, Layers3, MapPin } from "lucide-react";
import { listSamplingRecords } from "../lib/bridge";
import { errorMessage } from "../lib/format";
import { buildMapLayers, concentrationGradient, type LayerMode } from "../lib/sample-surface";
import { positionLabel, samplePosition } from "../lib/sampling";
import type { SamplingRecord } from "../types";
import { SampleMap } from "./SampleMap";

const MAP_KEY = "samples.googleMapsKey";
const MODES = { points: "实测点", heat: "热力图", contours: "等浓度线" } as const;
const measurement = (value: number) => Number(value.toPrecision(6)).toString();

interface Props {
  desktop: boolean;
  busy: boolean;
  selected: number[];
  onSelect: (ids: number[]) => void;
  onReload: (record: SamplingRecord) => void;
}

function recordConcentration(record: SamplingRecord) {
  return record.concentration ? `${measurement(record.concentration.value)} ${record.concentration.unit}` : "未填写浓度";
}

export function SampleWorkspace({ desktop, busy, selected, onSelect, onReload }: Props) {
  const [records, setRecords] = useState<SamplingRecord[] | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [layer, setLayer] = useState<LayerMode>("points");
  const [loadError, setLoadError] = useState("");
  const [keyError, setKeyError] = useState("");
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem(MAP_KEY) ?? ""; } catch { return ""; }
  });
  const [keyDraft, setKeyDraft] = useState(apiKey);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void listSamplingRecords().then(values => { if (active) setRecords(values); })
      .catch(cause => { if (active) setLoadError(errorMessage(cause)); });
    return () => { active = false; };
  }, [desktop]);

  const layers = useMemo(() => buildMapLayers((records ?? []).filter(record => selected.includes(record.id))), [records, selected]);
  const query = search.trim().toLocaleLowerCase();
  const shown = (records ?? []).filter(record => [record.name, record.analyte, record.source.metadata?.sampleId]
    .some(text => text?.toLocaleLowerCase().includes(query)));
  const inspected = records?.find(record => record.id === focused);

  const toggle = (record: SamplingRecord) => {
    const exists = selected.includes(record.id);
    onSelect(exists ? selected.filter(id => id !== record.id) : [...selected, record.id]);
    setFocused(exists ? null : record.id);
  };

  const saveKey = () => {
    const next = keyDraft.trim();
    setApiKey(next);
    setKeyError("");
    try {
      if (next) localStorage.setItem(MAP_KEY, next);
      else localStorage.removeItem(MAP_KEY);
    } catch { setKeyError("本次会话可使用该设置。重启后请重新填写密钥。"); }
  };

  return <section className="sampling-workspace" aria-label="采样地图">
    <aside className="sampling-library" aria-label="采样库">
      <div className="sampling-library-heading"><h2>采样库</h2><span>{records?.length ?? 0} 条</span></div>
      <label className="field-stack sampling-search"><span className="visually-hidden">搜索采样</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索采样名称或编号" />
      </label>
      <div className="sampling-records" aria-label="采样记录">
        {loadError && <p className="field-error" role="alert">{loadError}</p>}
        {!desktop && <p className="sampling-empty">在桌面应用中保存采样数据。</p>}
        {desktop && !loadError && !records && <p className="sampling-empty" role="status">正在读取采样库…</p>}
        {records?.length === 0 && <p className="sampling-empty">分析完成后，点击“保存采样数据”。</p>}
        {records && records.length > 0 && !shown.length && <p className="sampling-empty">没有匹配的采样记录。</p>}
        {shown.map(record => {
          const plotted = selected.includes(record.id);
          return <div className="sampling-row" data-focused={focused === record.id} key={record.id}>
            <button type="button" className="sampling-row-summary" onClick={() => setFocused(record.id)} aria-pressed={focused === record.id}>
              <strong>{record.name}</strong><span>{recordConcentration(record)}</span>
              <small>{positionLabel(record.source.metadata)}</small>
            </button>
            <button type="button" className="button quiet compact-button sampling-toggle" disabled={!samplePosition(record)}
              title={samplePosition(record) ? undefined : positionLabel(record.source.metadata)}
              aria-label={`${plotted ? "移除" : "添加"}${record.name}${plotted ? "的地图点" : "到地图"}`} onClick={() => toggle(record)}>
              {plotted ? "移出" : "上图"}
            </button>
          </div>;
        })}
      </div>
      {inspected && <section className="sampling-detail" aria-label="采样详情">
        <h3>{inspected.name}</h3>
        <dl>
          <dt>原始文件</dt><dd title={inspected.source.path}>{inspected.source.fileName}</dd>
          {inspected.source.metadata?.sampleId && <><dt>样本编号</dt><dd>{inspected.source.metadata.sampleId}</dd></>}
          {inspected.source.metadata?.startedAt && <><dt>采样时间</dt><dd>{inspected.source.metadata.startedAt}</dd></>}
          <dt>位置</dt><dd>{positionLabel(inspected.source.metadata)}</dd>
          <dt>浓度</dt><dd>{recordConcentration(inspected)}{inspected.analyte && ` · ${inspected.analyte}`}</dd>
          {inspected.concentration?.curve && <><dt>工作曲线</dt><dd>{inspected.concentration.curve.name}</dd></>}
          <dt>响应值</dt><dd>{inspected.response == null ? "—" : measurement(inspected.response)} · {inspected.detectionCount} 项检测</dd>
        </dl>
        {inspected.concentration?.notices.map(notice => <p className="sample-notice" key={notice}>{notice}</p>)}
        <button className="button secondary compact-button" type="button" disabled={busy} onClick={() => onReload(inspected)}>用原文件重新分析</button>
      </section>}
    </aside>
    <div className="sampling-map-panel">
      <div className="sampling-map-toolbar">
        <div className="sampling-layers" role="group" aria-label="地图图层">
          <Layers3 size={16} aria-hidden="true" />
          {(Object.keys(MODES) as LayerMode[]).map(mode => <button className="button quiet compact-button" type="button"
            key={mode} aria-pressed={layer === mode} onClick={() => setLayer(mode)}>{MODES[mode]}</button>)}
        </div>
        <span className="sampling-count"><MapPin size={15} aria-hidden="true" />{layers.points.length} 个点</span>
        <details className="sample-map-settings">
          <summary className="button secondary compact-button"><Crosshair size={15} aria-hidden="true" />配置卫星底图</summary>
          <form className="sample-key-fields" onSubmit={event => { event.preventDefault(); saveKey(); }}>
            <label className="field-stack"><span>Google Maps API Key</span>
              <input type="password" value={keyDraft} onChange={event => setKeyDraft(event.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <p>启用 Maps JavaScript API 和计费，并在密钥的网站限制中添加此来源。</p>
            <code>{window.location.origin}/*</code>
            {keyError && <p className="field-error" role="alert">{keyError}</p>}
            <button className="button primary compact-button" type="submit">应用</button>
          </form>
        </details>
      </div>
      <SampleMap apiKey={apiKey} mode={layer} layers={layers} focused={focused} onFocus={setFocused} />
      {layers.range && <div className="sampling-legend" aria-label="浓度色标">
        <span>浓度 <strong>{layers.range.unit}</strong></span>
        <span>{measurement(layers.range.min)}</span>
        <span className="sampling-color-ramp" style={{ background: concentrationGradient }} />
        <span>{measurement(layers.range.max)}</span>
        {layer === "contours" && layers.contours.length > 0 && <small>等值线 {layers.contours.map(item => measurement(item.value)).join(" / ")}</small>}
      </div>}
    </div>
  </section>;
}
