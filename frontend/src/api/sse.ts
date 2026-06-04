/**
 * Cross-platform Server-Sent Events client for streaming chat replies.
 *
 * On web we use `fetch` + `response.body.getReader()` with a tiny SSE parser
 * (the native browser EventSource doesn't support POST or custom headers).
 *
 * On native we use the `react-native-sse` polyfill which mirrors the
 * EventSource API and does support POST + headers.
 */
import { Platform } from 'react-native';
// @ts-ignore - shipped as untyped default export
import RNEventSource from 'react-native-sse';

import { getToken } from '@/src/api/client';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export interface StreamMetaPayload {
  user_message: {
    id: string;
    chat_id: string;
    role: 'user';
    content: string;
    created_at?: string;
  };
  assistant_message_id: string;
}

export interface StreamDeltaPayload {
  text: string;
}

export interface StreamStoryPayload {
  chapter: number;
  meters: { trust: number; affection: number; rivalry: number; fear: number };
  chapter_transition?: { title: string; summary: string; previous_chapter?: string } | null;
  ending?: string;
  completed?: boolean;
}

export interface StreamHandlers {
  onMeta?: (data: StreamMetaPayload) => void;
  onDelta?: (data: StreamDeltaPayload) => void;
  onStory?: (data: StreamStoryPayload) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

/**
 * Stream an assistant reply for a chat. Returns a cancel function that aborts
 * the in-flight stream. Handlers are best-effort: callers should treat
 * `onDone` as the canonical "stream complete" signal.
 */
export async function streamMessage(
  chatId: string,
  content: string,
  handlers: StreamHandlers,
): Promise<() => void> {
  const token = await getToken();
  if (!token) {
    handlers.onError?.(new Error('Not authenticated'));
    return () => {};
  }
  const url = `${BASE_URL}/api/chats/${chatId}/messages/stream`;
  const body = JSON.stringify({ content });
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${token}`,
  };

  if (Platform.OS === 'web') {
    return streamFetchWeb(url, body, headers, handlers);
  }
  return streamNative(url, body, headers, handlers);
}

// ---------- Web: fetch + ReadableStream ----------

async function streamFetchWeb(
  url: string,
  body: string,
  headers: Record<string, string>,
  handlers: StreamHandlers,
): Promise<() => void> {
  const controller = new AbortController();
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    controller.abort();
  };

  try {
    const resp = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch {}
      const err: any = new Error(
        (parsed?.detail && typeof parsed.detail === 'string')
          ? parsed.detail
          : (text || `Stream failed (${resp.status})`),
      );
      err.status = resp.status;
      err.data = parsed;
      handlers.onError?.(err);
      return cancel;
    }
    if (!resp.body) {
      handlers.onError?.(new Error('Stream not supported by this browser'));
      return cancel;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    (async () => {
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE events are separated by a blank line ("\n\n").
          let sepIndex: number;
          while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            dispatchEvent(rawEvent, handlers);
          }
        }
        // Flush any trailing event.
        if (buffer.trim()) dispatchEvent(buffer, handlers);
        if (!cancelled) handlers.onDone?.();
      } catch (e) {
        if (!cancelled) handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
  }
  return cancel;
}

function dispatchEvent(raw: string, handlers: StreamHandlers) {
  let eventName = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  const dataStr = dataLines.join('\n');
  let data: any = null;
  if (dataStr) {
    try { data = JSON.parse(dataStr); } catch { data = dataStr; }
  }
  switch (eventName) {
    case 'meta':  handlers.onMeta?.(data); break;
    case 'delta': handlers.onDelta?.(data); break;
    case 'story': handlers.onStory?.(data); break;
    case 'done':  handlers.onDone?.(); break;
    case 'error': {
      // Attach status/data on the Error so consumers can detect server-sent
      // paywalls or other structured errors mid-stream, just like the
      // preflight !resp.ok path does.
      const err: any = new Error(data?.message || 'Stream error');
      err.status = data?.status ?? 0;
      err.data = data;
      handlers.onError?.(err);
      break;
    }
  }
}

// ---------- Native: react-native-sse ----------

function streamNative(
  url: string,
  body: string,
  headers: Record<string, string>,
  handlers: StreamHandlers,
): () => void {
  const es = new RNEventSource(url, { method: 'POST', headers, body });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { es.close(); } catch {}
  };

  const onTyped = (name: 'meta' | 'delta' | 'story' | 'done' | 'error', cb: (data: any) => void) => {
    es.addEventListener(name, (e: any) => {
      let data: any = null;
      if (e?.data) {
        try { data = JSON.parse(e.data); } catch { data = e.data; }
      }
      cb(data);
    });
  };

  onTyped('meta',  (d) => handlers.onMeta?.(d));
  onTyped('delta', (d) => handlers.onDelta?.(d));
  onTyped('story', (d) => handlers.onStory?.(d));
  onTyped('done',  () => { handlers.onDone?.(); close(); });
  onTyped('error', (d) => {
    const err: any = new Error(d?.message || 'Stream error');
    err.status = d?.status ?? 0;
    err.data = d;
    handlers.onError?.(err);
    close();
  });

  return close;
}
