"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getAddress, parseEther, parseEventLogs, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { hexBountyMonad } from "@/lib/chain";
import { hexBountyAbi } from "@/lib/abi";
import { getContractConfig } from "@/lib/env";
import { estimateEscrowGas } from "@/lib/gas";
import { useUploadThing } from "@/lib/uploadthing-client";
import {
  gameMetadataSchema,
  MAX_ROM_BYTES,
  validateRomUploadFiles,
} from "@/lib/uploads/schema";
import { Button } from "@/components/ui/button";
import { createWalletSession } from "@/components/WalletAuthStatus";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ATTESTATION_LABEL = "I own this game or have permission to upload and process it.";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 48;
const RIGHTS_NOTE_MIN = 10;
const RIGHTS_NOTE_MAX = 240;
const PRICE_MON_RE = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const PRICE_MON_MAX_LENGTH = 36;
const PRICE_MON_MAX = 1_000_000n;
const PRICE_MON_MAX_DECIMALS = 18;
const BOUNTY_DURATION_SECONDS = 7 * 24 * 60 * 60;

function isAllowedPriceMon(value: string): boolean {
  if (value.length > PRICE_MON_MAX_LENGTH) return false;
  if (!PRICE_MON_RE.test(value)) return false;
  const [wholeRaw, fracRaw = ""] = value.split(".");
  if (fracRaw.length > PRICE_MON_MAX_DECIMALS) return false;
  const whole = BigInt(wholeRaw ?? "0");
  const fracSignificant = fracRaw.replace(/0+$/, "");
  if (whole === 0n && fracSignificant.length === 0) return false;
  const [integer, fraction = ""] = value.split(".");
  const wei = BigInt(integer) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  return wei <= PRICE_MON_MAX * 10n ** 18n;
}

type SessionResponse =
  | { authenticated: false }
  | { authenticated: true; address: string; chainId: number }
  | { error: string };

type AuthSession =
  | { status: "loading" }
  | { status: "unavailable"; error: string }
  | { status: "anonymous" }
  | { status: "authenticated"; address: Address; chainId: number };

type FieldErrors = Partial<
  Record<
    "file" | "title" | "slug" | "description" | "priceMon" | "bountyMon" | "rightsNote" | "rightsAttestation",
    string
  >
>;

type QueuedUpload = {
  slug: string;
  jobId: string;
  status: string;
};

type ConfirmedBounty = {
  bountyId: string;
  bountyMon: string;
  deadline: number;
  metadataURI: string;
  slug: string;
  txHash: Hex;
};

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function withAllowedRomType(file: File): File {
  const type = file.type.trim();
  if (
    type === "application/octet-stream" ||
    type === "application/x-gameboy-rom" ||
    type === "application/x-gameboy-color-rom"
  ) {
    return file;
  }
  return new File([file], file.name, {
    type: "application/octet-stream",
    lastModified: file.lastModified,
  });
}

function readQueued(serverData: unknown): QueuedUpload | null {
  if (!serverData || typeof serverData !== "object") return null;
  const record = serverData as Record<string, unknown>;
  if (typeof record.slug !== "string" || !record.slug) return null;
  if (typeof record.jobId !== "string" || !record.jobId) return null;
  if (typeof record.status !== "string" || !record.status) return null;
  return { slug: record.slug, jobId: record.jobId, status: record.status };
}

