import axios from 'axios';

interface ApiEnvelope<T = unknown> {
  code: number;
  message: string;
  data: T;
  timestamp?: string;
  requestId?: string;
}

function unwrapApiEnvelope<T>(payload: T | ApiEnvelope<T>): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload as T;
  }

  const body = payload as Record<string, unknown>;
  const isEnvelope =
    typeof body.code === 'number'
    && typeof body.message === 'string'
    && Object.prototype.hasOwnProperty.call(body, 'data');

  if (!isEnvelope) {
    return payload as T;
  }

  return (body.data as T);
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  (response) => {
    response.data = unwrapApiEnvelope(response.data);
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('token');
      localStorage.removeItem('current_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
