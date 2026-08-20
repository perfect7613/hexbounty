import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cookieBaseOptions,
  createSessionPayload,
  NONCE_COOKIE,
  parseSiweMessage,
  readAuthSessionSecret,
  readNonceFromCookieValue,
  requestHost,
  requestOrigin,
  seal,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  validateSiweRequestBinding,
  verifySiweSignature,
} from "@/lib/auth/session";

const VerifyBody = z
  .object({
    message: z.string().min(1).max(8192),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  })
  .strict();

function clearNonce(jar: Awaited<ReturnType<typeof cookies>>) {
  jar.set(NONCE_COOKIE, "", cookieBaseOptions(0));
}

export async function POST(request: Request) {
  const secret = readAuthSessionSecret();
  if (!secret) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const jar = await cookies();
  const nonceCookie = jar.get(NONCE_COOKIE)?.value;
  clearNonce(jar);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsedBody = VerifyBody.safeParse(json);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const noncePayload = await readNonceFromCookieValue(nonceCookie, secret);
  if (!noncePayload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const host = requestHost(request.headers);
  const origin = requestOrigin(request.headers);
  if (!host || !origin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let fields: ReturnType<typeof parseSiweMessage>;
  try {
    fields = parseSiweMessage(parsedBody.data.message);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    !validateSiweRequestBinding({
      fields,
      nonce: noncePayload.nonce,
      host,
      origin,
    })
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const valid = await verifySiweSignature({
    message: parsedBody.data.message,
    signature: parsedBody.data.signature,
    domain: host,
    nonce: noncePayload.nonce,
  });
  if (!valid || !fields.address) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = createSessionPayload(fields.address);
  const token = await seal(session, secret);
  jar.set(SESSION_COOKIE, token, cookieBaseOptions(SESSION_MAX_AGE_SECONDS));

  return NextResponse.json({
    address: session.address,
    chainId: session.chainId,
  });
}
