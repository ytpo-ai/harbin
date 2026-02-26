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
    organizationId: string;
  };
  token: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  type: string;
  role: string;
  organizationId: string;
}

class AuthService {
  private tokenKey = 'auth_token';
  private userKey = 'current_user';

  async login(data: LoginDto): Promise<AuthResponse> {
    const response = await api.post('/auth/login', data);
    const { token, employee } = response.data;
    
    localStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.userKey, JSON.stringify(employee));
    
    return response.data;
  }

  async verify(): Promise<CurrentUser | null> {
    const token = this.getToken();
    if (!token) return null;

    try {
      const response = await api.get('/auth/verify', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.employee;
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
      return response.data;
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
    
    localStorage.setItem(this.tokenKey, response.data.token);
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const token = this.getToken();
    await api.post('/auth/change-password', 
      { oldPassword, newPassword },
      { headers: { Authorization: `Bearer ${token}` } }
    );
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
