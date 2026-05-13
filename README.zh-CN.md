# Microdroplet Spectrum Analyzer

<p align="center">
  <img src="asset/LOGO.svg" alt="Microdroplet Spectrum Analyzer 项目 Logo" width="160">
</p>

<p align="center">
  面向液滴光谱和微流控光学信号数据的桌面分析工具。
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![PySide6](https://img.shields.io/badge/UI-PySide6-41CD52?logo=qt&logoColor=white)](https://doc.qt.io/qtforpython-6/)
[![NumPy](https://img.shields.io/badge/NumPy-013243?logo=numpy&logoColor=white)](https://numpy.org/)
[![Pandas](https://img.shields.io/badge/Pandas-150458?logo=pandas&logoColor=white)](https://pandas.pydata.org/)
[![SciPy](https://img.shields.io/badge/SciPy-8CAAE6?logo=scipy&logoColor=white)](https://scipy.org/)
[![Matplotlib](https://img.shields.io/badge/Matplotlib-11557C)](https://matplotlib.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 项目简介

Microdroplet Spectrum Analyzer 是一个轻量级 Python 桌面应用，用于导入、预处理、检测、复核和导出液滴光谱或信号测量数据。它适合需要快速检查微液滴光学信号、定位稳定平台区间、对比传统峰值特征，并导出可复查结果表格和图像的实验分析场景。

项目核心信号处理逻辑位于 `spectrum_signal_app/`。分析请求、参数和结果通过 dataclass 组织，界面层通过 PySide6 提供文件加载、参数控制、快速预览、后台分析和高质量图表导出。

## 功能特性

- 导入 `.csv`、`.xlsx` 和 `.xls` 文件，并选择信号列和可选时间列。
- 支持两种分析模式：基于阈值区间的平台检测，以及基于 `scipy.signal.find_peaks` 的传统寻峰。
- 预处理流程支持分位数削峰、中值滤波、Savitzky-Golay 平滑和手动基线修正。
- 可根据当前信号自动建议平台阈值和长度参数。
- 使用 `pyqtgraph` 提供大数据量下的快速交互预览。
- 使用 Matplotlib 生成适合导出的图表。
- 支持导出分析结果到 Excel，导出图表到 PNG 或 SVG。
- 通过防抖和后台线程保持界面响应。
- 对超大数据集自动关闭实时刷新，降低界面卡顿风险。
- 提供 Windows 无控制台启动脚本 `start.bat`。

## 项目状态

| 项目 | 当前状态 |
| --- | --- |
| 应用类型 | PySide6 桌面应用 |
| 主程序包 | `spectrum_signal_app` |
| 公开源码文件 | 10 个 Python 文件 |
| 输入格式 | `.csv`, `.xlsx`, `.xls` |
| 导出格式 | `.xlsx`, `.png`, `.svg` |
| 开源协议 | MIT |
| 仓库地址 | `https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer` |

## 快速开始

### 1. 克隆仓库

```powershell
git clone https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer.git
cd microdroplet-spectrum-analyzer
```

### 2. 创建并激活虚拟环境

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
```

如果 PowerShell 阻止激活脚本，可以在当前终端中执行：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

然后重新激活虚拟环境。

### 3. 安装依赖

```powershell
pip install -r requirements.txt
```

### 4. 启动应用

推荐使用包入口：

```powershell
python -m spectrum_signal_app
```

兼容启动方式：

```powershell
python main.py
```

Windows 无控制台启动：

```powershell
.\start.bat
```

## 基本使用流程

1. 加载 CSV 或 Excel 数据文件。
2. 选择信号列，并按需选择时间列。
3. 选择平台检测或传统寻峰模式。
4. 调整预处理和检测参数。
5. 在平台检测模式下，可使用自动参数建议作为初始配置。
6. 查看快速预览图、导出图、统计信息和结果表格。
7. 将结果表格导出为 Excel，或将图表导出为 PNG/SVG。

## 分析模型

分析器使用几个小型 dataclass 来描述一次分析任务：

| Dataclass | 作用 |
| --- | --- |
| `PreprocessParams` | 滤波模式、平滑窗口、削峰分位数和基线修正 |
| `PlateauParams` | 阈值范围、平台最小/最大长度和边缘偏离限制 |
| `PeakParams` | 峰高、峰间距和峰突出度参数 |
| `AnalysisRequest` | 一次完整分析请求 |
| `AnalysisResult` | 处理后信号、检测特征、统计结果、警告和缓存状态 |

## 项目结构

```text
microdroplet-spectrum-analyzer/
|-- asset/
|   `-- LOGO.svg                 # README 使用的项目 Logo
|-- spectrum_signal_app/
|   |-- __init__.py              # Matplotlib Qt 后端设置
|   |-- __main__.py              # 支持 python -m spectrum_signal_app
|   |-- app.py                   # QApplication 启动逻辑
|   |-- analyzer.py              # 信号预处理和特征检测
|   |-- canvas.py                # Matplotlib 画布封装
|   |-- config.py                # 默认参数和绘图样式常量
|   |-- dialogs.py               # 数据列和时间列选择对话框
|   `-- main_window.py           # PySide6 主界面
|-- config.py                    # 兼容旧导入路径的配置转发
|-- main.py                      # 兼容启动入口
|-- requirements.txt             # 运行依赖
|-- start.bat                    # Windows 无控制台启动入口
|-- start_hidden.vbs             # 使用 pythonw.exe 启动程序包
|-- LICENSE                      # MIT 协议
|-- README.md                    # 英文 README
`-- README.zh-CN.md              # 简体中文 README
```

## 质量检查

发布改动前可以先运行语法编译检查：

```powershell
python -m py_compile main.py config.py spectrum_signal_app\*.py
```

## 依赖

| 依赖 | 用途 |
| --- | --- |
| PySide6 | Qt 桌面界面 |
| pyqtgraph | 快速交互式信号预览 |
| Matplotlib | 高质量图表导出 |
| NumPy | 数组和向量化数值计算 |
| Pandas | CSV/Excel 读取和 Excel 导出 |
| SciPy | 信号滤波和寻峰 |

## 问题反馈

如果发现 bug、界面行为不清晰，或某类分析结果不符合预期，请在这里提交 issue：

[GitHub Issues](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/issues)

反馈时建议包含输入文件格式、选择的数据列、分析模式、参数设置，以及能帮助说明问题的截图。

## 开源协议

本项目基于 [MIT License](LICENSE) 开源。

## 致谢

本项目使用了以下开源项目：

- [Python](https://www.python.org/) 作为应用运行时。
- [Qt for Python / PySide6](https://doc.qt.io/qtforpython-6/) 构建桌面界面。
- [NumPy](https://numpy.org/)、[Pandas](https://pandas.pydata.org/) 和 [SciPy](https://scipy.org/) 处理数据和信号。
- [pyqtgraph](https://www.pyqtgraph.org/) 提供大规模信号的快速预览。
- [Matplotlib](https://matplotlib.org/) 生成适合发布和导出的图表。
