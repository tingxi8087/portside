import { useState } from 'react';
import { Modal, Segmented } from 'paper-ink';
import { Field } from '@/components/UI';
import TagSelect from '../TagSelect';

export default function BatchTagEditor({count,options,onCancel,onApply}:{count:number;options:string[];onCancel:()=>void;onApply:(tag:string|null)=>void}) {
  const [mode,setMode]=useState<'set'|'clear'>('set');
  const [tag,setTag]=useState<string|null>(null);
  return <Modal open title={`修改 ${count} 条指令的标签`} centered width={420} rootClassName="shortcut-editor-modal" cancelText="取消" okText={mode==='clear'?'清除标签':'应用修改'} okButtonProps={{size:'small',disabled:mode==='set'&&!tag}} cancelButtonProps={{size:'small'}} onCancel={onCancel} onOk={()=>onApply(mode==='clear'?null:tag)}>
    <div className="batch-tag-form">
      <Segmented<'set'|'clear'> block size="small" aria-label="标签修改方式" value={mode} onChange={setMode} options={[{label:'设置标签',value:'set'},{label:'清除标签',value:'clear'}]}/>
      {mode==='set'&&<Field label="标签"><TagSelect label="批量标签" value={tag} options={options} onChange={setTag}/></Field>}
      <p className="batch-tag-hint" role="status">{mode==='set'?'统一设置选中指令的标签，替换原有标签。':'选中指令将移至未分类，标签本身会保留。'}</p>
    </div>
  </Modal>;
}
