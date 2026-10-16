import type { CSSProperties } from 'react';
import { floatingMetrics, floatingValue, type FloatingMetric, type FloatingStats } from '@/services/floating';
import './style.less';
export default function FloatingBadge({metrics,stats}:{metrics:FloatingMetric[];stats:FloatingStats}){
  return <span className={`floating-badge ${metrics.length===1?'is-circle':'is-capsule'}`}>{metrics.map(id=>{
    const metric=floatingMetrics.find(item=>item.id===id)!;
    const percentage=id==='cpu'||id==='memory'?stats[id]:null;
    const detail=id==='memory'&&stats.memoryTotal?`，已用 ${(stats.memoryUsed/1024**3).toFixed(1)} / ${(stats.memoryTotal/1024**3).toFixed(1)} GB`:'';
    return <span key={id} className="floating-metric" title={`${metric.label}：${floatingValue(id,stats)}${detail}`}>
      {metrics.length===1&&percentage!==null&&<svg className="floating-ring" viewBox="0 0 52 52" aria-hidden><circle cx="26" cy="26" r="23"/><circle cx="26" cy="26" r="23" style={{'--progress':Math.max(0,Math.min(100,percentage))} as CSSProperties}/></svg>}
      <strong>{floatingValue(id,stats)}</strong><small>{metric.short}</small>
    </span>;
  })}</span>;
}
