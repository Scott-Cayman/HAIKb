from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
import httpx
from app.database import SessionLocal, engine
from app.models.user import User
from app.config import settings


def _get_dingtalk_app_access_token(client: httpx.Client) -> str:
    """获取钉钉应用访问令牌"""
    token_res = client.get(
        "https://oapi.dingtalk.com/gettoken",
        params={"appkey": settings.DINGTALK_CLIENT_ID, "appsecret": settings.DINGTALK_CLIENT_SECRET},
    )
    token_data = token_res.json() if token_res.status_code < 400 else {}
    return token_data.get("access_token", "")


def _get_full_department_path(client: httpx.Client, dept_id: str, app_access_token: str) -> tuple[str | None, str | None]:
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


def migrate():
    print("开始部门路径字段迁移...")
    db = SessionLocal()
    try:
        # 使用SQLAlchemy inspect检查列是否存在
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('users')]
        
        with engine.connect() as conn:
            if 'full_department_path' not in columns:
                print("添加 full_department_path 列...")
                conn.execute(text("ALTER TABLE users ADD COLUMN full_department_path VARCHAR"))
                conn.commit()
                print("full_department_path 列添加成功!")
            else:
                print("full_department_path 列已存在.")
            
            if 'root_department_name' not in columns:
                print("添加 root_department_name 列...")
                conn.execute(text("ALTER TABLE users ADD COLUMN root_department_name VARCHAR"))
                conn.commit()
                print("root_department_name 列添加成功!")
            else:
                print("root_department_name 列已存在.")

        # 为现有用户获取完整部门信息
        users = db.query(User).filter(User.department_id.isnot(None)).all()
        print(f"找到 {len(users)} 个有部门信息的用户")
        
        if users:
            app_access_token = ""
            with httpx.Client(timeout=20) as client:
                # 获取应用访问令牌
                app_access_token = _get_dingtalk_app_access_token(client)
                
                if not app_access_token:
                    print("警告：无法获取钉钉应用访问令牌，将跳过部门路径获取")
                else:
                    updated_count = 0
                    for user in users:
                        if user.department_id and not user.full_department_path:
                            print(f"处理用户: {user.name} (部门: {user.department_name})")
                            full_path, root_dept = _get_full_department_path(
                                client, user.department_id, app_access_token
                            )
                            if full_path:
                                user.full_department_path = full_path
                            if root_dept:
                                user.root_department_name = root_dept
                            if full_path or root_dept:
                                db.add(user)
                                updated_count += 1
                                print(f"  -> 更新为: {full_path} / {root_dept}")
                    
                    if updated_count > 0:
                        db.commit()
                        print(f"成功更新 {updated_count} 个用户的部门路径信息!")
        
        print("迁移完成!")
        
        # 显示更新后的用户信息
        print("\n用户部门信息汇总:")
        print("-" * 100)
        users = db.query(User).all()
        for user in users:
            dept_info = user.department_name
            if user.full_department_path:
                dept_info = user.full_department_path
            if user.root_department_name:
                dept_info = f"[{user.root_department_name}] {dept_info}"
            print(f"{user.name:<15} -> {dept_info}")
            
    except Exception as e:
        print(f"迁移过程中出错: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
