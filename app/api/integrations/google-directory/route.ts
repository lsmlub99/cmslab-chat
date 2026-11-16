import { timingSafeEqual } from "node:crypto";
import { database, hasDatabaseConfig } from "@/lib/database";
import { mergeOrgUnits, orgDirectorySyncSchema, summarizeDirectoryMembers } from "@/lib/org-directory-model";
import { logUserAction } from "@/lib/server/telemetry.server";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 128 * 1024;

export function GET() {
  return Response.json(
    { ok: true, version: "directory-members-v1" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const started = Date.now();
  let success = false;
  try {
    if (!hasDatabaseConfig()) return Response.json({ error: "DB 설정이 필요합니다." }, { status: 503 });
    const secret = process.env.GOOGLE_DIRECTORY_SYNC_SECRET?.trim();
    if (!secret) return Response.json({ error: "동기화 인증 설정이 필요합니다." }, { status: 503 });
    if (!validBearer(request.headers.get("authorization"), secret)) {
      return Response.json({ error: "유효하지 않은 동기화 요청입니다." }, { status: 401 });
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return Response.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return Response.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
    }

    const parsed = orgDirectorySyncSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return Response.json({ error: "조직도 집계 형식이 올바르지 않습니다." }, { status: 400 });
    const summary = parsed.data.members
      ? summarizeDirectoryMembers(parsed.data.members)
      : { totalActive: parsed.data.totalActive, orgUnits: parsed.data.orgUnits, excludedAccountCount: 0 };
    const orgUnits = mergeOrgUnits(summary.orgUnits);
    const summed = orgUnits.reduce((total, item) => total + item.count, 0);
    if (summed !== summary.totalActive) {
      return Response.json({ error: "부서별 인원 합계와 전체 인원이 다릅니다." }, { status: 400 });
    }

    let snapshotId = 0;
    await database().begin(async tx => {
      const rows = await tx`
        insert into public.org_directory_snapshots
          (snapshot_month, snapshot_at, total_active, org_unit_count)
        values
          (${parsed.data.snapshotMonth}, ${parsed.data.snapshotAt}, ${summary.totalActive}, ${orgUnits.length})
        on conflict (snapshot_month) do update
          set snapshot_at = excluded.snapshot_at,
              total_active = excluded.total_active,
              org_unit_count = excluded.org_unit_count,
              updated_at = now()
        returning id
      `;
      snapshotId = Number(rows[0].id);
      await tx`delete from public.org_directory_counts where snapshot_id = ${snapshotId}`;
      if (orgUnits.length) {
        await tx`
          insert into public.org_directory_counts ${tx(
            orgUnits.map(item => ({
              snapshot_id: snapshotId,
              org_unit_path: item.path,
              active_count: item.count,
            })),
            "snapshot_id",
            "org_unit_path",
            "active_count",
          )}
        `;
      }
    });
    success = true;
    return Response.json({
      ok: true,
      snapshotMonth: parsed.data.snapshotMonth,
      totalActive: summary.totalActive,
      orgUnitCount: orgUnits.length,
      excludedAccountCount: summary.excludedAccountCount,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "JSON 요청이 필요합니다." }, { status: 400 });
    return Response.json({ error: "조직도 동기화에 실패했습니다." }, { status: 500 });
  } finally {
    await logUserAction({
      action: "sync_google_directory",
      success,
      latencyMs: Date.now() - started,
    }).catch(() => undefined);
  }
}

function validBearer(value: string | null, secret: string) {
  const supplied = value?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}
