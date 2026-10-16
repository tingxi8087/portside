import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import FloatingBadge from './Badge';
import { emptyStats, type FloatingConfig, type FloatingStats } from '@/services/floating';
export default function Floating(){
  const [config,setConfig]=useState<FloatingConfig>({enabled:true,metrics:['cpu'],theme:'system'});
  const [stats,setStats]=useState(emptyStats);const [error,setError]=useState('');
  const enabled=useRef(true);
  const drag=useRef<{x:number;y:number;dragged:boolean}|undefined>(undefined);
  useEffect(()=>{
    document.documentElement.classList.add('floating-window');
    if(!isTauri())return;
    let active=true;let busy=false;
    const subscribe=listen<FloatingConfig>('floating-config',event=>{if(active){enabled.current=event.payload.enabled;setConfig(event.payload)}});
    void invoke<FloatingConfig>('floating_state').then(value=>{if(active){enabled.current=value.enabled;setConfig(value)}}).catch(error=>setError(String(error)));
    const sample=async()=>{if(busy||!enabled.current)return;busy=true;try{const value=await invoke<FloatingStats>('floating_sample');if(active){setStats(value);setError('')}}catch(error){if(active){setStats(emptyStats);setError(String(error))}}finally{busy=false}};
    void sample();const timer=setInterval(()=>void sample(),2000);
    return()=>{active=false;clearInterval(timer);void subscribe.then(stop=>stop())};
  },[]);
  useEffect(()=>{
    const media=matchMedia('(prefers-color-scheme: dark)');const theme=()=>{document.documentElement.dataset.theme=config.theme==='dark'||config.theme==='system'&&media.matches?'dark':'light'};
    theme();media.addEventListener('change',theme);return()=>media.removeEventListener('change',theme);
  },[config.theme]);
  const menu=()=>{if(isTauri())void invoke('floating_menu').catch(error=>setError(String(error)))};
  const toggle=()=>{if(isTauri())void invoke('floating_toggle_main').catch(error=>setError(String(error)))};
  return <button className="floating-hit" aria-label="显示或隐藏 Portside" title={error||'点击显示或隐藏 Portside · 拖动移动 · 右键设置'} onPointerDown={event=>{if(event.button===0){drag.current={x:event.screenX,y:event.screenY,dragged:false};event.currentTarget.setPointerCapture(event.pointerId)}}} onPointerMove={event=>{
    const start=drag.current;if(!start||start.dragged||!event.buttons)return;
    if(Math.hypot(event.screenX-start.x,event.screenY-start.y)>5){start.dragged=true;if(isTauri())void getCurrentWindow().startDragging().catch(error=>setError(String(error)))}
  }} onPointerUp={event=>{const start=drag.current;drag.current=undefined;if(start&&!start.dragged&&Math.hypot(event.screenX-start.x,event.screenY-start.y)<=5)toggle()}} onPointerCancel={()=>{drag.current=undefined}} onClick={event=>{if(event.detail===0)toggle()}} onKeyDown={event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();menu()}}} onContextMenu={event=>{event.preventDefault();menu()}}><FloatingBadge metrics={config.metrics} stats={stats}/></button>;
}
