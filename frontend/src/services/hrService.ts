import api from './api';

export const hrService = {
  // 生成绩效报告
  async generatePerformanceReport(agentId: string): Promise<any> {
    const response = await api.get(`/hr/performance/${agentId}`);
    return response.data;
  },

  // 识别低绩效员工
  async identifyLowPerformers(): Promise<any[]> {
    const response = await api.get('/hr/low-performers');
    return response.data;
  },

  // 获取招聘建议
  async recommendHiring(): Promise<any[]> {
    const response = await api.get('/hr/hiring-recommendations');
    return response.data;
  },

  // 计算团队健康度
  async calculateTeamHealth(): Promise<any> {
    const response = await api.get('/hr/team-health');
    return response.data;
  },

  // 批量评估
  async batchEvaluation(agentIds: string[]): Promise<any> {
    const response = await api.post('/hr/batch-evaluation', { agentIds });
    return response.data;
  }
};