import { describe, expect, it } from "vitest";
import { hexBountyPaidPlayAbi } from "../lib/paid-play";

describe("HexBountyPaidPlay ABI", () => {
  it("includes PublicationNotFound so viem can classify an unpublished slug", () => {
    expect(hexBountyPaidPlayAbi).toContainEqual({
      type: "error",
      name: "PublicationNotFound",
      inputs: [{ name: "slugHash", type: "bytes32" }],
    });
  });
});
