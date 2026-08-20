import { NextResponse } from "next/server";
import { getSession, readAuthSessionSecret } from "@/lib/auth/session";

export async function GET() {
  if (!readAuthSessionSecret()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    address: session.address,
    chainId: session.chainId,
  });
}
