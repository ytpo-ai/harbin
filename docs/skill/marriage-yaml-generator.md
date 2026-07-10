---
name: marriage-yaml-generator
description: 基于男女双方 data-yaml 生成合婚分析 YAML，满足后端合婚字段契约与校验规则。用户提到“合婚yaml生成”“双人八字合婚数据”“生成合婚结构化yaml”时使用。
version: 1.2.0
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

summary:
  overview: ""

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
7. `summary.overview` 必须输出为自然语言分析（非模板化空话），且至少包含：
   - 共同优势如何强化（具体到行为，如沟通机制/家庭协同/财务分工）
   - 冲突元素如何降噪（具体到冲突处理动作，如冷静期/复盘节奏/边界规则）
8. 输出必须是纯 YAML，不得夹带解释文本。

## 文案生成要求（AI 必须参与）

`summary.overview` 不是固定文案拼接，必须基于男女双方 data-yaml 的实际内容进行 AI 推理生成：

1. 至少引用 2 个来自双方数据的事实依据（如当前大运阶段、五行喜忌交集、维度分数短板）。
2. 避免“存在互补空间”这类泛化语句单独出现，必须落地到可执行建议。
3. 语气保持专业、克制、可操作，不夸张承诺。
4. 建议长度 80-180 字，优先 2-3 句完整表述。
5. 如数据不足，明确指出“数据不足点 + 保守建议”，禁止输出空泛万能话术。

## 生成流程

1. 读取男女双方 data-yaml 的核心结构（五行、阶段、评分与建议）。
2. 产出合婚总结分、五维分与短/长期建议。
3. 基于双方结构化事实生成 `summary.overview`（AI 推理文案）。
4. 进行字段级自检（必填字段、类型、分值范围、overview 文案质量）。
5. 输出最终 YAML。

## 完成定义（DoD）

- YAML 可被 `js-yaml` 解析为对象。
- 必填字段完整、类型正确。
- 分值字段均在 0-100。
- `summary.overview` 非空，且包含“优势强化 + 冲突降噪”两类建议。
- 无 `organizationId` 字段。
