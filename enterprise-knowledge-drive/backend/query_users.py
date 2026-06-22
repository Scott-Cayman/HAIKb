#!/usr/bin/env python3
# 查询数据库中的用户数据

import sys
from pathlib import Path
from collections import defaultdict

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from app.database import SessionLocal
from app.models.user import User

def main():
    db = SessionLocal()
    try:
        users = db.query(User).all()
        print(f"数据库中共有 {len(users)} 个用户：\n")
        
        # 按根部门分组
        users_by_root_dept = defaultdict(list)
        for user in users:
            root_dept = user.root_department_name or "其他"
            users_by_root_dept[root_dept].append(user)
        
        print("按根部门分组的用户:")
        print("=" * 120)
        
        for root_dept, dept_users in users_by_root_dept.items():
            print(f"\n【{root_dept}】 - {len(dept_users)}人")
            print("-" * 100)
            
            for user in dept_users:
                dept_display = user.full_department_path or user.department_name or "-"
                role_tag = []
                if user.is_super_admin:
                    role_tag.append("超级管理员")
                elif user.is_admin:
                    role_tag.append("管理员")
                
                role_str = f" ({', '.join(role_tag)})" if role_tag else ""
                print(f"  • {user.name:<15} | {dept_display} {role_str}")
        
        print("\n" + "=" * 120)
        print("\n详细用户信息:")
        print("=" * 120)
        
        for user in users:
            print(f"\n用户 ID: {user.id}")
            print(f"  姓名: {user.name}")
            print(f"  用户名: {user.username}")
            print(f"  邮箱: {user.email}")
            print(f"  钉钉用户 ID: {user.ding_userid}")
            print(f"  钉钉 unionid: {user.unionid}")
            print(f"  手机号: {user.mobile}")
            print(f"  头像: {user.avatar}")
            print(f"  部门 ID: {user.department_id}")
            print(f"  部门名称: {user.department_name}")
            print(f"  完整部门路径: {user.full_department_path}")
            print(f"  根部门: {user.root_department_name}")
            print(f"  超级管理员: {'是' if user.is_super_admin else '否'}")
            print(f"  管理员: {'是' if user.is_admin else '否'}")
            print(f"  激活状态: {'是' if user.is_active else '否'}")
            print(f"  最后登录: {user.last_login_at}")
            print(f"  创建时间: {user.created_at}")
            print(f"  更新时间: {user.updated_at}")
            
    finally:
        db.close()

if __name__ == "__main__":
    main()
