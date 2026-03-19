# Agent Skill 渐进式加载运行时设计

## 1. 背景

Skill 系统在多任务场景下容易出现两个问题：

- 全量注入技能导致上下文膨胀，增加 token 成本和响应抖动。
- 不按任务域隔离规则时，容易产生提示词污染和工具调用偏移。

本文给出一套可落地的运行时渐进式加载方案，覆盖 OpenCode、Codex、Claude Code 的通用流程，并提供可直接工程化的 Schema、路由器实现模板和可观测指标。

## 2. 跨平台统一流程

三类 Agent 的差异主要在触发封装，核心流程一致：

1. 基础上下文启动：仅加载系统提示、会话历史、当前任务。
2. 意图识别：判断是否需要特定 skill。
3. 候选检索：根据关键词、语义、文件信号召回候选 skill。
4. 懒加载注入：只加载命中的 skill 规则，而非全量加载。
5. 执行编排：按 skill 约束调用工具。
6. 结果校验：执行 lint/test/build 或业务验收规则。
7. 增量扩展：任务域变化时继续加载下一个 skill。

平台形态映射：

- OpenCode：显式调用 skill 加载（runtime lazy load）。
- Codex：任务路由后动态拼接工作流提示。
- Claude Code：核心代理 + 按需能力包注入。

## 3. 总体架构

- Skill Registry：技能注册中心（元数据、版本、依赖、入口）。
- Router：意图识别和候选打分。
- Loader：按需加载 skill 内容，支持缓存。
- Policy Engine：冲突处理、优先级、强制约束。
- Executor：工具执行。
- Verifier：验收校验。
- Telemetry：命中率、成本、成功率观测。

## 4. Skill 元数据 Schema

建议维护统一 schema，支持触发、约束、验证和缓存策略。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/skills.schema.json",
  "title": "Skill Registry Schema",
  "type": "object",
  "required": ["skills"],
  "additionalProperties": false,
  "properties": {
    "skills": {
      "type": "array",
      "items": { "$ref": "#/$defs/Skill" },
      "minItems": 1
    }
  },
  "$defs": {
    "PolicyLevel": {
      "type": "string",
      "enum": ["BLOCK", "REQUIRE", "PREFER"]
    },
    "LoadMode": {
      "type": "string",
      "enum": ["lazy", "eager"]
    },
    "Verification": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "commands": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        },
        "checks": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        }
      },
      "default": {}
    },
    "PolicyRule": {
      "type": "object",
      "additionalProperties": false,
      "required": ["id", "level", "text"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "level": { "$ref": "#/$defs/PolicyLevel" },
        "text": { "type": "string", "minLength": 1 }
      }
    },
    "Triggers": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "keywords": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        },
        "file_patterns": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        },
        "tool_signals": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        }
      },
      "default": {}
    },
    "Skill": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "version",
        "description",
        "entrypoint",
        "priority",
        "scope",
        "triggers"
      ],
      "properties": {
        "name": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9-]{1,63}$"
        },
        "version": {
          "type": "string",
          "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:[-+].*)?$"
        },
        "description": { "type": "string", "minLength": 1, "maxLength": 500 },
        "entrypoint": { "type": "string", "minLength": 1 },
        "load_mode": { "$ref": "#/$defs/LoadMode", "default": "lazy" },
        "priority": { "type": "integer", "minimum": 0, "maximum": 100 },
        "scope": {
          "type": "array",
          "minItems": 1,
          "items": { "type": "string", "minLength": 1 }
        },
        "dependencies": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        },
        "mutually_exclusive": {
          "type": "array",
          "items": { "type": "string", "minLength": 1 },
          "default": []
        },
        "triggers": { "$ref": "#/$defs/Triggers" },
        "constraints": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "must": {
              "type": "array",
              "items": { "$ref": "#/$defs/PolicyRule" },
              "default": []
            },
            "forbid": {
              "type": "array",
              "items": { "$ref": "#/$defs/PolicyRule" },
              "default": []
            }
          },
          "default": {}
        },
        "verification": { "$ref": "#/$defs/Verification" },
        "ttl_minutes": { "type": "integer", "minimum": 1, "maximum": 1440, "default": 60 }
      }
    }
  }
}
```

## 5. 触发与加载策略

### 5.1 触发优先级

1. 硬规则触发（安全、合规、危险操作）。
2. 用户显式指定 skill。
3. 任务主语义匹配。
4. 代码/文件信号匹配。
5. 会话历史偏好。

### 5.2 阈值建议

- `score >= 0.80`：自动加载。
- `0.60 <= score < 0.80`：延迟观察（执行少量工具后再判定）。
- `score < 0.60`：不加载。

### 5.3 分层注入

- L1：摘要层（触发词 + 核心规则），默认注入。
- L2：工作流层（步骤 + 工具顺序），需要时注入。
- L3：细节层（模板 + 边界案例），复杂任务注入。

## 6. 缓存与失效

- `skill-content-cache`：按 `name + version` 缓存解析后指令。
- `session-active-skills`：会话激活列表。
- TTL：常规 30-90 分钟，高风险技能缩短。

失效条件：

1. skill 版本变化。
2. 任务域切换（例如 frontend -> backend）。
3. 上下文压缩触发低优先级 skill 淘汰。

## 7. 冲突处理

统一决策顺序：

1. 系统安全规则
2. 项目仓库协议
3. 用户明确要求
4. skill 规则
5. 默认行为

规则等级：

- `BLOCK`：禁止。
- `REQUIRE`：必须。
- `PREFER`：优先。

同级冲突按 `priority`，再按规则更新时间处理。

## 8. Router 参考实现（TypeScript）

以下代码可直接作为 MVP 路由器模板（含打分、冲突处理、增量加载）。

```ts
type PolicyLevel = "BLOCK" | "REQUIRE" | "PREFER";

