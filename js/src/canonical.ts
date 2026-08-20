import canonicalize from "canonicalize";
import { keccak256, toBytes } from "viem";

export const SCHEMA = "hexbounty-evidence/v1" as const;
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
export const TOOLS = ["Ghidra", "PyGhidra", "SameBoy", "CompareBoy", "GBDK"] as const;

const ROOT_KEYS = [
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
] as const;
const AGENT_KEYS = ["orchestrator", "engine", "runIdHash", "passes", "status"] as const;
const STATIC_KEYS = ["functionCount", "annotatedFunctions", "evidenceRecords"] as const;
const DYNAMIC_KEYS = ["script", "framesCompared", "firstDivergence", "summary"] as const;
const ARTIFACT_KEYS = ["liveURL", "sourceURL", "reportURL"] as const;
const RUN_HASH_RE = /^0x[0-9a-f]{64}$/;

export interface EvidenceDocument {
  schema: typeof SCHEMA;
  programId: string;
  sourceCommit: string;
  binarySha256: string;
  sourceSha256: string;
  artifactSha256: string;
  tools: typeof TOOLS | string[];
  agent: {
    orchestrator: "codex-modal";
    engine: string;
    runIdHash: string;
    passes: number;
    status: "complete";
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

export interface CanonicalEvidence {
  canonical: string;
  canonicalBytes: Uint8Array;
  hash: `0x${string}`;
}

export class EvidenceValidationError extends Error {
  override name = "EvidenceValidationError";
}

function fail(path: string, message: string): never {
  throw new EvidenceValidationError(`${path}: ${message}`);
}

function checkJsonModel(value: unknown, path = "$", ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "non-finite numbers are invalid JSON");
    return;
  }
  if (typeof value !== "object") {
    fail(path, `unsupported value of type ${typeof value}`);
  }
  if (ancestors.has(value)) fail(path, "cyclic values are not JSON");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) fail(`${path}[${index}]`, "sparse array elements are invalid JSON");
        checkJsonModel(value[index], `${path}[${index}]`, ancestors);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail(path, "must be a plain JSON object");
    }
    for (const [key, item] of Object.entries(value)) {
      checkJsonModel(item, `${path}.${key}`, ancestors);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") fail(path, "symbol object keys are invalid JSON");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && !descriptor.enumerable) {
        fail(`${path}.${key}`, "non-enumerable members are invalid JSON");
      }
    }
  } finally {
    ancestors.delete(value);
  }
}

function objectWithKeys(value: unknown, path: string, expected: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path, "must be an object");
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object);
  const missing = expected.filter((key) => !Object.hasOwn(object, key)).sort();
  const unknown = actual.filter((key) => !expected.includes(key)).sort();
  if (missing.length > 0) fail(path, `missing required member(s): ${missing.join(", ")}`);
  if (unknown.length > 0) fail(path, `unknown member(s): ${unknown.join(", ")}`);
  return object;
}

function stringValue(
  value: unknown,
  path: string,
  options: { exact?: string; nonempty?: boolean } = {},
): string {
  if (typeof value !== "string") fail(path, "must be a string");
  if (options.exact !== undefined && value !== options.exact) fail(path, `must equal ${JSON.stringify(options.exact)}`);
  if ((options.nonempty ?? true) && value.length === 0) fail(path, "must not be empty");
  return value;
}

function counter(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(path, "must be a safe integer (floats and booleans are invalid)");
  }
  if (value < 0) fail(path, `must be between 0 and ${MAX_SAFE_INTEGER}`);
  return value;
}

