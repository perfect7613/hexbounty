"""Bounded HexBounty compute functions on Modal.

Five operations, each a thin wrapper over an implementation that already exists
upstream. No analysis logic is written here:

    analyze   -> pipeline/static  (staticre: open the ROM, run Ghidra analysis)
    query     -> pipeline/static  (list_functions / xrefs / decompile)
    build     -> pipeline/harness/build_rom.sh (GBDK)
    compare   -> pipeline/agent/compareboy.py  (SameBoy differential)
    evidence  -> collect what the run already produced

Every call is bounded the same way:

- the job id must appear in an operator-approved manifest on the Volume;
- every path is resolved and required to stay inside that job's workspace;
- the operation and its arguments come from a closed set, never a free prompt;
- output is structured JSON.

Nothing here accepts a prompt, a shell command, or an arbitrary path from an
untrusted source. The Codex session calls `hexbounty-tool`, which calls these
functions with a validated job id -- it never gets Modal credentials.

Deploy:  modal deploy modal/hexbounty_modal.py
"""

from __future__ import annotations

import json
import hashlib
import os
import shlex
import subprocess
import time
from pathlib import Path

import modal

from build_runtime import (  # noqa: F401  (shared image + envelope)
    CPU,
    IDLE_TIMEOUT,
    IMAGE,
    MEMORY,
    REMOTE_PIPELINE,
    TIMEOUT,
    UPSTREAM,
    WORKSPACES,
)

# Modal automatically mounts the entry module, but imported sibling modules are
# not guaranteed to follow it. Bake this small definition module into the image
# so remote hydration is self-contained (it contains no credentials or ROMs).
IMAGE = IMAGE.add_local_file(
    Path(__file__).with_name("build_runtime.py"), "/root/build_runtime.py", copy=True
)

app = modal.App("hexbounty-compute")
volume = modal.Volume.from_name("hexbounty-workspaces", create_if_missing=True)

MANIFEST_NAME = "manifest.json"
QUERY_KINDS = {"functions", "xrefs", "decompile"}
MAX_TARGET = 128
JOB_ID_MAX = 64
AUTHORIZED_FIXTURES = {
    "breakout-reconstructed-v1": {
        "sha256": "770677bcbd7193ec458a23d0313c647d19c59527b2ce1184465d7e0ec7b1e155",
        "bytes": 32768,
        "destination": "rom/breakout-reconstructed.gb",
        "local_source": (
            "pipeline/gbdk-reconstruction/breakout/breakout-reconstructed.gb"
        ),
    },
    "grokathon-input-breakout-v1": {
        "sha256": "a120cce1d209f21b1d1e8e5daacb1fec9054405b25f3899bd511fd01642e6cbf",
        "bytes": 32768,
        "destination": "rom/breakout.gb",
        "local_source": "pipeline/raw_rom/breakout.gb",
    },
    "grokathon-input-kirby-v1": {
        "sha256": "0f6dba94fae248d419083001c42c02a78be6bd3dff679c895517559e72c98d58",
        "bytes": 262144,
        "destination": "rom/kirby.gb",
        "local_source": "pipeline/raw_rom/kirby.gb",
    },
    "grokathon-input-postie-v1": {
        "sha256": "a2dfc32e5468fa0a8d2529bfc344528517b7615ad104f264e400c67c5b314a98",
        "bytes": 262144,
        "destination": "rom/postie.gbc",
        "local_source": "pipeline/raw_rom/postie.gbc",
    },
}


class ToolError(Exception):
    """Refusal. Always surfaced as structured JSON, never as a stack trace."""


# --- bounding ---------------------------------------------------------------


def _valid_job_id(job_id: str) -> str:
    """Job ids mirror the arcade's SLUG_RE; anything else is refused."""
    if not isinstance(job_id, str) or not 1 <= len(job_id) <= JOB_ID_MAX:
        raise ToolError("job id must be 1-64 characters")
    if not job_id[0].isalnum() or job_id[0].isupper():
        raise ToolError("job id must start with a lowercase letter or digit")
    if any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in job_id):
        raise ToolError("job id may contain only [a-z0-9-]")
    return job_id


def _workspace(job_id: str) -> Path:
    """Resolve the job's workspace and prove it is inside the Volume root."""
    root = Path(WORKSPACES).resolve()
    ws = (root / _valid_job_id(job_id)).resolve()
    if ws != root and root not in ws.parents:
        raise ToolError("workspace escapes the volume root")
    if not ws.is_dir():
        raise ToolError(f"no workspace for job {job_id!r}")
    return ws


def _manifest(ws: Path) -> dict:
    """The operator-approved manifest is the authority on what a job may do."""
    path = ws / MANIFEST_NAME
    if not path.is_file():
        raise ToolError("job has no operator-approved manifest; refusing")
    try:
        manifest = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ToolError(f"manifest is not valid JSON: {exc}") from None
    if not manifest.get("approved"):
        raise ToolError("manifest is not marked approved by an operator")
    return manifest


