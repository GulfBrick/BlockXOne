'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { blockXOneApi } from './api-client';

type User = {
  id: string;
  email: string;
  roles: string[];
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  loginAs: (id: string, email: string, roles?: string[]) => Promise<void>;
  switchRoles: (roles: string[]) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'bx_auth_v2';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setLoading(false);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as User;
      setUser(parsed);
      setLoading(false);
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
      setLoading(false);
    }
  }, [isMounted]);

  const persist = (u: User | null) => {
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(STORAGE_KEY);
  };

  const loginAs = async (id: string, email: string, roles: string[] = []) => {
    setLoading(true);
    // optionally verify
    await blockXOneApi.auth.me(id, email);
    const u: User = { id, email, roles };
    setUser(u);
    persist(u);
    setLoading(false);
  };

  const switchRoles = (roles: string[]) => {
    if (!user) return;
    const u = { ...user, roles };
    setUser(u);
    persist(u);
  };

  const logout = () => {
    setUser(null);
    persist(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginAs, switchRoles, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
