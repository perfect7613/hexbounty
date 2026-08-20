import { getSessionFromRequest } from "@/lib/auth/session";
import { authorizeRomDownload, toSafePublication } from "@/lib/server/game-platform";
import { jsonError, modalErrorResponse, romAttachmentFilename, romProxyHeaders } from "@/lib/server/game-responses";
import {
  deriveJobId,
  getJobResult,
  getJobStatus,
  ModalJobError,
  toOwnerAddress,
  validateSlug,
} from "@/lib/server/modal-jobs";
import { readHasAccess, readPaidPlayAddress, readPublication } from "@/lib/server/paid-play";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return jsonError(401, "Authentication required");
  }

  try {
    const { slug: rawSlug } = await context.params;
    const slug = validateSlug(rawSlug);

    if (!readPaidPlayAddress()) {
      return jsonError(503, "Paid play registry is unavailable");
    }

    const publicationLookup = await readPublication({ slug });
    if (publicationLookup === "unavailable") {
      return jsonError(503, "Paid play registry is unavailable");
    }
    const publication = publicationLookup ? toSafePublication(publicationLookup) : null;
    const onChainHasAccess = await readHasAccess({ slug, account: session.address });
    const authorized = authorizeRomDownload({
      viewer: session.address,
      publication,
      onChainHasAccess,
    });
    if (!authorized.ok) {
      return jsonError(authorized.status, authorized.error);
    }

    const owner = toOwnerAddress(authorized.publication.creator);
    const jobId = await deriveJobId(owner, slug);
    const status = await getJobStatus(jobId, owner);
    if (status.status !== "complete" || !status.result?.sha256) {
      return jsonError(409, "Game is not ready");
    }

    const upstream = await getJobResult(jobId, owner);
    const filename = romAttachmentFilename(slug, status.result.extension);
    return new Response(upstream.body, {
      status: 200,
      headers: romProxyHeaders(filename),
    });
  } catch (error) {
    if (error instanceof ModalJobError) {
      return modalErrorResponse(error);
    }
    return jsonError(500, "Unexpected error");
  }
}
