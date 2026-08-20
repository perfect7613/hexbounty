"""Validate, canonicalize, and hash HexBounty evidence documents."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Mapping, NoReturn, Union

import rfc8785
from eth_hash.auto import keccak

JSONValue = Union[None, bool, int, float, str, list["JSONValue"], Dict[str, "JSONValue"]]

SCHEMA = "hexbounty-evidence/v1"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
TOOLS = ["Ghidra", "PyGhidra", "SameBoy", "CompareBoy", "GBDK"]
RUN_HASH_RE = re.compile(r"^0x[0-9a-f]{64}$")

ROOT_KEYS = {
    "schema",
    "programId",
    "sourceCommit",
    "binarySha256",
    "sourceSha256",
    "artifactSha256",
    "tools",
    "agent",
    "staticAnalysis",
    "dynamicComparison",
    "artifacts",
}
AGENT_KEYS = {"orchestrator", "engine", "runIdHash", "passes", "status"}
STATIC_KEYS = {"functionCount", "annotatedFunctions", "evidenceRecords"}
DYNAMIC_KEYS = {"script", "framesCompared", "firstDivergence", "summary"}
ARTIFACT_KEYS = {"liveURL", "sourceURL", "reportURL"}


class EvidenceValidationError(ValueError):
    """Raised before hashing when a value violates the v1 evidence format."""


@dataclass(frozen=True)
class CanonicalEvidence:
    """The exact committed preimage and its Keccak-256 digest."""

    canonical: str
    canonical_bytes: bytes
    hash: str


def _fail(path: str, message: str) -> NoReturn:
    raise EvidenceValidationError(f"{path}: {message}")


def _check_json_model(value: Any, path: str = "$") -> None:
    """Reject Python values which are not in the JSON data model."""

    if value is None or type(value) in (bool, int, float, str):
        return
    if type(value) is list:
        for index, item in enumerate(value):
            _check_json_model(item, f"{path}[{index}]")
        return
    if type(value) is dict:
        for key, item in value.items():
            if type(key) is not str:
                _fail(path, "object member names must be strings")
            _check_json_model(item, f"{path}.{key}")
        return
    _fail(path, f"unsupported value of type {type(value).__name__}")


def _object(value: Any, path: str, keys: set[str]) -> Mapping[str, Any]:
    if type(value) is not dict:
        _fail(path, "must be an object")
    actual = set(value)
    missing = sorted(keys - actual)
    unknown = sorted(actual - keys)
    if missing:
        _fail(path, f"missing required member(s): {', '.join(missing)}")
    if unknown:
        _fail(path, f"unknown member(s): {', '.join(unknown)}")
    return value


def _string(value: Any, path: str, *, exact: str | None = None, nonempty: bool = True) -> str:
    if type(value) is not str:
        _fail(path, "must be a string")
    if exact is not None and value != exact:
        _fail(path, f"must equal {exact!r}")
    if nonempty and not value:
        _fail(path, "must not be empty")
    return value


def _counter(value: Any, path: str) -> int:
    # Explicit type equality rejects bool (an int subclass) and every float,
    # including values such as 0.0 that happen to be mathematically integral.
    if type(value) is not int:
        _fail(path, "must be an integer (floats and booleans are invalid)")
    if value < 0 or value > MAX_SAFE_INTEGER:
        _fail(path, f"must be between 0 and {MAX_SAFE_INTEGER}")
    return value


def validate_evidence(document: Any) -> None:
    """Validate a parsed value against ``hexbounty-evidence/v1``."""

    _check_json_model(document)
    root = _object(document, "$", ROOT_KEYS)

    _string(root["schema"], "$.schema", exact=SCHEMA)
    for key in ("programId", "sourceCommit", "binarySha256", "sourceSha256", "artifactSha256"):
        _string(root[key], f"$.{key}")

    tools = root["tools"]
    if type(tools) is not list:
        _fail("$.tools", "must be an array")
    if tools != TOOLS:
        _fail("$.tools", f"must equal {TOOLS!r} in this exact order")

    agent = _object(root["agent"], "$.agent", AGENT_KEYS)
    _string(agent["orchestrator"], "$.agent.orchestrator", exact="codex-modal")
    _string(agent["engine"], "$.agent.engine")
    run_hash = _string(agent["runIdHash"], "$.agent.runIdHash")
    if RUN_HASH_RE.fullmatch(run_hash) is None:
        _fail(
            "$.agent.runIdHash",
            "must be a lowercase 0x-prefixed 32-byte hash, never a raw run identifier",
        )
    _counter(agent["passes"], "$.agent.passes")
    _string(agent["status"], "$.agent.status", exact="complete")

    static = _object(root["staticAnalysis"], "$.staticAnalysis", STATIC_KEYS)
    for key in STATIC_KEYS:
        _counter(static[key], f"$.staticAnalysis.{key}")

    dynamic = _object(root["dynamicComparison"], "$.dynamicComparison", DYNAMIC_KEYS)
    _string(dynamic["script"], "$.dynamicComparison.script")
    _counter(dynamic["framesCompared"], "$.dynamicComparison.framesCompared")
    divergence = dynamic["firstDivergence"]
    if divergence is not None:
        _counter(divergence, "$.dynamicComparison.firstDivergence")
    _string(dynamic["summary"], "$.dynamicComparison.summary", nonempty=False)

    artifacts = _object(root["artifacts"], "$.artifacts", ARTIFACT_KEYS)
    for key in ARTIFACT_KEYS:
        _string(artifacts[key], f"$.artifacts.{key}")


def canonicalize_json(value: JSONValue) -> bytes:
    """Return deterministic sorted-key JSON as UTF-8 bytes."""

    _check_json_model(value)
    try:
        return rfc8785.dumps(value)
    except (rfc8785.CanonicalizationError, UnicodeError, ValueError) as exc:
        raise EvidenceValidationError(f"$: cannot canonicalize value: {exc}") from exc


def hash_evidence(document: Any) -> CanonicalEvidence:
    """Validate evidence, canonicalize it, and compute original Keccak-256."""

    validate_evidence(document)
    canonical_bytes = canonicalize_json(document)
    return CanonicalEvidence(
        canonical=canonical_bytes.decode("utf-8"),
        canonical_bytes=canonical_bytes,
        hash="0x" + keccak(canonical_bytes).hex(),
    )


def _reject_duplicate_pairs(pairs: Iterable[tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise EvidenceValidationError(f"$: duplicate object member name: {key!r}")
        result[key] = value
    return result


def load_json_strict(path: Union[str, Path]) -> JSONValue:
    """Parse JSON from *path*, rejecting duplicates and non-finite constants."""

    def reject_constant(token: str) -> NoReturn:
        raise EvidenceValidationError(f"$: non-finite JSON number is invalid: {token}")

    try:
        with Path(path).open("r", encoding="utf-8") as handle:
            return json.load(
                handle,
                object_pairs_hook=_reject_duplicate_pairs,
                parse_constant=reject_constant,
            )
    except EvidenceValidationError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise EvidenceValidationError(f"cannot read JSON from {path}: {exc}") from exc
