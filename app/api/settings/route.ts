import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(request: Request) {
  try {
    return NextResponse.json(await saveSettings(await request.json()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "설정을 저장하지 못했습니다." },
      { status: 503 },
    );
  }
}
