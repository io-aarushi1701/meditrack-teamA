"""Password hashing, JWT tokens and role checks."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

import models
from database import get_db

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me-in-production-0123456789")
JWT_ALGORITHM = "HS256"
TOKEN_HOURS = int(os.getenv("JWT_HOURS", "8"))
PBKDF2_ROUNDS = 200_000

bearer = HTTPBearer(auto_error=False)


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
    return "pbkdf2${}${}${}".format(PBKDF2_ROUNDS, salt, digest)


def verify_password(password, stored):
    try:
        _, rounds, salt, digest = stored.split("$")
    except ValueError:
        return False
    check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds)).hex()
    return hmac.compare_digest(check, digest)


def create_token(user):
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    db: Session = Depends(get_db),
):
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired, please sign in again")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")
    user = db.get(models.User, int(payload["sub"]))
    if not user:
        raise HTTPException(401, "User no longer exists")
    return user


def require(*roles):
    """Dependency factory: allow only the given roles."""
    def checker(user: models.User = Depends(current_user)):
        if user.role not in roles:
            raise HTTPException(403, "You do not have permission to do this")
        return user
    return checker
