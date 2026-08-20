import { z } from "zod";

export const MAX_ROM_BYTES = 8 * 1024 * 1024;

export const ALLOWED_ROM_MIME_TYPES = [
  "application/octet-stream",
  "application/x-gameboy-rom",
  "application/x-gameboy-color-rom",
] as const;

export type AllowedRomMimeType = (typeof ALLOWED_ROM_MIME_TYPES)[number];

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRICE_MON_RE = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;
const PRICE_MON_MAX_LENGTH = 36;

function isPositiveDecimalString(value: string): boolean {
  if (value.length > PRICE_MON_MAX_LENGTH) return false;
  if (!PRICE_MON_RE.test(value)) return false;
  const [wholeRaw, fracRaw = ""] = value.split(".");
  const whole = BigInt(wholeRaw ?? "0");
  const fracSignificant = fracRaw.replace(/0+$/, "");
  if (whole === 0n && fracSignificant.length === 0) return false;
  const [integer, fraction = ""] = value.split(".");
  const wei = BigInt(integer) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
  return wei <= 1_000_000n * 10n ** 18n;
}

export const gameMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    slug: z.string().min(3).max(48).regex(SLUG_RE),
    description: z.string().trim().min(1).max(500),
    priceMon: z
      .string()
      .min(1)
      .max(PRICE_MON_MAX_LENGTH)
      .regex(PRICE_MON_RE, "priceMon must be a positive decimal string")
      .refine(isPositiveDecimalString, "priceMon must be a positive decimal string"),
    rightsAttestation: z.literal(true),
    rightsNote: z.string().trim().min(10).max(240),
  })
  .strict();

export const uploadMetadataSchema = gameMetadataSchema
  .extend({
    bountyMon: z
      .string()
      .min(1)
      .max(PRICE_MON_MAX_LENGTH)
      .regex(PRICE_MON_RE, "bountyMon must be a positive decimal string")
      .refine(isPositiveDecimalString, "bountyMon must be a positive decimal string"),
    bountyTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    bountyId: z.string().regex(/^[1-9][0-9]{0,77}$/),
    bountyDeadline: z.number().int().positive(),
    bountyMetadataURI: z
      .string()
      .url()
      .max(1024)
      .refine((value) => value.startsWith("https://") || value.startsWith("http://localhost:")),
  })
  .strict();

export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;
export type GameMetadata = z.infer<typeof gameMetadataSchema>;

export type RomFileMeta = {
  name: string;
  size: number;
  type: string;
};

export type FileValidationResult =
  | { ok: true; file: RomFileMeta }
  | { ok: false; error: string };

export function isRomFilename(name: string): boolean {
  return /\.(gb|gbc)$/i.test(name) && !name.includes("/") && !name.includes("\\");
}

export function isAllowedRomMimeType(type: string): type is AllowedRomMimeType {
  return (ALLOWED_ROM_MIME_TYPES as readonly string[]).includes(type);
}

export function validateRomUploadFiles(files: readonly RomFileMeta[]): FileValidationResult {
  if (files.length !== 1) {
    return { ok: false, error: "Exactly one ROM file is required" };
  }
  const file = files[0]!;
  if (!isRomFilename(file.name)) {
    return { ok: false, error: "Filename must end with .gb or .gbc" };
  }
  if (file.size <= 0 || file.size > MAX_ROM_BYTES) {
    return { ok: false, error: "File must be at most 8MB" };
  }
  if (!isAllowedRomMimeType(file.type)) {
    return { ok: false, error: "Unsupported MIME type" };
  }
  return { ok: true, file };
}
