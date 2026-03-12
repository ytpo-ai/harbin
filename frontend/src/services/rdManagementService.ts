import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3100/api';

export interface RdTask {
  _id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee: {
    _id: string;
    name: string;
    email: string;
  };
  createdBy: {
    _id: string;
    name: string;
    email: string;
  };
  organization: string;
  opencodeSessionId?: string;
  opencodeProjectPath?: string;
  opencodeMessages?: any[];
  lastOpencodeResponse?: string;
  result?: any;
  completedAt?: string;
  startedAt?: string;
  estimatedHours?: number;
  actualHours?: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RdProject {
  _id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  organization: string;
  members: {
    _id: string;
    name: string;
    email: string;
  }[];
  manager?: {
    _id: string;
    name: string;
    email: string;
  };
  opencodeProjectPath?: string;
  opencodeProjectId?: string;
  opencodeSessionId?: string;
  syncedFromAgentId?: string;
  createdBySync?: boolean;
  opencodeConfig?: Record<string, any>;
  repositoryUrl?: string;
  branch?: string;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpencodeCurrentContext {
  project: any;
  path: any;
  sessions: any[];
  currentSession: any | null;
  available?: boolean;
  error?: string;
}

export interface OpencodeEventPayload {
  type?: string;
  [key: string]: any;
}

export interface CreateOpencodeSessionDto {
  projectPath: string;
  title?: string;
  config?: Record<string, any>;
}

export interface ImportOpencodeProjectDto {
  projectId?: string;
  projectPath?: string;
  name?: string;
  agentId?: string;
}

export interface SyncAgentOpencodeProjectsDto {
  projectPaths?: string[];
}

export interface CreateRdTaskDto {
  title: string;
  description: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignee: string;
  projectId?: string;
  estimatedHours?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  opencodeProjectPath?: string;
  opencodeConfig?: Record<string, any>;
}

export interface UpdateRdTaskDto {
  title?: string;
  description?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;
  estimatedHours?: number;
  actualHours?: number;
  tags?: string[];
  metadata?: Record<string, any>;
  result?: Record<string, any>;
}

export interface CreateRdProjectDto {
  name: string;
  description?: string;
  manager?: string;
  members?: string[];
  opencodeProjectPath?: string;
  opencodeConfig?: Record<string, any>;
  repositoryUrl?: string;
  branch?: string;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, any>;
}

export interface UpdateRdProjectDto {
  name?: string;
  description?: string;
  status?: 'active' | 'paused' | 'completed' | 'archived';
  manager?: string;
  members?: string[];
  opencodeProjectPath?: string;
  opencodeConfig?: Record<string, any>;
  repositoryUrl?: string;
  branch?: string;
  startDate?: string;
  endDate?: string;
  metadata?: Record<string, any>;
}

class RdManagementService {
  private getAuthHeaders() {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };
  }

  // ========== 任务管理 ==========

  async getTasks(filters?: any): Promise<RdTask[]> {
    const response = await axios.get(`${API_URL}/rd-management/tasks`, {
      ...this.getAuthHeaders(),
      params: filters,
    });
    return response.data;
  }

  async getTaskById(taskId: string): Promise<RdTask> {
    const response = await axios.get(`${API_URL}/rd-management/tasks/${taskId}`, this.getAuthHeaders());
    return response.data;
  }

  async createTask(data: CreateRdTaskDto): Promise<RdTask> {
    const response = await axios.post(`${API_URL}/rd-management/tasks`, data, this.getAuthHeaders());
    return response.data;
  }

  async updateTask(taskId: string, data: UpdateRdTaskDto): Promise<RdTask> {
    const response = await axios.put(`${API_URL}/rd-management/tasks/${taskId}`, data, this.getAuthHeaders());
    return response.data;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const response = await axios.delete(`${API_URL}/rd-management/tasks/${taskId}`, this.getAuthHeaders());
    return response.data;
  }

  // ========== 项目管理 ==========

  async getProjects(filters?: { syncedFromAgentId?: string }): Promise<RdProject[]> {
    const response = await axios.get(`${API_URL}/rd-management/projects`, {
      ...this.getAuthHeaders(),
      params: filters,
    });
    return response.data;
  }

  async getProjectById(projectId: string): Promise<RdProject> {
    const response = await axios.get(`${API_URL}/rd-management/projects/${projectId}`, this.getAuthHeaders());
    return response.data;
  }

  async createProject(data: CreateRdProjectDto): Promise<RdProject> {
    const response = await axios.post(`${API_URL}/rd-management/projects`, data, this.getAuthHeaders());
    return response.data;
  }

  async updateProject(projectId: string, data: UpdateRdProjectDto): Promise<RdProject> {
    const response = await axios.put(`${API_URL}/rd-management/projects/${projectId}`, data, this.getAuthHeaders());
    return response.data;
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const response = await axios.delete(`${API_URL}/rd-management/projects/${projectId}`, this.getAuthHeaders());
    return response.data;
  }

  // ========== OpenCode 集成 ==========

  async sendOpencodePrompt(taskId: string, prompt: string, projectPath?: string, model?: any): Promise<any> {
    const response = await axios.post(
      `${API_URL}/rd-management/tasks/${taskId}/opencode/prompt`,
      { prompt, projectPath, model },
      this.getAuthHeaders()
    );
    return response.data;
  }

  async createTaskOpencodeSession(taskId: string, projectPath: string): Promise<any> {
    const response = await axios.post(
      `${API_URL}/rd-management/tasks/${taskId}/opencode/session`,
      { projectPath },
      this.getAuthHeaders()
    );
    return response.data;
  }

  async getOpencodeHistory(taskId: string): Promise<any> {
    const response = await axios.get(
      `${API_URL}/rd-management/tasks/${taskId}/opencode/history`,
      this.getAuthHeaders()
    );
    return response.data;
  }

  async getCurrentOpencodeContext(): Promise<OpencodeCurrentContext> {
    const response = await axios.get(`${API_URL}/rd-management/opencode/current`, this.getAuthHeaders());
    return response.data;
  }

  async getOpencodeProjects(): Promise<any[]> {
    const response = await axios.get(`${API_URL}/rd-management/opencode/projects`, this.getAuthHeaders());
    return response.data;
  }

  async importOpencodeProject(payload: ImportOpencodeProjectDto): Promise<any> {
    const response = await axios.post(`${API_URL}/rd-management/opencode/projects/import`, payload, this.getAuthHeaders());
    return response.data;
  }

  async syncAgentOpencodeProjects(agentId: string, payload?: SyncAgentOpencodeProjectsDto): Promise<any> {
    const response = await axios.post(
      `${API_URL}/rd-management/agents/${encodeURIComponent(agentId)}/opencode/projects/sync`,
      payload || {},
      this.getAuthHeaders(),
    );
    return response.data;
  }

  async getOpencodeSessions(directory?: string): Promise<any[]> {
    const response = await axios.get(`${API_URL}/rd-management/opencode/sessions`, {
      ...this.getAuthHeaders(),
      params: directory ? { directory } : undefined,
    });
    return response.data;
  }

  async getOpencodeSession(sessionId: string): Promise<any> {
    const response = await axios.get(`${API_URL}/rd-management/opencode/sessions/${sessionId}`, this.getAuthHeaders());
    return response.data;
  }

  async getOpencodeSessionMessages(sessionId: string): Promise<any[]> {
    if (!sessionId?.trim()) {
      return [];
    }
    const response = await axios.get(`${API_URL}/rd-management/opencode/sessions/${sessionId}/messages`, this.getAuthHeaders());
    return response.data;
  }

  async createOpencodeSession(data: CreateOpencodeSessionDto): Promise<any> {
    const response = await axios.post(`${API_URL}/rd-management/opencode/sessions`, data, this.getAuthHeaders());
    return response.data;
  }

  async promptOpencodeSession(sessionId: string, prompt: string, model?: any): Promise<any> {
    const response = await axios.post(
      `${API_URL}/rd-management/opencode/sessions/${sessionId}/prompt`,
      { prompt, model },
      this.getAuthHeaders()
    );
    return response.data;
  }

  subscribeOpencodeEvents(onEvent: (event: OpencodeEventPayload) => void): EventSource {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';
    const url = `${API_URL}/rd-management/opencode/events?token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);

    source.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        onEvent(payload);
      } catch {
        onEvent({ type: 'raw', payload: message.data });
      }
    };

    source.onerror = () => {
      onEvent({ type: 'error', message: 'OpenCode event stream disconnected' });
    };

    return source;
  }

  async syncCurrentOpencodeToTask(taskId: string, payload?: { sessionId?: string; projectPath?: string }): Promise<RdTask> {
    const response = await axios.post(
      `${API_URL}/rd-management/tasks/${taskId}/opencode/sync-current`,
      payload || {},
      this.getAuthHeaders()
    );
    return response.data;
  }

  async syncCurrentOpencodeToProject(projectId: string, payload?: { sessionId?: string; projectPath?: string }): Promise<RdProject> {
    const response = await axios.post(
      `${API_URL}/rd-management/projects/${projectId}/opencode/sync-current`,
      payload || {},
      this.getAuthHeaders()
    );
    return response.data;
  }

  async completeTask(taskId: string, result: any): Promise<RdTask> {
    const response = await axios.post(
      `${API_URL}/rd-management/tasks/${taskId}/complete`,
      { result },
      this.getAuthHeaders()
    );
    return response.data;
  }
}

export const rdManagementService = new RdManagementService();
