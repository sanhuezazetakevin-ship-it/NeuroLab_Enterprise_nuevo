"""Unique constraint on model_versions (project_id, version).

Revision ID: b2c3d4e5f6a7
Revises: 7c1d9f4a2b10
Create Date: 2026-11-04
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "7c1d9f4a2b10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_model_versions_project_version",
        "model_versions",
        ["project_id", "version"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_model_versions_project_version",
        "model_versions",
        type_="unique",
    )
