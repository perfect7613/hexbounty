"""Command-line interface for HexBounty evidence hashing."""

from __future__ import annotations

import argparse
import sys
from typing import Sequence

from .canonical import EvidenceValidationError, hash_evidence, load_json_strict


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="hexbounty-evidence")
    subcommands = parser.add_subparsers(dest="command", required=True)
    hash_parser = subcommands.add_parser("hash", help="canonicalize and hash evidence JSON")
    hash_parser.add_argument("file", help="path to an evidence JSON document")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = hash_evidence(load_json_strict(args.file))
    except EvidenceValidationError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(result.canonical)
    print(result.hash)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
