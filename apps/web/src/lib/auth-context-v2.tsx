'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { blockXOneApi } from './api-client';
import {
  persistedSessionToken,
  verifiedUser,
  type AuthenticatedUser,
  type AuthMeResponse,
} from './auth-session';

export type User = AuthenticatedUser;

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  loginWithToken: (token: string) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = 'bx_auth_v2';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const persist = useCallback((u: User | null) => {
    if (u) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(u));
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('blockxone_token');
      localStorage.removeItem('token');
      return;
    }

    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('blockxone_token');
    localStorage.removeItem('token');
  }, []);

  const loginWithToken = useCallback(async (token: string) => {
    setLoading(true);
    try {
      const me = await blockXOneApi.auth.meWithToken(token) as AuthMeResponse;
      const u = verifiedUser(me, token);
      setUser(u);
      persist(u);
      return u;
    } catch (err) {
      setUser(null);
      persist(null);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [persist]);

  useEffect(() => {
    let active = true;

    const restorePersistedSession = async () => {
      const token = persistedSessionToken(sessionStorage.getItem(STORAGE_KEY));
      if (!token) {
        if (active) {
          setUser(null);
          persist(null);
          setLoading(false);
        }
        return;
      }

      try {
        const me = await blockXOneApi.auth.meWithToken(token) as AuthMeResponse;
        if (!active) return;

        const restoredUser = verifiedUser(me, token);
        setUser(restoredUser);
        persist(restoredUser);
      } catch {
        if (!active) return;
        setUser(null);
        persist(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void restorePersistedSession();
    return () => {
      active = false;
    };
  }, [persist]);

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
