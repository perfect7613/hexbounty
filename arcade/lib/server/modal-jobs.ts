import "server-only";

const encoder = new TextEncoder();

export const MIN_SOURCE_BYTES = 32_768;
export const MAX_SOURCE_BYTES = 8_388_608;
export const JOB_ID_DOMAIN = "hexbounty-job-v1";
export const JOB_ID_RE = /^u-[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$/;
export const OWNER_RE = /^0x[a-f0-9]{40}$/;
export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export const PRICE_MON_RE = /^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,18})?$/;
export const RIGHTS_AT_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$/;

const JOB_ID_MAX = 64;
const NONCE_BYTES = 16;
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 500;
const RIGHTS_NOTE_MAX = 240;
const PRICE_MON_MAX = 1_000_000;

const STATUS_VALUES = ["queued", "running", "complete", "incomplete", "failed", "rejected"] as const;

export type ModalJobStatus = (typeof STATUS_VALUES)[number];
export type RomExtension = ".gb" | ".gbc";

export type SubmitJobInput = {
  jobId: string;
  owner: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceBytes: number;
  extension: RomExtension;
  slug: string;
  title: string;
  description: string;
  priceMon: string;
  rightsNote: string;
  rightsAttestedAt: string;
  bountyMon: string;
  bountyTxHash: string;
  bountyId: string;
  bountyDeadline: number;
  bountyMetadataURI: string;
};

export type ModalPublicGame = {
  slug: string;
  title: string;
  description: string;
  priceMon: string;
  rightsNote: string;
  rightsAttestedAt: string;
  bountyMon?: string;
  bountyTxHash?: string;
  bountyId?: string;
  bountyDeadline?: number;
  bountyMetadataURI?: string;
};

export type ModalJobResult = {
  sha256: string;
  bytes: number;
  platform: string;
  extension: RomExtension;
  runStatus: string;
  quality?: "verified" | "approximate";
};

export type ModalJobStatusResponse = {
  jobId: string;
  status: ModalJobStatus;
  phase: string;
  progress: number;
  error: string | null;
  detail?: string;
  game: ModalPublicGame | null;
  result?: ModalJobResult;
};

export type ModalJobConfig = {
  baseUrl: string;
  secret: string;
};

export class ModalJobError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModalJobError";
    this.status = status;
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, data as BufferSource);
  return bytesToHex(new Uint8Array(mac));
}

export function serializeSubmitBody(input: SubmitJobInput): string {
  return JSON.stringify({
    jobId: input.jobId,
    owner: input.owner,
    sourceUrl: input.sourceUrl,
    sourceSha256: input.sourceSha256,
    sourceBytes: input.sourceBytes,
    extension: input.extension,
    slug: input.slug,
    title: input.title,
    description: input.description,
    priceMon: input.priceMon,
    rightsNote: input.rightsNote,
    rightsAttestedAt: input.rightsAttestedAt,
    bountyMon: input.bountyMon,
    bountyTxHash: input.bountyTxHash,
    bountyId: input.bountyId,
    bountyDeadline: input.bountyDeadline,
    bountyMetadataURI: input.bountyMetadataURI,
  });
}

export function canonicalSigningMessage(input: {
  timestamp: string;
  nonce: string;
  method: "GET" | "POST";
  path: string;
  owner: string;
  bodySha256Hex: string;
}): string {
  return `${input.timestamp}\n${input.nonce}\n${input.method}\n${input.path}\n${input.owner}\n${input.bodySha256Hex}`;
}

export function canonicalSigningBytes(message: string): Uint8Array {
  return encoder.encode(message);
}

export function signatureHeaderValue(hex: string): string {
  return `sha256=${hex}`;
}

