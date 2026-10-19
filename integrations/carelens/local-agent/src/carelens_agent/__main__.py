"""CLI: python -m carelens_agent {run|once|check} [--env-file PATH] [--verbose]

run    long-running agent (stop with Ctrl+C or by creating <run_dir>/stop.request)
once   process the jobs queued right now, then exit
check  readiness of backend, agent credential, Vision API and Ollama model (no jobs claimed)
Exit codes: 0 ok, 1 a check failed, 2 configuration error.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .cloud import CloudClient, CloudError, TransientError
from .config import AgentConfig, ConfigError, load_env_file
from .logs import setup_logging
from .runner import Agent
from .summarizer import OllamaClient, OllamaUnavailable
from .vision import VisionClient, VisionProtocolError, VisionRejected, VisionUnavailable


def check(config: AgentConfig) -> int:
    ok = True
    cloud = CloudClient(config.backend_url, config.agent_token, config.backend_timeout_s)
    try:
        status, body = cloud.request("GET", "/ready")
        print(f"backend /ready: {body.get('status') if isinstance(body, dict) else status}")
    except (CloudError, TransientError) as exc:
        ok = False
        print(f"backend /ready: FAILED ({exc})")
    try:
        cloud.heartbeat({"check": True})
        print("agent credential: accepted")
    except CloudError as exc:
        ok = False
        print(f"agent credential: REJECTED ({exc.status} {exc.code})")
    except TransientError as exc:
        ok = False
        print(f"agent credential: backend unreachable ({exc})")
    try:
        h = VisionClient(config.vision_url, 5).health()
        print(f"vision {config.vision_url}: ok (fall_heads={h['fall_heads']}, drink={h['drink']})")
        if h["fall_heads"] == 0 or not h["drink"]:
            print("vision: WARNING one check is not loaded; jobs will record it as skipped")
    except (VisionUnavailable, VisionRejected, VisionProtocolError) as exc:
        ok = False
        print(f"vision {config.vision_url}: UNAVAILABLE ({exc})")
    try:
        digest = OllamaClient(config.ollama_url, config.summary_model, 10, config.ollama_keep_alive, config.ollama_num_ctx).model_digest()
        print(f"ollama model {config.summary_model}: installed (digest {digest[:12]})")
    except OllamaUnavailable as exc:
        ok = False
        print(f"ollama: UNAVAILABLE ({exc})")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="carelens_agent", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["run", "once", "check"])
    parser.add_argument("--env-file", type=Path, help="KEY=VALUE file with CARELENS_* settings (values are never printed)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    if args.env_file:
        if not args.env_file.is_file():
            print(f"env file not found: {args.env_file}", file=sys.stderr)
            return 2
        load_env_file(args.env_file)
    try:
        config = AgentConfig.from_env()
    except ConfigError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2
    setup_logging(config.run_dir if args.command == "run" else None, args.verbose)
    if args.command == "check":
        return check(config)
    agent = Agent(config)
    if args.command == "once":
        print(agent.run_once())
        return 0
    config.run_dir.mkdir(parents=True, exist_ok=True)
    agent.run(stop_file=config.run_dir / "stop.request")
    return 0


if __name__ == "__main__":
    sys.exit(main())
