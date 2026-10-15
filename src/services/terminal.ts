import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { Session } from '@/data/demo';

export type TerminalEvent = {kind:'data'|'exit'|'error';data?:string|number[]|null;code?:number|null};
export interface TerminalTransport {
  start(session:Session,cols:number,rows:number,onEvent:(event:TerminalEvent)=>void):Promise<void>;
  write(id:string,data:string):Promise<void>;
  resize(id:string,cols:number,rows:number):Promise<void>;
  close(id:string):Promise<void>;
  hasTasks?(id:string):Promise<boolean>;
  ack?(id:string,bytes:number):Promise<void>;
}
export const localTerminalTransport:TerminalTransport = {
  async start(session,cols,rows,onEvent){
    if(!isTauri())throw new Error('请在 Portside 桌面 App 中打开真实终端');
    const channel=new Channel<TerminalEvent>();channel.onmessage=onEvent;
    await invoke('terminal_start',{id:session.id,directory:session.directory,cols,rows,onEvent:channel});
  },
  write:(id,data)=>invoke('terminal_write',{id,data}),
  resize:(id,cols,rows)=>invoke('terminal_resize',{id,cols,rows}),
  close:(id)=>invoke('terminal_close',{id}),
  hasTasks:(id)=>invoke<boolean>('terminal_has_tasks',{id}),
  ack:(id,bytes)=>invoke('terminal_ack',{id,bytes}),
};

// Runtime handles are independent of React routes and never persisted with settings.
const disposers=new Map<string,()=>void>();
export function registerTerminalDisposer(id:string,dispose:()=>void){disposers.set(id,dispose)}
export function disposeTerminal(id:string){disposers.get(id)?.();disposers.delete(id)}
export const terminalError=(error:unknown)=>error instanceof Error?error.message:String(error);
