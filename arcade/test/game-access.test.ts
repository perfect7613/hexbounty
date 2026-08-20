import { getAddress, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  authorizeRomDownload,
  decideGameAccess,
  resolveViewerHasAccess,
  selectJobOwner,
  toSafePublication,
} = await import("../lib/server/game-platform");

const creator = getAddress("0x0000000000000000000000000000000000000001");
const player = getAddress("0x0000000000000000000000000000000000000002");
const publication = {
  creator,
  playPrice: 10n ** 18n,
  submissionId: 3,
  purchaseCount: 2,
  bountyId: 9n,
  gameContentHash: ("0x" + "ab".repeat(32)) as Hex,
  metadataURI: "https://example.com/games/paid-quest/metadata",
};

describe("decideGameAccess", () => {
  it("allows the published creator when the contract lookup is available", () => {
    expect(
      decideGameAccess({
        viewer: creator,
        creator,
        published: true,
        onChainHasAccess: false,
      }),
    ).toBe("allowed");
  });

  it("allows a purchaser when on-chain access is true", () => {
    expect(
      decideGameAccess({
        viewer: player,
        creator,
        published: true,
        onChainHasAccess: true,
      }),
    ).toBe("allowed");
  });

  it("denies a paid listing when on-chain access is false", () => {
    expect(
      decideGameAccess({
        viewer: player,
        creator,
        published: true,
        onChainHasAccess: false,
      }),
    ).toBe("denied");
    expect(
      decideGameAccess({
        viewer: null,
        creator,
        published: true,
        onChainHasAccess: false,
      }),
    ).toBe("denied");
  });

  it("denies unpublished games even for the session owner", () => {
    expect(
      decideGameAccess({
        viewer: creator,
        creator,
        published: false,
        onChainHasAccess: false,
      }),
    ).toBe("denied");
  });

  it("fails closed when paid on-chain access is unavailable", () => {
    expect(
      decideGameAccess({
        viewer: player,
        creator,
        published: true,
        onChainHasAccess: "unavailable",
      }),
    ).toBe("denied");
    expect(
      decideGameAccess({
        viewer: creator,
        creator,
        published: true,
        onChainHasAccess: "unavailable",
      }),
    ).toBe("denied");
  });
});

describe("selectJobOwner", () => {
  it("uses the publication creator once a game is on-chain", () => {
    expect(
      selectJobOwner({ sessionAddress: player, publication }),
    ).toEqual({ ok: true, owner: creator, publication });
  });

  it("uses the session address for a creator prepublication job", () => {
    expect(
      selectJobOwner({ sessionAddress: player, publication: null }),
    ).toEqual({ ok: true, owner: player, publication: null });
  });

  it("fails closed when the registry cannot be read", () => {
    expect(selectJobOwner({ sessionAddress: player, publication: "unavailable" })).toEqual({
      ok: false,
      status: 503,
      error: "Paid play registry is unavailable",
    });
  });

  it("requires a session only for an unpublished job", () => {
    expect(selectJobOwner({ sessionAddress: null, publication: null })).toEqual({
      ok: false,
      status: 401,
      error: "Authentication required",
    });
    expect(selectJobOwner({ sessionAddress: null, publication })).toEqual({
      ok: true,
      owner: creator,
      publication,
    });
  });
});

describe("resolveViewerHasAccess", () => {
  it("is true for the job owner even before publication", () => {
    expect(
      resolveViewerHasAccess({ viewer: creator, owner: creator, onChainHasAccess: false }),
    ).toBe(true);
  });

  it("is true only from the contract for a non-owner", () => {
    expect(
      resolveViewerHasAccess({ viewer: player, owner: creator, onChainHasAccess: true }),
    ).toBe(true);
    expect(
      resolveViewerHasAccess({ viewer: player, owner: creator, onChainHasAccess: false }),
    ).toBe(false);
    expect(
      resolveViewerHasAccess({
        viewer: player,
        owner: creator,
        onChainHasAccess: "unavailable",
      }),
    ).toBe(false);
  });
});

describe("authorizeRomDownload", () => {
  const safe = toSafePublication(publication);

  it("requires a session", () => {
    expect(
      authorizeRomDownload({ viewer: null, publication: safe, onChainHasAccess: true }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed when the registry is unavailable", () => {
    expect(
      authorizeRomDownload({
        viewer: player,
        publication: safe,
        onChainHasAccess: "unavailable",
      }),
    ).toMatchObject({ ok: false, status: 503 });
    expect(
      authorizeRomDownload({
        viewer: creator,
        publication: null,
        onChainHasAccess: "unavailable",
      }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("requires a real publication", () => {
    expect(
      authorizeRomDownload({ viewer: creator, publication: null, onChainHasAccess: false }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("returns 402 when the contract reports no access", () => {
    expect(
      authorizeRomDownload({ viewer: player, publication: safe, onChainHasAccess: false }),
    ).toMatchObject({ ok: false, status: 402 });
  });

  it("allows a download only when the contract reports access", () => {
    expect(
      authorizeRomDownload({ viewer: player, publication: safe, onChainHasAccess: true }),
    ).toEqual({ ok: true, publication: safe });
    expect(
      authorizeRomDownload({ viewer: creator, publication: safe, onChainHasAccess: true }),
    ).toEqual({ ok: true, publication: safe });
  });
});
