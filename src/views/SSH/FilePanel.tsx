import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Progress } from 'paper-ink';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { IconFolder, IconFileText, IconUpload, IconArrowUp, IconRefresh, IconPlus, IconX, IconDownload, IconPencil, IconTrash } from 'paper-ink/icons';
import { Button, Input, Empty, IconAction } from '@/components/UI';
import { ssh, type RemoteDirectory, type TransferEvent } from '@/services/ssh';
import { terminalError } from '@/services/terminal';
const size=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
export default function FilePanel({serverId,serverName,initialPath='.',onOpenTerminal}:{serverId:string;serverName:string;initialPath?:string;onOpenTerminal:(path:string)=>void}) {
  const [directory,setDirectory]=useState<RemoteDirectory>({path:initialPath,files:[]});
  const [pathInput,setPathInput]=useState(initialPath);
  const [selected,setSelected]=useState('');const [editing,setEditing]=useState<{mode:'new'|'rename';name:string}>();const [name,setName]=useState('');
  const [transfer,setTransfer]=useState<TransferEvent>();const [transferring,setTransferring]=useState(false);const transferId=useRef<string|undefined>(undefined);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const request=useRef(0);const cancelled=useRef(false);const {message,modal}=App.useApp();
  const path=directory.path;
  const panel=useRef<HTMLElement>(null);
  const dropFiles=useRef<(paths:string[])=>void>(()=>{});
  useEffect(()=>{if(!isTauri())return;let unlisten:(()=>void)|undefined;let disposed=false;void getCurrentWebview().onDragDropEvent(event=>{if(event.payload.type!=='drop')return;const rect=panel.current?.getBoundingClientRect();if(!rect||!rect.width||!rect.height)return;const x=event.payload.position.x/window.devicePixelRatio,y=event.payload.position.y/window.devicePixelRatio;if(x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom)dropFiles.current(event.payload.paths)}).then(fn=>{if(disposed)fn();else unlisten=fn}).catch(e=>message.error(terminalError(e)));return()=>{disposed=true;unlisten?.()}},[]);
  const load=useCallback(async(next:string)=>{const id=++request.current;setBusy(true);setError('');try{const result=await ssh.list(serverId,next);if(id===request.current){setDirectory(result);setPathInput(result.path);setSelected('')}}catch(e){if(id===request.current){setError(terminalError(e));setPathInput(directory.path)}}finally{if(id===request.current)setBusy(false)}},[serverId,directory.path]);
  useEffect(()=>{void load(initialPath);return()=>{request.current+=1;cancelled.current=true;if(transferId.current)void ssh.cancelTransfer(transferId.current)}},[serverId]);
  const child=(name:string)=>`${path==='/'?'':path}/${name}`;
  const save=async()=>{if(!editing||!name.trim()||name==='.'||name==='..'||/[\/\0]/.test(name)){message.warning('请输入有效名称，不包含 /');return}setBusy(true);try{await ssh.action(serverId,editing.mode==='new'?path:child(editing.name),editing.mode==='new'?'mkdir':'rename',name.trim());setEditing(undefined);await load(path)}catch(e){message.error(terminalError(e));setBusy(false)}};
  const confirmOverwrite=(name:string)=>new Promise<boolean>(resolve=>modal.confirm({title:`覆盖 ${name}？`,content:'同名文件将被新文件替换。',okText:'覆盖',cancelText:'取消',onOk:()=>resolve(true),onCancel:()=>resolve(false)}));
  const startTransfer=async(localPaths:string[],upload:boolean,remoteName?:string)=>{
    if(transferring||!localPaths.length)return;setTransferring(true);cancelled.current=false;
    try{for(const localPath of localPaths){if(cancelled.current)break;const fileName=upload?localPath.split(/[\\/]/).pop()!:remoteName!;let overwrite=!upload; // Native save dialog has already confirmed an existing local destination.
      if(upload&&directory.files.some(file=>file.name===fileName)){overwrite=await confirmOverwrite(fileName);if(!overwrite)continue}
      const id=crypto.randomUUID();transferId.current=id;setTransfer({id,name:fileName,transferred:0,total:0,status:'running'});
      await ssh.transfer(serverId,id,localPath,child(fileName),upload,overwrite,event=>setTransfer(event));
    }await load(path)}catch(e){message.error(terminalError(e));setTransfer(undefined)}finally{setTransferring(false);transferId.current=undefined}
  };
  dropFiles.current=paths=>{if(!busy&&!transferring&&!error)void startTransfer(paths,true)};
  const upload=async()=>{try{const paths=await ssh.pickUpload();await startTransfer(paths,true)}catch(e){message.error(terminalError(e))}};
  const download=async()=>{try{if(!selected)return;const local=await ssh.pickDownload(selected);if(local)await startTransfer([local],false,selected)}catch(e){message.error(terminalError(e))}};
  const cancel=()=>{cancelled.current=true;if(transferId.current)void ssh.cancelTransfer(transferId.current).catch(e=>message.error(terminalError(e)));else setTransfer(undefined)};
  return <aside ref={panel} className="file-panel" aria-label={`${serverName} 文件`}><header className="file-server-context"><span className="status-dot"/><strong title={serverName}>{serverName}</strong><span className="subtle-badge">SFTP</span></header>
    <div className="file-path"><IconAction className="icon-button" label="返回上级" disabled={busy||path==='/'} onClick={()=>void load(path.slice(0,path.lastIndexOf('/'))||'/')} icon={<IconArrowUp size={15}/>}/><form onSubmit={e=>{e.preventDefault();void load(pathInput)}}><Input size="small" aria-label="远程路径" value={pathInput} onChange={e=>setPathInput(e.target.value)} onBlur={()=>setPathInput(path)}/></form><IconAction className="icon-button" label="刷新文件" disabled={busy} onClick={()=>void load(path)} icon={<IconRefresh size={14}/>}/></div>
    <div className="file-toolbar"><Button size="small" icon={<IconUpload size={14}/>} disabled={transferring||busy} onClick={()=>void upload()}>上传</Button><Button size="small" type="text" icon={<IconPlus size={14}/>} disabled={busy} onClick={()=>{setEditing({mode:'new',name:''});setName('')}}>新建目录</Button></div>
    <div className="file-list" aria-busy={busy}><div className="file-table-header"><span>名称</span><span>大小</span></div>{error?<Empty title="无法读取目录" description={error}><Button size="small" onClick={()=>void load(path)}>重试</Button></Empty>:directory.files.map(file=><Button type="text" size="small" styles={{content:{display:'contents'}}} key={file.name} className={`file-row ${selected===file.name?'selected':''}`} onClick={()=>setSelected(file.name)} onDoubleClick={()=>file.folder&&void load(child(file.name))} title={`${file.name}${file.symlink?' · 符号链接':''} · ${new Date(file.modified*1000).toLocaleString()}`}><span>{file.folder?<IconFolder className="folder-icon" size={17}/>:<IconFileText size={16}/>}<span>{file.name}</span></span><small>{file.folder?'—':size(file.size)}</small></Button>)}{!error&&!directory.files.length&&<Empty title={busy?'正在读取…':'空目录'} description={busy?'':'上传文件或新建一个目录。'}/>}</div>
    {selected&&<div className="file-selection"><span title={selected}>{selected}</span><div><IconAction className="icon-button" label="下载选中文件" disabled={transferring||directory.files.find(f=>f.name===selected)?.folder} onClick={()=>void download()} icon={<IconDownload size={15}/>}/><IconAction className="icon-button" label="重命名选中文件" disabled={busy} onClick={()=>{setEditing({mode:'rename',name:selected});setName(selected)}} icon={<IconPencil size={15}/>}/><IconAction className="icon-button danger-text" label="删除选中文件" disabled={busy} onClick={()=>modal.confirm({title:`删除 ${selected}？`,content:'此操作将永久删除远程文件；目录仅在为空时可删除。',okText:'删除',cancelText:'取消',onOk:async()=>{try{await ssh.action(serverId,child(selected),'delete');await load(path)}catch(e){message.error(terminalError(e));throw e}}})} icon={<IconTrash size={15}/>}/></div></div>}
    <Button className="file-terminal-button" type="text" size="small" disabled={!!error||busy} onClick={()=>onOpenTerminal(path)}>在此目录打开终端 ↗</Button>
    {transfer&&<div className="transfer"><div><span>{transfer.status==='completed'?'传输完成':`正在传输 ${transfer.total?Math.floor(transfer.transferred/transfer.total*100):0}%`}</span><IconAction className="icon-button" label={transferring?'取消传输':'关闭传输记录'} onClick={cancel} icon={<IconX size={13}/>}/></div><small>{transfer.name}</small><Progress percent={transfer.status==='completed'?100:transfer.total?Math.floor(transfer.transferred/transfer.total*100):0} showInfo={false} strokeColor="var(--accent)" size="small"/></div>}
    <div className="file-footer">{directory.files.length} 个项目<span>{busy?'读取中…':'拖入文件上传'}</span></div>
    {editing&&<div className="file-editor"><label>{editing.mode==='new'?'新建目录':'重命名'}<Input size="small" autoFocus aria-label="文件名称" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void save();if(e.key==='Escape')setEditing(undefined)}}/></label><Button size="small" onClick={()=>setEditing(undefined)}>取消</Button><Button size="small" type="primary" loading={busy} onClick={()=>void save()}>保存</Button></div>}
  </aside>;
}
