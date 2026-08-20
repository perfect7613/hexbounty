"""Fixed, content-addressed Ghidra analysis invoked by Codex inside Modal.

This is intentionally not a general CLI: it accepts no user path, job, command,
or prompt. It can analyze only the pre-provisioned reconstructed Breakout ROM
whose size and digest are hard-coded below.
"""

from __future__ import annotations

import hashlib
import json
import os
import socket
import subprocess
from pathlib import Path


JOB_ID = "codex-modal-ghidra-smoke"
WORKSPACE = Path("/workspaces") / JOB_ID
ROM = WORKSPACE / "rom/breakout-reconstructed.gb"
MANIFEST = WORKSPACE / "manifest.json"
RESULT = WORKSPACE / "codex_analysis.json"
STATIC_PROJECT = "/opt/pipeline/static"
EXPECTED_BYTES = 32768
EXPECTED_SHA256 = "770677bcbd7193ec458a23d0313c647d19c59527b2ce1184465d7e0ec7b1e155"
FIXTURE = "breakout-reconstructed-v1"


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(1)


def main() -> None:
    nonce = os.environ.get("HEXBOUNTY_RUN_NONCE", "")
    if len(nonce) != 32 or any(c not in "0123456789abcdef" for c in nonce):
        fail("missing bounded-run nonce")
    if Path.cwd().resolve() != WORKSPACE.resolve():
        fail("runner must execute from its approved workspace")
    if not MANIFEST.is_file() or not ROM.is_file():
        fail("approved manifest or reconstructed fixture is missing")

    manifest = json.loads(MANIFEST.read_text())
    if not manifest.get("approved"):
        fail("manifest is not operator-approved")
    if "analyze" not in manifest.get("operations", []):
        fail("manifest does not approve analysis")
    if manifest.get("authorizedFixture") != FIXTURE:
        fail("manifest does not name the allowlisted fixture")

    payload = ROM.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if len(payload) != EXPECTED_BYTES or digest != EXPECTED_SHA256:
        fail("fixture does not match the content-addressed allowlist")

    workdir = WORKSPACE / "codex_ghidra_runs" / nonce
    workdir.mkdir(parents=True, exist_ok=False)
    operations = [
        {"id": 1, "op": "static.program_info", "params": {}},
        {"id": 2, "op": "static.memory_map", "params": {}},
        {"id": 3, "op": "static.entry_points", "params": {}},
        {
            "id": 4,
            "op": "static.list_functions",
            "params": {"limit": 100, "cursor": None},
        },
    ]
    runtime_env = {
        **os.environ,
        # Codex invokes this runner through `bash -lc`, whose profile resets
        # the image PATH. Reassert the pinned Temurin JDK used by the runtime.
        "JAVA_HOME": "/opt/java",
        "PATH": "/opt/java/bin:/usr/local/bin:/usr/bin:/bin",
    }
    process = subprocess.run(
        [
            "uv",
            "run",
            "--no-sync",
            "--project",
            STATIC_PROJECT,
            "staticre",
            "serve",
            str(ROM),
            "--workdir",
            str(workdir),
        ],
        input="".join(json.dumps(op) + "\n" for op in operations),
        capture_output=True,
        text=True,
        timeout=18 * 60,
        env=runtime_env,
    )
    replies = []
    for line in (process.stdout or "").splitlines():
        if not line.lstrip().startswith("{"):
            continue
        try:
            replies.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if process.returncode != 0 or len(replies) != len(operations):
        stderr_tail = (process.stderr or "").strip()[-2000:]
        fail(
            f"staticre returned status {process.returncode} and "
            f"{len(replies)}/{len(operations)} replies: {stderr_tail}"
        )
    failures = [reply for reply in replies if not reply.get("ok")]
    if failures:
        fail(f"staticre request failed: {failures[0].get('error', 'unknown')}")

    program = replies[0].get("result", {})
    entries = replies[2].get("result", {})
    functions = replies[3].get("result", {})
    function_rows = functions.get("functions", functions)
    result = {
        "ok": True,
        "nonce": nonce,
        "containerId": socket.gethostname(),
        "runnerPid": os.getpid(),
        "fixture": FIXTURE,
        "path": "rom/breakout-reconstructed.gb",
        "bytes": len(payload),
        "sha256": digest,
        "staticreExit": process.returncode,
        "loader": program.get("loader"),
        "processor": program.get("processor"),
        "programName": program.get("name"),
        "entryPoints": entries,
        "functionCount": len(function_rows) if isinstance(function_rows, list) else None,
        "ghidraProject": str(workdir.relative_to(WORKSPACE)),
        "ghidraBoyPresent": Path(
            "/opt/ghidra/Ghidra/Extensions/GhidraBoy"
        ).is_dir(),
        "java": subprocess.check_output(
            ["/opt/java/bin/java", "-version"],
            stderr=subprocess.STDOUT,
            text=True,
            timeout=30,
        ).splitlines()[0],
    }
    RESULT.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        fail(str(exc))
