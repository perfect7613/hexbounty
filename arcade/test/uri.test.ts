import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import {
  isAbsoluteDiscoveryUri,
  isHttpUrl,
  isMetadataUri,
  parsePositiveMon,
} from "../lib/bounties";

describe("URI policy", () => {
  it("accepts metadata http(s), ipfs, arweave, and root-relative paths", () => {
    expect(isMetadataUri("https://example.com/evidence.json")).toBe(true);
    expect(isMetadataUri("http://localhost:3000/evidence.json")).toBe(true);
    expect(isMetadataUri("ipfs://bafyexample")).toBe(true);
    expect(isMetadataUri("ar://txid")).toBe(true);
    expect(isMetadataUri("arweave://txid")).toBe(true);
    expect(isMetadataUri("/games/sample/metadata.json")).toBe(true);
  });

  it("rejects empty, slash-only, and unsafe metadata URIs", () => {
    expect(isMetadataUri("")).toBe(false);
    expect(isMetadataUri(" / ")).toBe(false);
    expect(isMetadataUri("/")).toBe(false);
    expect(isMetadataUri("javascript:alert(1)")).toBe(false);
    expect(isMetadataUri("data:text/html,hi")).toBe(false);
    expect(isMetadataUri("ftp://example.com/file")).toBe(false);
    expect(isMetadataUri("not a url")).toBe(false);
  });

  it("requires live URLs to be http or https", () => {
    expect(isHttpUrl("https://play.example/game")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:8080/")).toBe(true);
    expect(isHttpUrl("/games/sample")).toBe(false);
    expect(isHttpUrl("ipfs://bafyexample")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  it("treats http(s)/ipfs/ar as absolute discovery URIs", () => {
    expect(isAbsoluteDiscoveryUri("https://example.com/report")).toBe(true);
    expect(isAbsoluteDiscoveryUri("ipfs://bafyexample")).toBe(true);
    expect(isAbsoluteDiscoveryUri("/games/sample/metadata.json")).toBe(false);
  });
});

describe("parsePositiveMon", () => {
  it("parses a positive testnet MON amount", () => {
    expect(parsePositiveMon("0.05")).toEqual({ amount: parseEther("0.05") });
  });

  it("rejects zero, negative, oversized, and unparsable amounts", () => {
    expect(parsePositiveMon("0")).toEqual({ error: "Must be a positive amount of testnet MON." });
    expect(parsePositiveMon("-1")).toEqual({ error: "Must be a positive amount of testnet MON." });
    expect(parsePositiveMon("not-a-number")).toEqual({ error: "Must be a valid MON amount." });
    expect(parsePositiveMon("79228162515")).toEqual({ error: "Amount exceeds uint96." });
  });
});
