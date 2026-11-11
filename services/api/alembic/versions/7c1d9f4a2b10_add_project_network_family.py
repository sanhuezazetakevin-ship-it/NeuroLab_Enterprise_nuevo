"""Tipo de red neuronal a nivel de proyecto.

Revision ID: 7c1d9f4a2b10
Revises: f25503c0985b
Create Date: 2026-11-01

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "7c1d9f4a2b10"
down_revision: Union[str, None] = "f25503c0985b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "network_family",
            sa.String(length=50),
            nullable=False,
            server_default="FEEDFORWARD",
        ),
    )


def downgrade() -> None:
    op.drop_column("projects", "network_family")
