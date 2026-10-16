import { useEffect, useRef, useState } from 'react';
import { IconTerminal2, IconX, IconPlus, IconPlayerStop, IconEraser, IconSearch, IconChevronUp, IconChevronDown } from 'paper-ink/icons';
import { App, Modal } from 'paper-ink';
import { useWorkspace } from '@/store/workspace';
import type { Session } from '@/data/demo';
import { Button, Input, Empty, IconAction } from '@/components/UI';
import { disposeTerminal, localTerminalTransport, terminalError, type TerminalTransport } from '@/services/terminal';
import { getRuntime } from './runtime';
import ShortcutHelp from './ShortcutHelp';
import { usePageSearch } from '@/hooks/usePageSearch';
import '@xterm/xterm/css/xterm.css';
import './terminal.css';

export function createSession(name='zsh',directory='~',command?:string,serverId?:string):Session {
  return {id:crypto.randomUUID(),name,directory,serverId,running:false,lines:[],initialCommand:command};
}
function TerminalViewport({session,transport,active,light,wallpaper,onStatus}:{wallpaper:boolean;session:Session;transport:TerminalTransport;active:boolean;light:boolean;onStatus:(status:string)=>void}){
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const runtime=getRuntime(session,transport);const target=container.current!;target.appendChild(runtime.node);
    const update=()=>{useWorkspace.getState().updateSession(session.id,{running:runtime.status==='ready'});onStatus(runtime.detail)};
    runtime.listeners.add(update);update();
    const resize=()=>{if(target.clientWidth&&target.clientHeight){try{runtime.fit.fit()}catch{}}};
    const observer=new ResizeObserver(resize);observer.observe(target);resize();
    return()=>{observer.disconnect();runtime.listeners.delete(update);runtime.node.remove()};
  },[session.id,transport]);
  useEffect(()=>{const runtime=getRuntime(session,transport);runtime.terminal.options.theme=light?{background:wallpaper?'#00000000':'#f6f4ee',foreground:'#393732',cursor:'#393732',selectionBackground:'#77756e66'}:{background:wallpaper?'#00000000':'#232220',foreground:'#d6d3cb',cursor:'#d6d3cb',selectionBackground:'#77756e88'};if(active){requestAnimationFrame(()=>{try{runtime.fit.fit();runtime.terminal.focus()}catch{}})}},[session.id,active,light,wallpaper,transport]);
  return <div ref={container} className="terminal-viewport" hidden={!active} aria-label={`${session.name} 终端`}/>;
}
export default function TerminalPane({sessions,activeId,onNew,transport=localTerminalTransport}:{sessions:Session[];activeId:string;onNew?:()=>void;transport?:TerminalTransport}) {
  const {setActiveSession,updateSession,closeSession,settings}=useWorkspace();const {modal,message}=App.useApp();
  const active=sessions.find(s=>s.id===activeId)??sessions[0];
  const [renaming,setRenaming]=useState<Session>();const [name,setName]=useState('');
  const [statuses,setStatuses]=useState<Record<string,string>>({});const [searchOpen,setSearchOpen]=useState(false);const [query,setQuery]=useState('');
  const pane=useRef<HTMLDivElement>(null);
  const focusSearch=usePageSearch(pane,'.terminal-search input',()=>setSearchOpen(true));
  const closeSearch=()=>{setSearchOpen(false);if(active)getRuntime(active,transport).terminal.focus()};
  const runtime=()=>active?getRuntime(active,transport):undefined;
  const closing=useRef(new Set<string>());
  const close=async(session:Session)=>{
    if(closing.current.has(session.id))return;
    closing.current.add(session.id);
    const finish=()=>{disposeTerminal(session.id);closeSession(session.id)};
    let content='关闭会话将结束其中运行的程序。';let confirming=false;
    try{
      if(!session.serverId&&transport.hasTasks){
        await getRuntime(session,transport).start;
        try{
          if(!await transport.hasTasks(session.id)){finish();return}
          content='当前终端有任务正在运行，关闭会话将结束这些任务。';
        }catch{content='无法确认当前终端的任务状态，关闭会话可能结束正在运行的任务。'}
      }
      confirming=true;modal.confirm({title:`关闭 ${session.name}？`,content,okText:'关闭会话',cancelText:'取消',onOk:finish,afterClose:()=>closing.current.delete(session.id)});
    }finally{if(!confirming)closing.current.delete(session.id)}
  };
  const find=(next=true,value=query)=>{if(!value)return;const addon=runtime()?.search;const found=next?addon?.findNext(value):addon?.findPrevious(value);if(!found)void message.info('没有找到匹配内容')};
  return <div ref={pane} className={`terminal-shell ${settings.terminalTheme==='light'?'terminal-light':''}`}>
    <div className="terminal-tabs">{sessions.map(s=><div key={s.id} className={`terminal-tab ${active?.id===s.id?'active':''}`}><Button type="text" size="small" styles={{content:{display:'contents'}}} className="tab-name" onClick={()=>setActiveSession(s.id)} onDoubleClick={()=>{setRenaming(s);setName(s.name)}} title={`${s.name} · 双击重命名`}><span className={`status-dot ${s.running?'':'paused'}`}/>{s.name}</Button><IconAction label={`关闭 ${s.name}`} onClick={()=>close(s)} icon={<IconX size={13}/>}/></div>)}{onNew&&<IconAction className="terminal-new" label="新建终端标签" onClick={onNew} icon={<IconPlus size={16}/>}/>}<div className="terminal-tab-actions"><ShortcutHelp/><IconAction label="搜索终端输出 ⌘F" disabled={!active} onClick={()=>searchOpen?closeSearch():focusSearch()} icon={<IconSearch size={14}/>}/><IconAction label="中断当前任务 Ctrl+C" disabled={!active?.running} onClick={()=>active&&void transport.write(active.id,'\x03').catch(error=>message.error(terminalError(error)))} icon={<IconPlayerStop size={14}/>}/><IconAction label="清屏" disabled={!active} onClick={()=>runtime()?.terminal.clear()} icon={<IconEraser size={15}/>}/></div></div>
    {active?<><div className="terminal-context"><span><IconTerminal2 size={13}/>{active.serverId?'远程':'本地'}<span className="terminal-context-divider">/</span>{active.directory}</span><span>交互终端</span></div>
      {searchOpen&&<div className="terminal-search"><Input size="small" autoFocus aria-label="搜索终端输出" placeholder="搜索输出…" value={query} onChange={event=>{setQuery(event.target.value);if(event.target.value)runtime()?.search.findNext(event.target.value)}} onKeyDown={event=>{if(event.key==='Enter')find(!event.shiftKey);if(event.key==='Escape')closeSearch()}}/><IconAction label="上一个结果" icon={<IconChevronUp size={14}/>} onClick={()=>find(false)}/><IconAction label="下一个结果" icon={<IconChevronDown size={14}/>} onClick={()=>find()}/><IconAction label="关闭搜索" icon={<IconX size={14}/>} onClick={closeSearch}/></div>}
      <div className="terminal-viewports">{sessions.map(session=><TerminalViewport key={session.id} session={session} transport={transport} active={active.id===session.id} light={settings.terminalTheme==='light'} wallpaper={!!settings.background&&settings.opacity>0} onStatus={status=>setStatuses(current=>current[session.id]===status?current:{...current,[session.id]:status})}/>)}</div>
      <div className="terminal-footer"><span><span className={`status-dot ${active.running?'':'paused'}`}/>{statuses[active.id]??'正在连接…'}</span><span>UTF-8</span></div></>:<Empty title="一个新的起点" description="新建终端，使用本地 Shell。">{onNew&&<Button onClick={onNew}>新建终端</Button>}</Empty>}
    <Modal open={!!renaming} title="重命名终端" width={360} okText="保存" cancelText="取消" onCancel={()=>setRenaming(undefined)} onOk={()=>{if(name.trim()&&renaming){updateSession(renaming.id,{name:name.trim()});setRenaming(undefined)}}}><Input aria-label="终端名称" value={name} onChange={event=>setName(event.target.value)}/></Modal>
  </div>;
}
