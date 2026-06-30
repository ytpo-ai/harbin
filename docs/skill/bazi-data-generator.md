---
name: bazi-data-generator
description: 将 base-yaml（basicInfoYaml）统一派生为 data-yaml（报告就绪 YAML）。用户提到“base-yaml转data-yaml”“基础yaml生成数据yaml”“从basicInfoYaml派生报告数据”时使用。
version: 3.0.0
---

# bazi-data-generator

将已确认的 `base-yaml` 转换为可用于报告渲染的 `data-yaml`。

## 适用场景

- 管理台已沉淀 `basicInfoYaml`，需要生成一份或多份数据 YAML。
- 需要统一走 `base-yaml -> data-yaml` 单一链路，避免多源写入。
- 需要复用同一份基础数据进行模板渲染或多次迭代。

## 输出边界（强制）

本 skill 只执行一件事：

1. 基于 `base-yaml` 生成 `data-yaml`。

禁止在本 skill 中做以下事情：

- 截图识别或 OCR 分析。
- 直接处理图片输入。
- 生成 HTML 报告页面。

## 输入要求

最少输入：

1. `base-yaml`（至少含 `profile/pillars/cycleMeta/cycles`）。

可选输入：

- `scoreMode`（`default` / `good_luck` / `tension`）。
- 追加的 `needsConfirm` / `assumptions`。

## 执行流程（严格顺序）

1. 校验 `base-yaml` 是否可解析，且包含必需顶层字段。
2. 复制基础字段：`profile`、`pillars`、`cycleMeta`、`cycles`。
3. 派生扩展字段：`currentCycleYears`、`actionCards`、`summary`。
4. 合并可选字段：`needsConfirm`、`assumptions`（如传入）。
5. 按 `scoreMode` 调整分数口径（未传则使用系统默认）。
6. 输出 `data-yaml` 并返回落盘路径或创建结果。

## 输出要求

- 必须明确返回：`data-yaml` 内容（或记录 ID / 路径）。
- 必须说明该结果来源于哪份 `base-yaml`。
- 若字段缺失，必须报错并指出缺失项，不可静默兜底为无效结构。

## 输出数据结构（渲染模板）

渲染器严格按此结构读取，字段名或类型不匹配会导致报告空白。

```yaml
profile:
  name: ""
  genderType: ""           # 乾造/坤造
  lunar: ""
  solar: ""
  currentAge: ""
  currentCycle: ""
  currentYearStemBranch: ""

pillars:
  columns: []
  mainStars: []
  stems: []
  branches: []
  hiddenStems: []
  extraRows: []

cycleMeta:
  startFortune: ""
  switchRule: ""

cycles:                    # 在 base-yaml 基础上每项补充以下字段
  - startYear: 2025
    ageRange: ""
    name: ""
    tags: ""
    score: 0               # 0-100 整数
    level: ""               # red/gold/green/sauce/gray
    theme: ""
    summary: ""
    comment: ""
    strategy: ""

currentCycleYears:
  - year: 2026
    stemBranch: ""
    score: 0               # 0-100 整数
    level: ""               # red/gold/green/sauce/gray
    strategy: ""
    comment: ""             # 可选

fiveElements:              # 必须 5 项覆盖金木水火土
  - element: ""            # 金/木/水/火/土
    role: ""               # 如"印星 · 喜用""财星 · 忌神"
    note: ""               # 说明文字

natalOverview:
  text: ""                 # 命局总览（必须有 text）

romanceWindows:            # 至少 3 项
  - label: ""              # 分类标签（如"高峰年""机会年"）
    title: ""
    description: ""

actionCards:               # 对象，固定 5 个 key，不可用数组
  career: ""
  finance: ""
  cooperation: ""
  love: ""
  health: ""

summary:
  overview: ""             # 总结文字（必须有 overview）

summaryTags: []
needsConfirm: []
assumptions: []
```

## 质量校验清单

1. `data-yaml` 可被 `js-yaml` 正常解析。
2. 顶层包含模板中全部字段。
3. `actionCards` 为对象（5 个固定 key），不可为数组。
4. `fiveElements` 每项含 `element/role/note`，不可用 `description` 替代。
5. `natalOverview` 含 `text`，不可省略。
6. `romanceWindows` 每项含 `label/title/description`。
7. `summary` 含 `overview`，不可仅用 `conclusion`。
8. 所有派生字段与输入 `base-yaml` 保持一致口径。

## 与其他 skill 的协作

- 截图字段提取由 `bazi-screenshot-parser` 或其他截图专用 skill 负责。
- HTML 报告生成由 `bazi-report-generator` 负责。
- 本 skill 仅负责 `base-yaml -> data-yaml` 转换。
