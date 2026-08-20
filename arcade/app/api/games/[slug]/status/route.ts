import { getAddress } from "viem";
import { getSessionFromRequest } from "@/lib/auth/session";
import {
  assembleGameStatus,
  resolveViewerHasAccess,
  selectJobOwner,
  toSafePublication,
} from "@/lib/server/game-platform";
import { jsonError, jsonOk, modalErrorResponse } from "@/lib/server/game-responses";
import { deriveJobId, getJobStatus, ModalJobError, toOwnerAddress, validateSlug } from "@/lib/server/modal-jobs";
import { readHasAccess, readPublication } from "@/lib/server/paid-play";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = await getSessionFromRequest(request);
  try {
    const { slug: rawSlug } = await context.params;
    const slug = validateSlug(rawSlug);
    const publicationLookup = await readPublication({ slug });
    if (publicationLookup === "unavailable") {
      return jsonError(503, "Paid play registry is unavailable");
    }
    if (!publicationLookup && !session) {
      return jsonError(401, "Authentication required");
    }
    const ownerSelection = selectJobOwner({
      sessionAddress: session?.address ?? null,
      publication: publicationLookup,
    });
    if (!ownerSelection.ok) {
      return jsonError(ownerSelection.status, ownerSelection.error);
    }

    const owner = getAddress(ownerSelection.owner);
    const jobId = await deriveJobId(toOwnerAddress(owner), slug);
    const modal = await getJobStatus(jobId, toOwnerAddress(owner));

    let onChainHasAccess: boolean | "unavailable" | false = false;
    if (ownerSelection.publication && session) {
      onChainHasAccess = await readHasAccess({ slug, account: session.address });
    }

    const hasAccess = resolveViewerHasAccess({
      viewer: session?.address ?? null,
      owner,
      onChainHasAccess,
    });

    const publication = ownerSelection.publication
      ? toSafePublication(ownerSelection.publication)
      : null;

    return jsonOk(
      assembleGameStatus({
        slug,
        owner,
        sessionAddress: session?.address ?? null,
        modal,
        publication,
        hasAccess,
      }),
    );
  } catch (error) {
    if (error instanceof ModalJobError) {
      return modalErrorResponse(error);
    }
    return jsonError(500, "Unexpected error");
  }
}
