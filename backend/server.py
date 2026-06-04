# Use the OS trust store for SSL (Windows Certificate Store on Windows).
# Without this, an HTTPS-inspecting antivirus / corporate proxy that re-signs
# certificates will cause every outbound HTTPS call to fail verification.
import truststore
truststore.inject_into_ssl()

# Load .env BEFORE any local imports — llm_client reads env vars at import
# time, so the file must be loaded first or the LLM client will see empty keys.
from pathlib import Path
from dotenv import load_dotenv
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import httpx
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
import base64
import secrets
from datetime import datetime, timezone, timedelta

from llm_client import complete, stream as llm_stream
from image_client import generate_avatar as replicate_avatar, is_configured as image_is_configured
from seed_data import SEED_CHARACTERS
from story_engine import (
    generate_story_arc, init_story_state, evaluate_meters_and_choices,
    apply_meter_changes, check_chapter_advance, evaluate_ending,
    build_story_prompt_block,
)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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
    is_subscribed: bool = False
    # Lifetime NSFW message counter — capped at FREE_NSFW_LIMIT for unsubscribed users.
    nsfw_messages_used: int = 0
    # Per-day SFW message counter — resets when sfw_count_date != today.
    sfw_messages_today: int = 0
    sfw_count_date: Optional[str] = None  # "YYYY-MM-DD" UTC
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LoginRequest(BaseModel):
    email: str
    name: Optional[str] = None


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
    nsfw: bool = False
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
    nsfw: bool = False


class AvatarGenRequest(BaseModel):
    prompt: str
    nsfw: bool = False


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
@api_router.post("/auth/login")
async def login(req: LoginRequest):
    """Simple self-managed login. Find-or-create a user by email and issue a
    backend session token (no external OAuth provider)."""
    email = req.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="A valid email is required")
    display_name = (req.name or "").strip() or email.split("@")[0]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": display_name}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        new_user = User(user_id=user_id, email=email, name=display_name).dict()
        await db.users.insert_one(dict(new_user))

    session_token = secrets.token_urlsafe(32)
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
    nsfw: Optional[bool] = None,
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
    # NSFW gating: default (param omitted) hides NSFW characters. Pass ?nsfw=true
    # to include them, or ?nsfw=false to explicitly request SFW only.
    if nsfw is None or nsfw is False:
        q["$and"] = q.get("$and", []) + [{"$or": [{"nsfw": {"$exists": False}}, {"nsfw": False}]}]
    # If nsfw is True we don't add a filter — both SFW and NSFW characters return.

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
async def featured_characters(
    nsfw: Optional[bool] = None,
    user: Optional[dict] = Depends(get_current_user_optional),
):
    q: Dict[str, Any] = {"is_official": True}
    if not nsfw:
        q["$or"] = [{"nsfw": {"$exists": False}}, {"nsfw": False}]
    docs = await db.characters.find(q, {"_id": 0}).sort("chat_count", -1).limit(8).to_list(8)
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
async def trending_characters(
    nsfw: Optional[bool] = None,
    user: Optional[dict] = Depends(get_current_user_optional),
):
    """Sorted by chat_count + favorite_count, limited to 10."""
    match: Dict[str, Any] = {"is_official": True}
    if not nsfw:
        match["$or"] = [{"nsfw": {"$exists": False}}, {"nsfw": False}]
    pipeline = [
        {"$match": match},
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
    """Generate a character avatar via Replicate.

    Uses a Hugging Face image model hosted on Replicate. Picks an anime+NSFW
    model when `req.nsfw=True` (Pony Diffusion v6 XL by default) or a general
    cinematic model when False (Flux Schnell by default). Both slugs are
    env-configurable: REPLICATE_MODEL / REPLICATE_NSFW_MODEL.
    """
    if not image_is_configured():
        raise HTTPException(status_code=400, detail="Image generation not configured — set REPLICATE_API_TOKEN")
    try:
        data_uri = await replicate_avatar(req.prompt, nsfw=req.nsfw)
        return {"avatar": data_uri}
    except HTTPException:
        raise
    except Exception as e:
        msg = str(e).lower()
        if "nsfw" in msg or "safety" in msg or "content" in msg:
            logger.warning(f"Image model rejection: {e}")
            raise HTTPException(status_code=400, detail="Could not generate this image. Try adjusting the description.")
        logger.exception("Avatar generation failed")
        raise HTTPException(status_code=500, detail=f"Avatar generation failed: {str(e)}")


# ---------- Quota / paywall ----------
# Free tier limits. Subscribed users are uncapped on both.
FREE_NSFW_LIMIT = 5            # lifetime NSFW messages for unsubscribed users
FREE_SFW_DAILY_LIMIT = 50      # SFW messages per UTC day for unsubscribed users


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def _check_quota(user: dict, char: dict) -> Optional[dict]:
    """Return None if the user can send another message, else a paywall dict
    {kind, limit, used} describing why they're blocked.

    Subscribed users always pass. Otherwise:
      - NSFW character → lifetime cap (FREE_NSFW_LIMIT).
      - SFW character  → per-UTC-day cap (FREE_SFW_DAILY_LIMIT), auto-reset
        when the user's `sfw_count_date` differs from today.
    """
    if user.get("is_subscribed"):
        return None
    if char.get("nsfw"):
        used = int(user.get("nsfw_messages_used", 0) or 0)
        if used >= FREE_NSFW_LIMIT:
            return {"kind": "nsfw", "limit": FREE_NSFW_LIMIT, "used": used}
        return None
    # SFW path — check daily cap with auto-reset.
    today = _today_utc()
    if user.get("sfw_count_date") != today:
        used = 0  # will be reset on increment
    else:
        used = int(user.get("sfw_messages_today", 0) or 0)
    if used >= FREE_SFW_DAILY_LIMIT:
        return {"kind": "sfw_daily", "limit": FREE_SFW_DAILY_LIMIT, "used": used}
    return None


async def _increment_message_count(user: dict, char: dict) -> None:
    """Bump the right counter after a successful reply. No-op for subscribers."""
    if user.get("is_subscribed"):
        return
    if char.get("nsfw"):
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"nsfw_messages_used": 1}},
        )
    else:
        today = _today_utc()
        if user.get("sfw_count_date") != today:
            # Date rolled over — reset to 1.
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$set": {"sfw_messages_today": 1, "sfw_count_date": today}},
            )
        else:
            await db.users.update_one(
                {"user_id": user["user_id"]},
                {"$inc": {"sfw_messages_today": 1}},
            )


