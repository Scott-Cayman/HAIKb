from sqlalchemy.orm import Session
from app.database import SessionLocal, engine, Base
from app.models.user import User
from app.routers.auth import get_password_hash

def init_admin():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        admin_user = db.query(User).filter(User.username == "admin").first()
        if not admin_user:
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
            print("Admin user created successfully: admin / Himice2024")
        else:
            # Update password just in case
            admin_user.hashed_password = get_password_hash("Himice2024")
            db.commit()
            print("Admin user already exists, updated password to Himice2024")
    finally:
        db.close()

if __name__ == "__main__":
    init_admin()
