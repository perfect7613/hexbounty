import { defineChain } from "viem";
import {
  getRpcUrl,
  MONAD_EXPLORER_ORIGIN,
  MONAD_TESTNET_ID,
} from "./env";

export const hexBountyMonad = defineChain({
  id: MONAD_TESTNET_ID,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [getRpcUrl()] },
  },
  blockExplorers: {
    default: { name: "Monad Explorer", url: MONAD_EXPLORER_ORIGIN },
  },
  testnet: true,
});

export function getMonadAddChainParams() {
  return {
    chainId: `0x${MONAD_TESTNET_ID.toString(16)}`,
    chainName: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: [getRpcUrl()],
    blockExplorerUrls: [MONAD_EXPLORER_ORIGIN],
  } as const;
}

export function isUnrecognizedChainError(error: unknown): boolean {
  const record = error as {
    code?: number | string;
    name?: string;
    message?: string;
    cause?: { code?: number | string; message?: string };
    walk?: (predicate: (err: unknown) => boolean) => unknown;
  };
  const codes = [record.code, record.cause?.code];
  if (codes.some((code) => Number(code) === 4902 || code === "4902")) return true;
  const message = `${record.message ?? ""} ${record.cause?.message ?? ""}`.toLowerCase();
  return (
    message.includes("4902") ||
    message.includes("unrecognized chain") ||
    message.includes("not added") ||
    message.includes("chain not configured")
  );
}
