import { Button, Input, Tooltip, Empty as InkEmpty } from 'paper-ink';
import type { ButtonProps } from 'paper-ink';
import { IconSearch, IconX, IconTerminal2, IconDatabase, IconBrandPython, IconBrandDocker, IconBox } from 'paper-ink/icons';
import type { ReactNode } from 'react';
import type { Process } from '@/data/demo';

export function Search({value,onChange,placeholder='搜索名称或 PID…'}:{value:string;onChange:(value:string)=>void;placeholder?:string}) {
  return <Input className="search" size="small" prefix={<IconSearch size={15}/>} aria-label={placeholder} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)} suffix={value?<Button type="text" size="small" aria-label="清空搜索" icon={<IconX size={13}/>} onClick={()=>onChange('')}/>:undefined}/>;
}
export function ProcessIcon({process}:{process:Process}) {
  const Icon=process.name.includes('postgres')||process.name.includes('redis')?IconDatabase:process.name==='python3'?IconBrandPython:process.name==='Docker'?IconBrandDocker:process.name==='node'?IconTerminal2:IconBox;
  return <span className={`process-icon ${process.color}`}><Icon size={17} stroke={1.7}/></span>;
}
export function Empty({title='没有找到匹配项',description='换个关键词，或者清空搜索后再试。',children,icon}:{title?:string;description?:string;children?:ReactNode;icon?:ReactNode}) {
  return <div className="empty"><span className="empty-icon">{icon??<IconSearch size={26} stroke={1.3}/>}</span><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function DetailPanel({title,onClear,children}:{title:string;onClear?:()=>void;children?:ReactNode}) {
  return <aside className="detail-panel" aria-label={title}>
    <header><h2>{title}</h2>{onClear&&<IconAction label="取消选择" icon={<IconX size={16}/>} onClick={onClear}/>}</header>
    {children?<div className="detail-content">{children}</div>:<div className="detail-empty"><InkEmpty image={InkEmpty.PRESENTED_IMAGE_SIMPLE} description={<><strong>未选择进程</strong><p>从左侧列表选择一个进程查看详情</p></>}/></div>}
  </aside>;
}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}) {return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
export function DetailRow({label,children}:{label:string;children:ReactNode}) {return <div className="detail-row"><span>{label}</span><div>{children}</div></div>}
export function IconAction({label,icon,className='',...props}:Omit<ButtonProps,'children'|'icon'|'title'> & {label:string;icon:ReactNode}) {
  return <Tooltip title={label} trigger={['hover','focus']}><Button type="text" size="small" {...props} className={`icon-button inline-action ${className}`} aria-label={props['aria-label']??label} icon={icon}/></Tooltip>;
}
export { Button, Input };
