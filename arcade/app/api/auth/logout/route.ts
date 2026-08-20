import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  cookieBaseOptions,
  NONCE_COOKIE,
  readAuthSessionSecret,
  SESSION_COOKIE,
} from "@/lib/auth/session";

export async function POST() {
  if (!readAuthSessionSecret()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const jar = await cookies();
  jar.set(NONCE_COOKIE, "", cookieBaseOptions(0));
  jar.set(SESSION_COOKIE, "", cookieBaseOptions(0));
  return NextResponse.json({ ok: true });
}
