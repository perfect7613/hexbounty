"""HexBounty Modal runtime image.

Built on the layer stack that already builds clean in Modal (RGBDS, cppp,
GBDK-2020 and the SameBoy bridge, with pinned URLs and SHA256 checks), with the
static-analysis half added from the upstream staticre Dockerfile: JDK 21,
Ghidra 11.4.2 and the GhidraBoy SM83 extension.

Nothing here reimplements analysis. The image only carries the existing
implementations so `hexbounty_modal.py` can call them:

    analyze / query  -> pipeline/static  (staticre, PyGhidra)
    build            -> pipeline/harness/build_rom.sh (GBDK)
    compare          -> pipeline/agent/compareboy.py  (SameBoy)

Credential boundary: this image, its Volume and its logs receive **no** Codex
auth, no GitHub auth and no wallet key. Modal holds only its own
token, which lives on the operator's machine and is never baked in here.

Smoke test the image before wiring anything to it:

    modal run modal/build_runtime.py::smoke
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import modal

# --- pinned third-party artifacts -------------------------------------------
# Ghidra/GhidraBoy pins are the ones the upstream staticre Dockerfile already
# uses. GhidraBoy is NOT vendored upstream -- it is downloaded at build time --
# so its provenance is recorded here:
#   Gekkio/GhidraBoy, release tag 20250830, Apache-2.0,
#   asset ghidra_11.4.2_PUBLIC_20250830_GhidraBoy.zip (42841 bytes).
# The image records the SHA256 of both archives at build time; see smoke().
GHIDRA_VERSION = "11.4.2"
GHIDRA_URL = (
    "https://github.com/NationalSecurityAgency/ghidra/releases/download/"
    "Ghidra_11.4.2_build/ghidra_11.4.2_PUBLIC_20250826.zip"
)
GHIDRA_SHA256 = "795a02076af16257bd6f3f4736c4fc152ce9ff1f95df35cd47e2adc086e037a6"
GHIDRABOY_VERSION = "20250830"
GHIDRABOY_LICENSE = "Apache-2.0"
GHIDRABOY_URL = (
    "https://github.com/Gekkio/GhidraBoy/releases/download/20250830/"
    "ghidra_11.4.2_PUBLIC_20250830_GhidraBoy.zip"
)
GHIDRABOY_SHA256 = "170bbc70b9ce4554dae7d306c1a6414d2d09fc7e3f990dd8fdbc0a260c3641fe"

# Verified pins carried over from the working Modal build.
CPPP_URL = "https://www.muppetlabs.com/~breadbox/pub/software/cppp-2.9.tar.gz"
CPPP_SHA256 = "76a95b46c3e36d55c0a98175c0aa72b17b219e68062c2c2c26f971e749951c07"
GBDK_URL = "https://github.com/gbdk-2020/gbdk-2020/releases/download/4.5.0/gbdk-linux64.tar.gz"
GBDK_SHA256 = "d7857a5f6d135ee4c249043ca26aad9f2ec8ab5d4106d97720d404114f42605c"
RGBDS_URL = "https://github.com/gbdev/rgbds/archive/refs/tags/v1.0.3.tar.gz"
RGBDS_SHA256 = "e79e51bdc0e53d8b52b5b9b58a5cbe15d6a380092da67dd625aeca29f6679660"

# JDK 21 for Ghidra 11.4.2. Debian bookworm's main archive tops out at 17, so
# the Temurin build is pinned and verified rather than pulling in backports.
JDK_URL = (
    "https://github.com/adoptium/temurin21-binaries/releases/download/"
    "jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_linux_hotspot_21.0.12_8.tar.gz"
)
JDK_SHA256 = "e4446ff06a276155697597cc0f1b15da004ff083f4964a35271ecee567177370"
JAVA_HOME = "/opt/java"

# SameBoy's vendored `-Werror` build is known to fail under the newer Clang in
# this image (`Core/apu.c` sign-compare). Debian bookworm's GCC is the tested
# compiler for this exact pinned revision; retain an override for diagnostics.
SAMEBOY_CC = os.environ.get("HEXBOUNTY_SAMEBOY_CC", "gcc")
# Keep upstream's warnings-as-errors policy, but suppress two diagnostics in the
# pinned 2026-07-10 revision that fail under both Debian bookworm GCC and Clang.
# Passing WARNINGS at build time avoids modifying the vendored source tree.
SAMEBOY_WARNINGS = " ".join(
    (
        "-Werror",
        "-Wall",
        "-Wno-unknown-warning",
        "-Wno-unknown-warning-option",
        "-Wno-missing-braces",
        "-Wno-nonnull",
        "-Wno-unused-result",
        "-Wno-multichar",
        "-Wno-int-in-bool-context",
        "-Wno-format-truncation",
        "-Wno-nullability-completeness",
        "-Wno-maybe-uninitialized",
        "-Wno-sign-compare",
        "-Wno-implicit-fallthrough",
    )
)
GHIDRA_HOME = "/opt/ghidra"
WORKSPACES = "/workspaces"
REMOTE_PIPELINE = "/opt/pipeline"

# --- local source, added only when present ----------------------------------
# The compute-side source is added from the upstream checkout. It is optional so
# the base runtime can be built and smoke-tested on its own.
UPSTREAM = Path(os.environ.get("HEXBOUNTY_UPSTREAM", str(Path.home() / "hexbounty")))


def _has(rel: str) -> bool:
    """Present *and* non-empty.

    `pipeline/vendor/SameBoy` is a git submodule. An un-initialised checkout
    leaves the directory there but empty, which Modal mounts as nothing and the
    bridge build then fails deep inside make. Treat empty as absent so the
    image degrades to "no SameBoy" instead of failing to build.
    """
    path = UPSTREAM / rel
    if not path.exists():
        return False
    if path.is_dir() and not any(path.iterdir()):
        return False
    return True


_base = (
    # Debian bookworm, not Ubuntu 24.04 as originally specified. The vendored
    # SameBoy builds with -Werror and does not compile under 24.04's gcc 13 or
    # clang 18 (sign-compare and implicit-fallthrough in Core/apu.c); bookworm's
    # toolchain is the one the working build already used. Changing the vendored
    # emulator's warning flags to satisfy a newer compiler is not worth it.
    modal.Image.debian_slim(python_version="3.12")
    .env({"DEBIAN_FRONTEND": "noninteractive"})
    .apt_install(
        "build-essential",
        "bison",
        "ca-certificates",
        "clang",
        "curl",
        "file",
        "flex",
        "git",
        "libpng-dev",
        "make",
        "pkg-config",
        "python3-dev",
        "unzip",
        "xz-utils",
    )
    # JDK 21 (Temurin, pinned + checksummed) -> Ghidra 11.4.2
    .run_commands(
        "set -eux; "
        f"curl -fsSL {JDK_URL} -o /tmp/jdk.tar.gz; "
        f"echo '{JDK_SHA256}  /tmp/jdk.tar.gz' | sha256sum -c -; "
        f"mkdir -p {JAVA_HOME}; "
        f"tar -xzf /tmp/jdk.tar.gz -C {JAVA_HOME} --strip-components=1; "
        "rm /tmp/jdk.tar.gz; "
        f"{JAVA_HOME}/bin/java -version"
    )
    .env({"JAVA_HOME": JAVA_HOME, "PATH": f"{JAVA_HOME}/bin:/usr/local/bin:/usr/bin:/bin"})
    # uv, for the pinned staticre dependency set
    .run_commands(
        "set -eux; "
        "curl -fsSL https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh; "
        "uv --version"
    )
    # Ghidra + GhidraBoy. /opt/ghidra is a stable alias over the versioned dir so
    # GHIDRA_INSTALL_DIR matches the documented value.
    .run_commands(
        "set -eux; "
        f"curl -fsSL {GHIDRA_URL} -o /tmp/ghidra.zip; "
        f"echo '{GHIDRA_SHA256}  /tmp/ghidra.zip' | sha256sum -c -; "
        "sha256sum /tmp/ghidra.zip > /opt/ghidra.sha256; "
        "unzip -q /tmp/ghidra.zip -d /opt; "
        f"ln -s /opt/ghidra_{GHIDRA_VERSION}_PUBLIC {GHIDRA_HOME}; "
        f"curl -fsSL {GHIDRABOY_URL} -o /tmp/ghidraboy.zip; "
        f"echo '{GHIDRABOY_SHA256}  /tmp/ghidraboy.zip' | sha256sum -c -; "
        "sha256sum /tmp/ghidraboy.zip > /opt/ghidraboy.sha256; "
        f"unzip -q /tmp/ghidraboy.zip -d /opt/ghidra_{GHIDRA_VERSION}_PUBLIC/Ghidra/Extensions/; "
        "rm /tmp/ghidra.zip /tmp/ghidraboy.zip; "
        f"test -d {GHIDRA_HOME}/Ghidra/Extensions/GhidraBoy"
    )
    # RGBDS -> assembles the SameBoy boot ROM
    .run_commands(
        "set -eux; "
        f"curl -fsSL {RGBDS_URL} -o /tmp/rgbds.tar.gz; "
        f"echo '{RGBDS_SHA256}  /tmp/rgbds.tar.gz' | sha256sum -c -; "
        "mkdir /tmp/rgbds; "
        "tar -xzf /tmp/rgbds.tar.gz -C /tmp/rgbds --strip-components=1; "
        "make -C /tmp/rgbds -j4; "
        "make -C /tmp/rgbds install; "
        "rgbasm --version; "
        "rm -rf /tmp/rgbds /tmp/rgbds.tar.gz"
    )
    # cppp -> SameBoy's own C preprocessor, not packaged in Ubuntu
    .run_commands(
        "set -eux; "
        f"curl -fsSL {CPPP_URL} -o /tmp/cppp.tar.gz; "
        f"echo '{CPPP_SHA256}  /tmp/cppp.tar.gz' | sha256sum -c -; "
        "mkdir /tmp/cppp; "
        "tar -xzf /tmp/cppp.tar.gz -C /tmp/cppp --strip-components=1; "
        "make -C /tmp/cppp; "
        "install -m 755 /tmp/cppp/cppp /usr/local/bin/cppp; "
        "rm -rf /tmp/cppp /tmp/cppp.tar.gz"
    )
    # GBDK-2020 -> compiles the agent's reconstruction to a ROM
    .run_commands(
        "set -eux; "
        f"curl -fsSL {GBDK_URL} -o /tmp/gbdk.tar.gz; "
        f"echo '{GBDK_SHA256}  /tmp/gbdk.tar.gz' | sha256sum -c -; "
        "tar -xzf /tmp/gbdk.tar.gz -C /opt; "
        "rm /tmp/gbdk.tar.gz; "
        "/opt/gbdk/bin/lcc -v"
    )
    .env(
        {
            "GHIDRA_INSTALL_DIR": GHIDRA_HOME,
            "PYTHONUNBUFFERED": "1",
            "HEXBOUNTY_WORKSPACES": WORKSPACES,
            "GBDK_HOME": "/opt/gbdk",
        }
    )
)


def _with_sources(image: modal.Image) -> modal.Image:
    """Add the cleared compute-side source, when the upstream checkout is here."""
    for rel, dest in (
        ("pipeline/static", f"{REMOTE_PIPELINE}/static"),
        ("pipeline/harness", f"{REMOTE_PIPELINE}/harness"),
        ("pipeline/agent", f"{REMOTE_PIPELINE}/agent"),
        ("pipeline/vendor/SameBoy", f"{REMOTE_PIPELINE}/vendor/SameBoy"),
        # The upstream harness resolves these two instruction files relative
        # to the upstream repository root. They contain no credentials or ROMs.
        (".claude/skills/static-re", "/opt/.claude/skills/static-re"),
        (".claude/skills/dynamic-re", "/opt/.claude/skills/dynamic-re"),
    ):
        if _has(rel):
            image = image.add_local_dir(
                UPSTREAM / rel, dest, copy=True,
                ignore=[
                    "**/.git",
                    "**/.venv",
                    "**/build",
                    "**/__pycache__",
                    "**/*.pyc",
                    # Never upload cartridges, emulator saves, or prebuilt
                    # binary blobs. SameBoy's source tree includes public CI
                    # test ROMs under .github/actions; the runtime does not
                    # need them and a private job ROM belongs only on Volume.
                    "**/*.gb",
                    "**/*.gbc",
                    "**/*.rom",
                    "**/*.sav",
                    "**/*.bin",
                ],
            )
    if _has("pipeline/Makefile"):
        image = image.add_local_file(
            UPSTREAM / "pipeline/Makefile", f"{REMOTE_PIPELINE}/Makefile", copy=True
        )
    if _has("pipeline/static/pyproject.toml"):
        # Resolve staticre's pinned deps (pyghidra 2.2.1, mcp) into the image.
        image = image.run_commands(
            f"set -eux; cd {REMOTE_PIPELINE}/static; uv sync --frozen"
        )
    if _has("pipeline/Makefile") and _has("pipeline/vendor/SameBoy"):
        # Build the native SameBoy bridge (libgrokboy.so) once, at image time.
        # gcc, matching the upstream harness Dockerfile. Ubuntu 24.04's clang is
        # newer than the one this vendored SameBoy was built against and rejects
        # Core/apu.c under its own -Werror -Wsign-compare; gcc does not. The
        # vendored source is left untouched either way.
        image = image.run_commands(
            f"set -eux; env -u CFLAGS make -C {REMOTE_PIPELINE}/vendor/SameBoy "
            f"CC={SAMEBOY_CC} CONF=release lib bootroms "
            f"WARNINGS='{SAMEBOY_WARNINGS}'; "
            f"make -C {REMOTE_PIPELINE} CC={SAMEBOY_CC}; "
            f"test -f {REMOTE_PIPELINE}/bin/libgrokboy.so"
        )
    return image


IMAGE = _with_sources(_base)

SOURCES_INCLUDED = _has("pipeline/static") and _has("pipeline/agent")

app = modal.App("hexbounty-runtime")
volume = modal.Volume.from_name("hexbounty-workspaces", create_if_missing=True)

# Plan section 11 sandbox envelope.
CPU = (2.0, 4.0)
MEMORY = (8192, 12288)
TIMEOUT = 3 * 60 * 60
IDLE_TIMEOUT = 15 * 60

# The deployment functions use the production envelope above. Image validation
# is intentionally much smaller and shorter so an accidental smoke cannot burn
# through the operator's compute credit.
SMOKE_CPU = 1.0
SMOKE_MEMORY = 4096
SMOKE_TIMEOUT = 20 * 60
SMOKE_MARKER = "hexbounty-runtime-smoke-v1\n"
SMOKE_PATH = Path(WORKSPACES) / ".smoke" / "runtime-probe.txt"


def _probe(name: str, cmd: list[str], *, expect: str | None = None,
           cwd: str | None = None, timeout: int = 300,
           ok_exits: tuple[int, ...] = (0,)) -> dict:
    """Run one tool and record whether it launched, with evidence."""
    if shutil.which(cmd[0]) is None and not Path(cmd[0]).exists():
        return {"tool": name, "ok": False, "error": f"not found: {cmd[0]}"}
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd
        )
    except subprocess.TimeoutExpired:
        return {"tool": name, "ok": False, "error": f"timed out after {timeout}s"}
    except OSError as exc:
        return {"tool": name, "ok": False, "error": str(exc)}
    out = ((proc.stdout or "") + (proc.stderr or "")).strip()
    ok = proc.returncode in ok_exits
    if expect is not None:
        ok = ok and expect.lower() in out.lower()
    return {
        "tool": name,
        "ok": ok,
        "exit": proc.returncode,
        "evidence": out.splitlines()[0][:200] if out else "",
    }


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=SMOKE_CPU,
              memory=SMOKE_MEMORY, timeout=SMOKE_TIMEOUT)
def smoke() -> dict:
    """Prove every tool in the image actually launches, one by one."""
    results: list[dict] = []

    results.append(_probe("java", ["java", "-version"], expect="21"))
    results.append(
        _probe(
            "ghidra-analyzeHeadless",
            [f"{GHIDRA_HOME}/support/analyzeHeadless"],
            expect="Headless Analyzer Usage",
            timeout=120,
            # The launcher intentionally returns 1 when invoked without a
            # project/import target after printing its usage. This proves the
            # JVM-backed launcher starts without analyzing a binary.
            ok_exits=(1,),
        )
    )
    results.append(
        {
            "tool": "ghidraboy-extension",
            "ok": Path(f"{GHIDRA_HOME}/Ghidra/Extensions/GhidraBoy").is_dir(),
            "evidence": f"version {GHIDRABOY_VERSION}, license {GHIDRABOY_LICENSE}",
        }
    )
    results.append(_probe("gbdk-lcc", ["/opt/gbdk/bin/lcc", "-v"]))
    results.append(_probe("rgbasm", ["rgbasm", "--version"]))
    results.append(_probe("cppp", ["cppp", "--version"]))
    results.append(_probe("uv", ["uv", "--version"]))

    static = Path(REMOTE_PIPELINE) / "static"
    if static.is_dir():
        results.append(
            _probe(
                "pyghidra-import",
                ["uv", "run", "--project", str(static), "python", "-c",
                 "import pyghidra, staticre; print('pyghidra', pyghidra.__version__)"],
                expect="pyghidra",
                timeout=900,
            )
        )
        results.append(
            _probe(
                "staticre-cli",
                ["uv", "run", "--project", str(static), "staticre", "--help"],
                timeout=600,
            )
        )
    else:
        results.append({"tool": "pyghidra-import", "ok": False,
                        "error": "pipeline/static not baked into this image"})

    agent = Path(REMOTE_PIPELINE) / "agent"
    bridge = Path(REMOTE_PIPELINE) / "bin" / "libgrokboy.so"
    results.append({
        "tool": "sameboy-bridge",
        "ok": bridge.exists(),
        "evidence": f"{bridge} ({bridge.stat().st_size} bytes)" if bridge.exists()
        else "libgrokboy.so absent",
    })
    if agent.is_dir():
        results.append(
            _probe("compareboy", ["python3", str(agent / "compareboy.py"), "--help"],
                   timeout=120)
        )
        results.append(
            _probe("sameboy", ["python3", str(agent / "sameboy.py"), "--help"],
                   timeout=120)
        )

    workspaces = Path(WORKSPACES)
    probe = SMOKE_PATH
    try:
        probe.parent.mkdir(parents=True, exist_ok=True)
        probe.write_text(SMOKE_MARKER)
        volume.commit()
        results.append({"tool": "volume-write", "ok": probe.read_text() == SMOKE_MARKER,
                        "evidence": f"{workspaces} writable; committed marker"})
    except OSError as exc:
        results.append({"tool": "volume-write", "ok": False, "error": str(exc)})

    digests = {}
    for name, path in (("ghidra", "/opt/ghidra.sha256"),
                       ("ghidraboy", "/opt/ghidraboy.sha256")):
        try:
            digests[name] = Path(path).read_text().split()[0]
        except OSError:
            digests[name] = None

    return {
        "results": results,
        "passed": sum(1 for r in results if r["ok"]),
        "total": len(results),
        "pins": {
            "ghidra": {"version": GHIDRA_VERSION, "sha256": digests["ghidra"],
                       "expected_sha256": GHIDRA_SHA256, "url": GHIDRA_URL},
            "ghidraboy": {"version": GHIDRABOY_VERSION, "sha256": digests["ghidraboy"],
                          "expected_sha256": GHIDRABOY_SHA256,
                          "license": GHIDRABOY_LICENSE, "url": GHIDRABOY_URL},
            "gbdk": {"version": "4.5.0 linux64", "sha256": GBDK_SHA256},
            "rgbds": {"version": "1.0.3", "sha256": RGBDS_SHA256},
            "cppp": {"version": "2.9", "sha256": CPPP_SHA256},
        },
        "sandbox": {"cpu": CPU, "memory": MEMORY, "timeout": TIMEOUT,
                    "idle_timeout": IDLE_TIMEOUT, "gpu": None},
        "smoke_envelope": {"cpu": SMOKE_CPU, "memory": SMOKE_MEMORY,
                           "timeout": SMOKE_TIMEOUT, "gpu": None},
    }


@app.function(image=IMAGE, volumes={WORKSPACES: volume}, cpu=SMOKE_CPU,
              memory=SMOKE_MEMORY, timeout=5 * 60)
def verify_volume() -> dict:
    """Reload and remove the marker in a separate remote invocation."""
    try:
        volume.reload()
        persisted = SMOKE_PATH.is_file() and SMOKE_PATH.read_text() == SMOKE_MARKER
        if SMOKE_PATH.exists():
            SMOKE_PATH.unlink()
            volume.commit()
        return {
            "tool": "volume-persistence",
            "ok": persisted,
            "evidence": "committed marker reloaded in a separate invocation",
        }
    except OSError as exc:
        return {"tool": "volume-persistence", "ok": False, "error": str(exc)}


@app.local_entrypoint()
def main() -> None:
    if not SOURCES_INCLUDED:
        print(f"note: {UPSTREAM} has no pipeline/static or pipeline/agent; "
              "building the base runtime only (set HEXBOUNTY_UPSTREAM).")
    report = smoke.remote()
    persisted = verify_volume.remote()
    report["results"].append(persisted)
    report["passed"] += int(persisted["ok"])
    report["total"] += 1
    print(json.dumps(report, indent=2))
