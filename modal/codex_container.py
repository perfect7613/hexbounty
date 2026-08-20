"""Authenticated Codex -> Ghidra proof, entirely inside one Modal function.

This is deliberately separate from ``codex_auth.py``. The latter performs the
one-time device flow; this module mounts that same private auth Volume together
with the private analysis workspace, layers Codex onto the Ghidra runtime, and
asks Codex to run one fixed, content-addressed analysis command.

No auth file is copied, read, or logged.

Run the bounded proof:

    modal run modal/codex_container.py
"""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path

import modal

from build_runtime import IMAGE, WORKSPACES


CODEX_VERSION = "0.147.0"
CODEX_HOME = "/root/.codex"
JOB_ID = "codex-modal-ghidra-smoke"
EXPECTED_SHA256 = (
    "770677bcbd7193ec458a23d0313c647d19c59527b2ce1184465d7e0ec7b1e155"
)
RESULT_NAME = "codex_analysis.json"
REMOTE_RUNNER = "/opt/hexbounty/authorized_analysis.py"

# Add Codex to the already-proven Ghidra/GhidraBoy runtime. Credentials remain
# exclusively in the Volume mounted below; they are never part of this image.
CODEX_IMAGE = (
    IMAGE.apt_install("nodejs", "npm")
    .run_commands(
        "set -eux; "
        f"npm install --global @openai/codex@{CODEX_VERSION}; "
        f"codex --version | grep -F '{CODEX_VERSION}'; "
        # `codex --version` may initialize a local cache directory. Remove
        # only that build-time directory so Modal can mount the authenticated
        # private Volume at the same path when the function starts.
        "find /root/.codex -mindepth 1 -delete 2>/dev/null || true; "
        "rmdir /root/.codex 2>/dev/null || true"
    )
    .add_local_file(
        Path(__file__).with_name("authorized_analysis.py"),
        REMOTE_RUNNER,
        copy=True,
    )
    .add_local_file(
        Path(__file__).with_name("build_runtime.py"),
        "/root/build_runtime.py",
        copy=True,
    )
    .env({"HOME": "/root", "CODEX_HOME": CODEX_HOME, "NO_COLOR": "1"})
)

app = modal.App("hexbounty-codex-analysis")
codex_home = modal.Volume.from_name("hexbounty-codex-home", create_if_missing=False)
workspaces = modal.Volume.from_name("hexbounty-workspaces", create_if_missing=False)


def _login_status() -> str:
    """Return only Codex's non-secret, supported login-status message."""
    proc = subprocess.run(
        ["codex", "login", "status"], capture_output=True, text=True, timeout=60
    )
    status = ((proc.stdout or "") + (proc.stderr or "")).strip()
    if proc.returncode != 0:
        raise RuntimeError(f"Codex is not authenticated in Modal: {status[:500]}")
    return status[:500]


