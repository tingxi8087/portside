import { invoke, isTauri } from '@tauri-apps/api/core';
import { writeClipboard } from '@/services/clipboard';
import { useRef, useState } from 'react';
import { App, Modal, Dropdown, Checkbox } from 'paper-ink';
import { IconPlus, IconBolt, IconPlayerPlay, IconTerminal2, IconFolder, IconPencil, IconClipboard, IconFilePlus, IconTrash, IconTags, IconDots, IconListCheck, IconDownload, IconUpload } from 'paper-ink/icons';
import { useWorkspace } from '@/store/workspace';
import type { Shortcut } from '@/data/demo';
import { Button, Input, Field, Search, Empty, IconAction } from '@/components/UI';
import TagSelect from './components/TagSelect';
import BatchTagEditor from './components/BatchTagEditor';
import TagManager from './components/TagManager';
import styles from './index.module.less';
import ImportPreview from './components/ImportPreview';
import { parseShortcutFile, serializeShortcuts, planShortcutImport, type ShortcutEntry } from '@/utils/shortcutTransfer';
import { readShortcutFile, writeShortcutFile } from '@/services/shortcutTransfer';

const blank:Shortcut={id:'',name:'',directory:'',command:'',tag:null};
export default function ShortcutPanel({onRun,onRunNew,runDisabledReason,newRunDisabledReason,context,defaultDirectory='',embedded=false,directoryPicker=true}:{directoryPicker?:boolean;onRun?:(shortcut:Shortcut)=>void;onRunNew?:(shortcut:Shortcut)=>void;runDisabledReason?:string;newRunDisabledReason?:string;context?:string;defaultDirectory?:string;embedded?:boolean}) {
  const {shortcuts,shortcutTags,addShortcuts,saveShortcut,deleteShortcut,deleteShortcuts,setShortcutTag}=useWorkspace();
  const [draft,setDraft]=useState<Shortcut>();
  const [transferBusy,setTransferBusy]=useState(false);
  const [importFile,setImportFile]=useState<{name:string;entries:ShortcutEntry[]}>();
  const listRef=useRef<HTMLDivElement>(null);
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
  const save=()=>{
    if(!draft)return;
    if(!draft.name.trim()||!draft.command.trim()){setError('请填写名称和命令');return}
    const item={...draft,name:draft.name.trim(),directory:draft.directory.trim(),tag:draft.tag?.trim()||null,id:draft.id||crypto.randomUUID()};
    saveShortcut(item);setDraft(undefined);
    message.success(isCopy?'副本已创建':'快捷指令已保存到本机');
  };
  const copyCommand=async(item:Shortcut)=>{
    try {
      await writeClipboard(item.command);
      message.success('命令已复制');
    } catch {message.error('复制失败，请手动选择命令')}
  };
  const importFromFile=async()=>{
    if(transferBusy)return;
    setTransferBusy(true);
    try{const file=await readShortcutFile();if(file)setImportFile({name:file.name,entries:parseShortcutFile(file.content)})}
    catch(error){message.error(error instanceof Error?error.message:String(error))}
    finally{setTransferBusy(false)}
  };
  const exportItems=async(items:Shortcut[])=>{
    if(transferBusy||!items.length)return;
    setTransferBusy(true);
    try{if(await writeShortcutFile(serializeShortcuts(items)))message.success(`已导出 ${items.length} 条快捷指令`)}
    catch(error){message.error(`导出失败：${error instanceof Error?error.message:String(error)}`)}
    finally{setTransferBusy(false)}
  };
  const importItems=(entries:ShortcutEntry[])=>{
    const plan=planShortcutImport(useWorkspace.getState().shortcuts,entries);
    const items=plan.filter(row=>!row.duplicate).map(({item})=>({...item,id:crypto.randomUUID()}));
    if(!items.length){message.info('所选指令均已存在');setImportFile(undefined);return}
    addShortcuts(items);setImportFile(undefined);finishSelection();setQuery('');setFilter(undefined);
    message.success(`已导入 ${items.length} 条快捷指令`);
    requestAnimationFrame(()=>{listRef.current?.scrollTo({top:0});listRef.current?.querySelector<HTMLButtonElement>('.shortcut-name')?.focus()});
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
          <div className="inline-actions">{selecting?<Button type="text" size="small" onClick={finishSelection}>完成</Button>:<><IconAction label="多选快捷指令" icon={<IconListCheck size={16}/>} onClick={()=>setSelecting(true)} disabled={!shortcuts.length}/><IconAction label="新增快捷指令" icon={<IconPlus size={16}/>} onClick={()=>openEditor()}/><Dropdown trigger={['click']} placement="bottomRight" menu={{items:[
            {key:'import',label:'导入快捷指令',icon:<IconUpload size={14}/>},
            {key:'divider',type:'divider'},
            {key:'all',label:'导出全部',icon:<IconDownload size={14}/>,disabled:!shortcuts.length},
            {key:'filtered',label:'导出当前筛选结果',disabled:!matched.length},
          ],onClick:({key})=>{if(key==='import')void importFromFile();if(key==='all')void exportItems(shortcuts);if(key==='filtered')void exportItems(matched)}}}><IconAction label="快捷指令更多操作" aria-haspopup="menu" icon={<IconDots size={16}/>} loading={transferBusy} disabled={transferBusy}/></Dropdown></>}</div></header>
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
          <IconAction label="导出所选" icon={<IconDownload size={15}/>} loading={transferBusy} disabled={transferBusy||!selectedIds.length} onClick={()=>void exportItems(matched.filter(item=>selectedIds.includes(item.id)))}/>
          <IconAction label="批量修改标签" icon={<IconTags size={15}/>} disabled={!selectedIds.length} onClick={()=>setBatchTags(true)}/>
          <IconAction label="批量删除" icon={<IconTrash size={15}/>} danger disabled={!selectedIds.length} onClick={batchDelete}/>
        </div>}
        <div className="shortcut-list" ref={listRef}>{matched.map(item=><div className={`shortcut-item ${selecting&&selectedIds.includes(item.id)?styles.selectedItem:''}`} key={item.id}>
          <div className="shortcut-title">
            {selecting&&<Checkbox aria-label={`选择 ${item.name}`} checked={selectedIds.includes(item.id)} onChange={()=>toggleSelection(item.id)}/>}
            <Button type="text" size="small" className={`shortcut-name ${styles.name}`} title={item.name} aria-label={`${selecting?'选择指令':'编辑快捷指令'} ${item.name}`} onClick={()=>selecting?toggleSelection(item.id):openEditor(item)}>{item.name}</Button>
            {!selecting&&<div className="inline-actions">
              <IconAction label={runDisabledReason??'在当前会话运行'} aria-label={`在当前会话运行 ${item.name}`} disabled={!onRun||!!runDisabledReason} icon={<IconPlayerPlay size={14}/>} onClick={()=>run(item)}/>
              <IconAction label={newRunDisabledReason??'在新会话运行'} aria-label={`在新会话运行 ${item.name}`} disabled={!onRunNew||!!newRunDisabledReason} icon={<IconTerminal2 size={14}/>} onClick={()=>onRunNew?.(item)}/>
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
            <small title={item.directory||'沿用当前终端的工作目录'}><IconFolder size={12}/><span className={styles.directory}>{item.directory||'当前目录'}</span></small>
            {item.tag&&<Button type="text" size="small" className={styles.itemTag} title={item.tag} aria-label={`筛选标签 ${item.tag}`} onClick={()=>changeFilter(item.tag)}>{item.tag}</Button>}
          </div>
        </div>)}
          {!matched.length&&<Empty title={shortcuts.length?'没有匹配的指令':'还没有快捷指令'} description={shortcuts.length?'换个关键词或标签试试。':'添加一条常用命令。'}>{shortcuts.length?<Button size="small" onClick={()=>{changeQuery('');changeFilter(undefined)}}>显示全部</Button>:<Button size="small" icon={<IconPlus size={14}/>} onClick={()=>openEditor()}>添加指令</Button>}</Empty>}
        </div>
      </aside>
    <Modal open={!!draft} title={isCopy?'创建快捷指令副本':draft?.id?'编辑快捷指令':'新增快捷指令'} centered width={460} rootClassName="shortcut-editor-modal" onCancel={()=>setDraft(undefined)} footer={<><Button size="small" onClick={()=>setDraft(undefined)}>取消</Button><Button size="small" type="primary" onClick={()=>save()}>保存</Button></>}>
      {draft&&<div className={`form-stack ${styles.form}`}>
        <Field label="名称"><Input size="small" autoFocus placeholder="例如：启动前端" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></Field>
        <Field label="工作目录（可选）" hint="留空沿用当前会话目录；在新会话运行时，留空从默认目录启动。"><Input size="small" spellCheck={false} autoCorrect="off" autoCapitalize="off" suffix={isTauri()&&directoryPicker?<IconAction label="选择工作目录" icon={<IconFolder size={14}/>} onClick={()=>void invoke<string|null>('pick_directory').then(directory=>{if(directory)setDraft({...draft,directory})}).catch(error=>message.error(String(error)))}/>:undefined} prefix={<IconFolder size={15}/>} placeholder="留空使用当前终端目录" value={draft.directory} onChange={e=>setDraft({...draft,directory:e.target.value})}/></Field>
        <Field label="执行命令"><Input.TextArea spellCheck={false} autoCorrect="off" autoCapitalize="off" rows={2} className="mono" placeholder="npm run dev" value={draft.command} onChange={e=>setDraft({...draft,command:e.target.value})}/></Field>
        <Field label="标签" hint="最多一个标签；可选择或搜索创建，留空归入未分类。"><TagSelect label="快捷指令标签" value={draft.tag} options={shortcutTags} onChange={tag=>setDraft({...draft,tag})}/></Field>
        {error&&<p className="form-error" role="alert">{error}</p>}
      </div>}
    </Modal>
    {importFile&&<ImportPreview file={importFile} existing={shortcuts} onCancel={()=>setImportFile(undefined)} onImport={importItems}/>}
    {batchTags&&<BatchTagEditor count={selectedIds.length} options={shortcutTags} onCancel={()=>setBatchTags(false)} onApply={tag=>{setShortcutTag(selectedIds,tag);message.success(`已修改 ${selectedIds.length} 条指令的标签`);finishSelection()}}/>}
    {managing&&<TagManager onClose={()=>setManaging(false)} onRename={(name,next)=>{if(filter===name)setFilter(next)}} onDelete={name=>{if(filter===name)setFilter(undefined)}}/>}
  </>;
}
