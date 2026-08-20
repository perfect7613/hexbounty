import { createHmac, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  JOB_ID_RE,
  MAX_SOURCE_BYTES,
  MIN_SOURCE_BYTES,
  canonicalSigningBytes,
  canonicalSigningMessage,
  computeSha256Hex,
  deriveJobId,
  hmacSha256Hex,
  normalizeModalBaseUrl,
  parseJobStatusPayload,
  romExtensionFromFilename,
  serializeSubmitBody,
  signatureHeaderValue,
  submitJob,
  validateSubmitJobInput,
} = await import("../lib/server/modal-jobs");

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VECTOR_OWNER = "0x1111111111111111111111111111111111111111";
const VECTOR_SLUG = "space-breakout";
const VECTOR_JOB_ID = "u-cf816d240c4d53b3bcf9516c8a2fd00e";
const SHA = "ab".repeat(32);

const validBody = {
  jobId: VECTOR_JOB_ID,
  owner: VECTOR_OWNER,
  sourceUrl: "https://example.com/game.gb",
  sourceSha256: SHA,
  sourceBytes: MIN_SOURCE_BYTES,
  extension: ".gb" as const,
  slug: VECTOR_SLUG,
  title: "Space Breakout",
  description: "A reconstructed Game Boy game.",
  priceMon: "0.01",
  rightsNote: "I am authorized to submit this binary.",
  rightsAttestedAt: "2026-08-16T11:15:00.000Z",
  bountyMon: "0.01",
  bountyTxHash: `0x${"12".repeat(32)}`,
  bountyId: "7",
  bountyDeadline: 1787483700,
  bountyMetadataURI: "https://arcade.example/api/games/space-breakout/metadata?creator=0x1111111111111111111111111111111111111111",
};

const encoder = new TextEncoder();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("serializeSubmitBody", () => {
  it("emits exact keys in order", () => {
    expect(serializeSubmitBody(validBody)).toBe(
      `{"jobId":"${VECTOR_JOB_ID}","owner":"${VECTOR_OWNER}","sourceUrl":"https://example.com/game.gb","sourceSha256":"${SHA}","sourceBytes":32768,"extension":".gb","slug":"${VECTOR_SLUG}","title":"Space Breakout","description":"A reconstructed Game Boy game.","priceMon":"0.01","rightsNote":"I am authorized to submit this binary.","rightsAttestedAt":"2026-08-16T11:15:00.000Z","bountyMon":"0.01","bountyTxHash":"0x${"12".repeat(32)}","bountyId":"7","bountyDeadline":1787483700,"bountyMetadataURI":"https://arcade.example/api/games/space-breakout/metadata?creator=0x1111111111111111111111111111111111111111"}`,
    );
    expect(Object.keys(JSON.parse(serializeSubmitBody(validBody)))).toEqual([
      "jobId",
      "owner",
      "sourceUrl",
      "sourceSha256",
      "sourceBytes",
      "extension",
      "slug",
      "title",
      "description",
      "priceMon",
      "rightsNote",
      "rightsAttestedAt",
      "bountyMon",
      "bountyTxHash",
      "bountyId",
      "bountyDeadline",
      "bountyMetadataURI",
    ]);
  });
});

describe("submitJob errors", () => {
  it("preserves a bounded Modal validation error instead of masking it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: "Game Boy header checksum is invalid" },
          { status: 400 },
        ),
      ),
    );

    await expect(
      submitJob(validBody, {
        HEXBOUNTY_MODAL_BASE_URL: "https://example.modal.run",
        HEXBOUNTY_MODAL_HMAC_SECRET: "a".repeat(32),
      }),
    ).rejects.toThrow("Game Boy header checksum is invalid");
  });
});

