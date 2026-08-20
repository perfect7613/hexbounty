# examples/licensed-demo

Checked-in demo material, so the frontend and the evidence verification path can
be exercised **without** installing Ghidra or running a reconstruction.

## Contents

| Path | What it is |
|---|---|
| `evidence/evidence.sample.json` | A synthetic `hexbounty-evidence/v1` document. Field values are illustrative; its hash is real and reproducible. |

## Reproducing the sample hash

```bash
python3 -m pip install -r ../../tools/requirements.txt
python3 ../../tools/evidence_hash.py evidence/evidence.sample.json
```

```
canonical_bytes 962
sha256          0x2250ff4499917a2fee6d4b684d19405cddcf77e0ca4ff00e751d2442f5ba08e7
keccak256       0x02e6878da13647be3ab8f4c86971b36ab720f3b9dec41dd86ac4c97c2dcf6fe4
```

The `keccak256` value is the commitment produced by the shared canonicalization
helpers.

## What may live here

**Yes:** evidence documents, reconstruction reports, differential-evaluation
output, comparison screenshots, and build logs — HexBounty's own output, ours to
publish.

**No:** any ROM, firmware image, or reference binary whose licensing has not been
established. `.gitignore` blocks `*.gb`, `*.gbc`, `*.rom`, and `*.bin` for that
reason. Keep the evidence *about* a binary; do not commit the binary. If a
licensed artifact is ever added, record its source and terms in the same commit
and unignore it deliberately.

## Fixture status

This synthetic document remains a small, deterministic test vector. Production
game inputs and reconstructed outputs stay in private storage and are not
checked into this example directory.
