import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  hashEvidence,
  parseEvidenceJsonStrict,
} from "../src/canonical.js";

interface ExpectedSuccess {
  mode: "evidence";
  canonical: string;
  canonicalUtf8Hex: string;
  keccak256: `0x${string}`;
}

type Expected = ExpectedSuccess;

const vectors = resolve(import.meta.dirname, "../../vectors");
const names = readdirSync(vectors)
  .filter((name) => name.endsWith(".expected"))
  .map((name) => name.slice(0, -".expected".length))
  .sort();

function loadExpected(name: string): Expected {
  return JSON.parse(readFileSync(resolve(vectors, `${name}.expected`), "utf8")) as Expected;
}

describe(`shared language-neutral vectors (${names.length})`, () => {
  it.each(names)("%s", (name) => {
    const expected = loadExpected(name);
    const input = readFileSync(resolve(vectors, `${name}.json`), "utf8");

    const document = parseEvidenceJsonStrict(input);
    const result = hashEvidence(document);

    expect(result.canonical).toBe(expected.canonical);
    expect(Buffer.from(result.canonicalBytes).toString("hex")).toBe(expected.canonicalUtf8Hex);
    expect(result.hash).toBe(expected.keccak256);
  });

  it("makes reordered objects byte-for-byte identical", () => {
    expect(loadExpected("003-out-of-order")).toMatchObject({
      canonicalUtf8Hex: (loadExpected("002-full") as ExpectedSuccess).canonicalUtf8Hex,
      keccak256: (loadExpected("002-full") as ExpectedSuccess).keccak256,
    });
  });

  it("distinguishes null and non-null divergence", () => {
    expect((loadExpected("004-null-divergence") as ExpectedSuccess).keccak256).not.toBe(
      (loadExpected("005-nonnull-divergence") as ExpectedSuccess).keccak256,
    );
  });
});
