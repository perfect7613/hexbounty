import hashlib

import pytest
from eth_hash.auto import keccak

from hexbounty_evidence import (
    EvidenceValidationError,
    canonicalize_json,
    hash_evidence,
    validate_evidence,
)


def valid_document():
    return {
        "schema": "hexbounty-evidence/v1",
        "programId": "program-abc",
        "sourceCommit": "abc123",
        "binarySha256": "binary",
        "sourceSha256": "source",
        "artifactSha256": "artifact",
        "tools": ["Ghidra", "PyGhidra", "SameBoy", "CompareBoy", "GBDK"],
        "agent": {
            "orchestrator": "codex-modal",
            "engine": "codex",
            "runIdHash": "0x" + "12" * 32,
            "passes": 2,
            "status": "complete",
        },
        "staticAnalysis": {
            "functionCount": 0,
            "annotatedFunctions": 0,
            "evidenceRecords": 0,
        },
        "dynamicComparison": {
            "script": "demo-script",
            "framesCompared": 0,
            "firstDivergence": None,
            "summary": "Behavioral comparison, not formal equivalence",
        },
        "artifacts": {
            "liveURL": "https://example.test/live",
            "sourceURL": "https://example.test/source",
            "reportURL": "https://example.test/report",
        },
    }


def test_hash_is_original_keccak_known_answer_not_nist_sha3():
    # The empty-input KAT catches the classic Keccak-vs-SHA3 padding mistake.
    assert keccak(b"").hex() == "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
    assert hashlib.sha3_256(b"").hexdigest() == "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a"
    assert keccak(b"").hex() != hashlib.sha3_256(b"").hexdigest()


def test_sorted_keys_and_array_preservation():
    value = {"z": 1, "a": 2, "array": [3, 2, 1]}
    assert canonicalize_json(value) == b'{"a":2,"array":[3,2,1],"z":1}'


def test_hash_evidence_preserves_required_null():
    result = hash_evidence(valid_document())
    assert '"firstDivergence":null' in result.canonical
    assert result.hash.startswith("0x") and len(result.hash) == 66


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda d: d["tools"].reverse(), "exact order"),
        (lambda d: d["dynamicComparison"].pop("firstDivergence"), "missing required"),
        (lambda d: d["dynamicComparison"].update(framesCompared=0.0), "must be an integer"),
        (lambda d: d["agent"].update(runIdHash="scratch-21"), "never a raw run identifier"),
        (lambda d: d["staticAnalysis"].update(functionCount=True), "must be an integer"),
    ],
)
def test_validation_traps(mutate, message):
    document = valid_document()
    mutate(document)
    with pytest.raises(EvidenceValidationError, match=message):
        validate_evidence(document)


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_values_are_rejected(value):
    document = valid_document()
    document["dynamicComparison"]["framesCompared"] = value
    with pytest.raises(EvidenceValidationError, match="must be an integer"):
        hash_evidence(document)
