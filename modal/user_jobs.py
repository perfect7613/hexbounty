"""Signed Vercel-to-Modal API for private GB/GBC reconstruction jobs.

The browser never calls this service directly. A trusted Vercel server route
authenticates the wallet/session, creates a short-lived upload download URL,
and signs the exact request with ``HEXBOUNTY_MODAL_HMAC_SECRET``. Modal fetches
the bytes immediately, validates the cartridge header and caller-declared
digest, stores them on the private workspace Volume, and spawns the existing
Codex reconstruction harness asynchronously.

Deploy independently from the demo compute functions:

    modal deploy modal/user_jobs.py

The Modal Secret ``hexbounty-user-jobs-api`` must contain:

    HEXBOUNTY_MODAL_HMAC_SECRET   high-entropy shared secret (32+ bytes)
    HEXBOUNTY_UPLOAD_HOSTS        comma-separated download host allowlist

No UploadThing API secret is needed in Modal. Only a short-lived per-file
download URL crosses this boundary.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

import modal

from build_runtime import MEMORY, TIMEOUT, WORKSPACES
from codex_container import CODEX_HOME, CODEX_IMAGE
from user_job_core import (
    MAX_ROM_BYTES,
    ValidationError,
    candidate_quality,
    derive_job_id,
    parse_allowed_hosts,
    rejected_job_is_retryable,
    validate_digest,
    validate_expected_bytes,
    validate_extension,
    validate_job_id,
    validate_owner,
    validate_public_metadata,
    validate_rom,
    validate_source_url,
    verify_signature,
)


APP_NAME = "hexbounty-user-jobs"
API_SECRET_NAME = "hexbounty-user-jobs-api"
MANIFEST_NAME = "user-job.json"
RESULT_NAME = "result.json"
MAX_REQUEST_BODY = 8 * 1024
MAX_ERROR_LENGTH = 1000
HARNESS_MAX_PASSES = 2
HARNESS_TIMEOUT = TIMEOUT - 120

_module_dir = Path(__file__).resolve().parent


def _with_entrypoint_imports(image: modal.Image) -> modal.Image:
    """Bake the complete import closure needed to hydrate ``user_jobs.py``.

    Modal mounts the entry module, not arbitrary sibling modules. Both the
    lightweight API image and the reconstruction image import this entry module
    when a container starts, so both need the same siblings at their canonical
    ``/root`` module paths.
    """
    for name in (
        "authorized_analysis.py",
        "build_runtime.py",
        "codex_container.py",
        "user_job_core.py",
    ):
        image = image.add_local_file(_module_dir / name, f"/root/{name}", copy=True)
    return image


API_IMAGE = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi==0.116.1")
)
API_IMAGE = _with_entrypoint_imports(API_IMAGE)
WORKER_IMAGE = _with_entrypoint_imports(CODEX_IMAGE)

app = modal.App(APP_NAME)
workspaces = modal.Volume.from_name("hexbounty-workspaces", create_if_missing=True)
codex_home = modal.Volume.from_name("hexbounty-codex-home", create_if_missing=False)
api_secret = modal.Secret.from_name(
    API_SECRET_NAME,
    required_keys=["HEXBOUNTY_MODAL_HMAC_SECRET", "HEXBOUNTY_UPLOAD_HOSTS"],
)


@app.function(image=API_IMAGE, cpu=0.25, memory=256, timeout=60)
def packaging_preflight() -> dict:
    """Regression probe: prove the deployed entrypoint import closure exists."""
    import authorized_analysis
    import build_runtime
    import codex_container
    import user_job_core

    modules = (authorized_analysis, build_runtime, codex_container, user_job_core)
    return {
        "ok": True,
        "modules": {module.__name__: str(Path(module.__file__).resolve()) for module in modules},
    }


@app.local_entrypoint()
def preflight() -> None:
    """Invoke and print the remote packaging regression probe."""
    print(json.dumps(packaging_preflight.remote(), indent=2, sort_keys=True))


def _root() -> Path:
    return Path(WORKSPACES).resolve()


def _job_workspace(job_id: str, *, require: bool = True) -> Path:
    job_id = validate_job_id(job_id)
    root = _root()
    ws = (root / job_id).resolve()
    if root not in ws.parents:
        raise ValidationError("job workspace escapes the private Volume")
    if require and not ws.is_dir():
        raise FileNotFoundError(job_id)
    return ws


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid private job state: {path.name}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"invalid private job state: {path.name}")
    return value


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    os.replace(temporary, path)


def _public_status(manifest: dict) -> dict:
    response = {
        "jobId": manifest["jobId"],
        "owner": manifest["owner"],
        "status": manifest["status"],
        "phase": manifest["phase"],
        "progress": manifest["progress"],
        "createdAt": manifest["createdAt"],
        "updatedAt": manifest["updatedAt"],
        "input": manifest["input"],
        "game": manifest["game"],
    }
    for key in ("result", "error"):
        if key in manifest:
            response[key] = manifest[key]
    return response


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


def _download_rom(url: str, expected_bytes: int, allowed_hosts: tuple[str, ...]) -> bytes:
    validate_source_url(url, allowed_hosts)
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/octet-stream", "User-Agent": "HexBounty-Modal/1"},
        method="GET",
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(request, timeout=60) as response:
            final_url = response.geturl()
            validate_source_url(final_url, allowed_hosts)
            content_encoding = response.headers.get("Content-Encoding", "identity").lower()
            if content_encoding not in ("", "identity"):
                raise ValidationError("compressed upload responses are not accepted")
            declared = response.headers.get("Content-Length")
            if declared is not None:
                try:
                    declared_bytes = int(declared)
                except ValueError:
                    raise ValidationError("upload Content-Length is invalid") from None
                if declared_bytes != expected_bytes:
                    raise ValidationError("upload Content-Length does not match sourceBytes")
            payload = response.read(MAX_ROM_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise ValidationError(f"upload download returned HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        raise ValidationError(f"upload download failed: {exc.reason}") from None
    if len(payload) != expected_bytes:
        raise ValidationError("downloaded bytes do not match sourceBytes")
    return payload


def _set_status(ws: Path, **changes) -> dict:
    manifest_path = ws / MANIFEST_NAME
    manifest = _read_json(manifest_path)
    manifest.update(changes)
    manifest["updatedAt"] = int(time.time())
    _write_json(manifest_path, manifest)
    workspaces.commit()
    return manifest


@app.function(
    image=WORKER_IMAGE,
    volumes={WORKSPACES: workspaces, CODEX_HOME: codex_home},
    cpu=2.0,
    memory=MEMORY,
    timeout=TIMEOUT,
)
def reconstruct_user_job(job_id: str) -> dict:
    """Run one fixed invocation of the existing Codex reconstruction harness."""
    ws: Path | None = None
    try:
        workspaces.reload()
        codex_home.reload()
        ws = _job_workspace(job_id)
        manifest = _read_json(ws / MANIFEST_NAME)
        if manifest.get("jobId") != job_id or manifest.get("kind") != "user-reconstruction-v1":
            raise ValidationError("job manifest does not authorize user reconstruction")
        if manifest.get("status") != "queued":
            raise ValidationError("job is not queued")

        source_rel = manifest.get("privateInputPath")
        source = (ws / str(source_rel)).resolve()
        if ws not in source.parents or not source.is_file():
            raise ValidationError("content-addressed job input is missing")
        payload = source.read_bytes()
        if hashlib.sha256(payload).hexdigest() != manifest["input"]["sha256"]:
            raise ValidationError("private input digest changed after ingestion")
        validate_rom(payload, manifest["input"]["extension"])

        _set_status(ws, status="running", phase="reconstructing", progress=20)
        harness_runs = ws / "harness-runs"
        harness_runs.mkdir(exist_ok=False)
        console_path = ws / "logs" / "harness-console.log"
        console_path.parent.mkdir(parents=True, exist_ok=True)
        command = [
            "python3",
            "/opt/pipeline/harness/run_agent.py",
            "--rom",
            str(source),
            "--engine",
            "codex",
            "--max-passes",
            str(HARNESS_MAX_PASSES),
            "--label",
            "reconstruction",
            "--workspaces-dir",
            str(harness_runs),
            "--mcp",
            "local",
        ]
        runtime_home = Path("/tmp") / f"hexbounty-user-{job_id}"
        runtime_home.mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "HOME": str(runtime_home),
            "CODEX_HOME": CODEX_HOME,
            "NO_COLOR": "1",
            "UV_CACHE_DIR": str(runtime_home / ".cache/uv"),
            "XDG_CACHE_HOME": str(runtime_home / ".cache"),
            "XDG_CONFIG_HOME": str(runtime_home / ".config"),
            "XDG_DATA_HOME": str(runtime_home / ".local/share"),
        }
        with console_path.open("w") as console:
            process = subprocess.run(
                command,
                cwd=ws,
                env=env,
                stdout=console,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=HARNESS_TIMEOUT,
            )

        runs = [path for path in harness_runs.iterdir() if path.is_dir()]
        if len(runs) != 1:
            raise RuntimeError("reconstruction harness did not create exactly one run")
        run = runs[0]
        status = _read_json(run / "RUN_STATUS.json")
        run_status = str(status.get("status") or "unknown")
        candidate = run / "src" / "reconstructed.gb"
        quality = candidate_quality(process.returncode, run_status, candidate.is_file())
        if quality is None:
            summary = str(status.get("summary") or "reconstruction did not complete")
            manifest = _set_status(
                ws,
                status="incomplete" if process.returncode in (0, 2) else "failed",
                phase="finished",
                progress=100,
                error=summary[:MAX_ERROR_LENGTH],
            )
            return _public_status(manifest)

        # A compiled, structurally valid ROM is useful even when differential
        # comparison finds known behavioral gaps. Preserve that truth as a
        # quality label instead of discarding a playable candidate.
        candidate_payload = candidate.read_bytes()
        # GBDK conventionally names the build reconstructed.gb even for a CGB
        # target. Derive the serving extension from the validated header flag.
        if len(candidate_payload) < 0x150:
            raise ValidationError("reconstructed output is too short for a Game Boy header")
        output_extension = ".gbc" if candidate_payload[0x143] in (0x80, 0xC0) else ".gb"
        output_info = validate_rom(candidate_payload, output_extension)
        output_digest = hashlib.sha256(candidate_payload).hexdigest()
        output = ws / "result" / f"reconstructed-{output_digest[:16]}{output_extension}"
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(output.suffix + ".tmp")
        temporary.write_bytes(candidate_payload)
        os.replace(temporary, output)
        result = {
            "sha256": output_digest,
            "bytes": len(candidate_payload),
            "platform": output_info["platform"],
            "extension": output_extension,
            # This is an authenticated server route, not a public object URL.
            # Vercel may use it to mint/proxy a short-lived player download.
            "serverOutputPath": f"/v1/jobs/{job_id}/result",
            "runStatus": run_status,
            "quality": quality,
        }
        _write_json(ws / RESULT_NAME, result)
        manifest = _set_status(
            ws,
            status="complete",
            phase="finished",
            progress=100,
            privateResultPath=str(output.relative_to(ws)),
            result=result,
            detail=(
                "Playable approximate reconstruction; exact behavioral comparison still has known gaps."
                if quality == "approximate"
                else "Reconstruction completed with the harness verification target."
            ),
        )
        return _public_status(manifest)
    except subprocess.TimeoutExpired:
        error = f"reconstruction exceeded the {HARNESS_TIMEOUT}-second job limit"
    except (OSError, RuntimeError, ValidationError, KeyError, TypeError, IndexError) as exc:
        error = str(exc)[:MAX_ERROR_LENGTH]

    if ws is not None and (ws / MANIFEST_NAME).is_file():
        try:
            manifest = _set_status(
                ws, status="failed", phase="finished", progress=100, error=error
            )
            return _public_status(manifest)
        except Exception:
            pass
    return {"jobId": job_id, "status": "failed", "error": error}


@app.function(
    image=API_IMAGE,
    volumes={WORKSPACES: workspaces},
    secrets=[api_secret],
    cpu=1.0,
    memory=1024,
    timeout=5 * 60,
)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Request
    from fastapi.responses import FileResponse, JSONResponse

    # With postponed annotations, FastAPI resolves ``Request`` in the route
    # function's module globals, not this factory's local scope. Publish only
    # the framework type so request parameters bind to ASGI instead of being
    # misclassified as a required query string.
    globals()["Request"] = Request

    web = FastAPI(title="HexBounty private job API", docs_url=None, redoc_url=None)

    def refusal(message: str, status_code: int = 400) -> JSONResponse:
        return JSONResponse({"ok": False, "error": message}, status_code=status_code)

    def authenticate(request: Request, body: bytes) -> str:
        owner = validate_owner(request.headers.get("x-hexbounty-owner"))
        timestamp = request.headers.get("x-hexbounty-timestamp", "")
        nonce = request.headers.get("x-hexbounty-nonce", "")
        supplied = request.headers.get("x-hexbounty-signature", "")
        signing_secret = os.environ["HEXBOUNTY_MODAL_HMAC_SECRET"]
        if len(signing_secret.encode("utf-8")) < 32:
            raise RuntimeError("HEXBOUNTY_MODAL_HMAC_SECRET must be at least 32 bytes")
        verify_signature(
            signing_secret,
            timestamp=timestamp,
            nonce=nonce,
            method=request.method,
            path=request.url.path,
            owner=owner,
            body=body,
            supplied=supplied,
        )
        nonce_dir = _root() / ".request-nonces"
        nonce_dir.mkdir(parents=True, exist_ok=True)
        nonce_key = hashlib.sha256(f"{timestamp}:{nonce}".encode()).hexdigest()
        nonce_path = nonce_dir / nonce_key
        try:
            with nonce_path.open("x") as handle:
                handle.write(timestamp + "\n")
        except FileExistsError:
            raise ValidationError("request nonce has already been used") from None
        # Bounded opportunistic cleanup; correctness does not depend on cleanup.
        cutoff = int(time.time()) - 2 * 5 * 60
        for old in list(nonce_dir.iterdir())[:100]:
            try:
                if int(old.read_text().strip()) < cutoff:
                    old.unlink()
            except (OSError, ValueError):
                continue
        workspaces.commit()
        return owner

    def owned_manifest(job_id: str, owner: str) -> tuple[Path, dict]:
        workspaces.reload()
        ws = _job_workspace(job_id)
        manifest = _read_json(ws / MANIFEST_NAME)
        if manifest.get("owner") != owner:
            raise FileNotFoundError(job_id)
        return ws, manifest

    @web.post("/v1/jobs")
    async def create_job(request: Request):
        try:
            content_length = request.headers.get("content-length")
            if content_length:
                try:
                    if int(content_length) > MAX_REQUEST_BODY:
                        return refusal("request body is too large", 413)
                except ValueError:
                    return refusal("Content-Length is invalid")
            body = await request.body()
            if len(body) > MAX_REQUEST_BODY:
                return refusal("request body is too large", 413)
            owner = authenticate(request, body)
            try:
                value = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                raise ValidationError("request body must be valid JSON") from None
            if not isinstance(value, dict):
                raise ValidationError("request body must be a JSON object")
            required = {
                "jobId",
                "owner",
                "sourceUrl",
                "sourceSha256",
                "sourceBytes",
                "extension",
                "slug",
                "title",
                "description",
                "priceMon",
                "rightsNote",
                "rightsAttestedAt",
                "bountyMon",
                "bountyTxHash",
                "bountyId",
                "bountyDeadline",
                "bountyMetadataURI",
            }
            if set(value) != required:
                raise ValidationError("request body fields do not match the v1 job schema")
            job_id = validate_job_id(value["jobId"])
            if validate_owner(value["owner"]) != owner:
                raise ValidationError("signed owner does not match request body owner")
            game = validate_public_metadata(
                {
                    key: value[key]
                    for key in (
                        "slug",
                        "title",
                        "description",
                        "priceMon",
                        "rightsNote",
                        "rightsAttestedAt",
                        "bountyMon",
                        "bountyTxHash",
                        "bountyId",
                        "bountyDeadline",
                        "bountyMetadataURI",
                    )
                }
            )
            if job_id != derive_job_id(game["slug"], owner):
                raise ValidationError("jobId does not match derive_job_id(slug, owner)")
            digest = validate_digest(value["sourceSha256"])
            expected_bytes = validate_expected_bytes(value["sourceBytes"])
            extension = validate_extension(value["extension"])
            allowed_hosts = parse_allowed_hosts(os.environ["HEXBOUNTY_UPLOAD_HOSTS"])
            source_url = validate_source_url(value["sourceUrl"], allowed_hosts)

            ws = _job_workspace(job_id, require=False)
            try:
                ws.mkdir(parents=False, exist_ok=False)
            except FileExistsError:
                # A rejected ingestion has no retained source bytes and should
                # not permanently reserve a deterministic owner/slug job id.
                # Reuse only the exact owner-bound empty rejection workspace;
                # every queued/running/complete job remains immutable.
                existing = _read_json(ws / MANIFEST_NAME)
                retained = {path.name for path in ws.iterdir()}
                retryable = rejected_job_is_retryable(
                    existing,
                    retained,
                    job_id=job_id,
                    owner=owner,
                    manifest_name=MANIFEST_NAME,
                )
                if not retryable:
                    return refusal("jobId already exists", 409)
            try:
                payload = _download_rom(source_url, expected_bytes, allowed_hosts)
                actual_digest = hashlib.sha256(payload).hexdigest()
                if actual_digest != digest:
                    raise ValidationError("downloaded ROM does not match sourceSha256")
                header = validate_rom(payload, extension)
                input_rel = f"input/program-{digest[:16]}{extension}"
                input_path = ws / input_rel
                input_path.parent.mkdir(parents=True)
                input_path.write_bytes(payload)
                now = int(time.time())
                manifest = {
                    "jobId": job_id,
                    "kind": "user-reconstruction-v1",
                    "owner": owner,
                    "status": "queued",
                    "phase": "queued",
                    "progress": 10,
                    "createdAt": now,
                    "updatedAt": now,
                    "privateInputPath": input_rel,
                    "game": game,
                    "input": {
                        "sha256": digest,
                        "bytes": expected_bytes,
                        "extension": extension,
                        "platform": header["platform"],
                        "banks": header["banks"],
                    },
                }
                _write_json(ws / MANIFEST_NAME, manifest)
                workspaces.commit()
                # The public job id is the stable polling handle. Do not write
                # the Modal call id after spawn: the worker may already have
                # advanced the manifest, and an old queued write could race it.
                reconstruct_user_job.spawn(job_id)
                return JSONResponse(
                    {"ok": True, **_public_status(manifest)}, status_code=202
                )
            except Exception:
                # Keep the collision marker but never retain a rejected upload.
                rejected = {
                    "jobId": job_id,
                    "kind": "user-reconstruction-v1",
                    "owner": owner,
                    "status": "rejected",
                    "phase": "ingestion",
                    "progress": 100,
                    "createdAt": int(time.time()),
                    "updatedAt": int(time.time()),
                    "input": {"sha256": digest, "bytes": expected_bytes, "extension": extension},
                    "game": game,
                }
                _write_json(ws / MANIFEST_NAME, rejected)
                input_dir = ws / "input"
                if input_dir.is_dir():
                    for path in input_dir.iterdir():
                        if path.is_file():
                            path.unlink()
                workspaces.commit()
                raise
        except ValidationError as exc:
            return refusal(str(exc))
        except (OSError, RuntimeError, urllib.error.URLError) as exc:
            return refusal(str(exc)[:MAX_ERROR_LENGTH], 502)

    @web.get("/v1/jobs/{job_id}")
    async def job_status(job_id: str, request: Request):
        try:
            owner = authenticate(request, b"")
            _, manifest = owned_manifest(job_id, owner)
            return {"ok": True, **_public_status(manifest)}
        except (FileNotFoundError, ValidationError):
            return refusal("job not found", 404)

    @web.get("/v1/jobs/{job_id}/result")
    async def job_result(job_id: str, request: Request):
        try:
            owner = authenticate(request, b"")
            ws, manifest = owned_manifest(job_id, owner)
            if manifest.get("status") != "complete":
                return refusal("job result is not ready", 409)
            result = (ws / str(manifest.get("privateResultPath"))).resolve()
            if ws not in result.parents or not result.is_file():
                raise FileNotFoundError(job_id)
            return FileResponse(
                result,
                media_type="application/octet-stream",
                filename=f"{job_id}-reconstructed{manifest['result']['extension']}",
                headers={"Cache-Control": "private, no-store"},
            )
        except (FileNotFoundError, ValidationError):
            return refusal("job result not found", 404)

    return web
