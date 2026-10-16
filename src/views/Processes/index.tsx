import RowContextMenu from '@/components/RowContextMenu';
import ResizableWorkspace from '@/components/ResizableWorkspace';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, Select, Tooltip } from 'paper-ink';
import type { TableColumn, TableSort } from 'paper-ink';
import orderBy from 'lodash/orderBy';
import { IconAdjustmentsHorizontal, IconPlayerPause, IconPlayerPlay, IconRefresh, IconX } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import { useSystemMonitor } from '@/hooks/useSystemMonitor';
import { useProcessActions } from '@/hooks/useProcessActions';
import { metric, formatProcessMemory, iconProcess, type SystemProcess } from '@/services/system';
import { Button, Search, ProcessIcon, Empty, DetailPanel, DetailRow } from '@/components/UI';

export default function Processes() {
  const {settings,setSettings}=useWorkspace(); const [params]=useSearchParams();
  const [query,setQuery]=useState('');const [scope,setScope]=useState('mine');const [paused,setPaused]=useState(false);
  const {snapshot,error,loading,refresh}=useSystemMonitor('processes',paused);
  const processes=snapshot?.processes??[];const ports=snapshot?.ports??[];
  const [sort,setSort]=useState<TableSort|null>({key:'cpu',order:'descend'});
  const [selectedIdentity,setSelectedIdentity]=useState<string>();
  const targetPid=Number(params.get('pid'))||undefined;
  const handledTarget=useRef<number | undefined>(undefined);
  useEffect(()=>{if(targetPid&&handledTarget.current!==targetPid){const p=processes.find(p=>p.pid===targetPid);if(p){setSelectedIdentity(p.identity);handledTarget.current=targetPid}}},[targetPid,processes]);
  const [context,setContext]=useState<{x:number;y:number;identity?:string}>();
  const closeContext=useCallback(()=>setContext(undefined),[]);
  const contextProcess=processes.find(p=>p.identity===context?.identity);
  const selected=processes.find(p=>p.identity===selectedIdentity);const {ending,requestEnd}=useProcessActions();
  const sortKey=sort?.key??'name';
  // Missing samples stay last for both sort directions.
  const filtered=processes.filter(p=>(scope==='all'||p.mine)&&`${p.name} ${p.pid} ${p.app} ${p.user}`.toLowerCase().includes(query.toLowerCase()));
  const data=orderBy(filtered,[p=>p[sortKey as keyof SystemProcess]==null,p=>p[sortKey as keyof SystemProcess]],['asc',sort?.order==='descend'?'desc':'asc']);
  const columns:TableColumn<SystemProcess>[]=[
    {dataIndex:'name',title:'进程名称',sorter:true,width:'35%',render:(_,p)=><div className="process-cell"><ProcessIcon process={iconProcess(p)}/><span><strong>{p.name}</strong><small title={p.executable}>{p.executable||p.user}</small></span></div>},
    {dataIndex:'cpu',title:<span title="进程占整机 CPU 的比例，与悬浮球使用相同口径；所有逻辑核心满载为 100%。">CPU</span>,sorter:true,render:cpu=><div className="metric"><span className="mono">{metric(cpu,'%')}</span>{cpu!==null&&<span className="metric-track"><i style={{width:`${Math.min(cpu,100)}%`}}/></span>}</div>},
    {dataIndex:'memory',title:<span title="Memory Footprint，与活动监视器的内存使用相同口径。">内存</span>,sorter:true,render:memory=><span className="mono">{formatProcessMemory(memory)}</span>},
    {dataIndex:'pid',title:'PID',sorter:true,render:pid=><span className="mono muted">{pid}</span>},
    {dataIndex:'disk',title:'磁盘读写',sorter:true,hidden:!settings.extraColumns,render:n=><span className="mono">{metric(n,'KiB/s')}</span>},
    {dataIndex:'network',title:'网络',sorter:true,hidden:!settings.extraColumns,render:n=><span className="mono">{metric(n,'KiB/s')}</span>},
  ];
  return <div className={`page processes-page ${settings.extraColumns?'has-extra-columns':''}`}>
    <div className="toolbar"><Button aria-label={paused?'继续刷新':'暂停刷新'} title={paused?'继续刷新':'暂停刷新'} icon={paused?<IconPlayerPlay size={15}/>:<IconPlayerPause size={15}/>} onClick={()=>setPaused(!paused)}/><Button aria-label="立即刷新" title="立即刷新" loading={loading} disabled={paused} icon={<IconRefresh size={15}/>} onClick={()=>void refresh()}/><Button aria-label={settings.extraColumns?'精简列':'显示更多列'} title={settings.extraColumns?'精简列':'显示更多列'} icon={<IconAdjustmentsHorizontal size={16}/>} onClick={()=>setSettings({extraColumns:!settings.extraColumns})}/><Select<string> className="scope-select" aria-label="进程范围" size="small" value={scope} onChange={setScope} options={[{value:'mine',label:'我的进程'},{value:'all',label:'全部进程'}]}/><span className="toolbar-count" title={snapshot?.warnings.join('\n')}>{data.length} 个进程{paused?' · 已暂停':''}</span><Search value={query} onChange={setQuery}/></div>
    {error&&<div role="alert" className="form-error" style={{padding:'8px 16px'}}>{error}</div>}
    <ResizableWorkspace className="process-split" label="进程详情" sidebar={<DetailPanel title="进程详情" onClear={selected?()=>setSelectedIdentity(undefined):undefined}>{selected&&<><div className="detail-identity"><ProcessIcon process={iconProcess(selected)}/><div><Tooltip title={selected.name} trigger={['hover','focus']}><h3 tabIndex={0}>{selected.name}</h3></Tooltip><Tooltip title={selected.user} trigger={['hover','focus']}><p tabIndex={0}>{selected.user}</p></Tooltip></div></div><DetailRow label="PID / 父进程"><span className="mono">{selected.pid} / {selected.parent}</span></DetailRow><DetailRow label="CPU">{metric(selected.cpu,'%')}</DetailRow><DetailRow label="内存">{formatProcessMemory(selected.memory)}</DetailRow><DetailRow label="磁盘读写">{metric(selected.disk,'KiB/s')}</DetailRow><DetailRow label="网络下载">{metric(selected.networkIn,'KiB/s')}</DetailRow><DetailRow label="网络上传">{metric(selected.networkOut,'KiB/s')}</DetailRow><DetailRow label="用户">{selected.user}</DetailRow><DetailRow label="启动时间">{selected.started}</DetailRow><DetailRow label="关联端口">{ports.filter(p=>p.pid===selected.pid).map(p=>p.port).join('、')||'无可见监听端口'}</DetailRow><div className="detail-block"><h4>程序路径</h4><code>{selected.executable||'权限受限，不可用'}</code><h4>启动命令</h4><code>{selected.command||'权限受限，不可用'}</code></div>{selected.metricsNote&&<p className="muted" style={{fontSize:11}}>{selected.metricsNote}</p>}<p className="muted" style={{fontSize:11}}>CPU：占整机的比例；内存：Memory Footprint（含压缩等系统记账）；磁盘 / 网络：采样间隔内速率。</p><Button block danger disabled={ending!==undefined} loading={ending===selected.pid} onClick={()=>requestEnd(selected)}>结束进程</Button></>}</DetailPanel>}>
      <div className="table-area"><Table<SystemProcess> rowKey="pid" data={data} columns={columns} sort={sort} onSortChange={setSort} rowClassName={p=>p.identity===selectedIdentity?'selected-row':''} onRow={p=>({onContextMenu:event=>{event.preventDefault();setContext({x:event.clientX,y:event.clientY,identity:p.identity})},onClick:()=>setSelectedIdentity(p.identity),tabIndex:0,onKeyDown:e=>{if(e.key==='Enter')setSelectedIdentity(p.identity)},'aria-label':`查看 ${p.name} 进程`})} empty={<Empty title={loading?'正在读取进程…':'没有找到进程'} description="当前仅展示真实系统数据，可调整筛选条件。"/>}/></div>
    </ResizableWorkspace>
    {context&&<RowContextMenu key={`${context.x}:${context.y}:${context.identity}`} point={context} onClose={closeContext} items={[{key:'end',label:'结束进程',icon:<IconX size={15}/>,danger:true,disabled:!contextProcess||ending!==undefined}]} onAction={()=>{if(contextProcess)requestEnd(contextProcess)}}/>}
  </div>;
}
