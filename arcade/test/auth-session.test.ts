import { getAddress } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { seal, unseal, validateNoncePayload, validateSessionPayload, validateSiweRequestBinding } =
  await import("../lib/auth/session");

const SECRET = "abcdefghijklmnopqrstuvwxyz012345";

describe("sealed cookies", () => {
  it("round-trips a nonce payload", async () => {
    const payload = { v: 1 as const, nonce: generateSiweNonce(), exp: Math.floor(Date.now() / 1000) + 60 };
    const token = await seal(payload, SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await unseal(token, SECRET)).toEqual(payload);
  });

  it("rejects a tampered payload", async () => {
    const payload = { v: 1 as const, nonce: "n".repeat(16), exp: Math.floor(Date.now() / 1000) + 60 };
    const token = await seal(payload, SECRET);
    const [body, mac] = token.split(".");
    const raw = Buffer.from(body!, "base64url");
    raw[0] = raw[0]! ^ 0xff;
    const tampered = `${raw.toString("base64url").replace(/=+$/g, "")}.${mac}`;
    expect(await unseal(tampered, SECRET)).toBeNull();
  });

  it("rejects a tampered mac", async () => {
    const token = await seal({ v: 1, nonce: "n".repeat(16), exp: 9_999_999_999 }, SECRET);
    const [body, mac] = token.split(".");
    const flipped = mac!.endsWith("A") ? `${mac!.slice(0, -1)}B` : `${mac!.slice(0, -1)}A`;
    expect(await unseal(`${body}.${flipped}`, SECRET)).toBeNull();
  });

  it("rejects the wrong secret", async () => {
    const token = await seal({ v: 1, nonce: "n".repeat(16), exp: 9_999_999_999 }, SECRET);
    expect(await unseal(token, `${SECRET}xxxx`)).toBeNull();
  });
});

describe("expiry validation", () => {
  it("rejects an expired nonce", () => {
    expect(validateNoncePayload({ v: 1, nonce: "n".repeat(16), exp: 100 }, 100)).toBeNull();
    expect(validateNoncePayload({ v: 1, nonce: "n".repeat(16), exp: 99 }, 100)).toBeNull();
  });

  it("accepts a live nonce", () => {
    expect(validateNoncePayload({ v: 1, nonce: "n".repeat(16), exp: 101 }, 100)).toEqual({
      v: 1,
      nonce: "n".repeat(16),
      exp: 101,
    });
  });

  it("rejects an expired or not-yet-issued session", () => {
    const address = getAddress("0x0000000000000000000000000000000000000001");
    expect(
      validateSessionPayload({ v: 1, address, chainId: 10143, iat: 90, exp: 100 }, 100),
    ).toBeNull();
    expect(
      validateSessionPayload({ v: 1, address, chainId: 10143, iat: 101, exp: 200 }, 100),
    ).toBeNull();
  });

  it("rejects a session on the wrong chain", () => {
    const address = getAddress("0x0000000000000000000000000000000000000001");
    expect(
      validateSessionPayload({ v: 1, address, chainId: 1, iat: 90, exp: 200 }, 100),
    ).toBeNull();
  });

  it("checksums a live session address", () => {
    const address = "0x0000000000000000000000000000000000000001";
    expect(
      validateSessionPayload({ v: 1, address, chainId: 10143, iat: 90, exp: 200 }, 100),
    ).toEqual({
      v: 1,
      address: getAddress(address),
      chainId: 10143,
      iat: 90,
      exp: 200,
    });
  });
});

