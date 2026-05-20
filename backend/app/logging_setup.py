import logging
import re

_REDACT_HEADERS = {"authorization", "cookie", "set-cookie", "x-supabase-auth"}
_TOKEN_PATTERNS = [
    re.compile(r"(access_token|refresh_token|token)\s*[:=]\s*['\"]?[A-Za-z0-9._\-]+", re.I),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]+", re.I),
]


class TokenRedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        for pat in _TOKEN_PATTERNS:
            msg = pat.sub(lambda m: m.group(0).split(" ")[0] + " <redacted>" if " " in m.group(0) else m.group(0).split(":")[0] + "=<redacted>", msg)
        record.msg = msg
        record.args = ()
        return True


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {k: ("<redacted>" if k.lower() in _REDACT_HEADERS else v) for k, v in headers.items()}


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    handler.addFilter(TokenRedactingFilter())
    root.handlers = [handler]
