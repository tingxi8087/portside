import RowContextMenu from '@/components/RowContextMenu';
import ResizableWorkspace from '@/components/ResizableWorkspace';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Table, Select } from 'paper-ink';
import type { TableColumn } from 'paper-ink';
import { IconRefresh, IconArrowUpRight, IconCopy, IconX } from 'paper-ink/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSystemMonitor } from '@/hooks/useSystemMonitor';
import { useProcessActions } from '@/hooks/useProcessActions';
import { writeClipboard } from '@/services/clipboard';
import { metric, iconProcess, type SystemPort } from '@/services/system';
import { Button, Search, ProcessIcon, Empty, DetailPanel, DetailRow, IconAction } from '@/components/UI';

export default function Ports() {
  const { snapshot, error, loading, refresh } = useSystemMonitor('ports');
  const ports = snapshot?.ports ?? []; const processes = snapshot?.processes ?? [];
  const narrow = useMediaQuery('(max-width: 760px)');
  const [query,setQuery]=useState(''); const [scope,setScope]=useState('all');
  const [selectedIdentity,setSelectedIdentity]=useState<string>();
  const [context,setContext]=useState<{x:number;y:number;identity?:string}>();
  const closeContext=useCallback(()=>setContext(undefined),[]);
  const contextProcess=processes.find(p=>p.identity===context?.identity);
  const selected=processes.find(process=>process.identity===selectedIdentity);
  const {ending,requestEnd}=useProcessActions();
  const {message}=App.useApp(); const navigate=useNavigate();
  const data=ports.filter(p=>{const process=processes.find(item=>item.pid===p.pid);return (scope==='all'||scope===p.scope)&&`${p.port} ${p.pid} ${process?.name??''} ${process?.app??''} ${p.address}`.toLowerCase().includes(query.toLowerCase())}).sort((a,b)=>a.port-b.port);
  const columns: TableColumn<SystemPort>[]=[
    {dataIndex:'port',title:'端口',width:'16%',render:(port,p)=><div className="port-value"><span className="status-dot"/><strong className="mono">{port}</strong><span className="protocol">{p.protocol}</span></div>},
    {dataIndex:'pid',key:'process',title:'进程',width:'33%',render:(pid)=>{const p=processes.find(p=>p.pid===pid);return p?<Button type="text" size="small" styles={{content:{display:'contents'}}} className="process-cell" onClick={()=>setSelectedIdentity(p.identity)}><ProcessIcon process={iconProcess(p)}/><span><strong>{p.name}</strong><small title={p.executable}>{p.executable||'路径不可用'}</small></span></Button>:<span className="muted">已退出或无权限</span>}},
    {dataIndex:'pid',title:'PID',width:'15%',render:pid=><span className="mono muted">{pid}</span>},
    {dataIndex:'address',title:'监听地址',hidden:narrow,render:address=><span className="mono muted">{address}</span>},
    {key:'action',title:'',width:50,align:'right',render:(_,p)=>{const process=processes.find(item=>item.pid===p.pid);return <IconAction label="结束进程" aria-label={`结束进程 ${p.pid}`} icon={<IconX size={14}/>} danger disabled={!process||ending!==undefined} loading={ending===p.pid} onClick={event=>{event.stopPropagation();if(process)requestEnd(process)}}/>}},
  ];
  return <div className="page ports-page">
    <div className="toolbar"><Button aria-label="刷新" title="刷新真实端口" loading={loading} icon={<IconRefresh size={15}/>} onClick={()=>void refresh()}/><Select<string> className="scope-select" aria-label="端口范围" size="small" value={scope} onChange={setScope} options={[{value:'all',label:'全部端口'},{value:'local',label:'仅本机'},{value:'network',label:'非回环地址'}]}/><span className="toolbar-count" title={snapshot?.warnings.join('\n')}>{data.length} 个端口</span><Search value={query} onChange={setQuery} placeholder="搜索端口、进程或 PID…"/></div>
    {error&&<div role="alert" className="form-error" style={{padding:'8px 16px'}}>{error}</div>}
    <ResizableWorkspace className="process-split" label="进程详情" sidebar={<DetailPanel title="进程详情" onClear={selected?()=>setSelectedIdentity(undefined):undefined}>{selected&&<><div className="detail-identity"><ProcessIcon process={iconProcess(selected)}/><div><h3>{selected.name}</h3><p>{selected.user}</p></div></div><DetailRow label="进程 ID"><span className="mono">{selected.pid}</span></DetailRow><DetailRow label="用户">{selected.user}</DetailRow><DetailRow label="CPU / 内存">{metric(selected.cpu,'%')} / {metric(selected.memory,'MiB')}</DetailRow><DetailRow label="占用端口"><div className="chips">{ports.filter(p=>p.pid===selected.pid).map(p=><span key={p.id} className="chip mono">{p.port}</span>)}</div></DetailRow><div className="detail-block"><h4>启动命令</h4><code>{selected.command||'不可用'}</code><Button size="small" type="text" icon={<IconCopy size={14}/>} onClick={()=>{void writeClipboard(selected.command).then(()=>message.success('已复制命令')).catch(()=>message.error('复制失败，请手动选择命令'))}}>复制</Button></div><Button block icon={<IconArrowUpRight size={15}/>} onClick={()=>navigate(`/processes?pid=${selected.pid}`)}>查看进程</Button><Button block type="text" danger disabled={ending!==undefined} loading={ending===selected.pid} onClick={()=>requestEnd(selected)}>结束此进程</Button></>}</DetailPanel>}>
      <div className="table-area"><Table<SystemPort> rowKey="id" data={data} columns={columns} rowClassName={p=>selectedIdentity&&processes.find(item=>item.pid===p.pid)?.identity===selectedIdentity?'selected-row':''} onRow={p=>({onContextMenu:event=>{event.preventDefault();setContext({x:event.clientX,y:event.clientY,identity:processes.find(item=>item.pid===p.pid)?.identity})},onClick:()=>setSelectedIdentity(processes.find(item=>item.pid===p.pid)?.identity),tabIndex:0,onKeyDown:event=>{if(event.key==='Enter'&&event.target===event.currentTarget)setSelectedIdentity(processes.find(item=>item.pid===p.pid)?.identity)},'aria-label':`查看端口 ${p.port} 进程详情`})} size="middle" empty={<Empty title={loading?'正在读取端口…':'没有找到监听端口'} description="显示当前权限下可读取的 TCP 监听端口及 UDP 绑定端口。"/>}/></div>
    </ResizableWorkspace>
    {context&&<RowContextMenu key={`${context.x}:${context.y}:${context.identity}`} point={context} onClose={closeContext} items={[{key:'view',label:'查看进程',icon:<IconArrowUpRight size={15}/>,disabled:!contextProcess},{key:'end',label:'结束进程',icon:<IconX size={15}/>,danger:true,disabled:!contextProcess||ending!==undefined}]} onAction={key=>{if(!contextProcess)return;if(key==='view')navigate(`/processes?pid=${contextProcess.pid}`);if(key==='end')requestEnd(contextProcess)}}/>}
  </div>;
}
