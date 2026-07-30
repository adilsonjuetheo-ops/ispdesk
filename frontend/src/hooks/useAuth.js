import { useState, useEffect } from 'react';

export function useAuth() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('ispdesk_user');
    return saved ? JSON.parse(saved) : null;
  });

  const login = (token, userData) => {
    // Novas sessões usam cookie HttpOnly. Remove eventual token legado
    // armazenado por versões anteriores do frontend.
    localStorage.removeItem('ispdesk_token');
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
