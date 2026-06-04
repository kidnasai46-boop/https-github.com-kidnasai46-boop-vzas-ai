"""Image generation via Replicate.

Replicate hosts most popular Hugging Face image models (Flux, SDXL, Pony,
Animagine, Illustrious, etc.) behind a single pay-per-prediction API. We use
two different models by default:

  * REPLICATE_MODEL       — SFW characters (Flux Schnell by default — fast,
                            cheap, broad style range).
  * REPLICATE_NSFW_MODEL  — NSFW characters (Pony Diffusion v6 XL by default
                            — the de-facto anime + NSFW standard).

Both are configurable via env so you can swap to any other Replicate-hosted
model (e.g. Animagine XL, Illustrious, Dreamshaper) without touching code.
"""
import os
import base64
import logging
from typing import Optional

import httpx
import replicate

logger = logging.getLogger(__name__)

_client: Optional["replicate.Client"] = None


def _sfw_model() -> str:
    """SFW Replicate model slug (configurable). Default: Flux Schnell."""
    return os.environ.get("REPLICATE_MODEL", "black-forest-labs/flux-schnell")


def _nsfw_model() -> str:
    """NSFW Replicate model slug (configurable). Default: same Flux Schnell as
    SFW — Flux makes great spicy portraits and is guaranteed to resolve. For
    truly explicit anime imagery, override OPENROUTER_NSFW_MODEL to a Pony /
    Illustrious / NoobAI fine-tune slug (e.g. asiryan/anime-pastel-diffusion,
    fofr/sdxl-pony-cum, etc.) once you've confirmed the slug exists on
    replicate.com/explore.
    """
    return os.environ.get("REPLICATE_NSFW_MODEL", "black-forest-labs/flux-schnell")


def _get_client() -> "replicate.Client":
    """Build (once) and return the Replicate client."""
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


def _build_prompt(user_prompt: str, nsfw: bool) -> str:
    """Wrap the user's character description in a stable prompt template.

    SFW template leans glamour / fashion-editorial — striking, attractive,
    photogenic, magnetic — without crossing into explicit. Flux Schnell
    handles 'beautiful / alluring / stunning' cues very well and will
    consistently produce eye-catching portraits.

    NSFW template uses Pony-style booster tags for the anime SDXL model.
    """
    style = (
        # NSFW — Pony Diffusion v6 / Illustrious / NoobAI prompt structure.
        # `rating_explicit` is the actual content unlock for these models;
        # without it Pony stays SFW/suggestive. `source_anime` picks the
        # anime aesthetic over Pony's other modes (furry/cartoon).
        "score_9, score_8_up, score_7_up, source_anime, rating_explicit, "
        "masterpiece, best quality, highly detailed, "
        "beautiful detailed face, expressive eyes, alluring, "
        "intimate framing, detailed anatomy, perfect proportions"
        if nsfw
        else
        # SFW (Flux Schnell) — glamour / fashion-editorial / attractive
        "Stunning close-up character portrait, striking and attractive, "
        "photogenic, magnetic gaze, glamorous fashion-editorial lighting, "
        "cinematic composition, vivid colors, ultra-detailed, "
        "captivating, eye-catching, beautiful"
    )
    return f"{style}. Character: {user_prompt}"


async def generate_avatar(user_prompt: str, nsfw: bool = False) -> str:
    """Generate one character-portrait image and return it as a data URI.

    Args:
        user_prompt: The character description from the user (will be wrapped
            in a style template).
        nsfw: If True, route to the NSFW model.

    Returns:
        `"data:image/png;base64,<...>"` ready to drop into an <Image> src.

    Raises:
        RuntimeError: if REPLICATE_API_TOKEN isn't set.
        Exception: any error from Replicate or the image download.
    """
    client = _get_client()
    model = _nsfw_model() if nsfw else _sfw_model()
    full_prompt = _build_prompt(user_prompt, nsfw)

    # The Replicate Python SDK's `run` method is synchronous-looking but
    # blocks until the prediction is done. To stay in the async loop we
    # offload it to a worker via asyncio.to_thread.
    import asyncio
    # Pass only the keys accepted by ~every image model on Replicate: prompt,
    # width, height. Avoid `num_outputs` and `aspect_ratio` because some models
    # (e.g. nsfw-flux-dev) reject unknown keys. Default 1024x1024 is square.
    output = await asyncio.to_thread(
        client.run,
        model,
        input={
            "prompt": full_prompt,
            "width": 1024,
            "height": 1024,
        },
    )

    # `output` is usually a list of FileOutput objects or URLs depending on
    # the model. Normalize to a single URL/bytes payload.
    if isinstance(output, list):
        if not output:
            raise RuntimeError("Replicate returned no images")
        first = output[0]
    else:
        first = output

    # FileOutput objects expose `.url`; raw URLs come as strings.
    image_url = getattr(first, "url", None)
    if callable(image_url):  # newer SDK has url() as a method
        image_url = image_url()
    if not image_url:
        image_url = str(first)

    async with httpx.AsyncClient(timeout=60) as http:
        resp = await http.get(image_url)
        resp.raise_for_status()
        img_bytes = resp.content

    b64 = base64.b64encode(img_bytes).decode("utf-8")
    return f"data:image/png;base64,{b64}"
