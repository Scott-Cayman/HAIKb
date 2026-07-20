from __future__ import annotations

import copy
from typing import Optional

from app.models.user import User


class DepartmentScopeService:
    """为管理员提供临时部门测试作用域。"""

    def normalize_override_department_name(self, department_name: Optional[str]) -> Optional[str]:
        if department_name is None:
            return None
        normalized = department_name.strip()
        return normalized or None

    def can_use_override(self, user: Optional[User]) -> bool:
        # Department overrides are a super-admin diagnostic feature. Allowing a
        # department administrator to override this value would expand both the
        # visible-file set and the AI retrieval scope beyond their own branch.
        return bool(user and user.is_super_admin)

    def build_scoped_user(self, user: User, override_department_name: Optional[str]) -> User:
        normalized_department_name = self.normalize_override_department_name(override_department_name)
        if not normalized_department_name or not self.can_use_override(user):
            return user

        scoped_user = copy.copy(user)
        scoped_user.department_name = normalized_department_name
        scoped_user.root_department_name = normalized_department_name
        scoped_user.full_department_path = normalized_department_name
        return scoped_user


department_scope_service = DepartmentScopeService()
