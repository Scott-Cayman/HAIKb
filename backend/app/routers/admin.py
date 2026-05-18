from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.user import User
from app.models.folder import Folder
from app.models.file import File
from app.dependencies.auth import get_current_super_admin, get_current_admin
from app.routers.auth import get_password_hash

router = APIRouter()

class UserCreate(BaseModel):
    name: str
    username: str
    password: str
    department_name: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    department_name: Optional[str] = None
    is_active: Optional[bool] = None

class RoleUpdate(BaseModel):
    is_admin: Optional[bool] = None
    is_super_admin: Optional[bool] = None

@router.get("/dashboard")
def get_dashboard(db: Session = Depends(get_db), current_admin: User = Depends(get_current_admin)):
    users_count = db.query(User).count()
    folders_count = db.query(Folder).filter(Folder.is_deleted == False).count()
    files_count = db.query(File).filter(File.is_deleted == False).count()
    
    return {
        "users_count": users_count,
        "folders_count": folders_count,
        "files_count": files_count
    }

@router.get("/users")
def get_users(db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    users = db.query(User).all()
    return {"users": users}

@router.post("/users")
def create_user(user_data: UserCreate, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    existing_user = db.query(User).filter(User.username == user_data.username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already exists"
        )
    
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        name=user_data.name,
        username=user_data.username,
        hashed_password=hashed_password,
        department_name=user_data.department_name,
        is_active=True
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    return {"message": "User created", "user": new_user}

@router.put("/users/{user_id}")
def update_user(user_id: int, user_data: UserUpdate, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if user_data.name is not None:
        user.name = user_data.name
    if user_data.department_name is not None:
        user.department_name = user_data.department_name
    if user_data.is_active is not None:
        user.is_active = user_data.is_active
    
    db.commit()
    db.refresh(user)
    
    return {"message": "User updated", "user": user}

@router.put("/users/{user_id}/role")
def update_user_role(user_id: int, role_data: RoleUpdate, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    if current_admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    if role_data.is_admin is not None:
        user.is_admin = role_data.is_admin
    if role_data.is_super_admin is not None:
        user.is_super_admin = role_data.is_super_admin
    
    db.commit()
    db.refresh(user)
    
    return {"message": "Role updated", "user": user}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), current_admin: User = Depends(get_current_super_admin)):
    if current_admin.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    db.delete(user)
    db.commit()
    
    return {"message": "User deleted"}
