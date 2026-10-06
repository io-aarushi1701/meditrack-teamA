"""MySQL connection setup for MediTrack."""
import os
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

HOST = os.getenv("MYSQL_HOST", "127.0.0.1")
PORT = os.getenv("MYSQL_PORT", "3306")
USER = os.getenv("MYSQL_USER", "root")
PASSWORD = os.getenv("MYSQL_PASSWORD", "")
DB = os.getenv("MYSQL_DB", "meditrack")

# quote the credentials so characters like @ : / in a password do not break the URL
SERVER_URL = "mysql+pymysql://{}:{}@{}:{}".format(quote_plus(USER), quote_plus(PASSWORD), HOST, PORT)
# DATABASE_URL overrides the MySQL settings (e.g. sqlite:///meditrack.db for a quick local run)
DATABASE_URL = os.getenv("DATABASE_URL") or "{}/{}?charset=utf8mb4".format(SERVER_URL, DB)
IS_MYSQL = DATABASE_URL.startswith("mysql")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, pool_pre_ping=True, echo=False, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def create_database_if_missing():
    """CREATE DATABASE meditrack — run before the engine touches any table."""
    if not IS_MYSQL:
        return
    tmp = create_engine(SERVER_URL, echo=False)
    with tmp.connect() as conn:
        conn.execute(text("CREATE DATABASE IF NOT EXISTS `{}`".format(DB)))
        conn.commit()
    tmp.dispose()


def add_missing_columns():
    """create_all() never alters existing tables, so add columns introduced after the first run."""
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in present:
                    continue
                ddl_type = column.type.compile(dialect=engine.dialect)
                conn.execute(text("ALTER TABLE {} ADD COLUMN {} {}".format(table.name, column.name, ddl_type)))


def init_db():
    create_database_if_missing()
    Base.metadata.create_all(bind=engine)
    add_missing_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
