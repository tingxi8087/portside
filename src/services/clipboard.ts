import { invoke, isTauri } from '@tauri-apps/api/core';
export async function writeClipboard(text:string){
  if(isTauri()){await invoke('clipboard_write',{text});return}
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return}
  const input=document.createElement('textarea');input.value=text;input.style.cssText='position:fixed;opacity:0;pointer-events:none';
  const previous=document.activeElement;document.body.append(input);
  try{input.select();if(!document.execCommand('copy'))throw new Error('复制失败')}finally{input.remove();if(previous instanceof HTMLElement)previous.focus()}
}
export async function readClipboard(){return isTauri()?invoke<string>('clipboard_read'):navigator.clipboard.readText()}
