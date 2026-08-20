import "server-only";

import { getAddress } from "viem";
import { MONAD_EXPLORER_ORIGIN } from "../env";
import { assertNoLeakyFields } from "./game-platform";
import {
  ModalJobError,
  OWNER_RE,
  romExtensionFromFilename,
  validateSlug,
  type ModalJobStatusResponse,
  type RomExtension,
} from "./modal-jobs";
import { readPaidPlayAddress } from "./paid-play";

export type PublicGameMetadata = {
  name: string;
  title: string;
  description: string;
  slug: string;
  creator: string;
  priceMon: string;
  rightsNote: string;
  rightsAttestedAt: string;
  platform: string;
  extension: RomExtension;
  sha256: string;
  bytes: number;
  external_url: string;
  contract?: string;
  explorer?: string;
};

export function jsonError(status: number, error: string): Response {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export function jsonOk(body: unknown, status = 200): Response {
  assertNoLeakyFields(body, "json response");
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

export function modalErrorResponse(error: unknown): Response {
  if (error instanceof ModalJobError) {
    if (error.message.includes("slug must")) {
      return jsonError(400, "Invalid slug");
    }
    if (error.message.includes("owner must") || error.message.includes("creator")) {
      return jsonError(400, "Invalid creator");
    }
    const status = error.status;
    if (status === 404) return jsonError(404, "Job not found");
    if (status === 401 || status === 403) return jsonError(502, "Job lookup failed");
    if (error.message.includes(" is required")) {
      return jsonError(503, "Reconstruction service is unavailable");
    }
    return jsonError(502, "Job lookup failed");
  }
  return jsonError(500, "Unexpected error");
}

export function parseLowercaseCreatorQuery(value: string | null): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (!OWNER_RE.test(value)) return null;
  return value;
}

export function resolvePublicOrigin(input: {
  request: Request;
  env?: NodeJS.Dict<string>;
}): string | null {
  const env = input.env ?? process.env;
  const configured = typeof env.NEXT_PUBLIC_SITE_URL === "string" ? env.NEXT_PUBLIC_SITE_URL.trim() : "";
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request origin
    }
  }
  try {
    return new URL(input.request.url).origin;
  } catch {
    return null;
  }
}

export function romAttachmentFilename(slug: string, extension: RomExtension): string {
  const safeSlug = validateSlug(slug);
  const ext = romExtensionFromFilename(`rom${extension}`);
  return `${safeSlug}${ext}`;
}

export function romProxyHeaders(filename: string): HeadersInit {
  return {
    "content-type": "application/octet-stream",
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store, max-age=0",
    "x-content-type-options": "nosniff",
  };
}

export function jobMatchesCreatorSlug(
  modal: ModalJobStatusResponse,
  slug: string,
  jobId: string,
): boolean {
  if (modal.jobId !== jobId) return false;
  if (modal.status !== "complete") return false;
  if (!modal.game || modal.game.slug !== slug) return false;
  if (!modal.result?.sha256) return false;
  return true;
}

export function buildPublicGameMetadata(input: {
  slug: string;
  creator: string;
  modal: ModalJobStatusResponse;
  origin: string;
  env?: NodeJS.Dict<string>;
}): PublicGameMetadata {
  const slug = validateSlug(input.slug);
  const creator = getAddress(input.creator);
  const game = input.modal.game;
  const result = input.modal.result;
  if (!game || !result) {
    throw new ModalJobError("Public metadata is not ready");
  }
  if (game.slug !== slug) {
    throw new ModalJobError("Metadata slug does not match");
  }
  const payload: PublicGameMetadata = {
    name: game.title,
    title: game.title,
    description: game.description,
    slug,
    creator,
    priceMon: game.priceMon,
    rightsNote: game.rightsNote,
    rightsAttestedAt: game.rightsAttestedAt,
    platform: result.platform,
    extension: result.extension,
    sha256: result.sha256,
    bytes: result.bytes,
    external_url: `${input.origin}/games/${slug}`,
  };
  const contract = readPaidPlayAddress(input.env);
  if (contract) {
    payload.contract = contract;
    payload.explorer = `${MONAD_EXPLORER_ORIGIN}/address/${contract}`;
  }
  assertNoLeakyFields(payload, "public metadata");
  return payload;
}
