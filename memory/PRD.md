# Personae – AI Character Chat App

A React Native (Expo) mobile app that lets users chat with curated AI characters, create their own with AI-generated avatars, and have immersive narrative-driven conversations.

## Stack
- **Frontend:** Expo Router (React Native), TypeScript
- **Backend:** FastAPI + MongoDB (motor)
- **AI:** Anthropic Claude Sonnet 4.5 (chat) + Gemini 3.1 Flash Image (Nano Banana) for avatar generation, both via Emergent Universal LLM Key
- **Auth:** Emergent-managed Google OAuth

## Key Features (MVP)
- Onboarding with 3 swipeable panels
- Google sign-in
- Discover screen with featured carousel, genre filter, search, 13 seeded SFW characters
- Character profile screen with About / Personality / Backstory / Tags
- 1-on-1 text chat with Claude Sonnet 4.5 playing the character (with full conversation history per chat)
- Create-Character wizard (3 steps: basics → AI-generated avatar → personality/greeting/tags)
- Chats list with last message preview, long-press to delete
- Profile screen with user's created characters and sign-out

## API Endpoints
- `POST /api/auth/google` – exchange Emergent `session_id` for a 7-day session
- `GET /api/auth/me` – current user
- `POST /api/auth/logout`
- `GET /api/characters?genre=&search=` – browse
- `GET /api/characters/featured`
- `GET /api/characters/mine` – user-created characters
- `GET /api/characters/{id}`
- `POST /api/characters` – create custom character
- `POST /api/characters/generate-avatar` – Nano Banana avatar gen, returns base64 data URI
- `GET /api/chats` – my chats with character info
- `POST /api/chats/start/{character_id}` – open/create chat, seeds greeting
- `GET /api/chats/{chat_id}` – full chat + messages
- `POST /api/chats/{chat_id}/messages` – send + receive AI reply
- `DELETE /api/chats/{chat_id}`

## Data Model
- `users` (user_id, email, name, picture)
- `user_sessions` (session_token, user_id, expires_at TTL)
- `characters` (id, name, tagline, description, personality, backstory, greeting, avatar, genre, tags, is_official, creator_id, chat_count)
- `chats` (id, user_id, character_id, last_message, last_message_at)
- `messages` (id, chat_id, role, content, created_at)

## Business Enhancement Idea
**Trending Characters of the Week** + a premium "Mood Mode" (Romantic / Adventurous / Dark) that shifts character tone — easy upsell for a Pro tier later.
