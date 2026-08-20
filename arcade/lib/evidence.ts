import canonicalize from "canonicalize";
import { keccak256, toBytes, type Hex } from "viem";
import { isBytes32 } from "./gas";

export const EVIDENCE_SCHEMA = "hexbounty-evidence/v1";
export const EVIDENCE_TOOLS = ["Ghidra", "PyGhidra", "SameBoy", "CompareBoy", "GBDK"] as const;

export interface EvidenceDocument {
  schema: typeof EVIDENCE_SCHEMA;
  programId: string;
  sourceCommit: string;
  binarySha256: string;
  sourceSha256: string;
  artifactSha256: string;
  tools: string[];
  agent: {
    orchestrator: string;
    engine: string;
    runIdHash: string;
    passes: number;
    status: string;
  };
  staticAnalysis: {
    functionCount: number;
    annotatedFunctions: number;
    evidenceRecords: number;
  };
  dynamicComparison: {
    script: string;
    framesCompared: number;
    firstDivergence: number | null;
    summary: string;
  };
  artifacts: {
    liveURL: string;
    sourceURL: string;
    reportURL: string;
  };
}

export function hashEvidenceDocument(document: unknown): Hex {
  const canonical = canonicalize(document);
  if (canonical === undefined) {
    throw new Error("Evidence document could not be canonicalized.");
  }
  return keccak256(toBytes(canonical));
}

export function omitFirstDivergence(document: EvidenceDocument): unknown {
  return {
    ...document,
    dynamicComparison: {
      script: document.dynamicComparison.script,
      framesCompared: document.dynamicComparison.framesCompared,
      summary: document.dynamicComparison.summary,
    },
  };
}

export function reorderTools(document: EvidenceDocument): EvidenceDocument {
  const [ghidra, pyghidra, ...rest] = document.tools;
  return { ...document, tools: [pyghidra, ghidra, ...rest] };
}

export function parseChainHashQuery(value: string | string[] | undefined): {
  hash: Hex | null;
  invalid: boolean;
} {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.trim() === "") {
    return { hash: null, invalid: false };
  }
  const trimmed = raw.trim();
  if (isBytes32(trimmed)) return { hash: trimmed, invalid: false };
  return { hash: null, invalid: true };
}
