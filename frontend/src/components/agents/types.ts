import type { AgentBusinessRole, AgentTestResult, AgentTier, AgentToolPermissionSet } from '../../services/agentService';
import type { Agent, AIModel } from '../../types';

export type TierFilter = 'all' | AgentTier;

export interface AgentToolItem {
  id: string;
  toolId?: string;
  name: string;
  description?: string;
  enabled?: boolean;
  provider?: string;
  namespace?: string;
  requiredPermissions?: Array<{ id?: string }>;
}

export interface GroupedToolItems {
  namespace: string;
  items: AgentToolItem[];
}

export type CreateAgentPayload = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>;

export interface CreateAgentModalProps {
  availableModels: AIModel[];
  availableTools: AgentToolItem[];
  toolPermissionSets: AgentToolPermissionSet[];
  businessRoles: AgentBusinessRole[];
  isLoading: boolean;
  onClose: () => void;
  onCreate: (payload: CreateAgentPayload) => void;
}

export interface EditAgentModalProps {
  agent: Agent;
  availableModels: AIModel[];
  availableTools: AgentToolItem[];
  toolPermissionSets: AgentToolPermissionSet[];
  businessRoles: AgentBusinessRole[];
  onClose: () => void;
  onSave: (updates: Partial<Agent>) => void;
  isLoading: boolean;
}

export interface ModelTestPanelProps {
  selectedModel: AIModel | undefined;
  selectedModelId: string;
  testResult: AgentTestResult | null;
  testedModelId: string | null;
  isTesting: boolean;
  streamingResponse: string;
  onTest: () => void;
}

export interface AgentFormSyncInput {
  nextRoleId: string;
  currentRoleId: string;
  currentSystemPrompt: string;
  currentSelectedTools: string[];
  emptyPromptFallback?: 'keep-current' | 'empty';
}

export interface AgentFormSyncResult {
  tier: AgentTier;
  systemPrompt: string;
  selectedTools: string[];
}

export interface AgentCardProps {
  agent: Agent;
  roleName: string;
  tierLabel: string;
  tierBadgeClassName: string;
  isStartingChat: boolean;
  hasAvatarLoadError: boolean;
  onAvatarError: () => void;
  onStartChat: () => void;
  onViewDetail: () => void;
  onToggleActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}
