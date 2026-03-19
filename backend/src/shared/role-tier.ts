export const AGENT_ROLE_TIERS = ['leadership', 'operations', 'temporary'] as const;

export type AgentRoleTier = (typeof AGENT_ROLE_TIERS)[number];

const ALLOWED_DELEGATION_DIRECTIONS = new Set<string>([
  'leadership>operations',
  'leadership>temporary',
  'operations>temporary',
]);

const EMPLOYEE_ROLE_TIER_MAP: Record<string, AgentRoleTier> = {
  founder: 'leadership',
  co_founder: 'leadership',
  ceo: 'leadership',
  cto: 'leadership',
  manager: 'operations',
  senior: 'operations',
  junior: 'operations',
  intern: 'temporary',
};

const AGENT_ROLE_CODE_TIER_MAP: Record<string, AgentRoleTier> = {
  'executive-lead': 'leadership',
  'human-exclusive-assistant': 'leadership',
  'management-assistant': 'operations',
  'technical-architect': 'operations',
  'fullstack-engineer': 'operations',
  'devops-engineer': 'operations',
  'data-analyst': 'operations',
  'product-manager': 'operations',
  'human-resources-manager': 'operations',
  'administrative-assistant': 'operations',
  'marketing-strategist': 'operations',
  'system-builtin-agent': 'operations',
  'meeting-assistant': 'operations',
  'temporary-worker': 'temporary',
};

export function hasPresetTierByAgentRoleCode(roleCode?: string): boolean {
  const normalized = String(roleCode || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(AGENT_ROLE_CODE_TIER_MAP, normalized);
}

export function isAgentRoleTier(value: unknown): value is AgentRoleTier {
  return typeof value === 'string' && AGENT_ROLE_TIERS.includes(value as AgentRoleTier);
}

export function normalizeAgentRoleTier(value: unknown): AgentRoleTier | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (isAgentRoleTier(normalized)) {
    return normalized;
  }
  return undefined;
}

export function getTierByEmployeeRole(role?: string): AgentRoleTier {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized) {
    return 'operations';
  }
  return EMPLOYEE_ROLE_TIER_MAP[normalized] || 'operations';
}

export function getTierByAgentRoleCode(roleCode?: string): AgentRoleTier {
  const normalized = String(roleCode || '').trim().toLowerCase();
  if (!normalized) {
    return 'operations';
  }
  return AGENT_ROLE_CODE_TIER_MAP[normalized] || 'operations';
}

export function canDelegateAcrossTier(sourceTier: AgentRoleTier, targetTier: AgentRoleTier): boolean {
  return ALLOWED_DELEGATION_DIRECTIONS.has(`${sourceTier}>${targetTier}`);
}