interface PolicyRule {
  id: string;
  level: PolicyLevel;
  text: string;
}

interface Skill {
  name: string;
  version: string;
  description: string;
  entrypoint: string;
  load_mode: "lazy" | "eager";
  priority: number;
  scope: string[];
  dependencies: string[];
  mutually_exclusive: string[];
  triggers: {
    keywords: string[];
    file_patterns: string[];
    tool_signals: string[];
  };
  constraints?: {
    must?: PolicyRule[];
    forbid?: PolicyRule[];
  };
  ttl_minutes?: number;
}

interface Signals {
  userInput: string;
  recentContext: string;
  touchedFiles: string[];
  toolSignals: string[];
}

interface RankedSkill {
  skill: Skill;
  score: number;
  confidence: number;
}

const AUTO_LOAD_THRESHOLD = 0.8;
const INCREMENTAL_THRESHOLD = 0.7;

function keywordScore(skill: Skill, signals: Signals): number {
  const text = `${signals.userInput} ${signals.recentContext}`.toLowerCase();
  if (!skill.triggers.keywords.length) return 0;
  let hits = 0;
  for (const kw of skill.triggers.keywords) {
    if (text.includes(kw.toLowerCase())) hits += 1;
  }
  return hits / skill.triggers.keywords.length;
}

function filePatternScore(skill: Skill, signals: Signals): number {
  if (!skill.triggers.file_patterns.length || !signals.touchedFiles.length) return 0;
  let hit = 0;
  for (const file of signals.touchedFiles) {
    for (const p of skill.triggers.file_patterns) {
      if (p.endsWith("*.tsx") && file.endsWith(".tsx")) hit = 1;
      if (p.endsWith("*.ts") && file.endsWith(".ts")) hit = 1;
      if (p.endsWith("*.css") && file.endsWith(".css")) hit = 1;
      if (p.includes("frontend/") && file.includes("frontend/")) hit = 1;
    }
  }
  return hit;
}

function toolSignalScore(skill: Skill, signals: Signals): number {
  if (!skill.triggers.tool_signals.length || !signals.toolSignals.length) return 0;
  let hits = 0;
  for (const ts of skill.triggers.tool_signals) {
    if (signals.toolSignals.some((x) => x.startsWith(ts) || x.includes(ts))) hits += 1;
  }
  return hits / skill.triggers.tool_signals.length;
}

function semanticScore(_skill: Skill, _signals: Signals): number {
  return 0.5;
}

function rankSkills(skills: Skill[], signals: Signals): RankedSkill[] {
  return skills
    .map((skill) => {
      const kw = keywordScore(skill, signals);
      const fp = filePatternScore(skill, signals);
      const ts = toolSignalScore(skill, signals);
      const sm = semanticScore(skill, signals);

      const raw = 0.35 * kw + 0.2 * fp + 0.2 * ts + 0.25 * sm;
      const priorityFactor = 0.6 + (skill.priority / 100) * 0.4;
      const score = Math.max(0, Math.min(1, raw * priorityFactor));
      const confidence = Math.max(0, Math.min(1, 0.5 * kw + 0.25 * fp + 0.25 * ts));

      return { skill, score, confidence };
    })
    .sort((a, b) => b.score - a.score);
}

function policyLevelWeight(level: PolicyLevel): number {
  if (level === "BLOCK") return 3;
  if (level === "REQUIRE") return 2;
  return 1;
}

