"""Agent configuration from environment variables (optionally loaded from an env file by the launcher).

Values are validated here and never printed. The Vision API and Ollama must be loopback URLs: the agent
must never send frames or prompts off this PC, and neither service may be exposed to the Internet.
"""
from __future__ import annotations

import ipaddress
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

DEFAULT_PACKAGE_VERSION = "carelens_models_v1_20261018"
DEFAULT_SUMMARY_MODEL = "qwen3:4b-instruct-2507-q4_K_M"


class ConfigError(ValueError):
    pass


def _is_loopback_url(url: str) -> bool:
    host = urlparse(url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _num(env: Mapping[str, str], name: str, default: float, low: float, high: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a number") from exc
    if not low <= value <= high:
        raise ConfigError(f"{name} must be in [{low}, {high}]")
    return value


@dataclass(frozen=True)
class AgentConfig:
    backend_url: str
    agent_token: str
    vision_url: str
    ollama_url: str
    summary_model: str
    package_version: str
    lease_seconds: int
    poll_interval_s: float
    report_poll_interval_s: float
    backend_timeout_s: float
    vision_timeout_s: float
    ollama_timeout_s: float
    ollama_keep_alive: str
    ollama_num_ctx: int
    run_dir: Path

    def __repr__(self) -> str:  # never leak the token through logs or tracebacks
        return f"AgentConfig(backend_url={self.backend_url!r}, vision_url={self.vision_url!r}, ollama_url={self.ollama_url!r}, model={self.summary_model!r})"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> AgentConfig:
        env = os.environ if env is None else env
        backend = env.get("CARELENS_BACKEND_URL", "").strip().rstrip("/")
        token = env.get("CARELENS_AGENT_TOKEN", "").strip()
        if not backend:
            raise ConfigError("CARELENS_BACKEND_URL is required")
        scheme = urlparse(backend).scheme
        if scheme not in ("http", "https") or (scheme == "http" and not _is_loopback_url(backend)):
            raise ConfigError("CARELENS_BACKEND_URL must be https:// (http:// only for a local development backend)")
        if not token.startswith("cla_"):
            raise ConfigError("CARELENS_AGENT_TOKEN is missing or is not an agent token")
        vision = env.get("CARELENS_VISION_URL", "http://127.0.0.1:8080").strip().rstrip("/")
        ollama = env.get("CARELENS_OLLAMA_URL", "http://127.0.0.1:11434").strip().rstrip("/")
        for name, url in (("CARELENS_VISION_URL", vision), ("CARELENS_OLLAMA_URL", ollama)):
            if not _is_loopback_url(url):
                raise ConfigError(f"{name} must point to this PC (loopback); frames and prompts never leave it")
        return cls(
            backend_url=backend,
            agent_token=token,
            vision_url=vision,
            ollama_url=ollama,
            summary_model=env.get("CARELENS_SUMMARY_MODEL", DEFAULT_SUMMARY_MODEL).strip() or DEFAULT_SUMMARY_MODEL,
            package_version=env.get("CARELENS_PACKAGE_VERSION", DEFAULT_PACKAGE_VERSION).strip() or DEFAULT_PACKAGE_VERSION,
            lease_seconds=int(_num(env, "CARELENS_LEASE_SECONDS", 120, 30, 900)),
            poll_interval_s=_num(env, "CARELENS_POLL_INTERVAL_S", 30, 2, 600),
            report_poll_interval_s=_num(env, "CARELENS_REPORT_POLL_INTERVAL_S", 300, 10, 3600),
            backend_timeout_s=_num(env, "CARELENS_BACKEND_TIMEOUT_S", 20, 2, 120),
            vision_timeout_s=_num(env, "CARELENS_VISION_TIMEOUT_S", 30, 2, 300),
            ollama_timeout_s=_num(env, "CARELENS_OLLAMA_TIMEOUT_S", 300, 10, 1800),
            ollama_keep_alive=env.get("CARELENS_OLLAMA_KEEP_ALIVE", "0").strip() or "0",
            ollama_num_ctx=int(_num(env, "CARELENS_OLLAMA_NUM_CTX", 6144, 2048, 32768)),
            run_dir=Path(env.get("CARELENS_AGENT_RUN_DIR", "").strip() or Path(__file__).resolve().parents[2] / "run"),
        )


def load_env_file(path: Path, target: dict[str, str] | None = None) -> int:
    """KEY=VALUE lines into `target` (default os.environ). Returns the count; never echoes values."""
    target = os.environ if target is None else target  # type: ignore[assignment]
    count = 0
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        target[key.strip()] = value.strip()
        count += 1
    return count
