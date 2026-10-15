import { useState } from 'react';
import { Select } from 'paper-ink';

export default function TagSelect({value,options,onChange,label}:{value:string|null;options:string[];onChange:(tag:string|null)=>void;label:string}) {
  const [search,setSearch]=useState('');
  const candidate=search.trim();
  const available=Array.from(new Set([...options,...(value?[value]:[])]));
  const exact=available.find(tag=>tag.toLowerCase()===candidate.toLowerCase());
  const choices=available.map(tag=>({value:tag,label:tag}));
  if(candidate&&!exact)choices.push({value:candidate,label:`创建标签「${candidate}」`});
  return <Select<string|undefined> aria-label={label} size="small" showSearch allowClear value={value??undefined} placeholder="选择标签，或输入新标签" searchValue={search} onSearch={setSearch} options={choices} onChange={tag=>{onChange(tag?.trim()||null);setSearch('')}} onOpenChange={open=>{if(!open)setSearch('')}}/>;
}
