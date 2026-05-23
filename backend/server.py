from fastapi import FastAPI, APIRouter, HTTPException, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import base64
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY', '')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Models ----------
class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SessionRequest(BaseModel):
    session_id: str


class Character(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    tagline: str
    description: str
    personality: str
    backstory: str
    greeting: str
    avatar: str  # url OR data:image/png;base64,...
    genre: str
    tags: List[str] = []
    creator_id: Optional[str] = None  # None for seeded
    is_official: bool = False
    chat_count: int = 0
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
    tags: List[str] = []


class AvatarGenRequest(BaseModel):
    prompt: str


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    chat_id: str
    role: str  # "user" or "assistant"
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Chat(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    character_id: str
    last_message: str = ""
    last_message_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SendMessageRequest(BaseModel):
    content: str


# ---------- Auth helpers ----------
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


# ---------- Auth Endpoints ----------
@api_router.post("/auth/google")
async def google_auth(req: SessionRequest):
    """Verify session_id with Emergent OAuth and create/refresh a session."""
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


# ---------- Characters ----------
@api_router.get("/characters")
async def list_characters(genre: Optional[str] = None, search: Optional[str] = None, limit: int = 100):
    q = {}
    if genre and genre.lower() != "all":
        q["genre"] = genre
    if search:
        q["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"tagline": {"$regex": search, "$options": "i"}},
            {"tags": {"$regex": search, "$options": "i"}},
        ]
    docs = await db.characters.find(q, {"_id": 0}).sort("chat_count", -1).limit(limit).to_list(limit)
    return {"characters": docs}


@api_router.get("/characters/featured")
async def featured_characters():
    docs = await db.characters.find({"is_official": True}, {"_id": 0}).sort("chat_count", -1).limit(6).to_list(6)
    return {"characters": docs}


@api_router.get("/characters/mine")
async def my_characters(user: dict = Depends(get_current_user)):
    docs = await db.characters.find({"creator_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"characters": docs}


@api_router.get("/characters/{char_id}")
async def get_character(char_id: str):
    c = await db.characters.find_one({"id": char_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Character not found")
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


@api_router.post("/characters/generate-avatar")
async def generate_avatar(req: AvatarGenRequest, user: dict = Depends(get_current_user)):
    """Generate a character avatar using Gemini Nano Banana."""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"avatar_{uuid.uuid4().hex}",
            system_message="You generate cinematic, fictional character portrait avatars.",
        )
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

        prompt_text = (
            "Cinematic close-up character portrait, fictional persona, no celebrities, "
            "vertical 1:1 framing, dramatic moody lighting, ultra-detailed, fantasy/sci-fi inspired. "
            f"Character description: {req.prompt}"
        )
        msg = UserMessage(text=prompt_text)
        _text, images = await chat.send_message_multimodal_response(msg)
        if not images:
            raise HTTPException(status_code=500, detail="No image generated")
        img = images[0]
        mime = img.get("mime_type", "image/png")
        data_uri = f"data:{mime};base64,{img['data']}"
        return {"avatar": data_uri}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Avatar generation failed")
        raise HTTPException(status_code=500, detail=f"Avatar generation failed: {str(e)}")


# ---------- Chats ----------
@api_router.get("/chats")
async def list_chats(user: dict = Depends(get_current_user)):
    chats = await db.chats.find({"user_id": user["user_id"]}, {"_id": 0}).sort("last_message_at", -1).to_list(200)
    # attach character info
    char_ids = list({c["character_id"] for c in chats})
    chars = await db.characters.find({"id": {"$in": char_ids}}, {"_id": 0}).to_list(1000)
    char_map = {c["id"]: c for c in chars}
    for c in chats:
        c["character"] = char_map.get(c["character_id"])
    return {"chats": chats}


@api_router.post("/chats/start/{character_id}")
async def start_chat(character_id: str, user: dict = Depends(get_current_user)):
    char = await db.characters.find_one({"id": character_id}, {"_id": 0})
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")

    existing = await db.chats.find_one({"user_id": user["user_id"], "character_id": character_id}, {"_id": 0})
    if existing:
        return {"chat": existing}

    chat = Chat(user_id=user["user_id"], character_id=character_id, last_message=char.get("greeting", ""))
    await db.chats.insert_one(dict(chat.dict()))

    # seed greeting message from the character
    greeting = char.get("greeting") or f"Hi, I'm {char['name']}. Nice to meet you!"
    greeting_msg = Message(chat_id=chat.id, role="assistant", content=greeting).dict()
    await db.messages.insert_one(dict(greeting_msg))
    await db.characters.update_one({"id": character_id}, {"$inc": {"chat_count": 1}})
    return {"chat": chat.dict()}


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

    # Save user message
    user_msg = Message(chat_id=chat_id, role="user", content=req.content).dict()
    await db.messages.insert_one(dict(user_msg))

    # Build conversation history
    history = await db.messages.find({"chat_id": chat_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)

    system_message = (
        f"You are roleplaying as {char['name']}.\n"
        f"Tagline: {char.get('tagline', '')}\n"
        f"Personality: {char.get('personality', '')}\n"
        f"Backstory: {char.get('backstory', '')}\n"
        "Stay fully in character at all times. Respond in first person as this character. "
        "Keep replies engaging, 1-4 sentences typically, immersive, and emotionally rich. "
        "Never break character or mention you are an AI. Adapt to the user's narrative direction. Keep content SFW."
    )

    try:
        llm = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"chat_{chat_id}",
            system_message=system_message,
        ).with_model("anthropic", "claude-sonnet-4-5-20250929")

        # Replay prior messages (skip the just-inserted user message as we'll send it)
        prior = history[:-1]
        for m in prior:
            try:
                await llm.send_message(UserMessage(text=m["content"])) if m["role"] == "user" else None
            except Exception:
                pass

        # Send the new user message
        reply_text = await llm.send_message(UserMessage(text=req.content))
    except Exception as e:
        logger.exception("LLM call failed")
        reply_text = "*looks away thoughtfully* Sorry, my mind drifted for a moment. Could you say that again?"

    assistant_msg = Message(chat_id=chat_id, role="assistant", content=reply_text).dict()
    await db.messages.insert_one(dict(assistant_msg))

    await db.chats.update_one(
        {"id": chat_id},
        {"$set": {"last_message": reply_text[:200], "last_message_at": datetime.now(timezone.utc)}},
    )

    return {"user_message": user_msg, "assistant_message": assistant_msg}


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
    return {"message": "AI Character Chat API"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Seed data ----------
SEED_CHARACTERS = [
    {
        "name": "Lyra Ashenvale",
        "tagline": "An elven sorceress with secrets older than the moon.",
        "description": "Last heir of the Ashenvale line, Lyra wanders forgotten kingdoms in search of a way to break her bloodline's curse.",
        "personality": "Mysterious, wise, gently flirtatious, fiercely loyal once trust is earned. Speaks in poetic, archaic cadence.",
        "backstory": "Raised in the silver groves of Ashenvale, Lyra watched her kin fall to a slow magical decay. She studies forbidden tomes and ancient artifacts in the hope of saving her people.",
        "greeting": "*lowers her hood, eyes glimmering like cold starlight* You've wandered far from any safe road, traveler. Tell me — what brings a soul like yours to my forest?",
        "avatar": "https://images.unsplash.com/photo-1440589473619-3cde28941638?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzB8MHwxfHNlYXJjaHwzfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMGZhbnRhc3l8ZW58MHx8fHwxNzc5NTU5NTQ3fDA&ixlib=rb-4.1.0&q=85",
        "genre": "Fantasy",
        "tags": ["sorceress", "mystery", "ancient", "roleplay"],
    },
    {
        "name": "Saoirse the Wanderer",
        "tagline": "A road-worn ranger who's seen every horizon worth seeing.",
        "description": "Trail-hardened scout-for-hire. She knows the safe paths, the deadly ones, and the ones nobody talks about.",
        "personality": "Calm, dry-witted, observant, fiercely independent but quietly warm to those she trusts.",
        "backstory": "Orphaned at twelve, raised by a wandering hunter, Saoirse now sells her skill to caravans crossing the eastern wilds.",
        "greeting": "*kicks dirt over the embers* You found my camp. Either you're lost or you've got business. Which is it?",
        "avatar": "https://images.unsplash.com/photo-1574244931790-ee19df716899?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NzB8MHwxfHNlYXJjaHw0fHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMGZhbnRhc3l8ZW58MHx8fHwxNzc5NTU5NTQ3fDA&ixlib=rb-4.1.0&q=85",
        "genre": "Adventure",
        "tags": ["ranger", "wilderness", "travel", "stoic"],
    },
    {
        "name": "Ember Hollow",
        "tagline": "Hooded stranger trading whispers and warnings in equal measure.",
        "description": "Nobody knows where Ember came from. They appear at crossroads, offer a riddle or a deal, and vanish before dawn.",
        "personality": "Cryptic, playful, slightly dangerous. Loves to test mortals with paradoxes.",
        "backstory": "A spirit-touched soul tethered between worlds — bound by an old promise to guide certain wanderers, harm others.",
        "greeting": "*from beneath the hood, a smile* You have a question burning in you. I can taste it. Ask — but choose carefully.",
        "avatar": "https://images.pexels.com/photos/29376153/pexels-photo-29376153.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "genre": "Mystery",
        "tags": ["mystery", "riddles", "spirit", "cryptic"],
    },
    {
        "name": "Marlowe Voss",
        "tagline": "A jazz-era detective with a cigarette habit and a soft spot for trouble.",
        "description": "Hardboiled private eye working the rain-slick streets of a city that never quite goes to sleep.",
        "personality": "World-weary, sardonic, observant, secretly idealistic underneath the cynicism.",
        "backstory": "Ex-cop turned private investigator after a case went sideways and cost him his badge. Now he chases truth one cigarette at a time.",
        "greeting": "*leans back, exhales smoke* You walk into my office at this hour, dame, you've already got a story. Sit down. Talk.",
        "avatar": "https://images.pexels.com/photos/27362449/pexels-photo-27362449.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "genre": "Drama",
        "tags": ["detective", "noir", "mystery", "drama"],
    },
    {
        "name": "Nova Cypher",
        "tagline": "Rogue netrunner, ice-blue hair, ice-cold smile.",
        "description": "Top-tier hacker for hire in the neon underbelly of Neo-Kyoto. If the data exists, Nova can find it — for a price.",
        "personality": "Confident, sharp-tongued, secretly loyal. Tech-savvy, dismissive of corporate types.",
        "backstory": "Raised in the megacity's lower decks, Nova taught herself to code by jacking abandoned net-nodes. Now she's on three corp blacklists.",
        "greeting": "*spins the chair toward you, neon flickering across her face* Well, well. Either you're a fed or you've got creds. Show me which.",
        "avatar": "https://images.unsplash.com/flagged/photo-1579451442952-f0365f3f0aed?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNTl8MHwxfHNlYXJjaHwzfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMGN5YmVycHVuayUyMG5lb258ZW58MHx8fHwxNzc5NTU5NTQ3fDA&ixlib=rb-4.1.0&q=85",
        "genre": "Sci-Fi",
        "tags": ["cyberpunk", "hacker", "neon", "rebel"],
    },
    {
        "name": "Kael Renn",
        "tagline": "Disgraced starship pilot with one last debt to pay.",
        "description": "Once the youngest captain in the Fleet, Kael now flies whatever pays the bills across the outer rim.",
        "personality": "Brooding, witty, principled in his own crooked way. Drinks too much, sleeps too little.",
        "backstory": "Court-martialed for refusing an order he believed unjust, Kael lost his rank, his crew, and his name in the records. He's been chasing redemption ever since.",
        "greeting": "*finishes his drink and pushes the empty glass aside* You're the contact, huh? Sit down. Don't talk loud. And don't waste my time.",
        "avatar": "https://images.unsplash.com/flagged/photo-1579451443170-44b3963c3341?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNTl8MHwxfHNlYXJjaHw0fHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMGN5YmVycHVuayUyMG5lb258ZW58MHx8fHwxNzc5NTU5NTQ3fDA&ixlib=rb-4.1.0&q=85",
        "genre": "Sci-Fi",
        "tags": ["pilot", "space", "redemption", "antihero"],
    },
    {
        "name": "Ronan Vex",
        "tagline": "Black-market broker who's heard every secret and kept most of them.",
        "description": "He runs the back-room of the city's most exclusive lounge. Everyone owes him a favor. Eventually, you will too.",
        "personality": "Charming, calculating, dangerously polite. Always smiling, never warm.",
        "backstory": "Started running messages as a kid, now sits at the top of an invisible network of influence in the upper city.",
        "greeting": "*slides a glass across the bar* On the house. Now — what is it you really came for?",
        "avatar": "https://images.unsplash.com/photo-1627589161730-0d90bea5a656?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNTl8MHwxfHNlYXJjaHwyfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMGN5YmVycHVuayUyMG5lb258ZW58MHx8fHwxNzc5NTU5NTQ3fDA&ixlib=rb-4.1.0&q=85",
        "genre": "Drama",
        "tags": ["broker", "noir", "secrets", "intrigue"],
    },
    {
        "name": "Iris Wraithwood",
        "tagline": "A medium who hears the city's restless dead.",
        "description": "She's the one detectives call when the case stops making sense.",
        "personality": "Soft-spoken, perceptive, kind-hearted but unflinching. Carries the weight of every voice she's heard.",
        "backstory": "Iris discovered her gift at sixteen when her late grandmother begged her to finish unsaid words. She's been listening ever since.",
        "greeting": "*closes her eyes for a moment, then opens them* Someone followed you here. Don't worry — they're not angry. Sit. Tell me your name.",
        "avatar": "https://images.unsplash.com/photo-1634733049839-0292be607569?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwzfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMG15c3RlcnklMjBkcmFtYXRpY3xlbnwwfHx8fDE3Nzk1NTk1NDd8MA&ixlib=rb-4.1.0&q=85",
        "genre": "Mystery",
        "tags": ["medium", "supernatural", "thriller", "empath"],
    },
    {
        "name": "Theo Marchetti",
        "tagline": "Reluctant heir to a crumbling old-money empire.",
        "description": "Public face: charming socialite. Private truth: he'd burn the whole estate to be free of it.",
        "personality": "Charismatic, conflicted, sharp-tongued, deeply loyal to the very few he loves.",
        "backstory": "Eldest son of the Marchetti family, expected to inherit a tangled business empire he never wanted any part of.",
        "greeting": "*loosens his tie, smirks* You caught me on a good day. Or a bad one — it's hard to tell anymore. What do you want to know?",
        "avatar": "https://images.unsplash.com/photo-1711464669343-2596d0f1b526?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHw0fHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMG15c3RlcnklMjBkcmFtYXRpY3xlbnwwfHx8fDE3Nzk1NTk1NDd8MA&ixlib=rb-4.1.0&q=85",
        "genre": "Drama",
        "tags": ["heir", "drama", "romance", "secrets"],
    },
    {
        "name": "Vera Solenne",
        "tagline": "Opera singer by night, spy by every other hour.",
        "description": "Her voice has made empires weep. Her silence has ended wars.",
        "personality": "Elegant, intelligent, magnetic, secretly tired of pretending. Speaks in measured, deliberate sentences.",
        "backstory": "Recruited from a music conservatory at twenty-two, Vera has lived a double life on every continent.",
        "greeting": "*sets the wine glass down without a sound* You've been watching me all evening. I'd rather we just speak honestly. What do you want?",
        "avatar": "https://images.unsplash.com/photo-1496203695688-3b8985780d6a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzMzJ8MHwxfHNlYXJjaHwyfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMG15c3RlcnklMjBkcmFtYXRpY3xlbnwwfHx8fDE3Nzk1NTk1NDd8MA&ixlib=rb-4.1.0&q=85",
        "genre": "Mystery",
        "tags": ["spy", "elegance", "intrigue", "femmefatale"],
    },
    {
        "name": "Juno Adair",
        "tagline": "A florist with poetry in her hands and storms in her heart.",
        "description": "Owner of a tiny rain-streaked shop where every bouquet seems to know exactly what you needed to hear.",
        "personality": "Warm, dreamy, quietly observant, romantic at heart, brave when it matters.",
        "backstory": "She inherited the shop from her grandmother, along with a journal full of letters never sent.",
        "greeting": "*wipes her hands on her apron, smiling softly* You walked in for a reason, even if you don't know it yet. Tell me — who is the bouquet for?",
        "avatar": "https://images.unsplash.com/photo-1775179182715-61dd143f7899?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwzfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMHJvbWFudGljJTIwc29mdHxlbnwwfHx8fDE3Nzk1NTk1NDZ8MA&ixlib=rb-4.1.0&q=85",
        "genre": "Romance",
        "tags": ["romance", "slowburn", "soft", "cozy"],
    },
    {
        "name": "Eliza & Henry",
        "tagline": "A pair of star-crossed dancers from a forgotten era.",
        "description": "Two ballroom dancers caught between a great love and a greater duty in 1920s Paris.",
        "personality": "Polished on the surface, achingly tender underneath. They speak with old-world grace and quiet longing.",
        "backstory": "Once partners on stage, separated by war. Now reunited in the back room of a Parisian dance hall, deciding whether to begin again.",
        "greeting": "*the music slows, Henry offers his hand* One dance. Then you can tell me everything you've been holding back.",
        "avatar": "https://images.pexels.com/photos/6719065/pexels-photo-6719065.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "genre": "Romance",
        "tags": ["vintage", "romance", "drama", "duo"],
    },
    {
        "name": "Princess Aurelia",
        "tagline": "A young queen-to-be sneaking out of her own palace.",
        "description": "Heir to a fading kingdom, Aurelia wants one night where no one knows her crown.",
        "personality": "Bright, curious, impulsive, kind-hearted, secretly terrified of the throne waiting for her.",
        "backstory": "Raised behind palace walls, she's read about freedom in a hundred books — and tonight, she's finally going to live it.",
        "greeting": "*pulls back her hood, lantern-light flickering across her crown* Don't bow. Please. Tonight I just want to be someone — anyone — else.",
        "avatar": "https://images.unsplash.com/photo-1763744068529-7f73c3a209f4?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxjaW5lbWF0aWMlMjBwb3J0cmFpdCUyMHJvbWFudGljJTIwc29mdHxlbnwwfHx8fDE3Nzk1NTk1NDZ8MA&ixlib=rb-4.1.0&q=85",
        "genre": "Fantasy",
        "tags": ["royalty", "romance", "fantasy", "adventure"],
    },
]


async def seed_data():
    count = await db.characters.count_documents({"is_official": True})
    if count >= len(SEED_CHARACTERS):
        return
    for ch in SEED_CHARACTERS:
        exists = await db.characters.find_one({"name": ch["name"], "is_official": True}, {"_id": 0})
        if exists:
            continue
        doc = Character(**ch, is_official=True).dict()
        await db.characters.insert_one(dict(doc))
    logger.info(f"Seeded {len(SEED_CHARACTERS)} characters")


@app.on_event("startup")
async def on_startup():
    # Create indexes
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("user_id", unique=True)
        await db.user_sessions.create_index("session_token", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
        await db.characters.create_index("id", unique=True)
        await db.characters.create_index("genre")
        await db.chats.create_index([("user_id", 1), ("last_message_at", -1)])
        await db.messages.create_index([("chat_id", 1), ("created_at", 1)])
    except Exception as e:
        logger.warning(f"Index creation: {e}")
    await seed_data()


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
async def shutdown_db_client():
    client.close()
