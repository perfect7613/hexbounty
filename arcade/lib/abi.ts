export const hexBountyAbi = [
  {
    type: "function",
    name: "createBounty",
    stateMutability: "payable",
    inputs: [
      { name: "metadataURI", type: "string" },
      { name: "deadline", type: "uint64" },
    ],
    outputs: [{ name: "bountyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "fundBounty",
    stateMutability: "payable",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitSolution",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "artifactHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "evidenceURI", type: "string" },
      { name: "liveURL", type: "string" },
    ],
    outputs: [{ name: "submissionId", type: "uint32" }],
  },
  {
    type: "function",
    name: "acceptSolution",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "submissionId", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refundExpiredBounty",
    stateMutability: "nonpayable",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getBounty",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "sponsor", type: "address" },
          { name: "reward", type: "uint96" },
          { name: "deadline", type: "uint64" },
          { name: "state", type: "uint8" },
          { name: "acceptedSubmissionId", type: "uint32" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getSubmission",
    stateMutability: "view",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "submissionId", type: "uint32" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "builder", type: "address" },
          { name: "artifactHash", type: "bytes32" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "evidenceURI", type: "string" },
          { name: "liveURL", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getSubmissionCount",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "bountyCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "BountyCreated",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "sponsor", type: "address", indexed: true },
      { name: "reward", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BountyFunded",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "funder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalReward", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SolutionSubmitted",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "submissionId", type: "uint32", indexed: true },
      { name: "builder", type: "address", indexed: true },
      { name: "artifactHash", type: "bytes32", indexed: false },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "evidenceURI", type: "string", indexed: false },
      { name: "liveURL", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SolutionAccepted",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "submissionId", type: "uint32", indexed: true },
      { name: "sponsor", type: "address", indexed: true },
      { name: "builder", type: "address", indexed: false },
      { name: "builderPayout", type: "uint256", indexed: false },
      { name: "platformFee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BountyRefunded",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "sponsor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export const BOUNTY_STATES = ["Open", "Submitted", "Awarded", "Refunded"] as const;
export type BountyStateName = (typeof BOUNTY_STATES)[number];

export const PLATFORM_FEE_BPS = 250;
export const BPS_DENOMINATOR = 10_000;
export const UINT96_MAX = (1n << 96n) - 1n;

export function bountyStateName(state: number | bigint): BountyStateName {
  const index = Number(state);
  return BOUNTY_STATES[index] ?? "Open";
}
