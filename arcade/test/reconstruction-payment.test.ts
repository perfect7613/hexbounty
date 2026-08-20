import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseEther,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { hexBountyAbi } = await import("../lib/abi");
const {
  ReconstructionPaymentError,
  verifyReconstructionPayment,
} = await import("../lib/server/reconstruction-payment");

const CONTRACT = "0xc3F9fb30d87CFf804F394C680Ed7856B055F7c96" as Address;
const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const HASH = `0x${"34".repeat(32)}` as Hex;
const META =
  "https://arcade.example/api/games/space-breakout/metadata?creator=0x1111111111111111111111111111111111111111";
const DEADLINE = 1_787_483_700;
const VALUE = parseEther("0.01");

const payment = {
  slug: "space-breakout",
  title: "Space Breakout",
  description: "A reconstructed Game Boy game.",
  priceMon: "1",
  rightsAttestation: true as const,
  rightsNote: "I own or licensed this ROM for distribution.",
  bountyMon: "0.01",
  bountyTxHash: HASH,
  bountyId: "7",
  bountyDeadline: DEADLINE,
  bountyMetadataURI: META,
};

function bountyLog(overrides: { reward?: bigint; sponsor?: Address } = {}): Log {
  const topics = encodeEventTopics({
    abi: hexBountyAbi,
    eventName: "BountyCreated",
    args: { bountyId: 7n, sponsor: overrides.sponsor ?? OWNER },
  });
  return {
    address: CONTRACT,
    blockHash: `0x${"56".repeat(32)}`,
    blockNumber: 123n,
    data: encodeAbiParameters(
      [
        { name: "reward", type: "uint256" },
        { name: "deadline", type: "uint64" },
        { name: "metadataURI", type: "string" },
      ],
      [overrides.reward ?? VALUE, BigInt(DEADLINE), META],
    ),
    logIndex: 0,
    removed: false,
    topics: topics as Log["topics"],
    transactionHash: HASH,
    transactionIndex: 0,
  };
}

function deps(overrides: { value?: bigint; logs?: Log[]; from?: Address } = {}) {
  return {
    nowSeconds: () => DEADLINE - 60,
    getTransaction: async () => ({
      from: overrides.from ?? OWNER,
      to: CONTRACT,
      value: overrides.value ?? VALUE,
      input: encodeFunctionData({
        abi: hexBountyAbi,
        functionName: "createBounty",
        args: [META, BigInt(DEADLINE)],
      }),
    }),
    getReceipt: async () => ({
      status: "success" as const,
      logs: overrides.logs ?? [bountyLog()],
    }),
  };
}

describe("verifyReconstructionPayment", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_HEXBOUNTY_CONTRACT = CONTRACT;
    process.env.NEXT_PUBLIC_CHAIN_ID = "10143";
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_HEXBOUNTY_CONTRACT;
    delete process.env.NEXT_PUBLIC_CHAIN_ID;
  });

  it("accepts the exact confirmed createBounty transaction and event", async () => {
    await expect(
      verifyReconstructionPayment({ owner: OWNER, payment, deps: deps() }),
    ).resolves.toBeUndefined();
  });

  it("rejects a mismatched sender, value, or event", async () => {
    await expect(
      verifyReconstructionPayment({
        owner: OWNER,
        payment,
        deps: deps({ from: "0x2222222222222222222222222222222222222222" }),
      }),
    ).rejects.toBeInstanceOf(ReconstructionPaymentError);
    await expect(
      verifyReconstructionPayment({ owner: OWNER, payment, deps: deps({ value: 1n }) }),
    ).rejects.toThrow(/value/);
    await expect(
      verifyReconstructionPayment({
        owner: OWNER,
        payment,
        deps: deps({ logs: [bountyLog({ reward: 1n })] }),
      }),
    ).rejects.toThrow(/event/);
  });
});