/** Validate a parsed value against hexbounty-evidence/v1. */
export function validateEvidence(document: unknown): asserts document is EvidenceDocument {
  // This traversal is deliberately first: undefined must never reach a
  // JSON.stringify-based canonicalizer, where it would silently drop a key.
  checkJsonModel(document);
  const root = objectWithKeys(document, "$", ROOT_KEYS);

  stringValue(root.schema, "$.schema", { exact: SCHEMA });
  for (const key of ["programId", "sourceCommit", "binarySha256", "sourceSha256", "artifactSha256"] as const) {
    stringValue(root[key], `$.${key}`);
  }

  if (!Array.isArray(root.tools)) fail("$.tools", "must be an array");
  if (root.tools.length !== TOOLS.length || root.tools.some((tool, index) => tool !== TOOLS[index])) {
    fail("$.tools", `must equal ${JSON.stringify(TOOLS)} in this exact order`);
  }

  const agent = objectWithKeys(root.agent, "$.agent", AGENT_KEYS);
  stringValue(agent.orchestrator, "$.agent.orchestrator", { exact: "codex-modal" });
  stringValue(agent.engine, "$.agent.engine");
  const runHash = stringValue(agent.runIdHash, "$.agent.runIdHash");
  if (!RUN_HASH_RE.test(runHash)) {
    fail("$.agent.runIdHash", "must be a lowercase 0x-prefixed 32-byte hash, never a raw run identifier");
  }
  counter(agent.passes, "$.agent.passes");
  stringValue(agent.status, "$.agent.status", { exact: "complete" });

  const staticAnalysis = objectWithKeys(root.staticAnalysis, "$.staticAnalysis", STATIC_KEYS);
  for (const key of STATIC_KEYS) counter(staticAnalysis[key], `$.staticAnalysis.${key}`);

  const dynamicComparison = objectWithKeys(root.dynamicComparison, "$.dynamicComparison", DYNAMIC_KEYS);
  stringValue(dynamicComparison.script, "$.dynamicComparison.script");
  counter(dynamicComparison.framesCompared, "$.dynamicComparison.framesCompared");
  if (dynamicComparison.firstDivergence !== null) {
    counter(dynamicComparison.firstDivergence, "$.dynamicComparison.firstDivergence");
  }
  stringValue(dynamicComparison.summary, "$.dynamicComparison.summary", { nonempty: false });

  const artifacts = objectWithKeys(root.artifacts, "$.artifacts", ARTIFACT_KEYS);
  for (const key of ARTIFACT_KEYS) stringValue(artifacts[key], `$.artifacts.${key}`);
}

/** Serialize an arbitrary JSON data-model value with recursively sorted keys. */
export function canonicalizeJson(value: unknown): string {
  checkJsonModel(value);
  const result = canonicalize(value);
  if (result === undefined) fail("$", "canonicalizer produced no JSON output");
  return result;
}

export interface StrictJsonParseOptions {
  /** Reject decimal/exponent number spellings. Evidence v1 has integers only. */
  integersOnly?: boolean;
}

/** Parse JSON while rejecting duplicate object member names. */
export function parseJsonStrict(text: string, options: StrictJsonParseOptions = {}): unknown {
  let index = 0;

  const syntax = (message: string): never => {
    throw new EvidenceValidationError(`JSON syntax at offset ${index}: ${message}`);
  };
  const whitespace = (): void => {
    while (index < text.length && /[\t\n\r ]/.test(text[index])) index += 1;
  };
  const stringToken = (): string => {
    const start = index;
    if (text[index] !== '"') syntax("expected string");
    index += 1;
    while (index < text.length) {
      const character = text[index++];
      if (character === '"') {
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          syntax("invalid string escape");
        }
      }
      if (character === "\\") {
        if (index >= text.length) syntax("unterminated escape");
        index += 1;
      } else if (character.charCodeAt(0) <= 0x1f) {
        syntax("unescaped control character in string");
      }
    }
    return syntax("unterminated string");
  };
  const literalOrNumber = (): void => {
    const remainder = text.slice(index);
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(remainder);
    if (match === null) return syntax("invalid value");
    if (
      options.integersOnly === true &&
      !/^(?:true|false|null|-?(?:0|[1-9]\d*))$/.test(match[0])
    ) {
      syntax(`integer fields must not use a decimal or exponent spelling: ${match[0]}`);
    }
    index += match[0].length;
  };
  const value = (): void => {
    whitespace();
    if (text[index] === "{") {
      object();
    } else if (text[index] === "[") {
      array();
    } else if (text[index] === '"') {
      stringToken();
    } else {
      literalOrNumber();
    }
  };
  const object = (): void => {
    index += 1;
    whitespace();
    const keys = new Set<string>();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    while (true) {
      whitespace();
      const key = stringToken();
      if (keys.has(key)) syntax(`duplicate object member name ${JSON.stringify(key)}`);
      keys.add(key);
      whitespace();
      if (text[index] !== ":") syntax("expected ':' after object member name");
      index += 1;
      value();
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index] !== ",") syntax("expected ',' or '}'");
      index += 1;
    }
  };
  const array = (): void => {
    index += 1;
    whitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    while (true) {
      value();
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index] !== ",") syntax("expected ',' or ']'");
      index += 1;
    }
  };

  value();
  whitespace();
  if (index !== text.length) syntax("trailing content");
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new EvidenceValidationError(`JSON syntax: ${message}`);
  }
}

/** Parse raw v1 evidence without losing whether a JSON number was written as a float. */
export function parseEvidenceJsonStrict(text: string): unknown {
  return parseJsonStrict(text, { integersOnly: true });
}

/** Validate, deterministically serialize, UTF-8 encode, and original-Keccak hash. */
export function hashEvidence(document: unknown): CanonicalEvidence {
  validateEvidence(document);
  const canonical = canonicalizeJson(document);
  const canonicalBytes = toBytes(canonical);
  return { canonical, canonicalBytes, hash: keccak256(canonicalBytes) };
}
