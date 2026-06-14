"""Thin async wrapper around OpenRouter for chat + story generation.

OpenRouter exposes an OpenAI-compatible API, so we reuse the `openai` SDK
pointed at the OpenRouter base URL. All Claude (or other model) calls in the
app funnel through `complete()` / `stream()` so there is a single place that
knows about the model, the API key, and the endpoint.

The OpenAI client is built lazily on first use so the API key only needs to be
present at call time (not at import time). This avoids subtle bugs where the
module is imported before `.env` is loaded.
"""
import os
import logging
from typing import AsyncIterator, List, Dict, Optional

import httpx
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

_client: Optional[AsyncOpenAI] = None


# ---------- BPE token-leak repair ----------
# Some OpenRouter providers occasionally stream RAW byte-level-BPE tokens
# instead of decoded text (you see "Ġ" where spaces should be and "Ċ" where
# newlines should be). The GPT-2 byte encoder maps every byte 0-255 to a
# printable unicode char; this builds the reverse map so we can detect and
# repair leaked chunks.
def _bpe_byte_decoder() -> dict:
    # Mirrors OpenAI GPT-2 bytes_to_unicode(): printable ASCII + latin-1
    # ranges map to themselves; everything else is shifted up past 0x100.
    bs = list(range(ord("!"), ord("~") + 1)) + list(range(ord("¡"), ord("¬") + 1)) + list(range(ord("®"), ord("ÿ") + 1))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    return {chr(c): b for b, c in zip(bs, cs)}


_BPE_DECODER = _bpe_byte_decoder()
# Telltale characters that only appear in leaked raw BPE text.
_BPE_MARKERS = ("Ġ", "Ċ", "ĉ", "Ń")


def _fix_bpe_leak(text: str) -> str:
    """If `text` looks like raw byte-level-BPE output, decode it to UTF-8.

    Safe on normal text: we only attempt the repair when telltale marker
    chars are present, and fall back to the original string on any error.
    """
    if not text or not any(m in text for m in _BPE_MARKERS):
        return text
    try:
        byte_vals = bytearray()
        for ch in text:
            b = _BPE_DECODER.get(ch)
            if b is None:
                # Char outside the BPE alphabet — encode as-is.
                byte_vals.extend(ch.encode("utf-8"))
            else:
                byte_vals.append(b)
        return byte_vals.decode("utf-8", errors="replace")
    except Exception:
        return text


def _model() -> str:
    """SFW model slug, read fresh each call so OPENROUTER_MODEL changes apply on reload."""
    return os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-4.5")


def _nsfw_model() -> str:
    """NSFW model slug for adult-content chats. Configurable via env."""
    return os.environ.get("OPENROUTER_NSFW_MODEL", "gryphe/mythomax-l2-13b")


def pick_model(nsfw: bool = False) -> str:
    """Choose the model slug for a call based on the NSFW flag."""
    return _nsfw_model() if nsfw else _model()


def _get_client() -> AsyncOpenAI:
    """Build (once) and return the OpenAI client pointed at OpenRouter."""
    global _client
    if _client is not None:
        return _client
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")
    # Explicit timeout; SSL verification uses the default context, which
    # server.py has patched via `truststore.inject_into_ssl()` to use the OS
    # trust store. That works correctly even when an HTTPS-inspecting AV /
    # corporate proxy is rewriting certificates.
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0))
    _client = AsyncOpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=key,
        http_client=http_client,
        # Optional attribution headers used by OpenRouter for ranking.
        default_headers={
            "HTTP-Referer": os.environ.get("OPENROUTER_REFERER", "http://localhost:8081"),
            "X-Title": os.environ.get("OPENROUTER_TITLE", "VZAS.AI"),
        },
    )
    return _client


def is_configured() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY", ""))


async def complete(
    system: str,
    messages: List[Dict[str, str]],
    max_tokens: int = 1024,
    nsfw: bool = False,
) -> str:
    """Run a single chat completion through OpenRouter and return the text.

    When `nsfw=True`, routes to the uncensored NSFW model instead of the
    default Claude/SFW model.
    """
    client = _get_client()
    full_messages = [{"role": "system", "content": system}, *messages]
    resp = await client.chat.completions.create(
        model=pick_model(nsfw),
        max_tokens=max_tokens,
        messages=full_messages,
    )
    return _fix_bpe_leak((resp.choices[0].message.content or "")).strip()


async def stream(
    system: str,
    messages: List[Dict[str, str]],
    max_tokens: int = 1024,
    nsfw: bool = False,
) -> AsyncIterator[str]:
    """Stream a chat completion through OpenRouter, yielding text chunks.

    When `nsfw=True`, routes to the uncensored NSFW model. `_fix_bpe_leak`
    runs on every chunk as a harmless safety net against providers that leak
    raw byte-level-BPE tokens.
    """
    client = _get_client()
    model = pick_model(nsfw)
    full_messages = [{"role": "system", "content": system}, *messages]
    response = await client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=full_messages,
        stream=True,
    )
    async for chunk in response:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        text = getattr(delta, "content", None)
        if text:
            yield _fix_bpe_leak(text)
