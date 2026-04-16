import api from './api';

export type PlanMode = 'sequential' | 'parallel' | 'hybrid';
export type PlanDomainType = 'general' | 'development' | 'research';
export type PlanRunMode = 'once' | 'multi';
export type SkillActivationMode = 'standard' | 'precise';
export type DebugRuntimeTaskTypeOverride =
  | 'general'
  | 'development.plan'
  | 'development.exec'
  | 'development.review'
  | 'research';
export type PlanStatus = 'draft' | 'drafting' | 'planned' | 'production';
export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'blocked'
  | 'waiting_human'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OrchestrationTask {
  _id: string;
  planId?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: TaskStatus;
  order: number;
  dependencyTaskIds: string[];
  runtimeTaskType?: DebugRuntimeTaskTypeOverride;
  assignment: {
    executorType: 'agent' | 'employee' | 'unassigned';
    executorId?: string;
    reason?: string;
  };
  result?: {
    summary?: string;
    output?: string;
    error?: string;
  };
  sessionId?: string;
  runLogs?: Array<{
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationPlan {
  _id: string;
  title: string;
  sourcePrompt: string;
  domainType: PlanDomainType;
  projectId?: string;
  status: PlanStatus;
  strategy: {
    plannerAgentId?: string;
    mode: PlanMode;
    runMode?: PlanRunMode;
    skillActivation?: {
      mode: SkillActivationMode;
      skillIds?: string[];
    };
  };
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    waitingHumanTasks: number;
  };
  taskIds: string[];
  lastRunId?: string;
  tasks?: OrchestrationTask[];
  lastRun?: OrchestrationRun;
  metadata?: Record<string, any>;
  generationMode?: 'batch' | 'incremental';
  generationConfig?: {
    maxRetries: number;
    maxCostTokens: number;
    maxTasks: number;
  };
  generationState?: {
    currentStep: number;
    totalGenerated: number;
    totalRetries: number;
    consecutiveFailures?: number;
    totalCost: number;
    isComplete: boolean;
    lastError?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationRun {
  _id: string;
  planId: string;
  triggerType: 'manual' | 'schedule' | 'autorun';
  scheduleId?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  error?: string;
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    waitingHumanTasks: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OrchestrationRunTask extends OrchestrationTask {
  runId: string;
  sourceTaskId: string;
}

export interface AgentSession {
  _id: string;
  ownerType: 'agent' | 'employee' | 'system';
  ownerId: string;
  title: string;
  status: 'active' | 'archived' | 'closed';
  linkedPlanId?: string;
  linkedTaskId?: string;
  contextSummary?: string;
  tags: string[];
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }>;
  memoSnapshot?: {
    agentId: string;
    refreshedAt: string;
    identity: Array<{
      id: string;
      memoKind: 'identity' | 'todo' | 'topic';
      title: string;
      slug?: string;
      content: string;
      updatedAt?: string;
    }>;
    todo: Array<{
      id: string;
      memoKind: 'identity' | 'todo' | 'topic';
      title: string;
      slug?: string;
      content: string;
      updatedAt?: string;
    }>;
    topic: Array<{
      id: string;
      memoKind: 'identity' | 'todo' | 'topic';
      title: string;
      slug?: string;
      content: string;
      updatedAt?: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanFromPromptDto {
  prompt: string;
  domainType: PlanDomainType;
  title?: string;
  plannerAgentId?: string;
  mode?: PlanMode;
  runMode?: PlanRunMode;
  autoRun?: boolean;
  autoGenerate?: boolean;
  projectId?: string;
  skillActivation?: {
    mode: SkillActivationMode;
    skillIds?: string[];
  };
}

export interface RunPlanAcceptedResponse {
  accepted: boolean;
  planId: string;
  status: string;
  alreadyRunning?: boolean;
}

export interface ReplanPlanAcceptedResponse {
  accepted: boolean;
  planId: string;
  status: string;
  alreadyRunning?: boolean;
}

export interface PlanStreamEvent {
  type: string;
  data: Record<string, any>;
}

export interface UpdatePlanDto {
  title?: string;
  sourcePrompt?: string;
  domainType?: PlanDomainType;
  plannerAgentId?: string;
  mode?: PlanMode;
  runMode?: PlanRunMode;
  projectId?: string;
  metadata?: Record<string, unknown>;
}

export interface ReplanPlanDto {
  prompt: string;
  domainType?: PlanDomainType;
  title?: string;
  plannerAgentId?: string;
  mode?: PlanMode;
  runMode?: PlanRunMode;
  autoRun?: boolean;
  autoGenerate?: boolean;
}

export interface TaskAssignmentPayload {
  executorType: 'agent' | 'employee' | 'unassigned';
  executorId?: string;
  reason?: string;
}

export interface AddTaskToPlanPayload {
  title: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  insertAfterTaskId?: string;
  dependencyTaskIds?: string[];
  assignment?: TaskAssignmentPayload;
}

export interface UpdateTaskFullPayload {
  title?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dependencyTaskIds?: string[];
  assignment?: TaskAssignmentPayload;
}

export interface BatchUpdateTaskItem extends UpdateTaskFullPayload {
  taskId: string;
}

const normalizePlanStatus = (status: string | undefined, taskCount = 0): PlanStatus => {
  if (status === 'draft' || status === 'drafting' || status === 'planned' || status === 'production') {
    return status;
  }
  if (status === 'failed' && taskCount === 0) {
    return 'draft';
  }
  return 'planned';
};

const normalizePlan = (plan: OrchestrationPlan): OrchestrationPlan => ({
  ...plan,
  status: normalizePlanStatus(plan.status, plan.taskIds?.length || plan.tasks?.length || 0),
});

const unwrapApiPayload = (payload: unknown): unknown => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const obj = payload as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, 'data')) {
    return obj.data;
  }

  return payload;
};

const extractPlanArray = (payload: unknown): OrchestrationPlan[] => {
  const unwrapped = unwrapApiPayload(payload);

  if (Array.isArray(unwrapped)) {
    return unwrapped as OrchestrationPlan[];
  }

  if (!unwrapped || typeof unwrapped !== 'object') {
    return [];
  }

  const obj = unwrapped as Record<string, unknown>;
  const candidateKeys = ['data', 'items', 'list', 'rows', 'records', 'result'] as const;

  for (const key of candidateKeys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value as OrchestrationPlan[];
    }
  }

  const data = obj.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    for (const key of candidateKeys) {
      const value = nested[key];
      if (Array.isArray(value)) {
        return value as OrchestrationPlan[];
      }
    }
  }

  const numericKeys = Object.keys(obj).filter((key) => /^\d+$/.test(key));
  if (numericKeys.length > 0) {
    return numericKeys
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => obj[key])
      .filter((item): item is OrchestrationPlan => Boolean(item) && typeof item === 'object');
  }

  return [];
};

