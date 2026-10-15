import { invoke, isTauri } from '@tauri-apps/api/core';
import type { StateStorage } from 'zustand/middleware';

let readable=true;
let lastSaved:string|undefined;
let queued:string|undefined;
let flushing:Promise<void>|undefined;
export let lastConfigError='';
export function configError(error:unknown){
  lastConfigError=`本机配置读写失败：${String(error)}`;
  window.dispatchEvent(new CustomEvent('portside-config-error',{detail:lastConfigError}));
  return lastConfigError;
}
export function blockConfigWrites(error:unknown){readable=false;configError(error)}
export const workspaceStorage:StateStorage={
  async getItem(name){
    if(!isTauri())return localStorage.getItem(name);
    try {
      const saved=await invoke<string|null>('config_read');
      lastSaved=saved??undefined;
      return saved??localStorage.getItem(name);
    }catch(error){blockConfigWrites(error);throw error}
  },
  async setItem(name,value){
    if(!readable)return;
    if(!isTauri()){try{localStorage.setItem(name,value)}catch(error){configError(error)}return}
    queued=value;
    if(!flushing)flushing=Promise.resolve().then(async()=>{
      try {
        while(queued!==undefined){
          const next=queued;queued=undefined;
          if(next===lastSaved)continue;
          await invoke('config_write',{value:next});lastSaved=next;
        }
      }catch(error){queued=undefined;configError(error)}
      finally{flushing=undefined}
    });
    return flushing;
  },
  async removeItem(name){if(!isTauri())localStorage.removeItem(name)},
};
