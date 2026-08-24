"""
Tests for the API layer — auth and batch endpoints.
Uses httpx AsyncClient with a test SQLite database.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_login_success(client):
    res = await client.post("/api/auth/login", json={"username": "autoace", "password": "autoace2024"})
    assert res.status_code == 200
    assert "access_token" in res.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client):
    res = await client.post("/api/auth/login", json={"username": "autoace", "password": "wrong"})
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_upload_requires_auth(client):
    res = await client.post("/api/batch/upload")
    assert res.status_code in (401, 422)


@pytest.mark.asyncio
async def test_upload_rejects_non_zip(client):
    # Login first
    login_res = await client.post("/api/auth/login", json={"username": "autoace", "password": "autoace2024"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.post(
        "/api/batch/upload",
        headers=headers,
        files={"file": ("test.txt", b"not a zip", "text/plain")},
    )
    assert res.status_code == 400
    assert "zip" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_health_endpoint(client):
    res = await client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert "status" in data
    assert data["status"] == "ok"
    assert "models_loaded" in data


@pytest.mark.asyncio
async def test_batch_not_found(client):
    login_res = await client.post("/api/auth/login", json={"username": "autoace", "password": "autoace2024"})
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = await client.get("/api/batch/99999", headers=headers)
    assert res.status_code == 404
