from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    ding_userid = Column(String, unique=True, index=True, nullable=True)
    unionid = Column(String, unique=True, index=True, nullable=True)
    name = Column(String, nullable=False)
    username = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=True)
    avatar = Column(String, nullable=True)
    mobile = Column(String, nullable=True)
    email = Column(String, nullable=True)
    department_id = Column(String, nullable=True)
    department_name = Column(String, nullable=True)
    # 完整部门路径信息
    full_department_path = Column(String, nullable=True)  # 完整部门路径，如：跨界营销中心/第五事业部
    root_department_name = Column(String, nullable=True)  # 根部门名称，用于大分类
    is_super_admin = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
