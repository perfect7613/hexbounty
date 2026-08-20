import "server-only";

import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { ingestGameRomUpload } from "@/lib/server/ingest-upload";
import {
  ReconstructionPaymentError,
  verifyReconstructionPayment,
} from "@/lib/server/reconstruction-payment";
import { uploadMetadataSchema, validateRomUploadFiles } from "@/lib/uploads/schema";
import { utapi } from "@/lib/uploadthing";

const f = createUploadthing();

export const ourFileRouter = {
  gameRom: f(
    {
      blob: {
        maxFileSize: "8MB",
        maxFileCount: 1,
        minFileCount: 1,
        contentDisposition: "attachment",
      },
    },
    { awaitServerData: true },
  )
    .input(uploadMetadataSchema)
    .middleware(async ({ req, files, input }) => {
      const session = await getSessionFromRequest(req);
      if (!session) {
        throw new UploadThingError("Unauthorized");
      }
      if (files) {
        const check = validateRomUploadFiles(
          files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
        );
        if (!check.ok) {
          throw new UploadThingError(check.error);
        }
      }
      try {
        await verifyReconstructionPayment({
          owner: session.address,
          payment: input,
        });
      } catch (error) {
        if (error instanceof ReconstructionPaymentError) {
          throw new UploadThingError(error.message);
        }
        throw new UploadThingError("Could not verify the reconstruction bounty");
      }
      return {
        uploaderAddress: session.address,
        upload: input,
      };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const check = validateRomUploadFiles([
        { name: file.name, size: file.size, type: file.type },
      ]);
      if (!check.ok) {
        await utapi.deleteFiles(file.key).catch(() => undefined);
        throw new UploadThingError(check.error);
      }
      return ingestGameRomUpload({
        metadata,
        file: { key: file.key, name: file.name, size: file.size },
        deps: {
          generateSignedURL: (key, options) => utapi.generateSignedURL(key, options),
          deleteFiles: (key) => utapi.deleteFiles(key),
        },
      });
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
