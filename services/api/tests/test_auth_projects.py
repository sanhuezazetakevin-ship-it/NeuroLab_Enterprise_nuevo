from httpx import AsyncClient


async def test_health_endpoint_reports_database(client: AsyncClient):
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert body["database"] == "up"


async def test_login_rejects_invalid_credentials(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "admin@neurolab.enterprise", "password": "WrongPassword1!"},
    )
    assert response.status_code == 401


async def test_authenticated_user_can_create_project(client: AsyncClient, admin_headers: dict):
    response = await client.post(
        "/api/v1/projects",
        headers=admin_headers,
        json={"name": "Proyecto de prueba", "description": "Cobertura de integración"},
    )
    assert response.status_code == 201, response.text
    project = response.json()
    assert project["name"] == "Proyecto de prueba"
    assert project["effective_role"] == "ADMIN"
    assert project["network_family"] == "FEEDFORWARD"

    listing = await client.get("/api/v1/projects", headers=admin_headers)
    assert listing.status_code == 200
    assert any(item["id"] == project["id"] for item in listing.json())


async def test_project_network_family_can_be_selected_and_updated(
    client: AsyncClient, admin_headers: dict
):
    created_ids = []
    for family in ("FEEDFORWARD", "RNN", "CNN", "GAN"):
        response = await client.post(
            "/api/v1/projects",
            headers=admin_headers,
            json={"name": f"Proyecto {family}", "network_family": family},
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["network_family"] == family
        created_ids.append(body["id"])

    project_id = created_ids[0]
    updated = await client.patch(
        f"/api/v1/projects/{project_id}",
        headers=admin_headers,
        json={"network_family": "CNN"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["network_family"] == "CNN"

    fetched = await client.get(f"/api/v1/projects/{project_id}", headers=admin_headers)
    assert fetched.status_code == 200
    assert fetched.json()["network_family"] == "CNN"


async def test_project_rejects_unknown_network_family(
    client: AsyncClient, admin_headers: dict
):
    response = await client.post(
        "/api/v1/projects",
        headers=admin_headers,
        json={"name": "Familia inválida", "network_family": "TRANSFORMER"},
    )
    assert response.status_code == 422


async def test_project_isolation_between_users(client, admin_headers, create_user, login):
    await create_user(admin_headers, "owner@example.com")
    await create_user(admin_headers, "intruder@example.com")
    owner_headers = await login("owner@example.com")
    intruder_headers = await login("intruder@example.com")

    created = await client.post(
        "/api/v1/projects",
        headers=owner_headers,
        json={"name": "Proyecto privado", "description": "Sólo propietario"},
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["id"]

    intruder_get = await client.get(f"/api/v1/projects/{project_id}", headers=intruder_headers)
    assert intruder_get.status_code == 404

    intruder_list = await client.get("/api/v1/projects", headers=intruder_headers)
    assert intruder_list.status_code == 200
    assert intruder_list.json() == []

    admin_get = await client.get(f"/api/v1/projects/{project_id}", headers=admin_headers)
    assert admin_get.status_code == 200


async def test_membership_grants_read_but_not_write(client, admin_headers, create_user, login):
    owner = await create_user(admin_headers, "lead@example.com", "PROJECT_LEAD")
    viewer = await create_user(admin_headers, "viewer@example.com", "VIEWER")
    owner_headers = await login("lead@example.com")
    viewer_headers = await login("viewer@example.com")

    project = (
        await client.post(
            "/api/v1/projects",
            headers=owner_headers,
            json={"name": "Proyecto compartido", "description": "RBAC"},
        )
    ).json()
    project_id = project["id"]

    added = await client.post(
        f"/api/v1/projects/{project_id}/members",
        headers=owner_headers,
        json={"email": viewer["email"], "role": "VIEWER"},
    )
    assert added.status_code == 201, added.text

    visible = await client.get(f"/api/v1/projects/{project_id}", headers=viewer_headers)
    assert visible.status_code == 200
    assert visible.json()["effective_role"] == "VIEWER"

    denied = await client.patch(
        f"/api/v1/projects/{project_id}",
        headers=viewer_headers,
        json={"name": "Intento no autorizado"},
    )
    assert denied.status_code == 403


async def test_requests_without_token_are_rejected(client: AsyncClient):
    response = await client.get("/api/v1/projects")
    assert response.status_code == 401
