import { database, hasDatabaseConfig } from "@/lib/database";

export type WorkspaceSettings = {
  bot_name: string;
  team_name: string;
  welcome_message: string;
  accent_color: string;
};

export function defaultSettings(): WorkspaceSettings {
  return {
    bot_name: process.env.NEXT_PUBLIC_APP_NAME || "답봇",
    team_name: "교육 대표팀",
    welcome_message: "안녕하세요. 팀 지식에서 근거를 찾아 답해드릴게요.",
    accent_color: "#273e82",
  };
}

/**
 * workspace_settings 는 단일 행(id=true) 테이블입니다.
 * 예전에는 service_role 키로 supabase-js 를 썼지만, 그 키가 비어 있어 항상 실패했습니다.
 * 이미 잘 붙는 PostgreSQL 연결을 그대로 씁니다.
 */
export async function getSettings(): Promise<WorkspaceSettings> {
  if (!hasDatabaseConfig()) return defaultSettings();
  try {
    const rows = await database()`
      select bot_name, team_name, welcome_message, accent_color
      from public.workspace_settings where id = true limit 1
    `;
    if (!rows.length) return defaultSettings();
    return { ...defaultSettings(), ...(rows[0] as WorkspaceSettings) };
  } catch {
    return defaultSettings();
  }
}

export async function saveSettings(input: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  const current = await getSettings();
  const next: WorkspaceSettings = {
    bot_name: clean(input.bot_name, current.bot_name, 60),
    team_name: clean(input.team_name, current.team_name, 60),
    welcome_message: clean(input.welcome_message, current.welcome_message, 500),
    accent_color: /^#[0-9a-fA-F]{6}$/.test(String(input.accent_color ?? ""))
      ? String(input.accent_color)
      : current.accent_color,
  };

  const rows = await database()`
    insert into public.workspace_settings
      (id, bot_name, team_name, welcome_message, accent_color, updated_at)
    values
      (true, ${next.bot_name}, ${next.team_name}, ${next.welcome_message}, ${next.accent_color}, now())
    on conflict (id) do update set
      bot_name = excluded.bot_name,
      team_name = excluded.team_name,
      welcome_message = excluded.welcome_message,
      accent_color = excluded.accent_color,
      updated_at = now()
    returning bot_name, team_name, welcome_message, accent_color
  `;
  return rows[0] as WorkspaceSettings;
}

function clean(value: unknown, fallback: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maxLength) : fallback;
}
