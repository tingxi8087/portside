import { invoke, isTauri } from '@tauri-apps/api/core';
export const floatingMetrics=[{id:'cpu',label:'CPU 使用率',short:'CPU'},{id:'memory',label:'内存使用率',short:'内存'},{id:'download',label:'下载速度',short:'下载'},{id:'upload',label:'上传速度',short:'上传'},{id:'ports',label:'监听端口数',short:'端口'}] as const;
export type FloatingMetric=typeof floatingMetrics[number]['id'];
export type FloatingConfig={enabled:boolean;metrics:FloatingMetric[];theme:'light'|'dark'|'system'};
export type FloatingStats={cpu:number|null;memory:number|null;memoryUsed:number;memoryTotal:number;download:number|null;upload:number|null;ports:number|null};
export function normalizeMetrics(value:unknown):FloatingMetric[]{
  const valid=Array.isArray(value)?value.filter((id):id is FloatingMetric=>floatingMetrics.some(metric=>metric.id===id)):[];
  return [...new Set(valid)].slice(0,3).length?[...new Set(valid)].slice(0,3):['cpu'];
}
export const emptyStats:FloatingStats={cpu:null,memory:null,memoryUsed:0,memoryTotal:0,download:null,upload:null,ports:null};
export function floatingValue(id:FloatingMetric,stats:FloatingStats){
  const n=stats[id];if(n===null)return '—';
  if(id==='cpu'||id==='memory')return `${Math.round(n)}%`;
  if(id==='ports')return String(n);
  if(n>=1024**3)return `${(n/1024**3).toFixed(1)}G/s`;
  if(n>=1024**2)return `${(n/1024**2).toFixed(1)}M/s`;
  if(n>=1024)return `${(n/1024).toFixed(n<10240?1:0)}K/s`;
  return `${Math.round(n)}B/s`;
}
export const updateFloating=(config:FloatingConfig)=>isTauri()?invoke('floating_configure',{config}):Promise.resolve();
