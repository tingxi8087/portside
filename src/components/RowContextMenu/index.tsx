import { useEffect } from 'react';
import { Dropdown, type DropdownMenuItem } from 'paper-ink';

// Paper Ink provides menu rendering/keyboard navigation; the row owns its target.
export default function RowContextMenu({point,items,onAction,onClose}:{point:{x:number;y:number};items:DropdownMenuItem[];onAction:(key:string)=>void;onClose:()=>void}) {
  useEffect(()=>{
    const close=()=>onClose();
    window.addEventListener('resize',close);
    document.addEventListener('scroll',close,true);
    return()=>{window.removeEventListener('resize',close);document.removeEventListener('scroll',close,true)};
  },[onClose]);
  return <div style={{position:'fixed',left:point.x,top:point.y,width:1,height:1,lineHeight:0,pointerEvents:'none'}}><Dropdown open trigger={[]} autoFocus placement="bottomLeft" style={{display:'block',width:1,height:1}} menu={{items,onClick:({key})=>{onClose();onAction(key)}}} onOpenChange={open=>{if(!open)onClose()}}><span aria-hidden="true"/></Dropdown></div>;
}
