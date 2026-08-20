"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { hexBountyAbi, UINT96_MAX } from "@/lib/abi";
import {
  formatDeadline,
  formatMon,
  isAbsoluteDiscoveryUri,
  isExpired,
  isHttpUrl,
  isMetadataUri,
  parsePositiveMon,
  toChainBounty,
  type ChainBounty,
} from "@/lib/bounties";
import { isBytes32 } from "@/lib/gas";
import { getContractConfig } from "@/lib/env";
import { explorerAddress, shortHash } from "@/lib/explorer";
import { useEscrowWrite } from "./useEscrowWrite";
import { TxStatus } from "./TxStatus";

function FormErrorList({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="form-errors" role="alert" aria-live="assertive" aria-atomic="true">
      {errors.map((item) => (
        <p className="field-error" key={item}>
          {item}
        </p>
      ))}
    </div>
  );
}

function DiscoveryLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  if (isAbsoluteDiscoveryUri(href)) {
    return (
      <a href={href} rel="noreferrer" target="_blank">
        {children}
      </a>
    );
  }
  return <a href={href}>{children}</a>;
}

export function BountyList() {
  const contract = getContractConfig();
  const enabled = contract.status === "configured";
  const { data: count } = useReadContract({
    address: enabled ? contract.address : undefined,
    abi: hexBountyAbi,
    functionName: "bountyCount",
    query: { enabled },
  });

  const ids = useMemo(() => {
    const n = count ? Number(count) : 0;
    return Array.from({ length: n }, (_, index) => BigInt(index + 1));
  }, [count]);

  const { data: results, isLoading } = useReadContracts({
    contracts: enabled
      ? ids.map((id) => ({
          address: contract.address,
          abi: hexBountyAbi,
          functionName: "getBounty" as const,
          args: [id] as const,
        }))
      : [],
    query: { enabled: enabled && ids.length > 0 },
  });

  const chainBounties: ChainBounty[] =
    results?.flatMap((result, index) => {
      if (result.status !== "success") return [];
      return [toChainBounty(ids[index], result.result)];
    }) ?? [];

  return (
    <div className="stack">
      {enabled && isLoading ? <p>Reading escrow…</p> : null}
      {enabled && !isLoading && chainBounties.length === 0 ? (
        <p className="note">No reconstruction funding records yet. Upload a game to create the first one.</p>
      ) : null}
      {chainBounties.map((bounty) => (
        <article className="bounty-card" key={bounty.id.toString()}>
          <p className="kicker">Funding record #{bounty.id.toString()}</p>
          <h2>
            <Link href={`/bounties/${bounty.id.toString()}`}>{bounty.metadataURI}</Link>
          </h2>
          <dl className="kv kv--inline">
            <div>
              <dt>State</dt>
              <dd>{bounty.state}</dd>
            </div>
            <div>
              <dt>Reward</dt>
              <dd>{formatMon(bounty.reward)}</dd>
            </div>
            <div>
              <dt>Deadline</dt>
              <dd>{formatDeadline(bounty.deadline)}</dd>
            </div>
            <div>
              <dt>Sponsor</dt>
              <dd>
                <a
                  className="mono"
                  href={explorerAddress(bounty.sponsor)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {shortHash(bounty.sponsor)}
                </a>
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export function CreateBountyForm() {
  const write = useEscrowWrite();
  const [metadataURI, setMetadataURI] = useState("");
  const [deadlineLocal, setDeadlineLocal] = useState("");
  const [reward, setReward] = useState("0.1");
  const [errors, setErrors] = useState<string[]>([]);

  function validate(): { deadline: bigint; value: bigint } | null {
    const next: string[] = [];
    if (!isMetadataUri(metadataURI)) {
      next.push("Metadata URI must be http(s), ipfs, arweave, or a root-relative path.");
    }
    const deadlineMs = Date.parse(deadlineLocal);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
      next.push("Deadline must be in the future.");
    }
    const parsedMon = parsePositiveMon(reward);
    if ("error" in parsedMon) next.push(`Reward: ${parsedMon.error}`);
    setErrors(next);
    if (next.length > 0 || !Number.isFinite(deadlineMs) || "error" in parsedMon) return null;
    return { deadline: BigInt(Math.floor(deadlineMs / 1000)), value: parsedMon.amount };
  }

  return (
    <form
      className="form"
      onSubmit={async (event) => {
        event.preventDefault();
        const parsed = validate();
        if (!parsed) return;
        await write.send("createBounty", [metadataURI.trim(), parsed.deadline], parsed.value);
      }}
    >
      <label>
        Metadata URI
        <input
          autoComplete="off"
          onChange={(event) => setMetadataURI(event.target.value)}
          placeholder="ipfs://… or https://…"
          required
          value={metadataURI}
        />
      </label>
          <label>
            Deadline (local time, stored as UTC unix seconds)
            <input
              onChange={(event) => setDeadlineLocal(event.target.value)}
              required
              type="datetime-local"
              value={deadlineLocal}
            />
          </label>
      <label>
        Initial escrow (testnet MON)
        <input
          inputMode="decimal"
          min="0"
          onChange={(event) => setReward(event.target.value)}
          required
          step="any"
          type="number"
          value={reward}
        />
      </label>
      <FormErrorList errors={errors} />
      <button className="button" disabled={!write.writesEnabled} type="submit">
        {write.writesEnabled
          ? "Create reconstruction funding"
          : write.contract.status !== "configured"
            ? "Unavailable in this preview"
            : "Connect MetaMask to create"}
      </button>
      <TxStatus phase={write.phase} hash={write.hash} error={write.error} />
    </form>
  );
}

export function ChainBountyDetail({ bounty }: { bounty: ChainBounty }) {
  const { address } = useAccount();
  const write = useEscrowWrite();
  const contract = getContractConfig();
  const enabled = contract.status === "configured";
  const expired = isExpired(bounty.deadline);
  const isSponsor = Boolean(address && address.toLowerCase() === bounty.sponsor.toLowerCase());

  const { data: submissionCount } = useReadContract({
    address: enabled ? contract.address : undefined,
    abi: hexBountyAbi,
    functionName: "getSubmissionCount",
    args: [bounty.id],
    query: { enabled },
  });

  const submissionIds = useMemo(() => {
    const n = submissionCount ? Number(submissionCount) : 0;
    return Array.from({ length: n }, (_, index) => index + 1);
  }, [submissionCount]);

  const { data: submissions } = useReadContracts({
    contracts:
      enabled && submissionIds.length > 0
        ? submissionIds.map((submissionId) => ({
            address: contract.address,
            abi: hexBountyAbi,
            functionName: "getSubmission" as const,
            args: [bounty.id, submissionId] as const,
          }))
        : [],
    query: { enabled: enabled && submissionIds.length > 0 },
  });

  const [fundAmount, setFundAmount] = useState("0.05");
  const [fundErrors, setFundErrors] = useState<string[]>([]);
  const [artifactHash, setArtifactHash] = useState("");
  const [evidenceHash, setEvidenceHash] = useState("");
  const [evidenceURI, setEvidenceURI] = useState("");
  const [liveURL, setLiveURL] = useState("");
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);

  const canFund = write.writesEnabled && bounty.state === "Open" && !expired;
  const canSubmit =
    write.writesEnabled && (bounty.state === "Open" || bounty.state === "Submitted") && !expired;
  const canAccept = write.writesEnabled && isSponsor && bounty.state === "Submitted";
  const canRefund =
    write.writesEnabled &&
    isSponsor &&
    expired &&
    (bounty.state === "Open" || bounty.state === "Submitted");

  return (
    <div className="stack">
      <section className="panel">
        <p className="kicker">Reconstruction funding #{bounty.id.toString()}</p>
        <h1>{bounty.metadataURI}</h1>
        <dl className="kv">
          <div>
            <dt>State</dt>
            <dd>{bounty.state}</dd>
          </div>
          <div>
            <dt>Reward</dt>
            <dd>{formatMon(bounty.reward)}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>
              {formatDeadline(bounty.deadline)}
              {expired ? " · expired" : ""}
            </dd>
          </div>
          <div>
            <dt>Sponsor</dt>
            <dd>
              <a
                className="mono"
                href={explorerAddress(bounty.sponsor)}
                rel="noreferrer"
                target="_blank"
              >
                {bounty.sponsor}
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <TxStatus phase={write.phase} hash={write.hash} error={write.error} />

      {canFund ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            const next: string[] = [];
            const parsedMon = parsePositiveMon(fundAmount);
            if ("error" in parsedMon) {
              next.push(`Fund amount: ${parsedMon.error}`);
            } else if (bounty.reward + parsedMon.amount > UINT96_MAX) {
              next.push("Total reward would exceed uint96.");
            }
            setFundErrors(next);
            if (next.length > 0 || "error" in parsedMon) return;
            await write.send("fundBounty", [bounty.id], parsedMon.amount);
          }}
        >
          <h2>Add reconstruction funding</h2>
          <label>
            Additional testnet MON
            <input
              min="0"
              onChange={(event) => setFundAmount(event.target.value)}
              step="any"
              type="number"
              value={fundAmount}
            />
          </label>
          <FormErrorList errors={fundErrors} />
          <button className="button" type="submit">
            Add funds
          </button>
        </form>
      ) : null}

      {canSubmit ? (
        <form
          className="form"
          onSubmit={async (event) => {
            event.preventDefault();
            const artifact = artifactHash.trim();
            const evidence = evidenceHash.trim();
            const evidenceUri = evidenceURI.trim();
            const live = liveURL.trim();
            const next: string[] = [];
            if (!isBytes32(artifact)) {
              next.push("Game file hash must be a 32-byte hex value (0x followed by 64 hex characters).");
            }
            if (!isBytes32(evidence)) {
              next.push("Analysis hash must be a 32-byte hex value (0x followed by 64 hex characters).");
            }
            if (!isMetadataUri(evidenceUri)) {
              next.push(
                "Analysis URI must be http(s), ipfs, arweave, or a root-relative path.",
              );
            }
            if (!isHttpUrl(live)) {
              next.push("Live URL must be an http or https URL.");
            }
            setSubmitErrors(next);
            if (next.length > 0 || !isBytes32(artifact) || !isBytes32(evidence)) return;
            await write.send("submitSolution", [
              bounty.id,
              artifact,
              evidence,
              evidenceUri,
              live,
            ]);
          }}
        >
          <h2>Submit solution</h2>
          <label>
            Game file hash
            <input
              className="mono"
              onChange={(event) => setArtifactHash(event.target.value)}
              placeholder="0x…"
              value={artifactHash}
            />
          </label>
          <label>
            Analysis hash
            <input
              className="mono"
              onChange={(event) => setEvidenceHash(event.target.value)}
              placeholder="0x…"
              value={evidenceHash}
            />
          </label>
          <label>
            Analysis URI
            <input onChange={(event) => setEvidenceURI(event.target.value)} value={evidenceURI} />
          </label>
          <label>
            Live URL
            <input onChange={(event) => setLiveURL(event.target.value)} value={liveURL} />
          </label>
          <FormErrorList errors={submitErrors} />
          <button className="button" type="submit">
            Submit
          </button>
        </form>
      ) : null}

      <section className="panel">
        <h2>Submissions</h2>
        {submissionIds.length === 0 ? <p>None yet.</p> : null}
        <ul className="submission-list">
          {submissions?.map((result, index) => {
            if (result.status !== "success") return null;
            const submission = result.result;
            const submissionId = submissionIds[index];
            return (
              <li key={submissionId}>
                <p>
                  #{submissionId} · builder{" "}
                  <a
                    className="mono"
                    href={explorerAddress(submission.builder)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {shortHash(submission.builder)}
                  </a>
                </p>
                <p className="mono">game file {submission.artifactHash}</p>
                <p className="mono">analysis {submission.evidenceHash}</p>
                <p>
                  <DiscoveryLink href={submission.evidenceURI}>analysis URI</DiscoveryLink>
                  {" · "}
                  <DiscoveryLink href={submission.liveURL}>live URL</DiscoveryLink>
                </p>
                {canAccept ? (
                  <button
                    className="button"
                    type="button"
                    onClick={() => write.send("acceptSolution", [bounty.id, submissionId])}
                  >
                    Accept #{submissionId}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {canRefund ? (
        <button
          className="button button--danger"
          type="button"
          onClick={() => write.send("refundExpiredBounty", [bounty.id])}
        >
          Refund expired funding
        </button>
      ) : null}
    </div>
  );
}

export function ChainBountyLoader({ id }: { id: bigint }) {
  const contract = getContractConfig();
  const { data, isLoading, error } = useReadContract({
    address: contract.status === "configured" ? contract.address : undefined,
    abi: hexBountyAbi,
    functionName: "getBounty",
    args: [id],
    query: { enabled: contract.status === "configured" },
  });

  if (contract.status !== "configured") {
    return <p className="note">Blockchain actions are unavailable in this preview.</p>;
  }
  if (isLoading) return <p>Reading funding record #{id.toString()}…</p>;
  if (error || !data) return <p className="field-error" role="alert">Funding record not found.</p>;
  return <ChainBountyDetail bounty={toChainBounty(id, data)} />;
}
