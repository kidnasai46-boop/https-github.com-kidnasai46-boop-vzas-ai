import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
TEST_TOKEN = "test_token_aaa"


@pytest.fixture(scope="session")
def api():
    return API


@pytest.fixture(scope="session")
def auth_headers():
    return {"Authorization": f"Bearer {TEST_TOKEN}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _has_object_id(obj):
    """Recursively check that no '_id' / ObjectId leaks in response."""
    if isinstance(obj, dict):
        if "_id" in obj:
            return True
        return any(_has_object_id(v) for v in obj.values())
    if isinstance(obj, list):
        return any(_has_object_id(x) for x in obj)
    return False


@pytest.fixture(scope="session")
def has_object_id():
    return _has_object_id
