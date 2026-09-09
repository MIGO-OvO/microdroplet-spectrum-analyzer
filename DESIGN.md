---
name: "Microdroplet Spectrum Analyzer"
description: "冷白工作面、石墨文字与科学蓝操作色构成的紧凑科研信号工作台。"
colors:
  surface-canvas: "#eef2f4"
  surface-panel: "#ffffff"
  surface-subtle: "#f6f8f9"
  ink: "#1e2a32"
  ink-secondary: "#53646f"
  ink-muted: "#60717b"
  line: "#d6dee3"
  line-strong: "#b9c5cc"
  blue: "#147d9a"
  blue-strong: "#0e6983"
  cyan: "#2bc4f7"
  green: "#24866a"
  amber: "#b67216"
  amber-surface: "#fff4df"
  chart-amber: "#d69027"
  red: "#bd4747"
  red-surface: "#fff0f0"
  signal-original: "#71848f"
  chart-grid: "#e4eaee"
typography:
  brand:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif"
    fontSize: "16px"
    fontWeight: 680
    letterSpacing: "-0.015em"
  metric:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif"
    fontSize: "17px"
    fontWeight: 650
  section-title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif"
    fontSize: "13px"
    fontWeight: 680
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  control:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif"
    fontSize: "12px"
    fontWeight: 620
    lineHeight: 1
  caption:
    fontFamily: "Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif"
    fontSize: "10px"
    fontWeight: 400
  axis:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  field: "4px"
  control: "5px"
  compact: "6px"
  panel: "7px"
  dialog: "10px"
  pill: "999px"
spacing:
  micro: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  panel: "14px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.surface-panel}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.blue-strong}"
    textColor: "{colors.surface-panel}"
  button-secondary:
    backgroundColor: "{colors.surface-panel}"
    textColor: "#33434d"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "36px"
  button-quiet:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 13px"
    height: "36px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    size: "32px"
  mode-switch:
    backgroundColor: "{colors.surface-subtle}"
    rounded: "{rounded.compact}"
    padding: "3px"
  mode-option-active:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.blue-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    height: "31px"
  number-input:
    backgroundColor: "{colors.surface-panel}"
    textColor: "#20303a"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "4px 7px"
    height: "31px"
  toggle-switch:
    backgroundColor: "#cbd4d9"
    rounded: "{rounded.pill}"
    width: "32px"
    height: "18px"
  container-panel:
    backgroundColor: "{colors.surface-panel}"
    rounded: "{rounded.panel}"
  metric-ledger:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.ink}"
    padding: "9px"
  results-table:
    backgroundColor: "{colors.surface-panel}"
    textColor: "#34454f"
    typography: "{typography.axis}"
  column-dialog:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.dialog}"
    width: "min(480px, 100%)"
---

# Design System: Microdroplet Spectrum Analyzer

## Overview

**Creative North Star: "冷白信号工作台"**

“冷白信号工作台”把界面当作精密仪器的操作面，而不是品牌海报：冷白工作面、石墨文字、细线框和少量科学蓝共同建立克制、可信、可长时间工作的氛围。信息密度紧凑，但每个区域依靠边界、表头和数值层级保持可扫描。

系统服务于同屏复核：左侧参数、中央主图、右侧统计与检测台账、底部结果表来自同一次分析。蓝色负责操作与处理后信号，青色只留在紧凑液滴标志中，琥珀标记阈值与待更新状态，绿色确认检测和同步；状态始终同时用文字或图标表达。

系统明确拒绝装饰性的液滴或工序导航侧栏，也不把品牌图形扩展为背景纹样；液滴 Logo 仅作为顶部命令栏中的紧凑品牌标志。

**Key Characteristics:**

- 冷白平面与石墨信息层级
- 科学蓝主操作、青色品牌点、琥珀阈值、绿色确认
- 细而清晰的边框与低半径几何
- 参数、主图、统计和结果表的紧凑同屏复核
- 状态不只依赖颜色，并尊重减少动态效果

## Colors

色彩以冷白与蓝灰中性色承载长时间科研操作，只让高辨识度色彩承担操作、信号和状态语义。

### Primary

- **科学蓝** (`blue`)：主操作按钮、处理后信号、开关选中态、区块图标和运行状态。
- **深科学蓝** (`blue-strong`)：主操作悬停态、已选分析模式、结果编号和交互强调。