export function normalizeModalBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ModalJobError("HEXBOUNTY_MODAL_BASE_URL is not a valid HTTPS origin");
  }
  if (parsed.protocol !== "https:") {
    throw new ModalJobError("HEXBOUNTY_MODAL_BASE_URL must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new ModalJobError("HEXBOUNTY_MODAL_BASE_URL must not include credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new ModalJobError("HEXBOUNTY_MODAL_BASE_URL must not include a query or fragment");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new ModalJobError("HEXBOUNTY_MODAL_BASE_URL must be an origin with no path");
  }
  return `https://${parsed.host}`;
}

export function readModalJobConfig(env: NodeJS.Dict<string> = process.env): ModalJobConfig {
  const baseRaw = env.HEXBOUNTY_MODAL_BASE_URL;
  const secret = env.HEXBOUNTY_MODAL_HMAC_SECRET;
  if (typeof baseRaw !== "string" || baseRaw.trim() === "") {
    throw new ModalJobError("HEXBOUNTY_MODAL_BASE_URL is required for the live Modal adapter");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new ModalJobError("HEXBOUNTY_MODAL_HMAC_SECRET is required for the live Modal adapter");
  }
  return { baseUrl: normalizeModalBaseUrl(baseRaw), secret };
}

function isRomExtension(value: string): value is RomExtension {
  return value === ".gb" || value === ".gbc";
}

function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 && char !== "\n" && char !== "\t") return true;
  }
  return false;
}

function boundedPublicString(value: string, field: string, minimum: number, maximum: number): string {
  if (value.length < minimum || value.length > maximum) {
    throw new ModalJobError(`${field} must be ${minimum}-${maximum} characters`);
  }
  if (value !== value.trim()) {
    throw new ModalJobError(`${field} must not have leading or trailing whitespace`);
  }
  if (hasControlChars(value)) {
    throw new ModalJobError(`${field} contains unsupported control characters`);
  }
  return value;
}

function assertHttpsUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ModalJobError("sourceUrl must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:") {
    throw new ModalJobError("sourceUrl must be HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new ModalJobError("sourceUrl must not include credentials");
  }
}

export function validateSlug(slug: string): string {
  if (!SLUG_RE.test(slug)) {
    throw new ModalJobError(
      "slug must be 1-48 lowercase letters, digits, or hyphens and start/end alphanumeric",
    );
  }
  return slug;
}

export function validateOwner(owner: string): string {
  if (!OWNER_RE.test(owner)) {
    throw new ModalJobError("owner must be a lowercase 0x-prefixed 20-byte address");
  }
  return owner;
}

export function toOwnerAddress(address: string): string {
  return validateOwner(address.toLowerCase());
}

export function validateJobId(jobId: string): string {
  if (!JOB_ID_RE.test(jobId) || jobId.length > JOB_ID_MAX) {
    throw new ModalJobError("jobId is not a valid Modal user-job identifier");
  }
  return jobId;
}