const extractPlanObject = (payload: unknown): OrchestrationPlan | null => {
  const unwrapped = unwrapApiPayload(payload);
  if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) {
    return null;
  }
  return unwrapped as OrchestrationPlan;
};

/**
 * Generic unwrap for API responses that return non-plan data.
 * Strips the `{code, message, data}` envelope if present.
 */
const unwrapData = <T>(payload: unknown): T => {
  return unwrapApiPayload(payload) as T;
};

const extractArray = <T>(payload: unknown): T[] => {
  const unwrapped = unwrapApiPayload(payload);
  if (Array.isArray(unwrapped)) {
    return unwrapped as T[];
  }
  if (!unwrapped || typeof unwrapped !== 'object') {
    return [];
  }
  const obj = unwrapped as Record<string, unknown>;
  const candidateKeys = ['data', 'items', 'list', 'rows', 'records', 'result'] as const;
  for (const key of candidateKeys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }
  return [];
};

export const orchestrationService = {
  async createPlanFromPrompt(payload: CreatePlanFromPromptDto): Promise<OrchestrationPlan> {
    const response = await api.post('/orchestration/plans/from-prompt', payload);
    const plan = extractPlanObject(response.data);
    if (!plan) {
      throw new Error('Invalid plan response');
    }
    return normalizePlan(plan);
  },

  async getPlans(filters?: { projectId?: string }): Promise<OrchestrationPlan[]> {
    const response = await api.get('/orchestration/plans', { params: filters });
    return extractPlanArray(response.data).map((plan) => normalizePlan(plan));
  },

  async getPlanById(planId: string): Promise<OrchestrationPlan> {
    const response = await api.get(`/orchestration/plans/${planId}`);
    const plan = extractPlanObject(response.data);
    if (!plan) {
      throw new Error('Invalid plan response');
    }
    return normalizePlan(plan);
  },

  subscribePlanEvents(
    planId: string,
    handlers: {
      onEvent: (event: PlanStreamEvent) => void;
      onError?: () => void;
    },
  ): () => void {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const baseURL = (api.defaults.baseURL || '').replace(/\/$/, '');
    const streamUrl = `${baseURL}/orchestration/plans/${encodeURIComponent(planId)}/events${token ? `?access_token=${encodeURIComponent(token)}` : ''}`;
    const controller = new AbortController();
    let stopped = false;
    let retryTimer: number | null = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped) {
        return;
      }
      clearRetryTimer();
      retryTimer = window.setTimeout(() => {
        void connect();
      }, 1500);
    };

    const connect = async () => {
      if (stopped) {
        return;
      }
      try {
        const response = await fetch(streamUrl, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE stream failed with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let currentData: string[] = [];

        const flushEvent = () => {
          if (!currentData.length) {
            return;
          }
          const raw = currentData.join('\n').trim();
          currentData = [];
          if (!raw) {
            return;
          }
          try {
            const payload = JSON.parse(raw);
            handlers.onEvent(payload);
          } catch {
            // ignore invalid payload
          }
        };

        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) {
            flushEvent();
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line) {
              flushEvent();
              continue;
            }
            if (line.startsWith('data:')) {
              currentData.push(line.slice(5).trimStart());
            }
          }
        }

        if (!stopped) {
          handlers.onError?.();
          scheduleReconnect();
        }
      } catch {
        if (stopped || controller.signal.aborted) {
          return;
        }
        handlers.onError?.();
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      stopped = true;
      clearRetryTimer();
      controller.abort();
    };
  },

  async updatePlan(planId: string, payload: UpdatePlanDto): Promise<OrchestrationPlan> {
    const response = await api.patch(`/orchestration/plans/${planId}`, payload);
    const plan = extractPlanObject(response.data);
    if (!plan) {
      throw new Error('Invalid update plan response');
    }
    return normalizePlan(plan);
  },

  async replanPlan(planId: string, payload: ReplanPlanDto): Promise<ReplanPlanAcceptedResponse> {
    const response = await api.post(`/orchestration/plans/${planId}/replan`, payload);
    return unwrapData<ReplanPlanAcceptedResponse>(response.data);
  },

  async deletePlan(planId: string): Promise<{ success: boolean; deletedTasks: number }> {
    const response = await api.delete(`/orchestration/plans/${planId}`);
    return unwrapData<{ success: boolean; deletedTasks: number }>(response.data);
  },

  async runPlan(planId: string, continueOnFailure = true): Promise<RunPlanAcceptedResponse> {
    const response = await api.post(`/orchestration/plans/${planId}/run`, {
      continueOnFailure,
    });
    return unwrapData<RunPlanAcceptedResponse>(response.data);
  },

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<{ success: boolean; runId: string; status: 'cancelled'; cancelledTasks: number }> {
    const response = await api.post(`/orchestration/runs/${runId}/cancel`, { reason });
    return unwrapData<{ success: boolean; runId: string; status: 'cancelled'; cancelledTasks: number }>(response.data);
  },

  async publishPlan(planId: string): Promise<OrchestrationPlan> {
    const response = await api.post(`/orchestration/plans/${planId}/publish`);
    const plan = extractPlanObject(response.data);
    if (!plan) {
      throw new Error('Invalid publish response');
    }
    return normalizePlan(plan);
  },

  async unlockPlan(planId: string): Promise<OrchestrationPlan> {
    const response = await api.post(`/orchestration/plans/${planId}/unlock`);
    const plan = extractPlanObject(response.data);
    if (!plan) {
      throw new Error('Invalid unlock response');
    }
    return normalizePlan(plan);
  },

  async generateNext(planId: string): Promise<{ accepted: boolean }> {
    const response = await api.post(`/orchestration/plans/${planId}/generate-next`);
    return unwrapData<{ accepted: boolean }>(response.data);
  },

  async stopPlanGeneration(
    planId: string,
    reason?: string,
  ): Promise<{ success: boolean; planId: string; stopped: boolean; alreadyStopped?: boolean }> {
    const response = await api.post(`/orchestration/plans/${planId}/stop-generation`, {
      reason,
    });
    return unwrapData<{ success: boolean; planId: string; stopped: boolean; alreadyStopped?: boolean }>(response.data);
  },

  async getPlanRuns(planId: string, limit = 20): Promise<OrchestrationRun[]> {
    const response = await api.get(`/orchestration/plans/${planId}/runs`, {
      params: { limit },
    });
    return extractArray<OrchestrationRun>(response.data);
  },

  async getPlanLatestRun(planId: string): Promise<OrchestrationRun | null> {
    const response = await api.get(`/orchestration/plans/${planId}/runs/latest`);
    return unwrapData<OrchestrationRun | null>(response.data);
  },

  async getRunById(runId: string): Promise<OrchestrationRun> {
    const response = await api.get(`/orchestration/runs/${runId}`);
    return unwrapData<OrchestrationRun>(response.data);
  },

  async getRunTasks(runId: string): Promise<OrchestrationRunTask[]> {
    const response = await api.get(`/orchestration/runs/${runId}/tasks`);
    return extractArray<OrchestrationRunTask>(response.data);
  },

  async reassignTask(
    taskId: string,
    payload: { executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason?: string },
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/reassign`, payload);
    return unwrapData<OrchestrationTask>(response.data);
  },

  async completeHumanTask(taskId: string, payload: { summary?: string; output?: string }): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/complete-human`, payload);
    return unwrapData<OrchestrationTask>(response.data);
  },

  async retryTask(taskId: string): Promise<{
    task: OrchestrationTask;
    run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean };
  }> {
    const response = await api.post(`/orchestration/tasks/${taskId}/retry`);
    return unwrapData<{
      task: OrchestrationTask;
      run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean };
    }>(response.data);
  },

  async updateTaskDraft(
    taskId: string,
    payload: { title?: string; description?: string; runtimeTaskType?: DebugRuntimeTaskTypeOverride | 'auto' },
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/draft`, payload);
    return unwrapData<OrchestrationTask>(response.data);
  },

  async addTaskToPlan(
    planId: string,
    payload: AddTaskToPlanPayload,
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/plans/${planId}/tasks`, payload);
    return unwrapData<OrchestrationTask>(response.data);
  },

  async deleteTask(taskId: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/orchestration/tasks/${taskId}`);
    return unwrapData<{ success: boolean }>(response.data);
  },

  async updateTaskFull(
    taskId: string,
    payload: UpdateTaskFullPayload,
  ): Promise<OrchestrationTask> {
    const response = await api.patch(`/orchestration/tasks/${taskId}`, payload);
    return unwrapData<OrchestrationTask>(response.data);
  },

  async reorderTasks(planId: string, taskIds: string[]): Promise<{ success: boolean }> {
    const response = await api.put(`/orchestration/plans/${planId}/tasks/reorder`, { taskIds });
    return unwrapData<{ success: boolean }>(response.data);
  },

  async batchUpdateTasks(
    planId: string,
    updates: BatchUpdateTaskItem[],
  ): Promise<OrchestrationTask[]> {
    const response = await api.put(`/orchestration/plans/${planId}/tasks/batch-update`, { updates });
    return extractArray<OrchestrationTask>(response.data);
  },

  async duplicateTask(planId: string, taskId: string): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/plans/${planId}/tasks/duplicate/${taskId}`);
    return unwrapData<OrchestrationTask>(response.data);
  },

  async debugTaskStep(
    taskId: string,
    payload: {
      title?: string;
      description?: string;
      resetResult?: boolean;
      runtimeTaskTypeOverride?: DebugRuntimeTaskTypeOverride;
    },
  ): Promise<{
    task: OrchestrationTask;
    execution: { status: TaskStatus; result?: string; error?: string };
  }> {
    const response = await api.post(`/orchestration/tasks/${taskId}/debug-run`, payload);
    return unwrapData<{
      task: OrchestrationTask;
      execution: { status: TaskStatus; result?: string; error?: string };
    }>(response.data);
  },

  async getSessions(filters?: {
    ownerType?: 'agent' | 'employee' | 'system';
    status?: 'active' | 'archived' | 'closed';
    ownerId?: string;
    linkedPlanId?: string;
  }): Promise<AgentSession[]> {
    const response = await api.get('/orchestration/sessions', { params: filters || {} });
    return extractArray<AgentSession>(response.data);
  },

  async getSessionById(sessionId: string): Promise<AgentSession> {
    const response = await api.get(`/orchestration/sessions/${sessionId}`);
    return unwrapData<AgentSession>(response.data);
  },

  async createSession(payload: {
    ownerType: 'agent' | 'employee' | 'system';
    ownerId: string;
    title: string;
    linkedPlanId?: string;
    linkedTaskId?: string;
    tags?: string[];
  }): Promise<AgentSession> {
    const response = await api.post('/orchestration/sessions', payload);
    return unwrapData<AgentSession>(response.data);
  },

  async appendMessage(
    sessionId: string,
    payload: { role: 'user' | 'assistant' | 'system'; content: string },
  ): Promise<AgentSession> {
    const response = await api.post(`/orchestration/sessions/${sessionId}/messages`, payload);
    return unwrapData<AgentSession>(response.data);
  },

  async archiveSession(sessionId: string, summary?: string): Promise<AgentSession> {
    const response = await api.post(`/orchestration/sessions/${sessionId}/archive`, {
      summary,
    });
    return unwrapData<AgentSession>(response.data);
  },

  async resumeSession(sessionId: string): Promise<AgentSession> {
    const response = await api.post(`/orchestration/sessions/${sessionId}/resume`);
    return unwrapData<AgentSession>(response.data);
  },
};
