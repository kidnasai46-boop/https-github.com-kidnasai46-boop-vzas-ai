"""Generate AI avatars for all official seeded characters using Gemini Nano Banana.

Run with: python regenerate_avatars.py
- Generates concurrently (default 4 at a time) to keep total time under ~15 minutes.
- Marks each character with `ai_avatar_generated: true` so re-runs only target ones that still need it.
- Pass --force to re-generate everything regardless.
- Pass --only "Name" to regenerate a single character.
"""
import asyncio
import os
import sys
import uuid
import argparse
import logging
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
)
log = logging.getLogger("avatars")

MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

CONCURRENCY = 4


def style_hint(category: str, genre: str) -> str:
    """Return a style modifier per category for visual coherence."""
    c = (category or "").lower()
    g = (genre or "").lower()
    if c == "anime":
        return (
            "Stylised anime-inspired digital illustration portrait, vibrant colors, "
            "soft cel-shading, expressive large eyes, semi-realistic anime style"
        )
    if c == "gaming":
        return (
            "Cinematic stylised character art, dynamic lighting, video-game promotional "
            "key-art quality, vivid colors"
        )
    if c == "helpers":
        return (
            "Friendly modern portrait photo, soft natural lighting, warm professional vibe, "
            "approachable expression, real-world setting"
        )
    if c == "heroes":
        return (
            "Cinematic comic-book key-art portrait, dramatic chiaroscuro lighting, "
            "bold colors, heroic composition, slightly stylised"
        )
    if c == "historical":
        return (
            "Painterly historical portrait, classic oil-painting style, period-accurate clothing, "
            "warm vintage lighting, museum-quality composition"
        )
    if c == "mystery":
        return (
            "Moody noir cinematic portrait, deep shadows, dramatic single-source rim light, "
            "muted desaturated palette, film-grain"
        )
    if c == "romance":
        return (
            "Soft cinematic portrait, warm golden-hour lighting, gentle smile or expression, "
            "shallow depth of field, romantic mood"
        )
    if "sci-fi" in g or c == "original" and "scifi" in g:
        return (
            "Cinematic sci-fi character portrait, neon accent lighting, futuristic styling, "
            "ultra-detailed, cyberpunk-tinged"
        )
    if "fantasy" in g:
        return (
            "Cinematic fantasy character portrait, dramatic magical lighting, intricate costume, "
            "ethereal atmosphere, ultra-detailed"
        )
    return "Cinematic character portrait, dramatic moody lighting, ultra-detailed"


def build_prompt(character: dict) -> str:
    style = style_hint(character.get("category", ""), character.get("genre", ""))
    name = character["name"]
    tagline = character.get("tagline", "")
    description = character.get("description", "")
    personality = character.get("personality", "")
    return (
        f"{style}. "
        f"Subject: {name}, a fictional original character (not based on any real person or celebrity). "
        f"{tagline} {description} "
        f"Personality cues to express in their face: {personality}. "
        f"Vertical 1:1 framing, close-up portrait from chest up, eyes engaged with viewer, "
        f"ultra-detailed, high-quality, single subject, no text, no watermark, no logos."
    )


async def generate_one(client: AsyncIOMotorClient, char: dict, force: bool) -> tuple[str, str]:
    db = client[DB_NAME]
    name = char["name"]
    if char.get("ai_avatar_generated") and not force:
        return name, "skipped (already done)"
    prompt = build_prompt(char)
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"seed_avatar_{uuid.uuid4().hex}",
            system_message="You generate cinematic, fictional character portrait avatars.",
        )
        chat.with_model("gemini", "gemini-3.1-flash-image-preview").with_params(modalities=["image", "text"])

        _text, images = await chat.send_message_multimodal_response(UserMessage(text=prompt))
        if not images:
            return name, "no image returned"
        img = images[0]
        mime = img.get("mime_type", "image/png")
        avatar = f"data:{mime};base64,{img['data']}"
        await db.characters.update_one(
            {"id": char["id"]},
            {"$set": {"avatar": avatar, "ai_avatar_generated": True}},
        )
        return name, f"OK ({len(img['data']) // 1024} KB)"
    except Exception as e:
        return name, f"ERROR: {e}"


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="re-generate even if already done")
    parser.add_argument("--only", type=str, default=None, help="only regenerate the character matching this exact name")
    parser.add_argument("--concurrency", type=int, default=CONCURRENCY)
    parser.add_argument("--limit", type=int, default=None, help="cap how many to generate this run")
    args = parser.parse_args()

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    q = {"is_official": True}
    if args.only:
        q["name"] = args.only
    chars = await db.characters.find(q, {"_id": 0}).to_list(1000)

    if not args.force:
        chars = [c for c in chars if not c.get("ai_avatar_generated")]

    if args.limit:
        chars = chars[: args.limit]

    log.info(f"Generating AI avatars for {len(chars)} characters (concurrency={args.concurrency}, force={args.force})")

    sem = asyncio.Semaphore(args.concurrency)
    done = 0
    total = len(chars)

    async def worker(c):
        nonlocal done
        async with sem:
            name, status = await generate_one(client, c, args.force)
            done += 1
            log.info(f"[{done}/{total}] {name}: {status}")

    await asyncio.gather(*[worker(c) for c in chars])
    log.info("All done.")


if __name__ == "__main__":
    asyncio.run(main())
