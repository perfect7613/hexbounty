import json
from pathlib import Path

import pytest
from hexbounty_evidence import (
    hash_evidence,
    load_json_strict,
)

VECTORS = Path(__file__).resolve().parents[2] / "vectors"


def expected_files():
    return sorted(VECTORS.glob("*.expected"))


@pytest.mark.parametrize("expected_path", expected_files(), ids=lambda path: path.stem)
def test_shared_vector(expected_path):
    expected = json.loads(expected_path.read_text(encoding="utf-8"))
    input_path = expected_path.with_suffix(".json")

    document = load_json_strict(input_path)
    result = hash_evidence(document)
    canonical = result.canonical_bytes
    digest = result.hash

    assert canonical.decode("utf-8") == expected["canonical"]
    assert canonical.hex() == expected["canonicalUtf8Hex"]
    assert digest == expected["keccak256"]


def test_out_of_order_vector_has_identical_preimage_and_hash():
    full = json.loads((VECTORS / "002-full.expected").read_text())
    reordered = json.loads((VECTORS / "003-out-of-order.expected").read_text())
    assert reordered["canonicalUtf8Hex"] == full["canonicalUtf8Hex"]
    assert reordered["keccak256"] == full["keccak256"]


def test_null_and_nonnull_divergence_have_distinct_hashes():
    null = json.loads((VECTORS / "004-null-divergence.expected").read_text())
    nonnull = json.loads((VECTORS / "005-nonnull-divergence.expected").read_text())
    assert null["keccak256"] != nonnull["keccak256"]