@app.function(
    image=CODEX_IMAGE,
    volumes={CODEX_HOME: codex_home, WORKSPACES: workspaces},
    cpu=2.0,
    memory=8192,
    timeout=25 * 60,
)
def codex_analyze() -> dict:
    """Have authenticated Codex invoke the one allowlisted Ghidra analysis."""
    codex_home.reload()
    workspaces.reload()
    status = _login_status()

    workspace = Path(WORKSPACES) / JOB_ID
    result_path = workspace / RESULT_NAME
    if not workspace.is_dir():
        raise RuntimeError(f"approved workspace is missing: {workspace}")
    if result_path.exists():
        # Avoid accepting stale output as proof of this Codex invocation.
        result_path.unlink()

    nonce = uuid.uuid4().hex
    # uv uses atomic cache operations that a Modal Volume intentionally does
    # not implement. Runtime caches are ephemeral and belong on the container's
    # local filesystem; only analysis evidence/project data is persisted.
    runner_home = Path("/tmp") / f"hexbounty-runner-{nonce}"
    runner_home.mkdir(parents=True, exist_ok=True)
    command = f"python3 {REMOTE_RUNNER}"
    prompt = (
        "Run the following authorized command exactly once and wait for it to "
        f"finish: `{command}`. Do not inspect credentials, do not search for "
        "other binaries, and do not run any other shell command. When it "
        "finishes, report whether its JSON says ok=true and include its sha256, "
        "loader, processor, functionCount, and containerId."
    )
    env = {
        **os.environ,
        # Codex reads auth from the explicit, read-only CODEX_HOME. Runtime
        # caches for uv/Java/Ghidra belong inside the sandboxed workspace.
        "HOME": str(runner_home),
        "CODEX_HOME": CODEX_HOME,
        "NO_COLOR": "1",
        "HEXBOUNTY_RUN_NONCE": nonce,
        "UV_CACHE_DIR": str(runner_home / ".cache/uv"),
        "XDG_CACHE_HOME": str(runner_home / ".cache"),
        "XDG_CONFIG_HOME": str(runner_home / ".config"),
        "XDG_DATA_HOME": str(runner_home / ".local/share"),
    }
    proc = subprocess.run(
        [
            "codex",
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--ignore-user-config",
            "-c",
            "sandbox_workspace_write.network_access=true",
            "--sandbox",
            "workspace-write",
            "--add-dir",
            # `/opt/ghidra` is a symlink; sandbox writable roots are resolved
            # literally, so grant the pinned installation's real support path.
            "/opt/ghidra_11.4.2_PUBLIC/support",
            "--add-dir",
            # GhidraBoy compiles its SM83 Sleigh language on first import.
            "/opt/ghidra_11.4.2_PUBLIC/Ghidra/Extensions/GhidraBoy",
            "--json",
            "-C",
            str(workspace),
            prompt,
        ],
        capture_output=True,
        text=True,
        timeout=22 * 60,
        env=env,
    )

    events: list[dict] = []
    for line in (proc.stdout or "").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        # Retain only event metadata and tool-command evidence. Never persist
        # arbitrary environment/config data even though Codex JSONL does not
        # normally contain credentials.
        item = event.get("item") if isinstance(event.get("item"), dict) else {}
        events.append(
            {
                "type": event.get("type"),
                "itemType": item.get("type"),
                "command": item.get("command"),
                "exitCode": item.get("exit_code"),
                # The prompt permits only the fixed runner. Its bounded JSON
                # output is safe diagnostic evidence; environment and config
                # values are never included.
                "output": (
                    str(item.get("aggregated_output", ""))[-1500:]
                    if REMOTE_RUNNER in str(item.get("command", ""))
                    else ""
                ),
            }
        )
    completed_commands = [
        event
        for event in events
        if event.get("type") == "item.completed"
        and event.get("itemType") == "command_execution"
    ]
    expected_shell_command = f"/bin/bash -lc 'python3 {REMOTE_RUNNER}'"
    command_seen = (
        len(completed_commands) == 1
        and completed_commands[0].get("command") == expected_shell_command
        and completed_commands[0].get("exitCode") == 0
    )

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        raise RuntimeError(
            f"Codex exec failed with status {proc.returncode}: {stderr[-1000:]}"
        )
    if not command_seen:
        raise RuntimeError(
            "Codex must invoke exactly one authorized command: "
            + json.dumps(completed_commands)
        )
    if not result_path.is_file():
        raise RuntimeError(
            "authorized runner did not produce current analysis evidence: "
            + json.dumps(events[-6:])
        )

    result = json.loads(result_path.read_text())
    if result.get("nonce") != nonce:
        raise RuntimeError("analysis evidence nonce does not match this invocation")
    if result.get("sha256") != EXPECTED_SHA256:
        raise RuntimeError("analysis evidence digest is not the allowlisted fixture")
    if not result.get("ok"):
        raise RuntimeError(f"Ghidra analysis failed: {result.get('error', 'unknown')}")

    workspaces.commit()
    return {
        "ok": True,
        "topology": "authenticated Codex CLI -> fixed runner -> staticre/PyGhidra/GhidraBoy",
        "codexStatus": status,
        "codexVersion": subprocess.check_output(
            ["codex", "--version"], text=True, timeout=30
        ).strip(),
        "codexExit": proc.returncode,
        "authorizedCommandSeen": command_seen,
        "containerId": os.uname().nodename,
        "analysis": result,
        "eventSummary": events[-12:],
    }


@app.local_entrypoint()
def main() -> None:
    print(json.dumps(codex_analyze.remote(), indent=2))