def _allowed(manifest: dict, operation: str) -> None:
    ops = manifest.get("operations")
    if not isinstance(ops, list):
        raise ToolError("manifest does not list allowed operations")
    if operation not in ops:
        raise ToolError(f"operation {operation!r} is not approved for this job")


def _inside(ws: Path, candidate: str | Path) -> Path:
    """Every path crossing this boundary is re-resolved against the workspace."""
    resolved = (ws / candidate).resolve() if not Path(candidate).is_absolute() \
        else Path(candidate).resolve()
    if resolved != ws and ws not in resolved.parents:
        raise ToolError(f"path escapes the job workspace: {candidate}")
    return resolved


def _ok(operation: str, job_id: str, **payload) -> dict:
    return {"ok": True, "operation": operation, "job": job_id, **payload}


def _fail(operation: str, job_id: str, error: str) -> dict:
    return {"ok": False, "operation": operation, "job": job_id, "error": error}


def _run(cmd: list[str], *, cwd: Path, log: Path, timeout: int,
         env: dict | None = None) -> dict:
    """Run a fixed command, capture it to the workspace, never shell=True."""
    started = time.time()
    merged = os.environ.copy()
    merged.update(env or {})
    try:
        proc = subprocess.run(cmd, cwd=cwd, env=merged, capture_output=True,
                              text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ToolError(f"command timed out after {timeout}s: {shlex.join(cmd)}") from None
    output = (proc.stdout or "") + (proc.stderr or "")
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text(f"$ {shlex.join(cmd)}\n{output}\nEXIT={proc.returncode}\n")
    return {
        "exit": proc.returncode,
        "seconds": round(time.time() - started, 2),
        "log": str(log.relative_to(cwd)) if cwd in log.parents else str(log),
        "tail": output.splitlines()[-40:],
    }


def _staticre(ws: Path, ops: list[dict], timeout: int) -> list[dict]:
    """Drive the existing staticre JSON-lines backend. One line in, one out."""
    rom = _inside(ws, "rom")
    roms = sorted(rom.glob("*.gb")) + sorted(rom.glob("*.gbc"))
    if not roms:
        raise ToolError("no ROM in the job workspace")
    cmd = [
        "uv", "run", "--project", f"{REMOTE_PIPELINE}/static",
        "staticre", "serve", str(roms[0]),
        "--workdir", str(_inside(ws, "ghidra_work")),
    ]
    payload = "".join(json.dumps(op) + "\n" for op in ops)
    try:
        proc = subprocess.run(cmd, cwd=ws, input=payload, capture_output=True,
                              text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise ToolError(f"staticre timed out after {timeout}s") from None
    replies = []
    for line in (proc.stdout or "").splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            replies.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if not replies:
        raise ToolError(f"staticre returned no result (exit {proc.returncode})")
    failures = [reply for reply in replies if not reply.get("ok")]
    if failures:
        error = failures[0].get("error") or "unknown staticre error"
        raise ToolError(f"staticre request failed: {error}")
    return replies


# --- the five operations ----------------------------------------------------


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=CPU, memory=MEMORY,
              timeout=TIMEOUT)
def analyze(job_id: str) -> dict:
    """Open the job's ROM in Ghidra and run the existing staticre analysis."""
    try:
        ws = _workspace(job_id)
        _allowed(_manifest(ws), "analyze")
        replies = _staticre(ws, [{"id": 1, "op": "static.program_info", "params": {}},
                                 {"id": 2, "op": "static.memory_map", "params": {}},
                                 {"id": 3, "op": "static.entry_points", "params": {}}],
                            timeout=TIMEOUT - 60)
        (ws / "analysis.json").write_text(json.dumps(replies, indent=2) + "\n")
        volume.commit()
        return _ok("analyze", job_id, replies=replies)
    except ToolError as exc:
        return _fail("analyze", job_id, str(exc))


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=CPU, memory=MEMORY,
              timeout=TIMEOUT)
def query(job_id: str, kind: str, target: str = "") -> dict:
    """One bounded semantic query. `kind` is a closed set; `target` is bounded."""
    try:
        ws = _workspace(job_id)
        _allowed(_manifest(ws), "query")
        if kind not in QUERY_KINDS:
            raise ToolError(f"unsupported query kind {kind!r}; expected one of "
                            f"{sorted(QUERY_KINDS)}")
        if len(target) > MAX_TARGET:
            raise ToolError(f"target exceeds {MAX_TARGET} characters")
        if kind == "functions":
            op = {"id": 1, "op": "static.list_functions",
                  "params": {"limit": 100, "cursor": None}}
        elif kind == "xrefs":
            if not target:
                raise ToolError("xrefs requires --target")
            op = {"id": 1, "op": "static.xrefs", "params": {"address": target}}
        else:
            if not target:
                raise ToolError("decompile requires --target")
            op = {"id": 1, "op": "static.decompile", "params": {"address": target}}
        replies = _staticre(ws, [op], timeout=TIMEOUT - 60)
        volume.commit()
        return _ok("query", job_id, kind=kind, target=target, replies=replies)
    except ToolError as exc:
        return _fail("query", job_id, str(exc))


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=CPU, memory=MEMORY,
              timeout=TIMEOUT)