export function readRetryableBounty(
  value: unknown,
  expected: {
    owner: Address;
    slug: string;
    bountyMon: string;
    metadataURI: string;
    nowSeconds: number;
  },
): ConfirmedBounty | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const job = record.job;
  const game = record.game;
  if (!job || typeof job !== "object" || Array.isArray(job)) return null;
  if (!game || typeof game !== "object" || Array.isArray(game)) return null;
  const jobRecord = job as Record<string, unknown>;
  const gameRecord = game as Record<string, unknown>;
  if (jobRecord.status !== "rejected") return null;
  if (gameRecord.slug !== expected.slug) return null;
  if (
    typeof gameRecord.creatorAddress !== "string" ||
    !sameAddress(gameRecord.creatorAddress, expected.owner)
  ) {
    return null;
  }
  if (
    gameRecord.bountyMon !== expected.bountyMon ||
    gameRecord.bountyMetadataURI !== expected.metadataURI ||
    typeof gameRecord.bountyId !== "string" ||
    !/^[1-9][0-9]{0,77}$/.test(gameRecord.bountyId) ||
    typeof gameRecord.bountyTxHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(gameRecord.bountyTxHash) ||
    typeof gameRecord.bountyDeadline !== "number" ||
    !Number.isSafeInteger(gameRecord.bountyDeadline) ||
    gameRecord.bountyDeadline <= expected.nowSeconds
  ) {
    return null;
  }
  return {
    bountyId: gameRecord.bountyId,
    bountyMon: expected.bountyMon,
    deadline: gameRecord.bountyDeadline,
    metadataURI: expected.metadataURI,
    slug: expected.slug,
    txHash: gameRecord.bountyTxHash.toLowerCase() as Hex,
  };
}

async function fetchAuthSession(): Promise<AuthSession> {
  try {
    const response = await fetch("/api/auth/session", { credentials: "same-origin" });
    const data = (await response.json()) as SessionResponse;
    if ("error" in data && data.error) {
      return { status: "unavailable", error: data.error };
    }
    if ("authenticated" in data && data.authenticated && data.address) {
      return {
        status: "authenticated",
        address: getAddress(data.address),
        chainId: data.chainId,
      };
    }
    return { status: "anonymous" };
  } catch {
    return { status: "unavailable", error: "Could not read session." };
  }
}

