---
name: bazi-data-generator
description: 从八字排盘截图中提取并标准化报告所需结构化数据，按 输出数据结构输出YAML数据。用户提到"八字截图转数据""看图出八字yaml""截图转命盘结构化数据"时使用。
version: 2.0.0
tags:
  - bazi-analysis
  - bazi
  - Kimi师傅
---

# bazi-data-generator

从八字截图提取结构化 YAML 数据包。

## 核心输出约束（违反任何一条即为不合格）

1. **只输出 YAML**，用 ```yaml ... ``` 包裹，YAML 前后不加任何解释文字。
2. **YAML 的顶层 key 必须且只能是以下 13 个**：profile, pillars, cycleMeta, cycles, currentCycleYears, monthlyFlowRef, fiveElements, natalOverview, romanceWindows, actionCards, summaryTags, needsConfirm, assumptions。
3. **禁止自创任何顶层 key**（如 basicInfo, bazi, hiddenStems, tenGods, wuxing, earthlyBranchesRelations, dayun, liunian, specialStars, analysis, recommendations, meta 等一律禁止）。
4. 对不确定的字段填 null 并写入 needsConfirm。
5. 禁止脑补任何截图中看不到的信息。

## 分区抽取规则

- 顶部身份区：姓名、阴历、阳历、造（乾/坤）、当前年龄
- 左侧命盘区：流年/大运/年柱/月柱/日柱/时柱的主星、天干、地支、藏干
- 右侧运势区：起运、交运、大运行、流年行

## 字段标准化

- 十神简称：比/劫/食/伤/财/才/官/杀/印/枭
- 元素标签：木/火/土/金/水
- 年龄段格式：N-M岁

## 评分规则

基准分60，限幅[25, 100]。颜色映射：>=85 red, 70-84 gold, 55-69 green, 40-55 sauce, <=40 gray。按"现象+风险+建议动作"三段式写文案，禁用绝对化措辞，大运评分与流年评分：适当的提升下一步大运的评分，当某些大运不足85但接近85时，可以稍微向上调整到85。

## 输出数据结构（标准模板）

以下是每个顶层 key 的完整子结构定义。每个 key 只展示 1 条示例，实际输出时必须按注释要求覆盖全部数据。

```yaml
profile:
  name: "03"
  genderType: "乾造"
  lunar: "1995年正月十七 酉时"
  solar: "1995年2月16日 18:00"
  currentAge: "32岁"
  currentCycle: "乙亥"
  currentYearStemBranch: "丙午"

pillars:
  columns: ["日期", "流年", "大运", "年柱", "月柱", "日柱", "时柱"]
  mainStars: ["", "偏印", "正官", "正官", "比肩", "元男", "伤官"]
  stems: ["", "丙", "乙", "乙", "戊", "戊", "辛"]
  branches: ["", "午", "亥", "亥", "寅", "寅", "酉"]
  hiddenStems:
    - ""
    - "丁正印 / 己劫财"
    - "壬偏财 / 甲七杀"
    - "壬偏财 / 甲七杀"
    - "甲七杀 / 丙偏印 / 戊比肩"
    - "甲七杀 / 丙偏印 / 戊比肩"
    - "辛伤官"
  extraRows:
    - rowName: "星运"
      values: ["", "帝旺", "绝", "绝", "长生", "长生", "死"]
    - rowName: "自坐"
      values: ["", "帝旺", "死", "死", "长生", "长生", "临官"]
    - rowName: "空亡"
      values: ["", "寅卯", "申酉", "申酉", "申酉", "申酉", "子丑"]
    - rowName: "纳音"
      values: ["", "天河水", "山头火", "山头火", "城头土", "城头土", "石榴木"]
  shenSha:
    liuNian: ["太极贵人", "文昌贵人"]
    daYun: ["国印贵人", "劫煞"]
    year: ["国印贵人", "劫煞"]
    month: ["德秀贵人", "勾绞煞"]
    day: ["阴差阳错", "德秀贵人"]
    hour: ["月德合", "童子煞"]

cycleMeta:
  startFortune: "出生后4年0月11天12时起运"
  switchRule: "逢己、甲年 立春后23天 交大运"
  empty: "申酉空亡（日）"
  command: "丙"

# cycles: 必须覆盖截图中全部大运（通常8-10步），以下仅为单条结构示例
cycles:
  - startYear: 1995
    ageRange: "1-4岁"
    name: "小运"
    tags: "—"
    score: 58
    level: "green"
    theme: "早年定型"
    summary: "童年阶段木火气盛，性格较早显露独立与主见。"
    comment: "小运期间以家庭养育为主，整体偏稳。"
    strategy: "建立稳定作息与运动习惯。"
  # ... 继续输出截图中全部大运步骤（每步结构同上）

# currentCycleYears: 必须覆盖当前大运内全部流年（通常10年）
currentCycleYears:
  - year: 2019
    stemBranch: "己亥"
    score: 60
    level: "green"
    strategy: "劫财偏财并行，先稳住节奏再扩张。"
    comment: "进入新大运初期，宜观察和校准方向。"
  # ... 继续输出当前大运内全部流年（每年结构同上）

# monthlyFlowRef: 覆盖当前大运的年份参考月令（通常10条）
monthlyFlowRef:
  - "2019 立春2/4：庚寅（食 / 杀）"
  # ... 继续输出全部年份

# fiveElements: 必须包含金木水火土全部5个元素
fiveElements:
  - element: "水"
    role: "印星 · 喜用"
    note: "水能生扶乙木、化解火旺。"
  - element: "木"
    role: "比劫 · 喜用"
    note: "木可帮身担财官。"
  - element: "火"
    role: "食伤 · 忌神"
    note: "火炎泄木太过。"
  - element: "土"
    role: "财星 · 忌神"
    note: "土耗木气。"
  - element: "金"
    role: "官杀 · 忌神"
    note: "金克木身。"

natalOverview:
  text: "日主戊土坐寅，当前乙亥大运官才并行。"
  tags: ["戊土日主", "当前乙亥运", "2026高光窗口"]

# romanceWindows: 至少包含高峰年、机会年、沉淀年、注意年
romanceWindows:
  - label: "高峰年"
    title: "2026 丙午"
    description: "印星抬升，个人状态与吸引力同步增强。"
    strategy: "把握窗口但保持筛选。"
  # ... 继续输出机会年、沉淀年、注意年

actionCards:
  career: "当前大运强调责任与平台化成长。"
  finance: "财星流动性较强，关键在于留存率。"
  cooperation: "比劫年份要特别重视边界。"
  love: "关系机会在高分年更明显。"
  health: "高压年份注意睡眠、情绪和消化系统。"

summaryTags: ["戊土日主", "当前乙亥运", "2026高光窗口"]

needsConfirm:
  - "姓名：截图仅显示编号，如需真实姓名请告知。"

assumptions:
  - "按截图识别：乾造，年柱乙亥、月柱戊寅、日柱戊寅、时柱辛酉。"
```

## 质量校验清单（交付前自检）

1. 顶层 key 是否且仅是允许的 13 个。
2. cycles 数组是否覆盖全部大运（8-10步）。
3. currentCycleYears 是否覆盖当前大运全部流年（10年）。
4. fiveElements 是否包含金木水火土全部5个。
5. pillars 的 mainStars/stems/branches/hiddenStems 数组固定7项。
6. 分数与等级映射是否一致。
7. 所有不确定字段是否进入 needsConfirm。