def build(job_id: str) -> dict:
    """Compile the reconstruction with the existing build_rom.sh (GBDK)."""
    try:
        ws = _workspace(job_id)
        _allowed(_manifest(ws), "build")
        script = ws / "build_rom.sh"
        if not script.is_file():
            script.write_bytes(Path(f"{REMOTE_PIPELINE}/harness/build_rom.sh").read_bytes())
            script.chmod(0o755)
        if not (ws / "src").is_dir():
            raise ToolError("job workspace has no src/ to build")
        result = _run([str(script)], cwd=ws, log=ws / "logs/build.log",
                      timeout=30 * 60, env={"GBDK_HOME": "/opt/gbdk"})
        roms = [str(p.relative_to(ws)) for p in (ws / "src").glob("*.gb")]
        volume.commit()
        return _ok("build", job_id, artifacts=roms, **result)
    except ToolError as exc:
        return _fail("build", job_id, str(exc))


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=CPU, memory=MEMORY,
              timeout=TIMEOUT)
def compare(job_id: str) -> dict:
    """Run the existing CompareBoy differential over original vs candidate."""
    try:
        ws = _workspace(job_id)
        manifest = _manifest(ws)
        _allowed(manifest, "compare")
        original = _inside(ws, manifest.get("original") or "rom/original.gb")
        candidate = _inside(ws, manifest.get("candidate") or "src/candidate.gb")
        script = _inside(ws, manifest.get("compare_script") or "compare_script.json")
        for path, what in ((original, "original ROM"), (candidate, "candidate ROM"),
                           (script, "compare script")):
            if not path.is_file():
                raise ToolError(f"{what} not found at {path.relative_to(ws)}")
        out = ws / "comparison.json"
        result = _run(
            ["python3", f"{REMOTE_PIPELINE}/agent/compareboy.py",
             "--original", str(original), "--candidate", str(candidate),
             "--script", str(script), "--output", str(out),
             "--artifacts", str(_inside(ws, "artifacts"))],
            cwd=ws, log=ws / "logs/compare.log", timeout=60 * 60,
        )
        summary = None
        if out.is_file():
            try:
                summary = json.loads(out.read_text()).get("summary")
            except json.JSONDecodeError:
                summary = None
        volume.commit()
        return _ok("compare", job_id, summary=summary, **result)
    except ToolError as exc:
        return _fail("compare", job_id, str(exc))


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=2.0, memory=4096,
              timeout=15 * 60)
def evidence(job_id: str) -> dict:
    """Inventory what the run produced, with hashes. Publishes nothing."""
    try:
        ws = _workspace(job_id)
        _allowed(_manifest(ws), "evidence")
        collected = []
        for rel in ("analysis.json", "codex_analysis.json", "comparison.json",
                    "RUN_STATUS.json",
                    "run_meta.json"):
            path = ws / rel
            if path.is_file():
                collected.append({
                    "path": rel,
                    "bytes": path.stat().st_size,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                })
        for pattern in ("rom/*.gb", "rom/*.gbc", "src/*.gb", "artifacts/**/*.png",
                        "logs/*.log"):
            for path in sorted(ws.glob(pattern)):
                if path.is_file():
                    collected.append({
                        "path": str(path.relative_to(ws)),
                        "bytes": path.stat().st_size,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                    })
        report = {"job": job_id, "artifacts": collected,
                  "collectedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        (ws / "evidence.json").write_text(json.dumps(report, indent=2) + "\n")
        volume.commit()
        return _ok("evidence", job_id, **report)
    except ToolError as exc:
        return _fail("evidence", job_id, str(exc))


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=2.0, memory=4096,
              timeout=10 * 60)
def provision(job_id: str, manifest: dict) -> dict:
    """Create a job workspace from an operator-approved manifest.

    Called only by the local dispatcher, never by the agent. The manifest must
    already carry the operator's approval; this function does not grant it.
    """
    try:
        job_id = _valid_job_id(job_id)
        if not manifest.get("approved"):
            raise ToolError("refusing to provision an unapproved manifest")
        root = Path(WORKSPACES).resolve()
        ws = (root / job_id).resolve()
        if root not in ws.parents:
            raise ToolError("workspace escapes the volume root")
        for sub in ("rom", "src", "ghidra_work", "artifacts", "logs"):
            (ws / sub).mkdir(parents=True, exist_ok=True)
        (ws / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2) + "\n")
        volume.commit()
        return _ok("provision", job_id, workspace=str(ws))
    except ToolError as exc:
        return _fail("provision", job_id, str(exc))


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=1.0, memory=1024,
              timeout=5 * 60)
