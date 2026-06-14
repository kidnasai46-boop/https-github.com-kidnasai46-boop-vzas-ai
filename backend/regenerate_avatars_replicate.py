"""Regenerate character avatars via Replicate.

Iterates characters in the live MongoDB and replaces each `avatar` field with
a freshly generated AI portrait via image_client.generate_avatar(). Routes
NSFW characters through the NSFW model (Pony) and SFW through the SFW model
(Flux Schnell by default).

Usage (from the backend/ directory with the app's .env loaded):
    python regenerate_avatars_replicate.py                # all official chars
    python regenerate_avatars_replicate.py --only nsfw    # only nsfw=true
    python regenerate_avatars_replicate.py --only sfw     # only nsfw=false
    python regenerate_avatars_replicate.py --skip-existing  # skip chars already AI-gen
    python regenerate_avatars_replicate.py --limit 5      # cap how many to run
    python regenerate_avatars_replicate.py --name "Yuki"  # only match by name (substring)

Costs depend on Replicate model pricing; typically $0.003-0.01/image.
"""
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

# Load env BEFORE importing image_client (same gotcha as server.py).
from dotenv import load_dotenv
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# Trust store for SSL via the OS cert chain (handles AV/MITM).
import truststore
truststore.inject_into_ssl()

from motor.motor_asyncio import AsyncIOMotorClient
from image_provider import generate_avatar, is_configured


def build_prompt_for(character: dict) -> str:
    """Construct a portrait prompt from the character's profile."""
    parts = [character.get("name", "")]
    if character.get("tagline"):
        parts.append(character["tagline"])
    desc = character.get("description") or character.get("personality") or ""
    if desc:
        parts.append(desc[:300])
    genre = character.get("genre")
    if genre:
        parts.append(f"Genre: {genre}")
    return ". ".join(p for p in parts if p)


async def main(args) -> int:
    if not is_configured():
        print("ERROR: REPLICATE_API_TOKEN is not set in backend/.env", file=sys.stderr)
        return 1
    mongo_url = os.environ.get("MONGO_URL")
    db_name = os.environ.get("DB_NAME")
    if not mongo_url or not db_name:
        print("ERROR: MONGO_URL / DB_NAME missing", file=sys.stderr)
        return 1

    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]

    query: dict = {"is_official": True}
    if args.only == "nsfw":
        query["nsfw"] = True
    elif args.only == "sfw":
        query["$or"] = [{"nsfw": {"$exists": False}}, {"nsfw": False}]
    if args.name:
        query["name"] = {"$regex": args.name, "$options": "i"}

    chars = await db.characters.find(query, {"_id": 0}).to_list(10_000)

    # --anime-only: keep only chars whose category is "Anime" OR who have an
    # "anime" tag. Lets us cheaply re-render the anime set with the anime
    # model after a Flux Schnell sweep.
    if args.anime_only:
        def is_anime(c):
            return (
                c.get("category") == "Anime"
                or any(str(t).lower() == "anime" for t in (c.get("tags") or []))
            )
        chars = [c for c in chars if is_anime(c)]

    if args.skip_existing:
        chars = [c for c in chars if not (c.get("avatar", "").startswith("data:"))]

    if args.limit:
        chars = chars[: args.limit]

    if not chars:
        print("No characters matched the filter. Nothing to do.")
        return 0

    print(f"Regenerating avatars for {len(chars)} character(s)")
    print(f"  SFW model: {os.environ.get('REPLICATE_MODEL', '(default)')}")
    print(f"  NSFW model: {os.environ.get('REPLICATE_NSFW_MODEL', '(default)')}")
    print()

    success = 0
    failed: list[tuple[str, str]] = []
    started = time.time()

    for i, c in enumerate(chars, 1):
        name = c.get("name", "?")
        # Route ANY anime-themed character through the anime model — covers
        # both nsfw=true chars (Yuki/Rei/etc.) AND sfw anime chars whose
        # avatars should still be drawn in anime style (Hana, Riko, etc.).
        # The "NSFW model" env var is bound to the anime model on disk, so
        # passing nsfw=True to generate_avatar() = "use anime model".
        # Style routing: most characters get the anime model; a curated set of
        # "real-world" categories get the semi-realistic painted (Flux) style.
        PAINTED_CATEGORIES = {"Romance", "Historical", "Helpers", "Slice of Life"}
        is_nsfw = bool(c.get("nsfw"))
        is_anime_tagged = (
            c.get("category") == "Anime"
            or any(str(t).lower() == "anime" for t in (c.get("tags") or []))
        )
        # Painted only if it's a real-world category AND not nsfw/anime-tagged.
        wants_painted = (c.get("category") in PAINTED_CATEGORIES) and not is_nsfw and not is_anime_tagged
        use_anime_model = not wants_painted
        prompt = build_prompt_for(c)
        if is_nsfw:
            label = "[NSFW]"
        elif wants_painted:
            label = "[PAINT]"
        else:
            label = "[ANIME]"
        print(f"  {i:>3}/{len(chars)} {label} {name:30s} ... ", end="", flush=True)
        t0 = time.time()

        # Retry on Replicate 429 throttling. Free-tier accounts get rate
        # limited fast; back off with exponential delay and try a few times.
        data_uri = None
        last_err: str | None = None
        for attempt in range(5):
            try:
                data_uri = await generate_avatar(prompt, anime=use_anime_model, explicit=is_nsfw)
                break
            except Exception as e:
                last_err = str(e)[:120]
                if "429" in last_err or "throttle" in last_err.lower() or "rate limit" in last_err.lower():
                    wait = 15 * (attempt + 1)  # 15s, 30s, 45s, 60s, 75s
                    print(f"throttled, waiting {wait}s … ", end="", flush=True)
                    await asyncio.sleep(wait)
                    continue
                break  # non-throttle error → don't retry

        if data_uri:
            await db.characters.update_one(
                {"id": c["id"]},
                {"$set": {"avatar": data_uri}},
            )
            print(f"OK ({time.time()-t0:.1f}s)")
            success += 1
        else:
            print(f"FAIL ({last_err})")
            failed.append((name, last_err or "unknown"))
        # Pace between characters to stay under Replicate rate limits.
        await asyncio.sleep(8)

    elapsed = time.time() - started
    print()
    print(f"Done in {elapsed:.0f}s. Success: {success}/{len(chars)}.")
    if failed:
        print("Failures:")
        for name, msg in failed:
            print(f"  - {name}: {msg}")

    client.close()
    return 0 if not failed else 2


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", choices=["nsfw", "sfw"], help="Filter by NSFW flag.")
    parser.add_argument("--name", help="Only match characters whose name contains this (case-insensitive).")
    parser.add_argument("--limit", type=int, help="Max number to regenerate.")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip characters whose avatar is already an AI-generated data URI.")
    parser.add_argument("--anime-only", action="store_true",
                        help="Filter to characters in the Anime category or tagged 'anime'.")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args)))
