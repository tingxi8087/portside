import { writeClipboard } from '@/services/clipboard';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import type { Session } from '@/data/demo';
import { registerTerminalDisposer, terminalError, type TerminalTransport } from '@/services/terminal';
export type RuntimeStatus='connecting'|'ready'|'exited'|'error';
type Runtime={terminal:Terminal;fit:FitAddon;search:SearchAddon;node:HTMLDivElement;status:RuntimeStatus;detail:string;listeners:Set<()=>void>;transport:TerminalTransport;disposed:boolean;start:Promise<void>};
const runtimes=new Map<string,Runtime>();
export function getRuntime(session:Session,transport:TerminalTransport):Runtime{
  const existing=runtimes.get(session.id);if(existing)return existing;
  const terminal=new Terminal({fontFamily:'Menlo, Monaco, monospace',fontSize:12,lineHeight:1.45,cursorBlink:true,scrollback:5000,allowProposedApi:false,allowTransparency:true,theme:{background:'#232220',foreground:'#d6d3cb',cursor:'#d6d3cb',selectionBackground:'#77756e88'}});
  const fit=new FitAddon(),search=new SearchAddon();terminal.loadAddon(fit);terminal.loadAddon(search);
  const node=document.createElement('div');node.className='terminal-emulator';terminal.open(node);
  const runtime:Runtime={terminal,fit,search,node,status:'connecting',detail:'正在连接…',listeners:new Set(),transport,disposed:false,start:Promise.resolve()};
  runtimes.set(session.id,runtime);
  const update=(status:RuntimeStatus,detail:string)=>{runtime.status=status;runtime.detail=detail;runtime.listeners.forEach(listener=>listener())};
  terminal.onData(data=>{if(runtime.status==='ready')void transport.write(session.id,data).catch(error=>update(runtime.status,terminalError(error)))});
  terminal.onResize(({cols,rows})=>{if(runtime.status==='ready')void transport.resize(session.id,cols,rows).catch(()=>{})});
  terminal.attachCustomKeyEventHandler(event=>{
    if(event.type!=='keydown')return true;
    if(event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.isComposing&&terminal.buffer.active.type==='normal'&&(event.key==='ArrowLeft'||event.key==='ArrowRight')){
      // Shells do not consistently bind CSI 1;2D/C. Keep movement predictable
      // in the main buffer while preserving modified keys in alternate-screen apps.
      event.preventDefault();event.stopPropagation();
      terminal.input(event.key==='ArrowLeft'?'\x1b[D':'\x1b[C',true);return false;
    }
    if(event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.isComposing&&event.key==='Backspace'){
      // Use the shell's word-erase control instead of the ambiguous Esc+DEL binding.
      event.preventDefault();event.stopPropagation();
      terminal.input('\x17',true);return false;
    }
    if((event.metaKey||event.ctrlKey&&event.shiftKey)&&event.key.toLowerCase()==='c'&&terminal.hasSelection()){
      void writeClipboard(terminal.getSelection());return false;
    }
    // xterm owns the native paste event, including Cmd+V and menu paste.
    // Returning false here alone does not cancel the browser's paste action.
    return true;
  });
  runtime.start=transport.start(session,80,24,event=>{
    if(runtime.disposed)return;
    if(event.kind==='data'&&event.data){
      const bytes=Array.isArray(event.data)?Uint8Array.from(event.data):event.data;
      const length=typeof bytes==='string'?new TextEncoder().encode(bytes).length:bytes.length;
      terminal.write(bytes,()=>{if(!runtime.disposed)void transport.ack?.(session.id,length).catch(()=>{})});
    }else if(event.kind==='exit'){
      update('exited',`会话已结束${event.code!==undefined&&event.code!==null?` · 退出码 ${event.code}`:''}`);
    }else if(event.kind==='error')update('error',String(event.data??'终端连接失败'));
  }).then(async()=>{
    if(runtime.disposed){await transport.close(session.id);return;}
    // A short-lived command can exit before the start response arrives.
    if(runtime.status!=='connecting')return;
    try{fit.fit()}catch{/* Container can be hidden until the next ResizeObserver callback. */}
    // Fits during connection cannot resize the PTY yet. FitAddon emits nothing
    // when dimensions are unchanged, so explicitly synchronize before accepting input.
    let cols:number,rows:number;
    do {
      cols=terminal.cols;rows=terminal.rows;
      await transport.resize(session.id,cols,rows);
      if(runtime.disposed||runtime.status!=='connecting')return;
    }while(cols!==terminal.cols||rows!==terminal.rows);
    update('ready','已连接');
    if(session.initialCommand)await transport.write(session.id,session.initialCommand+'\r');
  }).catch(error=>{if(!runtime.disposed){update('error',terminalError(error));terminal.writeln(`\r\n${terminalError(error)}`)}});
  registerTerminalDisposer(session.id,()=>{
    runtime.disposed=true;runtimes.delete(session.id);terminal.dispose();
    void runtime.start.finally(()=>transport.close(session.id)).catch(()=>{});
  });
  return runtime;
}
