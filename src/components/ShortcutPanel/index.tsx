import { invoke, isTauri } from '@tauri-apps/api/core';
import { writeClipboard } from '@/services/clipboard';
import { useState } from 'react';
import { App, Modal, Dropdown, Checkbox } from 'paper-ink';
import { IconPlus, IconBolt, IconPlayerPlay, IconFolder, IconPencil, IconClipboard, IconFilePlus, IconTrash, IconTags, IconDots, IconListCheck } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import type { Shortcut } from '@/data/demo';
import { Button, Input, Field, Search, Empty, IconAction } from '@/components/UI';
import TagSelect from './components/TagSelect';
import BatchTagEditor from './components/BatchTagEditor';
import TagManager from './components/TagManager';
import styles from './index.module.less';

const blank:Shortcut={id:'',name:'',directory:'~/appCode/Portside',command:'',tag:null};
export default function ShortcutPanel({onRun,runDisabledReason,context,defaultDirectory='~/appCode/Portside',embedded=false,directoryPicker=true}:{directoryPicker?:boolean;onRun?:(shortcut:Shortcut)=>void;runDisabledReason?:string;context?:string;defaultDirectory?:string;embedded?:boolean}) {
  const {shortcuts,shortcutTags,saveShortcut,deleteShortcut,deleteShortcuts,setShortcutTag}=useWorkspace();
  const [draft,setDraft]=useState<Shortcut>();
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  // undefined = all, null = untagged, string = a user-defined tag.
  const [filter,setFilter]=useState<string|null>();
  const [managing,setManaging]=useState(false);
  const [isCopy,setIsCopy]=useState(false);
  const [selecting,setSelecting]=useState(false);
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [batchTags,setBatchTags]=useState(false);
  const changeQuery=(value:string)=>{setQuery(value);setSelectedIds([])};
  const changeFilter=(value:string|null|undefined)=>{setFilter(value);setSelectedIds([])};
  const finishSelection=()=>{setSelecting(false);setSelectedIds([]);setBatchTags(false)};
  const toggleSelection=(id:string)=>setSelectedIds(current=>current.includes(id)?current.filter(value=>value!==id):[...current,id]);
  const batchDelete=()=>{
    const ids=[...selectedIds];
    modal.confirm({title:`删除选中的 ${ids.length} 条快捷指令？`,content:'只删除指令配置，不会删除目录或文件。',okText:'删除',cancelText:'取消',onOk:()=>{deleteShortcuts(ids);finishSelection();message.success(`已删除 ${ids.length} 条快捷指令`)}});
  };
  const {message,modal}=App.useApp();
  const openEditor=(item?:Shortcut,copy=false)=>{
    setError('');setIsCopy(copy);
    setDraft(item?{...item,id:copy?'':item.id,name:copy?`${item.name} 副本`:item.name,tag:item.tag}:{...blank,directory:defaultDirectory,tag:typeof filter==='string'?filter:null});
  };
  const run=(shortcut:Shortcut)=>{if(onRun&&!runDisabledReason)onRun(shortcut)};
  const save=(execute=false)=>{
    if(!draft)return;
    if(!draft.name.trim()||!draft.directory.trim()||!draft.command.trim()){setError('请填写名称、工作目录和命令');return}
    const item={...draft,name:draft.name.trim(),directory:draft.directory.trim(),tag:draft.tag?.trim()||null,id:draft.id||crypto.randomUUID()};
    saveShortcut(item);setDraft(undefined);
    if(execute)run(item);else message.success(isCopy?'副本已创建':'快捷指令已保存到本机');
  };
  const copyCommand=async(item:Shortcut)=>{
    try {
      await writeClipboard(item.command);
      message.success('命令已复制');
    } catch {message.error('复制失败，请手动选择命令')}
  };
  const matched=shortcuts.filter(item=>(filter===undefined||filter===null&&!item.tag||typeof filter==='string'&&item.tag===filter)&&`${item.name} ${item.command} ${item.directory} ${item.tag??''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
      <aside className={`shortcuts-panel ${embedded?styles.embedded:''}`} aria-label="快捷指令">
        <header className={styles.header}>
          <div className={styles.summary}>
            {!embedded&&<h3><IconBolt size={16}/>快捷指令</h3>}
            <span className={styles.count} aria-label={`${matched.length} 条指令`} title={`共 ${shortcuts.length} 条指令`}>{matched.length}</span>
            {context&&<span className={styles.context} title={context}>{context}</span>}
          </div>
          <div className="inline-actions">{selecting?<Button type="text" size="small" onClick={finishSelection}>完成</Button>:<><IconAction label="多选快捷指令" icon={<IconListCheck size={16}/>} onClick={()=>setSelecting(true)} disabled={!shortcuts.length}/><IconAction label="新增快捷指令" icon={<IconPlus size={16}/>} onClick={()=>openEditor()}/></>}</div></header>
        <div className={styles.filters}>
          <Search value={query} onChange={changeQuery} placeholder="搜索指令、命令或路径…"/>
          <div className={styles.filterRow}>
            <div className={styles.tagScroller} role="group" aria-label="按标签筛选">
              <Button type="text" size="small" className={styles.filterTag} aria-pressed={filter===undefined} onClick={()=>changeFilter(undefined)}>全部</Button>
              {shortcutTags.map(tag=><Button key={tag} type="text" size="small" className={styles.filterTag} aria-pressed={filter===tag} onClick={()=>changeFilter(tag)}>{tag}</Button>)}
              <Button type="text" size="small" className={styles.filterTag} aria-pressed={filter===null} onClick={()=>changeFilter(null)}>未分类</Button>
            </div>
            <IconAction label="管理标签" icon={<IconTags size={15}/>} onClick={()=>setManaging(true)}/>
          </div>
        </div>
        {selecting&&<div className={styles.batchBar}>
          <Checkbox aria-label="全选当前结果" disabled={!matched.length} checked={!!matched.length&&selectedIds.length===matched.length} indeterminate={!!selectedIds.length&&selectedIds.length<matched.length} onChange={event=>setSelectedIds(event.target.checked?matched.map(item=>item.id):[])}>全选</Checkbox>
          <span className={styles.selectionCount}>已选 {selectedIds.length}</span>
          <IconAction label="批量修改标签" icon={<IconTags size={15}/>} disabled={!selectedIds.length} onClick={()=>setBatchTags(true)}/>
          <IconAction label="批量删除" icon={<IconTrash size={15}/>} danger disabled={!selectedIds.length} onClick={batchDelete}/>
        </div>}
        <div className="shortcut-list">{matched.map(item=><div className={`shortcut-item ${selecting&&selectedIds.includes(item.id)?styles.selectedItem:''}`} key={item.id}>
          <div className="shortcut-title">
            {selecting&&<Checkbox aria-label={`选择 ${item.name}`} checked={selectedIds.includes(item.id)} onChange={()=>toggleSelection(item.id)}/>}
            <Button type="text" size="small" className={`shortcut-name ${styles.name}`} title={item.name} aria-label={`${selecting?'选择指令':'编辑快捷指令'} ${item.name}`} onClick={()=>selecting?toggleSelection(item.id):openEditor(item)}>{item.name}</Button>
            {!selecting&&<div className="inline-actions">
              <IconAction label={runDisabledReason??'运行'} aria-label={`运行 ${item.name}`} disabled={!onRun||!!runDisabledReason} icon={<IconPlayerPlay size={14}/>} onClick={()=>run(item)}/>
              <IconAction label="复制命令" aria-label={`复制命令 ${item.name}`} icon={<IconClipboard size={14}/>} onClick={()=>void copyCommand(item)}/>
              <Dropdown autoFocus trigger={['click']} placement="bottomRight" menu={{items:[
                {key:'edit',label:'编辑',icon:<IconPencil size={14}/>},
                {key:'duplicate',label:'创建副本',icon:<IconFilePlus size={14}/>},
                {key:'divider',type:'divider'},
                {key:'delete',label:'删除',icon:<IconTrash size={14}/>,danger:true},
              ],onClick:({key})=>{
                if(key==='edit')openEditor(item);
                if(key==='duplicate')openEditor(item,true);
                if(key==='delete')modal.confirm({title:`删除「${item.name}」？`,content:'只会删除快捷指令配置，不会删除目录或文件。',okText:'删除',cancelText:'取消',onOk:()=>deleteShortcut(item.id)});
              }}}><IconAction label="更多操作" aria-label={`更多操作 ${item.name}`} aria-haspopup="menu" icon={<IconDots size={15}/>}/></Dropdown>
            </div>}
          </div>
          <div className={styles.command}><code title={item.command}>{item.command}</code></div>
          <div className={styles.metadata}>
            <small title={item.directory}><IconFolder size={12}/><span className={styles.directory}>{item.directory}</span></small>
            {item.tag&&<Button type="text" size="small" className={styles.itemTag} title={item.tag} aria-label={`筛选标签 ${item.tag}`} onClick={()=>changeFilter(item.tag)}>{item.tag}</Button>}
          </div>
        </div>)}
          {!matched.length&&<Empty title={shortcuts.length?'没有匹配的指令':'还没有快捷指令'} description={shortcuts.length?'换个关键词或标签试试。':'添加一条常用命令。'}>{shortcuts.length?<Button size="small" onClick={()=>{changeQuery('');changeFilter(undefined)}}>显示全部</Button>:<Button size="small" icon={<IconPlus size={14}/>} onClick={()=>openEditor()}>添加指令</Button>}</Empty>}
        </div>
      </aside>
    <Modal open={!!draft} title={isCopy?'创建快捷指令副本':draft?.id?'编辑快捷指令':'新增快捷指令'} centered width={460} rootClassName="shortcut-editor-modal" onCancel={()=>setDraft(undefined)} footer={<><Button size="small" onClick={()=>setDraft(undefined)}>取消</Button><Button size="small" onClick={()=>save()}>保存</Button><Button size="small" type="primary" disabled={!onRun||!!runDisabledReason} title={runDisabledReason} onClick={()=>save(true)}>保存并运行</Button></>}>
      {draft&&<div className={`form-stack ${styles.form}`}>
        <Field label="名称"><Input size="small" autoFocus placeholder="例如：启动前端" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
        <Field label="工作目录"><Input size="small" spellCheck={false} autoCorrect="off" autoCapitalize="off" suffix={isTauri()&&directoryPicker?<IconAction label="选择工作目录" icon={<IconFolder size={14}/>} onClick={()=>void invoke<string|null>('pick_directory').then(directory=>{if(directory)setDraft({...draft,directory})}).catch(error=>message.error(String(error)))}/>:undefined} prefix={<IconFolder size={15}/>} placeholder="~/appCode/your-project" value={draft.directory} onChange={e=>setDraft({...draft,directory:e.target.value})}/></Field>
        <Field label="执行命令"><Input.TextArea spellCheck={false} autoCorrect="off" autoCapitalize="off" rows={2} className="mono" placeholder="npm run dev" value={draft.command} onChange={e=>setDraft({...draft,command:e.target.value})}/></Field>
        <Field label="标签" hint="最多一个标签；可选择或搜索创建，留空归入未分类。"><TagSelect label="快捷指令标签" value={draft.tag} options={shortcutTags} onChange={tag=>setDraft({...draft,tag})}/></Field>
        {error&&<p className="form-error" role="alert">{error}</p>}
      </div>}
    </Modal>
    {batchTags&&<BatchTagEditor count={selectedIds.length} options={shortcutTags} onCancel={()=>setBatchTags(false)} onApply={tag=>{setShortcutTag(selectedIds,tag);message.success(`已修改 ${selectedIds.length} 条指令的标签`);finishSelection()}}/>}
    {managing&&<TagManager onClose={()=>setManaging(false)} onRename={(name,next)=>{if(filter===name)setFilter(next)}} onDelete={name=>{if(filter===name)setFilter(undefined)}}/>}
  </>;
}
