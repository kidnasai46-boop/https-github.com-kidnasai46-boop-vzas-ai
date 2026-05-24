from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta

from emergentintegrations.llm.chat import LlmChat, UserMessage

from seed_data import SEED_CHARACTERS

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Models ----------
class Persona(BaseModel):
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    bio: Optional[str] = None


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    persona: Persona = Field(default_factory=Persona)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SessionRequest(BaseModel):
    session_id: str


class Scenario(BaseModel):
    id: str
    title: str
    description: str
    first_message: str


class Character(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    tagline: str
    description: str
    personality: str
    backstory: str
    greeting: str
    avatar: str
    genre: str
    category: str = "Original"
    tags: List[str] = []
    scenarios: List[Scenario] = []
    creator_id: Optional[str] = None
    is_official: bool = False
    chat_count: int = 0
    favorite_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CharacterCreate(BaseModel):
    name: str
    tagline: str
    description: str
    personality: str
    backstory: str
    greeting: str
    avatar: str
    genre: str
    category: Optional[str] = "Original"
    tags: List[str] = []
    scenarios: List[Scenario] = []


class AvatarGenRequest(BaseModel):
    prompt: str


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    chat_id: str
    role: str
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Chat(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    character_id: str
    scenario_id: Optional[str] = None
    scenario_title: Optional[str] = None
    last_message: str = ""
    last_message_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StartChatRequest(BaseModel):
    scenario_id: Optional[str] = None
    fresh: bool = False  # if True, start a NEW chat even if one exists


class SendMessageRequest(BaseModel):
    content: str


class PersonaUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[str] = None
    gender: Optional[str] = None
    bio: Optional[str] = None


# ---------- Auth ----------
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


async def get_current_user_optional(authorization: Optional[str] = Header(None)) -> Optional[dict]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None


# ---------- Auth Endpoints ----------
@api_router.post("/auth/google")
async def google_auth(req: SessionRequest):
    async with httpx.AsyncClient(timeout=15) as http_client:
        resp = await http_client.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": req.session_id},
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Emergent session_id")
        data = resp.json()

    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        new_user = User(user_id=user_id, email=email, name=data.get("name", email), picture=data.get("picture")).dict()
        await db.users.insert_one(dict(new_user))

    session_token = data["session_token"]
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {
            "session_token": session_token,
            "user_id": user_id,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"session_token": session_token, "user": user}


@api_router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    return {"user": user}


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"success": True}


@api_router.patch("/auth/me/persona")
async def update_persona(req: PersonaUpdate, user: dict = Depends(get_current_user)):
    persona = {k: v for k, v in req.dict().items() if v is not None}
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {f"persona.{k}": v for k, v in persona.items()}}
    )
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"user": updated}


# ---------- Characters ----------
@api_router.get("/characters")
async def list_characters(
    category: Optional[str] = None,
    genre: Optional[str] = None,
    search: Optional[str] = None,
    favorites_only: bool = False,
    limit: int = 200,
    user: Optional[dict] = Depends(get_current_user_optional),
):
    q: Dict[str, Any] = {}
    if category and category.lower() not in ("all", ""):
        q["category"] = category
    if genre and genre.lower() not in ("all", ""):
        q["genre"] = genre
    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"tagline": {"$regex": search, "$options": "i"}},
            {"tags": {"$regex": search, "$options": "i"}},
        ]

    if favorites_only:
        if not user:
            raise HTTPException(status_code=401, detail="Login required for favorites")
        favs = await db.favorites.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
        ids = [f["character_id"] for f in favs]
        if not ids:
            return {"characters": []}
        q["id"] = {"$in": ids}

    docs = await db.characters.find(q, {"_id": 0}).sort("chat_count", -1).limit(limit).to_list(limit)

    # Mark favorited for current user
    if user and docs:
        char_ids = [d["id"] for d in docs]
        fav_set = {f["character_id"] async for f in db.favorites.find(
            {"user_id": user["user_id"], "character_id": {"$in": char_ids}},
            {"_id": 0}
        )}
        for d in docs:
            d["is_favorited"] = d["id"] in fav_set
    else:
        for d in docs:
            d["is_favorited"] = False

    return {"characters": docs}


@api_router.get("/characters/featured")
async def featured_characters(user: Optional[dict] = Depends(get_current_user_optional)):
    docs = await db.characters.find({"is_official": True}, {"_id": 0}).sort("chat_count", -1).limit(8).to_list(8)
    if user and docs:
        char_ids = [d["id"] for d in docs]
        fav_set = {f["character_id"] async for f in db.favorites.find(
            {"user_id": user["user_id"], "character_id": {"$in": char_ids}}, {"_id": 0}
        )}
        for d in docs:
            d["is_favorited"] = d["id"] in fav_set
    else:
        for d in docs:
            d["is_favorited"] = False
    return {"characters": docs}


