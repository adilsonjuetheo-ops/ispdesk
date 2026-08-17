import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('ispdesk_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ispdesk_token');
      localStorage.removeItem('ispdesk_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
