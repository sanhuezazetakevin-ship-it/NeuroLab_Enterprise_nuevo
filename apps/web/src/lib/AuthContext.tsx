import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiClient } from './api';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(ApiClient.getToken()));

  const refreshUser = useCallback(async () => {
    if (!ApiClient.getToken()) {
      setUser(null);
      return;
    }
    const current = await ApiClient.me();
    setUser(current);
  }, []);

  useEffect(() => {
    let active = true;
    if (!ApiClient.getToken()) {
      setLoading(false);
      return;
    }
    ApiClient.me()
      .then((current) => {
        if (active) setUser(current);
      })
      .catch(() => {
        ApiClient.clearToken();
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const handleUnauthorized = () => {
      if (active) setUser(null);
    };
    window.addEventListener('neurolab:unauthorized', handleUnauthorized);

    return () => {
      active = false;
      window.removeEventListener('neurolab:unauthorized', handleUnauthorized);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: logged } = await ApiClient.login(email, password);
    setUser(logged);
  }, []);

  const logout = useCallback(() => {
    ApiClient.clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