describe("canonical HMAC", () => {
  const timestamp = "1710000000";
  const nonce = "00112233445566778899aabbccddeeff";
  const secret = "unit-test-modal-hmac-secret";

  it("uses UTF-8 timestamp newline nonce newline METHOD newline path newline owner newline sha256(raw_body)", async () => {
    const rawBody = encoder.encode(serializeSubmitBody(validBody));
    const bodySha256Hex = await computeSha256Hex(rawBody);
    expect(bodySha256Hex).toBe(createHash("sha256").update(Buffer.from(rawBody)).digest("hex"));

    const message = canonicalSigningMessage({
      timestamp,
      nonce,
      method: "POST",
      path: "/v1/jobs",
      owner: VECTOR_OWNER,
      bodySha256Hex,
    });
    expect(message).toBe(
      `${timestamp}\n${nonce}\nPOST\n/v1/jobs\n${VECTOR_OWNER}\n${bodySha256Hex}`,
    );

    const bytes = canonicalSigningBytes(message);
    expect(Buffer.from(bytes).equals(Buffer.from(message, "utf8"))).toBe(true);

    const expected = createHmac("sha256", secret).update(Buffer.from(message, "utf8")).digest("hex");
    expect(await hmacSha256Hex(secret, bytes)).toBe(expected);
    expect(signatureHeaderValue(expected)).toBe(`sha256=${expected}`);
    expect(expected).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hashes an empty GET body as the empty SHA-256", async () => {
    const empty = new Uint8Array();
    expect(await computeSha256Hex(empty)).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    const message = canonicalSigningMessage({
      timestamp,
      nonce,
      method: "GET",
      path: `/v1/jobs/${VECTOR_JOB_ID}`,
      owner: VECTOR_OWNER,
      bodySha256Hex: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    });
    const expected = createHmac("sha256", secret).update(message, "utf8").digest("hex");
    expect(await hmacSha256Hex(secret, canonicalSigningBytes(message))).toBe(expected);
  });

  it("matches the RFC HMAC-SHA256 fox vector", async () => {
    expect(
      await hmacSha256Hex("key", encoder.encode("The quick brown fox jumps over the lazy dog")),
    ).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
});

describe("validateSubmitJobInput", () => {
  it("accepts a strict valid payload", () => {
    expect(validateSubmitJobInput(validBody)).toEqual(validBody);
    expect(
      validateSubmitJobInput({ ...validBody, extension: ".gbc", sourceBytes: MAX_SOURCE_BYTES }),
    ).toMatchObject({
      extension: ".gbc",
      sourceBytes: MAX_SOURCE_BYTES,
    });
  });

  it("rejects jobId that does not match the Modal user-job pattern", () => {
    for (const jobId of ["u-", "U-abc", "job-1", "u--abc", "u-abc-", "u-ABC", `u-${"a".repeat(63)}`]) {
      expect(() => validateSubmitJobInput({ ...validBody, jobId }), jobId).toThrow(/jobId/);
    }
  });

  it("rejects owner that is not lowercase 0x + 40 hex", () => {
    expect(() =>
      validateSubmitJobInput({ ...validBody, owner: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
    ).toThrow(/owner/);
    expect(() => validateSubmitJobInput({ ...validBody, owner: OWNER.slice(2) })).toThrow(/owner/);
  });

  it("rejects sourceSha256 that is not 64 lowercase hex", () => {
    expect(() => validateSubmitJobInput({ ...validBody, sourceSha256: SHA.toUpperCase() })).toThrow(
      /sourceSha256/,
    );
    expect(() => validateSubmitJobInput({ ...validBody, sourceSha256: `0x${SHA}` })).toThrow(
      /sourceSha256/,
    );
  });

  it("rejects sourceBytes outside 32768..8388608", () => {
    expect(() => validateSubmitJobInput({ ...validBody, sourceBytes: MIN_SOURCE_BYTES - 1 })).toThrow(
      /sourceBytes/,
    );
    expect(() => validateSubmitJobInput({ ...validBody, sourceBytes: MAX_SOURCE_BYTES + 1 })).toThrow(
      /sourceBytes/,
    );
    expect(() => validateSubmitJobInput({ ...validBody, sourceBytes: 32768.5 })).toThrow(/sourceBytes/);
  });

  it("rejects extension other than .gb or .gbc", () => {
    expect(() => validateSubmitJobInput({ ...validBody, extension: ".GB" as ".gb" })).toThrow(
      /extension/,
    );
    expect(() => validateSubmitJobInput({ ...validBody, extension: ".nes" as ".gb" })).toThrow(
      /extension/,
    );
  });

  it("rejects a non-HTTPS sourceUrl without echoing it", () => {
    expect(() =>
      validateSubmitJobInput({ ...validBody, sourceUrl: "http://example.com/game.gb" }),
    ).toThrow(/HTTPS/);
    try {
      validateSubmitJobInput({ ...validBody, sourceUrl: "http://secret.example/rom.gb" });
      throw new Error("expected throw");
    } catch (error) {
      expect(String(error)).not.toMatch(/secret\.example/);
      expect(String(error)).not.toMatch(/rom\.gb/);
    }
  });
});

describe("deriveJobId", () => {
  it("matches the portable owner/slug vector", async () => {
    await expect(deriveJobId(VECTOR_OWNER, VECTOR_SLUG)).resolves.toBe(VECTOR_JOB_ID);
    expect(JOB_ID_RE.test(VECTOR_JOB_ID)).toBe(true);
  });

  it("hashes UTF-8 hexbounty-job-v1 newline lowercaseOwner newline validatedSlug", async () => {
    const message = encoder.encode(`hexbounty-job-v1\n${VECTOR_OWNER}\n${VECTOR_SLUG}`);
    const digest = createHash("sha256").update(Buffer.from(message)).digest("hex");
    expect(`u-${digest.slice(0, 32)}`).toBe(VECTOR_JOB_ID);
    expect(await computeSha256Hex(message)).toBe(digest);
  });
});

describe("romExtensionFromFilename", () => {
  it("derives lowercase .gb or .gbc from the filename", () => {
    expect(romExtensionFromFilename("Space.GB")).toBe(".gb");
    expect(romExtensionFromFilename("cart.gbc")).toBe(".gbc");
  });
});

describe("normalizeModalBaseUrl", () => {
  it("accepts an HTTPS origin and strips a trailing slash", () => {
    expect(normalizeModalBaseUrl("https://ameymuke252003--hexbounty-user-jobs-api.modal.run/")).toBe(
      "https://ameymuke252003--hexbounty-user-jobs-api.modal.run",
    );
  });

  it("rejects HTTP, credentials, query, and fragment", () => {
    expect(() => normalizeModalBaseUrl("http://example.com")).toThrow(/HTTPS/);
    expect(() => normalizeModalBaseUrl("https://user:pass@example.com")).toThrow(/credentials/);
    expect(() => normalizeModalBaseUrl("https://example.com?x=1")).toThrow(/query or fragment/);
    expect(() => normalizeModalBaseUrl("https://example.com#x")).toThrow(/query or fragment/);
  });
});

describe("parseJobStatusPayload", () => {
  const game = {
    slug: VECTOR_SLUG,
    title: "Space Breakout",
    description: "A reconstructed Game Boy game.",
    priceMon: "0.01",
    rightsNote: "",
    rightsAttestedAt: "2026-08-16T11:15:00.000Z",
  };

  it("accepts every public job state with phase and progress", () => {
    for (const status of ["queued", "running", "complete", "incomplete", "failed", "rejected"] as const) {
      expect(
        parseJobStatusPayload({
          jobId: VECTOR_JOB_ID,
          status,
          phase: "reconstruct",
          progress: 40,
          error: null,
          game,
        }),
      ).toEqual({
        jobId: VECTOR_JOB_ID,
        status,
        phase: "reconstruct",
        progress: 40,
        error: null,
        game,
      });
    }
  });

  it("keeps safe result fields and strips serverOutputPath plus source URLs", () => {
    const parsed = parseJobStatusPayload({
      jobId: VECTOR_JOB_ID,
      status: "complete",
      phase: "done",
      progress: 100,
      error: null,
      game,
      sourceUrl: "https://should-not-leak.example/rom.gb",
      result: {
        sha256: SHA,
        bytes: MIN_SOURCE_BYTES,
        platform: "Game Boy",
        extension: ".gb",
        serverOutputPath: `/v1/jobs/${VECTOR_JOB_ID}/result`,
        runStatus: "complete",
        sourceUrl: "https://should-not-leak.example/rom.gb",
      },
    });
    expect(parsed).toEqual({
      jobId: VECTOR_JOB_ID,
      status: "complete",
      phase: "done",
      progress: 100,
      error: null,
      game,
      result: {
        sha256: SHA,
        bytes: MIN_SOURCE_BYTES,
        platform: "Game Boy",
        extension: ".gb",
        runStatus: "complete",
      },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/should-not-leak/);
    expect(JSON.stringify(parsed)).not.toMatch(/serverOutputPath/);
    expect(JSON.stringify(parsed)).not.toMatch(/\/result/);
  });

  it("rejects an invalid status payload", () => {
    expect(() => parseJobStatusPayload({ jobId: VECTOR_JOB_ID, status: "done" })).toThrow(/status/);
    expect(() => parseJobStatusPayload({ jobId: VECTOR_JOB_ID, status: "unknown" })).toThrow(/status/);
    expect(() => parseJobStatusPayload(null)).toThrow(/JSON object/);
  });
});
