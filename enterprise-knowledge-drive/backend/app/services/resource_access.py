from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy.orm import Session

from app.models.file import File
from app.models.folder import Folder
from app.models.resource_permission import ResourcePermission
from app.models.user import User
from app.services.folder_access import (
    can_manage_folder_settings,
    can_view_folder,
    user_belongs_to_department,
)

RESOURCE_TYPE_FOLDER = "folder"
RESOURCE_TYPE_FILE = "file"

CAPABILITY_VIEW = "view"
CAPABILITY_DOWNLOAD = "download"
CAPABILITY_EDIT = "edit"
CAPABILITY_UPLOAD = "upload"
CAPABILITY_DELETE = "delete"

SUBJECT_TYPE_ALL = "all"
SUBJECT_TYPE_ORG = "org"
SUBJECT_TYPE_USER = "user"
LEGACY_SUBJECT_TYPE_DEPARTMENT = "department"


def _can_configure_home_pins(db: Session, folder: Folder) -> bool:
    if folder.parent_id is None:
        return True
    parent_folder = (
        db.query(Folder)
        .filter(Folder.id == folder.parent_id, Folder.is_deleted == False)
        .first()
    )
    return parent_folder is not None and parent_folder.parent_id is None


@dataclass
class ResourceCapabilities:
    can_view: bool = False
    can_download: bool = False
    can_edit: bool = False
    can_rename: bool = False
    can_delete: bool = False
    can_upload: bool = False
    can_manage_settings: bool = False
    can_manage_permissions: bool = False
    can_pin_children: bool = False

    def to_dict(self) -> Dict[str, bool]:
        return {
            "can_view": self.can_view,
            "can_download": self.can_download,
            "can_edit": self.can_edit,
            "can_rename": self.can_rename,
            "can_delete": self.can_delete,
            "can_upload": self.can_upload,
            "can_manage_settings": self.can_manage_settings,
            "can_manage_permissions": self.can_manage_permissions,
            "can_pin_children": self.can_pin_children,
        }


