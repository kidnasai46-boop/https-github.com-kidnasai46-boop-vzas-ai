"""Image generation via Novita AI.

Drop-in alternative to image_client (Replicate). Same public interface:
`generate_avatar(user_prompt, anime, explicit) -> data URI`, and the same
prompt-building / SFW-suppression logic, so the rest of the app is unchanged.

Novita hosts hundreds of community SDXL checkpoints by name and keeps popular
ones warm (no cold starts). We use:
  * NOVITA_ANIME_MODEL  — anime + NSFW characters. WAI-NSFW-Illustrious by
                          default: clean Illustrious anime, SFW via rating
                          tags, explicit when allowed.
  * NOVITA_PAINT_MODEL  — semi-real "painted" characters (Romance/Historical/
                          etc.). A 2.5D / semi-realistic checkpoint.

Uses Novita's async txt2img: submit a task, poll for the result.
"""
import os
import time
import base64
import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://api.novita.ai"

# SFW anime uses a clean model (low nudity risk); NSFW anime uses an
# explicit-capable one; painted uses a semi-real SDXL.
_DEFAULT_ANIME_SFW = "animagineXLV31_v31_325600.safetensors"
_DEFAULT_ANIME_NSFW = "hassakuHentaiModel_v13_75289.safetensors"
_DEFAULT_PAINT = "copaxTimelessxlSDXL1_v9_230929.safetensors"


def _anime_model(explicit: bool) -> str:
    if explicit:
        return os.environ.get("NOVITA_ANIME_NSFW_MODEL", _DEFAULT_ANIME_NSFW)
    return os.environ.get("NOVITA_ANIME_SFW_MODEL", _DEFAULT_ANIME_SFW)


def _paint_model() -> str:
    return os.environ.get("NOVITA_PAINT_MODEL", _DEFAULT_PAINT)


def is_configured() -> bool:
    return bool(os.environ.get("NOVITA_API_KEY", ""))


# ---- Prompt building (mirrors image_client, incl. strong SFW suppression) ----

_ANIME_QUALITY = "masterpiece, best quality, amazing quality, very aesthetic, absurdres"
_ANIME_FRAMING = "solo, 1person, upper body, looking at viewer, detailed face, detailed eyes, simple clean background"
_ANIME_NEG_BASE = (
    "lowres, bad anatomy, bad hands, error, missing fingers, extra digit, "
    "fewer digits, cropped, worst quality, low quality, jpeg artifacts, blurry, "
    "deformed, disfigured, mutation, extra limbs, "
    "text, english text, japanese text, speech bubble, dialogue, caption, "
    "manga, comic, comic panel, panel, multiple views, 2koma, 4koma, "
    "border, frame, signature, watermark, username, logo, sign, "
    "face paint, facial markings, tribal markings, war paint, "
    "blush stickers, random symbols on face, text on face, distorted face"
)
_ANIME_NEG_SFW = (
    ", nsfw, nude, naked, topless, bottomless, nipples, areola, explicit, sex, "
    "sexual, suggestive, ecchi, cleavage, large breasts, huge breasts, "
    "exposed breasts, bikini, swimsuit, lingerie, underwear, bra, panties, "
    "revealing clothes, revealing outfit, skimpy, see-through, exposed skin, "
    "bare midriff, bare chest, partially nude, cleavage cutout, underboob, "
    "sideboob, wet clothes"
)
_ANIME_SFW_POSITIVE = "rating_safe, sfw, fully clothed, modest clothing, decent, "

_PAINT_POSITIVE = (
    "digital painting, fantasy concept art, painterly, artstation, "
    "stylized character illustration, head and shoulders portrait, "
    "soft rendered lighting, rich detail"
)
_PAINT_NEG = (
    "photograph, photo, photorealistic, 3d render, lowres, bad anatomy, "
    "bad hands, worst quality, low quality, blurry, deformed, text, watermark, "
    "nsfw, nude, naked, cleavage, revealing"
)


def _build(user_prompt: str, anime: bool, explicit: bool):
    """Return (model, prompt, negative_prompt) for the given routing."""
    if anime:
        safe = "" if explicit else _ANIME_SFW_POSITIVE
        prompt = f"{_ANIME_QUALITY}, {safe}{_ANIME_FRAMING}, 1person, {user_prompt}"
        negative = _ANIME_NEG_BASE + ("" if explicit else _ANIME_NEG_SFW)
        return _anime_model(explicit), prompt, negative
    prompt = f"{_PAINT_POSITIVE}. Character: {user_prompt}"
    return _paint_model(), prompt, _PAINT_NEG


# ---- Novita async txt2img ----

async def generate_avatar(user_prompt: str, anime: bool = False, explicit: bool = False) -> str:
    """Generate one image via Novita and return a data URI."""
    key = os.environ.get("NOVITA_API_KEY", "")
    if not key:
        raise RuntimeError("NOVITA_API_KEY is not configured")
    model, prompt, negative = _build(user_prompt, anime, explicit)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {
        "extra": {"response_image_type": "jpeg"},
        "request": {
            "model_name": model,
            "prompt": prompt,
            "negative_prompt": negative,
            "width": 832,
            "height": 1216,
            "image_num": 1,
            "steps": 28,
            "guidance_scale": 5.0,
            "sampler_name": "Euler a",
            "seed": -1,
        },
    }

    async with httpx.AsyncClient(timeout=120) as http:
        sub = await http.post(f"{_BASE}/v3/async/txt2img", headers=headers, json=body)
        sub.raise_for_status()
        task_id = sub.json()["task_id"]

        # Poll for the result (Novita finishes warm models in a few seconds).
        deadline = time.time() + 120
        while time.time() < deadline:
            await asyncio.sleep(1.5)
            res = await http.get(
                f"{_BASE}/v3/async/task-result",
                headers=headers,
                params={"task_id": task_id},
            )
            res.raise_for_status()
            data = res.json()
            status = data.get("task", {}).get("status")
            if status == "TASK_STATUS_SUCCEED":
                images = data.get("images", [])
                if not images:
                    raise RuntimeError("Novita returned no images")
                image_url = images[0]["image_url"]
                img = await http.get(image_url)
                img.raise_for_status()
                b64 = base64.b64encode(img.content).decode("utf-8")
                return f"data:image/jpeg;base64,{b64}"
            if status == "TASK_STATUS_FAILED":
                reason = data.get("task", {}).get("reason", "unknown")
                raise RuntimeError(f"Novita task failed: {reason}")
        raise RuntimeError("Novita task timed out")
