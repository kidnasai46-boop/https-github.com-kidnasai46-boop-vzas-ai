# VZAS.AI Enhancement Spec: Characters + DALL-E 3 + Living Stories

**Date:** 2026-05-24
**Status:** Draft
**Scope:** Three interconnected enhancements to the VZAS.AI character chat app

---

## 1. Overview

Three enhancements shipping together:

1. **Character Expansion** — Add 45 new characters from the Character Bible, merged alongside the existing 53 seed characters
2. **DALL-E 3 Avatar Integration** — Replace the existing Gemini-based avatar generator with OpenAI DALL-E 3, plus a seed script to generate portraits for all characters
3. **Living Stories Engine (v1)** — AI-driven interactive story arcs with consequence memory and relationship meters

## 2. Character Data Expansion

### 2.1 Source

45 characters from `Character_Bible_45_Launch_Characters.docx`, organized by genre:
- Fantasy (8): Elara the Enchantress, Kaelron the Fallen Crown, Thistle, Seraphina Blackthorn, Grimshaw the Wanderer, Lyra Dawnshield, Fen, Bramble
- Romance (7): Maren Delacroix, Jasper Hale, Nadia Vasquez, Ezra Kim, Rowan Ashby, Vivienne Laurent, Atlas Reyes
- Sci-Fi (7): ARIA-7, Captain Voss Kraine, Dr. Lena Vasari, Zarek-9, Jinx, Commander Yuki Tanaka, Echo
- Horror (5): The Archivist, Milo Graves, Dr. Iris Morel, The Passenger, Wren Holloway
- Comedy (5): Greg the Orc, Maeve Murphy, Lord Reginald von Fluffington III, Professor Ozymandias Quirk, Dave
- Anime (5): Hana Tsukimori, Ren Aoyagi, Sakura Ito, Kai Nakamura, Yuki Shirogane
- Slice of Life (5): Sam the Barber, Luna Mendez, Chef Dae-Jung Park, Margot Liu, Tomas Rivera
- Historical (3): Captain Isolde Wrynn, Elias Thorne, Amara Osei

### 2.2 Data Mapping

Each Character Bible entry maps to the existing `Character` model as follows:

| Bible Field | Model Field | Notes |
|-------------|-------------|-------|
| Character name | `name` | |
| Tagline (line below name) | `tagline` | |
| Tagline (repeated) | `description` | Same as tagline for Bible characters |
| Personality & System Prompt | `personality` | Full personality text verbatim |
| Personality & System Prompt | `backstory` | Same text — Bible doesn't separate these |
| Scenario 1 greeting text | `greeting` | Default greeting |
| Genre header | `genre` | Fantasy, Romance, Sci-Fi, Horror, Comedy, Anime, Slice of Life, Historical |
| "Original" | `category` | All Bible characters are originals |
| Derived from personality | `tags` | Extract 4-6 keyword tags from the personality text |
| All scenarios | `scenarios` | Array of `{id, title, description, first_message}` |

### 2.3 New Genres

The existing app has: Fantasy, Sci-Fi, Romance, Mystery, Drama, Adventure.

New genres added by the Bible: **Horror, Comedy, Anime, Slice of Life, Historical**.

The frontend genre filter (currently hardcoded in `create.tsx` as `GENRES`) must be updated to include these.

### 2.4 Merge Strategy

- All 53 existing characters remain unchanged
- All 45 Bible characters are added as new entries
- Overlap check: existing "Yuki Tanaka" (anime character) vs. Bible's "Commander Yuki Tanaka" (sci-fi) — different characters, both kept as-is
- No other name collisions detected
- `is_official: True` for all Bible characters (same as existing seeds)

### 2.5 Implementation

- Add 45 new entries to `SEED_CHARACTERS` list in `backend/seed_data.py`
- Avatar field initially set to a placeholder URL from the existing avatar pool (`A` dict)
- Avatars will be replaced by the DALL-E 3 seed script (Section 3.3)

## 3. DALL-E 3 Avatar Integration

### 3.1 Backend Endpoint Change

Replace the existing `/api/characters/generate-avatar` endpoint implementation.

**Current:** Uses `emergentintegrations` LLM library with Gemini `gemini-3.1-flash-image-preview` model.

**New:** Uses OpenAI Python SDK with `dall-e-3` model.

```
POST /api/characters/generate-avatar
Request:  { "prompt": "character description text" }
Response: { "avatar": "data:image/png;base64,..." }
```

The API contract (request/response format) stays identical. The frontend requires zero changes.

**Implementation details:**
- Add `openai` to `requirements.txt`
- New env var: `OPENAI_API_KEY`
- Image spec: 1024x1024, standard quality, style "vivid"
- Prompt template: `"Cinematic close-up character portrait, fictional persona, vertical 1:1 framing, dramatic moody lighting, ultra-detailed, digital art style. Character description: {user_prompt}"`
- Download the generated image URL, convert to base64, return in the existing format
- Keep the existing Gemini code as a commented fallback during transition
- Cost: ~$0.04 per generation (standard quality) or ~$0.08 (HD quality). Use standard.

### 3.2 Error Handling

