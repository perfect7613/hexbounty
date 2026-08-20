import { getAddress, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  assembleGameStatus,
  assertNoLeakyFields,
  toSafePublication,
} = await import("../lib/server/game-platform");
const {
  buildPublicGameMetadata,
  parseLowercaseCreatorQuery,
  resolvePublicOrigin,
  romAttachmentFilename,
  romProxyHeaders,
} = await import("../lib/server/game-responses");

const creator = getAddress("0x1111111111111111111111111111111111111111");
const player = getAddress("0x2222222222222222222222222222222222222222");
const SHA = "ab".repeat(32);
const JOB_ID = "u-cf816d240c4d53b3bcf9516c8a2fd00e";

const modal = {
  jobId: JOB_ID,
  status: "complete" as const,
  phase: "done",
  progress: 100,
  error: null,
  detail: "reconstruct finished",
  game: {
    slug: "space-breakout",
    title: "Space Breakout",
    description: "A reconstructed Game Boy game.",
    priceMon: "0.01",
    rightsNote: "I am authorized to submit this binary.",
    rightsAttestedAt: "2026-08-16T10:00:00Z",
    sourceUrl: "https://should-not-leak.example/rom.gb",
  },
  result: {
    sha256: SHA,
    bytes: 32768,
    platform: "Game Boy",
    extension: ".gb" as const,
    runStatus: "complete",
    serverOutputPath: `/v1/jobs/${JOB_ID}/result`,
  },
};

describe("assembleGameStatus sanitation", () => {
  it("emits exact public fields and drops source/result URLs", () => {
    const payload = assembleGameStatus({
      slug: "space-breakout",
      owner: creator,
      sessionAddress: player,
      modal,
      publication: toSafePublication({
        creator,
        playPrice: 10n ** 16n,
        bountyId: 1n,
        submissionId: 2,
        purchaseCount: 4,
        gameContentHash: (`0x${SHA}`) as Hex,
        metadataURI: "https://arcade.example/games/space-breakout/metadata",
      }),
      hasAccess: true,
    });

    expect(payload).toEqual({
      game: {
        slug: "space-breakout",
        title: "Space Breakout",
        description: "A reconstructed Game Boy game.",
        creatorAddress: creator,
        priceMon: "0.01",
        rightsNote: "I am authorized to submit this binary.",
        rightsAttestedAt: "2026-08-16T10:00:00Z",
      },
      job: {
        jobId: JOB_ID,
        status: "complete",
        phase: "done",
        progress: 100,
        error: null,
        detail: "reconstruct finished",
        result: {
          sha256: SHA,
          bytes: 32768,
          platform: "Game Boy",
          extension: ".gb",
          runStatus: "complete",
        },
      },
      publication: {
        published: true,
        creator,
        playPrice: (10n ** 16n).toString(),
        bountyId: "1",
        submissionId: 2,
        purchaseCount: 4,
        gameContentHash: `0x${SHA}`,
        metadataURI: "https://arcade.example/games/space-breakout/metadata",
      },
      viewer: {
        address: player,
        isCreator: false,
        hasAccess: true,
      },
      ready: true,
    });
    expect(JSON.stringify(payload)).not.toMatch(/should-not-leak/);
    expect(JSON.stringify(payload)).not.toMatch(/serverOutputPath/);
    expect(JSON.stringify(payload)).not.toMatch(/fileKey/);
    expect(() => assertNoLeakyFields(payload, "status")).not.toThrow();
  });
});

describe("metadata origin and creator query", () => {
  it("requires a lowercase 0x creator query", () => {
    expect(parseLowercaseCreatorQuery("0x1111111111111111111111111111111111111111")).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(parseLowercaseCreatorQuery("0x1111111111111111111111111111111111111111".toUpperCase())).toBeNull();
    expect(parseLowercaseCreatorQuery(null)).toBeNull();
  });

  it("prefers NEXT_PUBLIC_SITE_URL origin over the request Origin header", () => {
    const request = new Request("https://request.example/api/games/space-breakout/metadata", {
      headers: { origin: "https://spoofed.example" },
    });
    expect(
      resolvePublicOrigin({
        request,
        env: { NEXT_PUBLIC_SITE_URL: "https://arcade.example/app" },
      }),
    ).toBe("https://arcade.example");
  });

  it("falls back to the request origin when the site URL is unset", () => {
    const request = new Request("https://arcade.example/api/games/space-breakout/metadata", {
      headers: { origin: "https://arcade.example" },
    });
    expect(resolvePublicOrigin({ request, env: {} })).toBe("https://arcade.example");
  });

  it("uses the request URL origin when a same-origin GET omits Origin", () => {
    const request = new Request("https://arcade.example/api/games/space-breakout/metadata");
    expect(resolvePublicOrigin({ request, env: {} })).toBe("https://arcade.example");
  });

  it("does not trust an arbitrary Origin header for public metadata", () => {
    const request = new Request("https://arcade.example/api/games/space-breakout/metadata", {
      headers: { origin: "https://spoofed.example" },
    });
    expect(resolvePublicOrigin({ request, env: {} })).toBe("https://arcade.example");
  });

  it("builds public metadata with an origin-based external_url and no source keys", () => {
    const metadata = buildPublicGameMetadata({
      slug: "space-breakout",
      creator: "0x1111111111111111111111111111111111111111",
      modal,
      origin: "https://arcade.example",
      env: { NEXT_PUBLIC_HEXBOUNTY_PAID_PLAY: "0x00000000000000000000000000000000000000aa" },
    });
    expect(metadata.external_url).toBe("https://arcade.example/games/space-breakout");
    expect(metadata.name).toBe("Space Breakout");
    expect(metadata.creator).toBe(creator);
    expect(metadata.rightsAttestedAt).toBe("2026-08-16T10:00:00Z");
    expect(metadata.contract).toBe(getAddress("0x00000000000000000000000000000000000000aa"));
    expect(metadata.explorer).toMatch(/\/address\//);
    expect(JSON.stringify(metadata)).not.toMatch(/sourceUrl/);
    expect(JSON.stringify(metadata)).not.toMatch(/serverOutputPath/);
    expect(JSON.stringify(metadata)).not.toMatch(/fileKey/);
  });
});

describe("ROM attachment headers", () => {
  it("sanitizes filename to slug plus extension", () => {
    expect(romAttachmentFilename("space-breakout", ".gbc")).toBe("space-breakout.gbc");
    const headers = romProxyHeaders("space-breakout.gb");
    expect(headers).toEqual({
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="space-breakout.gb"',
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    });
  });
});