export function validatePublicGameMetadata(input: {
  slug: string;
  title: string;
  description: string;
  priceMon: string;
  rightsNote: string;
  rightsAttestedAt: string;
  bountyMon: string;
  bountyTxHash: string;
  bountyId: string;
  bountyDeadline: number;
  bountyMetadataURI: string;
}): {
  slug: string;
  title: string;
  description: string;
  priceMon: string;
  rightsNote: string;
  rightsAttestedAt: string;
  bountyMon: string;
  bountyTxHash: string;
  bountyId: string;
  bountyDeadline: number;
  bountyMetadataURI: string;
} {
  const slug = validateSlug(input.slug);
  const title = boundedPublicString(input.title, "title", 1, TITLE_MAX);
  const description = boundedPublicString(input.description, "description", 0, DESCRIPTION_MAX);
  const rightsNote = boundedPublicString(input.rightsNote, "rightsNote", 1, RIGHTS_NOTE_MAX);
  if (!PRICE_MON_RE.test(input.priceMon)) {
    throw new ModalJobError("priceMon must be a canonical positive MON decimal with up to 18 places");
  }
  const price = Number(input.priceMon);
  if (!Number.isFinite(price) || price <= 0 || price > PRICE_MON_MAX) {
    throw new ModalJobError("priceMon must be greater than 0 and at most 1000000");
  }
  if (!RIGHTS_AT_RE.test(input.rightsAttestedAt) || input.rightsAttestedAt.length > 32) {
    throw new ModalJobError("rightsAttestedAt must be an RFC3339 UTC timestamp");
  }
  const attestedMs = Date.parse(input.rightsAttestedAt);
  if (!Number.isFinite(attestedMs)) {
    throw new ModalJobError("rightsAttestedAt is not a valid calendar timestamp");
  }
  if (!PRICE_MON_RE.test(input.bountyMon) || Number(input.bountyMon) <= 0) {
    throw new ModalJobError("bountyMon must be a canonical positive MON decimal");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.bountyTxHash)) {
    throw new ModalJobError("bountyTxHash must be a transaction hash");
  }
  if (!/^[1-9][0-9]{0,77}$/.test(input.bountyId)) {
    throw new ModalJobError("bountyId must be a positive integer");
  }
  if (!Number.isSafeInteger(input.bountyDeadline) || input.bountyDeadline <= 0) {
    throw new ModalJobError("bountyDeadline must be a positive Unix timestamp");
  }
  assertHttpsUrl(input.bountyMetadataURI);
  return {
    slug,
    title,
    description,
    priceMon: input.priceMon,
    rightsNote,
    rightsAttestedAt: input.rightsAttestedAt,
    bountyMon: input.bountyMon,
    bountyTxHash: input.bountyTxHash.toLowerCase(),
    bountyId: input.bountyId,
    bountyDeadline: input.bountyDeadline,
    bountyMetadataURI: input.bountyMetadataURI,
  };
}

export function validateSubmitJobInput(input: SubmitJobInput): SubmitJobInput {
  const jobId = validateJobId(input.jobId);
  const owner = validateOwner(input.owner);
  const game = validatePublicGameMetadata(input);
  if (!SHA256_HEX_RE.test(input.sourceSha256)) {
    throw new ModalJobError("sourceSha256 must be 64 lowercase hex characters");
  }
  if (
    !Number.isInteger(input.sourceBytes) ||
    input.sourceBytes < MIN_SOURCE_BYTES ||
    input.sourceBytes > MAX_SOURCE_BYTES
  ) {
    throw new ModalJobError("sourceBytes must be an integer between 32768 and 8388608");
  }
  if (!isRomExtension(input.extension)) {
    throw new ModalJobError("extension must be .gb or .gbc");
  }
  assertHttpsUrl(input.sourceUrl);
  return {
    jobId,
    owner,
    sourceUrl: input.sourceUrl,
    sourceSha256: input.sourceSha256,
    sourceBytes: input.sourceBytes,
    extension: input.extension,
    ...game,
  };
}

export async function deriveJobId(owner: string, slug: string): Promise<string> {
  const safeOwner = validateOwner(owner);
  const safeSlug = validateSlug(slug);
  const message = encoder.encode(`${JOB_ID_DOMAIN}\n${safeOwner}\n${safeSlug}`);
  const digest = await computeSha256Hex(message);
  return `u-${digest.slice(0, 32)}`;
}

function mapModalStatus(status: string): ModalJobStatus {
  if ((STATUS_VALUES as readonly string[]).includes(status)) {
    return status as ModalJobStatus;
  }
  throw new ModalJobError("Modal job status value was invalid");
}

export function romExtensionFromFilename(name: string): RomExtension {
  const lower = name.toLowerCase();
  if (lower.endsWith(".gbc") && !lower.includes("/") && !lower.includes("\\")) {
    return ".gbc";
  }
  if (lower.endsWith(".gb") && !lower.includes("/") && !lower.includes("\\")) {
    return ".gb";
  }
  throw new ModalJobError("extension must be .gb or .gbc");
}

