import api from './api';

export type PlanMode = 'sequential' | 'parallel' | 'hybrid';
export type PlanStatus = 'draft' | 'planned' | 'running' | 'paused' | 'completed' | 'failed';
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
  mode?: 'plan' | 'schedule';
  planId?: string;
  scheduleId?: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: TaskStatus;
  order: number;
  dependencyTaskIds: string[];
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
  tasks?: OrchestrationTask[];
  createdAt: string;
  updatedAt: string;
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
}

export interface RunPlanAcceptedResponse {
  accepted: boolean;
  planId: string;
  status: string;
  alreadyRunning?: boolean;
}

export const orchestrationService = {
  async createPlanFromPrompt(payload: CreatePlanFromPromptDto): Promise<OrchestrationPlan> {
    const response = await api.post('/orchestration/plans/from-prompt', payload);
    return response.data;
  },

  async getPlans(): Promise<OrchestrationPlan[]> {
    const response = await api.get('/orchestration/plans');
    return response.data;
  },

  async getPlanById(planId: string): Promise<OrchestrationPlan> {
    const response = await api.get(`/orchestration/plans/${planId}`);
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
    payload: { title?: string; description?: string },
  ): Promise<OrchestrationTask> {
    const response = await api.post(`/orchestration/tasks/${taskId}/draft`, payload);
    return response.data;
  },

  async debugTaskStep(
    taskId: string,
    payload: { title?: string; description?: string; resetResult?: boolean },
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
