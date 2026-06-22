from sqlalchemy import text, inspect
from sqlalchemy.orm import Session
from app.database import SessionLocal, engine
from app.models.folder import Folder
from app.models.file import File
from app.models.user import User


def migrate():
    print("开始部门字段迁移...")
    db = SessionLocal()
    try:
        # 使用SQLAlchemy inspect检查列是否存在
        inspector = inspect(engine)
        
        # 1. 处理 folders 表
        print("\n处理 folders 表...")
        folder_columns = [col['name'] for col in inspector.get_columns('folders')]
        
        with engine.connect() as conn:
            if 'department_name' not in folder_columns:
                print("添加 department_name 列到 folders 表...")
                conn.execute(text("ALTER TABLE folders ADD COLUMN department_name VARCHAR"))
                conn.commit()
                print("department_name 列添加成功!")
            else:
                print("department_name 列已存在.")
            
            if 'is_super_admin_created' not in folder_columns:
                print("添加 is_super_admin_created 列到 folders 表...")
                conn.execute(text("ALTER TABLE folders ADD COLUMN is_super_admin_created BOOLEAN DEFAULT FALSE"))
                conn.commit()
                print("is_super_admin_created 列添加成功!")
            else:
                print("is_super_admin_created 列已存在.")
        
        # 2. 处理 files 表
        print("\n处理 files 表...")
        file_columns = [col['name'] for col in inspector.get_columns('files')]
        
        with engine.connect() as conn:
            if 'department_name' not in file_columns:
                print("添加 department_name 列到 files 表...")
                conn.execute(text("ALTER TABLE files ADD COLUMN department_name VARCHAR"))
                conn.commit()
                print("department_name 列添加成功!")
            else:
                print("department_name 列已存在.")
            
            if 'is_super_admin_created' not in file_columns:
                print("添加 is_super_admin_created 列到 files 表...")
                conn.execute(text("ALTER TABLE files ADD COLUMN is_super_admin_created BOOLEAN DEFAULT FALSE"))
                conn.commit()
                print("is_super_admin_created 列添加成功!")
            else:
                print("is_super_admin_created 列已存在.")
        
        # 3. 为现有文件夹和文件补充部门信息
        print("\n为现有数据补充部门信息...")
        
        # 处理文件夹
        folders = db.query(Folder).all()
        print(f"找到 {len(folders)} 个文件夹")
        folder_updated = 0
        
        for folder in folders:
            if not folder.department_name and folder.created_by:
                creator = db.query(User).filter(User.id == folder.created_by).first()
                if creator:
                    # 使用创建者的部门信息
                    folder.department_name = creator.root_department_name or creator.department_name
                    folder.is_super_admin_created = creator.is_super_admin
                    db.add(folder)
                    folder_updated += 1
                    print(f"  文件夹 '{folder.name}': 更新部门信息为 {folder.department_name} (超级管理员: {folder.is_super_admin_created})")
        
        if folder_updated > 0:
            db.commit()
            print(f"成功更新 {folder_updated} 个文件夹的部门信息!")
        
        # 处理文件
        files = db.query(File).all()
        print(f"\n找到 {len(files)} 个文件")
        file_updated = 0
        
        for file_item in files:
            if not file_item.department_name:
                # 优先检查是否在文件夹中
                if file_item.folder_id:
                    folder = db.query(Folder).filter(Folder.id == file_item.folder_id).first()
                    if folder:
                        file_item.department_name = folder.department_name
                        file_item.is_super_admin_created = folder.is_super_admin_created
                        db.add(file_item)
                        file_updated += 1
                        print(f"  文件 '{file_item.original_name}': 从文件夹继承部门信息")
                elif file_item.uploaded_by:
                    creator = db.query(User).filter(User.id == file_item.uploaded_by).first()
                    if creator:
                        file_item.department_name = creator.root_department_name or creator.department_name
                        file_item.is_super_admin_created = creator.is_super_admin
                        db.add(file_item)
                        file_updated += 1
                        print(f"  文件 '{file_item.original_name}': 更新部门信息为 {file_item.department_name}")
        
        if file_updated > 0:
            db.commit()
            print(f"成功更新 {file_updated} 个文件的部门信息!")
        
        print("\n迁移完成!")
        
        # 显示摘要
        print("\n数据信息摘要:")
        print("-" * 100)
        
        # 文件夹统计
        print("\n文件夹统计:")
        folders = db.query(Folder).filter(Folder.is_deleted == False).all()
        dept_counts = {}
        super_admin_count = 0
        for f in folders:
            if f.is_super_admin_created:
                super_admin_count += 1
            else:
                dept = f.department_name or "未知"
                dept_counts[dept] = dept_counts.get(dept, 0) + 1
        
        print(f"超级管理员创建的文件夹: {super_admin_count}")
        for dept, cnt in dept_counts.items():
            print(f"{dept}: {cnt}")
        
        # 文件统计
        print("\n文件统计:")
        files = db.query(File).filter(File.is_deleted == False).all()
        file_dept_counts = {}
        file_super_admin_count = 0
        for f in files:
            if f.is_super_admin_created:
                file_super_admin_count += 1
            else:
                dept = f.department_name or "未知"
                file_dept_counts[dept] = file_dept_counts.get(dept, 0) + 1
        
        print(f"超级管理员创建的文件: {file_super_admin_count}")
        for dept, cnt in file_dept_counts.items():
            print(f"{dept}: {cnt}")
            
    except Exception as e:
        print(f"迁移过程中出错: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    migrate()
