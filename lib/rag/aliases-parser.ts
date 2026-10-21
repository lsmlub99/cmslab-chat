const MAX_ALIASES_PER_CHUNK = 8;

export function parseAliases(text: string, chunkCount: number) {
  const aliases = Array.from({ length: chunkCount }, () => [] as string[]);
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^\[?(\d+)\]?\s*\t\s*(.+)$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 0 || index >= chunkCount) continue;
    aliases[index] = [...new Set(match[2]
      .split("|")
      .map(value => value.trim().replace(/^[-•]\s*/, ""))
      .filter(value => value.length >= 2 && value.length <= 80))]
      .slice(0, MAX_ALIASES_PER_CHUNK);
  }
  return aliases;
}

