import {
  buildPublicGameMetadata,
  jsonError,
  jsonOk,
  jobMatchesCreatorSlug,
  modalErrorResponse,
  parseLowercaseCreatorQuery,
  resolvePublicOrigin,
} from "@/lib/server/game-responses";
import { deriveJobId, getJobStatus, ModalJobError, validateOwner, validateSlug } from "@/lib/server/modal-jobs";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { slug: rawSlug } = await context.params;
    const slug = validateSlug(rawSlug);
    const creatorRaw = parseLowercaseCreatorQuery(new URL(request.url).searchParams.get("creator"));
    if (!creatorRaw) {
      return jsonError(400, "Invalid creator");
    }
    const creator = validateOwner(creatorRaw);
    const origin = resolvePublicOrigin({ request });
    if (!origin) {
      return jsonError(503, "Public site origin is not configured");
    }

    const jobId = await deriveJobId(creator, slug);
    const modal = await getJobStatus(jobId, creator);
    if (!jobMatchesCreatorSlug(modal, slug, jobId)) {
      return jsonError(404, "Metadata is not ready");
    }

    return jsonOk(
      buildPublicGameMetadata({
        slug,
        creator,
        modal,
        origin,
      }),
    );
  } catch (error) {
    if (error instanceof ModalJobError) {
      return modalErrorResponse(error);
    }
    return jsonError(500, "Unexpected error");
  }
}
