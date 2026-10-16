import { isTauri } from '@tauri-apps/api/core';
import { Checkbox, App } from 'paper-ink';
import { IconArrowUp, IconArrowDown } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import { IconAction } from '@/components/UI';
import { floatingMetrics, type FloatingMetric } from '@/services/floating';
import FloatingBadge from './Badge';
const preview={cpu:24,memory:68,memoryUsed:10.9*1024**3,memoryTotal:16*1024**3,download:2.4*1024**2,upload:128*1024,ports:12};
export default function FloatingSettings(){
  const {settings,setSettings}=useWorkspace();const {message}=App.useApp();const selected=settings.floatingMetrics;
  const toggle=(id:FloatingMetric,checked:boolean)=>{
    if(checked){if(selected.length>=3){void message.info('最多显示 3 个指标');return}setSettings({floatingMetrics:[...selected,id]})}
    else if(selected.length>1)setSettings({floatingMetrics:selected.filter(item=>item!==id)});
  };
  const move=(id:FloatingMetric,delta:number)=>{const next=[...selected];const i=next.indexOf(id);[next[i],next[i+delta]]=[next[i+delta],next[i]];setSettings({floatingMetrics:next})};
  const ordered=[...selected,...floatingMetrics.map(item=>item.id).filter(id=>!selected.includes(id))];
  return <section className="settings-section"><div className="floating-settings-header"><h2>悬浮球</h2><Checkbox disabled={!isTauri()} title={isTauri()?undefined:"仅桌面 App 支持"} checked={settings.floatingEnabled} onChange={event=>setSettings({floatingEnabled:event.target.checked})}>显示悬浮球</Checkbox></div>
    <div className="floating-settings-preview"><FloatingBadge metrics={selected} stats={preview}/><p>示例预览 · 已选 {selected.length}/3<br/>单击打开界面，拖动调整位置</p></div>
    <div className="floating-options">{ordered.map(id=>{const checked=selected.includes(id);const index=selected.indexOf(id);return <div key={id} className="floating-option"><Checkbox checked={checked} disabled={checked?selected.length===1:selected.length>=3} onChange={event=>toggle(id,event.target.checked)}>{floatingMetrics.find(item=>item.id===id)!.label}</Checkbox>{checked&&<div className="floating-option-order"><small>{index+1}</small><IconAction label={`上移${floatingMetrics.find(item=>item.id===id)!.label}`} disabled={index===0} icon={<IconArrowUp size={13}/>} onClick={()=>move(id,-1)}/><IconAction label={`下移${floatingMetrics.find(item=>item.id===id)!.label}`} disabled={index===selected.length-1} icon={<IconArrowDown size={13}/>} onClick={()=>move(id,1)}/></div>}</div>})}</div>
  </section>;
}
