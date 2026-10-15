import { useEffect, useRef, useState } from 'react';
import { IconTerminal2, IconX, IconPlus, IconPlayerStop, IconEraser } from 'paper-ink/icons';
import { App, Modal } from 'paper-ink';
import { useWorkspace } from '@/store/workspace';
import type { Session } from '@/data/demo';
import { Button, Input, Empty, IconAction } from '@/components/UI';

export function previewCommand(command:string,directory:string,remote=false):{lines:string[];running:boolean} {
  if(command==='help')return {lines:['演示指令：help、pwd、ls、whoami、date、git status、npm run dev、clear','任意输入均不会执行真实命令。'],running:false};
  if(command==='pwd')return {lines:[directory.replace('~',remote?'/home/ubuntu':'/Users/tingxi')],running:false};
  if(command==='ls'||command==='ls -la')return {lines:remote?['apps/    backups/    logs/    .profile']:['doc/    src/    src-tauri/    package.json    vite.config.ts'],running:false};
  if(command==='whoami')return {lines:[remote?'ubuntu':'tingxi'],running:false};
  if(command==='date')return {lines:['Thu Oct 15 11:24:00 CST 2026  [演示时间]'],running:false};
  if(command==='git status')return {lines:['On branch main','nothing to commit, working tree clean'],running:false};
  if(/^(npm|pnpm|yarn) (run )?(dev|start)$/.test(command))return {lines:['  VITE  ready in 248 ms','','  ➜  Local:   http://localhost:3000/','','  演示服务运行中，按 Ctrl+C 停止。'],running:true};
  return {lines:[`演示模式未执行：${command}`,'输入 help 查看可预览的指令。'],running:false};
}
export function createSession(name='zsh',directory='~/appCode/Portside',command?:string,serverId?:string):Session {
  const result=command?previewCommand(command,directory,!!serverId):{lines:[],running:false};
  return {id:crypto.randomUUID(),name,directory,serverId,running:result.running,lines:command?[`${serverId?'$':'❯'} ${command}`,'',...result.lines,'','[演示输出 · 未执行真实命令]']:['Portside 演示终端 · 非真实 Shell','输入 help 查看支持的指令。','']};
}
export default function TerminalPane({sessions,activeId,onNew}:{sessions:Session[];activeId:string;onNew?:()=>void}) {
  const {setActiveSession,updateSession,closeSession,settings}=useWorkspace();const {modal}=App.useApp();
  const active=sessions.find(s=>s.id===activeId)??sessions[0];const [input,setInput]=useState('');
  const [history,setHistory]=useState<string[]>([]);const [historyIndex,setHistoryIndex]=useState(-1);
  const [renaming,setRenaming]=useState<Session>();const [name,setName]=useState('');
  const output=useRef<HTMLDivElement>(null);const commandInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{setInput('');setHistoryIndex(-1)},[active?.id]);
  useEffect(()=>{if(output.current)output.current.scrollTop=output.current.scrollHeight},[active?.lines.length,active?.running]);
  const stop=()=>{if(active)updateSession(active.id,{running:false,lines:[...active.lines,'^C','演示任务已停止。','']})};
  const submit=()=>{
    if(!active||active.running||!input.trim())return;
    const command=input.trim();setInput('');setHistory(h=>[command,...h]);setHistoryIndex(-1);
    if(command==='clear'){updateSession(active.id,{lines:[]});return}
    const prefix=active.serverId?'$':'❯';
    if(command==='exit'){closeSession(active.id);return}
    const {lines,running}=previewCommand(command,active.directory,!!active.serverId);
    updateSession(active.id,{lines:[...active.lines,`${prefix} ${command}`,...lines,''],running});
  };
  const close=(session:Session)=>{
    const action=()=>closeSession(session.id);
    if(session.running)modal.confirm({title:`关闭 ${session.name}？`,content:'此标签有演示任务运行，关闭会同时停止该任务。',okText:'停止并关闭',cancelText:'取消',onOk:action});else action();
  };
  return <div className={`terminal-shell ${settings.terminalTheme==='light'?'terminal-light':''}`}>
    <div className="terminal-tabs">{sessions.map(s=><div key={s.id} className={`terminal-tab ${active?.id===s.id?'active':''}`}><Button type="text" size="small" styles={{content:{display:'contents'}}} className="tab-name" onClick={()=>setActiveSession(s.id)} onDoubleClick={()=>{setRenaming(s);setName(s.name)}} title={`${s.name} · 双击重命名`}><span className={`status-dot ${s.running?'':'paused'}`}/>{s.name}</Button><IconAction label={`关闭 ${s.name}`} onClick={()=>close(s)} icon={<IconX size={13}/>}/></div>)}{onNew&&<IconAction className="terminal-new" label="新建终端标签" onClick={onNew} icon={<IconPlus size={16}/>}/>}<div className="terminal-tab-actions">{active?.running&&<IconAction label="停止演示任务" onClick={stop} icon={<IconPlayerStop size={14}/>}/>}<IconAction label="清屏" onClick={()=>active&&updateSession(active.id,{lines:[]})} icon={<IconEraser size={15}/>}/></div></div>
    {active?<><div className="terminal-context"><span><IconTerminal2 size={13}/>{active.serverId?'远程演示':'本地'}<span className="terminal-context-divider">/</span>{active.directory}</span><span>zsh · 演示会话</span></div><div ref={output} className="terminal-output" onClick={()=>commandInput.current?.focus()}>{active.lines.map((line,i)=><div key={i} className={line.startsWith('❯')||line.startsWith('$')?'command-line':line.includes('➜')?'terminal-success':line.startsWith('[')||line.includes('演示')?'terminal-muted':''}>{line||'\u00a0'}</div>)}<form className="terminal-prompt" onSubmit={e=>{e.preventDefault();submit()}}><span>{active.serverId?'$':'❯'}</span><input ref={commandInput} aria-label="演示终端输入" spellCheck={false} autoComplete="off" value={input} placeholder={active.running?'演示任务运行中，按 Ctrl+C 停止':''} onChange={e=>!active.running&&setInput(e.target.value)} onKeyDown={e=>{if(e.ctrlKey&&e.key==='c'){e.preventDefault();stop()}if(e.ctrlKey&&e.key==='l'){e.preventDefault();updateSession(active.id,{lines:[]})}if(e.key==='ArrowUp'){e.preventDefault();const next=Math.min(historyIndex+1,history.length-1);setHistoryIndex(next);setInput(history[next]??'')}if(e.key==='ArrowDown'){e.preventDefault();const next=Math.max(-1,historyIndex-1);setHistoryIndex(next);setInput(history[next]??'')}}}/></form></div><div className="terminal-footer"><span><span className="status-dot"/>{active.running?'演示任务运行中':'会话就绪'}<span className="terminal-context-divider">·</span>未连接真实 Shell</span><span>UTF-8</span></div></>:<Empty title="一个新的起点" description="新建终端，预览本地命令交互。">{onNew&&<Button onClick={onNew}>新建终端</Button>}</Empty>}
    <Modal open={!!renaming} title="重命名终端" width={360} okText="保存" cancelText="取消" onCancel={()=>setRenaming(undefined)} onOk={()=>{if(name.trim()&&renaming){updateSession(renaming.id,{name:name.trim()});setRenaming(undefined)}}}><Input aria-label="终端名称" value={name} onChange={e=>setName(e.target.value)}/></Modal>
  </div>;
}
