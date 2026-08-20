#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { EvidenceValidationError, hashEvidence, parseEvidenceJsonStrict } from "./canonical.js";

async function main(): Promise<number> {
  const { positionals } = parseArgs({ allowPositionals: true });
  if (positionals.length !== 2 || positionals[0] !== "hash") {
    console.error("usage: hexbounty-evidence-js hash <file>");
    return 2;
  }
  try {
    const text = await readFile(positionals[1], "utf8");
    const result = hashEvidence(parseEvidenceJsonStrict(text));
    console.log(result.canonical);
    console.log(result.hash);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    return error instanceof EvidenceValidationError || error instanceof SyntaxError ? 2 : 1;
  }
}

process.exitCode = await main();
