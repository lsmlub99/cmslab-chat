import { NextResponse } from "next/server";
import { clearedSessionCookie } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearedSessionCookie(new URL(request.url).protocol === "https:"));
  return response;
}
