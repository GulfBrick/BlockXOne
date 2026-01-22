'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { blockXOneApi } from './api-client';

type User = {
  id: string;
  email: string;
  roles: string[];
  orgId?: string;
  walletId?: string;
  token: string;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'bx_auth_v2';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);

  const persist = useCallback((u: User | null) => {
    if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    else localStorage.removeItem(STORAGE_KEY);
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setLoading(true);
    try {
      console.log('[Auth] Verifying token with /v1/me...');
      const me = await blockXOneApi.auth.meWithToken(token);
      console.log('[Auth] /v1/me response:', me);
      const u: User = {
        id: me.user_id,
        email: me.email,
        roles: me.roles || [],
        orgId: (me as any).org_id,
        walletId: (me as any).wallet_id,
        token,
      };
      setUser(u);
      persist(u);
      console.log('[Auth] User signed in:', u);
    } catch (err) {
      console.error('[Auth] loginWithToken failed:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [persist]);

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
      const parsed = JSON.parse(raw) as Partial<User>;
      if (parsed && parsed.token) {
        // re-verify token to refresh roles/email
        loginWithToken(parsed.token);
        return;
      }
      setLoading(false);
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
      setLoading(false);
    }
  }, [isMounted, loginWithToken]);

  const logout = () => {
    setUser(null);
    persist(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