### Secondary

- **液滴青** (`cyan`)：来自既有液滴与波形 Logo，仅作为顶部品牌标志中的明亮识别点，不扩散为大面积界面底色。

### Tertiary

- **结果绿** (`green`)：已检测标记、同步完成和本地就绪状态；必须与图标或文字配对。
- **状态琥珀** (`amber`)：待更新状态和检测范围图例；浅琥珀面 (`amber-surface`) 只为范围提供低对比铺底。
- **图表琥珀** (`chart-amber`)：Canvas 阈值虚线与半透明检测带的精确绘图色。
- **故障红** (`red`)：状态栏错误点；浅故障面 (`red-surface`) 承载可恢复错误横幅和字段冲突。

### Neutral

- **冷白画布** (`surface-canvas`)：应用壳背景，在白色工作面之间形成窄分隔。
- **仪器白面** (`surface-panel`)：命令栏、面板、图表、输入框与弹窗的主要工作面。
- **轻冷白面** (`surface-subtle`)：弱按钮、图表帮助栏和分组底色。
- **石墨正文** (`ink`)：品牌名、区块标题和关键读数。
- **次级石墨** (`ink-secondary`)：普通说明、按钮和表格正文。
- **静音石墨** (`ink-muted`)：元数据、辅助标签和空状态说明。
- **细分隔线** (`line`)：组内边界、表格分隔和工具栏分界。
- **结构边框** (`line-strong`)：面板外框、应用栏与状态栏边界。
- **原始信号灰蓝** (`signal-original`)：在主图中让原始信号退后于科学蓝处理信号。
- **图表网格冷灰** (`chart-grid`)：Canvas 网格，只提供定位而不争夺数据注意力。

### Named Rules

**The One Operational Blue Rule.** 科学蓝是唯一的操作强调色；青色只属于紧凑 Logo，不能与主按钮竞争。

**The Semantic Pairing Rule.** 绿色、琥珀和红色永远与文字、图标、线型或区域形状共同表达状态，不单独依赖色相。

## Typography

**Display Font:** 不使用展示字体；该操作界面刻意避免海报式大标题。
**Body Font:** Segoe UI Variable Text，依次回退到 Segoe UI、Microsoft YaHei UI、PingFang SC 和 sans-serif。
**Label/Mono Font:** 坐标轴使用 ui-monospace，依次回退到 SFMono-Regular、Consolas 和 monospace；其他数值使用正文栈配合等宽数字。

**Character:** 字体体系像 Windows 科学仪器软件一样清晰、直接、熟悉。层级集中在 10–17px，并用字重、冷灰层级和等宽数字区分证据，而不是依赖夸张字号。

### Hierarchy

- **Metric**（650，17px）：统计概览中的主要读数，是界面最大的持续数据字体。
- **Brand**（680，16px，字距 -0.015em）：顶部中文产品名；英文副标题降到 10px。
- **Section Title**（680，13px，字距 -0.01em）：面板、主图、统计和结果表标题。
- **Body / Control**（400–620，12px）：参数标签、说明、字段、按钮和状态正文；按钮行高为 1。
- **Caption**（400–650，10–11px）：图例、文件元数据、提示、徽章和台账次级信息。
- **Axis**（400，11px）：Canvas 坐标刻度，使用等宽字体栈以稳定数字宽度。

### Named Rules

**The Compact Evidence Rule.** 持续界面层级保持在 10–17px；不引入展示级标题来挤压信号和结果空间。

**The Tabular Evidence Rule.** 测量值、点数、统计量和表格单元格使用 `font-variant-numeric: tabular-nums`；Canvas 刻度使用 11px 等宽字体。

## Layout

桌面壳为满高纵向布局。顶部命令栏最小高度为 62px，底部持久状态栏最小高度为 27px；中间区域使用 8px 外边距和 8px 间隙。工作区上层采用三列：左参数列 `minmax(246px, 0.76fr)`，中央主图 `minmax(500px, 2.65fr)`，右复核列 `minmax(230px, 0.72fr)`。下层结果表为 `minmax(178px, 25vh)`，上层工作区为 `minmax(390px, 1fr)`。

参数列是功能面板，不是导航。主图始终是最大区域；右栏只保留统计、状态和前十二项检测台账，完整证据落入底部可滚动表。标题栏、表头和面板内边距主要落在 8–16px，31–45px 的紧凑行高维持科研数据密度。

