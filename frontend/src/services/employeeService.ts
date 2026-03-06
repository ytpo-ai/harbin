import api from '../lib/axios';

export enum EmployeeType {
  HUMAN = 'human',
}

export enum EmployeeStatus {
  ACTIVE = 'active',
  PROBATION = 'probation',
  TERMINATED = 'terminated',
  ON_LEAVE = 'on_leave',
  SUSPENDED = 'suspended',
}

export enum EmployeeRole {
  FOUNDER = 'founder',
  CO_FOUNDER = 'co_founder',
  CEO = 'ceo',
  CTO = 'cto',
  MANAGER = 'manager',
  SENIOR = 'senior',
  JUNIOR = 'junior',
  INTERN = 'intern',
}

export interface Employee {
  _id: string;
  id: string;
  type: EmployeeType;
  userId?: string;
  name?: string;
  email?: string;
  avatar?: string;
  agentId?: string;
  role: EmployeeRole;
  departmentId?: string;
  title?: string;
  description?: string;
  joinDate: string;
  probationEndDate?: string;
  status: EmployeeStatus;
  shares: number;
  stockOptions: number;
  salary: number;
  performance?: {
    overallScore: number;
    taskCompletionRate: number;
    codeQuality: number;
    collaboration: number;
    innovation: number;
    efficiency: number;
    lastEvaluationDate?: string;
    totalEvaluations: number;
  };
  statistics?: {
    totalTasks: number;
    completedTasks: number;
    totalTokens: number;
    totalCost: number;
    meetingsAttended: number;
    meetingsHosted: number;
  };
  capabilities: string[];
  permissions: string[];
  toolAccess: string[];
  allowAIProxy?: boolean;
  aiProxyAgentId?: string;
  exclusiveAssistantAgentId?: string;
  exclusiveAssistantName?: string;
  meetingPreferences?: {
    autoJoin: boolean;
    notifications: boolean;
    preferredMeetingTypes: string[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeeDto {
  type: EmployeeType;
  userId?: string;
  name?: string;
  email?: string;
  avatar?: string;
  role: EmployeeRole;
  departmentId?: string;
  title?: string;
  description?: string;
  salary?: number;
  shares?: number;
  stockOptions?: number;
  capabilities?: string[];
  allowAIProxy?: boolean;
  aiProxyAgentId?: string;
  exclusiveAssistantAgentId?: string;
}

export interface UpdateEmployeeDto {
  name?: string;
  email?: string;
  avatar?: string;
  role?: EmployeeRole;
  departmentId?: string;
  title?: string;
  description?: string;
  status?: EmployeeStatus;
  salary?: number;
  shares?: number;
  stockOptions?: number;
  capabilities?: string[];
  permissions?: string[];
  toolAccess?: string[];
  allowAIProxy?: boolean;
  aiProxyAgentId?: string;
  exclusiveAssistantAgentId?: string;
  meetingPreferences?: Employee['meetingPreferences'];
}

export interface EmployeeStats {
  total: number;
  byType: Array<{ _id: string; count: number }>;
  byStatus: Array<{ _id: string; count: number }>;
  byDepartment: Array<{ _id: string; count: number }>;
  humans: number;
  agents: number;
}

export interface ParticipantIdentity {
  id: string;
  type: 'employee' | 'agent';
  name: string;
  isHuman: boolean;
  employeeId?: string;
  agentId?: string;
}

class EmployeeService {
  async getEmployees(): Promise<Employee[]> {
    const response = await api.get('/employees/organization');
    return response.data.data;
  }

  async createEmployee(data: CreateEmployeeDto): Promise<Employee> {
    const response = await api.post('/employees', data);
    return response.data.data;
  }

  async getEmployeesByOrganization(
    filters?: { type?: EmployeeType; status?: EmployeeStatus; departmentId?: string }
  ): Promise<Employee[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.departmentId) params.append('departmentId', filters.departmentId);
    
    const response = await api.get(`/employees/organization?${params.toString()}`);
    return response.data.data;
  }

  async getEmployee(id: string): Promise<Employee> {
    const response = await api.get(`/employees/${id}`);
    return response.data.data;
  }

  async getEmployeeStats(): Promise<EmployeeStats> {
    const response = await api.get('/employees/stats');
    return response.data.data;
  }

  async updateEmployee(id: string, data: UpdateEmployeeDto): Promise<Employee> {
    const response = await api.put(`/employees/${id}`, data);
    return response.data.data;
  }

  async deleteEmployee(id: string): Promise<void> {
    await api.delete(`/employees/${id}`);
  }

  async confirmEmployee(id: string): Promise<Employee> {
    const response = await api.post(`/employees/${id}/confirm`);
    return response.data.data;
  }

  async terminateEmployee(id: string, reason?: string): Promise<Employee> {
    const response = await api.post(`/employees/${id}/terminate`, { reason });
    return response.data.data;
  }

  async setAIProxy(id: string, agentId: string | null): Promise<Employee> {
    const response = await api.post(`/employees/${id}/ai-proxy`, { agentId });
    return response.data.data;
  }

  async setExclusiveAssistant(id: string, agentId: string): Promise<Employee> {
    const response = await api.post(`/employees/${id}/exclusive-assistant`, { agentId });
    return response.data.data;
  }

  async getExclusiveAssistant(id: string): Promise<{ employeeId: string; agentId: string | null }> {
    const response = await api.get(`/employees/${id}/exclusive-assistant`);
    return response.data.data;
  }

  async createAndBindExclusiveAssistant(id: string): Promise<Employee> {
    const response = await api.post(`/employees/${id}/exclusive-assistant/auto-create`);
    return response.data.data;
  }

  // 获取当前用户的员工信息
  async getCurrentEmployee(userId: string): Promise<Employee | null> {
    const employees = await this.getEmployeesByOrganization();
    return employees.find(e => e.userId === userId) || null;
  }

  // 转换为会议参与者身份
  toParticipantIdentity(employee: Employee): ParticipantIdentity {
    // 如果允许AI代理且设置了代理Agent，使用Agent ID
    if (employee.allowAIProxy && employee.aiProxyAgentId) {
      return {
        id: employee.aiProxyAgentId,
        type: 'agent',
        name: employee.name || 'AI Proxy',
        isHuman: false,
        employeeId: employee.id,
        agentId: employee.aiProxyAgentId,
      };
    }

    // 否则使用员工ID
    return {
      id: employee.id,
      type: 'employee',
      name: employee.name || 'Unknown',
      isHuman: true,
      employeeId: employee.id,
    };
  }
}

export const employeeService = new EmployeeService();
export default employeeService;
