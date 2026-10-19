"""Create an admin bearer token and the SHA-256 digest the Worker stores.

  python backend/care-monitoring/scripts/make_admin_token.py

Writes the token to a file you choose (default: carelens-admin-token.txt in your home folder, outside the
repository) and prints only the digest. Put the digest in ADMIN_TOKEN_SHA256 (`wrangler secret put ADMIN_TOKEN_SHA256` for
production, worker/.dev.vars for local), keep the token in a password manager, then delete the file.
"""
from __future__ import annotations

import argparse
import hashlib
import secrets
import sys
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=Path.home() / "carelens-admin-token.txt")
    a = ap.parse_args()
    if a.out.exists():
        print(f"{a.out} already exists; refusing to overwrite", file=sys.stderr)
        return 1
    token = "cl-admin-" + secrets.token_urlsafe(32)
    a.out.write_text(token + "\n", encoding="utf-8")
    print(f"token written to {a.out} (store it safely, then delete the file)")
    print(f"ADMIN_TOKEN_SHA256={hashlib.sha256(token.encode()).hexdigest()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
