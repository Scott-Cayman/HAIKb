from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import AliasChoices, BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session
from jose import jwt
from passlib.context import CryptContext
from app.database import get_db
from app.models.user import User
from app.config import settings
from app.dependencies.auth import get_current_user

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.ALGORITHM)
    return encoded_jwt


def _create_dingtalk_oauth_state() -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=settings.DINGTALK_OAUTH_STATE_EXPIRE_SECONDS)
    payload = {"purpose": "dingtalk_oauth_state", "nonce": secrets.token_urlsafe(16), "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.ALGORITHM)


def _verify_dingtalk_oauth_state(state: str) -> None:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=[settings.ALGORITHM])
    except Exception as exc:
        raise HTTPException(status_code=400, detail="state 校验失败") from exc

    if payload.get("purpose") != "dingtalk_oauth_state":
        raise HTTPException(status_code=400, detail="state 校验失败")


def _looks_like_placeholder(value: str) -> bool:
    cleaned = (value or "").strip()
    if not cleaned:
        return True
    lowered = cleaned.lower()
    return lowered in {
        "replace_me",
        "mock_client_id",
        "mock_client_secret",
        "dingding_app_key",
        "dingding_app_secret",
    }


def _require_dingtalk_config() -> None:
    if _looks_like_placeholder(settings.DINGTALK_CLIENT_ID) or _looks_like_placeholder(settings.DINGTALK_CLIENT_SECRET):
        raise HTTPException(status_code=500, detail="钉钉应用未配置：请设置真实的 DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET")

    if not settings.DINGTALK_REDIRECT_URI:
        raise HTTPException(status_code=500, detail="钉钉应用未配置：请设置 DINGTALK_REDIRECT_URI")


def _format_dingtalk_error(payload: dict) -> str:
    if not isinstance(payload, dict):
        return "未知错误"
    parts = []
    for key in ("errcode", "errmsg", "code", "message", "request_id"):
        value = payload.get(key)
        if value is None or value == "":
            continue
        parts.append(f"{key}={value}")
    return " ".join(parts) if parts else "未知错误"