function toFetchBody(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function sanitizePublicGame(value: unknown): ModalPublicGame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.slug !== "string" || !SLUG_RE.test(record.slug)) return null;
  if (typeof record.title !== "string") return null;
  if (typeof record.description !== "string") return null;
  if (typeof record.priceMon !== "string") return null;
  const rightsNote = typeof record.rightsNote === "string" ? record.rightsNote : "";
  const rightsAttestedAt =
    typeof record.rightsAttestedAt === "string" ? record.rightsAttestedAt : "";
  const game: ModalPublicGame = {
    slug: record.slug,
    title: record.title,
    description: record.description,
    priceMon: record.priceMon,
    rightsNote,
    rightsAttestedAt,
  };
  if (
    typeof record.bountyMon === "string" &&
    typeof record.bountyTxHash === "string" &&
    typeof record.bountyId === "string" &&
    typeof record.bountyDeadline === "number" &&
    typeof record.bountyMetadataURI === "string"
  ) {
    game.bountyMon = record.bountyMon;
    game.bountyTxHash = record.bountyTxHash;
    game.bountyId = record.bountyId;
    game.bountyDeadline = record.bountyDeadline;
    game.bountyMetadataURI = record.bountyMetadataURI;
  }
  return game;
}

export function sanitizeJobResult(value: unknown): ModalJobResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.sha256 !== "string" || !SHA256_HEX_RE.test(record.sha256)) {
    throw new ModalJobError("Modal job result sha256 was invalid");
  }
  if (typeof record.bytes !== "number" || !Number.isInteger(record.bytes) || record.bytes <= 0) {
    throw new ModalJobError("Modal job result bytes were invalid");
  }
  if (typeof record.platform !== "string" || record.platform.length === 0) {
    throw new ModalJobError("Modal job result platform was invalid");
  }
  if (typeof record.extension !== "string" || !isRomExtension(record.extension)) {
    throw new ModalJobError("Modal job result extension was invalid");
  }
  if (typeof record.runStatus !== "string" || record.runStatus.length === 0) {
    throw new ModalJobError("Modal job result runStatus was invalid");
  }
  const result: ModalJobResult = {
    sha256: record.sha256,
    bytes: record.bytes,
    platform: record.platform,
    extension: record.extension,
    runStatus: record.runStatus,
  };
  if (record.quality === "verified" || record.quality === "approximate") {
    result.quality = record.quality;
  }
  return result;
}

export function parseJobStatusPayload(value: unknown): ModalJobStatusResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ModalJobError("Modal job status was not a JSON object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.jobId !== "string" || !JOB_ID_RE.test(record.jobId)) {
    throw new ModalJobError("Modal job status jobId was invalid");
  }
  if (typeof record.status !== "string") {
    throw new ModalJobError("Modal job status value was invalid");
  }
  const status = mapModalStatus(record.status);
  const phase = typeof record.phase === "string" && record.phase.length > 0 ? record.phase : status;
  let progress = 0;
  if (record.progress != null) {
    if (typeof record.progress !== "number" || !Number.isInteger(record.progress)) {
      throw new ModalJobError("Modal job status progress was invalid");
    }
    progress = record.progress;
  }
  let error: string | null = null;
  if (record.error != null) {
    if (typeof record.error !== "string") {
      throw new ModalJobError("Modal job status error was invalid");
    }
    error = record.error;
  }
  const parsed: ModalJobStatusResponse = {
    jobId: record.jobId,
    status,
    phase,
    progress,
    error,
    game: sanitizePublicGame(record.game),
  };
  if (typeof record.detail === "string" && record.detail.length > 0) {
    parsed.detail = record.detail;
  }
  if (record.result != null) {
    parsed.result = sanitizeJobResult(record.result);
  }
  return parsed;
}

