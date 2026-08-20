import "server-only";

import { getAddress, isAddress, type Address, type Hex } from "viem";
import type { OnChainLookup, ChainPublication } from "./paid-play";
import type { ModalJobResult, ModalJobStatus, ModalJobStatusResponse } from "./modal-jobs";

export class AdapterUnavailableError extends Error {
  constructor(message = "Durable game platform adapters are not configured") {
    super(message);
    this.name = "AdapterUnavailableError";
  }
}

export type AccessDecision = "allowed" | "denied";

export type OnChainPaidPlay = true | false | "unavailable";

export type SafePublication = {
  published: true;
  creator: Address;
  playPrice: string;
  bountyId: string;
  submissionId: number;
  purchaseCount: number;
  gameContentHash: Hex;
  metadataURI: string;
};

export type GameStatusPayload = {
  game: {
    slug: string;
    title: string;
    description: string;
    creatorAddress: Address;
    priceMon: string;
    rightsNote: string;
    rightsAttestedAt: string;
    bountyMon?: string;
    bountyTxHash?: string;
    bountyId?: string;
    bountyDeadline?: number;
    bountyMetadataURI?: string;
  };
  job: {
    jobId: string;
    status: ModalJobStatus;
    phase: string;
    progress: number;
    error: string | null;
    detail?: string;
    result?: ModalJobResult;
  };
  publication: SafePublication | null;
  viewer: {
    address: Address | null;
    isCreator: boolean;
    hasAccess: boolean;
  };
  ready: boolean;
};

export type ContentAddressedGameManifest = GameStatusPayload["game"] & {
  contentSha256: string | null;
  publication: SafePublication | null;
};

export type JobOwnerSelection =
  | { ok: true; owner: Address; publication: ChainPublication | null }
  | { ok: false; status: 401 | 503; error: string };

/**
 * ROM/play access is fail-closed: unpublished, RPC-unavailable, or a missing
 * viewer never grants bytes. On-chain creators are allowed only when the
 * contract lookup is available. In-memory listings are never selected here.
 */
export function decideGameAccess(input: {
  viewer: Address | null;
  creator: Address | null;
  published: boolean;
  onChainHasAccess: OnChainPaidPlay;
}): AccessDecision {
  if (input.onChainHasAccess === "unavailable") return "denied";
  if (!input.published || !input.creator) return "denied";
  if (!input.viewer || !isAddress(input.viewer)) return "denied";
  if (getAddress(input.viewer) === getAddress(input.creator)) return "allowed";
  if (input.onChainHasAccess === true) return "allowed";
  return "denied";
}

export function toSafePublication(input: {
  creator: Address;
  playPrice: bigint | string | number;
  bountyId: bigint | string | number;
  submissionId: number;
  purchaseCount: number;
  gameContentHash: Hex;
  metadataURI: string;
}): SafePublication {
  return {
    published: true,
    creator: getAddress(input.creator),
    playPrice: input.playPrice.toString(),
    bountyId: input.bountyId.toString(),
    submissionId: input.submissionId,
    purchaseCount: input.purchaseCount,
    gameContentHash: input.gameContentHash,
    metadataURI: input.metadataURI,
  };
}

export function sameAddress(left: string, right: string): boolean {
  if (!isAddress(left) || !isAddress(right)) return false;
  return getAddress(left) === getAddress(right);
}

const LEAKY_KEYS = [
  "sourceUrl",
  "fileKey",
  "serverOutputPath",
  "privateInputPath",
  "privateResultPath",
  "ufsUrl",
  "url",
] as const;

export function assertNoLeakyFields(value: unknown, label: string): void {
  const encoded = JSON.stringify(value);
  if (!encoded) return;
  for (const key of LEAKY_KEYS) {
    if (encoded.includes(`"${key}"`)) {
      throw new Error(`${label} leaked ${key}`);
    }
  }
}

export function selectJobOwner(input: {
  sessionAddress: Address | null;
  publication: OnChainLookup<ChainPublication | null>;
}): JobOwnerSelection {
  if (input.publication === "unavailable") {
    return { ok: false, status: 503, error: "Paid play registry is unavailable" };
  }
  if (input.publication) {
    return {
      ok: true,
      owner: getAddress(input.publication.creator),
      publication: input.publication,
    };
  }
  if (!input.sessionAddress) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  return {
    ok: true,
    owner: getAddress(input.sessionAddress),
    publication: null,
  };
}