在 1050px 及以下，工作区改为 250px 参数列加弹性主图，统计栏移到两列下方并形成三段横排；在 880px 及以下，页面允许纵向滚动，主图固定为第一段 500px 高，参数与统计顺序堆叠，结果表高 330px。命令栏也重排，但文件状态、模式和操作仍全部可见。

**The Chart-Dominance Rule.** 任何响应式重排都先保留主图的检查空间，再移动统计栏或堆叠参数；不得用装饰区占用中央证据区。

**The Eight-Pixel Frame Rule.** 面板之间和工作区外缘都使用 8px 节奏，使四个证据区域看起来属于同一台仪器。

## Elevation & Depth

系统默认扁平，通过冷白面的明度差和 1px 边框建立结构。阴影只用于已选模式、主按钮、图表悬浮提示、开关滑块和模态层等确有层级或交互反馈的元素。

### Shadow Vocabulary

- **选中段** (`0 1px 3px rgba(24, 44, 56, 0.14)`)：让模式切换中的当前选项从浅底槽中轻微浮起。
- **主操作静止** (`0 2px 5px rgba(20, 89, 109, 0.22)`)：只用于科学蓝主按钮。
- **主操作悬停** (`0 3px 8px rgba(20, 89, 109, 0.26)`)：主按钮悬停时的短距离反馈。
- **开关滑块** (`0 1px 3px rgba(30, 48, 59, 0.28)`)：保持 12px 白色滑块在轨道上可辨。
- **数据提示** (`0 5px 14px rgba(35, 53, 64, 0.17)`)：Canvas 悬浮读数与信号线分离。
- **模态层** (`0 16px 44px rgba(17, 32, 42, 0.28)`)：只用于受保护的列选择弹窗。

### Named Rules

**The Flat-by-Default Rule.** 普通面板和表格不使用阴影；有明确层级、选择或悬停含义时才允许抬升。

## Shapes

形状语言是低半径、细描边、正交排列。输入框和分段选项使用 4px 圆角，按钮与图表工具使用 5px，紧凑容器使用 6px，主面板使用统一 7px，列选择弹窗使用 10px。999px 胶囊只用于开关轨道和微型徽章；圆形只用于检测点、状态点、编号和开关滑块。

面板采用 1px 结构边框，组内用 1px 细分隔线。表格继续使用直角网格，不把每一行包装成卡片；图表阈值以虚线和浅色带形成不同于实线信号的轮廓。

**The Instrument Geometry Rule.** 低半径矩形承载操作和数据，圆形只承载点状状态或定位标记。

## Components

### Application Bar

- **Composition:** 62px 最小高度的白色命令栏，依次容纳 38px Logo/双语品牌、可截断文件状态、双模式切换、加载与运行操作。
- **Brand:** 液滴 Logo 只在此处出现；不生成液滴导航项、流程节点或背景水印。
- **Priority:** “运行分析”是右上唯一科学蓝主操作；“加载数据”保持白底描边。

### Buttons

- **Shape:** 5px 圆角，常规最小高度 36px，水平内边距 13px；紧凑导出按钮为 30px 高、10px 水平内边距。
- **Primary:** 科学蓝底、白字、深科学蓝边框和低阴影；仅用于运行或确认载入等推进分析的动作。
- **Secondary / Quiet:** Secondary 为白底加结构边框；Quiet 为轻冷白底加细边框。两者悬停时转为冷白强调面、深科学蓝文字。
- **Hover / Focus:** 颜色、边框与阴影以 150ms `ease-out` 过渡；键盘焦点统一使用 2px `#1687a6` 外轮廓并偏移 2px。

### Mode Switch

- **Style:** 1px 细边框、6px 外圆角和 3px 内边距；两个 31px 高选项使用 4px 圆角。
- **State:** 未选项透明且为次级石墨，当前项为白底、深科学蓝字、650 字重和选中段阴影；`aria-pressed` 保留语义。

### Inputs & Switches

- **Fields:** 31px 最小高度、4px 圆角、白底、1px `#c7d1d7` 描边；数值输入右对齐并使用等宽数字。
- **Focus / Hover:** 悬停边框为 `#91a6b2`，焦点边框切换为科学蓝，同时保留全局焦点轮廓。
- **Toggle:** 32×18px 胶囊轨道与 12px 白色圆形滑块；选中轨道使用科学蓝，滑块平移 14px，过渡为 150ms `ease-out`。
- **Disabled:** 降至 0.62 不透明度并使用不可用光标；字段底色变为 `#f1f3f4`。

