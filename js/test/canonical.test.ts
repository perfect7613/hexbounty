import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { keccak256 } from "viem";

import {
  EvidenceValidationError,
  canonicalizeJson,
  hashEvidence,
  parseEvidenceJsonStrict,
  parseJsonStrict,
  validateEvidence,
} from "../src/canonical.js";

function validDocument(): Record<string, any> {
  return {
    schema: "hexbounty-evidence/v1",
    programId: "program-abc",
    sourceCommit: "abc123",
    binarySha256: "binary",
    sourceSha256: "source",
    artifactSha256: "artifact",
    tools: ["Ghidra", "PyGhidra", "SameBoy", "CompareBoy", "GBDK"],
    agent: {
      orchestrator: "codex-modal",
      engine: "codex",
      runIdHash: `0x${"12".repeat(32)}`,
      passes: 2,
      status: "complete",
    },
    staticAnalysis: { functionCount: 0, annotatedFunctions: 0, evidenceRecords: 0 },
    dynamicComparison: {
      script: "demo-script",
      framesCompared: 0,
      firstDivergence: null,
      summary: "Behavioral comparison, not formal equivalence",
    },
    artifacts: {
      liveURL: "https://example.test/live",
      sourceURL: "https://example.test/source",
      reportURL: "https://example.test/report",
    },
  };
}

describe("Keccak-256", () => {
  it("uses original Keccak padding rather than NIST SHA3-256", () => {
    const originalKeccak = keccak256(new Uint8Array());
    const nistSha3 = `0x${createHash("sha3-256").update(new Uint8Array()).digest("hex")}`;
    expect(originalKeccak).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    expect(nistSha3).toBe("0xa7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a");
    expect(originalKeccak).not.toBe(nistSha3);
  });
});

describe("sorted-key JSON", () => {
  it("sorts object keys and preserves arrays", () => {
    expect(canonicalizeJson({ z: 1, a: 2, array: [3, 2, 1] })).toBe(
      '{"a":2,"array":[3,2,1],"z":1}',
    );
  });

  it("rejects duplicate object names before JSON.parse can discard them", () => {
    expect(() => parseJsonStrict('{"value":1,"value":2}')).toThrow(/duplicate object member name/);
  });

  it.each(["0.0", "0e0", "1E+0"])("preserves the evidence integer/float boundary for %s", (token) => {
    expect(() => parseEvidenceJsonStrict(`{"counter":${token}}`)).toThrow(/decimal or exponent spelling/);
  });
});

describe("evidence validation", () => {
  it("preserves the required null", () => {
    const result = hashEvidence(validDocument());
    expect(result.canonical).toContain('"firstDivergence":null');
    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it.each([
    ["tool order", (document: Record<string, any>) => document.tools.reverse(), "exact order"],
    ["missing first divergence", (document: Record<string, any>) => delete document.dynamicComparison.firstDivergence, "missing required"],
    ["float counter", (document: Record<string, any>) => (document.dynamicComparison.framesCompared = 0.5), "safe integer"],
    ["undefined", (document: Record<string, any>) => (document.dynamicComparison.firstDivergence = undefined), "unsupported value"],
    ["raw run ID", (document: Record<string, any>) => (document.agent.runIdHash = "scratch-21"), "never a raw run identifier"],
  ])("rejects %s", (_label, mutate, message) => {
    const document = validDocument();
    mutate(document);
    expect(() => validateEvidence(document)).toThrowError(new RegExp(message));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects non-finite %s", (value) => {
    const document = validDocument();
    document.dynamicComparison.framesCompared = value;
    expect(() => hashEvidence(document)).toThrow(EvidenceValidationError);
  });
});
