import { invoke, isTauri } from '@tauri-apps/api/core';
import { MAX_SHORTCUT_FILE_BYTES } from '@/utils/shortcutTransfer';

export async function readShortcutFile(): Promise<{name: string; content: string} | null> {
  if (isTauri()) return invoke('shortcut_import_file');
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    const clean = () => input.remove();
    input.oncancel = () => {clean(); resolve(null)};
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) {resolve(null); return}
        if (file.size > MAX_SHORTCUT_FILE_BYTES) throw new Error('文件不能超过 4 MB');
        resolve({name: file.name, content: await file.text()});
      } catch (error) {reject(error)} finally {clean()}
    };
    document.body.append(input); input.click();
  });
}

export async function writeShortcutFile(content: string): Promise<boolean> {
  if (isTauri()) return invoke('shortcut_export_file', {content});
  const url = URL.createObjectURL(new Blob([content], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'Portside-快捷指令.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
