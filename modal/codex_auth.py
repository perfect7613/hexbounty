"""One-time Codex device login inside Modal.

Authentication is written only to the private ``hexbounty-codex-home`` Volume.
It is never baked into the image or copied into the repository/workspace Volume.

Run and leave the process attached while completing the browser flow:

    modal run modal/codex_auth.py::device_login
"""

from __future__ import annotations

import subprocess

import modal


CODEX_VERSION = "0.147.0"
CODEX_HOME = "/root/.codex"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ca-certificates", "nodejs", "npm")
    .run_commands(f"npm install --global @openai/codex@{CODEX_VERSION}")
)

app = modal.App("hexbounty-codex-auth")
codex_home = modal.Volume.from_name("hexbounty-codex-home", create_if_missing=True)


@app.function(
    image=image,
    volumes={CODEX_HOME: codex_home},
    cpu=1.0,
    memory=1024,
    timeout=15 * 60,
)
def device_login() -> None:
    """Stream the device URL/code, wait for completion, then persist auth."""
    process = subprocess.Popen(
        ["codex", "login", "--device-auth"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        print(line, end="", flush=True)
    return_code = process.wait()
    if return_code != 0:
        raise RuntimeError(f"Codex device login exited with status {return_code}")
    codex_home.commit()
    subprocess.run(["codex", "login", "status"], check=True)


@app.function(
    image=image,
    volumes={CODEX_HOME: codex_home},
    cpu=1.0,
    memory=1024,
    timeout=2 * 60,
)
def status() -> None:
    """Check the persisted container login without exposing credentials."""
    subprocess.run(["codex", "login", "status"], check=True)
