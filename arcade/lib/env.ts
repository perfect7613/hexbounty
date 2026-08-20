import { isAddress, zeroAddress, type Address } from "viem";

export const MONAD_TESTNET_ID = 10143 as const;
export const MONAD_EXPLORER_ORIGIN = "https://testnet.monadexplorer.com";
export const MONAD_RPC_FALLBACK = "https://testnet-rpc.monad.xyz";
export const METAMASK_DOWNLOAD_URL = "https://metamask.io/download/";

export type ContractConfig =
  | { status: "configured"; address: Address }
  | { status: "demo-preview"; reason: string };

function readPublic(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getRpcUrl(): string {
  return readPublic(process.env.NEXT_PUBLIC_MONAD_RPC_URL) || MONAD_RPC_FALLBACK;
}

export function getConfiguredChainId(): number {
  const raw = readPublic(process.env.NEXT_PUBLIC_CHAIN_ID);
  if (!raw) return MONAD_TESTNET_ID;
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : MONAD_TESTNET_ID;
}

export function getContractConfig(): ContractConfig {
  const raw = readPublic(process.env.NEXT_PUBLIC_HEXBOUNTY_CONTRACT);
  if (!raw) {
    return {
      status: "demo-preview",
      reason: "Blockchain actions are unavailable in this preview.",
    };
  }
  if (!isAddress(raw)) {
    return {
      status: "demo-preview",
      reason: "Blockchain actions are unavailable in this preview.",
    };
  }
  if (raw.toLowerCase() === zeroAddress) {
    return {
      status: "demo-preview",
      reason: "Blockchain actions are unavailable in this preview.",
    };
  }
  if (getConfiguredChainId() !== MONAD_TESTNET_ID) {
    return {
      status: "demo-preview",
      reason: "Blockchain actions are unavailable in this preview.",
    };
  }
  return { status: "configured", address: raw };
}

export function isWritesEnabled(): boolean {
  return getContractConfig().status === "configured";
}
