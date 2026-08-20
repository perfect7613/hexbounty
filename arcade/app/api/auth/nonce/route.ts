import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  cookieBaseOptions,
  createNoncePayload,
  NONCE_COOKIE,
  NONCE_MAX_AGE_SECONDS,
  readAuthSessionSecret,
  seal,
} from "@/lib/auth/session";

export async function POST() {
  const secret = readAuthSessionSecret();
  if (!secret) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const payload = createNoncePayload();
  const token = await seal(payload, secret);
  const jar = await cookies();
  jar.set(NONCE_COOKIE, token, cookieBaseOptions(NONCE_MAX_AGE_SECONDS));

  return NextResponse.json({ nonce: payload.nonce });
}
