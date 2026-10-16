import { shortcutCommand } from '@/utils/shortcutCommand';
import ResizableWorkspace from '@/components/ResizableWorkspace';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Checkbox, Modal, Segmented, InputNumber, Tabs } from 'paper-ink';
import { IconPlus, IconServer, IconArrowUpRight, IconPlugConnectedX, IconFolder, IconPencil, IconTrash } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import type { Server } from '@/data/demo';
import TerminalPane, { createSession } from '@/components/TerminalPane';
import { Button, Input, Field, Search, Empty, IconAction } from '@/components/UI';
import ShortcutPanel from '@/components/ShortcutPanel';
import { ssh, sshTerminalTransport, type Credentials } from '@/services/ssh';
import { terminalError } from '@/services/terminal';
import FilePanel from './FilePanel';
import RemoteEditor from './components/RemoteEditor';
import { useRemoteEditors } from './components/RemoteEditor/useRemoteEditors';

const blank:Server={id:'',name:'',host:'',user:'root',port:22,auth:'key',group:'自定义',privateKeyPath:'~/.ssh/id_ed25519'};
export default function SSH() {
  const {servers,saveServer,deleteServer,sessions,activeSession,addSession,setActiveSession,closeSession}=useWorkspace();
  const [searchParams,setSearchParams]=useSearchParams();
  const [query,setQuery]=useState('');
  const [draft,setDraft]=useState<Server>();
  const [error,setError]=useState('');
  const [testStatus,setTestStatus]=useState<'idle'|'testing'|'success'>('idle');
  const [testSftpAvailable,setTestSftpAvailable]=useState(false);
  const testRequest=useRef(0);
  const [connecting,setConnecting]=useState('');
  const [disconnecting,setDisconnecting]=useState('');
  const [saving,setSaving]=useState(false);
  const [secret,setSecret]=useState('');
  const [remember,setRemember]=useState(true);
  const [hasSaved,setHasSaved]=useState(false);
  const temporaryCredentials=useRef(new Map<string,Credentials>());
  const editors=useRemoteEditors();
  const [sideTab,setSideTab]=useState<'connections'|'files'|'shortcuts'>('connections');
  const remoteSessions=sessions.filter(session=>session.serverId);
  const active=remoteSessions.find(session=>session.id===activeSession)??remoteSessions[0];
  const {message,modal}=App.useApp();
  const previouslyOpenServers=useRef(new Set<string>());
  useEffect(()=>{const current=new Set(sessions.filter(session=>session.serverId).map(session=>session.serverId!));for(const id of previouslyOpenServers.current){if(!current.has(id))void ssh.disconnect(id).catch(e=>message.error(terminalError(e)))}previouslyOpenServers.current=current},[sessions]);
  const resetTest=()=>{testRequest.current+=1;setTestStatus('idle');setError('')};
  const closeEditor=()=>{resetTest();setDraft(undefined);setSecret('')};
  const openEditor=async(server:Server={...blank})=>{resetTest();setDraft({...server});setSecret('');setHasSaved(false);setRemember(true);if(server.id){try{const exists=await ssh.hasCredentials(server.id);setHasSaved(exists);setRemember(exists)}catch(e){message.error(terminalError(e))}}};
  const updateDraft=(patch:Partial<Server>)=>{resetTest();setDraft(current=>current?{...current,...patch}:current)};
  const validTarget=(server:Server)=>!!server.host.trim()&&!!server.user.trim()&&/^[a-zA-Z0-9._:\-]+$/.test(server.host)&&Number.isInteger(server.port)&&server.port>=1&&server.port<=65535;
  const credentials=():Credentials|undefined=>secret?(draft?.auth==='password'?{password:secret}:{passphrase:secret}):draft?.id?temporaryCredentials.current.get(draft.id):undefined;
  const trust=async(server:Server,isCurrent=()=>true)=>{
    const info=await ssh.hostInfo(server);
    if(!isCurrent())throw new Error('已取消连接');
    if(info.status==='changed'){
      await new Promise<void>((resolve,reject)=>modal.confirm({title:'服务器身份已变化，已暂停连接',content:<div style={{fontSize:12,lineHeight:1.8}}><p>可能是服务器重装，也可能正在连接到其他服务器。请通过可信渠道核实新指纹。</p><p style={{overflowWrap:'anywhere'}}>原指纹：{info.previousFingerprint}<br/>新指纹：{info.fingerprint}</p></div>,okText:'已核实，继续确认',cancelText:'取消',onOk:()=>{modal.confirm({title:'替换已信任的主机指纹？',content:'只有已在服务器上核实新指纹时才应继续。后续连接将信任此新指纹。',okText:'替换并连接',cancelText:'取消',onOk:async()=>{try{await ssh.trust(server,info.fingerprint,info.previousFingerprint);resolve()}catch(e){reject(e);throw e}},onCancel:()=>reject(new Error('已取消连接'))})},onCancel:()=>reject(new Error('已取消连接'))}));return;
    }
    if(info.status==='trusted')return;
    await new Promise<void>((resolve,reject)=>modal.confirm({title:'确认服务器身份',content:<div style={{fontSize:12,lineHeight:1.8}}><p>首次连接 {server.host}:{server.port}。请与服务器管理员核对主机指纹后信任。</p><code style={{overflowWrap:'anywhere'}}>{info.keyType}<br/>{info.fingerprint}</code></div>,okText:'信任并继续',cancelText:'取消',onOk:async()=>{try{await ssh.trust(server,info.fingerprint);resolve()}catch(e){reject(e);throw e}},onCancel:()=>reject(new Error('已取消连接'))}));
  };
  const testConnection=async()=>{
    if(!draft||testStatus==='testing')return;
    resetTest();
    if(!validTarget(draft)){setError('请填写有效主机、用户名和 1–65535 范围内的端口');return}
    const request=++testRequest.current;
    setTestStatus('testing');
    try{await trust(draft,()=>request===testRequest.current);if(request!==testRequest.current)return;const result=await ssh.connect(draft,credentials(),true);if(request===testRequest.current){setTestSftpAvailable(result.sftpAvailable);setTestStatus('success')}}
    catch(e){if(request===testRequest.current){setTestStatus('idle');setError(terminalError(e))}}
  };
  useEffect(()=>()=>{testRequest.current+=1},[]);
  const connect=async(server:Server)=>{
    editors.setActiveId('');
    const existing=remoteSessions.find(session=>session.serverId===server.id&&session.running);
    if(existing){setActiveSession(existing.id);return}
    if(connecting||disconnecting)return;
    setConnecting(server.id);
    try{await trust(server);const result=await ssh.connect(server,temporaryCredentials.current.get(server.id));addSession(createSession(server.name,result.home,undefined,server.id))}
    catch(e){await openEditor(server);setError(terminalError(e))}
    finally{setConnecting('')}
  };
  const disconnect=async(server:Server)=>{
    if(connecting||disconnecting)return;
    setDisconnecting(server.id);
    try{
      if(!await editors.guardServer(server.id))return;
      const targetSessions=remoteSessions.filter(session=>session.serverId===server.id);
      await Promise.all(targetSessions.map(session=>sshTerminalTransport.close(session.id)));
      await ssh.disconnect(server.id);
      editors.removeServer(server.id);
      previouslyOpenServers.current.delete(server.id);
      targetSessions.forEach(session=>closeSession(session.id));
    }catch(e){message.error(terminalError(e))}
    finally{setDisconnecting('')}
  };
  useEffect(()=>{const id=searchParams.get('connect');if(!id)return;const server=servers.find(s=>s.id===id);setSearchParams(params=>{params.delete('connect');return params},{replace:true});if(server)void connect(server)},[searchParams,servers]);
  const save=async()=>{
    if(!draft||saving)return;
    if(!draft.name.trim()||!validTarget(draft)){setError('请填写名称、有效主机、用户名和 1–65535 范围内的端口');return}
    const id=draft.id||crypto.randomUUID();setSaving(true);
    try{const value=credentials();if(remember&&value)await ssh.saveCredentials(id,value);if(!remember&&hasSaved)await ssh.deleteCredentials(id);if(value)temporaryCredentials.current.set(id,value);saveServer({...draft,id,name:draft.name.trim(),host:draft.host.trim(),user:draft.user.trim()});closeEditor();message.success(remember&&(value||hasSaved)?'连接已保存，凭据已保存到本机':'连接已保存')}
    catch(e){setError(terminalError(e))}finally{setSaving(false)}
  };
  const remove=(server:Server)=>modal.confirm({title:`删除 ${server.name}？`,content:'删除此连接及其本机凭据。已打开的终端会话保留。',okText:'删除',cancelText:'取消',onOk:async()=>{try{await ssh.deleteCredentials(server.id);temporaryCredentials.current.delete(server.id);deleteServer(server.id)}catch(e){message.error(terminalError(e));throw e}}});
  const matchedServers=servers.filter(server=>`${server.name} ${server.host} ${server.user}`.toLowerCase().includes(query.toLowerCase()));
  const connections=<div className="connections-view">
    <div className="connection-search"><Search value={query} onChange={setQuery} placeholder="搜索连接或主机…"/></div>
    <div className="connection-list">
      {matchedServers.map(server=>{
        const connected=remoteSessions.some(session=>session.serverId===server.id&&session.running);
        return <div className={`connection-item ${active?.serverId===server.id?'is-active':''}`} key={server.id}>
          <div className="connection-title"><IconServer size={16} stroke={1.5}/><strong title={server.name}>{server.name}</strong>{connected&&<span className="connection-state"><span className="status-dot"/>已连接</span>}</div>
          <div className="connection-bottom"><span className="connection-address mono" title={`${server.user}@${server.host}:${server.port}`}>{server.user}@{server.host}:{server.port}</span><div className="inline-actions">
            <IconAction label={connected?'断开连接':'连接'} aria-label={`${connected?'断开连接':'连接'} ${server.name}`} icon={connected?<IconPlugConnectedX size={15}/>:<IconArrowUpRight size={15}/>} loading={connecting===server.id||disconnecting===server.id} disabled={!!(connecting||disconnecting)} onClick={()=>void (connected?disconnect(server):connect(server))}/>
            <IconAction label="编辑连接" aria-label={`编辑连接 ${server.name}`} icon={<IconPencil size={15}/>} onClick={()=>void openEditor(server)}/>
            <IconAction label="删除连接" aria-label={`删除连接 ${server.name}`} icon={<IconTrash size={15}/>} danger onClick={()=>remove(server)}/>
          </div></div>
        </div>;
      })}
      {!matchedServers.length&&<Empty title={servers.length?'没有匹配的连接':'还没有连接'} description={servers.length?'试试其他名称或主机。':'点击右上角加号添加服务器。'} icon={<IconServer size={25} stroke={1.3}/>}/>}
    </div>
    <div className="side-panel-footer">{servers.length} 个连接<span>SSH</span></div>
  </div>;
  const files=<div className="ssh-files-view">
    {!active&&<Empty title="尚未连接服务器" description="连接服务器后浏览文件。" icon={<IconFolder size={26} stroke={1.3}/>}/>}
    {Array.from(new Set(remoteSessions.map(session=>session.serverId!))).map(id=>{
      const serverName=servers.find(server=>server.id===id)?.name??remoteSessions.find(session=>session.serverId===id)?.name??'远程服务器';
      return <div className="ssh-file-instance" hidden={active?.serverId!==id} key={id}><FilePanel isOpeningFile={path=>editors.isOpening(id,path)} refreshKey={editors.versions[id]??0} onOpenFile={path=>void editors.open(id,serverName,path)} serverId={id} serverName={serverName} initialPath={remoteSessions.find(s=>s.serverId===id)?.directory==='~'?'.':remoteSessions.find(s=>s.serverId===id)?.directory??'.'} onOpenTerminal={path=>{editors.setActiveId('');addSession(createSession(`${serverName} · 文件`,path,undefined,id))}}/></div>;
    })}
  </div>;
  const runShortcut=(shortcut:{name:string;command:string;directory:string})=>{if(!active)return;editors.setActiveId('');void sshTerminalTransport.write(active.id,shortcutCommand(shortcut)).catch(e=>message.error(terminalError(e)))};
  const runShortcutNew=(shortcut:{name:string;command:string;directory:string})=>{if(!active)return;editors.setActiveId('');addSession(createSession(shortcut.name,shortcut.directory||'~',shortcut.command,active.serverId))};
  return <div className="page ssh-page">
    <ResizableWorkspace className="workbench-split" label="SSH 工具" sidebar={<aside className="ssh-sidebar" aria-label="SSH 工具">
        <Tabs className="ssh-sidebar-tabs" size="small" activeKey={sideTab} onChange={key=>setSideTab(key as typeof sideTab)} tabBarExtraContent={sideTab==='connections'?<IconAction label="新增连接" icon={<IconPlus size={16}/>} onClick={()=>void openEditor()}/>:undefined} items={[{key:'connections',label:'连接',children:connections},{key:'files',label:'文件',children:files},{key:'shortcuts',label:'快捷指令',children:<ShortcutPanel embedded directoryPicker={false} context={active?`运行到：${active.name}`:'未连接'} runDisabledReason={!active||!active.running?'请先连接服务器':undefined} newRunDisabledReason={!active||!active.running?'请先连接服务器':undefined} onRun={active?runShortcut:undefined} onRunNew={active?runShortcutNew:undefined}/>}]}/>
      </aside>}>
      {remoteSessions.length?<TerminalPane transport={sshTerminalTransport} sessions={remoteSessions} activeId={activeSession}/>:<div className="ssh-terminal-placeholder"><Empty title="选择右侧连接开始" description="连接后在这里使用远程终端。" icon={<IconServer size={28} stroke={1.2}/>}/></div>}
    </ResizableWorkspace>
    {editors.documents.map(doc=><Modal key={doc.id} open={editors.activeId===doc.id} title={`${doc.path.split('/').pop()}${doc.content!==doc.baseline?' •':''}`} centered width={800} footer={null} keyboard={false} maskClosable={false} closable={!doc.saving} rootClassName="remote-file-modal" onCancel={()=>void editors.close(doc.id)}>
      <RemoteEditor doc={doc} active={editors.activeId===doc.id} onChange={content=>editors.update(doc.id,{content})} onSave={()=>void editors.save(doc.id)} onReload={()=>void editors.reload(doc.id)} onDownload={()=>void (async()=>{try{const name=doc.path.split('/').pop()!;const local=await ssh.pickDownload(name);if(local)await ssh.transfer(doc.serverId,crypto.randomUUID(),local,doc.path,false,true,()=>{});}catch(error){message.error(terminalError(error))}})()}/>
    </Modal>)}
    {editors.confirmation}
    <Modal open={!!draft} title={draft?.id?'编辑 SSH 连接':'新增 SSH 连接'} rootClassName="ssh-editor-modal" centered width={480} onCancel={closeEditor} onOk={()=>void save()} footer={<div className="ssh-editor-footer"><Button size="small" loading={testStatus==='testing'} disabled={saving} onClick={()=>void testConnection()}>{testStatus==='testing'?'测试中…':'测试连接'}</Button><div className="ssh-editor-actions"><Button size="small" onClick={closeEditor}>取消</Button><Button size="small" type="primary" loading={saving} onClick={()=>void save()}>保存连接</Button></div></div>}>
      {draft&&<div className="form-stack ssh-form">
        <div className="ssh-form-row">
          <Field label="连接名称"><Input size="small" autoFocus placeholder="例如：Production" value={draft.name} onChange={e=>updateDraft({name:e.target.value})}/></Field>
          <Field label="用户名"><Input size="small" value={draft.user} onChange={e=>updateDraft({user:e.target.value})}/></Field>
        </div>
        <div className="ssh-form-row ssh-host-row">
          <Field label="主机"><Input size="small" placeholder="IP 地址或域名" value={draft.host} onChange={e=>updateDraft({host:e.target.value})}/></Field>
          <Field label="端口"><InputNumber size="small" aria-label="SSH 端口" min={1} max={65535} precision={0} value={draft.port} onChange={port=>updateDraft({port:port===null?0:Number(port)})}/></Field>
        </div>
        <div className="ssh-auth-row"><span>认证方式</span><Segmented<Server['auth']> aria-label="认证方式" block size="small" value={draft.auth} onChange={auth=>{updateDraft({auth});setSecret('')}} options={[{value:'key',label:'SSH 密钥'},{value:'password',label:'密码'},{value:'agent',label:'SSH Agent'}]}/></div>
        {draft.auth==='key'&&<Field label="私钥路径"><Input size="small" placeholder="~/.ssh/id_ed25519" value={draft.privateKeyPath??''} onChange={e=>updateDraft({privateKeyPath:e.target.value})}/></Field>}
        {draft.auth!=='agent'&&<><Field label={draft.auth==='key'?'私钥口令（可选）':'密码'} hint={hasSaved?'留空使用本机已保存的凭据。':undefined}><Input size="small" type="password" placeholder={draft.auth==='key'?'未加密私钥可留空':'输入密码'} value={secret} onChange={e=>{resetTest();setSecret(e.target.value)}}/></Field><Checkbox checked={remember} onChange={e=>setRemember(e.target.checked)}>保存凭据到本机（明文）</Checkbox></>}
        {testStatus==='success'&&<p role="status" className="ssh-test-result">{testSftpAvailable?'连接成功 · SSH 认证通过，SFTP 可用':'SSH 认证成功 · SFTP 不可用，仍可使用终端'}</p>}
        {error&&<p role="alert" className="form-error" style={{overflowWrap:'anywhere'}}>{error}</p>}
      </div>}
    </Modal>
  </div>;
}