# ---------- Chats ----------
def build_system_prompt(char: dict, user: dict, scenario: Optional[dict], story_block: str = "") -> str:
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

    nsfw = bool(char.get("nsfw"))
    if nsfw:
        boundaries = (
            "TONE: Adult roleplay — sensual, intimate, and emotionally charged. "
            "Lean fully into chemistry, desire, and physical connection when the moment calls for it. "
            "Match the character's personality and let scenes build naturally.\n\n"
            "CONTENT BOUNDARIES (hard limits, never cross): "
            "No minors in any sexual or romantic context — all characters and situations involve adults (18+). "
            "No non-consensual acts. No sexual violence depicted as desirable. "
            "No incest, no bestiality, no content that would be illegal in major jurisdictions."
        )
    else:
        boundaries = (
            "TONE: Match the character's personality. For romantic / flirty / sensual characters, "
            "lean fully into chemistry — sustained eye contact, charged silences, lingering touches, "
            "slow-building tension, longing, suggestive banter, kisses, embraces, intimate "
            "atmosphere. Be confident, magnetic, evocative. Romance should feel real and earned.\n\n"
            "CONTENT BOUNDARIES (always): Keep content tasteful and SFW. Suggest rather than depict "
            "any explicit sexual acts — fade to black with sensual implication, never graphic detail. "
            "No minors in any romantic/sensual context. No non-consent. For non-romantic characters "
            "(therapists, coaches, mentors), stay professional and warm — do not force romantic tone."
        )
    base = (
        f"You are roleplaying as {char['name']}.\n"
        f"Tagline: {char.get('tagline', '')}\n"
        f"Personality: {char.get('personality', '')}\n"
        f"Backstory: {char.get('backstory', '')}\n"
        f"{scenario_block}"
        f"{persona_block}"
        "Stay fully in character at all times. Respond in first person as this character. "
        "Keep replies engaging, 1-4 sentences typically, immersive, and emotionally rich. "
        "Use *italic asterisks* for actions/expressions sparingly. "
        "Never break character or mention you are an AI. Adapt to the user's narrative direction.\n\n"
        f"{boundaries}"
    )
    if story_block:
        base += "\n" + story_block
    return base


