# Microdroplet Spectrum Analyzer

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://v2.tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-2024-000000?logo=rust)](https://www.rust-lang.org/)
[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[简体中文](README.zh-CN.md) · [Download v0.1.0](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/releases/tag/v0.1.0)

## Overview

A local Windows workstation for inspecting microdroplet optical signals. Import a measurement, adjust preprocessing,
detect stable plateaus, inspect individual features, and export results without uploading experimental data.

## Getting started: installation

Download the Windows x64 `-setup.exe` from Releases. The NSIS installer uses Simplified Chinese.
It **does not bundle or download Microsoft Edge WebView2 Runtime**. WebView2 must already be installed;
otherwise install it separately from [Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
No Python, Node.js, or Rust installation is required to use the packaged app.

Windows 10/11 x64 is the release target. The installer is unsigned; organizational security policies may restrict it.

## Features

- CSV, XLS, and XLSX import; first row is the header and the first Excel worksheet is used.
- Select a signal column and optional nondecreasing numeric time column; invalid rows are skipped as aligned pairs.
- Percentile clipping or median filtering, followed by Savitzky–Golay smoothing and manual baseline subtraction.
- Plateau detection with amplitude, length, and refinement controls. Traditional peak finding has been removed.
- Automatic amplitude suggestions use robust noise estimates and interiors of sustained signal regions.
  Suggested amplitude bounds are rounded outward to **two significant digits**, not two decimal places.
- Wheel/keyboard zoom and drag-to-pan. Adjusting preprocessing preserves both zoomed axes; a new file resets the view.
- Local zoom requests detailed data from Rust rather than magnifying a fixed global preview.
  Original and processed extrema are preserved in the preview envelope.
- Background analysis with 350 ms debounce, latest-pending-request coalescing, and preprocessing reuse.
- A paginated result table (100 rows/page); Excel export always includes all detected results.
- PNG/SVG export of the complete analysis, independent of the interactive viewport.
- Custom title bar with minimize, maximize/restore, drag, and close controls.

## Usage and limitations

1. Load a file and select its signal/time columns.
2. Review the suggested amplitude interval; automatic suggestions are a starting point, not a validated scientific classifier.
3. Adjust smoothing and detection parameters. If automatic refresh is disabled, choose **运行分析**.
4. Zoom into a feature, compare raw and processed values, and export after the result is synchronized.

For sparse signals, the default 98th-percentile clipping can suppress real events: raise it toward 100% or use median
filtering. High-duty-cycle signals without a discernible baseline, overlapping populations, drifting baselines, and
non-flat features may require manual thresholds. No real experimental dataset or accuracy benchmark is included.
Above one million valid points, automatic refresh is disabled after the initial analysis.

Chart exports retain a bounded whole-file rendering sample; Excel exports contain detected features, not the raw signal.
All calculations use full-resolution data. Excel input still requires workbook decoding in memory.

## Measured scope

Release-mode synthetic fixtures on the development Windows machine, 2026-09-09; timings are illustrative, not guarantees.
They exclude file picker interaction, WebView rendering, and IPC serialization.

| 500,000-point operation | Before | After |
| --- | ---: | ---: |
| CSV inspection (3 columns) | 283 ms | 39 ms |
| CSV loading (3 columns) | 398 ms | 60 ms |
| Clipping + smoothing + detection | 13 ms | 9 ms |
| Median + smoothing + detection | 25 ms | 19 ms |
| Automatic suggestion, clipping path | 47 ms | 25 ms |

Reproduce measurements with the ignored Rust benchmarks below. Both 200,000 and 500,000 points are tested.

## Development

Prerequisites: Node.js 22.12+ (or a supported newer release), npm, stable Rust, Microsoft C++ Build Tools
with Desktop development with C++, and WebView2. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
git clone https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer.git
cd microdroplet-spectrum-analyzer
npm ci
npm run tauri dev
```

`npm run dev` provides a browser-only layout preview with labeled synthetic data.
Native import, analysis, window controls, and exports require the desktop app.

## Build and verify

```powershell
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --release --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --release --lib -- --ignored --nocapture --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri -- build --bundles nsis
```

Installer output: `src-tauri/target/release/bundle/nsis/`.
NSIS language and WebView2 exclusion are configured in `src-tauri/tauri.conf.json`.
Tests cover numerical preprocessing fixtures, suggestions, cache reuse, local detail and spike preservation,
CSV alignment, and Excel/PNG/SVG export.

## Repository structure

- `src/components/`: parameters, chart, title bar, summary, and paginated result table.
- `src/lib/`: Tauri bridge, formatting, viewport helpers, and frontend tests.
- `src-tauri/src/analyzer.rs`: preprocessing, detection, suggestions, and plot sampling.
- `src-tauri/src/data.rs`: streaming CSV and Excel input.
- `src-tauri/src/commands.rs`: background jobs and versioned analysis sessions.
- `src-tauri/src/export.rs`: Excel and chart export.
- `asset/`: existing application artwork.
- `PRODUCT.md`, `DESIGN.md`: product and interface context.

## Issues and contributing

Report defects or discuss contributions through [GitHub Issues](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/issues).
Include the app version, Windows version, input format/point count, parameters, and reproduction steps.
Share only anonymized or synthetic data you are authorized to publish. Contributions should include focused regression tests.

## License and acknowledgements

[MIT License](LICENSE). Maintained by [MIGO-OvO](https://github.com/MIGO-OvO); contact through repository Issues.
Built with Tauri, React, Vite, Lucide, calamine, csv, rust_xlsxwriter, and Plotters.
The prior Python application is preserved in Git history.

## v0.1.0

First Windows NSIS release of the Rust/Tauri workspace: improved automatic intervals, large-file interaction,
persistent zoom, plateau-only analysis, and a custom title bar.
