import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { App as InkApp, ConfigProvider, Modal, Tabs, Button, Input } from 'paper-ink';
import { IconPlugConnected, IconActivity, IconTerminal2, IconServer, IconSettings, IconCommand, IconSearch, IconBolt, IconPlus, IconChevronRight } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import { createSession } from '@/components/TerminalPane';
import Ports from '@/views/Ports';
import Processes from '@/views/Processes';
import Terminal from '@/views/Terminal';
import SSH from '@/views/SSH';
import Settings from '@/views/Settings';

const links=[{to:'/terminal',label:'终端',Icon:IconTerminal2},{to:'/ssh',label:'SSH',Icon:IconServer},{to:'/ports',label:'端口',Icon:IconPlugConnected},{to:'/processes',label:'进程',Icon:IconActivity}];
function Shell() {
  const {shortcuts,servers,addSession,settings}=useWorkspace();const navigate=useNavigate();const location=useLocation();
  const [palette,setPalette]=useState(false);const [query,setQuery]=useState('');
  const [settingsOpen,setSettingsOpen]=useState(false);
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setPalette(p=>!p);setQuery('')}if(event.key==='Escape'&&!(event.target instanceof Element&&event.target.closest('.terminal-output'))){const search=document.querySelector<HTMLInputElement>('.search input');if(search?.value&&document.activeElement===search){const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}))}}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[]);
  const actions=[...links.map(item=>({key:item.to,label:item.label,detail:'打开页面',Icon:item.Icon,run:()=>navigate(item.to)})),{key:'new-terminal',label:'新建本地终端',detail:'本地演示会话',Icon:IconPlus,run:()=>{addSession(createSession());navigate('/terminal')}},...shortcuts.map(item=>({key:item.id,label:item.name,detail:item.command,Icon:IconBolt,run:()=>{addSession(createSession(item.name,item.directory,item.command));navigate('/terminal')}})),...servers.map(server=>({key:server.id,label:`连接 ${server.name}`,detail:`${server.user}@${server.host}`,Icon:IconServer,run:()=>{const session=createSession(server.name,'/home/ubuntu',undefined,server.id);addSession(session);navigate(`/ssh?session=${session.id}`)}}))].filter(a=>`${a.label} ${a.detail}`.toLowerCase().includes(query.toLowerCase()));
  const isDesktop='__TAURI_INTERNALS__' in window;
  return <div className={`app-shell ${isDesktop?'is-desktop':''}`}>{settings.background&&<div className="custom-background" style={{backgroundImage:`url("${settings.background}")`,opacity:settings.opacity/100,filter:`blur(${settings.blur}px)`}}/>}
    <header className="titlebar" data-tauri-drag-region>
      <div className="window-identity" data-tauri-drag-region>
        <div className="traffic-lights" aria-hidden="true">{!isDesktop&&<><i/><i/><i/></>}</div>
        <span className="window-name" data-tauri-drag-region>Portside</span>
      </div>
      <Tabs className="top-tabs" size="small" aria-label="功能" activeKey={location.pathname} onChange={navigate} items={links.map(({to,label})=>({key:to,label}))}/>
      <div className="window-tools">
        <span className="preview-badge" title="全部为演示数据，操作不影响真实系统">演示</span>
        <Button type="text" size="small" styles={{content:{display:'contents'}}} className="icon-button" aria-label="快速操作" title="快速操作 ⌘K" onClick={()=>{setPalette(true);setQuery('')}}><IconCommand size={16}/></Button>
        <Button type="text" size="small" styles={{content:{display:'contents'}}} className="icon-button" aria-label="设置" title="设置" onClick={()=>setSettingsOpen(true)}><IconSettings size={17} stroke={1.6}/></Button>
      </div>
    </header>
    <main className="workspace" aria-label={links.find(link=>link.to===location.pathname)?.label}><Routes><Route path="/ports" element={<Ports/>}/><Route path="/processes" element={<Processes/>}/><Route path="/terminal" element={<Terminal/>}/><Route path="/ssh" element={<SSH/>}/><Route path="/settings" element={<Navigate to="/terminal" replace/>}/><Route path="*" element={<Navigate to="/terminal" replace/>}/></Routes></main>
    <Modal open={settingsOpen} onCancel={()=>setSettingsOpen(false)} width={640} footer={null} title="设置" rootClassName="settings-modal"><Settings/></Modal>
    <Modal open={palette} onCancel={()=>setPalette(false)} width={540} footer={null} title={null} rootClassName="command-modal"><div className="command-search"><Input prefix={<IconSearch size={18}/>} autoFocus aria-label="搜索快速操作" placeholder="搜索页面、连接或快捷指令…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&actions[0]){actions[0].run();setPalette(false)}}}/><kbd>ESC</kbd></div><div className="command-results">{actions.map(({key,label,detail,Icon,run})=><Button type="text" size="small" styles={{content:{display:'contents'}}} key={key} onClick={()=>{run();setPalette(false)}}><Icon size={18}/><span><strong>{label}</strong><small>{detail}</small></span><IconChevronRight size={15}/></Button>)}{!actions.length&&<p className="muted command-empty">没有匹配的操作</p>}</div><div className="command-hint">点击执行<span>↵ 执行第一项</span></div></Modal>
  </div>;
}
export default function App() {
  const settings=useWorkspace(s=>s.settings);const [systemDark,setSystemDark]=useState(window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)');const change=()=>setSystemDark(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[]);
  const dark=settings.theme==='dark'||settings.theme==='system'&&systemDark;
  const ink = dark ? '#e5e3de' : '#292825';
  useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.setProperty('--accent',ink)},[dark,ink]);
  const palette = dark
    ? { text: { primary: '#e5e3de', secondary: '#a4a29d', disabled: '#686762' }, surface: { page: '#242321', container: '#242321', elevated: '#2c2b28', muted: '#302f2c' }, border: { default: '#53514c', subtle: '#393834' } }
    : { text: { primary: '#292825', secondary: '#77756e', disabled: '#aaa79f' }, surface: { page: '#fdfcf9', container: '#fdfcf9', elevated: '#fffefa', muted: '#f2f0eb' }, border: { default: '#cbc7be', subtle: '#e5e2da' } };
  const monochrome={solid:ink,solidHover:dark?'#f4f2ec':'#45433e',solidActive:dark?'#ccc9bf':'#171715',onSolid:dark?'#242321':'#fffefa',subtle:palette.surface.muted,onSubtle:ink,border:palette.border.default};
  return <ConfigProvider theme={{token:{
    font:{size:13,family:'"Avenir Next", "PingFang SC", sans-serif'},
    radius:{control:6},control:{height:{middle:32,small:26}},
    color:{...palette,primary:monochrome,success:monochrome,info:monochrome,link:{default:ink,hover:ink,active:ink}},
  }}}><InkApp><HashRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Shell/></HashRouter></InkApp></ConfigProvider>;
}
