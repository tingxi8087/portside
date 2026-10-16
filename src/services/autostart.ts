import { isTauri } from '@tauri-apps/api/core';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';

export const supportsAutostart = isTauri();
export const readAutostart = () => isEnabled();
export async function setAutostart(enabled:boolean) {
  if(enabled)await enable();else await disable();
  const actual=await isEnabled();
  if(actual!==enabled)throw new Error('开机自动启动设置未生效，请重试');
  return actual;
}