def _normalize_subject_value(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _get_user_org_tokens(user: User) -> Set[str]:
    tokens: Set[str] = set()
    for value in (user.department_name, user.root_department_name):
        normalized = _normalize_subject_value(value)
        if normalized:
            tokens.add(normalized)

    full_paths: List[str] = []
    primary_path = _normalize_subject_value(user.full_department_path)
    if primary_path:
        full_paths.append(primary_path)
    try:
        stored_paths = json.loads(user.department_paths or "[]")
    except (TypeError, json.JSONDecodeError):
        stored_paths = []
    if isinstance(stored_paths, list):
        full_paths.extend(str(path).strip() for path in stored_paths if str(path).strip())

    for full_path in set(full_paths):
        parts = [part.strip() for part in full_path.split("/") if part.strip()]
        for start in range(len(parts)):
            prefix = []
            for part in parts[start:]:
                tokens.add(part)
                prefix.append(part)
                tokens.add("/".join(prefix))

    return tokens


def _resource_permission_matches(rule: ResourcePermission, user: User) -> bool:
    if rule.subject_type == SUBJECT_TYPE_ALL:
        return True

    if rule.subject_type == SUBJECT_TYPE_USER:
        try:
            return int(rule.subject_value or "0") == user.id
        except ValueError:
            return False

    if rule.subject_type in {SUBJECT_TYPE_ORG, LEGACY_SUBJECT_TYPE_DEPARTMENT}:
        subject_value = _normalize_subject_value(rule.subject_value)
        if not subject_value:
            return False
        return subject_value in _get_user_org_tokens(user)

    return False


def _load_folder_ancestors(db: Session, folder: Folder) -> List[Folder]:
    ancestors: List[Folder] = []
    current_parent_id = folder.parent_id
    visited: Set[int] = set()

    while current_parent_id and current_parent_id not in visited:
        visited.add(current_parent_id)
        current_folder = (
            db.query(Folder)
            .filter(Folder.id == current_parent_id, Folder.is_deleted == False)
            .first()
        )
        if not current_folder:
            break
        ancestors.append(current_folder)
        current_parent_id = current_folder.parent_id

    ancestors.reverse()
    return ancestors


def _query_rules(
    db: Session,
    resource_type: str,
    resource_ids: Sequence[int],
    capability: str,
) -> List[ResourcePermission]:
    if not resource_ids:
        return []
    return (
        db.query(ResourcePermission)
        .filter(
            ResourcePermission.resource_type == resource_type,
            ResourcePermission.resource_id.in_(list(resource_ids)),
            ResourcePermission.capability == capability,
        )
        .all()
    )


def _has_matching_rule(rules: Iterable[ResourcePermission], user: User) -> bool:
    return any(_resource_permission_matches(rule, user) for rule in rules)


def _folder_chain_rule_result(
    db: Session,
    folder: Folder,
    user: User,
    capability: str,
) -> Optional[bool]:
    # The closest configured rule set wins. Combining every rule in the tree
    # would let an ancestor's broad grant bypass a child's restricted rules.
    chain = [folder] + list(reversed(_load_folder_ancestors(db, folder)))
    for index, current_folder in enumerate(chain):
        rules = _query_rules(db, RESOURCE_TYPE_FOLDER, [current_folder.id], capability)
        # Rules configured on the resource itself always apply. Ancestor rules
        # only apply when inheritance was explicitly kept enabled.
        if index > 0:
            rules = [rule for rule in rules if rule.inherit_to_children]
        if rules:
            return _has_matching_rule(rules, user)
    return None


def _file_rule_result(
    db: Session,
    file: File,
    user: User,
    capability: str,
) -> Optional[bool]:
    file_rules = _query_rules(db, RESOURCE_TYPE_FILE, [file.id], capability)
    if file_rules:
        return _has_matching_rule(file_rules, user)

    if file.folder_id:
        folder = db.query(Folder).filter(Folder.id == file.folder_id, Folder.is_deleted == False).first()
        if folder:
            return _folder_chain_rule_result(db, folder, user, capability)
    return None


def get_folder_capabilities(db: Session, folder: Folder, user: User) -> ResourceCapabilities:
    if user.is_super_admin:
        return ResourceCapabilities(
            can_view=True,
            can_download=True,
            can_edit=True,
            can_rename=True,
            can_delete=True,
            can_upload=True,
            can_manage_settings=True,
            can_manage_permissions=True,
            can_pin_children=_can_configure_home_pins(db, folder),
        )

    if user.is_admin:
        department_manage = can_manage_folder_settings(db, folder, user)
        explicit_view = _folder_chain_rule_result(db, folder, user, CAPABILITY_VIEW)
        legacy_view = can_view_folder(db, folder, user)
        # Admin status only elevates capabilities inside the user's department.
        # Outside that branch the account behaves like a read-only user and must
        # still match the configured view rules.
        can_view = department_manage or (
            explicit_view if explicit_view is not None else legacy_view
        )
        return ResourceCapabilities(
            can_view=can_view,
            can_download=department_manage,
            can_edit=department_manage,
            can_rename=department_manage,
            can_delete=department_manage,
            can_upload=department_manage,
            can_manage_settings=department_manage,
            can_manage_permissions=department_manage,
            can_pin_children=department_manage and _can_configure_home_pins(db, folder),
        )

    legacy_view = can_view_folder(db, folder, user)
    explicit_view = _folder_chain_rule_result(db, folder, user, CAPABILITY_VIEW)
    download_rule = _folder_chain_rule_result(db, folder, user, CAPABILITY_DOWNLOAD)
    edit_rule = _folder_chain_rule_result(db, folder, user, CAPABILITY_EDIT)
    upload_rule = _folder_chain_rule_result(db, folder, user, CAPABILITY_UPLOAD)
    delete_rule = _folder_chain_rule_result(db, folder, user, CAPABILITY_DELETE)
    can_download = download_rule is True
    can_edit = edit_rule is True
    can_upload = upload_rule is True
    can_delete = delete_rule is True
    # Granting an action on a directory necessarily makes the directory visible.
    # This prevents an administrator from creating a valid upload rule that the
    # target user cannot reach in the UI because a separate view rule was missed.
    can_view = (
        explicit_view if explicit_view is not None else legacy_view
    ) or can_download or can_edit or can_upload or can_delete

    return ResourceCapabilities(
        can_view=can_view,
        can_download=can_download,
        can_edit=can_edit,
        can_rename=can_edit,
        can_delete=can_delete,
        can_upload=can_upload,
        can_manage_settings=False,
        can_manage_permissions=False,
        can_pin_children=False,
    )


def get_file_capabilities(db: Session, file: File, user: User) -> ResourceCapabilities:
    if user.is_super_admin:
        return ResourceCapabilities(
            can_view=True,
            can_download=True,
            can_edit=True,
            can_rename=True,
            can_delete=True,
            can_manage_settings=True,
            can_manage_permissions=True,
        )

    if user.is_admin:
        parent_folder = None
        if file.folder_id:
            parent_folder = (
                db.query(Folder)
                .filter(Folder.id == file.folder_id, Folder.is_deleted == False)
                .first()
            )
        can_view = False
        can_edit = False
        can_download = False
        if parent_folder:
            parent_capabilities = get_folder_capabilities(db, parent_folder, user)
            can_edit = parent_capabilities.can_edit
            can_download = parent_capabilities.can_download
            explicit_view = _file_rule_result(db, file, user, CAPABILITY_VIEW)
            can_view = can_edit or (
                explicit_view if explicit_view is not None else parent_capabilities.can_view
            )
        elif user_belongs_to_department(user, file.department_name):
            can_view = True
            can_edit = True
            can_download = True
        return ResourceCapabilities(
            can_view=can_view,
            can_download=can_download,
            can_edit=can_edit,
            can_rename=can_edit,
            can_delete=can_edit,
            can_manage_settings=can_edit,
            can_manage_permissions=can_edit,
        )

    parent_folder = None
    if file.folder_id:
        parent_folder = (
            db.query(Folder)
            .filter(Folder.id == file.folder_id, Folder.is_deleted == False)
            .first()
        )

    explicit_view = _file_rule_result(db, file, user, CAPABILITY_VIEW)
    download_rule = _file_rule_result(db, file, user, CAPABILITY_DOWNLOAD)
    edit_rule = _file_rule_result(db, file, user, CAPABILITY_EDIT)
    delete_rule = _file_rule_result(db, file, user, CAPABILITY_DELETE)

    if explicit_view is not None:
        rule_based_view = explicit_view
    elif parent_folder:
        rule_based_view = get_folder_capabilities(db, parent_folder, user).can_view
    else:
        rule_based_view = user_belongs_to_department(user, file.department_name)

    can_download = download_rule is True
    can_edit = edit_rule is True
    can_delete = delete_rule is True

    return ResourceCapabilities(
        can_view=rule_based_view or can_download or can_edit or can_delete,
        can_download=can_download,
        can_edit=can_edit,
        can_rename=can_edit,
        can_delete=can_delete,
        can_manage_settings=False,
        can_manage_permissions=False,
    )


def list_visible_files(
    db: Session,
    files: Sequence[File],
    user: User,
) -> List[File]:
    return [file for file in files if get_file_capabilities(db, file, user).can_view]


def list_visible_folders(
    db: Session,
    folders: Sequence[Folder],
    user: User,
) -> List[Folder]:
    return [folder for folder in folders if get_folder_capabilities(db, folder, user).can_view]
