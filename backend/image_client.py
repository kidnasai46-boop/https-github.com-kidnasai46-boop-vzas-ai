"""Image generation via Replicate.

Two model families, picked per character:

  * REPLICATE_MODEL       — non-anime characters. Flux Schnell by default:
                            natural-language prompts, cinematic/realistic,
                            square 1024. Great for fantasy/sci-fi/etc.
  * REPLICATE_ANIME_MODEL — anime characters (and all NSFW). anillustrious-v4
                            by default: an Illustrious/NoobAI-family anime
                            checkpoint that takes Danbooru-style tag prompts,
                            a negative prompt, and a face-detailer pass. Does
                            clean cel-shaded anime art and supports explicit
                            content when the negative prompt allows it.

Two independent switches drive routing:
  * anime    -> which model (anime checkpoint vs Flux)
  * explicit -> whether the negative prompt blocks NSFW (only meaningful for
                the anime model; Flux stays SFW regardless)

Both model slugs are env-configurable so you can swap checkpoints without
touching code.
"""
import os
import base64
import asyncio
import logging
from typing import Optional

import httpx
import replicate

logger = logging.getLogger(__name__)

_client: Optional["replicate.Client"] = None

# Default anime checkpoint: anillustrious-v4 (Illustrious family). Pinned to a
# version so the slug resolves; override via REPLICATE_ANIME_MODEL.
_DEFAULT_ANIME_MODEL = (
    "aisha-ai-official/anillustrious-v4:"
    "80441e2c32a55f2fcf9b77fa0a74c6c86ad7deac51eed722b9faedb253265cb4"
)


def _flux_model() -> str:
    return os.environ.get("REPLICATE_MODEL", "black-forest-labs/flux-schnell")


def _anime_model() -> str:
    # REPLICATE_NSFW_MODEL kept as a fallback alias for backward compat with
    # older .env files that set it.
    return (
        os.environ.get("REPLICATE_ANIME_MODEL")
        or os.environ.get("REPLICATE_NSFW_MODEL")
        or _DEFAULT_ANIME_MODEL
    )


def _is_flux(model: str) -> bool:
    return "flux" in model.lower()


def _get_client() -> "replicate.Client":
    global _client
    if _client is not None:
        return _client
    token = os.environ.get("REPLICATE_API_TOKEN", "")
    if not token:
        raise RuntimeError("REPLICATE_API_TOKEN is not configured")
    _client = replicate.Client(api_token=token)
    return _client


def is_configured() -> bool:
    return bool(os.environ.get("REPLICATE_API_TOKEN", ""))


# Quality boosters + framing for Illustrious-family anime models.
_ANIME_QUALITY = "masterpiece, best quality, amazing quality, very aesthetic, absurdres"
_ANIME_FRAMING = "solo, 1person, upper body, looking at viewer, detailed face, detailed eyes, simple clean background"
_ANIME_NEG_BASE = (
    "lowres, bad anatomy, bad hands, error, missing fingers, "
    "extra digit, fewer digits, cropped, worst quality, low quality, "
    "jpeg artifacts, blurry, deformed, disfigured, mutation, extra limbs, "
    # Kill manga-page / text-bubble outputs (a common Illustrious failure):
    "text, english text, japanese text, speech bubble, dialogue, caption, "
    "manga, comic, comic panel, panel, multiple views, 2koma, 4koma, "
    "border, frame, signature, watermark, username, logo, sign, "
    # Kill stray facial artifacts:
    "face paint, facial markings, tribal markings, war paint, "
    "blush stickers, random symbols on face, text on face, distorted face"
)
# Aggressive SFW suppression for the anime model, which is NSFW-trained and
# will sexualize characters unless strongly blocked. Covers outright nudity
# AND merely revealing/suggestive content (bikinis, lingerie, heavy cleavage).
_ANIME_NEG_SFW = (
    ", nsfw, nude, naked, topless, bottomless, nipples, areola, "
    "explicit, sex, sexual, suggestive, ecchi, "
    "cleavage, large breasts, huge breasts, exposed breasts, "
    "bikini, swimsuit, lingerie, underwear, bra, panties, "
    "revealing clothes, revealing outfit, skimpy, see-through, "
    "exposed skin, bare midriff, bare chest, partially nude, "
    "thighs, cleavage cutout, underboob, sideboob, wet clothes"
)
# Positive tags that steer the anime model toward safe, clothed output.
_ANIME_SFW_POSITIVE = "rating_safe, sfw, fully clothed, modest clothing, decent, "

# Non-anime characters use a semi-realistic DIGITAL PAINTING style (not
# photoreal) so they sit next to the anime cast without the stock-photo clash.
_FLUX_STYLE = (
    "digital painting, fantasy concept art, painterly, artstation, "
    "stylized character illustration, head and shoulders portrait, "
    "soft rendered lighting, rich detail, not a photograph"
)


def _gender_hint(description: str) -> str:
    """Best-effort gender cue from a character description so Flux doesn't
    guess the wrong gender off an ambiguous name (e.g. 'Coach Max')."""
    d = f" {description.lower()} "
    male = sum(d.count(f" {w} ") for w in ("he", "him", "his", "man", "male", "guy", "boy", "father", "king", "prince", "mr"))
    female = sum(d.count(f" {w} ") for w in ("she", "her", "hers", "woman", "female", "girl", "lady", "mother", "queen", "princess", "mrs", "ms"))
    if male > female and male > 0:
        return "a man, "
    if female > male and female > 0:
        return "a woman, "
    return ""


async def generate_avatar(
    user_prompt: str,
    anime: bool = False,
    explicit: bool = False,
) -> str:
    """Generate one character image and return it as a data URI.

    Args:
        user_prompt: The character description.
        anime: Route to the anime checkpoint (Illustrious) instead of Flux.
        explicit: For the anime model, allow NSFW (don't block it in the
            negative prompt). Ignored for Flux.

    Returns:
        "data:image/png;base64,<...>"
    """
    client = _get_client()

    if anime:
        model = _anime_model()
        # For SFW, prepend safe-rating tags AND add the strong SFW negatives.
        safe_tags = "" if explicit else _ANIME_SFW_POSITIVE
        prompt = f"{_ANIME_QUALITY}, {safe_tags}{_ANIME_FRAMING}, 1person, {user_prompt}"
        negative = _ANIME_NEG_BASE + ("" if explicit else _ANIME_NEG_SFW)
        # Portrait dimensions read well as avatars; adetailer cleans up faces.
        params = {
            "prompt": prompt,
            "negative_prompt": negative,
            "width": 832,
            "height": 1216,
            "steps": 28,
            "cfg_scale": 5,
            "adetailer_face": True,
        }
    else:
        model = _flux_model()
        gender = _gender_hint(user_prompt)
        prompt = f"{_FLUX_STYLE}. Character: {gender}{user_prompt}"
        params = {"prompt": prompt, "width": 832, "height": 1216}

    # client.run blocks until the prediction finishes; offload to a thread to
    # stay in the async loop.
    output = await asyncio.to_thread(client.run, model, input=params)

    first = output[0] if isinstance(output, list) and output else output
    if first is None:
        raise RuntimeError("Replicate returned no images")
    image_url = getattr(first, "url", None)
    if callable(image_url):
        image_url = image_url()
    if not image_url:
        image_url = str(first)

    async with httpx.AsyncClient(timeout=120) as http:
        resp = await http.get(image_url)
        resp.raise_for_status()
        img_bytes = resp.content

    b64 = base64.b64encode(img_bytes).decode("utf-8")
    return f"data:image/png;base64,{b64}"