export async function createSignedModalHeaders(input: {
  secret: string;
  method: "GET" | "POST";
  path: string;
  owner: string;
  rawBody: Uint8Array;
  timestamp?: string;
  nonce?: string;
}): Promise<{ headers: Record<string, string>; timestamp: string; nonce: string }> {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const nonce = input.nonce ?? bytesToHex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
  const bodySha256Hex = await computeSha256Hex(input.rawBody);
  const canonical = canonicalSigningBytes(
    canonicalSigningMessage({
      timestamp,
      nonce,
      method: input.method,
      path: input.path,
      owner: input.owner,
      bodySha256Hex,
    }),
  );
  const hex = await hmacSha256Hex(input.secret, canonical);
  const headers: Record<string, string> = {
    "x-hexbounty-owner": input.owner,
    "x-hexbounty-timestamp": timestamp,
    "x-hexbounty-nonce": nonce,
    "x-hexbounty-signature": signatureHeaderValue(hex),
  };
  if (input.method === "POST") {
    headers["content-type"] = "application/json";
  }
  return { headers, timestamp, nonce };
}

async function modalFetch(
  env: NodeJS.Dict<string>,
  input: {
    method: "GET" | "POST";
    path: string;
    owner: string;
    rawBody: Uint8Array;
  },
): Promise<Response> {
  const config = readModalJobConfig(env);
  const { headers } = await createSignedModalHeaders({
    secret: config.secret,
    method: input.method,
    path: input.path,
    owner: input.owner,
    rawBody: input.rawBody,
  });
  return fetch(`${config.baseUrl}${input.path}`, {
    method: input.method,
    headers,
    body: input.method === "POST" ? toFetchBody(input.rawBody) : undefined,
    cache: "no-store",
    redirect: "error",
  });
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ModalJobError("Modal job response was not valid JSON", response.status);
  }
}

export async function submitJob(
  input: SubmitJobInput,
  env: NodeJS.Dict<string> = process.env,
): Promise<ModalJobStatusResponse> {
  const body = validateSubmitJobInput(input);
  const expectedId = await deriveJobId(body.owner, body.slug);
  if (body.jobId !== expectedId) {
    throw new ModalJobError("jobId does not match derive_job_id(slug, owner)");
  }
  const rawBody = encoder.encode(serializeSubmitBody(body));
  const response = await modalFetch(env, {
    method: "POST",
    path: "/v1/jobs",
    owner: body.owner,
    rawBody,
  });
  const payload = await readJson(response);
  if (!response.ok && response.status !== 202) {
    const detail =
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      typeof (payload as Record<string, unknown>).error === "string"
        ? (payload as Record<string, string>).error
        : "Modal job submit failed";
    throw new ModalJobError(detail, response.status);
  }
  return parseJobStatusPayload(payload);
}

export async function getJobStatus(
  jobId: string,
  owner: string,
  env: NodeJS.Dict<string> = process.env,
): Promise<ModalJobStatusResponse> {
  const id = validateJobId(jobId);
  const who = validateOwner(owner);
  const response = await modalFetch(env, {
    method: "GET",
    path: `/v1/jobs/${id}`,
    owner: who,
    rawBody: new Uint8Array(),
  });
  if (!response.ok) {
    throw new ModalJobError("Modal job status request failed", response.status);
  }
  return parseJobStatusPayload(await readJson(response));
}

export async function getJobResult(
  jobId: string,
  owner: string,
  env: NodeJS.Dict<string> = process.env,
): Promise<Response> {
  const id = validateJobId(jobId);
  const who = validateOwner(owner);
  const response = await modalFetch(env, {
    method: "GET",
    path: `/v1/jobs/${id}/result`,
    owner: who,
    rawBody: new Uint8Array(),
  });
  if (!response.ok) {
    throw new ModalJobError("Modal job result request failed", response.status);
  }
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return new Response(response.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "private, no-store",
    },
  });
}
