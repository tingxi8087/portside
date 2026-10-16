import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

// Pages stay mounted when switching tabs. Only the visible page owns Cmd+F.
export function usePageSearch(root:RefObject<HTMLElement|null>,selector:string,onOpen?:()=>void){
  const open=useRef(onOpen);open.current=onOpen;
  const frame=useRef<number|undefined>(undefined);
  const focusSearch=useCallback(()=>{
    open.current?.();
    if(frame.current!==undefined)cancelAnimationFrame(frame.current);
    frame.current=requestAnimationFrame(()=>{
      frame.current=undefined;
      const input=root.current?.querySelector<HTMLInputElement>(selector);
      input?.focus();input?.select();
    });
  },[root,selector]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(!event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.isComposing||event.key.toLowerCase()!=='f')return;
      const node=root.current;
      if(!node||node.closest('[hidden], [inert]')||!node.getClientRects().length)return;
      if(Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(dialog=>!dialog.closest('[hidden]')))return;
      event.preventDefault();event.stopPropagation();
      if(!event.repeat)focusSearch();
    };
    window.addEventListener('keydown',handler,true);
    return()=>{window.removeEventListener('keydown',handler,true);if(frame.current!==undefined)cancelAnimationFrame(frame.current)};
  },[root,focusSearch]);
  return focusSearch;
}
