import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { api, clearToken, getToken, setToken } from '@/src/api/client';

export interface AuthUser {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  processSessionId: (sessionId: string) => Promise<void>;
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

  const processSessionId = useCallback(async (sessionId: string) => {
    const data = await api<{ session_token: string; user: AuthUser }>(
      '/auth/google',
      { method: 'POST', body: { session_id: sessionId }, auth: false }
    );
    await setToken(data.session_token);
    setUser(data.user);
  }, []);

  // Helper to extract session_id from a URL (mobile deep link)
  const extractSessionId = (url: string | null): string | null => {
    if (!url) return null;
    try {
      // Match either ?session_id= or #session_id=
      const m = url.match(/[?#]session_id=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : null;
    } catch {
      return null;
    }
  };

  // On mount: web URL hash, then existing token
  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const fromUrl =
            extractSessionId(window.location.hash) ||
            extractSessionId(window.location.search);
          if (fromUrl) {
            try {
              await processSessionId(fromUrl);
            } finally {
              try {
                window.history.replaceState(null, '', window.location.pathname);
              } catch {}
            }
            setLoading(false);
            return;
          }
        } else {
          // mobile cold start
          const initial = await Linking.getInitialURL();
          const fromUrl = extractSessionId(initial);
          if (fromUrl) {
            await processSessionId(fromUrl);
            setLoading(false);
            return;
          }
        }
        await refresh();
      } finally {
        setLoading(false);
      }
    })();

    // Hot deep-link listener (mobile)
    let sub: { remove: () => void } | null = null;
    if (Platform.OS !== 'web') {
      sub = Linking.addEventListener('url', async ({ url }) => {
        const id = extractSessionId(url);
        if (id) {
          try {
            await processSessionId(id);
          } catch {}
        }
      });
    }
    return () => {
      sub?.remove();
    };
  }, [refresh, processSessionId]);

  const signIn = useCallback(async () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const redirect = window.location.origin + '/';
      window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL('auth');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirect)}`;
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
    if (result.type === 'success' && result.url) {
      const id = extractSessionId(result.url);
      if (id) await processSessionId(id);
    }
  }, [processSessionId]);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, processSessionId }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
