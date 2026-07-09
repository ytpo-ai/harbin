---
name: marriage-yaml-generator
description: 基于男女双方 data-yaml 生成合婚分析 YAML，满足后端合婚字段契约与校验规则。用户提到“合婚yaml生成”“双人八字合婚数据”“生成合婚结构化yaml”时使用。
version: 1.1.0
tags:
  - "taskType:marriage-compatibility-analysis:must"
---

# marriage-yaml-generator

用于将男女双方 `data-yaml` 汇总为可被后端校验通过的合婚 YAML。

## 职责边界

- 只生成合婚 YAML。
- 不生成 HTML。
- 不做截图 OCR。
- 不补写 `organizationId` 或任何组织字段。

## 输入要求

最少输入：

1. 男方 data-yaml（完整 YAML 字符串）
2. 女方 data-yaml（完整 YAML 字符串）
3. 合婚基础信息：`maleName`、`femaleName`

可选输入：

- `scoreMode`（default/good_luck/tension）
- 风险与建议扩展段（高亮、风险、修正项）

## 输出结构（必须）

```yaml
meta:
  scoreMode: default
  generatedAt: "2026-07-08T00:00:00.000Z"

pair:
  maleName: ""
  femaleName: ""

compatibilitySummary:
  score: 0
  trend: ""
  conclusion: ""

dimensionScores:
  communication: 0
  values: 0
  intimacy: 0
  family: 0
  finance: 0

guidance:
  shortTerm: ""
  longTerm: ""

marriageTimelines:
  favorableYears:
    - year: 2027
      stemBranch: "丁未"
      reason: "双方当年情感协同提升，适合推进婚期"
  cautionYears:
    - year: 2026
      stemBranch: "丙午"
      reason: "双方节奏冲突明显，建议先稳关系再定婚期"

# 以下为推荐字段（可选，但建议输出）
scoreBreakdown:
  base: 0
  riskAdjustment: 0
  final: 0

highlightAndRisk:
  highlights: []
  risks: []

riskFlags:
  - code: ""
    detail: ""
```

## 强校验规则

1. 顶层必须包含：`meta/pair/compatibilitySummary/dimensionScores/guidance/marriageTimelines`。
2. `compatibilitySummary.score` 与 `dimensionScores.*` 必须是 0-100 数值。
3. 所有必填字符串字段必须为非空字符串。
4. `meta.generatedAt` 必须为可读时间字符串（建议 ISO8601）。
5. `marriageTimelines` 必须包含 `favorableYears` 与 `cautionYears` 两个数组，且两者都不能为空。
6. `marriageTimelines.*[]` 每项必须包含：`year(number) / stemBranch(string) / reason(string)`。
7. 输出必须是纯 YAML，不得夹带解释文本。

## 生成流程

1. 读取男女双方 data-yaml 的核心结构（五行、阶段、评分与建议）。
2. 产出合婚总结分、五维分与短/长期建议。
3. 进行字段级自检（必填字段、类型、分值范围）。
4. 输出最终 YAML。

## 完成定义（DoD）

- YAML 可被 `js-yaml` 解析为对象。
- 必填字段完整、类型正确。
- 分值字段均在 0-100。
- 无 `organizationId` 字段。
