# pipeline

The bounded reconstruction pipeline used by private Modal jobs. It defines the
static-analysis, emulator, build, and artifact-collection interfaces used by the
current GB/GBC workflow.

## Layout

| Directory | Responsibility |
|---|---|
| `static/` | Static-analysis evidence extraction via Ghidra/PyGhidra |
| `agent/` | Emulator control and behavioral differential evaluation |
| `harness/` | Bounded reconstruction interfaces executed by the fixed Modal runner |
| `runner/` | Stage execution and artifact collection |
| `jobs/` | Working directory for claimed jobs — gitignored, `.gitkeep` only |

## Interfaces

What HexBounty requires here is a small set of interfaces, not any particular
implementation of them:

1. **Static analysis** → function count, annotated functions, evidence records.
2. **Emulation** → drive a reference build under a deterministic input script.
3. **Differential evaluation** → compare reconstruction against reference frame
   by frame; report frames compared and first divergence, or `null`.
4. **Build** → produce the artifact and its sha256.

Each stage feeds the canonical evidence document shared by the TypeScript and
Python evidence helpers and committed onchain by its hash.

## Boundaries

Stages run in Modal and receive only the approved fixture and bounded operation.
Codex login state is mounted separately from a private auth Volume; the fixed
runner cannot read it. GitHub auth, Modal API tokens, explorer keys, and wallet
keys never reach this code path.

Tool distributions — Ghidra, GBDK, SameBoy — are installed into the runtime
image, never vendored into this repository.

## Language

Differential evaluation produces **behavioral evidence**, written up as a
**reconstruction report**. Not formal verification, not proof of equivalence.
This applies to code comments, log lines, and `summary` strings, not only prose.
