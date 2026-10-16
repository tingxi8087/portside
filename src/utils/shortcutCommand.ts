import type { Shortcut } from '@/data/demo';
const quote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
// Keep arbitrary multi-line commands under the successful cd branch.
export function shortcutCommand(shortcut:Pick<Shortcut,'directory'|'command'>){
  const path=shortcut.directory.trim();
  if(!path)return shortcut.command+'\r';
  const directory=path==='~'?'"$HOME"':path.startsWith('~/')?'"$HOME"/'+quote(path.slice(2)):quote(path);
  return `cd -- ${directory} && eval ${quote(shortcut.command)}\r`;
}