LLM_FALLBACK_REPLY = "*looks away thoughtfully* Sorry, my mind drifted for a moment. Could you say that again?"


async def _generate_assistant_reply(chat_id: str, char: dict, user: dict, scenario: Optional[dict],
                                    history: List[dict], story_block: str = "") -> tuple[str, bool]:
    """Build the conversation from history and get a fresh reply.

    Returns (reply_text, success). On LLM failure returns (FALLBACK, False)
    so the caller can persist the in-character apology without charging the
    user's quota or running the story engine on a non-existent reply.
    """
    nsfw = bool(char.get("nsfw"))
    system_message = build_system_prompt(char, user, scenario, story_block=story_block)
    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in history
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    while messages and messages[0]["role"] == "assistant":
        messages.pop(0)
    if not messages:
        messages = [{"role": "user", "content": history[-1]["content"]}]
    try:
        text = await complete(system_message, messages, max_tokens=1024, nsfw=nsfw)
        return text, True
    except Exception:
        logger.exception("LLM call failed")
        return LLM_FALLBACK_REPLY, False


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

    try:
        arc = await generate_story_arc(char)
        arc["chat_id"] = new_chat.id
        await db.story_arcs.insert_one(dict(arc))
        story_state = init_story_state(arc)
        await db.chats.update_one(
            {"id": new_chat.id},
            {"$set": {"story_state": story_state}},
        )
        chat_dict = new_chat.dict()
        chat_dict["story_state"] = story_state
        return {"chat": chat_dict}
    except Exception:
        logger.exception("Story arc generation failed, continuing without story")

    return {"chat": new_chat.dict()}


