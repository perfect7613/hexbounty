#!/usr/bin/env python3
"""Canonicalize a HexBounty evidence document and print its commitment hash.

Reference implementation of docs/evidence-format.md. The keccak256 value printed
here is what gets submitted on-chain as `evidenceHash`, and what the browser must
independently reproduce.

    python3 -m pip install rfc8785 'eth-hash[pycryptodome]'
    python3 tools/evidence_hash.py examples/licensed-demo/evidence/evidence.sample.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

try:
    import rfc8785
except ImportError:  # pragma: no cover - dependency guidance
    sys.exit("missing dependency: python3 -m pip install rfc8785")

try:
    from eth_hash.auto import keccak
except ImportError:  # pragma: no cover - dependency guidance
    sys.exit("missing dependency: python3 -m pip install 'eth-hash[pycryptodome]'")


def canonicalize(document: object) -> bytes:
    """Return the RFC 8785 canonical UTF-8 encoding, with no trailing newline."""
    return rfc8785.dumps(document)


def evidence_hash(document: object) -> str:
    return "0x" + keccak(canonicalize(document)).hex()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="path to an evidence.json document")
    parser.add_argument(
        "--print-canonical",
        action="store_true",
        help="write the canonical bytes to stdout instead of the summary",
    )
    args = parser.parse_args()

    document = json.loads(args.path.read_text(encoding="utf-8"))
    canonical = canonicalize(document)

    if args.print_canonical:
        sys.stdout.buffer.write(canonical)
        return 0

    print(f"canonical_bytes {len(canonical)}")
    print(f"sha256          0x{hashlib.sha256(canonical).hexdigest()}")
    print(f"keccak256       0x{keccak(canonical).hex()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
