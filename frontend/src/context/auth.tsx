import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, clearToken, getToken, setToken } from '@/src/api/client';

export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  persona?: {
    name?: string;
    age?: string;
    gender?: string;
    bio?: string;
  };
  is_subscribed?: boolean;
  nsfw_messages_used?: number;
  sfw_messages_today?: number;
  sfw_count_date?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const data = await api<{ user: AuthUser }>('/auth/me');
      setUser(data.user);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  const signIn = useCallback(async (email: string, name?: string) => {
    const data = await api<{ session_token: string; user: AuthUser }>(
      '/auth/login',
      { method: 'POST', body: { email, name }, auth: false }
    );
    await setToken(data.session_token);
    setUser(data.user);
  }, []);

  // On mount: check for an existing token
  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
