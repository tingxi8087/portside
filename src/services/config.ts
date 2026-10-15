import { invoke, isTauri } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

let readable=true;
export function configError(error:unknown){
  const detail=`本机配置保存失败：${String(error)}`;
  window.dispatchEvent(new CustomEvent('portside-config-error',{detail}));
  return detail;
}
export const workspaceStorage:StateStorage={
  async getItem(name){
    if(!isTauri())return localStorage.getItem(name);
    try {
      const saved=await invoke<string|null>('config_read');
      return saved??localStorage.getItem(name);
    }catch(error){readable=false;configError(error);throw error}
  },
  async setItem(name,value){
    if(!isTauri()){localStorage.setItem(name,value);return}
    if(!readable)throw new Error('原配置读取失败，已阻止覆盖，请修复原配置后重启');
    try {await invoke('config_write',{value})}catch(error){configError(error);throw error}
  },
  async removeItem(name){if(!isTauri())localStorage.removeItem(name)},
};
