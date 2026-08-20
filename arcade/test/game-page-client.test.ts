import { describe, expect, it } from "vitest";
import { parsePublication } from "@/components/GamePageClient";

describe("game page publication parsing", () => {
  it("accepts the numeric uint32 and uint64 fields returned by the status API", () => {
    expect(
      parsePublication({
        published: true,
        creator: "0xEB155dc01Be246C2C0fd9d6a96BB359894865981",
        playPrice: "1000000000000000000",
        bountyId: "1",
        submissionId: 1,
        purchaseCount: 0,
        gameContentHash:
          "0x305f931663cc6ed93efbc1c4db900e77bd1ae9d8069dce485aa3827f69696128",
        metadataURI:
          "https://arcade-liart-eight.vercel.app/api/games/tetris-amey/metadata",
      }),
    ).toMatchObject({ submissionId: 1, purchaseCount: 0 });
  });

  it("rejects string-encoded submission ids", () => {
    expect(() =>
      parsePublication({
        published: true,
        creator: "0xEB155dc01Be246C2C0fd9d6a96BB359894865981",
        playPrice: "1000000000000000000",
        bountyId: "1",
        submissionId: "1",
        purchaseCount: 0,
        gameContentHash:
          "0x305f931663cc6ed93efbc1c4db900e77bd1ae9d8069dce485aa3827f69696128",
        metadataURI:
          "https://arcade-liart-eight.vercel.app/api/games/tetris-amey/metadata",
      }),
    ).toThrow("Publication fields are malformed.");
  });
});
