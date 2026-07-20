from sqlalchemy import Boolean, Column, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from app.database import Base
from app.models.types import AwareDateTime


class ResourcePermission(Base):
    __tablename__ = "resource_permissions"

    id = Column(Integer, primary_key=True, index=True)
    resource_type = Column(String, nullable=False, index=True)  # folder / file
    resource_id = Column(Integer, nullable=False, index=True)
    # Keep the legacy columns mapped while the application migrates to the
    # capability/subject schema. Production still enforces NOT NULL on them.
    action = Column(String, nullable=True)
    capability = Column(String, nullable=False, index=True)  # view / download / edit
    subject_type = Column(String, nullable=False)  # all / org / user
    subject_value = Column(String, nullable=True)
    inherit_to_children = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(AwareDateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "resource_type",
            "resource_id",
            "capability",
            "subject_type",
            "subject_value",
            name="uq_resource_permissions_rule",
        ),
    )
