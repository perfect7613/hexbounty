import { formatEther, parseEther, type Address } from "viem";
import { bountyStateName, PLATFORM_FEE_BPS, BPS_DENOMINATOR, UINT96_MAX, type BountyStateName } from "./abi";

export type ChainBounty = {
  kind: "chain";
  id: bigint;
  sponsor: Address;
  reward: bigint;
  deadline: bigint;
  state: BountyStateName;
  acceptedSubmissionId: number;
  metadataURI: string;
};

export function toChainBounty(id: bigint, bounty: {
  sponsor: Address;
  reward: bigint;
  deadline: bigint;
  state: number;
  acceptedSubmissionId: number;
  metadataURI: string;
}): ChainBounty {
  return {
    kind: "chain",
    id,
    sponsor: bounty.sponsor,
    reward: bounty.reward,
    deadline: bounty.deadline,
    state: bountyStateName(bounty.state),
    acceptedSubmissionId: bounty.acceptedSubmissionId,
    metadataURI: bounty.metadataURI,
  };
}

export function formatMon(value: bigint): string {
  const formatted = formatEther(value);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmed = fraction.replace(/0+$/, "").slice(0, 6);
  return trimmed ? `${whole}.${trimmed} MON` : `${whole} MON`;
}

export function formatDeadline(unixSeconds: bigint | number): string {
  const ms = Number(unixSeconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "Unknown deadline";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(ms)) + " UTC";
}

export function isExpired(deadline: bigint, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return nowSeconds >= Number(deadline);
}

export function builderPayout(reward: bigint): { payout: bigint; fee: bigint } {
  const fee = (reward * BigInt(PLATFORM_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  return { payout: reward - fee, fee };
}

export function isMetadataUri(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/") && trimmed.length > 1) return true;
  try {
    const url = new URL(trimmed);
    return ["http:", "https:", "ipfs:", "ar:", "arweave:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function isAbsoluteDiscoveryUri(value: string): boolean {
  return /^(https?:|ipfs:|ar:|arweave:)/i.test(value.trim());
}

export function parsePositiveMon(value: string): { amount: bigint } | { error: string } {
  try {
    const amount = parseEther(value.trim());
    if (amount <= 0n) return { error: "Must be a positive amount of testnet MON." };
    if (amount > UINT96_MAX) return { error: "Amount exceeds uint96." };
    return { amount };
  } catch {
    return { error: "Must be a valid MON amount." };
  }
}

export function metadataTitle(uri: string): string {
  try {
    const url = new URL(uri, "https://hexbounty.invalid");
    return url.pathname.split("/").filter(Boolean).slice(-1)[0] || uri;
  } catch {
    return uri;
  }
}
