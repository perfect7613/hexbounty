"""`hexbounty-tool` -- the bounded compute CLI handed to the Codex session.

This is the only compute surface the agent gets. It takes no prompt, no path,
no shell command and no Modal argument: every call is a job id plus a value from
a closed set, checked against an operator-approved manifest **before** anything
reaches Modal.

    hexbounty-tool analyze  --job <id>
    hexbounty-tool query    --job <id> --kind functions|xrefs|decompile --target <value>
    hexbounty-tool build    --job <id>
    hexbounty-tool compare  --job <id>
    hexbounty-tool evidence --job <id>

Output is one JSON object on stdout. Refusals are JSON too, with `ok: false`, so
the agent can reason about them instead of parsing a traceback.

Credential boundary: the Modal token stays on this machine, read by the modal
client from the operator's own profile. It is never passed to the agent, printed,
or written into a workspace. Nothing in the other direction either -- no Codex
auth, GitHub auth or wallet key is ever sent to Modal.

Manifests are operator-created under ``HEXBOUNTY_MANIFEST_DIR`` (defaulting to
``orchestration/manifests``). The agent cannot create or edit one; if a manifest
is missing or unapproved, every operation refuses.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

APP_NAME = "hexbounty-compute"
QUERY_KINDS = ("functions", "xrefs", "decompile")
MAX_TARGET = 128
JOB_ID_MAX = 64
ALLOWED_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789-")

MANIFEST_DIR = Path(
    os.environ.get(
        "HEXBOUNTY_MANIFEST_DIR",
        str(Path(__file__).resolve().parent.parent / "orchestration" / "manifests"),
    )
)


def emit(payload: dict) -> int:
    json.dump(payload, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if payload.get("ok") else 1


def refuse(operation: str, job: str, reason: str) -> int:
    return emit({"ok": False, "operation": operation, "job": job, "error": reason})


def valid_job_id(job_id: str) -> str | None:
    if not 1 <= len(job_id) <= JOB_ID_MAX:
        return None
    if job_id[0] not in ALLOWED_CHARS or job_id[0] == "-":
        return None
    if any(c not in ALLOWED_CHARS for c in job_id):
        return None
    return job_id


def load_manifest(job_id: str) -> dict:
    """The local half of the check. Modal re-checks its own copy independently."""
    path = MANIFEST_DIR / f"{job_id}.json"
    if not path.is_file():
        raise PermissionError(
            f"job {job_id!r} has no operator-approved manifest in {MANIFEST_DIR}"
        )
    try:
        manifest = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise PermissionError(f"manifest for {job_id!r} is not valid JSON: {exc}") from None
    if not manifest.get("approved"):
        raise PermissionError(f"manifest for {job_id!r} is not marked approved")
    if manifest.get("job") != job_id:
        raise PermissionError("manifest job id does not match the requested job")
    return manifest


def check_operation(manifest: dict, operation: str) -> None:
    ops = manifest.get("operations")
    if not isinstance(ops, list) or operation not in ops:
        raise PermissionError(f"operation {operation!r} is not approved for this job")


def call(function: str, *args):
    """Look up the deployed function. Import is local so --help needs no modal."""
    try:
        import modal
    except ImportError:
        raise RuntimeError(
            "the modal client is not installed; `uv pip install modal` on the "
            "operator machine"
        ) from None
    try:
        fn = modal.Function.from_name(APP_NAME, function)
    except Exception as exc:  # modal raises several distinct lookup errors
        raise RuntimeError(
            f"{APP_NAME}/{function} is not deployed ({exc}); run "
            "`modal deploy modal/hexbounty_modal.py`"
        ) from None
    return fn.remote(*args)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="hexbounty-tool", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="operation", required=True)
    for name in ("analyze", "build", "compare", "evidence"):
        p = sub.add_parser(name)
        p.add_argument("--job", required=True)
    q = sub.add_parser("query")
    q.add_argument("--job", required=True)
    q.add_argument("--kind", required=True, choices=QUERY_KINDS)
    q.add_argument("--target", default="")
    args = ap.parse_args(argv)

    operation = args.operation
    job_raw = args.job
    if valid_job_id(job_raw) is None:
        return refuse(operation, job_raw,
                      "job id must be 1-64 characters of [a-z0-9-] starting alphanumeric")
    job = job_raw

    try:
        manifest = load_manifest(job)
        check_operation(manifest, operation)
    except PermissionError as exc:
        return refuse(operation, job, str(exc))

    if operation == "query":
        if len(args.target) > MAX_TARGET:
            return refuse(operation, job, f"target exceeds {MAX_TARGET} characters")
        if args.kind in ("xrefs", "decompile") and not args.target:
            return refuse(operation, job, f"{args.kind} requires --target")
        # Addresses are canonical `SPACE:hex`; anything else is refused here so
        # it never reaches the analysis backend.
        if args.target and not all(
            c.isalnum() or c in ":_." for c in args.target
        ):
            return refuse(operation, job,
                          "target must be a canonical address or symbol "
                          "(alphanumerics, ':', '_', '.')")

    try:
        if operation == "query":
            result = call("query", job, args.kind, args.target)
        else:
            result = call(operation, job)
    except RuntimeError as exc:
        return refuse(operation, job, str(exc))

    if not isinstance(result, dict):
        return refuse(operation, job, "compute function returned an unexpected shape")
    return emit(result)


if __name__ == "__main__":
    sys.exit(main())
