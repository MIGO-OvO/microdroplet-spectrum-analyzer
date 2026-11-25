# 微液滴光谱分析仪

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://v2.tauri.app/)
[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[English](README.md) · [下载 v0.1.4](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/releases/tag/v0.1.4)

面向微液滴光学测量的本地 Windows 分析工作台：导入信号、调整平滑、检测平台、放大复核并导出结果。
实验数据仅在本机处理，不上传云端。

## 安装

从 Release 下载 Windows x64 的 `-setup.exe`，安装语言默认为简体中文。
安装包**不包含、也不自动下载 WebView2 运行库**；电脑需要已安装 Microsoft Edge WebView2 Runtime。
缺少时请从 [Microsoft 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/)单独安装。

运行安装版无需 Python、Node.js 或 Rust。发布目标为 Windows 10/11 x64；安装包未进行代码签名，
可能受到单位安全策略限制。

## 功能

- 读取 CSV、XLS、XLSX；第一行为表头，Excel 使用第一个工作表。
- 选择信号列和可选的数值时间列；无效行成对跳过，时间列须非递减。
- 对称去尖峰、Savitzky–Golay 平滑及手动基线修正；电平测量取自原始信号。
- **双平台检测**：手动高低幅度窗口 → 高低平台关联 → 局部低基线插值 → 每个高平台的校正信号 Δ。默认平滑窗口 51、最小稳定长度 150 点、最长不限。
- 在图中上下拖动四条幅度边界线或标签，松开后同步参数；方向键微调、Shift 加速，Esc 取消拖动。
- 旧检测算法与模式入口已移除；旧数据文件、历史记录和工作曲线仍可读取。历史参数重新分析时使用双平台算法，原记录响应保持原样。
- 滚轮缩放、拖动平移；调整平滑参数或过滤方式保留缩放，换文件或主动重置恢复全图。
- 放大局部时从 Rust 获取细节；全局预览保留原始及处理后信号的极值。
- 后台分析，调参停止 350 ms 后自动更新，只保留最新待执行请求。
- 结果表每页 100 项，Excel 导出始终包含全部检测结果；图表可导出 PNG/SVG。
- 导出处理后波形 CSV：逐点保存本次分析范围内的原始信号与处理信号，保留原始时间或序号，不抽样。
- 统计高平台平均长度、长度标准差和长度 RSD，概览、处理历史与 Excel 使用同一分析结果。
- 自定义标题栏，支持拖动、最小化、最大化／还原及关闭。
- 功能侧栏切换数据处理、工作曲线与历史记录；处理后的文件可按用户输入浓度加入标定点。
- 工作曲线支持本地草稿记忆、保存/编辑、JSON 备份与导入、OLS/WLS 线性回归及诊断指标。
- 调用已保存方程反算未知浓度；导出工作曲线/残差 PNG、SVG，以及 Origin 可用 CSV 和 Excel。
- 浓度反算不要求曲线与数据使用同一分析模式：任意已保存曲线都可代入当前响应，响应定义不同时并列标注
  并提示“仅作快速参考”，不再拒绝计算。
- 新增**处理历史**标签页：每个分析过的数据文件自动留一条记录（时间、文件、模式、响应、检测数、参数），
  数据来源与备注可自定义；选择已保存工作曲线后直接显示每条记录的浓度，支持重新载入、复用参数与含浓度的 CSV 导出，本机最多保留 300 条。
  详见[处理历史说明](docs/history.md)。
- 发布版为纯图形程序：Windows 下启动不再弹出控制台窗口；仅 `npm run tauri dev` 保留终端用于开发日志。

详见[工作曲线使用说明、指标定义与边界](docs/calibration.md)。

## 液滴双电平分析

双平台检测按用户设置的幅度区间寻找连续高、低平台，计算每个高平台相对相邻低平台基线的校正信号。

```text
原始信号 ─┬─ 对称去尖峰（Hampel）→ Savitzky–Golay → 检测信号
          │        └─ 高低幅度区间内连续点检测 + 长度筛选
          └─ 原始区段内部 → 中位数／MAD → 稳健均值        （物理测量值）

  高低区段 → Platform／Bottom
           → 高平台与相邻低平台关联 → 在高平台中心插值低基线
           → 校正信号  ΔSignal = highLevel − baselineReference
```

- **检测与测量分离**：平滑只决定“状态在哪里”，`level`、`standardDeviation`、`mad`、`correctedSignal` 全部在
  **原始信号**上测量；平滑仍会影响检测边界及进入测量的采样点。
- **局部低基线**：`baselineReference` 在高平台中心对左右低平台电平线性插值；正确边界和代表性电平下可抵消线性漂移，不能保证消除非线性漂移。
- **单侧参考可用但有标记**：高平台缺一侧低平台时，默认仍输出结果，但带 `singleSidedReference` 且规则评分更低；
  可在参数中关闭单侧参考。
- **参考不足时提示**：幅度区间内没有可配对的高低平台时，显示提示，供用户调整区间和长度参数。
- **质量标记可机读**：`qualityFlags` 为枚举列表（`lowClassificationConfidence`、`singleSidedReference`、
  `largeReferenceGap`、`noisyBottom`、`noisyPlatform`、`nearbyUnknownSegment`、`indexTimeFallback`），
  在结果表、图表提示与 Excel 导出中一致呈现。
- **判定证据可见**：API 与 Excel 第二个工作表提供逐段证据（类型、原始信号电平、长度、MAD、斜率、置信度）。

图表与结果表用 H/L/U 标识高平台、低平台和未分类段；点击编号可复核实际低基线来源。“全部检测区段”包含未形成测量和未使用的区段。规则评分不是准确率，手动窗口的区段初始分数 1 只表示命中规则。

旧版在低平台中心计算的 Δ 与新版定义不同：旧工作曲线仍可读取并可代入反算，但会明确标注响应定义不同、
结果仅作快速参考；它不能与新版 `highMinusLowBaselineV1` 响应混入同一条曲线，建立曲线前请重新分析标准样品。

幅度上下限可直接输入或在图中拖动。加载新文件时保留当前检测参数，仅清除分析横坐标范围。

## 使用方法与边界

1. 点击“加载数据”，选择信号列及可选时间列。
2. 设置高低幅度区间，按需限定分析横坐标范围。
3. 按实验特征调整平滑和最小稳定长度；“高级参数”中的最长稳定长度为 0 时不限。
4. 放大观察单独平台或液滴；液滴模式下悬停可查看该液滴的参考构造。参数更新后视图保持不变。
5. 待结果同步后导出波形 CSV、Excel 或图表；历史记录可选择工作曲线查看浓度。

基线不明显、占空比极高、基线漂移及非平顶信号需要结合原始波形复核。
超过一百万有效点时，初次分析后默认关闭自动刷新。

分析与波形 CSV 使用全分辨率数据；CSV 列为 `time`（或 `sample_index`）、`original_signal`、`processed_signal`，包含两端的分析范围在预处理前截取。
图表导出采用本次分析范围的有界抽样。Excel 包含检测结果、稳定区段、平台长度统计与处理参数；Excel 导入需在内存中解码工作簿。

液滴双电平分析的已知边界：稳定区段边界由平滑窗口决定，因此在电平切换处会比真实切换点略窄（对称的一小段），
对很短的液滴会让中心位置偏移数个采样点；幅度窗口和长度参数会影响检测结果；数据没有时间列或时间列无法表达
区间时改用序号插值并标记 `indexTimeFallback`。

## 采样库与卫星地图

1. 加载 ROS Web 的“高频原始分光 CSV”。分析器按列识别样本名称、采样时间和 WGS84 经纬度。一个文件有多个窗口时，可以选取窗口分析，随后点击“切换样本”。
2. 分析完成后点击“保存采样数据”。可选择工作曲线反算浓度、手动录入浓度，或先保存采样和分析结果。采样记录保存在应用数据目录的 `samples.sqlite3`，通过“采样地图”里的采样库查看。保留原 CSV 可以用记录中的参数重新分析。
3. 对带坐标的记录点击“上图”。在右侧切换实测点、IDW 浓度热力图和等浓度线。浓度面需要至少三个空间上分散、污染物及浓度单位与来源一致的实测点。

桌面端直接加载与 USV 地面站相同的 Google 卫星瓦片，无需密钥。已浏览的瓦片保存在本机，断网时仍可查看已缓存的影像和采样图层。

## 性能验证

2026-09-09 开发机 Release 构建，三列合成 CSV；非真实实验准确度测试，不包含界面和 IPC 开销。

| 50 万点操作 | 改动前 | 改动后 |
| --- | ---: | ---: |
| CSV 结构读取 | 283 ms | 39 ms |
| CSV 数据加载 | 398 ms | 60 ms |
| 削峰、平滑与检测 | 13 ms | 9 ms |
| 中值、平滑与检测 | 25 ms | 19 ms |
| 自动建议（削峰路径） | 47 ms | 25 ms |

基准覆盖 20 万和 50 万点。实际速度取决于硬件、数据格式和参数，以上数值不构成性能保证。

## 开发与打包

需要 Node.js 22.12+（或受支持的更高版本）、npm、稳定版 Rust、带 C++ 桌面开发组件的
Microsoft C++ Build Tools 及 WebView2。参阅 [Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)。

```powershell
npm ci
npm run tauri dev
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --manifest-path src-tauri/Cargo.toml --release --all-targets
cargo test --manifest-path src-tauri/Cargo.toml --release --lib -- --ignored --nocapture --test-threads=1
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run tauri -- build --bundles nsis
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`。
`npm run dev` 仅展示带明确标识的合成数据预览，桌面功能须运行 Tauri 应用。

## 项目结构

- `src/components/`：参数、Canvas 图表、标题栏、统计和分页结果表。
- `src/lib/`：桌面桥接、格式化、视口辅助函数及前端测试。
- `src-tauri/src/analyzer/`：`mod.rs`（双平台入口与缓存）、`preprocess.rs`（Savitzky–Golay）、
  `robust.rs`（稳健统计）、`droplet.rs`（双平台引擎）。
- `src-tauri/src/data.rs`：CSV 流式读取及 Excel 读取。
- `src-tauri/src/commands.rs`：后台命令及分析版本管理。
- `src-tauri/src/export.rs`：Excel、PNG、SVG 导出（含液滴专用工作表）。

## 反馈、贡献与许可证

请在 [GitHub Issues](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/issues)提供版本、
系统、数据量、参数及复现步骤；请勿上传未经授权的实验数据。代码贡献应附带回归测试。

使用 [MIT 许可证](LICENSE)，维护者为 [MIGO-OvO](https://github.com/MIGO-OvO)。
感谢 Tauri、React、Vite、Lucide、calamine、csv、rust_xlsxwriter 和 Plotters。
原 Python 实现保存在 Git 历史中。

## v0.1.4 更新

- 删除重复副标题、参数说明段落和表格操作说明，通过分组、控件标签和选中态表达功能。
- 平台与基线详情在选中区段后显示；缩放比例集中在图表工具栏。
- GitHub Actions 验证并构建 Windows 安装包，产物包含 SHA-256 校验文件。
- 详见 [v0.1.4 发布说明](docs/release-v0.1.4.md)。

### v0.1.3

- 默认使用手动高低幅度区间、平滑窗口 51、最小稳定长度 150 点、最长不限，移除自动稳定段分类和自动建议入口。
- 加载文件时保留检测参数；复用旧自动历史时清除自动生成的长度上限，原记录和工作曲线保留。
- 修复原因与验证见 [v0.1.3 发布说明](docs/release-v0.1.3.md)。

### v0.1.2

- 处理后波形逐点 CSV、历史记录工作曲线浓度计算，以及高平台长度的平均值、总体标准差和 RSD。
- 包含处理历史、图中拖动双平台幅度边界和统一双平台分析引擎；旧数据、历史参数与曲线保持可读。
- 用法与验证见 [v0.1.2 发布说明](docs/release-v0.1.2.md)。

### v0.1.1

- 新增“工作曲线”面板：标定点采集、草稿记忆、本地曲线库、JSON 备份与导入、OLS/WLS 回归及诊断指标、
  未知浓度反算，以及 Origin 可用的 CSV/Excel 与 PNG/SVG 导出。详见[工作曲线说明](docs/calibration.md)。
- 液滴双电平分析支持手动高低幅度区间，并可限定分析横坐标范围；范围在预处理前截取，
  坐标与数据点索引不重新编号。详见[手动双平台说明](docs/dual-platform-analysis.md)。
- 新增紧凑功能侧栏切换“数据处理／工作曲线”；结果表、图表与 Excel 导出增加本次分析参数。

### v0.1.0

发布 Rust/Tauri Windows NSIS 安装版；优化区间识别、大文件交互和缩放保持，
移除传统寻峰，加入自定义标题栏。
