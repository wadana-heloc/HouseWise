"""Password complexity policy shared by every endpoint that accepts a password.

Login is intentionally exempt: existing accounts pre-date the policy, and
rejecting their stored passwords at login would lock users out.
"""
import string

MIN_LENGTH = 8
MAX_LENGTH = 200
SPECIAL_CHARS = set(string.punctuation)


def validate_password(value: str) -> str:
    missing: list[str] = []
    if len(value) < MIN_LENGTH:
        missing.append(f"at least {MIN_LENGTH} characters")
    if not any(c.islower() for c in value):
        missing.append("a lowercase letter")
    if not any(c.isupper() for c in value):
        missing.append("an uppercase letter")
    if not any(c.isdigit() for c in value):
        missing.append("a digit")
    if not any(c in SPECIAL_CHARS for c in value):
        missing.append("a special character")
    if missing:
        raise ValueError("Password must contain " + ", ".join(missing) + ".")
    return value
