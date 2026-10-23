import { NextResponse } from "next/server";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" };

export function jsonOk<T>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

export function jsonError(
  status: number,
  error: string,
  extras?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ error, ...extras }, { status, headers: PRIVATE_NO_STORE });
}
