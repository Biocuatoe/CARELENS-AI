"""Logging that cannot carry secrets or media.

Log lines contain ids, codes, counts and durations only. A filter masks anything shaped like a CareLens
token or lease and truncates long messages, as a second line of defence against accidental leaks.
"""
from __future__ import annotations

import logging
import logging.handlers
import re
import sys
from pathlib import Path

_SECRET = re.compile(r"\b(cl[adc]_|lease_)[A-Za-z0-9_\-]{8,}")
_MAX = 600


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        message = _SECRET.sub(lambda m: f"{m.group(1)}***", message)
        if len(message) > _MAX:
            message = message[:_MAX] + "…"
        record.msg, record.args = message, None
        return True


def setup_logging(run_dir: Path | None, verbose: bool = False) -> logging.Logger:
    logger = logging.getLogger("carelens_agent")
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(threadName)s %(message)s")
    stream = logging.StreamHandler(sys.stderr)
    stream.setFormatter(fmt)
    stream.addFilter(RedactingFilter())
    logger.addHandler(stream)
    if run_dir is not None:
        run_dir.mkdir(parents=True, exist_ok=True)
        file = logging.handlers.RotatingFileHandler(run_dir / "agent.log", maxBytes=1_000_000, backupCount=5, encoding="utf-8")
        file.setFormatter(fmt)
        file.addFilter(RedactingFilter())
        logger.addHandler(file)
    logger.propagate = False
    return logger