- OpenAI content policy rejections: return HTTP 400 with a user-friendly message ("Could not generate this image. Try adjusting the description.")
- Rate limits: return HTTP 429 with retry-after guidance
- Timeout: 60-second timeout on the OpenAI call

### 3.3 Seed Avatar Script

New file: `backend/generate_seed_avatars.py`

Standalone script that:
1. Connects to MongoDB
2. Iterates all characters where `is_official == True`
3. For each, builds a portrait prompt from the character's `personality` field (first 200 chars + name)
4. Calls DALL-E 3 to generate a 1024x1024 portrait
5. Stores the base64 result directly in the character's `avatar` field in MongoDB
6. Skips characters whose `avatar` field already starts with `data:` (already generated)
7. Rate-limited: 1 request per 2 seconds to stay within OpenAI tier limits
8. Logs progress: `"Generated avatar for {name} ({i}/{total})"`

**Run once after deployment.** Estimated cost: ~$4 for ~98 characters at $0.04/image.

### 3.4 Dependencies

- `openai>=1.0.0` added to `requirements.txt`
- `httpx` already present (used for downloading generated image URLs)

## 4. Living Stories Engine (v1)

### 4.1 Concept

Every character is the entry point to a structured narrative — not just a conversation. Characters have story arcs with chapters, branching consequences, and relationship meters. Users experience a story that unfolds based on their choices, with visible emotional feedback and multiple possible endings.

### 4.2 Core Mechanics (v1 Scope)

1. **Story Arcs with Chapters** — 3-5 chapter narratives with good/bad/secret endings
2. **Consequence Memory** — Choices from early chapters affect later chapters
3. **Relationship Meters** — Trust, Affection, Rivalry, Fear — visible to the user

**Deferred to v2:** Checkpoint/rewind system, shared leaderboards, creator story templates.

### 4.3 Data Model

#### 4.3.1 Story Arc (generated per chat, stored in `story_arcs` collection)

```json
{
  "id": "arc_uuid",
  "character_id": "char_uuid",
  "chat_id": "chat_uuid",
  "title": "The Cursed Cartographer",
  "total_chapters": 4,
  "chapters": [
    {
      "number": 1,
      "title": "The Map That Bleeds",
      "summary": "Grimshaw discovers a map that changes when blood touches it...",
      "target_messages": 18,
      "themes": ["discovery", "trust", "danger"]
    },
    {
      "number": 2,
      "title": "The Living Ink",
      "summary": "The map begins drawing itself, revealing a path...",
      "target_messages": 18,
      "themes": ["alliance", "betrayal", "choice"]
    }
  ],
  "possible_endings": [
    { "type": "good", "condition": "High trust, chose to protect the map" },
    { "type": "bad", "condition": "Low trust or destroyed the map" },
    { "type": "secret", "condition": "Found the hidden third path in chapter 3" }
  ],
  "generated_at": "2026-05-24T00:00:00Z"
}
```

#### 4.3.2 Story State (embedded in `chats` collection, new field)

```json
{
  "story_state": {
    "arc_id": "arc_uuid",
    "arc_title": "The Cursed Cartographer",
    "chapter": 1,
    "total_chapters": 4,
    "messages_in_chapter": 7,
    "choices_made": [
      {
        "chapter": 1,
        "message_index": 5,
        "choice": "Trusted Grimshaw with the bleeding map",
        "impact": "positive"
      }
    ],
    "meters": {
      "trust": 65,
      "affection": 40,
      "rivalry": 10,
      "fear": 0
    },
    "ending": null,
    "completed": false
  }
}
```

#### 4.3.3 Chapter Transition Message

Messages with `type: "chapter_transition"` are stored in the `messages` collection:

```json
{
  "id": "msg_uuid",
  "chat_id": "chat_uuid",
  "role": "system",
  "type": "chapter_transition",
  "content": "Chapter 1 Complete: The Map That Bleeds",
  "chapter_summary": "You chose to trust Grimshaw with the map. Your bond deepened.",
  "meters_snapshot": { "trust": 65, "affection": 40, "rivalry": 10, "fear": 0 },
  "created_at": "2026-05-24T00:00:00Z"
}
```

### 4.4 Story Arc Generation

When `POST /chats/start/{character_id}` is called and the character has no active chat:

1. Build a prompt using the character's personality, genre, and scenarios
2. Call Claude with a structured generation prompt:
   ```
   Generate a story arc for this character. Return JSON with:
   - title: compelling arc name
   - total_chapters: 3-5
   - chapters: [{number, title, summary, target_messages: 15-20, themes: [3 words]}]
   - possible_endings: [{type: "good"|"bad"|"secret", condition: string}]
   ```
3. Parse the JSON response
4. Store in `story_arcs` collection
5. Inject Chapter 1 context into the character's system prompt
6. Initialize `story_state` on the chat document with default meters (all at 50 except fear at 0)

### 4.5 Chapter Progression

After every assistant message in `POST /chats/{id}/messages`:

**Steps 1+2 — Meter Update + Choice Detection (single call, every message):**
Make one lightweight Claude call with the last user message + assistant response + current meters:
```
Evaluate this exchange. Return JSON:
{
  "meter_changes": {"trust": +5, "affection": 0, "rivalry": -3, "fear": 0},
  "choice": null | {"choice": "refused to open the cursed book", "impact": "neutral"}
}
meter_changes: values between -10 and +10. Most messages change 1-2 meters by 2-5 points.
choice: only if the user made a significant narrative decision. null otherwise.
```
Update `story_state.meters` (clamped to 0-100). If a choice was detected, append to `story_state.choices_made` with the current chapter and message index.

**Step 3 — Chapter Advancement (when `messages_in_chapter >= target_messages`):**
Call Claude with the full chapter context:
```
The user has been in Chapter {N} for {M} messages. Based on the conversation,
choices made, and meter values, should the chapter advance?
If yes, return JSON: {advance: true, chapter_summary: "...", next_chapter_hook: "..."}
```
If advancing:
- Increment `story_state.chapter`
- Reset `messages_in_chapter` to 0
- Insert a `chapter_transition` message
- Update the system prompt with the new chapter's context and consequence history

**Step 4 — Ending Detection (final chapter only):**
When in the final chapter and conditions align, determine the ending type based on meters + choices. Set `story_state.ending` and `story_state.completed = true`. Insert a final transition message.

### 4.6 System Prompt Enhancement

The existing `build_system_prompt()` function is extended to include story context:

```
[existing character prompt]

STORY ARC: {arc_title}
CURRENT CHAPTER: {chapter_number} — {chapter_title}
{chapter_summary}

PREVIOUS CHOICES THE USER MADE:
- Chapter 1: {choice_description} (impact: {impact})
- Chapter 2: {choice_description} (impact: {impact})

RELATIONSHIP STATE:
Trust: {trust}/100 | Affection: {affection}/100 | Rivalry: {rivalry}/100 | Fear: {fear}/100

Weave the story naturally. Reference past choices when relevant.
Guide the narrative toward this chapter's themes: {themes}.
React according to the relationship meters — high trust means openness,
low trust means guardedness, high fear means the character is threatening.
Do not explicitly mention meters or game mechanics.
```

### 4.7 API Changes

#### Modified Endpoints

**`POST /chats/start/{character_id}`**
- After creating the chat, generate a story arc (Section 4.4)
- Return the chat with `story_state` included

**`POST /chats/{id}/messages`**
- After generating the assistant reply, run meter update + choice detection + chapter check
- Response adds new fields:
  ```json
  {
    "user_message": {...},
    "assistant_message": {...},
    "story_state": {
      "chapter": 1,
      "meters": {"trust": 65, "affection": 40, "rivalry": 10, "fear": 0},
      "chapter_transition": null | {
        "title": "Chapter 2: The Living Ink",
        "summary": "You chose to trust Grimshaw...",
        "previous_chapter": "The Map That Bleeds"
      }
    }
  }
  ```

**`GET /chats/{id}`**
- Include `story_state` in the chat response

#### New Endpoints

**`GET /api/chats/{id}/story`**
- Returns the full story arc details + current state
- Used by the character detail screen to show arc progress

### 4.8 Frontend Changes

#### Chat Screen (`chat/[id].tsx`)
- **Meter bar component**: 4 horizontal bars (Trust, Affection, Rivalry, Fear) displayed below the character header, color-coded (green, pink, orange, red), 0-100 scale
- **Chapter transition card**: When `story_state.chapter_transition` is present in a message response, render a styled card between messages showing the chapter title, summary, and updated meters
- **Story completion card**: When `story_state.completed` is true, show an ending card with the ending type and a "Play Again" button

#### Character Detail Screen (`character/[id].tsx`)
- Show story arc title if the user has an active story
- Show chapter progress indicator (e.g., "Chapter 2 of 4")
- Show "Start New Story" button for replaying with a different arc

#### Chats List (`(tabs)/chats.tsx`)
- Show current chapter indicator on each chat card (e.g., "Ch. 2/4")

### 4.9 MongoDB Indexes

New indexes for the `story_arcs` collection:
```python
await db.story_arcs.create_index("id", unique=True)
await db.story_arcs.create_index("chat_id")
await db.story_arcs.create_index("character_id")
```

## 5. Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `OPENAI_API_KEY` | DALL-E 3 image generation + avatar seed script | Yes (new) |
| `MONGO_URL` | MongoDB connection | Yes (existing) |
| `DB_NAME` | Database name | Yes (existing) |
| `EMERGENT_LLM_KEY` | Claude LLM for chat + story engine | Yes (existing) |

## 6. Cost Estimates

| Feature | Cost | Frequency |
|---------|------|-----------|
| Seed avatar generation | ~$4 | One-time |
| User avatar generation | ~$0.04/image | Per generation |
| Story arc generation | ~$0.01 | Per new chat |
| Meter update per message | ~$0.002 | Per message |
| Chapter advancement check | ~$0.005 | Every ~18 messages |

## 7. Out of Scope (v2)

- Checkpoint/rewind system
- Shared story leaderboards ("47% got the secret ending")
- Creator story templates in the bot creation wizard
- Multiple simultaneous story arcs per character
- Cross-character story connections
