# De-Emergent Refactor — Design

**Date:** 2026-05-25
**Goal:** Remove all Emergent platform dependencies so the app runs entirely on keys the owner controls (Anthropic + OpenAI), with a simple self-managed login.

## Overview

Emergent is woven into three areas. Each is replaced with a self-contained equivalent:

| Area | From (Emergent) | To |
|------|-----------------|-----|
| Chat + story LLM | `emergentintegrations.LlmChat` + `EMERGENT_LLM_KEY` | OpenRouter (OpenAI-compatible) via `openai` SDK + `OPENROUTER_API_KEY` |
| Auth | Google OAuth via `auth.emergentagent.com` / `demobackend.emergentagent.com` | Simple email+name dev login, backend-issued session tokens |
| Avatars | DALL-E 3 with Gemini-via-Emergent fallback | DALL-E 3 only (`OPENAI_API_KEY`), graceful "not configured" if absent |
| Config/misc | `.emergent/`, `.gitconfig`, doc references | Removed / updated |

## 1. LLM Layer

Create a small module `backend/llm_client.py` wrapping OpenRouter (OpenAI-compatible) so `server.py` and `story_engine.py` share one implementation. Reuses the `openai` SDK pointed at `https://openrouter.ai/api/v1`.

- `async def complete(system: str, messages: list[dict], max_tokens: int = 1024) -> str` — a single chat completion using the model from `OPENROUTER_MODEL` (default `anthropic/claude-sonnet-4.5`) via `AsyncOpenAI(base_url=..., api_key=OPENROUTER_API_KEY)`. The system prompt is sent as the first `{"role": "system"}` message; `messages` are the `{"role": "user"|"assistant", "content": str}` turns.
- `OPENROUTER_API_KEY` read from environment; if missing, `complete` raises so callers hit their existing fallbacks.
- `_generate_assistant_reply` in `server.py` builds the `messages` array from chat history (mapping stored roles to `user`/`assistant`) and calls `complete(system_message, messages)`. The last history entry is the new user prompt. This replaces the `LlmChat` replay-one-message-at-a-time loop.
- `story_engine.py`'s `_llm_json_call` switches to `complete()` with a single user message, then parses JSON from the response as it does today.
- Existing graceful error handling is preserved: chat returns the in-character "my mind drifted" fallback on any error; story functions return safe defaults.
- `backend/regenerate_avatars.py` (Emergent-only Gemini script) is deleted; `generate_seed_avatars.py` already covers DALL-E seeding.

## 2. Auth — Simple Dev Login

### Backend
- Replace `POST /auth/google` with `POST /auth/login` taking `{email, name}` (`LoginRequest` model replaces `SessionRequest`).
- Behavior: find-or-create user by email; generate token via `secrets.token_urlsafe(32)`; upsert into `user_sessions` with 7-day expiry; return `{session_token, user}`.
- `get_current_user` and `get_current_user_optional` are unchanged (token lookup against `user_sessions`).
- Remove the `httpx` call to `demobackend.emergentagent.com`.

### Frontend
- `src/context/auth.tsx`: remove the `auth.emergentagent.com` redirect, `WebBrowser.openAuthSessionAsync`, and `session_id` URL/deep-link extraction. Change `signIn` signature to `signIn(email: string, name: string) => Promise<void>` which POSTs to `/auth/login`, stores the returned token, and sets the user. `processSessionId` is removed from the context value. On mount, the effect only calls `refresh()` (token check).
- `app/login.tsx`: replace the "Continue with Google" button with two `TextInput`s (email, name) and a "Continue" button that calls `signIn(email, name)`. Keep the existing hero/branding layout.

## 3. Avatars & Config

- `generate_avatar` endpoint: remove the entire Gemini fallback block; keep the DALL-E 3 path. If `openai_client is None`, return `HTTPException(400, "Image generation not configured")`. Frontend already falls back to the preset avatar pool on failure.
- `backend/requirements.txt`: remove `emergentintegrations==0.1.0`; add `anthropic>=0.39.0`.
- Delete `.emergent/emergent.yml` (and the `.emergent/` dir if empty).
- `.gitconfig`: set to neutral values (name `developer`, email `dev@localhost`).
- Update `memory/PRD.md` and `docs/superpowers/specs/2026-05-24-...-design.md` references from Emergent to Anthropic/OpenAI.
- Add `backend/.env.example` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MONGO_URL`, `DB_NAME`) and `frontend/.env.example` (`EXPO_PUBLIC_BACKEND_URL`).
- Add `.gitignore` entries: `frontend/.metro-cache/`, `**/.env`.

## Testing

- **Backend unit tests:**
  - `/auth/login` creates a new user and issues a token; calling again with the same email returns the existing user with a fresh token.
  - `get_current_user` accepts the issued token and rejects unknown/expired tokens.
  - `_generate_assistant_reply` builds the correct `messages` array (mock the Anthropic client) and returns the fallback string when the client raises.
- **Manual:** run backend + Expo web; log in with email/name; start a chat; confirm a Claude reply renders and relationship meters update.

## Out of Scope

- Real OAuth / password auth (dev login is intentional for now; can upgrade later).
- Replacing OpenAI for avatars with another provider.
- Any change to character data, story engine logic, or UI beyond the login screen.
