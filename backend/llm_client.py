"""Thin async wrapper around OpenRouter for chat + story generation.

OpenRouter exposes an OpenAI-compatible API, so we reuse the `openai` SDK
pointed at the OpenRouter base URL. All Claude (or other model) calls in the
app funnel through `complete()` so there is a single place that knows about
the model, the API key, and the endpoint.
"""
import os
import logging
from typing import List, Dict, Optional

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# Model is configurable so you can swap without touching code.
MODEL = os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5")

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

_client: Optional[AsyncOpenAI] = (
    AsyncOpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=OPENROUTER_API_KEY,
        # Optional attribution headers used by OpenRouter for ranking.
        default_headers={
            "HTTP-Referer": os.environ.get("OPENROUTER_REFERER", "http://localhost:8081"),
            "X-Title": os.environ.get("OPENROUTER_TITLE", "VZAS.AI"),
        },
    )
    if OPENROUTER_API_KEY
    else None
)


def is_configured() -> bool:
    return _client is not None


async def complete(
    system: str,
    messages: List[Dict[str, str]],
    max_tokens: int = 1024,
) -> str:
    """Run a single chat completion through OpenRouter and return the text.

    Args:
        system: System prompt string (sent as the first system message).
        messages: List of {"role": "user"|"assistant", "content": str}.
        max_tokens: Response token cap.

    Raises:
        RuntimeError: if no OPENROUTER_API_KEY is configured.
        Exception: any error from the API (callers handle fallbacks).
    """
    if _client is None:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")

    full_messages = [{"role": "system", "content": system}, *messages]
    resp = await _client.chat.completions.create(
        model=MODEL,
        max_tokens=max_tokens,
        messages=full_messages,
    )
    return (resp.choices[0].message.content or "").strip()
