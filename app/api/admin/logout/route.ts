import { NextResponse } from "next/server";
import { clearedCookie } from "@/lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearedCookie(new URL(request.url).protocol === "https:"));
  return response;
}
