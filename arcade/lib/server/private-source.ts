import "server-only";

import {
  MAX_SOURCE_BYTES,
  MIN_SOURCE_BYTES,
  ModalJobError,
} from "./modal-jobs";

export const PRIVATE_SOURCE_EXPIRES_IN_SECONDS = 60;

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

async function readCappedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared != null) {
    const length = Number(declared);
    if (!Number.isInteger(length) || length < 0 || length > maxBytes) {
      throw new ModalJobError("private source exceeded size limit");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ModalJobError("private source had no body");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ModalJobError("private source exceeded size limit");
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function assertPrivateHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ModalJobError("private source URL is invalid");
  }
  if (parsed.protocol !== "https:") {
    throw new ModalJobError("private source must be HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new ModalJobError("private source must not include credentials");
  }
}

export async function fetchPrivateSourceBytes(input: {
  url: string;
  expectedBytes: number;
  maxBytes?: number;
}): Promise<Uint8Array> {
  const maxBytes = input.maxBytes ?? MAX_SOURCE_BYTES;
  if (
    !Number.isInteger(input.expectedBytes) ||
    input.expectedBytes < MIN_SOURCE_BYTES ||
    input.expectedBytes > maxBytes
  ) {
    throw new ModalJobError("stored source size is outside the allowed ROM bounds");
  }
  assertPrivateHttpsUrl(input.url);

  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: { accept: "application/octet-stream" },
    });
  } catch {
    throw new ModalJobError("private source fetch failed");
  }

  if (response.redirected || isRedirectStatus(response.status)) {
    throw new ModalJobError("private source redirects are refused");
  }
  if (!response.ok) {
    throw new ModalJobError("private source fetch failed");
  }

  const bytes = await readCappedBytes(response, maxBytes);
  if (bytes.byteLength !== input.expectedBytes) {
    throw new ModalJobError("private source size did not match stored metadata");
  }
  if (bytes.byteLength > MAX_SOURCE_BYTES) {
    throw new ModalJobError("private source exceeded size limit");
  }
  return bytes;
}