export function resolveViewerHasAccess(input: {
  viewer: Address | null;
  owner: Address;
  onChainHasAccess: OnChainPaidPlay | false;
}): boolean {
  if (!input.viewer) return false;
  if (sameAddress(input.viewer, input.owner)) return true;
  return input.onChainHasAccess === true;
}

export function assembleGameStatus(input: {
  slug: string;
  owner: Address;
  sessionAddress: Address | null;
  modal: ModalJobStatusResponse;
  publication: SafePublication | null;
  hasAccess: boolean;
}): GameStatusPayload {
  const creatorAddress = getAddress(input.owner);
  const sessionAddress = input.sessionAddress ? getAddress(input.sessionAddress) : null;
  const isCreator = sessionAddress ? sameAddress(sessionAddress, creatorAddress) : false;
  const game = input.modal.game;
  const payload: GameStatusPayload = {
    game: {
      slug: input.slug,
      title: game?.title ?? input.slug,
      description: game?.description ?? "",
      creatorAddress,
      priceMon: game?.priceMon ?? "0",
      rightsNote: game?.rightsNote ?? "",
      rightsAttestedAt: game?.rightsAttestedAt ?? "",
    },
    job: {
      jobId: input.modal.jobId,
      status: input.modal.status,
      phase: input.modal.phase,
      progress: input.modal.progress,
      error: input.modal.error,
    },
    publication: input.publication,
    viewer: {
      address: sessionAddress,
      isCreator,
      hasAccess: input.hasAccess,
    },
    ready:
      input.modal.status === "complete" && input.publication !== null && input.hasAccess,
  };
  if (
    game?.bountyMon &&
    game.bountyTxHash &&
    game.bountyId &&
    game.bountyDeadline &&
    game.bountyMetadataURI
  ) {
    payload.game.bountyMon = game.bountyMon;
    payload.game.bountyTxHash = game.bountyTxHash;
    payload.game.bountyId = game.bountyId;
    payload.game.bountyDeadline = game.bountyDeadline;
    payload.game.bountyMetadataURI = game.bountyMetadataURI;
  }
  if (typeof input.modal.detail === "string" && input.modal.detail.length > 0) {
    payload.job.detail = input.modal.detail;
  }
  if (input.modal.result) {
    payload.job.result = {
      sha256: input.modal.result.sha256,
      bytes: input.modal.result.bytes,
      platform: input.modal.result.platform,
      extension: input.modal.result.extension,
      runStatus: input.modal.result.runStatus,
    };
    if (input.modal.result.quality) {
      payload.job.result.quality = input.modal.result.quality;
    }
  }
  assertNoLeakyFields(payload, "game status");
  return payload;
}

export function contentAddressedManifest(payload: GameStatusPayload): ContentAddressedGameManifest {
  return {
    ...payload.game,
    contentSha256: payload.job.result?.sha256 ?? null,
    publication: payload.publication,
  };
}

export function authorizeRomDownload(input: {
  viewer: Address | null;
  publication: SafePublication | null;
  onChainHasAccess: OnChainPaidPlay;
}):
  | { ok: true; publication: SafePublication }
  | { ok: false; status: 401 | 402 | 403 | 404 | 503; error: string } {
  if (!input.viewer) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  if (input.onChainHasAccess === "unavailable") {
    return { ok: false, status: 503, error: "Paid play registry is unavailable" };
  }
  if (input.publication === null) {
    return { ok: false, status: 404, error: "Game is not published" };
  }
  if (input.onChainHasAccess !== true) {
    return { ok: false, status: 402, error: "Payment required" };
  }
  const decision = decideGameAccess({
    viewer: input.viewer,
    creator: input.publication.creator,
    published: true,
    onChainHasAccess: true,
  });
  if (decision !== "allowed") {
    return { ok: false, status: 403, error: "Access denied" };
  }
  return { ok: true, publication: input.publication };
}
