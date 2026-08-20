import "server-only";

import { cookies } from "next/headers";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import {
  generateSiweNonce,
  parseSiweMessage,
  validateSiweMessage,
  verifySiweMessage,
  type SiweMessage,
} from "viem/siwe";
import { hexBountyMonad } from "../chain";
import { getRpcUrl, MONAD_TESTNET_ID } from "../env";

export const NONCE_COOKIE = "hb_siwe_nonce";
export const SESSION_COOKIE = "hb_siwe_session";
export const NONCE_MAX_AGE_SECONDS = 5 * 60;
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
export const AUTH_CHAIN_ID = MONAD_TESTNET_ID;
export const SIWE_ISSUED_AT_FUTURE_SKEW_MS = 60_000;
export const SIWE_MAX_TTL_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();

export type NoncePayload = {
  v: 1;
  nonce: string;
  exp: number;
};

export type SessionPayload = {
  v: 1;
  address: Address;
  chainId: typeof AUTH_CHAIN_ID;
  iat: number;
  exp: number;
};

export type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean;
};

export function readAuthSessionSecret(
  env: NodeJS.Dict<string> = process.env,
): string | null {
  const secret = env.AUTH_SESSION_SECRET;
  if (typeof secret !== "string" || secret.length < 32) return null;
  return secret;
}

export function cookieBaseOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  };
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(value: string): Uint8Array | null {
  if (!value || /[^A-Za-z0-9_-]/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a[i]! ^ b[i]!;
  return mismatch === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmacSha256(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data as BufferSource));
}

export async function seal(payload: unknown, secret: string): Promise<string> {
  const body = encoder.encode(JSON.stringify(payload));
  const payloadB64 = toBase64Url(body);
  const mac = await hmacSha256(secret, encoder.encode(payloadB64));
  return `${payloadB64}.${toBase64Url(mac)}`;
}

export async function unseal(token: string, secret: string): Promise<unknown | null> {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;
  const payloadB64 = token.slice(0, dot);
  const macB64 = token.slice(dot + 1);
  const mac = fromBase64Url(macB64);
  if (!mac) return null;
  const expected = await hmacSha256(secret, encoder.encode(payloadB64));
  if (!timingSafeEqual(mac, expected)) return null;
  const raw = fromBase64Url(payloadB64);
  if (!raw) return null;
  try {
    return JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return null;
  }
}

export function validateNoncePayload(
  payload: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): NoncePayload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.nonce !== "string" || record.nonce.length < 8) return null;
  if (typeof record.exp !== "number" || !Number.isInteger(record.exp)) return null;
  if (record.exp <= nowSeconds) return null;
  return { v: 1, nonce: record.nonce, exp: record.exp };
}

export function validateSessionPayload(
  payload: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.address !== "string" || !isAddress(record.address)) return null;
  if (record.chainId !== AUTH_CHAIN_ID) return null;
  if (typeof record.iat !== "number" || !Number.isInteger(record.iat)) return null;
  if (typeof record.exp !== "number" || !Number.isInteger(record.exp)) return null;
  if (record.exp <= nowSeconds || record.iat > nowSeconds) return null;
  return {
    v: 1,
    address: getAddress(record.address),
    chainId: AUTH_CHAIN_ID,
    iat: record.iat,
    exp: record.exp,
  };
}

export function createNoncePayload(nowSeconds = Math.floor(Date.now() / 1000)): NoncePayload {
  return {
    v: 1,
    nonce: generateSiweNonce(),
    exp: nowSeconds + NONCE_MAX_AGE_SECONDS,
  };
}

export function createSessionPayload(
  address: Address,
  nowSeconds = Math.floor(Date.now() / 1000),
): SessionPayload {
  return {
    v: 1,
    address: getAddress(address),
    chainId: AUTH_CHAIN_ID,
    iat: nowSeconds,
    exp: nowSeconds + SESSION_MAX_AGE_SECONDS,
  };
}

export function requestHost(headers: Headers): string | null {
  const host = headers.get("host")?.trim();
  return host || null;
}

export function requestOrigin(headers: Headers): string | null {
  const origin = headers.get("origin")?.trim();
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function validateSiweRequestBinding(input: {
  fields: ReturnType<typeof parseSiweMessage>;
  nonce: string;
  host: string;
  origin: string;
  time?: Date;
}): boolean {
  const { fields, nonce, host, origin, time = new Date() } = input;
  if (!fields.address || !fields.domain || !fields.nonce || !fields.uri) return false;
  if (fields.chainId !== AUTH_CHAIN_ID) return false;
  if (fields.version !== "1") return false;
  if (fields.domain !== host) return false;
  let uriOrigin: string;
  try {
    uriOrigin = new URL(fields.uri).origin;
  } catch {
    return false;
  }
  if (uriOrigin !== origin) return false;

  const issuedAt = fields.issuedAt;
  const expirationTime = fields.expirationTime;
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) return false;
  if (!(expirationTime instanceof Date) || Number.isNaN(expirationTime.getTime())) return false;
  if (issuedAt.getTime() - time.getTime() > SIWE_ISSUED_AT_FUTURE_SKEW_MS) return false;
  if (expirationTime.getTime() <= issuedAt.getTime()) return false;
  if (expirationTime.getTime() - issuedAt.getTime() > SIWE_MAX_TTL_MS) return false;
  if (time.getTime() >= expirationTime.getTime()) return false;

  return validateSiweMessage({
    address: fields.address,
    domain: host,
    message: fields as SiweMessage,
    nonce,
    time,
  });
}

export function cookieValueFromHeader(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

export async function getSessionFromCookieHeader(
  cookieHeader: string | null | undefined,
): Promise<SessionPayload | null> {
  const secret = readAuthSessionSecret();
  if (!secret) return null;
  const raw = cookieValueFromHeader(cookieHeader, SESSION_COOKIE);
  if (!raw) return null;
  const payload = await unseal(raw, secret);
  return validateSessionPayload(payload);
}

export async function getSessionFromRequest(request: Request): Promise<SessionPayload | null> {
  return getSessionFromCookieHeader(request.headers.get("cookie"));
}

export async function getSession(): Promise<SessionPayload | null> {
  const secret = readAuthSessionSecret();
  if (!secret) return null;
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const payload = await unseal(raw, secret);
  return validateSessionPayload(payload);
}

export class AuthRequiredError extends Error {
  readonly status = 401 as const;
  constructor() {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new AuthRequiredError();
  return session;
}

export async function readNonceFromCookieValue(
  value: string | undefined,
  secret: string,
): Promise<NoncePayload | null> {
  if (!value) return null;
  const payload = await unseal(value, secret);
  return validateNoncePayload(payload);
}

export async function verifySiweSignature(input: {
  message: string;
  signature: string;
  domain: string;
  nonce: string;
}): Promise<boolean> {
  if (!isHex(input.signature)) return false;
  const client = createPublicClient({
    chain: hexBountyMonad,
    transport: http(getRpcUrl()),
  });
  try {
    return await verifySiweMessage(client, {
      message: input.message,
      signature: input.signature as Hex,
      domain: input.domain,
      nonce: input.nonce,
    });
  } catch {
    return false;
  }
}

export { parseSiweMessage };
