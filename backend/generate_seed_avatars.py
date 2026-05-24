"""One-time script to generate DALL-E 3 avatars for all official seed characters."""
import asyncio
import base64
import logging
import os
import time

import httpx
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from openai import AsyncOpenAI
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

openai_client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])

PROMPT_TEMPLATE = (
    "Cinematic close-up character portrait, fictional persona, no celebrities, "
    "vertical 1:1 framing, dramatic moody lighting, ultra-detailed, digital art style. "
    "Character: {name}. Description: {description}"
)


async def generate_avatar(name: str, personality: str) -> str:
    description = personality[:200]
    prompt = PROMPT_TEMPLATE.format(name=name, description=description)
    response = await openai_client.images.generate(
        model="dall-e-3",
        prompt=prompt,
        size="1024x1024",
        quality="standard",
        style="vivid",
        n=1,
    )
    image_url = response.data[0].url
    async with httpx.AsyncClient(timeout=60) as http:
        img_resp = await http.get(image_url)
        img_resp.raise_for_status()
    b64 = base64.b64encode(img_resp.content).decode("utf-8")
    return f"data:image/png;base64,{b64}"


async def main():
    characters = await db.characters.find(
        {"is_official": True}, {"_id": 0, "id": 1, "name": 1, "personality": 1, "avatar": 1}
    ).to_list(500)

    total = len(characters)
    skipped = 0
    generated = 0

    for i, char in enumerate(characters, 1):
        if char.get("avatar", "").startswith("data:"):
            logger.info(f"[{i}/{total}] Skipping {char['name']} (already has generated avatar)")
            skipped += 1
            continue

        try:
            logger.info(f"[{i}/{total}] Generating avatar for {char['name']}...")
            avatar_b64 = await generate_avatar(char["name"], char.get("personality", ""))
            await db.characters.update_one(
                {"id": char["id"]},
                {"$set": {"avatar": avatar_b64}},
            )
            generated += 1
            logger.info(f"[{i}/{total}] Done: {char['name']}")
        except Exception as e:
            logger.error(f"[{i}/{total}] FAILED {char['name']}: {e}")

        time.sleep(2)

    logger.info(f"Complete. Generated: {generated}, Skipped: {skipped}, Total: {total}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
