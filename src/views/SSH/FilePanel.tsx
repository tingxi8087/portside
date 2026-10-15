import { useEffect, useRef, useState } from 'react';
import { App, Progress } from 'paper-ink';
import { IconFolder, IconFileText, IconUpload, IconArrowUp, IconRefresh, IconPlus, IconX, IconDownload, IconPencil, IconTrash } from 'paper-ink/icons';
import { Button, Input, Empty, IconAction } from '@/components/UI';
import { useWorkspace } from '@/store/workspace';
import { initialFiles } from '@/data/demoFiles';
import type { FileItem } from '@/data/demoFiles';
import type { SetStateAction } from 'react';

export default function FilePanel({serverId,serverName,onOpenTerminal}:{serverId:string;serverName:string;onOpenTerminal:(path:string)=>void}) {
  const workspace=useWorkspace(state=>state.remoteFiles[serverId]);
  const updateRemoteFiles=useWorkspace(state=>state.updateRemoteFiles);
  const files=workspace?.files??initialFiles;
  const path=workspace?.path??'/home/ubuntu';
  const setFiles=(update:SetStateAction<Record<string,FileItem[]>>)=>updateRemoteFiles(serverId,state=>({...state,files:typeof update==='function'?update(state.files):update}));
  const [pathInput,setPathInput]=useState(path);
  const [selected,setSelected]=useState('');const [editing,setEditing]=useState<{mode:'new'|'rename';name:string}>();const [name,setName]=useState('');
  const [transfer,setTransfer]=useState<{name:string;progress:number;files:FileItem[];path:string}>();const upload=useRef<HTMLInputElement>(null);const {message,modal}=App.useApp();
  useEffect(()=>{if(!transfer||transfer.progress>=100)return;const timer=setTimeout(()=>{setTransfer(t=>t?{...t,progress:Math.min(100,t.progress+20)}:t)},350);return()=>clearTimeout(timer)},[transfer]);
  useEffect(()=>{if(transfer?.progress===100){const done=transfer;setFiles(f=>({...f,[done.path]:[...(f[done.path]??[]).filter(old=>!done.files.some(n=>n.name===old.name)),...done.files]}));message.success('演示上传完成，仅添加文件名，未传输文件内容')}},[transfer?.progress]);
  const go=(next:string)=>{const normalized=next.replace(/\/$/,'')||'/';if(!files[normalized]){message.warning('演示目录不存在');return}updateRemoteFiles(serverId,state=>({...state,path:normalized}));setPathInput(normalized);setSelected('')};
  const child=(name:string)=>`${path==='/'?'':path}/${name}`;
  const save=()=>{
    if(!editing||!name.trim()||/[\/]/.test(name)){message.warning('请输入有效名称，不包含 /');return}
    if(files[path].some(f=>f.name===name&&f.name!==editing.name)){message.warning('同名文件已存在');return}
    if(editing.mode==='new'){const newPath=child(name);setFiles(f=>({...f,[path]:[...f[path],{name,folder:true,size:'—',modified:'刚刚'}],[newPath]:[]}))}
    else {const oldPath=child(editing.name),newPath=child(name);setFiles(f=>{const next={...f,[path]:f[path].map(item=>item.name===editing.name?{...item,name}:item)};for(const key of Object.keys(f)){if(key===oldPath||key.startsWith(oldPath+'/')){next[newPath+key.slice(oldPath.length)]=f[key];delete next[key]}}return next})}
    setEditing(undefined);setSelected(name);
  };
  const receive=(input:FileList|null)=>{if(!input?.length)return;const newItems=Array.from(input).map(file=>({name:file.name,folder:false,size:`${(file.size/1024).toFixed(1)} KB`,modified:'刚刚'}));const start=()=>setTransfer({name:newItems.map(f=>f.name).join('、'),progress:0,files:newItems,path});if(newItems.some(n=>files[path].some(old=>old.name===n.name)))modal.confirm({title:'覆盖同名演示文件？',content:newItems.filter(n=>files[path].some(old=>old.name===n.name)).map(n=>n.name).join('、'),okText:'覆盖',cancelText:'取消',onOk:start});else start()};
  const download=()=>{const item=files[path].find(f=>f.name===selected);if(!item||item.folder)return;const url=URL.createObjectURL(new Blob([`Portside 演示文件\n\n路径：${child(item.name)}\n此文件由界面预览生成，不是远程文件内容。\n`],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`demo-${item.name}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message.success('已下载演示文本，非远程文件')};
  return <aside className="file-panel" aria-label={`${serverName} 文件`} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();receive(e.dataTransfer.files)}}><header className="file-server-context"><span className="status-dot"/><strong title={serverName}>{serverName}</strong><span className="subtle-badge">SFTP 演示</span></header>
    <div className="file-path"><IconAction className="icon-button" label="返回上级" disabled={path==='/'} onClick={()=>go(path.slice(0,path.lastIndexOf('/'))||'/')} icon={<IconArrowUp size={15}/>}/><form onSubmit={e=>{e.preventDefault();go(pathInput)}}><Input size="small" aria-label="远程路径" value={pathInput} onChange={e=>setPathInput(e.target.value)} onBlur={()=>setPathInput(path)}/></form><IconAction className="icon-button" label="刷新文件" onClick={()=>message.success('演示目录已刷新')} icon={<IconRefresh size={14}/>}/></div>
    <div className="file-toolbar"><Button size="small" icon={<IconUpload size={14}/>} disabled={!!transfer&&transfer.progress<100} onClick={()=>upload.current?.click()}>上传</Button><Button size="small" type="text" icon={<IconPlus size={14}/>} onClick={()=>{setEditing({mode:'new',name:''});setName('')}}>新建目录</Button><input ref={upload} type="file" multiple hidden onChange={e=>{receive(e.target.files);e.target.value=''}}/></div>
    <div className="file-list"><div className="file-table-header"><span>名称</span><span>大小</span></div>{files[path].map(file=><Button type="text" size="small" styles={{content:{display:'contents'}}} key={file.name} className={`file-row ${selected===file.name?'selected':''}`} onClick={()=>setSelected(file.name)} onDoubleClick={()=>file.folder&&go(child(file.name))} title={`${file.name} · ${file.modified}`}><span>{file.folder?<IconFolder className="folder-icon" size={17}/>:<IconFileText size={16}/>}<span>{file.name}</span></span><small>{file.size}</small></Button>)}{!files[path].length&&<Empty title="空目录" description="上传文件或新建一个目录。"/>}</div>
    {selected&&<div className="file-selection"><span title={selected}>{selected}</span><div><IconAction className="icon-button" label="下载选中文件" disabled={files[path].find(f=>f.name===selected)?.folder} onClick={download} icon={<IconDownload size={15}/>}/><IconAction className="icon-button" label="重命名选中文件" onClick={()=>{setEditing({mode:'rename',name:selected});setName(selected)}} icon={<IconPencil size={15}/>}/><IconAction className="icon-button danger-text" label="删除选中文件" onClick={()=>modal.confirm({title:`删除 ${selected}？`,content:'仅删除演示文件条目，不会操作远程服务器。',okText:'删除',cancelText:'取消',onOk:()=>{setFiles(f=>({...f,[path]:f[path].filter(item=>item.name!==selected)}));setSelected('')}})} icon={<IconTrash size={15}/>}/></div></div>}
    <Button className="file-terminal-button" type="text" size="small" onClick={()=>onOpenTerminal(path)}>在此目录打开终端 ↗</Button>
    {transfer&&<div className="transfer"><div><span>{transfer.progress===100?'演示上传完成':`正在模拟上传 ${transfer.progress}%`}</span><IconAction className="icon-button" label="取消或关闭传输" onClick={()=>setTransfer(undefined)} icon={<IconX size={13}/>}/></div><small>{transfer.name}</small><Progress percent={transfer.progress} showInfo={false} strokeColor="var(--accent)" size="small"/></div>}
    <div className="file-footer">{files[path].length} 个项目<span>拖入文件模拟上传</span></div>
    {editing&&<div className="file-editor"><label>{editing.mode==='new'?'新建目录':'重命名'}<Input size="small" autoFocus aria-label="文件名称" value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')save();if(e.key==='Escape')setEditing(undefined)}}/></label><Button size="small" onClick={()=>setEditing(undefined)}>取消</Button><Button size="small" type="primary" onClick={save}>保存</Button></div>}
  </aside>;
}
