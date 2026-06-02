from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import SessionLocal, engine, Base
from app.models.user import User
from app.routers.auth import get_password_hash

def migrate():
    print("Starting migration...")
    db = SessionLocal()
    try:
        # First check if is_super_admin column exists
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA table_info(users)"))
            columns = [row[1] for row in result.fetchall()]
            
            if 'is_super_admin' not in columns:
                print("Adding is_super_admin column...")
                conn.execute(text("ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN DEFAULT FALSE"))
                conn.commit()
                print("Column added successfully!")
            else:
                print("is_super_admin column already exists.")

        # Ensure admin user is super admin
        admin_user = db.query(User).filter(User.username == "admin").first()
        if admin_user and not admin_user.is_super_admin:
            print("Updating admin user to super admin...")
            admin_user.is_super_admin = True
            db.commit()
            print("Admin user updated!")
        elif admin_user:
            print("Admin user already is super admin.")
        else:
            print("Creating super admin user...")
            admin_user = User(
                username="admin",
                name="系统管理员",
                hashed_password=get_password_hash("Himice2024"),
                is_super_admin=True,
                is_admin=True,
                is_active=True
            )
            db.add(admin_user)
            db.commit()
            print("Super admin user created: admin / Himice2024")

        print("Migration completed!")
    except Exception as e:
        print(f"Error during migration: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    migrate()
