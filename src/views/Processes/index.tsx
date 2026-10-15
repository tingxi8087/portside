import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Table, Select } from 'paper-ink';
import type { TableColumn, TableSort } from 'paper-ink';
import orderBy from 'lodash/orderBy';
import { IconAdjustmentsHorizontal, IconPlayerPause, IconPlayerPlay } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import type { Process } from '@/data/demo';
import { Button, Search, ProcessIcon, Empty, DetailPanel, DetailRow } from '@/components/UI';

export default function Processes() {
  const {processes,ports,endProcess,settings,setSettings}=useWorkspace(); const [params]=useSearchParams();
  const [query,setQuery]=useState('');const [scope,setScope]=useState('mine');const [paused,setPaused]=useState(false);
  const [sort,setSort]=useState<TableSort|null>({key:'cpu',order:'descend'});
  const [selectedPid,setSelectedPid]=useState<number|undefined>(Number(params.get('pid'))||undefined);
  const selected=processes.find(p=>p.pid===selectedPid);const {modal,message}=App.useApp();
  const data=orderBy(processes.filter(p=>(scope==='all'||p.user==='tingxi')&&`${p.name} ${p.pid} ${p.app}`.toLowerCase().includes(query.toLowerCase())),[sort?.key??'name'],[sort?.order==='descend'?'desc':'asc']);
  const columns:TableColumn<Process>[]=[
    {dataIndex:'name',title:'进程名称',sorter:true,width:'35%',render:(_,p)=><div className="process-cell"><ProcessIcon process={p}/><span><strong>{p.name}</strong><small>{p.app}</small></span></div>},
    {dataIndex:'cpu',title:'CPU',sorter:true,render:cpu=><div className="metric"><span className="mono">{cpu.toFixed(1)}<span className="muted"> %</span></span><span className="metric-track"><i style={{width:`${Math.min(cpu*8,100)}%`}}/></span></div>},
    {dataIndex:'memory',title:'内存',sorter:true,render:memory=><span className="mono">{memory.toFixed(1)} <span className="muted">MB</span></span>},
    {dataIndex:'pid',title:'PID',sorter:true,render:pid=><span className="mono muted">{pid}</span>},
    {dataIndex:'disk',title:'磁盘读写',sorter:true,hidden:!settings.extraColumns,render:n=><span className="mono">{n} KB/s</span>},
    {dataIndex:'network',title:'网络',sorter:true,hidden:!settings.extraColumns,render:n=><span className="mono">{n} KB/s</span>},
  ];
  return <div className={`page processes-page ${settings.extraColumns?'has-extra-columns':''}`}>
    <div className="toolbar"><Button aria-label={paused?'继续刷新':'暂停刷新'} title={paused?'继续刷新':'暂停刷新'} icon={paused?<IconPlayerPlay size={15}/>:<IconPlayerPause size={15}/>} onClick={()=>setPaused(!paused)}/><Button aria-label={settings.extraColumns?'精简列':'显示更多列'} title={settings.extraColumns?'精简列':'显示更多列'} icon={<IconAdjustmentsHorizontal size={16}/>} onClick={()=>setSettings({extraColumns:!settings.extraColumns})}/><Select<string> className="scope-select" aria-label="进程范围" size="small" value={scope} onChange={setScope} options={[{value:"mine",label:"我的进程"},{value:"all",label:"全部进程"}]}/><span className="toolbar-count">{data.length} 个进程{paused?' · 已暂停':''}</span><Search value={query} onChange={setQuery}/></div>
    <div className="process-split"><div className="table-area"><Table<Process> rowKey="pid" data={data} columns={columns} sort={sort} onSortChange={setSort} rowClassName={p=>p.pid===selectedPid?'selected-row':''} onRow={p=>({onClick:()=>setSelectedPid(p.pid),tabIndex:0,onKeyDown:e=>{if(e.key==='Enter')setSelectedPid(p.pid)},'aria-label':`查看 ${p.name} 进程`})} empty={<Empty/>}/></div>
    <DetailPanel title="进程详情" onClear={selected?()=>setSelectedPid(undefined):undefined}>{selected&&<><div className="detail-identity"><ProcessIcon process={selected}/><div><h3>{selected.name}</h3><p>{selected.app}</p></div></div><DetailRow label="PID"><span className="mono">{selected.pid}</span></DetailRow><DetailRow label="CPU">{selected.cpu}%</DetailRow><DetailRow label="内存">{selected.memory} MB</DetailRow><DetailRow label="磁盘读写">{selected.disk} KB/s</DetailRow><DetailRow label="网络">{selected.network} KB/s</DetailRow><DetailRow label="用户">{selected.user}</DetailRow><DetailRow label="关联端口">{ports.filter(p=>p.pid===selected.pid).map(p=>p.port).join('、')||'无'}</DetailRow><div className="detail-block"><h4>启动命令</h4><code>{selected.command}</code></div><Button block danger onClick={()=>modal.confirm({title:`模拟结束 ${selected.name}？`,content:'此操作只会移除演示进程及其关联端口。',okText:'模拟结束',cancelText:'取消',onOk:()=>{endProcess(selected.pid);setSelectedPid(undefined);message.success('演示进程已结束')}})}>结束进程</Button></>}</DetailPanel></div>
  </div>;
}