@api_router.get("/characters/trending")
async def trending_characters(user: Optional[dict] = Depends(get_current_user_optional)):
    """Sorted by chat_count + favorite_count, limited to 10."""
    pipeline = [
        {"$match": {"is_official": True}},
        {"$addFields": {"_score": {"$add": [
            {"$ifNull": ["$chat_count", 0]},
            {"$multiply": [{"$ifNull": ["$favorite_count", 0]}, 3]},
        ]}}},
        {"$sort": {"_score": -1}},
        {"$limit": 10},
        {"$project": {"_id": 0, "_score": 0}},
    ]
    docs = await db.characters.aggregate(pipeline).to_list(10)
    if user and docs:
        char_ids = [d["id"] for d in docs]
        fav_set = {f["character_id"] async for f in db.favorites.find(
            {"user_id": user["user_id"], "character_id": {"$in": char_ids}}, {"_id": 0}
        )}
        for d in docs:
            d["is_favorited"] = d["id"] in fav_set
    else:
        for d in docs:
            d["is_favorited"] = False
    return {"characters": docs}


@api_router.get("/characters/categories")
async def categories():
    """List of all available categories with counts."""
    pipeline = [
        {"$group": {"_id": "$category", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    rows = await db.characters.aggregate(pipeline).to_list(50)
    return {"categories": [{"name": r["_id"], "count": r["count"]} for r in rows if r["_id"]]}


@api_router.get("/characters/mine")
async def my_characters(user: dict = Depends(get_current_user)):
    docs = await db.characters.find({"creator_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"characters": docs}


@api_router.get("/characters/{char_id}")
async def get_character(char_id: str, user: Optional[dict] = Depends(get_current_user_optional)):
    c = await db.characters.find_one({"id": char_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    if user:
        fav = await db.favorites.find_one({"user_id": user["user_id"], "character_id": char_id}, {"_id": 0})
        c["is_favorited"] = bool(fav)
    else:
        c["is_favorited"] = False
    return {"character": c}


@api_router.post("/characters")
async def create_character(payload: CharacterCreate, user: dict = Depends(get_current_user)):
    char = Character(
        **payload.dict(),
        creator_id=user["user_id"],
        is_official=False,
    )
    await db.characters.insert_one(dict(char.dict()))
    return {"character": char.dict()}


@api_router.post("/characters/{char_id}/favorite")
async def favorite_character(char_id: str, user: dict = Depends(get_current_user)):
    c = await db.characters.find_one({"id": char_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
    existing = await db.favorites.find_one({"user_id": user["user_id"], "character_id": char_id})
    if not existing:
        await db.favorites.insert_one({
            "user_id": user["user_id"],
            "character_id": char_id,
            "created_at": datetime.now(timezone.utc),
        })
        await db.characters.update_one({"id": char_id}, {"$inc": {"favorite_count": 1}})
    return {"is_favorited": True}


@api_router.delete("/characters/{char_id}/favorite")
async def unfavorite_character(char_id: str, user: dict = Depends(get_current_user)):
    result = await db.favorites.delete_one({"user_id": user["user_id"], "character_id": char_id})
    if result.deleted_count:
        await db.characters.update_one({"id": char_id}, {"$inc": {"favorite_count": -1}})
    return {"is_favorited": False}


@api_router.post("/characters/generate-avatar")
async def generate_avatar(req: AvatarGenRequest, user: dict = Depends(get_current_user)):
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"avatar_{uuid.uuid4().hex}",
            system_message="You generate cinematic, fictional character portrait avatars.",
        )
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])
        prompt_text = (
            "Cinematic close-up character portrait, fictional persona, no celebrities, "
            "vertical 1:1 framing, dramatic moody lighting, ultra-detailed. "
            f"Character description: {req.prompt}"
        )
        msg = UserMessage(text=prompt_text)
        _text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            raise HTTPException(status_code=500, detail="No image generated")
        img = images[0]
        mime = img.get("mime_type", "image/png")
        return {"avatar": f"data:{mime};base64,{img['data']}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Avatar generation failed")
        raise HTTPException(status_code=500, detail=f"Avatar generation failed: {str(e)}")


# ---------- Chats ----------
def build_system_prompt(char: dict, user: dict, scenario: Optional[dict]) -> str:
    persona = user.get("persona") or {}
    persona_lines = []
    if persona.get("name"):
        persona_lines.append(f"- Their name: {persona['name']}")
    if persona.get("age"):
        persona_lines.append(f"- Age: {persona['age']}")
    if persona.get("gender"):
        persona_lines.append(f"- Gender: {persona['gender']}")
    if persona.get("bio"):
        persona_lines.append(f"- About them: {persona['bio']}")
    persona_block = ""
    if persona_lines:
        persona_block = (
            "\nThe person you are speaking with has shared the following about themselves. "
            "Naturally incorporate this — refer to them by name when appropriate:\n"
            + "\n".join(persona_lines) + "\n"
        )

    scenario_block = ""
    if scenario:
        scenario_block = (
            f"\nCURRENT SCENARIO: {scenario.get('title', '')}\n"
            f"{scenario.get('description', '')}\n"
        )

    return (
        f"You are roleplaying as {char['name']}.\n"
        f"Tagline: {char.get('tagline', '')}\n"
        f"Personality: {char.get('personality', '')}\n"
        f"Backstory: {char.get('backstory', '')}\n"
        f"{scenario_block}"
        f"{persona_block}"
        "Stay fully in character at all times. Respond in first person as this character. "
        "Keep replies engaging, 1-4 sentences typically, immersive, and emotionally rich. "
        "Use *italic asterisks* for actions/expressions sparingly. "
        "Never break character or mention you are an AI. Adapt to the user's narrative direction. Keep content SFW."
    )


async def _generate_assistant_reply(chat_id: str, char: dict, user: dict, scenario: Optional[dict],
                                    history: List[dict]) -> str:
    """Replay history through Claude and get a fresh reply. Last message is treated as the new user prompt."""
    system_message = build_system_prompt(char, user, scenario)
    try:
        llm = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"chat_{chat_id}_{uuid.uuid4().hex[:8]}",
            system_message=system_message,
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")

        prior = history[:-1]
        for m in prior:
            if m["role"] == "user":
                try:
                    await llm.send_message(UserMessage(text=m["content"]))
                except Exception:
                    pass
        last_user = history[-1]
        return await llm.send_message(UserMessage(text=last_user["content"]))
    except Exception:
        logger.exception("LLM call failed")
        return "*looks away thoughtfully* Sorry, my mind drifted for a moment. Could you say that again?"


@api_router.get("/chats")
async def list_chats(user: dict = Depends(get_current_user)):
    chats = await db.chats.find({"user_id": user["user_id"]}, {"_id": 0}).sort("last_message_at", -1).to_list(200)
    char_ids = list({c["character_id"] for c in chats})
    chars = await db.characters.find({"id": {"$in": char_ids}}, {"_id": 0}).to_list(1000)
    char_map = {c["id"]: c for c in chars}
    for c in chats:
        c["character"] = char_map.get(c["character_id"])
    return {"chats": chats}


@api_router.post("/chats/start/{character_id}")
async def start_chat(character_id: str, req: Optional[StartChatRequest] = None,
                     user: dict = Depends(get_current_user)):
    req = req or StartChatRequest()
    char = await db.characters.find_one({"id": character_id}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Default greeting from scenario, if provided
    scenario = None
    greeting = char.get("greeting") or f"Hi, I'm {char['name']}. Nice to meet you!"
    scenario_title = None
    if req.scenario_id:
        for sc in (char.get("scenarios") or []):
            if sc.get("id") == req.scenario_id:
                scenario = sc
                greeting = sc.get("first_message") or greeting
                scenario_title = sc.get("title")
                break

    if not req.fresh:
        existing = await db.chats.find_one(
            {"user_id": user["user_id"], "character_id": character_id, "scenario_id": req.scenario_id},
            {"_id": 0},
        )
        if existing:
            return {"chat": existing}

    new_chat = Chat(
        user_id=user["user_id"],
        character_id=character_id,
        scenario_id=req.scenario_id,
        scenario_title=scenario_title,
        last_message=greeting[:200],
    )
    await db.chats.insert_one(dict(new_chat.dict()))

    greeting_msg = Message(chat_id=new_chat.id, role="assistant", content=greeting).dict()
    await db.messages.insert_one(dict(greeting_msg))
    await db.characters.update_one({"id": character_id}, {"$inc": {"chat_count": 1}})
    return {"chat": new_chat.dict()}


@api_router.get("/chats/{chat_id}")
async def get_chat(chat_id: str, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    messages = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return {"chat": chat, "character": char, "messages": messages}


@api_router.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, req: SendMessageRequest, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    user_msg = Message(chat_id=chat_id, role="user", content=req.content).dict()
    await db.messages.insert_one(dict(user_msg))

    history = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)

    scenario = None
    if chat.get("scenario_id"):
        for sc in (char.get("scenarios") or []):
            if sc.get("id") == chat["scenario_id"]:
                scenario = sc
                break

    reply_text = await _generate_assistant_reply(chat_id, char, user, scenario, history)

    assistant_msg = Message(chat_id=chat_id, role="assistant", content=reply_text).dict()
    await db.messages.insert_one(dict(assistant_msg))

    await db.chats.update_one(
        {"id": chat_id},
        {"$set": {"last_message": reply_text[:200], "last_message_at": datetime.now(timezone.utc)}},
    )

    return {"user_message": user_msg, "assistant_message": assistant_msg}


@api_router.post("/chats/{chat_id}/regenerate")
async def regenerate_message(chat_id: str, user: dict = Depends(get_current_user)):
    """Delete the most recent assistant message and generate a new one based on the prior history."""
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Find the most-recent assistant message
    last_assistant = await db.messages.find_one(
        {"chat_id": chat_id, "role": "assistant"},
        sort=[("created_at", -1)],
    )
    if not last_assistant:
        raise HTTPException(status_code=400, detail="No assistant message to regenerate")

    await db.messages.delete_one({"id": last_assistant["id"]})

    # Rebuild history (now ending at the user message)
    history = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    if not history or history[-1]["role"] != "user":
        # Was probably the greeting — just give a fresh greeting instead
        scenario = None
        if chat.get("scenario_id"):
            for sc in (char.get("scenarios") or []):
                if sc.get("id") == chat["scenario_id"]:
                    scenario = sc
                    break
        fresh_greeting = (scenario.get("first_message") if scenario else None) or char.get("greeting", f"Hi, I'm {char['name']}.")
        new_msg = Message(chat_id=chat_id, role="assistant", content=fresh_greeting).dict()
        await db.messages.insert_one(dict(new_msg))
        return {"assistant_message": new_msg}

    scenario = None
    if chat.get("scenario_id"):
        for sc in (char.get("scenarios") or []):
            if sc.get("id") == chat["scenario_id"]:
                scenario = sc
                break

    reply_text = await _generate_assistant_reply(chat_id, char, user, scenario, history)
    new_msg = Message(chat_id=chat_id, role="assistant", content=reply_text).dict()
    await db.messages.insert_one(dict(new_msg))
    await db.chats.update_one(
        {"id": chat_id},
        {"$set": {"last_message": reply_text[:200], "last_message_at": datetime.now(timezone.utc)}},
    )
    return {"assistant_message": new_msg}


@api_router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.chats.delete_one({"id": chat_id})
    await db.messages.delete_many({"chat_id": chat_id})
    return {"success": True}


@api_router.get("/")
async def root():
    return {"message": "VZAS.AI API"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Seed ----------
async def seed_data():
    for ch in SEED_CHARACTERS:
        existing = await db.characters.find_one({"name": ch["name"], "is_official": True}, {"_id": 0})
        if existing:
            # Update text fields, scenarios, tags — but NEVER overwrite the avatar once stored
            # (preserves AI-generated avatars across restarts)
            update = {
                "tagline": ch["tagline"],
                "description": ch["description"],
                "personality": ch["personality"],
                "backstory": ch["backstory"],
                "greeting": ch["greeting"],
                "genre": ch["genre"],
                "category": ch["category"],
                "tags": ch["tags"],
                "scenarios": ch.get("scenarios", []),
            }
            # Only set avatar if existing is missing one (defensive)
            if not existing.get("avatar"):
                update["avatar"] = ch["avatar"]
            await db.characters.update_one({"id": existing["id"]}, {"$set": update})
            continue
        doc = Character(**ch, is_official=True).dict()
        await db.characters.insert_one(dict(doc))
    logger.info(f"Seeded {len(SEED_CHARACTERS)} characters")


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.characters.create_index("id", unique=True)
        await db.characters.create_index("genre")
        await db.characters.create_index("category")
        await db.chats.create_index([("user_id", 1), ("last_message_at", -1)])
        await db.messages.create_index([("chat_id", 1), ("created_at", 1)])
        await db.favorites.create_index([("user_id", 1), ("character_id", 1)], unique=True)
        await db.favorites.create_index("character_id")
    except Exception as e:
        logger.warning(f"Index creation: {e}")
    await seed_data()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
