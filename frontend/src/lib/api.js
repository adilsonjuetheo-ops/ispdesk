import axios from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || '/api';

// URL de mídia para <img>, <audio> e <video>. Precisa ser absoluta quando a API
// está em outro host: caminho relativo cai no nginx do frontend, que responde o
// index.html da SPA para qualquer rota desconhecida — o player recebia HTML.
export function urlMidia(conversaId, mediaId) {
  return `${API_BASE.replace(/\/$/, '')}/conversations/${conversaId}/media/${mediaId}`;
}

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