def seed_authorized_fixture(job_id: str, fixture_name: str, payload: bytes) -> dict:
    """Operator-only seeding for a single content-addressed demo fixture.

    This function is deliberately absent from ``remote_tools.py``. It is a
    private Modal Function, not a web endpoint, and it accepts a payload only
    when both the operator-approved manifest and this code name the same fixture
    and the payload matches the hard-coded size and SHA-256. The Codex agent
    receives neither Modal credentials nor an arbitrary upload primitive.
    """
    try:
        ws = _workspace(job_id)
        manifest = _manifest(ws)
        fixture = AUTHORIZED_FIXTURES.get(fixture_name)
        if fixture is None:
            raise ToolError(f"fixture {fixture_name!r} is not allowlisted")
        if manifest.get("authorizedFixture") != fixture_name:
            raise ToolError("manifest does not approve this fixture")
        if not isinstance(payload, bytes):
            raise ToolError("fixture payload must be bytes")
        if len(payload) != fixture["bytes"]:
            raise ToolError("fixture size does not match the allowlist")
        digest = hashlib.sha256(payload).hexdigest()
        if digest != fixture["sha256"]:
            raise ToolError("fixture digest does not match the allowlist")

        destination = _inside(ws, fixture["destination"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(payload)
        os.replace(temporary, destination)
        volume.commit()
        return _ok(
            "seed-authorized-fixture",
            job_id,
            fixture=fixture_name,
            path=str(destination.relative_to(ws)),
            bytes=len(payload),
            sha256=digest,
        )
    except ToolError as exc:
        return _fail("seed-authorized-fixture", job_id, str(exc))


@app.local_entrypoint()
def operator_seed(
    job_id: str = "codex-modal-ghidra-smoke",
    fixture_name: str = "breakout-reconstructed-v1",
) -> None:
    """Provision and seed one explicitly allowlisted fixture from the operator PC."""
    job_id = _valid_job_id(job_id)
    fixture = AUTHORIZED_FIXTURES.get(fixture_name)
    if fixture is None:
        allowed = ", ".join(sorted(AUTHORIZED_FIXTURES))
        raise ValueError(f"fixture {fixture_name!r} is not allowlisted; choose: {allowed}")
    source = (UPSTREAM / fixture["local_source"]).resolve()
    upstream = UPSTREAM.resolve()
    if upstream not in source.parents:
        raise RuntimeError("authorized fixture source escapes HEXBOUNTY_UPSTREAM")
    if not source.is_file():
        raise FileNotFoundError(
            f"authorized fixture missing at {source}; set HEXBOUNTY_UPSTREAM"
        )
    payload = source.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if len(payload) != fixture["bytes"] or digest != fixture["sha256"]:
        raise RuntimeError("local authorized fixture does not match its allowlist")

    manifest = {
        "job": job_id,
        "approved": True,
        "approvedBy": "modal-operator",
        "operations": ["analyze", "query", "evidence"],
        "authorizedFixture": fixture_name,
    }
    provisioned = provision.remote(job_id, manifest)
    seeded = seed_authorized_fixture.remote(job_id, fixture_name, payload)
    print(json.dumps({"provision": provisioned, "seed": seeded}, indent=2))


@app.local_entrypoint()
def operator_analyze(job_id: str) -> None:
    """Run approved read-only analysis and print a concise auditable summary."""
    job_id = _valid_job_id(job_id)
    analyzed = analyze.remote(job_id)
    functions = query.remote(job_id, "functions")
    collected = evidence.remote(job_id)
    analysis_result = analyzed.get("replies", [{}])[0].get("result", {})
    function_result = functions.get("replies", [{}])[0].get("result", {})
    roms = [
        artifact for artifact in collected.get("artifacts", [])
        if artifact.get("path", "").startswith("rom/")
    ]
    print(json.dumps({
        "ok": all(result.get("ok") for result in (analyzed, functions, collected)),
        "job": job_id,
        "program": analysis_result,
        "functions_query": {
            "ok": functions.get("ok", False),
            "returned": len(function_result.get("functions", [])),
            "total": function_result.get("total"),
            "next_cursor": function_result.get("next_cursor"),
        },
        "input_evidence": roms,
        "analysis_evidence": [
            artifact for artifact in collected.get("artifacts", [])
            if artifact.get("path") == "analysis.json"
        ],
        "collectedAt": collected.get("collectedAt"),
    }, indent=2))
