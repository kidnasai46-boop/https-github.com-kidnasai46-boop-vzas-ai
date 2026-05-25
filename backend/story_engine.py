"""Living Stories Engine — story arc generation, meter evaluation, chapter progression."""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

DEFAULT_METERS = {"trust": 50, "affection": 50, "rivalry": 10, "fear": 0}

ARC_GENERATION_PROMPT = """You are a story arc designer for an interactive character chat app.

Given this character's personality and genre, generate a compelling story arc. Return ONLY valid JSON:

{{
  "title": "compelling arc name",
  "total_chapters": <3 to 5>,
  "chapters": [
    {{
      "number": 1,
      "title": "chapter title",
      "summary": "2-3 sentence chapter summary describing the situation and conflict",
      "target_messages": <15 to 20>,
      "themes": ["theme1", "theme2", "theme3"]
    }}
  ],
  "possible_endings": [
    {{"type": "good", "condition": "description of what leads to good ending"}},
    {{"type": "bad", "condition": "description of what leads to bad ending"}},
    {{"type": "secret", "condition": "description of hidden path to secret ending"}}
  ]
}}

Character: {name}
Genre: {genre}
Personality: {personality}
"""

METER_EVAL_PROMPT = """You are evaluating a conversation exchange in an interactive story.

Current relationship meters: Trust={trust}, Affection={affection}, Rivalry={rivalry}, Fear={fear}

The user said: "{user_msg}"
The character responded: "{assistant_msg}"

Evaluate the impact of this exchange. Return ONLY valid JSON:
{{
  "meter_changes": {{"trust": <-10 to +10>, "affection": <-10 to +10>, "rivalry": <-10 to +10>, "fear": <-10 to +10>}},
  "choice": null
}}

If the user made a significant narrative decision (not just casual chat), set "choice" to:
{{"choice": "short description of what they decided", "impact": "positive" or "negative" or "neutral"}}

Most messages change 1-2 meters by 2-5 points. Only big moments warrant 8-10 point swings."""

CHAPTER_ADVANCE_PROMPT = """You are a story director for an interactive character chat.

Story Arc: {arc_title}
Current Chapter: {chapter_num} — {chapter_title}
Chapter Theme: {themes}
Messages in chapter: {msg_count}
Target messages: {target}

Relationship Meters: Trust={trust}, Affection={affection}, Rivalry={rivalry}, Fear={fear}

Choices made so far:
{choices_text}

Based on the conversation so far, should this chapter conclude?

Return ONLY valid JSON:
{{
  "advance": true or false,
  "chapter_summary": "1-2 sentence summary of what happened in this chapter (only if advance=true)",
  "next_chapter_hook": "1 sentence teaser for next chapter (only if advance=true)"
}}"""

ENDING_EVAL_PROMPT = """You are determining the ending of an interactive story.

Story Arc: {arc_title}
Possible endings:
{endings_text}

Relationship Meters: Trust={trust}, Affection={affection}, Rivalry={rivalry}, Fear={fear}

All choices made:
{choices_text}

Which ending has been earned? Return ONLY valid JSON:
{{
  "ending_type": "good" or "bad" or "secret",
  "ending_summary": "2-3 sentence description of how the story ends"
}}"""


def _clamp(val: int, lo: int = 0, hi: int = 100) -> int:
    return max(lo, min(hi, val))


