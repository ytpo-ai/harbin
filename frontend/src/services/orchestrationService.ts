import api from './api';

export type PlanMode = 'sequential' | 'parallel' | 'hybrid';
export type DebugRuntimeTaskTypeOverride = 'general' | 'development' | 'research' | 'review' | 'external_action';
export type PlanStatus = 'draft' | 'drafting' | 'planned';
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
  status: PlanStatus;
  strategy: {
    plannerAgentId?: string;
    mode: PlanMode;
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
  title?: string;
  plannerAgentId?: string;
  mode?: PlanMode;
  autoRun?: boolean;
  autoGenerate?: boolean;
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
  plannerAgentId?: string;
  mode?: PlanMode;
  metadata?: Record<string, unknown>;
}

export interface ReplanPlanDto {
  prompt: string;
  title?: string;
  plannerAgentId?: string;
  mode?: PlanMode;
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
  if (status === 'draft' || status === 'drafting' || status === 'planned') {
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

export const orchestrationService = {
  async createPlanFromPrompt(payload: CreatePlanFromPromptDto): Promise<OrchestrationPlan> {
    const response = await api.post('/orchestration/plans/from-prompt', payload);
    return normalizePlan(response.data);
  },

  async getPlans(): Promise<OrchestrationPlan[]> {
    const response = await api.get('/orchestration/plans');
    return Array.isArray(response.data) ? response.data.map((plan: OrchestrationPlan) => normalizePlan(plan)) : [];
  },

  async getPlanById(planId: string): Promise<OrchestrationPlan> {
    const response = await api.get(`/orchestration/plans/${planId}`);
    return normalizePlan(response.data);
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
    return response.data;
  },

  async replanPlan(planId: string, payload: ReplanPlanDto): Promise<ReplanPlanAcceptedResponse> {
    const response = await api.post(`/orchestration/plans/${planId}/replan`, payload);
    return response.data;
  },

  async deletePlan(planId: string): Promise<{ success: boolean; deletedTasks: number }> {
    const response = await api.delete(`/orchestration/plans/${planId}`);
    return response.data;
  },

  async runPlan(planId: string, continueOnFailure = true): Promise<RunPlanAcceptedResponse> {
    const response = await api.post(`/orchestration/plans/${planId}/run`, {
      continueOnFailure,
    });
    return response.data;
  },

  async generateNext(planId: string): Promise<{ accepted: boolean }> {
    const response = await api.post(`/orchestration/plans/${planId}/generate-next`);
    return response.data;
  },

  async getPlanRuns(planId: string, limit = 20): Promise<OrchestrationRun[]> {
    const response = await api.get(`/orchestration/plans/${planId}/runs`, {
      params: { limit },
    });
    return response.data;
  },

  async getPlanLatestRun(planId: string): Promise<OrchestrationRun | null> {
    const response = await api.get(`/orchestration/plans/${planId}/runs/latest`);
    return response.data;
  },

  async getRunById(runId: string): Promise<OrchestrationRun> {
    const response = await api.get(`/orchestration/runs/${runId}`);
    return response.data;
  },

  async getRunTasks(runId: string): Promise<OrchestrationRunTask[]> {
    const response = await api.get(`/orchestration/runs/${runId}/tasks`);
    return response.data;
  },

  async reassignTask(
    taskId: string,
    payload: { executorType: 'agent' | 'employee' | 'unassigned'; executorId?: string; reason?: string },
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/reassign`, payload);
    return response.data;
  },

  async completeHumanTask(taskId: string, payload: { summary?: string; output?: string }): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/complete-human`, payload);
    return response.data;
  },

  async retryTask(taskId: string): Promise<{
    task: OrchestrationTask;
    run: { accepted: boolean; planId: string; status: string; alreadyRunning?: boolean };
  }> {
    const response = await api.post(`/orchestration/tasks/${taskId}/retry`);
    return response.data;
  },

  async updateTaskDraft(
    taskId: string,
    payload: { title?: string; description?: string; runtimeTaskType?: DebugRuntimeTaskTypeOverride | 'auto' },
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/draft`, payload);
    return response.data;
  },

  async addTaskToPlan(
    planId: string,
    payload: AddTaskToPlanPayload,
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/plans/${planId}/tasks`, payload);
    return response.data;
  },

  async deleteTask(taskId: string): Promise<{ success: boolean }> {
    const response = await api.delete(`/orchestration/tasks/${taskId}`);
    return response.data;
  },

  async updateTaskFull(
    taskId: string,
    payload: UpdateTaskFullPayload,
  ): Promise<OrchestrationTask> {
    const response = await api.patch(`/orchestration/tasks/${taskId}`, payload);
    return response.data;
  },

  async reorderTasks(planId: string, taskIds: string[]): Promise<{ success: boolean }> {
    const response = await api.put(`/orchestration/plans/${planId}/tasks/reorder`, { taskIds });
    return response.data;
  },

  async batchUpdateTasks(
    planId: string,
    updates: BatchUpdateTaskItem[],
  ): Promise<OrchestrationTask[]> {
    const response = await api.put(`/orchestration/plans/${planId}/tasks/batch-update`, { updates });
    return response.data;
  },

  async duplicateTask(planId: string, taskId: string): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/plans/${planId}/tasks/duplicate/${taskId}`);
    return response.data;
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
    return response.data;
  },

  async getSessions(filters?: {
    ownerType?: 'agent' | 'employee' | 'system';
    status?: 'active' | 'archived' | 'closed';
    ownerId?: string;
    linkedPlanId?: string;
  }): Promise<AgentSession[]> {
    const response = await api.get('/orchestration/sessions', { params: filters || {} });
    return response.data;
  },

  async getSessionById(sessionId: string): Promise<AgentSession> {
    const response = await api.get(`/orchestration/sessions/${sessionId}`);
    return response.data;
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
    return response.data;
  },

  async appendMessage(
    sessionId: string,
    payload: { role: 'user' | 'assistant' | 'system'; content: string },
  ): Promise<AgentSession> {
    const response = await api.post(`/orchestration/sessions/${sessionId}/messages`, payload);
    return response.data;
  },

  async archiveSession(sessionId: string, summary?: string): Promise<AgentSession> {
    const response = await api.post(`/orchestration/sessions/${sessionId}/archive`, {
      summary,
    });
    return response.data;
  },

  async resumeSession(sessionId: string): Promise<AgentSession> {
    const response = await api.post(`/orchestration/sessions/${sessionId}/resume`);
    return response.data;
  },
};
