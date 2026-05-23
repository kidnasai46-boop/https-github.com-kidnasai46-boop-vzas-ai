"""Backend API tests for Personae (AI Character Chat App)."""
import time
import pytest
import requests

# ---------- Characters (public) ----------

class TestCharactersPublic:
    def test_list_characters_returns_13(self, client, api, has_object_id):
        r = client.get(f"{api}/characters", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "characters" in data
        chars = data["characters"]
        assert isinstance(chars, list)
        # there are 13 seeded officials, plus possibly user-created during tests
        official = [c for c in chars if c.get("is_official")]
        assert len(official) >= 13, f"Expected >=13 official chars, got {len(official)}"
        # schema sanity on first item
        first = chars[0]
        for k in ["id", "name", "tagline", "description", "personality", "backstory",
                  "greeting", "avatar", "genre", "tags", "is_official", "chat_count"]:
            assert k in first, f"Missing field: {k}"
        assert not has_object_id(data), "Response leaks Mongo _id"

    def test_filter_by_genre(self, client, api):
        r = client.get(f"{api}/characters", params={"genre": "Fantasy"}, timeout=15)
        assert r.status_code == 200
        chars = r.json()["characters"]
        assert len(chars) >= 1
        assert all(c["genre"] == "Fantasy" for c in chars)

    def test_search_lyra(self, client, api):
        r = client.get(f"{api}/characters", params={"search": "Lyra"}, timeout=15)
        assert r.status_code == 200
        chars = r.json()["characters"]
        assert len(chars) >= 1
        assert any("Lyra" in c["name"] for c in chars)

    def test_featured_returns_up_to_6(self, client, api, has_object_id):
        r = client.get(f"{api}/characters/featured", timeout=15)
        assert r.status_code == 200
        data = r.json()
        chars = data["characters"]
        assert 1 <= len(chars) <= 6
        assert all(c["is_official"] for c in chars)
        assert not has_object_id(data)

    def test_get_single_character(self, client, api, has_object_id):
        r = client.get(f"{api}/characters", timeout=15)
        cid = r.json()["characters"][0]["id"]
        r2 = client.get(f"{api}/characters/{cid}", timeout=15)
        assert r2.status_code == 200
        data = r2.json()
        assert data["character"]["id"] == cid
        assert not has_object_id(data)

    def test_get_character_404(self, client, api):
        r = client.get(f"{api}/characters/nope-nonexistent-id", timeout=15)
        assert r.status_code == 404


# ---------- Auth ----------

class TestAuth:
    def test_auth_me_with_valid_token(self, client, api, auth_headers, has_object_id):
        r = client.get(f"{api}/auth/me", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["user"]["user_id"] == "user_tester0001"
        assert data["user"]["email"] == "tester@example.com"
        assert not has_object_id(data)

    def test_auth_me_missing_token(self, client, api):
        r = client.get(f"{api}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_auth_me_invalid_token(self, client, api):
        r = client.get(f"{api}/auth/me",
                       headers={"Authorization": "Bearer invalid_xxx"}, timeout=15)
        assert r.status_code == 401


# ---------- Chats + LLM ----------

_chat_state = {}

class TestChats:
    def test_start_chat(self, client, api, auth_headers, has_object_id):
        # pick first character
        r = client.get(f"{api}/characters", timeout=15)
        cid = r.json()["characters"][0]["id"]
        _chat_state["character_id"] = cid

        r2 = client.post(f"{api}/chats/start/{cid}", headers=auth_headers, timeout=20)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert "chat" in data
        chat = data["chat"]
        assert chat["user_id"] == "user_tester0001"
        assert chat["character_id"] == cid
        assert not has_object_id(data)
        _chat_state["chat_id"] = chat["id"]

    def test_start_chat_idempotent(self, client, api, auth_headers):
        cid = _chat_state["character_id"]
        r = client.post(f"{api}/chats/start/{cid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["chat"]["id"] == _chat_state["chat_id"]

    def test_start_chat_404(self, client, api, auth_headers):
        r = client.post(f"{api}/chats/start/no-such-char", headers=auth_headers, timeout=15)
        assert r.status_code == 404

    def test_list_chats(self, client, api, auth_headers, has_object_id):
        r = client.get(f"{api}/chats", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        chats = data["chats"]
        assert any(c["id"] == _chat_state["chat_id"] for c in chats)
        target = next(c for c in chats if c["id"] == _chat_state["chat_id"])
        assert target.get("character") is not None
        assert target["character"]["id"] == _chat_state["character_id"]
        assert not has_object_id(data)

    def test_get_chat_with_messages(self, client, api, auth_headers, has_object_id):
        cid = _chat_state["chat_id"]
        r = client.get(f"{api}/chats/{cid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["chat"]["id"] == cid
        assert data["character"]["id"] == _chat_state["character_id"]
        # should contain greeting assistant message
        msgs = data["messages"]
        assert len(msgs) >= 1
        assert msgs[0]["role"] == "assistant"
        assert not has_object_id(data)

    def test_send_message_claude_reply(self, client, api, auth_headers, has_object_id):
        cid = _chat_state["chat_id"]
        payload = {"content": "Hello! Please greet me briefly in one short sentence, in character."}
        r = client.post(f"{api}/chats/{cid}/messages",
                        headers=auth_headers, json=payload, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "user_message" in data and "assistant_message" in data
        assert data["user_message"]["role"] == "user"
        assert data["user_message"]["content"] == payload["content"]
        assert data["assistant_message"]["role"] == "assistant"
        reply = data["assistant_message"]["content"]
        assert isinstance(reply, str) and len(reply.strip()) > 0
        # Fallback string is used only when LLM fails — flag if we got it
        FALLBACK = "Sorry, my mind drifted for a moment"
        assert FALLBACK not in reply, f"LLM fallback returned: {reply}"
        assert not has_object_id(data)

    def test_delete_chat(self, client, api, auth_headers):
        cid = _chat_state["chat_id"]
        r = client.delete(f"{api}/chats/{cid}", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("success") is True
        r2 = client.get(f"{api}/chats/{cid}", headers=auth_headers, timeout=15)
        assert r2.status_code == 404


# ---------- Character creation + avatar gen ----------

_char_state = {}

class TestCharacterCreation:
    def test_create_character_requires_auth(self, client, api):
        r = client.post(f"{api}/characters", json={
            "name": "X", "tagline": "x", "description": "x", "personality": "x",
            "backstory": "x", "greeting": "x", "avatar": "x", "genre": "Fantasy", "tags": []
        }, timeout=15)
        assert r.status_code == 401

    def test_create_character(self, client, api, auth_headers, has_object_id):
        payload = {
            "name": "TEST_Char_Echo",
            "tagline": "Just a test character",
            "description": "A test-suite created character.",
            "personality": "Helpful and brief.",
            "backstory": "Born in pytest.",
            "greeting": "Hi from test!",
            "avatar": "https://example.com/x.png",
            "genre": "Sci-Fi",
            "tags": ["test", "auto"],
        }
        r = client.post(f"{api}/characters", headers=auth_headers, json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        c = data["character"]
        assert c["name"] == payload["name"]
        assert c["creator_id"] == "user_tester0001"
        assert c["is_official"] is False
        assert not has_object_id(data)
        _char_state["id"] = c["id"]

        # verify via GET
        r2 = client.get(f"{api}/characters/{c['id']}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["character"]["name"] == payload["name"]

    def test_my_characters(self, client, api, auth_headers, has_object_id):
        r = client.get(f"{api}/characters/mine", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        ids = [c["id"] for c in data["characters"]]
        assert _char_state["id"] in ids
        assert all(c["creator_id"] == "user_tester0001" for c in data["characters"])
        assert not has_object_id(data)

    def test_my_characters_requires_auth(self, client, api):
        r = client.get(f"{api}/characters/mine", timeout=15)
        assert r.status_code == 401


@pytest.mark.slow
class TestAvatarGeneration:
    def test_generate_avatar_returns_data_uri(self, client, api, auth_headers):
        payload = {"prompt": "A stoic forest ranger with green cloak, weathered face, freckles"}
        r = client.post(f"{api}/characters/generate-avatar",
                        headers=auth_headers, json=payload, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        avatar = data.get("avatar", "")
        assert avatar.startswith("data:image/"), f"Bad avatar prefix: {avatar[:80]}"
        # base64 segment should be non-trivial
        assert ";base64," in avatar
        b64 = avatar.split(";base64,", 1)[1]
        assert len(b64) > 1000

    def test_generate_avatar_requires_auth(self, client, api):
        r = client.post(f"{api}/characters/generate-avatar",
                        json={"prompt": "x"}, timeout=15)
        assert r.status_code == 401
