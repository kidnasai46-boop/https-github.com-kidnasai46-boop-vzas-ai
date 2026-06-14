"""Re-roll avatars for a specific hand-picked list of characters.

Used when the batch regen produced a few duds. Generates a fresh image
(new seed) for each named character with the same anime/paint routing as the
main script, writes it to the DB, and saves a copy to the Desktop for review.
"""
import asyncio
import os
import base64
import sys
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from dotenv import load_dotenv
ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

import truststore
truststore.inject_into_ssl()

from motor.motor_asyncio import AsyncIOMotorClient
from image_provider import generate_avatar

NAMES = [
    "Saoirse the Wanderer",
    "Yuki Tanaka",
    "Hana Saito",
    "Lilith Vesper",
    "Akane Nightshade",
    "Kuro the Shadow",
    "Rei Kuroda",
    "Sayuri Akinada",
    "Sana Hoshino",
    "Riko Aizawa",
]

PAINTED_CATEGORIES = {"Romance", "Historical", "Helpers", "Slice of Life"}
DESK = os.path.join(os.path.expanduser("~"), "Desktop", "reroll")


def build_prompt(c: dict) -> str:
    parts = [c.get("name", "")]
    if c.get("tagline"):
        parts.append(c["tagline"])
    desc = c.get("description") or c.get("personality") or ""
    if desc:
        parts.append(desc[:300])
    if c.get("genre"):
        parts.append(f"Genre: {c['genre']}")
    return ". ".join(p for p in parts if p)


async def main() -> int:
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    os.makedirs(DESK, exist_ok=True)
    for nm in NAMES:
        c = await db.characters.find_one({"name": nm}, {"_id": 0})
        if not c:
            print(f"  MISSING  {nm}")
            continue
        is_nsfw = bool(c.get("nsfw"))
        is_anime_tagged = (
            c.get("category") == "Anime"
            or any(str(t).lower() == "anime" for t in (c.get("tags") or []))
        )
        wants_painted = (c.get("category") in PAINTED_CATEGORIES) and not is_nsfw and not is_anime_tagged
        anime = not wants_painted
        label = "NSFW" if is_nsfw else ("PAINT" if wants_painted else "ANIME")
        print(f"  [{label}] {nm:28s} ... ", end="", flush=True)
        try:
            uri = await generate_avatar(build_prompt(c), anime=anime, explicit=is_nsfw)
            await db.characters.update_one({"id": c["id"]}, {"$set": {"avatar": uri}})
            open(os.path.join(DESK, nm.replace(" ", "_") + ".png"), "wb").write(
                base64.b64decode(uri.split(",", 1)[1])
            )
            print("OK")
        except Exception as e:
            print(f"FAIL {str(e)[:80]}")
        await asyncio.sleep(8)
    print(f"\nDone. Review copies in {DESK}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