### Cards / Containers

- **Corner Style:** 工作面统一 7px 圆角，白底和 1px 结构边框。
- **Shadow Strategy:** 静止面板无阴影，依靠画布与边框分层。
- **Internal Padding:** 主要面板段使用 13–14px，工具栏与表格标题使用 5–14px 的紧凑组合。
- **Disclosure:** 参数分组使用 42px 最小高度摘要行和组内底部分隔线；展开箭头以 160ms `ease-out` 旋转 180°。

### Signal Chart

- **Role:** 中央视觉与操作中心；高 DPI Canvas 同时绘制原始灰蓝线、1.8px 科学蓝处理线、琥珀虚线/范围带和绿色检测点。
- **Frame:** 白底、冷灰网格、11px 等宽刻度；标题栏和帮助栏各用细分隔线封边。
- **Interaction:** 十字光标悬停读数，滚轮缩放、拖动平移、双击或按 0 重置，并提供可聚焦 Canvas 与可见工具按钮。
- **Markers:** 检测点为 4.5px 半径绿色圆点、2px 白描边；可选标签用 10px 半粗体和半透明白底。

### Statistics & Feature Ledger

- **Metrics:** 两列细线网格，每格 9px 内边距；10px 标签配科学蓝图标，17px/650 读数承担主层级。
- **States:** 处理中、待更新、已同步分别使用蓝、琥珀、绿，但始终附带图标和文字。
- **Ledger:** 每行最小高度 43px，圆形编号、主值、次级高度/长度和确认图标对齐；右栏只展示前十二项。

### Results Table

- **Density:** 表格最小宽度 780px，单元格高 31px、内边距 5px 12px、字号 11px，数值右对齐并使用等宽数字。
- **Header:** `#f2f5f6` 冷灰粘性表头，650 字重；行号居中且使用深科学蓝。
- **State:** 行悬停使用 `#f1f8fa`，空状态用图标和明确文字；横向滚动容器可通过键盘聚焦。

### Column Selection Dialog

- **Shape / Depth:** 宽度 `min(480px, 100%)`，10px 圆角、1px `#9facb4` 边框和模态层阴影；遮罩为 `rgba(24, 37, 45, 0.42)`。
- **Motion:** 遮罩 140ms `ease-out` 淡入，弹窗 180ms `cubic-bezier(0.16, 1, 0.3, 1)` 从 10px 下方轻微缩放进入。
- **Focus:** 打开后信号列获得焦点，Escape 和关闭按钮可退出；冲突错误使用浅红面、红色文字和明确说明。

## Do's and Don'ts

### Do:

- **Do** 保持参数、主图、统计台账和结果表来自同一次分析，并让主图占据最大连续区域。
- **Do** 使用白色工作面、1px 细边框、7px 面板圆角和 8px 面板间隙维持仪器般的结构。
- **Do** 将科学蓝用于主操作与处理后信号，将琥珀用于阈值/待更新，将绿色用于检测/同步确认。
- **Do** 为所有状态颜色同时提供文字、图标、线型或区域形状，并保留清晰的 `:focus-visible` 轮廓。
- **Do** 在表格、统计和字段中保持紧凑行高与等宽数字，并让长文件名截断而不挤压操作。
- **Do** 尊重 `prefers-reduced-motion`，把所有动画和过渡压缩到近乎即时。

### Don't:

- **Don't** 添加装饰性的液滴或工序导航侧栏；参数面板始终是功能控制区，不是导航。
- **Don't** 把 Logo 放大为背景、水印、插画或重复图案；它只作为顶部命令栏中的 38px 品牌标志。
- **Don't** 用大面积青色、琥珀、绿色或红色装饰界面，也不要让状态只靠颜色传达。
- **Don't** 用卡片瀑布、厚阴影或大圆角拆散连续的数据关系；普通面板保持扁平和细边框。
- **Don't** 引入海报式大标题、营销文案或无数据依据的指标；Operate 界面优先真实参数、信号与结果。
- **Don't** 在窄屏先压缩主图；应按 1050px 和 880px 的已实现断点移动统计栏并堆叠区域。
