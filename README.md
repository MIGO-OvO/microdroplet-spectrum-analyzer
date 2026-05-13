# Microdroplet Spectrum Analyzer

> Recommended GitHub repository name: `microdroplet-spectrum-analyzer`

[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![PySide6](https://img.shields.io/badge/UI-PySide6-41CD52?logo=qt&logoColor=white)](https://doc.qt.io/qtforpython-6/)
[![NumPy](https://img.shields.io/badge/NumPy-013243?logo=numpy&logoColor=white)](https://numpy.org/)
[![Pandas](https://img.shields.io/badge/Pandas-150458?logo=pandas&logoColor=white)](https://pandas.pydata.org/)
[![SciPy](https://img.shields.io/badge/SciPy-8CAAE6?logo=scipy&logoColor=white)](https://scipy.org/)
[![Matplotlib](https://img.shields.io/badge/Matplotlib-11557C)](https://matplotlib.org/)
[![License](https://img.shields.io/badge/License-Not%20specified-lightgrey)](#license)

`Microdroplet Spectrum Analyzer` 是一个面向液滴微流控光谱数据的桌面分析工具。它提供中文图形界面，
用于导入 CSV、Excel 光谱/信号数据，完成平滑去噪、基线修正、平台区间检测、传统寻峰、统计汇总和结果导出。

项目当前是一个轻量级 Python 桌面应用，核心代码位于 `spectrum_signal_app/`。它适合需要快速检查液滴光谱信号、
批量定位稳定平台、对比峰值特征，并导出可复查结果表格和图像的实验分析场景。

## Features

- CSV、XLS、XLSX 数据导入，并支持选择信号列和可选时间列。
- 两种分析模式：平台检测（区间法）和传统寻峰模式。
- 预处理流程包含削峰分位数裁剪、中值滤波、Savitzky-Golay 平滑和手动基线校正。
- 平台检测支持幅度上下限、最小/最大长度、边缘偏离阈值，并输出平台中心、起止点、高度和长度。
- 寻峰模式基于 `scipy.signal.find_peaks`，支持最小峰高、最小间距和峰突性参数。
- 平台参数可根据当前信号自动建议，减少手动试参成本。
- 使用 `pyqtgraph` 做快速预览，使用 Matplotlib 生成可导出的高质量图表。
- 支持导出分析表格到 Excel，导出图表到 PNG 或 SVG。
- 对超过 1,000,000 点的大数据自动关闭实时刷新，避免界面卡顿。
- 提供 Windows 无控制台启动脚本：`start.bat` + `start_hidden.vbs`。

## Project Status

| Item | Status |
| --- | --- |
| Application type | PySide6 desktop application |
| Main package | `spectrum_signal_app` |
| Python version used locally | 3.11.9 |
| Python source files | 13 |
| Source and test lines | 1,292 |
| Test modules | 3 |
| Input formats | `.csv`, `.xlsx`, `.xls` |
| Export formats | `.xlsx`, `.png`, `.svg` |
| Git repository | Not initialized in the current directory |
| License file | Not present |

## Quick Start

### 1. Create a virtual environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

If PowerShell blocks activation scripts, run this in the same terminal session and activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### 2. Install dependencies

```powershell
pip install -r requirements.txt
```

### 3. Run the application

Recommended package entry point:

```powershell
python -m spectrum_signal_app
```

Compatibility entry point:

```powershell
python main.py
```

Windows no-console launcher:

```powershell
.\start.bat
```

`start.bat` delegates to `start_hidden.vbs`, which starts `.venv\Scripts\pythonw.exe -m spectrum_signal_app`
without opening a visible console window.

## Basic Workflow

1. Click `加载数据文件` and select a CSV or Excel file.
2. Choose the signal column, and optionally choose a time column.
3. Select `平台检测 (区间法)` or `传统寻峰模式`.
4. Adjust preprocessing parameters, or click `自动建议参数` in platform mode.
5. Review the fast preview chart and the analysis result table.
6. Export the result table as Excel, or export the chart as PNG/SVG.

## Analysis Model

The application separates analysis settings into dataclasses:

- `PreprocessParams`: filter mode, filter windows, smoothing order, clipping percentile, manual baseline.
- `PlateauParams`: threshold range, minimum/maximum plateau length, edge deviation threshold.
- `PeakParams`: minimum peak height, minimum peak distance, prominence.
- `AnalysisRequest`: a complete immutable request object for one analysis run.
- `AnalysisResult`: processed signal, detected features, statistics, and cached preprocessing state.

This structure keeps the signal-processing logic independent from the GUI and makes the analyzer easier to test.

## Data Handling

- Data files are read through Pandas.
- Selected signal values are coerced to numeric values.
- Rows with non-numeric signal values are dropped during file loading.
- If a time column is selected, rows are retained only when both time and signal are numeric.
- During preprocessing, non-finite signal values are interpolated and remaining missing values are filled with `0.0`.

## Repository Structure

```text
microdroplet-spectrum-analyzer/
|-- main.py                         # Compatibility launcher
|-- config.py                       # Compatibility re-export for package config
|-- requirements.txt                # Runtime dependencies
|-- start.bat                       # Windows no-console launcher entry
|-- start_hidden.vbs                # Starts pythonw.exe with the package entry point
|-- spectrum_signal_app/
|   |-- __init__.py                 # Matplotlib Qt backend setup
|   |-- __main__.py                 # Supports python -m spectrum_signal_app
|   |-- app.py                      # QApplication startup
|   |-- analyzer.py                 # Signal preprocessing and feature detection
|   |-- canvas.py                   # Matplotlib canvas wrapper
|   |-- config.py                   # Default parameters and plot style constants
|   |-- dialogs.py                  # Data/time column selection dialog
|   `-- main_window.py              # Main PySide6 interface
|-- tests/
|   |-- test_analyzer.py            # Signal loading, normalization, caching tests
|   |-- test_main_window.py         # GUI behavior and plotting tests
|   `-- test_start_script.py        # Windows launcher tests
`-- docs/
    `-- superpowers/plans/          # Local implementation planning notes
```

## Testing

Run the unit test suite:

```powershell
$env:QT_QPA_PLATFORM = "offscreen"
python -m unittest discover -s tests
```

Compile-check the application and tests:

```powershell
python -m py_compile main.py spectrum_signal_app\*.py tests\*.py
```

The GUI tests set `QT_QPA_PLATFORM=offscreen` internally, but setting it explicitly is useful for consistent
headless test runs.

## Dependencies

| Dependency | Purpose |
| --- | --- |
| PySide6 | Qt desktop user interface |
| pyqtgraph | Fast interactive signal preview |
| Matplotlib | Export-quality chart rendering |
| NumPy | Numeric arrays and vectorized operations |
| Pandas | CSV/Excel loading and Excel export |
| SciPy | Signal filtering and peak detection |

## Before Publishing to GitHub

Recommended English GitHub project name:

```text
microdroplet-spectrum-analyzer
```

Recommended display title:

```text
Microdroplet Spectrum Analyzer
```

Before the first public release, consider adding:

- `.gitignore` for `.venv/`, `__pycache__/`, `.idea/`, build outputs, and exported analysis files.
- `LICENSE` file. MIT is a common fit for open-source application code.
- `pyproject.toml` if you want installable package metadata or console scripts.
- A screenshot or short GIF showing the data loading, detection, and export flow.
- GitHub Actions workflow that runs `python -m unittest discover -s tests`.

## License

No license file is currently included. Until a license is added, the code has no explicit open-source license.
Add a `LICENSE` file before publishing if other people should be allowed to use, modify, or redistribute the project.

## Acknowledgements

This project builds on:

- [Python](https://www.python.org/) for the application runtime.
- [Qt for Python / PySide6](https://doc.qt.io/qtforpython-6/) for the desktop interface.
- [NumPy](https://numpy.org/), [Pandas](https://pandas.pydata.org/), and [SciPy](https://scipy.org/) for data and signal processing.
- [pyqtgraph](https://www.pyqtgraph.org/) for responsive plotting of large signal arrays.
- [Matplotlib](https://matplotlib.org/) for publication-friendly chart export.
