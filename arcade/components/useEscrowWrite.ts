"use client";

import { useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { hexBountyMonad } from "@/lib/chain";
import { hexBountyAbi } from "@/lib/abi";
import { estimateEscrowGas } from "@/lib/gas";
import { getContractConfig } from "@/lib/env";
import type { TxPhase } from "./TxStatus";

type WriteName =
  | "createBounty"
  | "fundBounty"
  | "submitSolution"
  | "acceptSolution"
  | "refundExpiredBounty";

export function useEscrowWrite() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: hexBountyMonad.id });
  const contract = getContractConfig();
  const { writeContractAsync, reset } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [error, setError] = useState<string | undefined>();

  const receipt = useWaitForTransactionReceipt({
    hash,
    chainId: hexBountyMonad.id,
    query: { enabled: Boolean(hash) },
  });

  const writesEnabled =
    contract.status === "configured" && isConnected && chainId === hexBountyMonad.id && Boolean(address);

  const displayPhase: TxPhase =
    phase === "submitted" || phase === "confirming"
      ? receipt.isSuccess
        ? "confirmed"
        : receipt.isError
          ? "failed"
          : receipt.isLoading || phase === "confirming"
            ? "confirming"
            : "submitted"
      : phase;

  const displayError =
    displayPhase === "failed"
      ? error || receipt.error?.message || "Transaction failed."
      : error;

  async function send(
    functionName: WriteName,
    args: readonly unknown[],
    value?: bigint,
  ): Promise<boolean> {
    setError(undefined);
    setHash(undefined);
    reset();

    if (contract.status !== "configured") {
      setPhase("failed");
      setError("Blockchain actions are unavailable in this preview.");
      return false;
    }
    if (!isConnected || !address) {
      setPhase("failed");
      setError("Connect MetaMask first.");
      return false;
    }
    if (chainId !== hexBountyMonad.id) {
      setPhase("failed");
      setError("Switch to Monad Testnet (chain id 10143).");
      return false;
    }
    if (!publicClient) {
      setPhase("failed");
      setError("Public client is not ready.");
      return false;
    }

    try {
      setPhase("requesting");
      const gas = await estimateEscrowGas(publicClient, {
        account: address,
        address: contract.address,
        functionName,
        args,
        value,
      });
      const nextHash = await writeContractAsync({
        address: contract.address,
        abi: hexBountyAbi,
        functionName,
        args,
        value,
        gas,
        chainId: hexBountyMonad.id,
      } as never);
      setHash(nextHash);
      setPhase("submitted");
      return true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Wallet rejected or estimation failed.";
      setPhase("failed");
      setError(message);
      return false;
    }
  }

  return {
    send,
    phase: displayPhase,
    hash,
    error: displayError,
    writesEnabled,
    contract,
    address,
  };
}
