"""Lease de worker para recuperar trabajos huérfanos.

Revision ID: c1d2e3f4a5b6
Revises: b2c3d4e5f6a7
Create Date: 2026-11-05

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "training_jobs",
        sa.Column("worker_id", sa.String(length=150), nullable=True),
    )
    op.add_column(
        "training_jobs",
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "idx_training_jobs_heartbeat",
        "training_jobs",
        ["status", "heartbeat_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_training_jobs_heartbeat", table_name="training_jobs")
    op.drop_column("training_jobs", "heartbeat_at")
    op.drop_column("training_jobs", "worker_id")
