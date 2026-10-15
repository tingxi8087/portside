import { useRef, useState } from 'react';
import { App, Modal } from 'paper-ink';
import { Button } from '@/components/UI';
import { ssh, type RemoteTextFile } from '@/services/ssh';
import { terminalError } from '@/services/terminal';
export type RemoteDocument=RemoteTextFile & {id:string;serverId:string;serverName:string;baseline:string|null;saving:boolean;error:string;generation:number};
export type TextTransport=Pick<typeof ssh,'readText'|'saveText'>;
export function useRemoteEditors(transport:TextTransport=ssh) {
  const [documents,setDocuments]=useState<RemoteDocument[]>([]);const docs=useRef(documents);docs.current=documents;
  const [versions,setVersions]=useState<Record<string,number>>({});
  const [activeId,setActiveId]=useState('');const {message}=App.useApp();
  const savingIds=useRef(new Set<string>());
  const opening=useRef(new Set<string>());const epochs=useRef(new Map<string,number>());
  const [pending,setPending]=useState<{ids:string[];resolve:(allow:boolean)=>void}>();const pendingRef=useRef(false);
  const [guardSaving,setGuardSaving]=useState(false);
  const update=(id:string,change:Partial<RemoteDocument>)=>setDocuments(current=>{const next=current.map(doc=>doc.id===id?{...doc,...change}:doc);docs.current=next;return next});
  const open=async(serverId:string,serverName:string,path:string)=>{
    const existing=docs.current.find(doc=>doc.serverId===serverId&&doc.path===path);
    if(existing){setActiveId(existing.id);return}
    const key=JSON.stringify([serverId,path]);if(opening.current.has(key))return;
    opening.current.add(key);const epoch=epochs.current.get(serverId)??0;
    try {
      const file=await transport.readText(serverId,path);
      if((epochs.current.get(serverId)??0)!==epoch)return;
      const duplicate=docs.current.find(doc=>doc.serverId===serverId&&doc.path===file.path);
      if(duplicate){setActiveId(duplicate.id);return}
      const doc:RemoteDocument={...file,id:crypto.randomUUID(),serverId,serverName,baseline:file.content,saving:false,error:'',generation:0};
      setDocuments(current=>{const next=[...current,doc];docs.current=next;return next});setActiveId(doc.id);
    }catch(error){message.error(terminalError(error))}finally{opening.current.delete(key)}
  };
  const save=async(id:string)=>{
    const doc=docs.current.find(d=>d.id===id);
    if(!doc||doc.saving||savingIds.current.has(id)||doc.content===null)return false;
    if(doc.content===doc.baseline)return true;
    savingIds.current.add(id);update(id,{saving:true,error:''});
    try {
      const saved=await transport.saveText(doc.serverId,doc.path,doc.content,doc.revision);
      update(id,{baseline:doc.content,revision:saved.revision,size:saved.size,saving:false,error:''});setVersions(current=>({...current,[doc.serverId]:(current[doc.serverId]??0)+1}));return true;
    }catch(error){update(id,{saving:false,error:terminalError(error)});return false}finally{savingIds.current.delete(id)}
  };
  const guard=(ids:string[])=>{
    const targets=docs.current.filter(doc=>ids.includes(doc.id));
    if(targets.some(doc=>doc.saving||savingIds.current.has(doc.id))){message.info('文件正在保存，请稍后再试');return Promise.resolve(false)}
    const dirty=targets.filter(doc=>doc.content!==doc.baseline);
    if(!dirty.length)return Promise.resolve(true);
    if(pendingRef.current)return Promise.resolve(false);
    pendingRef.current=true;return new Promise<boolean>(resolve=>setPending({ids:dirty.map(doc=>doc.id),resolve}));
  };
  const answer=(allow:boolean)=>{pending?.resolve(allow);pendingRef.current=false;setPending(undefined)};
  const savePending=async()=>{
    if(!pending||guardSaving)return;setGuardSaving(true);
    try{for(const id of pending.ids){if(!await save(id)){setActiveId(id);message.error('保存失败，已保留编辑内容');return}}answer(true)}finally{setGuardSaving(false)}
  };
  const remove=(id:string)=>{setDocuments(current=>current.filter(doc=>doc.id!==id));if(activeId===id)setActiveId('')};
  const close=async(id:string)=>{if(await guard([id]))remove(id)};
  const guardServer=(serverId:string)=>guard(docs.current.filter(doc=>doc.serverId===serverId).map(doc=>doc.id));
  const removeServer=(serverId:string)=>{
    epochs.current.set(serverId,(epochs.current.get(serverId)??0)+1);
    if(docs.current.some(doc=>doc.serverId===serverId&&doc.id===activeId))setActiveId('');
    setDocuments(current=>current.filter(doc=>doc.serverId!==serverId));
  };
  const reload=async(id:string)=>{
    if(!await guard([id]))return;
    const doc=docs.current.find(d=>d.id===id);if(!doc)return;update(id,{saving:true,error:''});
    try{const file=await transport.readText(doc.serverId,doc.path);update(id,{...file,baseline:file.content,saving:false,error:'',generation:doc.generation+1})}
    catch(error){update(id,{saving:false,error:terminalError(error)})}
  };
  const confirmation=<Modal open={!!pending} centered width={420} title="有未保存的修改" closable={!guardSaving} maskClosable={!guardSaving} keyboard={!guardSaving} onCancel={()=>{if(!guardSaving)answer(false)}} footer={<><Button size="small" disabled={guardSaving} onClick={()=>answer(false)}>取消</Button><Button size="small" disabled={guardSaving} onClick={()=>answer(true)}>不保存</Button><Button size="small" type="primary" loading={guardSaving} onClick={()=>void savePending()}>保存</Button></>}>
    <p style={{fontSize:12,lineHeight:1.8,overflowWrap:'anywhere'}}>{pending?.ids.map(id=>docs.current.find(doc=>doc.id===id)?.path.split('/').pop()).join('、')} 尚未保存。</p>
  </Modal>;
  return {documents,versions,activeId,setActiveId,open,save,close,reload,guardServer,removeServer,update,confirmation};
}