async def _llm_json_call(api_key: str, prompt: str) -> dict:
    llm = LlmChat(
        api_key=api_key,
        session_id=f"story_{uuid.uuid4().hex[:8]}",
        system_message="You are a JSON-only responder. Return only valid JSON, no markdown, no explanation.",
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")
    raw = await llm.send_message(UserMessage(text=prompt))
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
    return json.loads(raw)


async def generate_story_arc(api_key: str, character: dict) -> dict:
    prompt = ARC_GENERATION_PROMPT.format(
        name=character["name"],
        genre=character.get("genre", "Fantasy"),
        personality=character.get("personality", "")[:500],
    )
    arc_data = await _llm_json_call(api_key, prompt)
    arc_id = str(uuid.uuid4())
    return {
        "id": arc_id,
        "character_id": character["id"],
        "title": arc_data["title"],
        "total_chapters": arc_data["total_chapters"],
        "chapters": arc_data["chapters"],
        "possible_endings": arc_data["possible_endings"],
        "generated_at": datetime.now(timezone.utc),
    }


def init_story_state(arc: dict) -> dict:
    return {
        "arc_id": arc["id"],
        "arc_title": arc["title"],
        "chapter": 1,
        "total_chapters": arc["total_chapters"],
        "messages_in_chapter": 0,
        "choices_made": [],
        "meters": dict(DEFAULT_METERS),
        "ending": None,
        "completed": False,
    }


async def evaluate_meters_and_choices(
    api_key: str,
    user_msg: str,
    assistant_msg: str,
    current_meters: dict,
) -> dict:
    prompt = METER_EVAL_PROMPT.format(
        trust=current_meters["trust"],
        affection=current_meters["affection"],
        rivalry=current_meters["rivalry"],
        fear=current_meters["fear"],
        user_msg=user_msg[:500],
        assistant_msg=assistant_msg[:500],
    )
    try:
        return await _llm_json_call(api_key, prompt)
    except Exception:
        logger.exception("Meter evaluation failed, returning neutral")
        return {"meter_changes": {"trust": 0, "affection": 0, "rivalry": 0, "fear": 0}, "choice": None}


def apply_meter_changes(meters: dict, changes: dict) -> dict:
    updated = dict(meters)
    for key in ("trust", "affection", "rivalry", "fear"):
        delta = changes.get(key, 0)
        updated[key] = _clamp(updated[key] + delta)
    return updated


async def check_chapter_advance(
    api_key: str,
    arc: dict,
    story_state: dict,
) -> Optional[dict]:
    chapter_num = story_state["chapter"]
    chapter_info = None
    for ch in arc["chapters"]:
        if ch["number"] == chapter_num:
            chapter_info = ch
            break
    if not chapter_info:
        return None

    if story_state["messages_in_chapter"] < chapter_info.get("target_messages", 15):
        return None

    choices_text = "\n".join(
        f"- Ch.{c['chapter']}: {c['choice']} ({c['impact']})"
        for c in story_state["choices_made"]
    ) or "None yet"

    prompt = CHAPTER_ADVANCE_PROMPT.format(
        arc_title=arc["title"],
        chapter_num=chapter_num,
        chapter_title=chapter_info["title"],
        themes=", ".join(chapter_info.get("themes", [])),
        msg_count=story_state["messages_in_chapter"],
        target=chapter_info.get("target_messages", 15),
        trust=story_state["meters"]["trust"],
        affection=story_state["meters"]["affection"],
        rivalry=story_state["meters"]["rivalry"],
        fear=story_state["meters"]["fear"],
        choices_text=choices_text,
    )
    try:
        result = await _llm_json_call(api_key, prompt)
        if result.get("advance"):
            return result
    except Exception:
        logger.exception("Chapter advance check failed")
    return None


async def evaluate_ending(
    api_key: str,
    arc: dict,
    story_state: dict,
) -> dict:
    choices_text = "\n".join(
        f"- Ch.{c['chapter']}: {c['choice']} ({c['impact']})"
        for c in story_state["choices_made"]
    ) or "None"
    endings_text = "\n".join(
        f"- {e['type']}: {e['condition']}"
        for e in arc.get("possible_endings", [])
    )
    prompt = ENDING_EVAL_PROMPT.format(
        arc_title=arc["title"],
        endings_text=endings_text,
        trust=story_state["meters"]["trust"],
        affection=story_state["meters"]["affection"],
        rivalry=story_state["meters"]["rivalry"],
        fear=story_state["meters"]["fear"],
        choices_text=choices_text,
    )
    try:
        return await _llm_json_call(api_key, prompt)
    except Exception:
        logger.exception("Ending evaluation failed, defaulting to bad ending")
        return {"ending_type": "bad", "ending_summary": "The story reached an uncertain conclusion."}


def build_story_prompt_block(arc: dict, story_state: dict) -> str:
    chapter_num = story_state["chapter"]
    chapter_info = None
    for ch in arc["chapters"]:
        if ch["number"] == chapter_num:
            chapter_info = ch
            break

    chapter_title = chapter_info["title"] if chapter_info else "Unknown"
    chapter_summary = chapter_info["summary"] if chapter_info else ""
    themes = ", ".join(chapter_info.get("themes", [])) if chapter_info else ""

    choices_lines = "\n".join(
        f"- Chapter {c['chapter']}: {c['choice']} (impact: {c['impact']})"
        for c in story_state["choices_made"]
    )
    if not choices_lines:
        choices_lines = "None yet — this is the beginning of the story."

    meters = story_state["meters"]

    return (
        f"\nSTORY ARC: {arc['title']}\n"
        f"CURRENT CHAPTER: {chapter_num} — {chapter_title}\n"
        f"{chapter_summary}\n\n"
        f"PREVIOUS CHOICES THE USER MADE:\n{choices_lines}\n\n"
        f"RELATIONSHIP STATE:\n"
        f"Trust: {meters['trust']}/100 | Affection: {meters['affection']}/100 | "
        f"Rivalry: {meters['rivalry']}/100 | Fear: {meters['fear']}/100\n\n"
        "Weave the story naturally. Reference past choices when relevant. "
        f"Guide the narrative toward this chapter's themes: {themes}. "
        "React according to the relationship meters — high trust means openness, "
        "low trust means guardedness, high fear means the character is threatening. "
        "Do not explicitly mention meters or game mechanics."
    )
