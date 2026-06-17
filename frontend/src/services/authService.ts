import api from '../lib/axios';

export interface LoginDto {
  email: string;
  password: string;
}

export interface AuthResponse {
  employee: {
    id: string;
    name: string;
    email: string;
    type: string;
    role: string;
  };
  token: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  type: string;
  role: string;
}

export interface FeishuBindTokenResponse {
  token: string;
  expiresIn: number;
  command: string;
}

export interface LifeScriptRedirectTokenResponse {
  redirectToken: string;
  expiresIn: number;
}

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  timestamp: string;
  requestId: string;
}

class AuthService {
  private tokenKey = 'auth_token';
  private userKey = 'current_user';

  private unwrapApiData<T>(payload: T | ApiEnvelope<T>): T {
    if (payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)) {
      return (payload as ApiEnvelope<T>).data;
    }

    return payload as T;
  }

  async login(data: LoginDto): Promise<AuthResponse> {
    const response = await api.post('/auth/login', data);
    const authData = this.unwrapApiData<AuthResponse>(response.data);
    const { token, employee } = authData;
    
    localStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.userKey, JSON.stringify(employee));
    
    return authData;
  }

  async verify(): Promise<CurrentUser | null> {
    const token = this.getToken();
    if (!token) return null;

    try {
      const response = await api.get('/auth/verify', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return this.unwrapApiData<{ valid: boolean; employee: CurrentUser }>(response.data).employee;
    } catch {
      this.logout();
      return null;
    }
  }

  async getCurrentUser(): Promise<CurrentUser | null> {
    const stored = localStorage.getItem(this.userKey);
    if (!stored) return null;

    try {
      const response = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${this.getToken()}` }
      });
      return this.unwrapApiData<CurrentUser>(response.data);
    } catch {
      return JSON.parse(stored);
    }
  }

  async refreshToken(): Promise<void> {
    const token = this.getToken();
    if (!token) return;

    const response = await api.post('/auth/refresh', {}, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    localStorage.setItem(this.tokenKey, this.unwrapApiData<{ token: string }>(response.data).token);
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const token = this.getToken();
    await api.post('/auth/change-password', 
      { oldPassword, newPassword },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }

  async generateFeishuBindToken(): Promise<FeishuBindTokenResponse> {
    const response = await api.post('/auth/me/feishu-bind-token');
    return this.unwrapApiData<FeishuBindTokenResponse>(response.data);
  }

  async generateLifeScriptRedirectToken(): Promise<LifeScriptRedirectTokenResponse> {
    const response = await api.post('/auth/issue-redirect-token');
    return this.unwrapApiData<LifeScriptRedirectTokenResponse>(response.data);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  logout(): void {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem('token');
    localStorage.removeItem(this.userKey);
  }
}

export const authService = new AuthService();
export default authService;
