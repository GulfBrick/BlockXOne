'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { authApi } from './api-client';

// ============================================================================
// TYPES
// ============================================================================

export interface User {
  id: string;
  email: string;
  role: 'Investor' | 'WealthManager' | 'ComplianceOfficer' | 'SuperAdmin';
  name?: string;
  verified?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (email: string, role: User['role']) => Promise<void>;
  logout: () => void;
  switchRole: (role: User['role']) => Promise<void>;
}

// ============================================================================
// DEV USER IDs (seeded in Go backend)
// ============================================================================

const DEV_USER_IDS: Record<User['role'], string> = {
  Investor: '11111111-1111-1111-1111-111111111111',
  WealthManager: '22222222-2222-2222-2222-222222222222',
  ComplianceOfficer: '33333333-3333-3333-3333-333333333333',
  SuperAdmin: '99999999-9999-9999-9999-999999999999',
};

// ============================================================================
// CONTEXT
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load user from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('blockxone_user');
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch (err) {
        localStorage.removeItem('blockxone_user');
      }
    }
  }, []);

  // Login with email and role
  const login = useCallback(
    async (email: string, role: User['role']) => {
      setLoading(true);
      setError(null);

      try {
        const userId = DEV_USER_IDS[role];

        // Verify with Go backend
        await authApi.me(userId, email);

        const newUser: User = {
          id: userId,
          email,
          role,
          name: `${role} User`,
          verified: true,
        };

        setUser(newUser);
        localStorage.setItem('blockxone_user', JSON.stringify(newUser));
      } catch (err: any) {
        const message = err.message || 'Login failed';
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Logout
  const logout = useCallback(() => {
    setUser(null);
    setError(null);
    localStorage.removeItem('blockxone_user');
  }, []);

  // Switch role
  const switchRole = useCallback(
    async (role: User['role']) => {
      if (!user) throw new Error('Not authenticated');

      setLoading(true);
      setError(null);

      try {
        const userId = DEV_USER_IDS[role];

        // Verify with Go backend
        await authApi.me(userId, user.email);

        const newUser: User = {
          ...user,
          id: userId,
          role,
        };

        setUser(newUser);
        localStorage.setItem('blockxone_user', JSON.stringify(newUser));
      } catch (err: any) {
        const message = err.message || 'Role switch failed';
        setError(message);
        throw new Error(message);
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  const value: AuthContextType = {
    user,
    loading,
    error,
    login,
    logout,
    switchRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// ============================================================================
// HOOK
// ============================================================================

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
