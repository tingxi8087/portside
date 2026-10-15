import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { IconChevronLeft, IconChevronRight } from 'paper-ink/icons';
import { IconAction } from '@/components/UI';
import './style.less';

const DEFAULT_WIDTH=300;
const MIN_WIDTH=240;
const MAX_WIDTH=520;
const RAIL_WIDTH=6;

export default function ResizableWorkspace({children,sidebar,label,className=''}:{children:ReactNode;sidebar:ReactNode;label:string;className?:string}) {
  const root=useRef<HTMLDivElement>(null);
  const sideId=useId();
  const [available,setAvailable]=useState(window.innerWidth);
  const [width,setWidth]=useState(()=>window.innerWidth<=760?260:DEFAULT_WIDTH);
  const [collapsed,setCollapsed]=useState(false);
  const [resizing,setResizing]=useState(false);
  const drag=useRef<{x:number;width:number}|undefined>(undefined);
  const maxWidth=Math.max(0,Math.min(MAX_WIDTH,available-360-RAIL_WIDTH));
  const minWidth=Math.min(MIN_WIDTH,maxWidth);
  const clamp=(value:number)=>Math.max(minWidth,Math.min(maxWidth,value));
  const actualWidth=clamp(width);

  useEffect(()=>{
    const node=root.current!;
    const observer=new ResizeObserver(()=>{if(node.clientWidth>0)setAvailable(node.clientWidth)});
    observer.observe(node);
    return()=>observer.disconnect();
  },[]);

  const begin=(event:PointerEvent<HTMLDivElement>)=>{
    if(collapsed||event.button!==0)return;
    event.preventDefault();
    drag.current={x:event.clientX,width:actualWidth};
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };
  const move=(event:PointerEvent<HTMLDivElement>)=>{
    if(drag.current)setWidth(clamp(drag.current.width+drag.current.x-event.clientX));
  };
  const finish=(event:PointerEvent<HTMLDivElement>)=>{
    drag.current=undefined;setResizing(false);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(!['ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;
    event.preventDefault();
    if(event.key==='Enter'||event.key===' '){setCollapsed(value=>!value);return}
    const step=event.shiftKey?40:16;
    setWidth(event.key==='Home'?minWidth:event.key==='End'?maxWidth:clamp(actualWidth+(event.key==='ArrowLeft'?step:-step)));
  };
  const style:CSSProperties={gridTemplateColumns:`minmax(0, 1fr) ${collapsed?28:RAIL_WIDTH}px ${collapsed?0:actualWidth}px`};
  return <div ref={root} className={`resizable-workspace ${className} ${collapsed?'is-collapsed':''} ${resizing?'is-resizing':''}`} style={style}>
    <div className="resizable-workspace__main">{children}</div>
    <div className="resizable-workspace__rail">
      <div className="resizable-workspace__handle" role="separator" aria-label={`调整${label}宽度`} aria-controls={sideId} aria-orientation="vertical" aria-valuemin={collapsed?0:minWidth} aria-valuemax={maxWidth} aria-valuenow={collapsed?0:actualWidth} aria-disabled={collapsed} tabIndex={collapsed?-1:0} title="拖动调整宽度，双击恢复默认；方向键微调，Enter 收起" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={event=>{if(drag.current)setWidth(drag.current.width);finish(event)}} onLostPointerCapture={()=>{drag.current=undefined;setResizing(false)}} onKeyDown={keyboard} onDoubleClick={()=>{setWidth(DEFAULT_WIDTH);setCollapsed(false)}}/>
      <IconAction className="resizable-workspace__toggle" label={`${collapsed?'展开':'收起'}${label}`} aria-expanded={!collapsed} aria-controls={sideId} disabled={resizing} icon={collapsed?<IconChevronLeft size={13}/>:<IconChevronRight size={13}/>} onClick={()=>setCollapsed(value=>!value)}/>
    </div>
    <div id={sideId} className="resizable-workspace__side" aria-hidden={collapsed||undefined} inert={collapsed}>
      <div className="resizable-workspace__side-content">{sidebar}</div>
    </div>
  </div>;
}
