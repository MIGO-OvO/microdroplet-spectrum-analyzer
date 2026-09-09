---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/SignalChart.tsx","src/components/ParameterPanel.tsx","src/components/SummaryPanel.tsx","src/components/ResultsTable.tsx"]
---

## Scope and mode

- Primary surface: `src/App.tsx`
- Mode: Operate
- Scope: complete desktop analysis workspace for the Tauri application

## Audience, job, and constraints

Laboratory researchers import local CSV/XLS/XLSX measurements, select signal/time columns, tune preprocessing and plateau/peak detection, review the linked chart/statistics/table, and export reproducible results. Windows 10/11 is primary; the UI remains buildable across desktop platforms. Preserve all incumbent analysis defaults and rules. Use Simplified Chinese. No decorative droplet or process-navigation sidebar; the existing logo may appear only as a compact brand mark.

## Approved direction

Modern scientific dashboard, three-pane composition C. Approved comp: `.impeccable/mocks/dashboard-c-three-pane.png`.

The memorable moment is the simultaneous correspondence between parameter controls, the dominant signal plot, the right-hand detected-feature ledger, and the complete result table. The chart remains the visual and operational center.

## Implementation inventory

| Visible ingredient | Composition commitment | Medium |
| --- | --- | --- |
| Application bar | Compact logo/name, file state, two analysis modes, file and run actions | Semantic HTML/CSS + existing `asset/LOGO.svg` + Lucide icons |
| Left parameter workspace | Plain functional controls; file facts, preprocessing, mode-specific detection, refresh options; never navigation | Semantic form controls and disclosure groups |
| Central signal plot | Largest region; original/processed traces, threshold band, detected markers, zoom/pan/hover | High-DPI Canvas 2D with semantic toolbar and keyboard controls |
| Right review column | One statistics ledger, analysis state, warnings, first twelve detected features | Semantic HTML lists and description data |
| Bottom result dock | Full-width, dense, scrollable platform/peak table with export actions | Semantic HTML table with sticky headers |
| Column selection | Protected-focus step after a file is chosen | Accessible modal dialog using semantic form controls |
| Status and errors | Persistent status bar plus recoverable inline error banner | Semantic live region / alert |
| Icons | Consistent 16–18 px stroke system; labels remain visible | `lucide-react` |
| Responsive adaptation | Preserve chart dominance; below 1260 px move summary beneath chart; below 880 px stack regions | CSS grid/media queries |
| Motion | One short dialog arrival plus live analysis spinner/pulse; reduced-motion honored | CSS animation |

## Do not literalize

The mock's numbers, timestamps, file names, extra metrics, miniature charts, and validation claims are composition-only synthetic material. The shipped surface displays only values returned by the ported analysis engine. Do not copy mock controls that do not exist in the incumbent program.

## Unresolved decisions

None blocking. Real experimental datasets are not included in the repository, so parity verification uses deterministic unit fixtures and the incumbent tests.
