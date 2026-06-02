import sqlite3

conn = sqlite3.connect('./data/app.db')
cursor = conn.cursor()

try:
    cursor.execute("ALTER TABLE users ADD COLUMN username VARCHAR;")
    print("Added username column")
except Exception as e:
    print(e)

try:
    cursor.execute("ALTER TABLE users ADD COLUMN hashed_password VARCHAR;")
    print("Added hashed_password column")
except Exception as e:
    print(e)

conn.commit()
conn.close()