def _get_full_department_path(client: httpx.Client, dept_id: str, app_access_token: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """
    获取完整的部门路径信息
    返回: (完整部门路径, 根部门名称)
    """
    dept_path = []
    current_dept_id = dept_id
    
    try:
        while current_dept_id:
            # 先尝试新接口
            dept_res = client.get(
                f"https://api.dingtalk.com/v1.0/contact/departments/{current_dept_id}",
            )
            dept_data = None
            if dept_res.status_code < 400:
                dept_data = dept_res.json() or {}
                dept_name = dept_data.get("name")
                parent_dept_id = dept_data.get("parent_id") or dept_data.get("parentId")
            elif app_access_token:
                # 回退到旧接口
                legacy_dept_res = client.post(
                    "https://oapi.dingtalk.com/topapi/v2/department/get",
                    params={"access_token": app_access_token},
                    json={"dept_id": int(current_dept_id)},
                )
                if legacy_dept_res.status_code < 400:
                    legacy_payload = legacy_dept_res.json() or {}
                    dept_data = legacy_payload.get("result") or {}
                    dept_name = dept_data.get("name")
                    parent_dept_id = dept_data.get("parent_id") or dept_data.get("parentId")
                else:
                    break
            else:
                break
            
            if dept_name:
                dept_path.insert(0, dept_name)
            
            # 获取父部门ID，需要注意处理根部门的情况
            if parent_dept_id and str(parent_dept_id) != "1":  # 通常 1 是根部门ID
                current_dept_id = str(parent_dept_id)
            else:
                current_dept_id = None
        
        # 构建完整路径
        full_path = "/".join(dept_path) if dept_path else None
        # 根部门是路径的第一个元素
        root_dept = dept_path[0] if dept_path else None
        
        return full_path, root_dept
        
    except Exception as e:
        print(f"获取部门路径时出错: {e}")
        return None, None


class DingTalkCallbackRequest(BaseModel):
    code: str = Field(..., validation_alias=AliasChoices("code", "authCode", "auth_code"))
    state: str

    model_config = {"populate_by_name": True}


@router.get("/dingtalk/login-url")
def get_dingtalk_login_url():
    if settings.AUTH_MOCK:
        return {"url": "/auth/mock"}
    _require_dingtalk_config()

    state = _create_dingtalk_oauth_state()
    params = {
        "redirect_uri": settings.DINGTALK_REDIRECT_URI,
        "response_type": "code",
        "client_id": settings.DINGTALK_CLIENT_ID,
        "scope": "openid corpid",
        "state": state,
        "prompt": "consent",
    }
    url = "https://login.dingtalk.com/oauth2/auth?" + str(httpx.QueryParams(params))
    return {"url": url, "state": state}

@router.post("/dingtalk/callback")
def dingtalk_callback(request: DingTalkCallbackRequest, db: Session = Depends(get_db)):
    if settings.AUTH_MOCK:
        raise HTTPException(status_code=400, detail="Use mock login in mock mode")

    _require_dingtalk_config()

    if not request.state:
        raise HTTPException(status_code=400, detail="缺少 state")

    _verify_dingtalk_oauth_state(request.state)

    with httpx.Client(timeout=20) as client:
        token_res = client.post(
            "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
            json={
                "clientId": settings.DINGTALK_CLIENT_ID,
                "clientSecret": settings.DINGTALK_CLIENT_SECRET,
                "code": request.code,
                "grantType": "authorization_code",
            },
        )
        token_data = token_res.json() if token_res.headers.get("content-type", "").startswith("application/json") else {}
        if token_res.status_code >= 400:
            raise HTTPException(status_code=400, detail=f"钉钉授权失败：{_format_dingtalk_error(token_data)}")
        user_access_token = token_data.get("accessToken")
        if not user_access_token:
            raise HTTPException(status_code=400, detail=f"钉钉授权失败：{_format_dingtalk_error(token_data)}")

        me_res = client.get(
            "https://api.dingtalk.com/v1.0/contact/users/me",
            headers={"x-acs-dingtalk-access-token": user_access_token},
        )
        if me_res.status_code >= 400:
            raise HTTPException(status_code=400, detail="获取钉钉用户信息失败")
        me_data = me_res.json() or {}

        unionid = me_data.get("unionId") or me_data.get("unionid")
        nick = me_data.get("nick") or me_data.get("name")
        avatar_url = me_data.get("avatarUrl") or me_data.get("avatar")
        mobile = me_data.get("mobile")
        email = me_data.get("email")
        org_email = me_data.get("orgEmail") or me_data.get("org_email")
        dept_id_list = me_data.get("deptIdList") or me_data.get("dept_id_list") or []

        app_access_token: Optional[str] = None
        ding_userid: Optional[str] = None
        if unionid:
            app_token_res = client.get(
                "https://oapi.dingtalk.com/gettoken",
                params={"appkey": settings.DINGTALK_CLIENT_ID, "appsecret": settings.DINGTALK_CLIENT_SECRET},
            )
            app_token_data = app_token_res.json() if app_token_res.status_code < 400 else {}
            app_access_token = app_token_data.get("access_token")

        if unionid and app_access_token:
            uid_res = client.post(
                "https://oapi.dingtalk.com/topapi/user/getbyunionid",
                params={"access_token": app_access_token},
                json={"unionid": unionid},
            )
            uid_data = uid_res.json() if uid_res.status_code < 400 else {}
            ding_userid = (uid_data.get("result") or {}).get("userid")

        if ding_userid and app_access_token:
            detail_res = client.post(
                "https://oapi.dingtalk.com/topapi/v2/user/get",
                params={"access_token": app_access_token},
                json={"userid": ding_userid},
            )
            detail_data = detail_res.json() if detail_res.status_code < 400 else {}
            detail_result = detail_data.get("result") or {}

            org_email = detail_result.get("org_email") or org_email
            email = detail_result.get("email") or email
            nick = detail_result.get("name") or nick
            avatar_url = detail_result.get("avatar") or avatar_url
            mobile = detail_result.get("mobile") or mobile
            dept_id_list = detail_result.get("dept_id_list") or detail_result.get("deptIdList") or dept_id_list

        final_email = (org_email or email or "").strip().lower()
        if not final_email:
            raise HTTPException(status_code=403, detail="登录失败：仅限企业邮箱用户登录")

        allowed_domains = [
            item.strip().lower()
            for item in (settings.DINGTALK_ALLOWED_EMAIL_DOMAINS or "").split(",")
            if item.strip()
        ]
        if not allowed_domains:
            allowed_domains = ["@himice.com"]

        if not any(final_email.endswith(domain) for domain in allowed_domains):
            raise HTTPException(status_code=403, detail="登录失败：仅限企业邮箱用户登录")

        dept_id = None
        if isinstance(dept_id_list, list) and dept_id_list:
            dept_id = str(dept_id_list[0])

        dept_name = None
        full_department_path = None
        root_department_name = None
        
        if dept_id:
            # 先获取当前部门名称
            dept_res = client.get(
                f"https://api.dingtalk.com/v1.0/contact/departments/{dept_id}",
                headers={"x-acs-dingtalk-access-token": user_access_token},
            )
            if dept_res.status_code < 400:
                dept_name = (dept_res.json() or {}).get("name")
            elif app_access_token:
                legacy_dept_res = client.post(
                    "https://oapi.dingtalk.com/topapi/v2/department/get",
                    params={"access_token": app_access_token},
                    json={"dept_id": int(dept_id)},
                )
                legacy_payload = legacy_dept_res.json() if legacy_dept_res.status_code < 400 else {}
                dept_name = (legacy_payload.get("result") or {}).get("name")
            
            # 获取完整部门路径
            full_department_path, root_department_name = _get_full_department_path(
                client, dept_id, app_access_token
            )

        conditions = [User.email == final_email]
        if unionid:
            conditions.append(User.unionid == unionid)
        if ding_userid:
            conditions.append(User.ding_userid == ding_userid)

        user = db.query(User).filter(or_(*conditions)).first()

        now = datetime.now(timezone.utc)
        
        # 检查是否是超级管理员
        super_admin_emails = [
            item.strip().lower()
            for item in (settings.SUPER_ADMIN_EMAILS or "").split(",")
            if item.strip()
        ]
        is_super_admin = final_email in super_admin_emails
        
        # 检查是否是普通管理员
        admin_emails = [
            item.strip().lower()
            for item in (settings.ADMIN_EMAILS or "").split(",")
            if item.strip()
        ]
        is_admin = is_super_admin or final_email in admin_emails
        
        if not user:
            user = User(
                name=nick or final_email,
                username=final_email,
                email=final_email,
                unionid=unionid,
                ding_userid=ding_userid,
                avatar=avatar_url,
                mobile=mobile,
                department_id=dept_id,
                department_name=dept_name,
                full_department_path=full_department_path,
                root_department_name=root_department_name,
                last_login_at=now,
                is_active=True,
                is_super_admin=is_super_admin,
                is_admin=is_admin,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user.name = nick or user.name
            user.username = user.username or final_email
            user.email = final_email
            user.unionid = unionid or user.unionid
            user.ding_userid = ding_userid or user.ding_userid
            user.avatar = avatar_url or user.avatar
            user.mobile = mobile or user.mobile
            user.department_id = dept_id or user.department_id
            user.department_name = dept_name or user.department_name
            user.full_department_path = full_department_path or user.full_department_path
            user.root_department_name = root_department_name or user.root_department_name
            user.last_login_at = now
            # 如果是超级管理员邮箱，自动提升权限
            if is_super_admin:
                user.is_super_admin = True
                user.is_admin = True
            elif is_admin:
                # 如果是普通管理员但不是超级管理员，只设置 is_admin
                user.is_admin = True
            db.commit()
            db.refresh(user)

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(data={"sub": str(user.id)}, expires_delta=access_token_expires)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "username": user.username,
            "avatar": user.avatar,
            "is_admin": user.is_admin,
            "is_super_admin": user.is_super_admin,
            "department_name": user.department_name,
            "full_department_path": user.full_department_path,
            "root_department_name": user.root_department_name,
            "is_active": user.is_active,
        },
    }

@router.get("/mock-login")
def mock_login(role: str = "user", db: Session = Depends(get_db)):
    if not settings.AUTH_MOCK:
        raise HTTPException(status_code=400, detail="Mock login disabled")
    
    # Check if mock user exists
    user = db.query(User).filter(User.name == f"Mock {role.capitalize()}").first()
    if not user:
        user = User(
            name=f"Mock {role.capitalize()}",
            is_super_admin=(role == "superadmin"),
            is_admin=(role == "admin" or role == "superadmin"),
            is_active=True,
            department_name="Mock Department"
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "is_admin": user.is_admin, "is_super_admin": user.is_super_admin}}

@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "user": {"id": user.id, "name": user.name, "username": user.username, "is_admin": user.is_admin, "is_super_admin": user.is_super_admin}}

@router.get("/me")
def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user
