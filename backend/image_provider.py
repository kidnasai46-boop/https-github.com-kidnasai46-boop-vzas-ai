"""Image-generation provider dispatcher.

Routes generate_avatar / is_configured to the backend named by the
IMAGE_PROVIDER env var ("novita" or "replicate"). Lets us swap providers
with one env change and keep both implementations around.
"""
import os


def _provider() -> str:
    return os.environ.get("IMAGE_PROVIDER", "replicate").strip().lower()


async def generate_avatar(user_prompt: str, anime: bool = False, explicit: bool = False) -> str:
    if _provider() == "novita":
        from novita_client import generate_avatar as _gen
    else:
        from image_client import generate_avatar as _gen
    return await _gen(user_prompt, anime=anime, explicit=explicit)


def is_configured() -> bool:
    if _provider() == "novita":
        from novita_client import is_configured as _cfg
    else:
        from image_client import is_configured as _cfg
    return _cfg()
