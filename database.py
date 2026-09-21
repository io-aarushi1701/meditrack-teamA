"""MySQL connection setup for MediTrack."""
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
PORT = os.getenv("MYSQL_PORT", "3306")
USER = os.getenv("MYSQL_USER", "root")
PASSWORD = os.getenv("MYSQL_PASSWORD", "")
DB = os.getenv("MYSQL_DB", "meditrack")

SERVER_URL = "mysql+pymysql://{}:{}@{}:{}".format(USER, PASSWORD, HOST, PORT)
DATABASE_URL = "{}/{}".format(SERVER_URL, DB)

engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def create_database_if_missing():
    """CREATE DATABASE meditrack — run before the engine touches any table."""
    tmp = create_engine(SERVER_URL, echo=False)
    with tmp.connect() as conn:
        conn.execute(text("CREATE DATABASE IF NOT EXISTS `{}`".format(DB)))
        conn.commit()
    tmp.dispose()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
