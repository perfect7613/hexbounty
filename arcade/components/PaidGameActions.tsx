"use client";

import { useEffect, useRef, useState } from "react";
import { formatEther, getAddress, isAddress, parseEther, zeroAddress, type Hex } from "viem";
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { hexBountyMonad } from "@/lib/chain";
import { explorerTx, shortHash } from "@/lib/explorer";
import { hexBountyPaidPlayAbi, hexBountyPaidPlayAddress, slugHash } from "@/lib/paid-play";
import { TxStatus, type TxPhase } from "./TxStatus";
import { Button } from "./ui/button";

type PaidGameActionsProps = {
  slug: string;
  creatorAddress: string;
  initialBountyId?: string;
  jobComplete: boolean;
  resultSha256?: string;
  priceMon: string | null;
  authenticatedAddress?: string;
  onAccessChanged: () => void;
};

type TxIntent = "purchase" | "publish";

const UINT32_MAX = 4_294_967_295n;

function sameAddress(a?: string, b?: string): boolean {
  if (!a || !b || !isAddress(a) || !isAddress(b)) return false;
  return getAddress(a) === getAddress(b);
}

function normalizeGameContentHash(raw: string): Hex | null {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return `0x${hex.toLowerCase()}`;
}

function parseDecimalNonnegative(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function parseUint32(raw: string): number | null {
  const value = parseDecimalNonnegative(raw);
  if (value === null || value > UINT32_MAX) return null;
  return Number(value);
}

export function PaidGameActions({
  slug,
  creatorAddress,
  initialBountyId,
  jobComplete,
  resultSha256,
  priceMon,
  authenticatedAddress,
  onAccessChanged,
}: PaidGameActionsProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync, reset } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [error, setError] = useState<string>();
  const [intent, setIntent] = useState<TxIntent | null>(null);
  const [bountyIdInput, setBountyIdInput] = useState(initialBountyId ?? "");
  const [submissionIdInput, setSubmissionIdInput] = useState("");
  const handledHash = useRef<string | null>(null);

  const contractAddress = hexBountyPaidPlayAddress;
  const gameId = slugHash(slug);
  const readsEnabled = Boolean(contractAddress) && jobComplete;

  const publicationQuery = useReadContract({
    address: contractAddress ?? undefined,
    abi: hexBountyPaidPlayAbi,
    functionName: "getPublication",
    args: [gameId],
    chainId: hexBountyMonad.id,
    query: { enabled: readsEnabled },
  });

  const accessQuery = useReadContract({
    address: contractAddress ?? undefined,
    abi: hexBountyPaidPlayAbi,
    functionName: "hasAccess",
    args: [gameId, address!],
    chainId: hexBountyMonad.id,
    query: { enabled: readsEnabled && Boolean(address) },
  });

  const receipt = useWaitForTransactionReceipt({
    hash: hash ?? undefined,
    chainId: hexBountyMonad.id,
    query: { enabled: Boolean(hash) },
  });

  const publication = publicationQuery.data;
  const publicationMissing =
    !contractAddress ||
    publicationQuery.isError ||
    !publication ||
    publication.creator === zeroAddress;

  const onChainAccess = Boolean(address) && accessQuery.data === true && !accessQuery.isError;
  const walletIsCreator = sameAddress(address, creatorAddress);
  const siweIsCreator = sameAddress(authenticatedAddress, creatorAddress);
  const isCreator = walletIsCreator || siweIsCreator;
  const hasAccess = isCreator || onChainAccess;

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

  useEffect(() => {
    if (!receipt.isSuccess || !hash || handledHash.current === hash) return;
    handledHash.current = hash;
    void (async () => {
      await publicationQuery.refetch();
      await accessQuery.refetch();
      onAccessChanged();
    })();
  }, [accessQuery, hash, onAccessChanged, publicationQuery, receipt.isSuccess]);

  const siweMatches =
    Boolean(address) &&
    Boolean(authenticatedAddress) &&
    sameAddress(address, authenticatedAddress);
  const onMonad = chainId === hexBountyMonad.id;
  const creatorCanPublish =
    jobComplete &&
    publicationMissing &&
    Boolean(contractAddress) &&
    isConnected &&
    onMonad &&
    walletIsCreator &&
    siweIsCreator &&
    siweMatches;
  const purchaseReady = isConnected && siweMatches && onMonad && Boolean(contractAddress) && !publicationMissing;
  const busy = displayPhase === "requesting" || displayPhase === "submitted" || displayPhase === "confirming";

  function resetTx() {
    setError(undefined);
    setHash(null);
    reset();
    handledHash.current = null;
  }

  async function purchase() {
    resetTx();
    setIntent("purchase");

    if (!contractAddress || publicationMissing || !publication) {
      setPhase("failed");
      setError("This game is not published on HexBountyPaidPlay yet.");
      return;
    }
    if (!isConnected || !address) {
      setPhase("failed");
      setError("Connect MetaMask first.");
      return;
    }
    if (!siweMatches) {
      setPhase("failed");
      setError("Sign in with the connected wallet before purchasing.");
      return;
    }
    if (!onMonad) {
      setPhase("failed");
      setError("Switch to Monad Testnet (chain id 10143).");
      return;
    }

    try {
      setPhase("requesting");
      const nextHash = await writeContractAsync({
        address: contractAddress,
        abi: hexBountyPaidPlayAbi,
        functionName: "purchaseAccess",
        args: [gameId],
        value: publication.playPrice,
        chainId: hexBountyMonad.id,
      });
      setHash(nextHash);
      setPhase("submitted");
    } catch (caught) {
      setPhase("failed");
      setError(caught instanceof Error ? caught.message : "Wallet rejected the purchase.");
    }
  }

  async function publish() {
    resetTx();
    setIntent("publish");

    if (!contractAddress) {
      setPhase("failed");
      setError("HexBountyPaidPlay is not configured.");
      return;
    }
    if (!isConnected || !address) {
      setPhase("failed");
      setError("Connect MetaMask first.");
      return;
    }
    if (!onMonad) {
      setPhase("failed");
      setError("Switch to Monad Testnet (chain id 10143).");
      return;
    }
    if (!walletIsCreator || !siweIsCreator || !siweMatches) {
      setPhase("failed");
      setError("Publish is only available to the creator signed in with the connected Monad wallet.");
      return;
    }

    const bountyId = parseDecimalNonnegative(bountyIdInput);
    if (bountyId === null) {
      setPhase("failed");
      setError("Bounty id must be a nonnegative decimal integer.");
      return;
    }
    const submissionId = parseUint32(submissionIdInput);
    if (submissionId === null) {
      setPhase("failed");
      setError("Submission id must be a uint32 decimal integer.");
      return;
    }
    if (!resultSha256) {
      setPhase("failed");
      setError("Reconstruction result SHA-256 is missing.");
      return;
    }
    const gameContentHash = normalizeGameContentHash(resultSha256);
    if (!gameContentHash) {
      setPhase("failed");
      setError("Result SHA-256 must be 64 hex characters, optionally prefixed with 0x.");
      return;
    }
    if (!priceMon) {
      setPhase("failed");
      setError("Listed price is missing.");
      return;
    }
    let playPrice: bigint;
    try {
      playPrice = parseEther(priceMon);
    } catch {
      setPhase("failed");
      setError("Listed price could not be parsed as ether.");
      return;
    }
    if (playPrice <= 0n) {
      setPhase("failed");
      setError("Listed price must be greater than zero.");
      return;
    }

    const metadataURI = `${window.location.origin}/api/games/${encodeURIComponent(slug)}/metadata?creator=${creatorAddress.toLowerCase()}`;

    try {
      setPhase("requesting");
      const nextHash = await writeContractAsync({
        address: contractAddress,
        abi: hexBountyPaidPlayAbi,
        functionName: "publishGame",
        args: [gameId, bountyId, submissionId, playPrice, gameContentHash, metadataURI],
        chainId: hexBountyMonad.id,
      });
      setHash(nextHash);
      setPhase("submitted");
    } catch (caught) {
      setPhase("failed");
      setError(caught instanceof Error ? caught.message : "Wallet rejected the publish.");
    }
  }

  if (!jobComplete) {
    return (
      <div className="grid gap-2">
        <p className="note">Reconstruction is not complete. Publish and purchase are unavailable until it finishes.</p>
      </div>
    );
  }

  if (!contractAddress) {
    return (
      <p className="note">
        Paid play is unavailable. HexBountyPaidPlay is not configured, so this listing is unpublished
        on chain and is not accessible by purchase.
      </p>
    );
  }

  if (publicationQuery.isLoading) {
    return <p className="note">Reading on-chain publication…</p>;
  }

  if (publicationMissing) {
    return (
      <div className="grid gap-3">
        {creatorCanPublish ? (
          <>
            <p className="note">
              This listing is unpublished. An accepted reconstruction result is required before
              you can publish a price. The upload flow already created its payment record; accept
              the reconstruction submission, then enter both record numbers below.
            </p>
            <label>
              Reconstruction payment id
              <input
                autoComplete="off"
                disabled={busy}
                inputMode="numeric"
                onChange={(event) => setBountyIdInput(event.target.value)}
                value={bountyIdInput}
              />
            </label>
            <label>
              Accepted submission id
              <input
                autoComplete="off"
                disabled={busy}
                inputMode="numeric"
                onChange={(event) => setSubmissionIdInput(event.target.value)}
                value={submissionIdInput}
              />
            </label>
            <Button disabled={busy} onClick={() => void publish()} type="button">
              Publish game
            </Button>
            <TxStatus
              error={displayPhase === "failed" ? error || receipt.error?.message : error}
              hash={hash ?? undefined}
              phase={displayPhase}
            />
            {displayPhase === "confirmed" && intent === "publish" && hash ? (
              <p className="note">
                Published on HexBountyPaidPlay after a confirmed receipt. Publication and access were
                rechecked.{" "}
                <a className="mono" href={explorerTx(hash)} rel="noreferrer" target="_blank">
                  {shortHash(hash, 6)}
                </a>
              </p>
            ) : null}
          </>
        ) : (
          <p className="note">
            This game is not published on HexBountyPaidPlay. The creator must publish it on the contract
            before anyone can purchase access. Missing or failed publication reads are treated as
            unpublished, never as access granted.
          </p>
        )}
      </div>
    );
  }

  const priceLabel = `${formatEther(publication.playPrice)} MON`;

  return (
    <div className="grid gap-3">
      <p>
        On-chain price <span className="mono">{priceLabel}</span>
      </p>
      {isCreator ? (
        <p className="note">You are the creator of this listing. Creator access does not require a purchase.</p>
      ) : hasAccess ? (
        <p className="note">On-chain access is recorded for the connected account. Play unlocks after the server rechecks access.</p>
      ) : (
        <>
          {!isConnected ? <p className="note">Connect MetaMask on Monad Testnet (10143) to purchase.</p> : null}
          {isConnected && !onMonad ? <p className="note">Switch to Monad Testnet (chain id 10143).</p> : null}
          {isConnected && onMonad && !siweMatches ? (
            <p className="note">Sign in with SIWE using the same connected address before purchasing.</p>
          ) : null}
          <Button disabled={!purchaseReady || busy} onClick={() => void purchase()} type="button">
            Purchase access
          </Button>
        </>
      )}
      <TxStatus
        error={displayPhase === "failed" ? error || receipt.error?.message : error}
        hash={hash ?? undefined}
        phase={displayPhase}
      />
      {displayPhase === "confirmed" && intent === "purchase" && hash ? (
        <p className="note">
          Transaction confirmed. Access is rechecked from the server before play is offered.{" "}
          <a className="mono" href={explorerTx(hash)} rel="noreferrer" target="_blank">
            {shortHash(hash, 6)}
          </a>
        </p>
      ) : null}
    </div>
  );
}
