import { useEffect, useRef, useState } from 'react';
import { App, Modal, Segmented, InputNumber, Tabs } from 'paper-ink';
import { IconPlus, IconServer, IconArrowUpRight, IconFolder, IconPencil, IconTrash } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import type { Server } from '@/data/demo';
import TerminalPane, { createSession, previewCommand } from '@/components/TerminalPane';
import { Button, Input, Field, Search, Empty, IconAction } from '@/components/UI';
import ShortcutPanel from '@/components/ShortcutPanel';
import FilePanel from './FilePanel';

const blank:Server={id:'',name:'',host:'',user:'root',port:22,auth:'key',group:'自定义'};
export default function SSH() {
  const {servers,saveServer,deleteServer,sessions,activeSession,addSession,setActiveSession,updateSession}=useWorkspace();
  const [query,setQuery]=useState('');
  const [draft,setDraft]=useState<Server>();
  const [error,setError]=useState('');
  const [testStatus,setTestStatus]=useState<'idle'|'testing'|'success'>('idle');
  const testRequest=useRef(0);
  const [connecting,setConnecting]=useState('');
  const [secret,setSecret]=useState('');
  const [sideTab,setSideTab]=useState<'connections'|'files'|'shortcuts'>('connections');
  const remoteSessions=sessions.filter(session=>session.serverId);
  const active=remoteSessions.find(session=>session.id===activeSession)??remoteSessions[0];
  const [knownServerIds,setKnownServerIds]=useState(()=>Array.from(new Set(remoteSessions.map(session=>session.serverId!))));
  const {message,modal}=App.useApp();
  useEffect(()=>{
    setKnownServerIds(current=>{
      const next=Array.from(new Set([...current,...sessions.filter(session=>session.serverId).map(session=>session.serverId!)]));
      return next.length===current.length?current:next;
    });
  },[sessions]);
  const resetTest=()=>{testRequest.current+=1;setTestStatus('idle');setError('')};
  const closeEditor=()=>{resetTest();setDraft(undefined);setSecret('')};
  const openEditor=(server:Server={...blank})=>{resetTest();setDraft({...server});setSecret('')};
  const updateDraft=(patch:Partial<Server>)=>{resetTest();setDraft(current=>current?{...current,...patch}:current)};
  const validTarget=(server:Server)=>!!server.host.trim()&&!!server.user.trim()&&/^[a-zA-Z0-9._:\-]+$/.test(server.host)&&Number.isInteger(server.port)&&server.port>=1&&server.port<=65535;
  const testConnection=async()=>{
    if(!draft||testStatus==='testing')return;
    resetTest();
    if(!validTarget(draft)){setError('请填写有效主机、用户名和 1–65535 范围内的端口');return}
    const request=++testRequest.current;
    setTestStatus('testing');
    await new Promise(resolve=>setTimeout(resolve,700));
    if(request!==testRequest.current)return;
    setTestStatus('success');
  };
  useEffect(()=>()=>{testRequest.current+=1},[]);
  const connect=async(server:Server)=>{
    const existing=remoteSessions.find(session=>session.serverId===server.id);
    if(existing){setActiveSession(existing.id);return}
    if(connecting)return;
    setConnecting(server.id);
    await new Promise(resolve=>setTimeout(resolve,600));
    const session=createSession(server.name,'/home/ubuntu',undefined,server.id);
    session.lines=[`连接目标：${server.user}@${server.host}:${server.port}`,'','Welcome to Ubuntu 24.04 LTS (演示)','','这是模拟 SSH 会话，未发起网络连接。','输入 help 查看支持的演示指令。',''];
    addSession(session);setConnecting('');
  };
  const save=()=>{
    if(!draft)return;
    if(!draft.name.trim()||!validTarget(draft)){setError('请填写名称、有效主机、用户名和 1–65535 范围内的端口');return}
    saveServer({...draft,id:draft.id||crypto.randomUUID()});closeEditor();message.success('连接配置已保存；演示版不保存凭据');
  };
  const matchedServers=servers.filter(server=>`${server.name} ${server.host} ${server.user}`.toLowerCase().includes(query.toLowerCase()));
  const connections=<div className="connections-view">
    <div className="connection-search"><Search value={query} onChange={setQuery} placeholder="搜索连接或主机…"/></div>
    <div className="connection-list">
      {matchedServers.map(server=>{
        const connected=remoteSessions.some(session=>session.serverId===server.id);
        return <div className={`connection-item ${active?.serverId===server.id?'is-active':''}`} key={server.id}>
          <div className="connection-title"><IconServer size={16} stroke={1.5}/><strong title={server.name}>{server.name}</strong>{connected&&<span className="connection-state"><span className="status-dot"/>已连接</span>}</div>
          <div className="connection-bottom"><span className="connection-address mono" title={`${server.user}@${server.host}:${server.port}`}>{server.user}@{server.host}:{server.port}</span><div className="inline-actions">
            <IconAction label={connected?'打开会话':'连接'} aria-label={`${connected?'打开会话':'连接'} ${server.name}`} icon={<IconArrowUpRight size={15}/>} loading={connecting===server.id} disabled={!!connecting&&connecting!==server.id} onClick={()=>void connect(server)}/>
            <IconAction label="编辑连接" aria-label={`编辑连接 ${server.name}`} icon={<IconPencil size={15}/>} onClick={()=>openEditor(server)}/>
            <IconAction label="删除连接" aria-label={`删除连接 ${server.name}`} icon={<IconTrash size={15}/>} danger onClick={()=>modal.confirm({title:`删除 ${server.name}？`,content:'仅删除保存的连接配置，现有演示会话仍然保留。',okText:'删除',cancelText:'取消',onOk:()=>deleteServer(server.id)})}/>
          </div></div>
        </div>;
      })}
      {!matchedServers.length&&<Empty title={servers.length?'没有匹配的连接':'还没有连接'} description={servers.length?'试试其他名称或主机。':'点击右上角加号添加服务器。'} icon={<IconServer size={25} stroke={1.3}/>}/>}
    </div>
    <div className="side-panel-footer">{servers.length} 个连接<span>本地演示</span></div>
  </div>;
  const files=<div className="ssh-files-view">
    {!active&&<Empty title="尚未连接服务器" description="连接服务器后浏览文件。" icon={<IconFolder size={26} stroke={1.3}/>}/>}
    {knownServerIds.map(id=>{
      const serverName=servers.find(server=>server.id===id)?.name??remoteSessions.find(session=>session.serverId===id)?.name??'远程服务器';
      return <div className="ssh-file-instance" hidden={active?.serverId!==id} key={id}><FilePanel serverId={id} serverName={serverName} onOpenTerminal={path=>addSession(createSession(`${serverName} · 文件`,path,undefined,id))}/></div>;
    })}
  </div>;
  return <div className="page ssh-page">
    <div className="workbench-split">
      {remoteSessions.length?<TerminalPane sessions={remoteSessions} activeId={activeSession}/>:<div className="ssh-terminal-placeholder"><Empty title="选择右侧连接开始" description="连接后在这里使用远程终端。" icon={<IconServer size={28} stroke={1.2}/>}/><span className="placeholder-note">演示模式 · 不会发起真实连接</span></div>}
      <aside className="ssh-sidebar" aria-label="SSH 工具">
        <Tabs className="ssh-sidebar-tabs" size="small" activeKey={sideTab} onChange={key=>setSideTab(key as typeof sideTab)} tabBarExtraContent={sideTab==='connections'?<IconAction label="新增连接" icon={<IconPlus size={16}/>} onClick={()=>openEditor()}/>:undefined} items={[{key:'connections',label:'连接',children:connections},{key:'files',label:'文件',children:files},{key:'shortcuts',label:'快捷指令',children:<ShortcutPanel embedded defaultDirectory={active?.directory??'~'} context={active?`运行到：${active.name}`:'未连接'} runDisabledReason={!active?'请先连接服务器':active.running?'请先停止当前任务':undefined} onRun={active?shortcut=>{
          const result=previewCommand(shortcut.command,shortcut.directory,true);
          updateSession(active.id,{directory:shortcut.directory,running:result.running,lines:[...active.lines,`$ ${shortcut.command}`,...result.lines,'[演示输出 · 未执行真实命令]','']});
          message.success(`演示：已在 ${active.name} 运行「${shortcut.name}」`);
        }:undefined}/>}]}/>
      </aside>
    </div>
    <Modal open={!!draft} title={draft?.id?'编辑 SSH 连接':'新增 SSH 连接'} rootClassName="ssh-editor-modal" centered width={480} okText="保存连接" cancelText="取消" okButtonProps={{size:'small'}} cancelButtonProps={{size:'small'}} onCancel={closeEditor} onOk={save} footer={<div className="ssh-editor-footer"><Button size="small" loading={testStatus==='testing'} onClick={()=>void testConnection()}>{testStatus==='testing'?'测试中…':'测试连接'}</Button><div className="ssh-editor-actions"><Button size="small" onClick={closeEditor}>取消</Button><Button size="small" type="primary" onClick={save}>保存连接</Button></div></div>}>
      {draft&&<div className="form-stack ssh-form">
        <div className="ssh-form-row">
          <Field label="连接名称"><Input size="small" autoFocus placeholder="例如：Production" value={draft.name} onChange={e=>updateDraft({name:e.target.value})}/></Field>
          <Field label="用户名"><Input size="small" value={draft.user} onChange={e=>updateDraft({user:e.target.value})}/></Field>
        </div>
        <div className="ssh-form-row ssh-host-row">
          <Field label="主机"><Input size="small" placeholder="IP 地址或域名" value={draft.host} onChange={e=>updateDraft({host:e.target.value})}/></Field>
          <Field label="端口"><InputNumber size="small" aria-label="SSH 端口" min={1} max={65535} precision={0} value={draft.port} onChange={port=>updateDraft({port:port===null?0:Number(port)})}/></Field>
        </div>
        <div className="ssh-auth-row"><span>认证方式</span><Segmented<Server['auth']> aria-label="认证方式" block size="small" value={draft.auth} onChange={auth=>{updateDraft({auth});setSecret('')}} options={[{value:'key',label:'SSH 密钥'},{value:'password',label:'密码'}]}/></div>
        <Field label={draft.auth==='key'?'私钥路径':'密码'} hint="预览模式：凭据不读取、不保存。"><Input size="small" type={draft.auth==='key'?'text':'password'} placeholder={draft.auth==='key'?'~/.ssh/id_ed25519':'输入密码'} value={secret} onChange={e=>{resetTest();setSecret(e.target.value)}}/></Field>
        {testStatus==='success'&&<p role="status" className="ssh-test-result">模拟测试通过 · 未发起真实连接</p>}
        {error&&<p role="alert" className="form-error">{error}</p>}
      </div>}
    </Modal>
  </div>;
}
