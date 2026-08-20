import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { readRetryableBounty } from "@/components/GameUploadForm";

const OWNER = getAddress("0x1111111111111111111111111111111111111111");
const META =
  "https://arcade.example/api/games/color-game/metadata?creator=0x1111111111111111111111111111111111111111";
const expected = {
  owner: OWNER,
  slug: "color-game",
  bountyMon: "0.01",
  metadataURI: META,
  nowSeconds: 1_000,
};
const status = {
  job: { status: "rejected" },
  game: {
    slug: "color-game",
    creatorAddress: OWNER,
    bountyMon: "0.01",
    bountyTxHash: `0x${"12".repeat(32)}`,
    bountyId: "4",
    bountyDeadline: 2_000,
    bountyMetadataURI: META,
  },
};

describe("rejected upload payment recovery", () => {
  it("reuses the still-live owner-bound bounty without another wallet payment", () => {
    expect(readRetryableBounty(status, expected)).toEqual({
      bountyId: "4",
      bountyMon: "0.01",
      deadline: 2_000,
      metadataURI: META,
      slug: "color-game",
      txHash: `0x${"12".repeat(32)}`,
    });
  });

  it("refuses non-rejected, expired, or mismatched payment records", () => {
    expect(
      readRetryableBounty({ ...status, job: { status: "running" } }, expected),
    ).toBeNull();
    expect(
      readRetryableBounty(
        { ...status, game: { ...status.game, bountyDeadline: 1_000 } },
        expected,
      ),
    ).toBeNull();
    expect(
      readRetryableBounty(
        { ...status, game: { ...status.game, bountyMon: "1" } },
        expected,
      ),
    ).toBeNull();
  });
});
