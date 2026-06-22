from app.database import SessionLocal
from app.models.folder import Folder
from app.models.file import File
from app.models.user import User

def _get_user_specific_department(user):
    """获取用户的具体部门（优先匹配 跨界营销中心、创意部 等关键部门）"""
    if user.full_department_path:
        if "跨界营销中心" in user.full_department_path:
            return "跨界营销中心"
        if "创意部" in user.full_department_path or "海口创意设计中心" in user.full_department_path:
            return "创意部"
    return user.department_name

def update_existing_data():
    print("开始更新现有数据的部门信息...")
    db = SessionLocal()
    try:
        # 更新文件夹
        folders = db.query(Folder).filter(Folder.is_deleted == False).all()
        updated_folders = 0
        print(f"找到 {len(folders)} 个文件夹")
        
        for folder in folders:
            if folder.created_by:
                creator = db.query(User).filter(User.id == folder.created_by).first()
                if creator:
                    if creator.is_super_admin:
                        # 超级管理员创建的文件夹保持为"超级管理员"
                        new_dept = "超级管理员"
                    else:
                        new_dept = _get_user_specific_department(creator)
                    
                    if folder.department_name != new_dept:
                        folder.department_name = new_dept
                        db.add(folder)
                        updated_folders += 1
        
        if updated_folders > 0:
            db.commit()
            print(f"成功更新了 {updated_folders} 个文件夹")
        
        # 更新文件
        files = db.query(File).filter(File.is_deleted == False).all()
        updated_files = 0
        print(f"\n找到 {len(files)} 个文件")
        
        for file_item in files:
            if file_item.folder_id:
                folder = db.query(Folder).filter(Folder.id == file_item.folder_id).first()
                if folder:
                    if file_item.department_name != folder.department_name or file_item.is_super_admin_created != folder.is_super_admin_created:
                        file_item.department_name = folder.department_name
                        file_item.is_super_admin_created = folder.is_super_admin_created
                        db.add(file_item)
                        updated_files += 1
            elif file_item.uploaded_by:
                creator = db.query(User).filter(User.id == file_item.uploaded_by).first()
                if creator:
                    if creator.is_super_admin:
                        new_dept = "超级管理员"
                    else:
                        new_dept = _get_user_specific_department(creator)
                    
                    if file_item.department_name != new_dept:
                        file_item.department_name = new_dept
                        file_item.is_super_admin_created = creator.is_super_admin
                        db.add(file_item)
                        updated_files += 1
        
        if updated_files > 0:
            db.commit()
            print(f"成功更新了 {updated_files} 个文件")
        
        # 显示更新后的信息
        print("\n\n更新后的权限总结：")
        print("=" * 100)
        
        print("\n文件夹权限分布：")
        cross_folders = db.query(Folder).filter(Folder.department_name == "跨界营销中心", Folder.is_deleted == False).count()
        creative_folders = db.query(Folder).filter(Folder.department_name == "创意部", Folder.is_deleted == False).count()
        super_admin_folders = db.query(Folder).filter(Folder.department_name == "超级管理员", Folder.is_deleted == False).count()
        
        print(f"  跨界营销中心: {cross_folders} 个")
        print(f"  创意部: {creative_folders} 个")
        print(f"  超级管理员创建的: {super_admin_folders} 个")
        
        print("\n文件权限分布：")
        cross_files = db.query(File).filter(File.department_name == "跨界营销中心", File.is_deleted == False).count()
        creative_files = db.query(File).filter(File.department_name == "创意部", File.is_deleted == False).count()
        super_admin_files = db.query(File).filter(File.department_name == "超级管理员", File.is_deleted == False).count()
        
        print(f"  跨界营销中心: {cross_files} 个")
        print(f"  创意部: {creative_files} 个")
        print(f"  超级管理员创建的: {super_admin_files} 个")
        
        print("\n用户部门映射：")
        users = db.query(User).all()
        for u in users:
            if u.is_super_admin:
                print(f"  {u.name} -> 超级管理员")
            else:
                dept = _get_user_specific_department(u)
                print(f"  {u.name} -> {dept}")
        
    except Exception as e:
        print(f"更新过程中出错: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    update_existing_data()
