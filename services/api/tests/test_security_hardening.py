"""Pruebas de endurecimiento: tickets de eventos y bloqueo de cuenta."""

from uuid import uuid4

from httpx import AsyncClient

from app.core.config import settings
from app.modules.security.rate_limit import login_rate_limiter
from app.modules.security.stream_tickets import consume_stream_ticket, issue_stream_ticket


async def test_event_stream_rejects_jwt_in_query(client: AsyncClient):
    job_id = uuid4()
    response = await client.get(
        f"/api/v1/training-jobs/{job_id}/events",
        params={"token": "un-jwt-que-no-debe-aceptarse-por-url"},
    )
    assert response.status_code == 401


async def test_stream_ticket_is_single_use():
    job_id = str(uuid4())
    user_id = str(uuid4())
    ticket = await issue_stream_ticket(job_id=job_id, user_id=user_id)

    payload = await consume_stream_ticket(ticket=ticket, job_id=job_id)
    assert payload == {"job_id": job_id, "user_id": user_id}
    # El segundo intento con el mismo ticket debe fallar.
    assert await consume_stream_ticket(ticket=ticket, job_id=job_id) is None


async def test_stream_ticket_is_bound_to_job():
    job_id = str(uuid4())
    ticket = await issue_stream_ticket(job_id=job_id, user_id=str(uuid4()))

    assert await consume_stream_ticket(ticket=ticket, job_id=str(uuid4())) is None


async def test_login_locks_account_after_repeated_failures(client: AsyncClient):
    email = f"lockout-{uuid4()}@example.com"
    await login_rate_limiter.reset_failures(email)
    try:
        for _ in range(settings.LOGIN_MAX_FAILED_ATTEMPTS):
            response = await client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "WrongPassword1!"},
            )
            assert response.status_code == 401

        blocked = await client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "WrongPassword1!"},
        )
        assert blocked.status_code == 429
        assert blocked.headers.get("retry-after")
    finally:
        await login_rate_limiter.reset_failures(email)


async def test_docs_csp_allows_swagger_assets(client: AsyncClient):
    response = await client.get("/api/v1/docs")
    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert "cdn.jsdelivr.net" in csp
    assert "script-src" in csp


async def test_rest_of_api_keeps_strict_csp(client: AsyncClient):
    response = await client.get("/health")
    assert response.headers["content-security-policy"] == (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