@api_router.get("/chats/{chat_id}")
async def get_chat(chat_id: str, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    messages = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return {"chat": chat, "character": char, "messages": messages}


def _sse(event: str, data: Optional[dict] = None) -> bytes:
    """Format a Server-Sent Event frame. `data` is JSON-encoded; datetimes -> str."""
    payload = json.dumps(data, default=str) if data is not None else ""
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


async def _process_story_after_message(
    chat_id: str,
    chat: dict,
    char: dict,
    user_content: str,
    reply_text: str,
) -> Optional[dict]:
    """Wrapper around story engine processing that swallows any exception.

    The story engine makes LLM JSON calls that occasionally return malformed
    payloads; we never want a story-engine glitch to break the chat stream
    or wedge the chat UI. On error → log + return None (no story update for
    this turn) so the chat continues normally.
    """
    try:
        return await _process_story_after_message_inner(
            chat_id, chat, char, user_content, reply_text,
        )
    except Exception:
        logger.exception("Story engine post-processing failed; continuing without story update")
        return None


async def _process_story_after_message_inner(
    chat_id: str,
    chat: dict,
    char: dict,
    user_content: str,
    reply_text: str,
) -> Optional[dict]:
    """Run meter eval + chapter-advance / ending evaluation for an active story.

    Mutates and persists the chat's story_state, inserts any chapter-transition
    system message, and returns the story_state response dict the client uses
    to update meters / show transitions. None when no active story.
    """
    if not chat.get("story_state") or chat["story_state"].get("completed"):
        return None

    nsfw = bool(char.get("nsfw"))
    ss = dict(chat["story_state"])
    ss["messages_in_chapter"] = ss.get("messages_in_chapter", 0) + 1

    eval_result = await evaluate_meters_and_choices(
        user_content, reply_text, ss["meters"], nsfw=nsfw,
    )
    ss["meters"] = apply_meter_changes(ss["meters"], eval_result.get("meter_changes", {}))

    if eval_result.get("choice"):
        choice = eval_result["choice"]
        choice["chapter"] = ss["chapter"]
        choice["message_index"] = ss["messages_in_chapter"]
        ss["choices_made"].append(choice)

    story_response: dict = {
        "chapter": ss["chapter"],
        "meters": ss["meters"],
        "chapter_transition": None,
    }

    arc = await db.story_arcs.find_one({"id": ss["arc_id"]}, {"_id": 0})
    if arc:
        if ss["chapter"] >= ss["total_chapters"]:
            chapter_info = None
            for ch in arc["chapters"]:
                if ch["number"] == ss["chapter"]:
                    chapter_info = ch
                    break
            target = chapter_info.get("target_messages", 15) if chapter_info else 15
            if ss["messages_in_chapter"] >= target:
                ending = await evaluate_ending(arc, ss, nsfw=nsfw)
                ss["ending"] = ending.get("ending_type", "bad")
                ss["completed"] = True
                transition_msg = Message(
                    chat_id=chat_id, role="system",
                    content=f"Story Complete: {ending.get('ending_summary', '')}",
                ).dict()
                transition_msg["type"] = "chapter_transition"
                transition_msg["chapter_summary"] = ending.get("ending_summary", "")
                transition_msg["meters_snapshot"] = dict(ss["meters"])
                await db.messages.insert_one(dict(transition_msg))
                story_response["chapter_transition"] = {
                    "title": f"Story Complete — {ss['ending'].title()} Ending",
                    "summary": ending.get("ending_summary", ""),
                }
                story_response["ending"] = ss["ending"]
                story_response["completed"] = True
        else:
            advance = await check_chapter_advance(arc, ss, nsfw=nsfw)
            if advance:
                ss["chapter"] += 1
                ss["messages_in_chapter"] = 0
                next_ch = None
                for ch in arc["chapters"]:
                    if ch["number"] == ss["chapter"]:
                        next_ch = ch
                        break
                transition_msg = Message(
                    chat_id=chat_id, role="system",
                    content=f"Chapter {ss['chapter']}: {next_ch['title'] if next_ch else ''}",
                ).dict()
                transition_msg["type"] = "chapter_transition"
                transition_msg["chapter_summary"] = advance.get("chapter_summary", "")
                transition_msg["meters_snapshot"] = dict(ss["meters"])
                await db.messages.insert_one(dict(transition_msg))
                story_response["chapter_transition"] = {
                    "title": f"Chapter {ss['chapter']}: {next_ch['title'] if next_ch else ''}",
                    "summary": advance.get("chapter_summary", ""),
                    "previous_chapter": advance.get("chapter_summary", ""),
                }

    await db.chats.update_one({"id": chat_id}, {"$set": {"story_state": ss}})
    return story_response


@api_router.post("/chats/{chat_id}/messages")
async def send_message(chat_id: str, req: SendMessageRequest, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Paywall — check BEFORE inserting the user message so they don't see a
    # ghost message with no reply.
    paywall = await _check_quota(user, char)
    if paywall:
        raise HTTPException(status_code=402, detail={"paywall": paywall})

    user_msg = Message(chat_id=chat_id, role="user", content=req.content).dict()
    await db.messages.insert_one(dict(user_msg))

    history = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)

    scenario = None
    if chat.get("scenario_id"):
        for sc in (char.get("scenarios") or []):
            if sc.get("id") == chat["scenario_id"]:
                scenario = sc
                break

    story_block = ""
    if chat.get("story_state") and not chat["story_state"].get("completed"):
        arc = await db.story_arcs.find_one({"id": chat["story_state"]["arc_id"]}, {"_id": 0})
        if arc:
            story_block = build_story_prompt_block(arc, chat["story_state"])

    reply_text, llm_ok = await _generate_assistant_reply(chat_id, char, user, scenario, history, story_block=story_block)

    assistant_msg = Message(chat_id=chat_id, role="assistant", content=reply_text).dict()
    await db.messages.insert_one(dict(assistant_msg))

    # Only charge quota + run the story engine when the model actually replied.
    story_response = None
    if llm_ok:
        await _increment_message_count(user, char)
        story_response = await _process_story_after_message(chat_id, chat, char, req.content, reply_text)

    await db.chats.update_one(
        {"id": chat_id},
        {"$set": {"last_message": reply_text[:200], "last_message_at": datetime.now(timezone.utc)}},
    )

    response = {"user_message": user_msg, "assistant_message": assistant_msg}
    if story_response:
        response["story_state"] = story_response
    return response


@api_router.post("/chats/{chat_id}/messages/stream")
async def send_message_stream(chat_id: str, req: SendMessageRequest, user: dict = Depends(get_current_user)):
    """Stream the assistant's reply via Server-Sent Events.

    Event order:
      meta  -> {user_message, assistant_message_id}
      delta -> {text}          (many, one per LLM chunk)
      story -> {chapter, meters, chapter_transition?, ending?, completed?}  (optional)
      done  -> {}              (always last)
    """
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Paywall check FIRST — before we persist the user message or open the SSE
    # stream. A 402 response is delivered as a normal JSON error, so the
    # client's onError handler picks it up cleanly.
    paywall = await _check_quota(user, char)
    if paywall:
        raise HTTPException(status_code=402, detail={"paywall": paywall})

    # Persist the user message immediately so refreshes / parallel reads see it.
    user_msg = Message(chat_id=chat_id, role="user", content=req.content).dict()
    await db.messages.insert_one(dict(user_msg))

    history = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)

    scenario = None
    if chat.get("scenario_id"):
        for sc in (char.get("scenarios") or []):
            if sc.get("id") == chat["scenario_id"]:
                scenario = sc
                break

    story_block = ""
    if chat.get("story_state") and not chat["story_state"].get("completed"):
        arc = await db.story_arcs.find_one({"id": chat["story_state"]["arc_id"]}, {"_id": 0})
        if arc:
            story_block = build_story_prompt_block(arc, chat["story_state"])

    nsfw = bool(char.get("nsfw"))
    assistant_id = str(uuid.uuid4())

    async def event_gen():
        system_message = build_system_prompt(char, user, scenario, story_block=story_block)
        msgs = [
            {"role": m["role"], "content": m["content"]}
            for m in history
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        while msgs and msgs[0]["role"] == "assistant":
            msgs.pop(0)
        if not msgs:
            msgs = [{"role": "user", "content": req.content}]

        yield _sse("meta", {
            "user_message": user_msg,
            "assistant_message_id": assistant_id,
        })

        full_reply = ""
        llm_ok = True
        try:
            async for chunk in llm_stream(system_message, msgs, max_tokens=1024, nsfw=nsfw):
                full_reply += chunk
                yield _sse("delta", {"text": chunk})
        except Exception:
            logger.exception("Streaming LLM call failed")
            llm_ok = False
            full_reply = LLM_FALLBACK_REPLY
            yield _sse("delta", {"text": LLM_FALLBACK_REPLY})

        # Wrap everything after the LLM call in a try/except so a story-engine
        # or DB hiccup still emits a clean error+done frame to the client
        # instead of an abrupt EOS that leaves the UI wedged.
        try:
            assistant_msg = {
                "id": assistant_id,
                "chat_id": chat_id,
                "role": "assistant",
                "content": full_reply,
                "created_at": datetime.now(timezone.utc),
            }
            await db.messages.insert_one(dict(assistant_msg))

            # Only charge quota + run the story engine when the LLM succeeded.
            if llm_ok:
                await _increment_message_count(user, char)
                story_response = await _process_story_after_message(chat_id, chat, char, req.content, full_reply)
                if story_response:
                    yield _sse("story", story_response)

            await db.chats.update_one(
                {"id": chat_id},
                {"$set": {"last_message": full_reply[:200], "last_message_at": datetime.now(timezone.utc)}},
            )
        except Exception as post_err:
            logger.exception("Stream post-processing failed")
            yield _sse("error", {"message": f"post-processing failed: {str(post_err)[:120]}"})

        yield _sse("done", {})

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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

    reply_text, _ = await _generate_assistant_reply(chat_id, char, user, scenario, history)
    new_msg = Message(chat_id=chat_id, role="assistant", content=reply_text).dict()
    await db.messages.insert_one(dict(new_msg))
    await db.chats.update_one(
        {"id": chat_id},
        {"$set": {"last_message": reply_text[:200], "last_message_at": datetime.now(timezone.utc)}},
    )
    return {"assistant_message": new_msg}


class InChatImageRequest(BaseModel):
    hint: Optional[str] = None  # Optional user-supplied scene hint


@api_router.post("/chats/{chat_id}/image")
async def in_chat_image(chat_id: str, req: InChatImageRequest, user: dict = Depends(get_current_user)):
    """Generate an in-chat image of the character — a 'selfie' driven by the
    user tapping the camera button. Subscriber-only (paid feature) because
    image generation is the most expensive call we make (~$0.01 per image).

    The image is stored as a regular message in the chat with type=image so
    the frontend can render it as an `<Image>` inside the bubble stream.
    """
    if not user.get("is_subscribed"):
        raise HTTPException(
            status_code=402,
            detail={"paywall": {"kind": "image_premium", "feature": "in_chat_image"}},
        )

    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    char = await db.characters.find_one({"id": chat["character_id"]}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    # Build the prompt. If the user typed a specific hint, that's the
    # dominant signal — describe THAT image. If they didn't, fall back to a
    # scene-aware candid selfie based on the last few messages of context.
    hint = (req.hint or "").strip()
    parts = [char["name"], char.get("tagline", "")]
    physical_hint = (char.get("description") or "")[:200]
    if physical_hint:
        parts.append(physical_hint)

    if hint:
        # User-driven: their request is the focus, character is the subject.
        parts.append(f"Scene: {hint}")
        parts.append("looking at the camera, photo as if sent by her, intimate framing")
    else:
        # No hint → use last 4 messages as scene context for an in-the-moment selfie.
        recent = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", -1).limit(4).to_list(4)
        recent.reverse()
        scene_lines = [
            (m["content"][:120])
            for m in recent
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        if scene_lines:
            parts.append(f"Current scene: {' | '.join(scene_lines)}")
        parts.append("casual candid selfie, in-the-moment, looking at the camera, intimate framing")
    prompt = ". ".join(p for p in parts if p)

    try:
        data_uri = await replicate_avatar(prompt, nsfw=bool(char.get("nsfw")))
    except Exception as e:
        logger.exception("In-chat image generation failed")
        raise HTTPException(status_code=500, detail=f"Image generation failed: {str(e)[:120]}")

    # Persist as a regular assistant message of type=image. Content is the
    # data URI so the frontend can render it via <Image src={content} />.
    image_msg = Message(chat_id=chat_id, role="assistant", content=data_uri).dict()
    image_msg["type"] = "image"
    await db.messages.insert_one(dict(image_msg))

    # Update chat metadata so the list shows "📷 sent a photo" or similar.
    await db.chats.update_one(
        {"id": chat_id},
        {"$set": {"last_message": "📷 Sent a photo", "last_message_at": datetime.now(timezone.utc)}},
    )

    return {"assistant_message": image_msg}


@api_router.delete("/chats/{chat_id}")
async def delete_chat(chat_id: str, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    await db.chats.delete_one({"id": chat_id})
    await db.messages.delete_many({"chat_id": chat_id})
    return {"success": True}


@api_router.get("/chats/{chat_id}/story")
async def get_story(chat_id: str, user: dict = Depends(get_current_user)):
    chat = await db.chats.find_one({"id": chat_id, "user_id": user["user_id"]}, {"_id": 0})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    story_state = chat.get("story_state")
    if not story_state:
        return {"story_state": None, "arc": None}
    arc = await db.story_arcs.find_one({"id": story_state["arc_id"]}, {"_id": 0})
    return {"story_state": story_state, "arc": arc}


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
        await db.story_arcs.create_index("id", unique=True)
        await db.story_arcs.create_index("chat_id")
        await db.story_arcs.create_index("character_id")
    except Exception as e:
        logger.warning(f"Index creation: {e}")
    await seed_data()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