describe("SIWE request binding", () => {
  const nonce = "abcdefghijklmnopqrstuvwxyz12";
  const address = getAddress("0xa0cf798816d4b9b9866b5330eea46a18382f251e");
  const issuedAt = new Date("2026-08-16T10:00:00.000Z");
  const now = issuedAt;
  const message = createSiweMessage({
    address,
    chainId: 10143,
    domain: "localhost:3000",
    nonce,
    uri: "http://localhost:3000",
    version: "1",
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 5 * 60 * 1000),
  });
  const fields = parseSiweMessage(message);

  function binding(overrides: Partial<Parameters<typeof validateSiweRequestBinding>[0]> = {}) {
    return validateSiweRequestBinding({
      fields,
      nonce,
      host: "localhost:3000",
      origin: "http://localhost:3000",
      time: now,
      ...overrides,
    });
  }

  function fieldsFrom(options: Parameters<typeof createSiweMessage>[0]) {
    return parseSiweMessage(createSiweMessage(options));
  }

  it("accepts matching host, origin, nonce, and chain 10143", () => {
    expect(binding()).toBe(true);
  });

  it("rejects a nonce mismatch", () => {
    expect(binding({ nonce: "zzzzzzzzzzzzzzzzzzzzzzzzzzzz" })).toBe(false);
  });

  it("rejects a host/domain mismatch", () => {
    expect(binding({ host: "evil.example" })).toBe(false);
  });

  it("rejects an origin/uri mismatch", () => {
    expect(binding({ origin: "https://evil.example" })).toBe(false);
  });

  it("rejects a missing expirationTime", () => {
    expect(
      binding({
        fields: fieldsFrom({
          address,
          chainId: 10143,
          domain: "localhost:3000",
          nonce,
          uri: "http://localhost:3000",
          version: "1",
          issuedAt,
        }),
      }),
    ).toBe(false);
  });

  it("rejects issuedAt more than 60 seconds in the future", () => {
    expect(
      binding({
        fields: fieldsFrom({
          address,
          chainId: 10143,
          domain: "localhost:3000",
          nonce,
          uri: "http://localhost:3000",
          version: "1",
          issuedAt: new Date(issuedAt.getTime() + 61_000),
          expirationTime: new Date(issuedAt.getTime() + 61_000 + 5 * 60 * 1000),
        }),
      }),
    ).toBe(false);
  });

  it("accepts issuedAt up to 60 seconds in the future", () => {
    expect(
      binding({
        fields: fieldsFrom({
          address,
          chainId: 10143,
          domain: "localhost:3000",
          nonce,
          uri: "http://localhost:3000",
          version: "1",
          issuedAt: new Date(issuedAt.getTime() + 60_000),
          expirationTime: new Date(issuedAt.getTime() + 60_000 + 5 * 60 * 1000),
        }),
      }),
    ).toBe(true);
  });

  it("rejects expirationTime at or before issuedAt", () => {
    expect(
      binding({
        fields: fieldsFrom({
          address,
          chainId: 10143,
          domain: "localhost:3000",
          nonce,
          uri: "http://localhost:3000",
          version: "1",
          issuedAt,
          expirationTime: issuedAt,
        }),
      }),
    ).toBe(false);
  });

  it("rejects expirationTime more than 10 minutes after issuedAt", () => {
    expect(
      binding({
        fields: fieldsFrom({
          address,
          chainId: 10143,
          domain: "localhost:3000",
          nonce,
          uri: "http://localhost:3000",
          version: "1",
          issuedAt,
          expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1000 + 1),
        }),
      }),
    ).toBe(false);
  });

  it("accepts expirationTime exactly 10 minutes after issuedAt", () => {
    expect(
      binding({
        fields: fieldsFrom({
          address,
          chainId: 10143,
          domain: "localhost:3000",
          nonce,
          uri: "http://localhost:3000",
          version: "1",
          issuedAt,
          expirationTime: new Date(issuedAt.getTime() + 10 * 60 * 1000),
        }),
      }),
    ).toBe(true);
  });

  it("rejects a current time at or after expirationTime", () => {
    expect(binding({ time: new Date(issuedAt.getTime() + 5 * 60 * 1000) })).toBe(false);
  });
});

describe("secret gate", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("fails closed when AUTH_SESSION_SECRET is missing or short", async () => {
    vi.stubEnv("AUTH_SESSION_SECRET", "short");
    const { readAuthSessionSecret } = await import("../lib/auth/session");
    expect(readAuthSessionSecret({ AUTH_SESSION_SECRET: "short" })).toBeNull();
    expect(readAuthSessionSecret({})).toBeNull();
    expect(readAuthSessionSecret({ AUTH_SESSION_SECRET: SECRET })).toBe(SECRET);
    vi.unstubAllEnvs();
  });
});
