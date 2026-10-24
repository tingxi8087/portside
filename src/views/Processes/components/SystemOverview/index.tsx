import type { SystemOverview as Overview } from '@/services/system';
import { floatingValue } from '@/services/floating';
import { DetailRow } from '@/components/UI';
import './style.less';

function uptime(seconds: number) {
  const minutes=Math.floor(seconds/60);
  const hours=Math.floor(minutes/60);
  return `${hours>=24?`${Math.floor(hours/24)} 天 `:''}${hours%24} 小时 ${minutes%60} 分钟`;
}
function Usage({label,value,detail}:{label:string;value:number|null;detail?:string}) {
  const valid=value!==null&&Number.isFinite(value);
  return <section className="system-usage" aria-label={label}>
    <div className="system-usage__heading"><span>{label}</span><strong className="mono">{valid?`${Math.round(value)}%`:'—'}</strong></div>
    <progress aria-label={`${label}使用率`} max={100} value={valid?Math.max(0,Math.min(100,value)):0}/>
    {detail&&<p className="muted mono">{detail}</p>}
  </section>;
}
export default function SystemOverview({overview,loading,error,paused}:{overview?:Overview|null;loading:boolean;error:string;paused:boolean}) {
  if(!overview)return <p className="system-overview__status muted" role="status">{error?'系统信息暂不可用，请稍后刷新。':loading?'正在读取系统信息…':'系统信息暂不可用。'}</p>;
  const {stats,info}=overview;
  return <div className="system-overview">
    <Usage label="CPU" value={stats.cpu}/>
    <Usage label="内存" value={stats.memory} detail={stats.memoryTotal>0?`已用 ${(stats.memoryUsed/1e9).toFixed(1)} / ${(stats.memoryTotal/1e9).toFixed(1)} GB`:undefined}/>
    <section className="system-overview__group" aria-label="网络速度">
      <h3>网络</h3>
      <DetailRow label="下载"><span className="mono">{floatingValue('download',stats)}</span></DetailRow>
      <DetailRow label="上传"><span className="mono">{floatingValue('upload',stats)}</span></DetailRow>
    </section>
    <section className="system-overview__group" aria-label="系统基础信息">
      <h3>系统</h3>
      <DetailRow label="型号">{info.model||'—'}</DetailRow>
      <DetailRow label="芯片">{info.chip||'—'}</DetailRow>
      <DetailRow label="逻辑核心">{info.cores||'—'}</DetailRow>
      <DetailRow label="系统版本">{info.os||'—'}</DetailRow>
      <DetailRow label="已运行">{uptime(overview.uptime)}</DetailRow>
    </section>
    <p className="system-overview__status muted">{paused?'已暂停刷新':error?'刷新失败，显示上次数据':'整机数据 · 每 2 秒刷新'}<br/>选择左侧进程查看详情</p>
  </div>;
}
