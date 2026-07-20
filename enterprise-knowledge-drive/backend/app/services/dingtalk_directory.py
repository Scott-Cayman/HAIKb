from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.models.setting import SystemSetting
from app.models.user import User


DINGTALK_DIRECTORY_SETTING_KEY = "dingtalk_directory_tree"
DINGTALK_ROOT_DEPARTMENT_ID = "1"


class DingTalkDirectoryError(RuntimeError):
    pass


def _configured_emails(value: str) -> set[str]:
    return {item.strip().lower() for item in (value or "").split(",") if item.strip()}


def _legacy_post(client: httpx.Client, token: str, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    response = client.post(
        f"https://oapi.dingtalk.com/{path}",
        params={"access_token": token},
        json=payload,
    )
    try:
        data = response.json()
    except ValueError as exc:
        raise DingTalkDirectoryError("钉钉通讯录接口返回了无法解析的数据") from exc

    if response.status_code >= 400 or data.get("errcode") not in (None, 0):
        message = data.get("errmsg") or data.get("message") or f"HTTP {response.status_code}"
        raise DingTalkDirectoryError(f"钉钉通讯录接口调用失败：{message}")
    return data


def _get_app_access_token(client: httpx.Client) -> str:
    if not settings.DINGTALK_CLIENT_ID or not settings.DINGTALK_CLIENT_SECRET:
        raise DingTalkDirectoryError("钉钉应用尚未配置 AppKey 和 AppSecret")

    response = client.get(
        "https://oapi.dingtalk.com/gettoken",
        params={
            "appkey": settings.DINGTALK_CLIENT_ID,
            "appsecret": settings.DINGTALK_CLIENT_SECRET,
        },
    )
    try:
        data = response.json()
    except ValueError as exc:
        raise DingTalkDirectoryError("获取钉钉访问令牌失败") from exc
    token = data.get("access_token")
    if response.status_code >= 400 or data.get("errcode") not in (None, 0) or not token:
        raise DingTalkDirectoryError(f"获取钉钉访问令牌失败：{data.get('errmsg') or response.status_code}")
    return str(token)


def _department_detail(client: httpx.Client, token: str, department_id: str) -> Dict[str, Any]:
    payload = _legacy_post(
        client,
        token,
        "topapi/v2/department/get",
        {"dept_id": int(department_id)},
    )
    return payload.get("result") or {}


def _list_child_departments(client: httpx.Client, token: str, department_id: str) -> List[Dict[str, Any]]:
    payload = _legacy_post(
        client,
        token,
        "topapi/v2/department/listsub",
        {"dept_id": int(department_id)},
    )
    result = payload.get("result") or []
    return result if isinstance(result, list) else []


def _list_department_users(client: httpx.Client, token: str, department_id: str) -> List[Dict[str, Any]]:
    users: List[Dict[str, Any]] = []
    cursor = 0
    while True:
        payload = _legacy_post(
            client,
            token,
            "topapi/v2/user/list",
            {
                "dept_id": int(department_id),
                "cursor": cursor,
                "size": 100,
                "order_field": "entry_asc",
                "contain_access_limit": False,
            },
        )
        result = payload.get("result") or {}
        page_users = result.get("list") or []
        if isinstance(page_users, list):
            users.extend(page_users)
        if not result.get("has_more"):
            break
        next_cursor = result.get("next_cursor")
        if next_cursor is None or int(next_cursor) == cursor:
            break
        cursor = int(next_cursor)
    return users


def _fetch_directory() -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    with httpx.Client(timeout=30) as client:
        token = _get_app_access_token(client)
        root_detail = _department_detail(client, token, DINGTALK_ROOT_DEPARTMENT_ID)
        root_name = str(root_detail.get("name") or "企业组织").strip()

        departments: List[Dict[str, Any]] = [
            {
                "id": DINGTALK_ROOT_DEPARTMENT_ID,
                "parent_id": None,
                "name": root_name,
                "order": 0,
                "path": root_name,
                "scope_path": root_name,
            }
        ]
        department_map: Dict[str, Dict[str, Any]] = {DINGTALK_ROOT_DEPARTMENT_ID: departments[0]}
        queue = [DINGTALK_ROOT_DEPARTMENT_ID]

        while queue:
            parent_id = queue.pop(0)
            parent = department_map[parent_id]
            for child in _list_child_departments(client, token, parent_id):
                child_id = str(child.get("dept_id") or child.get("deptId") or "").strip()
                if not child_id or child_id in department_map:
                    continue
                child_name = str(child.get("name") or "未命名部门").strip()
                scope_prefix = "" if parent_id == DINGTALK_ROOT_DEPARTMENT_ID else parent.get("scope_path", "")
                scope_path = "/".join(part for part in (scope_prefix, child_name) if part)
                record = {
                    "id": child_id,
                    "parent_id": parent_id,
                    "name": child_name,
                    "order": int(child.get("order") or 0),
                    "path": f"{parent['path']}/{child_name}",
                    "scope_path": scope_path,
                }
                departments.append(record)
                department_map[child_id] = record
                queue.append(child_id)

        users_by_id: Dict[str, Dict[str, Any]] = {}
        for department in departments:
            department_id = department["id"]
            for raw_user in _list_department_users(client, token, department_id):
                ding_userid = str(raw_user.get("userid") or raw_user.get("userId") or "").strip()
                if not ding_userid:
                    continue
                existing = users_by_id.get(ding_userid)
                if existing is None:
                    existing = dict(raw_user)
                    existing["_listed_department_ids"] = []
                    users_by_id[ding_userid] = existing
                listed_ids = existing.setdefault("_listed_department_ids", [])
                if department_id not in listed_ids:
                    listed_ids.append(department_id)

        return departments, list(users_by_id.values())


def _upsert_user(
    db: Session,
    raw_user: Dict[str, Any],
    department_map: Dict[str, Dict[str, Any]],
) -> User:
    ding_userid = str(raw_user.get("userid") or raw_user.get("userId") or "").strip()
    unionid = str(raw_user.get("unionid") or raw_user.get("unionId") or "").strip() or None
    org_email = str(raw_user.get("org_email") or raw_user.get("orgEmail") or "").strip().lower()
    email = str(raw_user.get("email") or "").strip().lower()
    final_email = org_email or email or None

    conditions = [User.ding_userid == ding_userid]
    if unionid:
        conditions.append(User.unionid == unionid)
    if final_email:
        conditions.extend([User.email == final_email, User.username == final_email])
    user = db.query(User).filter(or_(*conditions)).first()

    raw_department_ids = raw_user.get("dept_id_list") or raw_user.get("deptIdList") or []
    department_ids = [str(value) for value in raw_department_ids if str(value) in department_map]
    for value in raw_user.get("_listed_department_ids") or []:
        value = str(value)
        if value in department_map and value not in department_ids:
            department_ids.append(value)
    department_id = department_ids[0] if department_ids else DINGTALK_ROOT_DEPARTMENT_ID
    department = department_map.get(department_id) or department_map[DINGTALK_ROOT_DEPARTMENT_ID]
    department_paths = []
    for current_department_id in department_ids or [DINGTALK_ROOT_DEPARTMENT_ID]:
        current_department = department_map.get(current_department_id)
        if not current_department:
            continue
        scope_path = current_department.get("scope_path") or current_department.get("name")
        if scope_path and scope_path not in department_paths:
            department_paths.append(scope_path)

    username = final_email or f"dingtalk:{ding_userid}"
    super_admin_emails = _configured_emails(settings.SUPER_ADMIN_EMAILS)
    configured_super_admin = bool(final_email and final_email in super_admin_emails)

    if user is None:
        user = User(
            ding_userid=ding_userid,
            unionid=unionid,
            name=str(raw_user.get("name") or username),
            username=username,
            email=final_email,
            avatar=raw_user.get("avatar") or None,
            mobile=raw_user.get("mobile") or None,
            department_id=department_id,
            department_name=department.get("name"),
            department_paths=json.dumps(department_paths, ensure_ascii=False),
            department_manually_overridden=False,
            full_department_path=department.get("scope_path") or department.get("name"),
            root_department_name=(department.get("scope_path") or department.get("name") or "").split("/")[0],
            is_active=bool(raw_user.get("active", True)),
            is_super_admin=configured_super_admin,
            is_admin=configured_super_admin,
        )
        db.add(user)
        return user

    user.ding_userid = ding_userid or user.ding_userid
    user.unionid = unionid or user.unionid
    user.name = str(raw_user.get("name") or user.name)
    user.username = user.username or username
    user.email = final_email or user.email
    user.avatar = raw_user.get("avatar") or user.avatar
    user.mobile = raw_user.get("mobile") or user.mobile
    if not user.department_manually_overridden:
        user.department_id = department_id
        user.department_name = department.get("name")
        user.department_paths = json.dumps(department_paths, ensure_ascii=False)
        user.full_department_path = department.get("scope_path") or department.get("name")
        user.root_department_name = (user.full_department_path or user.department_name or "").split("/")[0] or None
    user.is_active = bool(raw_user.get("active", True))
    if configured_super_admin:
        user.is_super_admin = True
        user.is_admin = True
    return user


def sync_dingtalk_directory(db: Session) -> Dict[str, Any]:
    departments, raw_users = _fetch_directory()
    department_map = {str(item["id"]): item for item in departments}
    for raw_user in raw_users:
        _upsert_user(db, raw_user, department_map)

    synced_at = datetime.now(timezone.utc).isoformat()
    stored_departments = [
        {
            "id": item["id"],
            "parent_id": item["parent_id"],
            "name": item["name"],
            "order": item["order"],
            "path": item["path"],
            "scope_path": item.get("scope_path") or item["name"],
        }
        for item in departments
    ]
    value = json.dumps(
        {"departments": stored_departments, "last_synced_at": synced_at},
        ensure_ascii=False,
    )
    setting = db.query(SystemSetting).filter(SystemSetting.key == DINGTALK_DIRECTORY_SETTING_KEY).first()
    if setting is None:
        setting = SystemSetting(
            key=DINGTALK_DIRECTORY_SETTING_KEY,
            value=value,
            description="钉钉通讯录部门树缓存",
        )
        db.add(setting)
    else:
        setting.value = value
        setting.description = "钉钉通讯录部门树缓存"

    db.commit()
    return {
        "departments_synced": len(departments),
        "users_synced": len(raw_users),
        "last_synced_at": synced_at,
    }


def _load_cached_directory(db: Session) -> Dict[str, Any]:
    setting = db.query(SystemSetting).filter(SystemSetting.key == DINGTALK_DIRECTORY_SETTING_KEY).first()
    if setting is None:
        return {"departments": [], "last_synced_at": None}
    try:
        payload = json.loads(setting.value)
    except (TypeError, json.JSONDecodeError):
        return {"departments": [], "last_synced_at": None}
    if not isinstance(payload, dict):
        return {"departments": [], "last_synced_at": None}
    return {
        "departments": payload.get("departments") if isinstance(payload.get("departments"), list) else [],
        "last_synced_at": payload.get("last_synced_at"),
    }


def get_directory_payload(db: Session) -> Dict[str, Any]:
    cached = _load_cached_directory(db)
    users = (
        db.query(User)
        .order_by(User.is_super_admin.desc(), User.is_admin.desc(), User.name.asc(), User.id.asc())
        .all()
    )
    return {
        "users": users,
        "departments": cached["departments"],
        "last_synced_at": cached["last_synced_at"],
        "sync_available": bool(settings.DINGTALK_CLIENT_ID and settings.DINGTALK_CLIENT_SECRET),
    }
