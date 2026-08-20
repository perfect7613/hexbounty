import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  buildCreatorLeaderboard,
  buildCreatorLeaderboardFromSnapshots,
  gameSlugFromMetadataURI,
  leaderboardSlugs,
} from "@/lib/leaderboard";

const creatorA = "0x1111111111111111111111111111111111111111" as Address;
const creatorB = "0x2222222222222222222222222222222222222222" as Address;
const slugA = `0x${"aa".repeat(32)}` as Hex;
const slugB = `0x${"bb".repeat(32)}` as Hex;

describe("creator leaderboard", () => {
  it("extracts a public game slug from relative and absolute metadata URLs", () => {
    expect(gameSlugFromMetadataURI("/api/games/tetris-amey/metadata")).toBe("tetris-amey");
    expect(gameSlugFromMetadataURI("https://example.com/api/games/pocket-quest/metadata")).toBe("pocket-quest");
    expect(gameSlugFromMetadataURI("https://example.com/not-a-game")).toBeNull();
  });

  it("ranks creators by paid unlocks and aggregates earnings", () => {
    const result = buildCreatorLeaderboard(
      [
        { slugHash: slugA, creator: creatorA, metadataURI: "/api/games/tetris-amey/metadata" },
        { slugHash: slugB, creator: creatorB, metadataURI: "/api/games/pocket-quest/metadata" },
      ],
      [
        { slugHash: slugA, creator: creatorA, creatorEarnings: 95n },
        { slugHash: slugA, creator: creatorA, creatorEarnings: 95n },
        { slugHash: slugB, creator: creatorB, creatorEarnings: 50n },
      ],
    );

    expect(result.map((entry) => entry.creator)).toEqual([creatorA, creatorB]);
    expect(result[0]).toMatchObject({ paidUnlocks: 2, earnings: 190n });
    expect(result[0].games[0].slug).toBe("tetris-amey");
  });

  it("does not count a duplicated publication twice", () => {
    const publication = {
      slugHash: slugA,
      creator: creatorA,
      metadataURI: "/api/games/tetris-amey/metadata",
    };
    expect(buildCreatorLeaderboard([publication, publication], [])[0].games).toHaveLength(1);
  });

  it("reads the featured game plus valid configured catalogue slugs", () => {
    expect(
      leaderboardSlugs({
        HEXBOUNTY_LEADERBOARD_SLUGS: "pocket-quest, TETRIS-AMEY, bad slug, pocket-quest",
      }),
    ).toEqual(["tetris-amey", "pocket-quest"]);
  });

  it("builds paid unlocks and creator earnings from contract publication counters", () => {
    const result = buildCreatorLeaderboardFromSnapshots([
      {
        slugHash: slugA,
        creator: creatorA,
        metadataURI: "/api/games/tetris-amey/metadata",
        playPrice: 1_000n,
        purchaseCount: 2n,
      },
    ]);

    expect(result[0]).toMatchObject({ paidUnlocks: 2, earnings: 1_950n });
  });
});