function resolveConflicts(candidates: RankedSkill[], active: Skill[]): RankedSkill[] {
  const activeSet = new Set(active.map((s) => s.name));

  let filtered = candidates.filter((c) => {
    const me = c.skill.mutually_exclusive || [];
    for (const a of active) {
      if (me.includes(a.name) || (a.mutually_exclusive || []).includes(c.skill.name)) {
        return false;
      }
    }
    return true;
  });

  const dedup = new Map<string, RankedSkill>();
  for (const c of filtered) {
    const prev = dedup.get(c.skill.name);
    if (!prev || c.score > prev.score) dedup.set(c.skill.name, c);
  }
  filtered = [...dedup.values()];

  filtered = filtered.map((c) => {
    const must = c.skill.constraints?.must || [];
    const forbid = c.skill.constraints?.forbid || [];
    const weight = [...must, ...forbid].reduce((sum, r) => sum + policyLevelWeight(r.level), 0) * 0.01;
    return { ...c, score: Math.min(1, c.score + weight) };
  });

  filtered.sort((a, b) => {
    const aDep = a.skill.dependencies.some((d) => activeSet.has(d)) ? 1 : 0;
    const bDep = b.skill.dependencies.some((d) => activeSet.has(d)) ? 1 : 0;
    if (aDep !== bDep) return bDep - aDep;
    return b.score - a.score;
  });

  return filtered;
}

function pickForInitialLoad(ranked: RankedSkill[]): RankedSkill[] {
  if (!ranked.length) return [];
  const top = ranked[0];
  if (top.score >= AUTO_LOAD_THRESHOLD) return [top];
  return [];
}

function pickForIncrementalLoad(ranked: RankedSkill[], active: Skill[]): RankedSkill[] {
  const activeSet = new Set(active.map((s) => s.name));
  for (const r of ranked) {
    if (activeSet.has(r.skill.name)) continue;
    if (r.score >= INCREMENTAL_THRESHOLD) return [r];
  }
  return [];
}

export function routeAndLoad(
  allSkills: Skill[],
  signals: Signals,
  activeSkills: Skill[],
  phase: "initial" | "incremental"
): { toLoad: Skill[]; ranked: RankedSkill[] } {
  const ranked = rankSkills(allSkills, signals);
  const resolved = resolveConflicts(ranked, activeSkills);

  const selected =
    phase === "initial"
      ? pickForInitialLoad(resolved)
      : pickForIncrementalLoad(resolved, activeSkills);

  const byName = new Map(allSkills.map((s) => [s.name, s]));
  const toLoad: Skill[] = [];
  for (const s of selected.map((x) => x.skill)) {
    for (const dep of s.dependencies || []) {
      const depSkill = byName.get(dep);
      if (depSkill && !activeSkills.some((a) => a.name === depSkill.name)) {
        toLoad.push(depSkill);
      }
    }
    toLoad.push(s);
  }

  return { toLoad, ranked: resolved };
}
```

## 9. Prometheus 指标规范

核心监控指标：

- `skill_router_requests_total{phase,result}`
- `skill_router_latency_ms_bucket`
- `skill_router_latency_ms_sum`
- `skill_router_latency_ms_count`
- `skill_trigger_score`
- `skill_autoload_total{skill}`
- `skill_manual_load_total{skill}`
- `skill_load_tokens_total{skill,layer}`
- `skill_active_sessions{skill}`
- `skill_conflict_total{skill_a,skill_b,reason}`
- `skill_verification_runs_total{skill,status}`
- `skill_task_success_total{skill}`
- `skill_task_failure_total{skill,reason}`
- `skill_rollback_total{skill}`
- `skill_cache_hit_total{skill}`
- `skill_cache_miss_total{skill}`
- `skill_precision_7d{skill}`
- `skill_miss_rate_7d{skill}`

治理建议：

1. 按周观察触发精度和漏触发率，调整阈值。
2. 将 token 成本与成功率联动评估，避免只追求命中率。
3. 对高基数标签（如 reason）做枚举收敛，避免监控系统膨胀。

## 10. MVP 落地计划

1. 第 1 周：Skill Registry + 手工触发。
2. 第 2 周：关键词召回 + top-1 自动加载 + 基础指标。
3. 第 3 周：语义召回 + 冲突策略 + L1/L2 分层注入。
4. 第 4 周：缓存失效、A/B 实验与阈值调优。

## 11. 验收标准

1. Skill 不再全量注入，默认按需加载。
2. 路由打分可观测，能解释触发来源。
3. 冲突策略可复现，结果稳定。
4. 渐进式加载相比全量加载具备可量化收益（token、时延或成功率）。
