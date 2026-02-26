import api from '../lib/axios';

export enum InvitationStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum InvitationRole {
  FOUNDER = 'founder',
  CO_FOUNDER = 'co_founder',
  MANAGER = 'manager',
  SENIOR = 'senior',
  JUNIOR = 'junior',
  INTERN = 'intern',
}

export interface Invitation {
  id: string;
  organizationId: string;
  code: string;
  invitedBy: string;
  invitedByName: string;
  email?: string;
  name?: string;
  role: InvitationRole;
  departmentId?: string;
  title?: string;
  message?: string;
  linkToken: string;
  expiresAt: string;
  status: InvitationStatus;
  usedAt?: string;
  usedBy?: string;
  maxUses: number;
  usedCount: number;
  createdAt: string;
}

export interface CreateInvitationDto {
  organizationId: string;
  invitedBy: string;
  invitedByName: string;
  role: InvitationRole;
  departmentId?: string;
  title?: string;
  email?: string;
  name?: string;
  message?: string;
  expiresInDays?: number;
  maxUses?: number;
}

export interface AcceptInvitationDto {
  code: string;
  linkToken: string;
  email: string;
  name: string;
  password: string;
}

export interface InvitationStats {
  total: number;
  pending: number;
  accepted: number;
  expired: number;
}

class InvitationService {
  async createInvitation(data: CreateInvitationDto): Promise<Invitation> {
    const response = await api.post('/invitations', data);
    return response.data.data;
  }

  async getByOrganization(organizationId: string): Promise<Invitation[]> {
    const response = await api.get(`/invitations/organization/${organizationId}`);
    return response.data.data;
  }

  async getStats(organizationId: string): Promise<InvitationStats> {
    const response = await api.get(`/invitations/stats/${organizationId}`);
    return response.data.data;
  }

  async validateInvitation(code: string, linkToken: string): Promise<{
    valid: boolean;
    error?: string;
    data?: {
      id: string;
      organizationId: string;
      role: string;
      title: string;
      invitedByName: string;
      email?: string;
      message: string;
      expiresAt: string;
    };
  }> {
    const response = await api.post('/invitations/validate', { code, linkToken });
    return response.data;
  }

  async acceptInvitation(data: AcceptInvitationDto): Promise<any> {
    const response = await api.post('/invitations/accept', data);
    return response.data;
  }

  async cancelInvitation(id: string): Promise<void> {
    await api.post(`/invitations/${id}/cancel`);
  }

  async resendInvitation(id: string, expiresInDays?: number): Promise<Invitation> {
    const response = await api.post(`/invitations/${id}/resend`, { expiresInDays });
    return response.data.data;
  }

  async deleteExpired(organizationId: string): Promise<number> {
    const response = await api.delete(`/invitations/cleanup/${organizationId}`);
    return response.data.data.deletedCount;
  }

  // 生成邀请链接
  getInvitationLink(code: string, linkToken: string, baseUrl: string = 'http://localhost:3000'): string {
    return `${baseUrl}/invite/${code}?token=${linkToken}`;
  }

  // 复制邀请码到剪贴板
  async copyInvitationCode(code: string): Promise<void> {
    await navigator.clipboard.writeText(code);
  }

  // 复制邀请链接到剪贴板
  async copyInvitationLink(link: string): Promise<void> {
    await navigator.clipboard.writeText(link);
  }
}

export const invitationService = new InvitationService();
export default invitationService;
