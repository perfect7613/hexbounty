import "server-only";

import { UploadThingError } from "uploadthing/server";
import type { UploadMetadata } from "../uploads/schema";
import {
  computeSha256Hex,
  deriveJobId,
  MAX_SOURCE_BYTES,
  MIN_SOURCE_BYTES,
  ModalJobError,
  romExtensionFromFilename,
  submitJob,
  toOwnerAddress,
  type ModalJobStatusResponse,
  type RomExtension,
} from "./modal-jobs";
import {
  fetchPrivateSourceBytes,
  PRIVATE_SOURCE_EXPIRES_IN_SECONDS,
} from "./private-source";

export type IngestUploadFile = {
  key: string;
  name: string;
  size: number;
};

export type IngestUploadResult = {
  slug: string;
  jobId: string;
  status: string;
};

export type IngestUploadDeps = {
  generateSignedURL: (
    key: string,
    opts?: { expiresIn?: number },
  ) => Promise<{ ufsUrl: string }>;
  deleteFiles: (key: string) => Promise<unknown>;
  fetchSource?: typeof fetchPrivateSourceBytes;
  submit?: typeof submitJob;
  now?: () => Date;
};

function rightsAttestedAtIso(now: Date): string {
  return now.toISOString();
}

function wrapUploadError(error: unknown): never {
  if (error instanceof UploadThingError) throw error;
  if (error instanceof ModalJobError) {
    throw new UploadThingError(error.message);
  }
  throw new UploadThingError("Upload processing failed");
}

export async function ingestGameRomUpload(input: {
  metadata: {
    uploaderAddress: string;
    upload: UploadMetadata;
  };
  file: IngestUploadFile;
  deps: IngestUploadDeps;
}): Promise<IngestUploadResult> {
  const { file, metadata, deps } = input;
  const fetchSource = deps.fetchSource ?? fetchPrivateSourceBytes;
  const submit = deps.submit ?? submitJob;
  let extension: RomExtension;
  try {
    extension = romExtensionFromFilename(file.name);
  } catch {
    await deps.deleteFiles(file.key).catch(() => undefined);
    throw new UploadThingError("Filename must end with .gb or .gbc");
  }

  if (
    !Number.isInteger(file.size) ||
    file.size < MIN_SOURCE_BYTES ||
    file.size > MAX_SOURCE_BYTES
  ) {
    await deps.deleteFiles(file.key).catch(() => undefined);
    throw new UploadThingError("File must be between 32KiB and 8MiB");
  }

  try {
    const signed = await deps.generateSignedURL(file.key, {
      expiresIn: PRIVATE_SOURCE_EXPIRES_IN_SECONDS,
    });
    const sourceBytes = await fetchSource({
      url: signed.ufsUrl,
      expectedBytes: file.size,
      maxBytes: Math.min(file.size, MAX_SOURCE_BYTES),
    });
    const sourceSha256 = await computeSha256Hex(sourceBytes);
    const owner = toOwnerAddress(metadata.uploaderAddress);
    const jobId = await deriveJobId(owner, metadata.upload.slug);
    const job: ModalJobStatusResponse = await submit({
      jobId,
      owner,
      sourceUrl: signed.ufsUrl,
      sourceSha256,
      sourceBytes: sourceBytes.byteLength,
      extension,
      slug: metadata.upload.slug,
      title: metadata.upload.title,
      description: metadata.upload.description,
      priceMon: metadata.upload.priceMon,
      rightsNote: metadata.upload.rightsNote,
      rightsAttestedAt: rightsAttestedAtIso(deps.now?.() ?? new Date()),
      bountyMon: metadata.upload.bountyMon,
      bountyTxHash: metadata.upload.bountyTxHash.toLowerCase(),
      bountyId: metadata.upload.bountyId,
      bountyDeadline: metadata.upload.bountyDeadline,
      bountyMetadataURI: metadata.upload.bountyMetadataURI,
    });
    await deps.deleteFiles(file.key).catch(() => undefined);
    return {
      slug: metadata.upload.slug,
      jobId: job.jobId,
      status: job.status,
    };
  } catch (error) {
    await deps.deleteFiles(file.key).catch(() => undefined);
    wrapUploadError(error);
  }
}
