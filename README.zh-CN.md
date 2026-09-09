# 微液滴光谱分析仪

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri)](https://v2.tauri.app/)
[![MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[English](README.md) · [下载 v0.1.0](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/releases/tag/v0.1.0)

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
- 削峰／中值过滤、Savitzky–Golay 平滑及手动基线修正。
- 按幅度和长度检测平台；已移除传统寻峰。
- 自动区间根据稳健噪声估计及连续信号段内部幅度生成，上下限向外取整为 **2 位有效数字**。
- 滚轮缩放、拖动平移；调整平滑参数或过滤方式保留缩放，换文件或主动重置恢复全图。
- 放大局部时从 Rust 获取细节；全局预览保留原始及处理后信号的极值。
- 后台分析，调参停止 350 ms 后自动更新，只保留最新待执行请求。
- 结果表每页 100 项，Excel 导出始终包含全部检测结果；图表可导出 PNG/SVG。
- 自定义标题栏，支持拖动、最小化、最大化／还原及关闭。

## 使用方法与边界

1. 点击“加载数据”，选择信号列及可选时间列。
2. 检查自动建议的幅度上下限，再按实验特征调整平滑和检测参数。
3. 放大观察单独平台；参数更新后视图保持不变。关闭自动刷新时需点击“运行分析”。
4. 待结果同步后导出 Excel 或图表。

自动建议是启发式起点，不代表科学准确度验证。稀疏事件可能被默认 98% 削峰过滤掉，
可提高到 100% 或改用中值过滤。基线不明显、占空比极高、基线漂移及非平顶信号建议手动复核。
超过一百万有效点时，初次分析后默认关闭自动刷新。

分析使用全分辨率数据；图表导出采用有界的全文件抽样，不导出当前缩放视图。
Excel 导出的是检测结果而非原始信号。Excel 导入仍需在内存中解码工作簿。

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
- `src-tauri/src/analyzer.rs`：预处理、平台检测、自动建议和绘图抽样。
- `src-tauri/src/data.rs`：CSV 流式读取及 Excel 读取。
- `src-tauri/src/commands.rs`：后台命令及分析版本管理。
- `src-tauri/src/export.rs`：Excel、PNG、SVG 导出。

## 反馈、贡献与许可证

请在 [GitHub Issues](https://github.com/MIGO-OvO/microdroplet-spectrum-analyzer/issues)提供版本、
系统、数据量、参数及复现步骤；请勿上传未经授权的实验数据。代码贡献应附带回归测试。

使用 [MIT 许可证](LICENSE)，维护者为 [MIGO-OvO](https://github.com/MIGO-OvO)。
感谢 Tauri、React、Vite、Lucide、calamine、csv、rust_xlsxwriter 和 Plotters。
原 Python 实现保存在 Git 历史中。

## v0.1.0 更新

发布 Rust/Tauri Windows NSIS 安装版；优化区间识别、大文件交互和缩放保持，
移除传统寻峰，加入自定义标题栏。
