import { storage } from '@/src/utils/storage';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = 'session_token';

export async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, '' as string);
}

export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  auth?: boolean;
  timeoutMs?: number;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 60000 } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    const data = text ? JSON.parse(text) : ({} as any);
    if (!resp.ok) {
      const message = data?.detail || `Request failed (${resp.status})`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data as T;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
