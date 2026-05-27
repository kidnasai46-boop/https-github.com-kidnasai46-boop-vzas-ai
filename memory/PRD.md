# VZAS.AI – AI Character Chat App

Inspired by Character.AI / PolyBuzz / Janitor.AI. React Native (Expo) + FastAPI/MongoDB.

## Stack
- **Frontend:** Expo Router, TypeScript, expo-haptics, expo-linear-gradient, expo-blur
- **Backend:** FastAPI + MongoDB (motor)
- **AI:** Claude Sonnet 4.5 (chat + story engine) via OpenRouter; DALL-E 3 (avatar gen) via OpenAI API
- **Auth:** Self-managed email/name dev login with backend-issued session tokens

## Feature Highlights
### Discover
- 53 hand-written seeded characters across 8 categories: Romance (12), Helpers (7), Heroes (7), Original (6), Anime (6), Historical (6), Gaming (5), Mystery (4)
- Category tabs: Trending · Favorites · All · Anime · Romance · Helpers · Heroes · Mystery · Gaming · Historical · Original
- Trending feed (weighted by chats + favorites × 3)
- Featured carousel + search (name / tagline / tags)
- ❤ Favorite system with per-character counter and "Favorites" filter

### Chat experience
- 1-on-1 text chat with Claude Sonnet 4.5 in character
- **Multiple scenarios per character** (bottom-sheet picker before chat starts)
- **User Persona** (name, age, gender, bio) — injected into the AI system prompt so characters address you by name and weave your details into the story
- **Regenerate** button on every AI reply
- **Simulated word-by-word streaming** with cursor for that real-chat feel
- Haptic feedback on key interactions

### Create
- 3-step character wizard: basics → AI-generated avatar (Nano Banana) → personality/greeting/tags
- Custom characters stored under your account, appear in Profile

### Profile
- Persona editor card with quick access
- List of your created characters
- Google sign-out

## API surface (selected)
- `POST /api/auth/google` · `GET /api/auth/me` · `POST /api/auth/logout` · `PATCH /api/auth/me/persona`
- `GET /api/characters?category=&genre=&search=&favorites_only=`
- `GET /api/characters/trending` · `GET /api/characters/featured` · `GET /api/characters/categories`
- `GET /api/characters/mine` · `GET /api/characters/{id}` · `POST /api/characters`
- `POST /api/characters/{id}/favorite` · `DELETE /api/characters/{id}/favorite`
- `POST /api/characters/generate-avatar`
- `GET /api/chats` · `POST /api/chats/start/{character_id}` (with optional `scenario_id`, `fresh`)
- `GET /api/chats/{id}` · `POST /api/chats/{id}/messages` · `POST /api/chats/{id}/regenerate` · `DELETE /api/chats/{id}`

## Data model
- `users` (user_id, email, name, picture, persona{name,age,gender,bio})
- `user_sessions` (session_token, user_id, expires_at TTL)
- `characters` (id, name, tagline, description, personality, backstory, greeting, avatar, genre, category, tags, scenarios[], is_official, creator_id, chat_count, favorite_count)
- `chats` (id, user_id, character_id, scenario_id, scenario_title, last_message, last_message_at)
- `messages` (id, chat_id, role, content, created_at)
- `favorites` (user_id, character_id, created_at) — unique compound index

## Known constraints
- Avatar images are curated Unsplash/Pexels stock — for the **anime** category they're stylised realistic portraits (not actual anime art) since AI generation of every seed would be cost-prohibitive
- True LLM streaming not yet wired (we simulate it on the frontend); next round we'd switch to provider-native streaming
- No moderation/safety layer on user-created characters yet

## Roadmap (what's still missing)
- Subscription tiers (Stripe) + paywall
- Voice chat (OpenAI TTS + Whisper STT)
- Group chats (multiple characters)
- Push notifications (re-engagement)
- Content moderation
- Edit/delete user-created characters
- Multiple greetings per character (we have multi-scenario; this would be variations on the same scenario)
- Character ratings / "for you" recommendation feed
