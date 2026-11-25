# Microdroplet Spectrum Analyzer

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://v2.tauri.app/)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-2024-000000?logo=rust)](https://www.rust-lang.org/)
[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[简体中文](README.zh-CN.md) · [Download v0.1.4](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/releases/tag/v0.1.4)

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
- Symmetric despiking, Savitzky–Golay smoothing and manual baseline subtraction for detection.
- **Dual-state droplet analysis** (液滴双电平分析): manual high/low amplitude windows,
  pairing of every high Platform with neighbouring low Bottoms, local baseline interpolation, and a corrected ΔSignal per high segment.
- Manual high/low amplitude windows: drag any of the four boundary lines or labels to adjust a limit;
  release to apply, use arrow keys for fine adjustment, or press Escape to cancel a drag.
- Defaults: smoothing window 51, minimum segment length 150 samples, and no maximum length limit.
- Wheel/keyboard zoom and drag-to-pan. Adjusting preprocessing preserves both zoomed axes; a new file resets the view.
- Local zoom requests detailed data from Rust rather than magnifying a fixed global preview.
  Original and processed extrema are preserved in the preview envelope.
- Background analysis with 350 ms debounce, latest-pending-request coalescing, and preprocessing reuse.
- A paginated result table (100 rows/page); Excel export always includes all detected results.
- PNG/SVG export of the complete analysis, independent of the interactive viewport.
- Full-resolution waveform CSV with original and processed signals for the selected analysis range, retaining the source time or sample indices.
- Mean high-platform length, population standard deviation and length RSD in the summary, history records and Excel export.
- A calibration tab with weighted linear regression, and a mode-agnostic concentration read-out: any saved
  curve can be applied to any finished result. When the curve and the sample follow different response
  definitions the value is still computed and labelled as a quick reference instead of being refused.
- A local **processing history** tab: one record per analysed dataset (time, file, mode, response, counts,
  parameters) with an operator-editable data-source label and note, reload, parameter reuse, CSV export,
  and a 300-record local bound. Select a saved working curve to show concentrations directly in the table and CSV. See [docs/history.md](docs/history.md).
- Custom title bar with minimize, maximize/restore, drag, and close controls.
- Release builds are GUI-only: no console window is opened on Windows. Only `npm run tauri dev` keeps a
  terminal for developer logs.

## Dual-platform analysis

**液滴双电平分析 (Dual-state droplet analysis)** supports explicit, non-overlapping high/low amplitude windows
on the processed signal. An optional inclusive x range is applied
before preprocessing; displayed/exported measurements retain the original coordinates. See the
[manual dual-platform guide](docs/dual-platform-analysis.md). The pipeline is:

```text
raw signal ─┬─ symmetric despike (Hampel) → Savitzky–Golay → detection signal
            │        └─ consecutive samples in high/low bands + length filtering
            └─ raw interior → median/MAD → robust mean          (the physical level)

  high/low regions → Platform/Bottom
                 → high Platform ↔ neighbouring low Bottom pairing → local interpolation
                 → corrected signal  ΔSignal = highLevel − baselineReference
```

Key properties, all covered by Rust regression tests:

- **Detection and measurement are decoupled.** Smoothing decides *where* a state is; every reported number
  (`level`, `standardDeviation`, `mad`, `correctedSignal`) uses the **raw** signal. Smoothing can still affect
  detected boundaries and the samples included in a measurement.
- **The low baseline is local, not global.** `baselineReference` interpolates neighbouring low levels at
  the high segment's center. Linear drift cancellation assumes representative levels and correctly located centers;
  nonlinear drift requires experimental validation.
- **One-sided references are allowed but marked.** Boundary high segments may have only one low neighbour; these
  results are still produced (unless disabled) but carry `singleSidedReference` and score lower confidence.
- **Missing references produce a warning.** When the selected bands yield no pairable high/low platforms,
  the run asks the user to review the amplitude and length settings.
- **Quality flags are machine-readable.** `DropletMeasurement.qualityFlags` is a list of enum values
  (`lowClassificationConfidence`, `singleSidedReference`, `largeReferenceGap`, `noisyBottom`, `noisyPlatform`,
  `nearbyUnknownSegment`, `indexTimeFallback`), shown in the table, the chart tooltip, and the Excel export.
- The per-segment evidence (`stableSegments`: kind, level, length, MAD, slope, confidence) ships in the API and in
  a second Excel worksheet so a reviewer can audit the classification instead of trusting it.

Chart/table IDs H/L/U identify high, low and unknown segments. Click an ID to inspect its exact references;
the all-segments view includes detected-but-unmeasured regions. Scores are heuristics, not accuracy probabilities.
Legacy low-centered Δ calibration curves remain readable and can still be substituted, but they carry an explicit
notice because the definition differs from `highMinusLowBaselineV1`; they cannot be mixed into a new curve with
the current definition, so reanalyze standards when building a curve.

Dual-platform detection is the only analysis engine. Legacy plateau parameters and saved calibration curves
remain readable; reloading an old history entry runs the current engine without changing the saved response.
Loading another file keeps detection settings and clears the analysis x range. Reusing an old automatic
history entry selects manual bands and removes its automatically suggested maximum length; saved records remain intact.

## Usage and limitations

1. Load a file and select its signal/time columns.
2. Set the high/low amplitude windows and optional analysis x range.
3. Adjust smoothing and detection parameters, or drag the chart's amplitude limits. If automatic refresh is disabled, choose **运行分析**.
4. Zoom into a feature, compare raw and processed values, and export after the result is synchronized.

High-duty-cycle signals without a discernible baseline, overlapping populations, drifting baselines, and
non-flat features may require manual thresholds and review of the raw waveform.
Above one million valid points, automatic refresh is disabled after the initial analysis.

Waveform CSV retains every selected sample in `time` (or `sample_index`), `original_signal`, and `processed_signal` columns.
Chart exports use a bounded rendering sample; Excel contains detected features, stable segments, length statistics and parameters.
All calculations use full-resolution data. Excel input still requires workbook decoding in memory.

Import a ROS raw spectrometer CSV to recognize sample windows and their WGS84 start positions. Enter coordinates manually during import or analysis to add or correct a position. Save the result to the local sampling database and add geolocated samples to the map. The desktop app uses the same keyless Google satellite tiles as USV GroundStation. [Sampling library and satellite map](README.zh-CN.md#采样库与卫星地图)

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
CSV alignment, and Excel/PNG/SVG export. The droplet engine additionally has regression tests for
constant-offset invariance, linear-drift cancellation, positive/negative spikes, clean steps without overshoot,
unbalanced segment widths, slow transitions, fragment merging, missing regions, one-sided boundaries, oversized
reference gaps, flat/noise-only records, non-uniform time axes, tiny and negative levels, cache reuse, and the
documented interpolation example.

## Repository structure

- `src/components/`: parameters, chart, title bar, summary, and paginated result table.
- `src/lib/`: Tauri bridge, formatting, viewport helpers, and frontend tests.
- `src-tauri/src/analyzer/`: `mod.rs` (dual-platform entry and cache), `preprocess.rs` (Savitzky–Golay),
  `robust.rs` (robust statistics), `droplet.rs` (dual-state engine).
- `src-tauri/src/data.rs`: streaming CSV and Excel input.
- `src-tauri/src/commands.rs`: background jobs and versioned analysis sessions.
- `src-tauri/src/export.rs`: Excel and chart export, including the droplet worksheets.
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

## v0.1.4

Removes repeated subtitles and persistent instructions from the analysis, calibration, history and column-selection views.
Controls, grouping and selection states explain the workflow; selecting a segment opens its baseline details.
GitHub Actions tests and builds the Windows installer with SHA-256 checksums. See [release notes](docs/release-v0.1.4.md).

### v0.1.3

Uses manual amplitude windows with smoothing 51, minimum length 150 and unlimited maximum length by default.
Removes automatic classification controls and stops file loading from overwriting detection settings.
See [release notes](docs/release-v0.1.3.md).

### v0.1.2

Adds full-resolution processed-waveform CSV, working-curve concentrations in processing history, and high-platform
length statistics. Includes the local history workspace, draggable high/low amplitude limits, and the unified dual-platform
engine while preserving saved responses and calibration definitions. See [release notes](docs/release-v0.1.2.md).

### v0.1.1

Adds the calibration (working curve) workspace and manual dual-platform analysis: explicit high/low amplitude
windows with an inclusive analysis x range, a functional sidebar, weighted linear regression with diagnostics,
concentration back-calculation, and Origin-ready CSV/Excel exports.
See [docs/calibration.md](docs/calibration.md) and [docs/dual-platform-analysis.md](docs/dual-platform-analysis.md).

### v0.1.0

First Windows NSIS release of the Rust/Tauri workspace: improved automatic intervals, large-file interaction,
persistent zoom, plateau-only analysis, and a custom title bar.
