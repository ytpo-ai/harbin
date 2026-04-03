import { describe, expect, it } from 'bun:test';
import type { AgentBusinessRole } from '../src/services/agentService';
import { resolveAgentRoleDisplayName } from '../src/components/agent-detail/utils';

const mockRole = (overrides: Partial<AgentBusinessRole>): AgentBusinessRole => ({
  id: 'role-fullstack-engineer',
  code: 'fullstack-engineer',
  name: '全栈工程师',
  tier: 'operations',
  status: 'active',
  ...overrides,
});

describe('resolveAgentRoleDisplayName', () => {
  it('maps role-fullstack-engineer to chinese name from role metadata', () => {
    const roleMap = new Map<string, AgentBusinessRole>();
    const role = mockRole({});
    roleMap.set(role.id, role);
    roleMap.set(role.code, role);

    expect(resolveAgentRoleDisplayName('role-fullstack-engineer', roleMap)).toBe('全栈工程师');
  });

  it('supports both role- prefixed and plain role code inputs', () => {
    expect(resolveAgentRoleDisplayName('role-fullstack-engineer')).toBe('全栈工程师');
    expect(resolveAgentRoleDisplayName('fullstack-engineer')).toBe('全栈工程师');
  });

  it('falls back to role code when role is not found', () => {
    expect(resolveAgentRoleDisplayName('role-data-analyst')).toBe('data-analyst');
    expect(resolveAgentRoleDisplayName('data-analyst')).toBe('data-analyst');
  });

  it('returns dash when role id is empty', () => {
    expect(resolveAgentRoleDisplayName('')).toBe('-');
    expect(resolveAgentRoleDisplayName(undefined)).toBe('-');
  });
});
