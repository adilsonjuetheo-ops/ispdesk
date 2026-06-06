import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ispdesk_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (token, userData) => {
    localStorage.setItem('ispdesk_token', token);
    localStorage.setItem('ispdesk_user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('ispdesk_token');
    localStorage.removeItem('ispdesk_user');
    setUser(null);
  };

  return { user, login, logout };
}
