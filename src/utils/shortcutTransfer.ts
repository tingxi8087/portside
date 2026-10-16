import type { Shortcut } from '@/data/demo';

export type ShortcutEntry = Omit<Shortcut, 'id'>;
export const MAX_SHORTCUT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const signature = (item: ShortcutEntry) => JSON.stringify([item.name, item.command, item.directory, item.tag]);

export function parseShortcutFile(text: string): ShortcutEntry[] {
  if (new TextEncoder().encode(text).length > MAX_SHORTCUT_FILE_BYTES) throw new Error('文件不能超过 4 MB');
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效的 JSON'); }
  if (!value || typeof value !== 'object') throw new Error('不是 Portside 快捷指令文件');
  const file = value as Record<string, unknown>;
  if (file.format !== 'portside-shortcuts') throw new Error('不是 Portside 快捷指令文件');
  if (file.version !== 1) throw new Error('暂不支持此文件版本');
  if (!Array.isArray(file.shortcuts) || !file.shortcuts.length) throw new Error('文件中没有快捷指令');
  if (file.shortcuts.length > MAX_ENTRIES) throw new Error('一次最多导入 1000 条快捷指令');
  return file.shortcuts.map((entry: unknown, index: number) => {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item !== 'object' ||
      !['name', 'command'].every(key => typeof item[key] === 'string' && (item[key] as string).trim()) ||
      typeof item.directory !== 'string' ||
      !(item.tag === null || typeof item.tag === 'string')) throw new Error(`第 ${index + 1} 条指令的名称、命令、目录或标签无效`);
    // Explicitly pick configuration fields; never accept IDs or execution flags from a file.
    return {name: (item.name as string).trim(), command: item.command as string, directory: (item.directory as string).trim(), tag: typeof item.tag === 'string' ? item.tag.trim() || null : null};
  });
}

export function serializeShortcuts(items: ShortcutEntry[]): string {
  if (items.length > MAX_ENTRIES) throw new Error('一次最多导出 1000 条，请筛选或多选后分批导出');
  const text = JSON.stringify({format: 'portside-shortcuts', version: 1, shortcuts: items.map(({name, command, directory, tag}) => ({name, command, directory, tag}))}, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > MAX_SHORTCUT_FILE_BYTES) throw new Error('导出文件不能超过 4 MB，请分批导出');
  return text;
}

export function planShortcutImport(existing: ShortcutEntry[], incoming: ShortcutEntry[]) {
  const seen = new Set(existing.map(signature));
  const names = new Set(existing.map(item => item.name));
  return incoming.map(item => {
    const key = signature(item);
    if (seen.has(key)) return {item, duplicate: true, renamed: false};
    seen.add(key);
    let name = item.name;
    if (names.has(name)) {
      name = `${item.name} 副本`;
      for (let suffix = 2; names.has(name); suffix++) name = `${item.name} 副本 ${suffix}`;
    }
    names.add(name);
    seen.add(signature({...item, name}));
    return {item: {...item, name}, duplicate: false, renamed: name !== item.name};
  });
}
