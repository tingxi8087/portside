import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Table, Select } from 'paper-ink';
import type { TableColumn } from 'paper-ink';
import { IconRefresh, IconArrowUpRight, IconCopy, IconX } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import type { Port, Process } from '@/data/demo';
import { Button, Search, ProcessIcon, Empty, DetailPanel, DetailRow, IconAction } from '@/components/UI';

export default function Ports() {
  const {ports,processes,endProcess,resetDemo}=useWorkspace();
  const narrow = useMediaQuery('(max-width: 760px)');
  const [query,setQuery]=useState(''); const [scope,setScope]=useState('all');
  const [selectedPid,setSelectedPid]=useState<number>(); const [ending,setEnding]=useState<number>();
  const selected=processes.find(process=>process.pid===selectedPid);
  const {message,modal}=App.useApp(); const navigate=useNavigate();
  const terminate=async(process:Process)=>{
    setEnding(process.pid);
    await new Promise(r=>setTimeout(r,650));
    endProcess(process.pid);setEnding(undefined);setSelectedPid(undefined);
    message.success(`演示：已结束 ${process.name}，相关端口已释放`);
  };
  const requestEnd=(process:Process)=>{
    if(process.user==='root'||process.app==='macOS') modal.confirm({title:`结束 ${process.name}？`,content:'此为系统服务演示。结束进程可能影响其所有关联端口；本次不会操作真实系统。',okText:'模拟结束',cancelText:'取消',onOk:()=>terminate(process)});
    else void terminate(process);
  };
  const data=ports.filter(p=>{const process=processes.find(item=>item.pid===p.pid);return (scope==='all'||scope===p.scope)&&`${p.port} ${p.pid} ${process?.name} ${process?.app}`.toLowerCase().includes(query.toLowerCase())}).sort((a,b)=>a.port-b.port);
  const columns: TableColumn<Port>[]=[
    {dataIndex:'port',title:'端口',width:'16%',render:(port,p)=><div className="port-value"><span className="status-dot"/><strong className="mono">{port}</strong><span className="protocol">{p.protocol}</span></div>},
    {dataIndex:'pid',key:'process',title:'进程',width:'33%',render:(pid)=>{const p=processes.find(p=>p.pid===pid)!;return <Button type="text" size="small" styles={{content:{display:'contents'}}} className="process-cell" onClick={()=>setSelectedPid(p.pid)}><ProcessIcon process={p}/><span><strong>{p.name}</strong><small>{p.app}</small></span></Button>}},
    {dataIndex:'pid',title:'PID',width:'15%',render:pid=><span className="mono muted">{pid}</span>},
    {dataIndex:'address',title:'监听地址',hidden:narrow,render:address=><span className="mono muted">{address}</span>},
    {key:'action',title:'',width:50,align:'right',render:(_,p)=><IconAction label="结束进程" aria-label={`结束进程 ${p.pid}`} icon={<IconX size={14}/>} danger loading={ending===p.pid} onClick={event=>{event.stopPropagation();requestEnd(processes.find(item=>item.pid===p.pid)!)}}/> },
  ];
  return <div className="page ports-page">
    <div className="toolbar"><Button aria-label="刷新" title="恢复演示数据" icon={<IconRefresh size={15}/>} onClick={()=>{resetDemo();message.success('演示数据已恢复')}}/><Select<string> className="scope-select" aria-label="端口范围" size="small" value={scope} onChange={setScope} options={[{value:"all",label:"全部端口"},{value:"local",label:"仅本机"},{value:"network",label:"局域网"}]}/><span className="toolbar-count">{data.length} 个端口</span><Search value={query} onChange={setQuery} placeholder="搜索端口、进程或 PID…"/></div>
    <div className="process-split"><div className="table-area"><Table<Port> rowKey="id" data={data} columns={columns} rowClassName={p=>p.pid===selectedPid?'selected-row':''} onRow={p=>({onClick:()=>setSelectedPid(p.pid),tabIndex:0,onKeyDown:event=>{if(event.key==='Enter'&&event.target===event.currentTarget)setSelectedPid(p.pid)},'aria-label':`查看端口 ${p.port} 进程详情`})} size="middle" empty={<Empty/>}/></div>
    <DetailPanel title="进程详情" onClear={selected?()=>setSelectedPid(undefined):undefined}>{selected&&<><div className="detail-identity"><ProcessIcon process={selected}/><div><h3>{selected.name}</h3><p>{selected.app}</p></div></div><DetailRow label="进程 ID"><span className="mono">{selected.pid}</span></DetailRow><DetailRow label="用户">{selected.user}</DetailRow><DetailRow label="CPU / 内存">{selected.cpu}% / {selected.memory} MB</DetailRow><DetailRow label="占用端口"><div className="chips">{ports.filter(p=>p.pid===selected.pid).map(p=><span key={p.id} className="chip mono">{p.port}</span>)}</div></DetailRow><div className="detail-block"><h4>启动命令</h4><code>{selected.command}</code><Button size="small" type="text" icon={<IconCopy size={14}/>} onClick={()=>{void navigator.clipboard?.writeText(selected.command).then(()=>message.success('已复制命令')).catch(()=>message.error('复制失败，请手动选择命令'))}}>复制</Button></div><Button block icon={<IconArrowUpRight size={15}/>} onClick={()=>navigate(`/processes?pid=${selected.pid}`)}>查看进程</Button><Button block type="text" danger loading={ending===selected.pid} onClick={()=>requestEnd(selected)}>结束此进程</Button></>}</DetailPanel></div>
  </div>;
}
