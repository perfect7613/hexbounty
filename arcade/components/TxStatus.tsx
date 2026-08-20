"use client";

import { explorerTx, shortHash } from "@/lib/explorer";

export type TxPhase =
  | "idle"
  | "requesting"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export function TxStatus({
  phase,
  hash,
  error,
}: {
  phase: TxPhase;
  hash?: `0x${string}`;
  error?: string;
}) {
  if (phase === "idle") return null;

  const label =
    phase === "requesting"
      ? "Waiting for MetaMask approval"
      : phase === "submitted"
        ? "Submitted — awaiting inclusion"
        : phase === "confirming"
          ? "Confirming on Monad Testnet"
          : phase === "confirmed"
            ? "Confirmed"
            : "Failed";

  return (
    <div
      className={`tx-status tx-status--${phase}`}
      role="status"
      aria-live={phase === "failed" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      <span className="tx-status__phase">{label}</span>
      {hash ? (
        <a className="mono" href={explorerTx(hash)} rel="noreferrer" target="_blank">
          {shortHash(hash, 6)}
        </a>
      ) : null}
      {error && (phase === "failed" || phase === "requesting") ? (
        <p className="field-error">{error}</p>
      ) : null}
    </div>
  );
}
