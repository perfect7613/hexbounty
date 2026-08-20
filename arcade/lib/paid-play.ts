import { getAddress, isAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";

export const hexBountyPaidPlayAbi = [
  {
    type: "event",
    name: "GamePublished",
    inputs: [
      { name: "slugHash", type: "bytes32", indexed: true },
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "submissionId", type: "uint32", indexed: true },
      { name: "creator", type: "address", indexed: false },
      { name: "playPrice", type: "uint256", indexed: false },
      { name: "gameContentHash", type: "bytes32", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AccessPurchased",
    inputs: [
      { name: "slugHash", type: "bytes32", indexed: true },
      { name: "player", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "creatorEarnings", type: "uint256", indexed: false },
      { name: "platformFee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "error",
    name: "PublicationNotFound",
    inputs: [{ name: "slugHash", type: "bytes32" }],
  },
  {
    type: "function",
    name: "publishGame",
    stateMutability: "nonpayable",
    inputs: [
      { name: "slugHash", type: "bytes32" },
      { name: "bountyId", type: "uint256" },
      { name: "submissionId", type: "uint32" },
      { name: "playPrice", type: "uint256" },
      { name: "gameContentHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "purchaseAccess",
    stateMutability: "payable",
    inputs: [{ name: "slugHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "hasAccess",
    stateMutability: "view",
    inputs: [
      { name: "slugHash", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getPublication",
    stateMutability: "view",
    inputs: [{ name: "slugHash", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "playPrice", type: "uint96" },
          { name: "submissionId", type: "uint32" },
          { name: "purchaseCount", type: "uint64" },
          { name: "bountyId", type: "uint256" },
          { name: "gameContentHash", type: "bytes32" },
          { name: "metadataURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "pendingWithdrawals",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawEarnings",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
] as const;

function readPaidPlayAddress(): Address | null {
  const raw = typeof process.env.NEXT_PUBLIC_HEXBOUNTY_PAID_PLAY === "string"
    ? process.env.NEXT_PUBLIC_HEXBOUNTY_PAID_PLAY.trim()
    : "";
  if (!raw || !isAddress(raw)) return null;
  const address = getAddress(raw);
  if (address === zeroAddress) return null;
  return address;
}

export const hexBountyPaidPlayAddress = readPaidPlayAddress();

export function slugHash(slug: string): Hex {
  return keccak256(toBytes(slug.trim().toLowerCase()));
}
