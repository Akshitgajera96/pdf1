import axios, { AxiosHeaders } from 'axios';
import { resolveBackendUrl } from '@/lib/backendUrl';

export const api = axios.create();

// Add request interceptor to include auth token
api.interceptors.request.use(
  config => {
    const url = typeof config.url === 'string' ? config.url : '';
    const isAbsoluteUrl = /^https?:\/\//i.test(url);
    if (!isAbsoluteUrl) {
      const backendUrl = resolveBackendUrl();
      if (!backendUrl) {
        return Promise.reject(new Error('Backend URL not configured'));
      }
      config.baseURL = backendUrl;
    }

    const token = localStorage.getItem('auth_token');
    if (token) {
      const hdrs =
        config.headers instanceof AxiosHeaders
          ? config.headers
          : new AxiosHeaders((config.headers as any) || undefined);
      hdrs.set('Authorization', `Bearer ${token}`);
      config.headers = hdrs;
    }
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      // logout ONCE
      window.dispatchEvent(new Event('force-logout'));
    }
    return Promise.reject(err);
  }
);