export function GameUploadForm() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: hexBountyMonad.id });
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const contract = getContractConfig();
  const [session, setSession] = useState<AuthSession>({ status: "loading" });
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [priceMon, setPriceMon] = useState("");
  const [bountyMon, setBountyMon] = useState("0.01");
  const [rightsNote, setRightsNote] = useState("");
  const [rightsAttestation, setRightsAttestation] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [uploadError, setUploadError] = useState<string>();
  const [progress, setProgress] = useState<number | null>(null);
  const [queued, setQueued] = useState<QueuedUpload | null>(null);
  const [confirmedBounty, setConfirmedBounty] = useState<ConfirmedBounty | null>(null);
  const [paymentStage, setPaymentStage] = useState<
    "idle" | "signin" | "wallet" | "confirming" | "confirmed"
  >("idle");

  const walletAddress = address ? getAddress(address) : undefined;
  const onMonad = chainId === hexBountyMonad.id;
  const sessionMatchesWallet =
    session.status === "authenticated" &&
    Boolean(walletAddress) &&
    sameAddress(session.address, walletAddress ?? "");
  const canStart = Boolean(
    isConnected &&
      walletAddress &&
      onMonad &&
      publicClient &&
      contract.status === "configured",
  );

  const refreshSession = useCallback(async () => {
    const next = await fetchAuthSession();
    setSession(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchAuthSession();
      if (!cancelled) setSession(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, chainId]);

  useEffect(() => {
    if (sessionMatchesWallet) return;
    const timer = window.setInterval(() => {
      void refreshSession();
    }, 3000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshSession();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sessionMatchesWallet, refreshSession]);

  const { startUpload, isUploading } = useUploadThing("gameRom", {
    uploadProgressGranularity: "fine",
    onUploadProgress: (value) => setProgress(value),
    onUploadError: (error) => {
      setQueued(null);
      setUploadError(error.message || "Upload failed.");
    },
    onClientUploadComplete: (files) => {
      const receipt = readQueued(files[0]?.serverData);
      if (receipt) setQueued(receipt);
    },
  });

  function gateMessage(): string {
    if (session.status === "loading") return "Checking sign-in session…";
    if (session.status === "unavailable") return session.error;
    if (!isConnected || !walletAddress) return "Connect MetaMask before uploading.";
    if (!onMonad) return "Switch to Monad Testnet (10143) before uploading.";
    if (session.status !== "authenticated" || !sessionMatchesWallet) {
      return "Continue once: MetaMask will verify this wallet, then open the reconstruction payment.";
    }
    if (contract.status !== "configured") return "Reconstruction escrow is unavailable.";
    return "";
  }

  function validate(): { file: File; metadata: ReturnType<typeof gameMetadataSchema.parse> } | null {
    const next: FieldErrors = {};

    if (!file) {
      next.file = "Choose one .gb or .gbc file, at most 8MB.";
    } else {
      const prepared = withAllowedRomType(file);
      const rom = validateRomUploadFiles([
        { name: prepared.name, size: prepared.size, type: prepared.type },
      ]);
      if (!rom.ok) next.file = rom.error;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) next.title = "Title is required.";
    else if (trimmedTitle.length > 80) next.title = "Title must be at most 80 characters.";

    if (!SLUG_RE.test(slug) || slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
      next.slug = `Slug must be lowercase letters, digits, and single hyphens (${SLUG_MIN} to ${SLUG_MAX} characters).`;
    }

    const trimmedDescription = description.trim();
    if (!trimmedDescription) next.description = "Description is required.";
    else if (trimmedDescription.length > 500) {
      next.description = "Description must be at most 500 characters.";
    }

    if (!isAllowedPriceMon(priceMon)) {
      next.priceMon =
        "Price must be a positive amount of at most 1,000,000 MON with at most 18 decimals.";
    }
    if (!isAllowedPriceMon(bountyMon)) {
      next.bountyMon =
        "Reward must be a positive amount of at most 1,000,000 MON with at most 18 decimals.";
    }

    const trimmedNote = rightsNote.trim();
    if (trimmedNote.length < RIGHTS_NOTE_MIN) {
      next.rightsNote = `Rights note must be at least ${RIGHTS_NOTE_MIN} characters.`;
    } else if (trimmedNote.length > RIGHTS_NOTE_MAX) {
      next.rightsNote = `Rights note must be at most ${RIGHTS_NOTE_MAX} characters.`;
    }

    if (!rightsAttestation) {
      next.rightsAttestation = "You must check the rights attestation.";
    }

    const parsed = gameMetadataSchema.safeParse({
      title,
      slug,
      description,
      priceMon,
      rightsAttestation: rightsAttestation ? true : false,
      rightsNote,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "title" && !next.title) next.title = "Enter a title between 1 and 80 characters.";
        if (key === "slug" && !next.slug) {
          next.slug = `Slug must be lowercase letters, digits, and single hyphens (${SLUG_MIN} to ${SLUG_MAX} characters).`;
        }
        if (key === "description" && !next.description) {
          next.description = "Enter a description between 1 and 500 characters.";
        }
        if (key === "priceMon" && !next.priceMon) {
          next.priceMon =
            "Price must be a positive amount of at most 1,000,000 MON with at most 18 decimals.";
        }
        if (key === "rightsNote" && !next.rightsNote) {
          next.rightsNote = `Rights note must be between ${RIGHTS_NOTE_MIN} and ${RIGHTS_NOTE_MAX} characters.`;
        }
        if (key === "rightsAttestation" && !next.rightsAttestation) {
          next.rightsAttestation = "You must check the rights attestation.";
        }
      }
    }

    setFieldErrors(next);
    if (Object.keys(next).length > 0 || !file || !parsed.success) return null;
    return { file: withAllowedRomType(file), metadata: parsed.data };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUploadError(undefined);
    setQueued(null);

    if (!isConnected || !walletAddress || !onMonad) {
      setUploadError("Connect MetaMask on Monad Testnet before continuing.");
      return;
    }

    const parsed = validate();
    if (!parsed) return;

    setProgress(0);
    try {
      if (!publicClient || contract.status !== "configured") {
        throw new Error("Reconstruction escrow is unavailable.");
      }
      const latest = await refreshSession();
      const latestMatches =
        latest.status === "authenticated" && sameAddress(latest.address, walletAddress);
      if (!latestMatches) {
        setPaymentStage("signin");
        const verifiedAddress = await createWalletSession({
          walletAddress,
          chainId,
          signMessage: (message) => signMessageAsync({ message }),
        });
        if (!sameAddress(verifiedAddress, walletAddress)) {
          throw new Error("Verified wallet does not match the connected account.");
        }
        setSession({
          status: "authenticated",
          address: verifiedAddress,
          chainId: hexBountyMonad.id,
        });
        setPaymentStage("idle");
      }
      const metadataURI = `${window.location.origin}/api/games/${encodeURIComponent(parsed.metadata.slug)}/metadata?creator=${walletAddress.toLowerCase()}`;
      let payment = confirmedBounty;
      if (
        !payment ||
        payment.slug !== parsed.metadata.slug ||
        payment.bountyMon !== bountyMon ||
        payment.metadataURI !== metadataURI
      ) {
        const availability = await fetch(
          `/api/games/${encodeURIComponent(parsed.metadata.slug)}/status`,
          { credentials: "same-origin" },
        );
        if (availability.ok) {
          const existing = readRetryableBounty(await availability.json(), {
            owner: walletAddress,
            slug: parsed.metadata.slug,
            bountyMon,
            metadataURI,
            nowSeconds: Math.floor(Date.now() / 1000),
          });
          if (!existing) {
            throw new Error("This wallet already used that slug. Choose a new slug before paying.");
          }
          payment = existing;
          setConfirmedBounty(existing);
          setPaymentStage("confirmed");
        }
        if (!payment && availability.status !== 404) {
          throw new Error("Could not confirm slug availability. No payment was created.");
        }
        if (!payment) {
          const deadline = Math.floor(Date.now() / 1000) + BOUNTY_DURATION_SECONDS;
          const value = parseEther(bountyMon);
          setPaymentStage("wallet");
          const gas = await estimateEscrowGas(publicClient, {
            account: walletAddress,
            address: contract.address,
            functionName: "createBounty",
            args: [metadataURI, BigInt(deadline)],
            value,
          });
          const txHash = await writeContractAsync({
            address: contract.address,
            abi: hexBountyAbi,
            functionName: "createBounty",
            args: [metadataURI, BigInt(deadline)],
            value,
            gas,
            chainId: hexBountyMonad.id,
          });
          setPaymentStage("confirming");
          const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            confirmations: 1,
          });
          if (receipt.status !== "success") throw new Error("Reconstruction payment reverted.");
          const events = parseEventLogs({
            abi: hexBountyAbi,
            eventName: "BountyCreated",
            logs: receipt.logs,
            strict: true,
          });
          const event = events.find(
            (entry) => getAddress(entry.args.sponsor) === walletAddress,
          );
          if (!event) throw new Error("Confirmed transaction did not emit BountyCreated.");
          payment = {
            bountyId: event.args.bountyId.toString(),
            bountyMon,
            deadline,
            metadataURI,
            slug: parsed.metadata.slug,
            txHash,
          };
          setConfirmedBounty(payment);
          setPaymentStage("confirmed");
        }
      }
      const uploaded = await startUpload([parsed.file], {
        ...parsed.metadata,
        bountyMon: payment.bountyMon,
        bountyTxHash: payment.txHash,
        bountyId: payment.bountyId,
        bountyDeadline: payment.deadline,
        bountyMetadataURI: payment.metadataURI,
      });
      const receipt = readQueued(uploaded?.[0]?.serverData);
      if (receipt) {
        setQueued(receipt);
        setProgress(100);
        return;
      }
      if (uploaded) {
        setUploadError("Upload finished without a reconstruction queue receipt.");
      }
    } catch (caught) {
      setQueued(null);
      setPaymentStage(confirmedBounty ? "confirmed" : "idle");
      setUploadError(caught instanceof Error ? caught.message : "Upload failed.");
    }
  }

  const blockedReason = gateMessage();
  const processing =
    isUploading ||
    paymentStage === "signin" ||
    paymentStage === "wallet" ||
    paymentStage === "confirming";
  const progressLabel =
    isUploading && progress !== null
      ? `Uploading ${progress}%`
      : isUploading
        ? "Uploading…"
        : null;

  return (
    <Card>
      <CardHeader>
        <p className="kicker">Temporary upload</p>
        <CardTitle>Upload a Game Boy ROM</CardTitle>
        <CardDescription>
          Pay the reconstruction reward on Monad, upload the ROM, and start reconstruction in one
          flow. The temporary source file is deleted after a secure handoff.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="form" onSubmit={(event) => void onSubmit(event)}>
          <label>
            Game Boy ROM
            <input
              accept=".gb,.gbc"
              disabled={processing}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setFieldErrors((current) => ({ ...current, file: undefined }));
              }}
              required
              type="file"
            />
          </label>
          <p className="note">
            Exactly one local <code>.gb</code> or <code>.gbc</code> file, at most{" "}
            {MAX_ROM_BYTES / (1024 * 1024)}MB. Public links are rejected.
          </p>
          {file ? (
            <p className="note">
              Selected {file.name} ({file.size.toLocaleString()} bytes). File bytes stay off this
              page.
            </p>
          ) : null}
          {fieldErrors.file ? (
            <p className="field-error" role="alert">
              {fieldErrors.file}
            </p>
          ) : null}

          <label>
            Title
            <input
              autoComplete="off"
              disabled={processing}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          {fieldErrors.title ? (
            <p className="field-error" role="alert">
              {fieldErrors.title}
            </p>
          ) : null}

          <label>
            URL slug
            <input
              autoComplete="off"
              disabled={processing}
              maxLength={SLUG_MAX}
              minLength={SLUG_MIN}
              onChange={(event) => {
                setSlug(event.target.value.toLowerCase());
                setConfirmedBounty(null);
              }}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="pocket-quest"
              required
              spellCheck={false}
              value={slug}
            />
          </label>
          <p className="note">
            Lowercase letters, digits, and single hyphens; {SLUG_MIN} to {SLUG_MAX} characters.
          </p>
          {fieldErrors.slug ? (
            <p className="field-error" role="alert">
              {fieldErrors.slug}
            </p>
          ) : null}

          <label>
            Description
            <textarea
              disabled={processing}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              required
              rows={4}
              value={description}
            />
          </label>
          {fieldErrors.description ? (
            <p className="field-error" role="alert">
              {fieldErrors.description}
            </p>
          ) : null}

          <label>
            Reconstruction reward (MON)
            <input
              autoComplete="off"
              disabled={processing}
              inputMode="decimal"
              maxLength={PRICE_MON_MAX_LENGTH}
              onChange={(event) => {
                setBountyMon(event.target.value.trim());
                setConfirmedBounty(null);
              }}
              placeholder="0.01"
              required
              value={bountyMon}
            />
          </label>
          <p className="note">
            This reward is held on Monad before the upload starts. If the upload later fails, the
            confirmed payment remains on-chain and can be refunded after its
            seven-day deadline.
          </p>
          {fieldErrors.bountyMon ? (
            <p className="field-error" role="alert">
              {fieldErrors.bountyMon}
            </p>
          ) : null}

          <label>
            Player access price (MON)
            <input
              autoComplete="off"
              disabled={processing}
              inputMode="decimal"
              maxLength={PRICE_MON_MAX_LENGTH}
              onChange={(event) => setPriceMon(event.target.value.trim())}
              placeholder="1.5"
              required
              value={priceMon}
            />
          </label>
          <p className="note">
            What other wallets pay after you publish the reconstructed game. Maximum 1,000,000
            MON with at most {PRICE_MON_MAX_DECIMALS} decimals.
          </p>
          {fieldErrors.priceMon ? (
            <p className="field-error" role="alert">
              {fieldErrors.priceMon}
            </p>
          ) : null}

          <label>
            Rights note
            <textarea
              disabled={processing}
              maxLength={RIGHTS_NOTE_MAX}
              minLength={RIGHTS_NOTE_MIN}
              onChange={(event) => setRightsNote(event.target.value)}
              required
              rows={3}
              value={rightsNote}
            />
          </label>
          <p className="note">
            {RIGHTS_NOTE_MIN} to {RIGHTS_NOTE_MAX} characters after trim.
          </p>
          {fieldErrors.rightsNote ? (
            <p className="field-error" role="alert">
              {fieldErrors.rightsNote}
            </p>
          ) : null}

          <div className="rights-attestation">
            <label
              htmlFor="rights-attestation"
            >
              <input
                checked={rightsAttestation}
                disabled={processing}
                id="rights-attestation"
                onChange={(event) => setRightsAttestation(event.target.checked)}
                required
                type="checkbox"
              />
              <span>{ATTESTATION_LABEL}</span>
            </label>
            {fieldErrors.rightsAttestation ? (
              <p className="field-error" role="alert">
                {fieldErrors.rightsAttestation}
              </p>
            ) : null}
          </div>

          <p className="note">
            MetaMask confirms the reconstruction payment first. Upload and reconstruction start
            only after the transaction is confirmed.
          </p>

          {blockedReason ? (
            <p className="note" role="status">
              {blockedReason}
            </p>
          ) : (
            <p className="note" role="status">
              Connected on Monad {hexBountyMonad.id} and authenticated as {walletAddress}.
            </p>
          )}

          {progressLabel ? (
            <p role="status">
              {progressLabel}
              {progress !== null ? (
                <progress
                  aria-label="Upload progress"
                  max={100}
                  value={progress}
                  style={{ display: "block", marginTop: "0.4rem", width: "100%" }}
                />
              ) : null}
            </p>
          ) : null}

          {paymentStage === "signin" ? (
            <p role="status">Verify the connected wallet in MetaMask…</p>
          ) : null}
          {paymentStage === "wallet" ? <p role="status">Confirm the reconstruction payment in MetaMask…</p> : null}
          {paymentStage === "confirming" ? (
            <p role="status">Waiting for the Monad payment…</p>
          ) : null}
          {confirmedBounty ? (
            <p className="note" role="status">
              Reconstruction #{confirmedBounty.bountyId} funded with {confirmedBounty.bountyMon} MON. This
              confirmed payment will be reused if you retry the upload without changing the slug or
              reward amount.
            </p>
          ) : null}

          {uploadError ? (
            <p className="field-error" role="alert">
              {uploadError}
            </p>
          ) : null}

          {queued ? (
            <div role="status">
              <p>Queued for reconstruction.</p>
              <dl className="kv">
                <div>
                  <dt>Slug</dt>
                  <dd className="mono">{queued.slug}</dd>
                </div>
                <div>
                  <dt>Job</dt>
                  <dd className="mono">{queued.jobId}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{queued.status}</dd>
                </div>
              </dl>
              <p>
                Monitor the game page for reconstruction. Payment #{confirmedBounty?.bountyId ?? "—"}
                is already funded; after the result is ready, submit and accept it before publishing.
              </p>
              <p>
                <Link href={`/games/${queued.slug}`}>Open /games/{queued.slug}</Link>
              </p>
            </div>
          ) : null}

          <Button disabled={!canStart || processing} type="submit">
            {paymentStage === "signin"
              ? "Verify in MetaMask"
              : paymentStage === "wallet"
              ? "Confirm in MetaMask"
              : paymentStage === "confirming"
                ? "Confirming payment…"
                : isUploading
                  ? "Uploading…"
                  : canStart
                    ? sessionMatchesWallet
                      ? "Pay & start reconstruction"
                      : "Verify, pay & start reconstruction"
                    : !isConnected
                      ? "Connect wallet to continue"
                      : !onMonad
                        ? "Switch to Monad Testnet"
                        : "Preparing network…"}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <p className="note">
          This form never shows file contents, storage keys, or private object URLs.
        </p>
      </CardFooter>
    </Card>
  );
}
