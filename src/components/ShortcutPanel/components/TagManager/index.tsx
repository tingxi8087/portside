import { useState } from 'react';
import { App, Modal } from 'paper-ink';
import { IconPencil, IconTrash, IconCheck, IconX } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import { Input, Empty, IconAction } from '@/components/UI';

export default function TagManager({onClose,onRename,onDelete}:{onClose:()=>void;onRename:(name:string,next:string)=>void;onDelete:(name:string)=>void}) {
  const {shortcutTags,shortcuts,renameShortcutTag,deleteShortcutTag}=useWorkspace();
  const [editing,setEditing]=useState<string>();
  const [name,setName]=useState('');
  const [error,setError]=useState('');
  const {modal}=App.useApp();
  const rename=()=>{
    const next=name.trim();
    if(!next){setError('请输入标签名称');return}
    if(shortcutTags.some(tag=>tag!==editing&&tag.toLowerCase()===next.toLowerCase())){setError('标签名称已存在');return}
    if(editing){renameShortcutTag(editing,next);onRename(editing,next)}
    setEditing(undefined);setError('');
  };
  return <Modal open title="管理标签" centered width={380} rootClassName="shortcut-tags-modal" onCancel={onClose} footer={null}>
    <p className="tag-manager-hint">删除标签仅解除关联，快捷指令会保留。</p>
    <div className="tag-manager-list">{shortcutTags.map(tag=><div className="tag-manager-row" key={tag}>
      {editing===tag?<><Input size="small" autoFocus aria-label="标签名称" value={name} onChange={e=>{setName(e.target.value);setError('')}} onKeyDown={e=>{if(e.key==='Enter')rename();if(e.key==='Escape'){e.stopPropagation();setEditing(undefined);setError('')}}}/><IconAction label="保存标签名称" icon={<IconCheck size={14}/>} onClick={rename}/><IconAction label="取消重命名" icon={<IconX size={14}/>} onClick={()=>{setEditing(undefined);setError('')}}/></>:<><span className="tag-manager-name">{tag}</span><span className="tag-manager-count">{shortcuts.filter(item=>item.tag===tag).length} 条</span><IconAction label="重命名标签" aria-label={`重命名标签 ${tag}`} icon={<IconPencil size={14}/>} onClick={()=>{setEditing(tag);setName(tag);setError('')}}/><IconAction label="删除标签" aria-label={`删除标签 ${tag}`} icon={<IconTrash size={14}/>} danger onClick={()=>modal.confirm({title:`删除标签「${tag}」？`,content:'快捷指令会保留，只移除该标签。',okText:'删除标签',cancelText:'取消',onOk:()=>{deleteShortcutTag(tag);onDelete(tag)}})}/></>}
    </div>)}</div>
    {!shortcutTags.length&&<Empty title="还没有标签" description="编辑快捷指令时，输入标签并回车即可创建。"/>}
    {error&&<p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
