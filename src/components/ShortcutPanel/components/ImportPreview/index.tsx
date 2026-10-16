import { useState } from 'react';
import { Modal, Checkbox } from 'paper-ink';
import { Button } from '@/components/UI';
import { planShortcutImport, type ShortcutEntry } from '@/utils/shortcutTransfer';
import type { Shortcut } from '@/data/demo';
import styles from './index.module.less';

export default function ImportPreview({file, existing, onCancel, onImport}: {
  file: {name: string; entries: ShortcutEntry[]}; existing: Shortcut[];
  onCancel: () => void; onImport: (items: ShortcutEntry[]) => void;
}) {
  const base = planShortcutImport(existing, file.entries);
  const [selected, setSelected] = useState(() => base.flatMap((row, i) => row.duplicate ? [] : [i]));
  const eligible = base.flatMap((row, i) => row.duplicate ? [] : [i]);
  const ids = selected.filter(i => eligible.includes(i));
  const incoming = ids.map(i => file.entries[i]);
  const planned = planShortcutImport(existing, incoming);
  const rows = new Map(ids.map((id, i) => [id, planned[i]]));
  const count = planned.filter(row => !row.duplicate).length;
  return <Modal open centered width={560} title="导入快捷指令" onCancel={onCancel} rootClassName="shortcut-import-modal" footer={<><Button size="small" onClick={onCancel}>取消</Button><Button size="small" type="primary" disabled={!count} onClick={() => onImport(incoming)}>导入 {count} 条</Button></>}>
    <p className={styles.filename} title={file.name}>{file.name}</p>
    <div className={styles.toolbar}>
      <Checkbox aria-label="全选可导入指令" disabled={!eligible.length} checked={!!eligible.length && ids.length===eligible.length} indeterminate={!!ids.length&&ids.length<eligible.length} onChange={e=>setSelected(e.target.checked?eligible:[])}>全选</Checkbox>
      <span>{file.entries.length} 条 · 已选 {count}{base.some(row=>row.duplicate)&&` · 跳过 ${base.filter(row=>row.duplicate).length} 条重复`}</span>
    </div>
    <div className={styles.list}>
      {file.entries.map((entry, i) => {
        const row=rows.get(i)??base[i];
        return <div className={`${styles.row} ${base[i].duplicate?styles.duplicate:''}`} key={i}>
          <Checkbox aria-label={`导入 ${entry.name}`} checked={ids.includes(i)} disabled={base[i].duplicate} onChange={e=>setSelected(current=>e.target.checked?[...current,i]:current.filter(id=>id!==i))}/>
          <div className={styles.details}>
            <div className={styles.title}><strong>{row.item.name}</strong><span>{base[i].duplicate?'已存在，跳过':row.renamed?'同名，创建副本':''}</span></div>
            <code>{entry.command}</code>
            <div className={styles.metadata}><span title={entry.directory}>{entry.directory||'当前目录'}</span><span>{entry.tag??'未分类'}</span></div>
          </div>
        </div>;
      })}
    </div>
    <p className={styles.hint}>仅保存指令，不执行命令。标签自动合并，目录原样保留。</p>
  </Modal>;
}
