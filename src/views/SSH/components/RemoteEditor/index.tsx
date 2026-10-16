import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { nginx } from '@codemirror/legacy-modes/mode/nginx';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { IconDeviceFloppy, IconRefresh, IconDownload } from 'paper-ink/icons';
import { IconAction } from '@/components/UI';
import type { RemoteDocument } from './useRemoteEditors';
import './style.less';

function language(path:string) {
  if (/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) return javascript({typescript:/\.tsx?$/.test(path),jsx:/\.[jt]sx$/.test(path)});
  if (/\.(json|jsonc)$/.test(path))return json();
  if (/\.py$/.test(path))return python();
  if (/\.css$/.test(path))return css();
  if (/\.(html?|xml|svg)$/.test(path))return html();
  if (/\.(sh|bash|zsh)$|\.(bashrc|zshrc|profile)$/.test(path))return StreamLanguage.define(shell);
  if (/\.ya?ml$/.test(path))return StreamLanguage.define(yaml);
  if (/\.toml$/.test(path))return StreamLanguage.define(toml);
  if (/nginx|\.conf$/.test(path))return StreamLanguage.define(nginx);
  return [];
}
export default function RemoteEditor({doc,active,onChange,onSave,onReload,onDownload}:{doc:RemoteDocument;active:boolean;onChange:(value:string)=>void;onSave:()=>void;onReload:()=>void;onDownload:()=>void}) {
  const host=useRef<HTMLDivElement>(null);const view=useRef<EditorView|undefined>(undefined);
  const callbacks=useRef({onChange,onSave});callbacks.current={onChange,onSave};
  const writable=useRef(new Compartment());
  useEffect(()=>{
    if(doc.content===null||!host.current)return;
    const bom=doc.content.startsWith('\uFEFF')?'\uFEFF':'';
    const text=doc.content.slice(bom.length);
    const separator=text.includes('\r\n')?'\r\n':text.includes('\r')?'\r':'\n';
    const editor=new EditorView({parent:host.current,state:EditorState.create({doc:text,extensions:[
      EditorState.phrases.of({'Find':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全部','match case':'区分大小写','regexp':'正则表达式','by word':'整词','replace':'替换','replace all':'全部替换','close':'关闭搜索','No matches found':'没有匹配内容'}),EditorState.lineSeparator.of(separator),lineNumbers(),history(),drawSelection(),highlightActiveLine(),highlightActiveLineGutter(),indentOnInput(),bracketMatching(),highlightSelectionMatches(),syntaxHighlighting(defaultHighlightStyle),language(doc.path),
      keymap.of([{key:'Mod-s',run:()=>{callbacks.current.onSave();return true}},...searchKeymap,...defaultKeymap,...historyKeymap,indentWithTab]),
      writable.current.of(EditorView.editable.of(!doc.saving)),
      EditorView.contentAttributes.of({'aria-label':`编辑 ${doc.path}`,'spellcheck':'false'}),
      EditorView.updateListener.of(update=>{if(update.docChanged)callbacks.current.onChange(bom+update.state.doc.sliceString(0,undefined,separator))}),
      EditorView.theme({'&':{height:'100%',fontSize:'12px',backgroundColor:'var(--bg)',color:'var(--text)'},'.cm-scroller':{overflow:'auto',fontFamily:'Menlo, monospace'},'.cm-gutters':{backgroundColor:'var(--soft)',color:'var(--muted)',borderRight:'1px solid var(--line)'},'.cm-activeLine':{backgroundColor:'var(--editor-active-line)'},'.cm-activeLineGutter':{backgroundColor:'var(--soft)'},'.cm-cursor':{borderLeftColor:'var(--text)'},'.cm-selectionBackground':{backgroundColor:'var(--editor-selection-muted)'},'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':{backgroundColor:'var(--editor-selection)'},'.cm-panels':{backgroundColor:'var(--soft)',color:'var(--text)'},'.cm-textfield':{backgroundColor:'var(--bg)',color:'var(--text)'}}),
    ]})});view.current=editor;
    return()=>{editor.destroy();view.current=undefined};
  },[doc.id,doc.generation]);
  useEffect(()=>{view.current?.dispatch({effects:writable.current.reconfigure(EditorView.editable.of(!doc.saving))})},[doc.saving]);
  useEffect(()=>{if(active&&!doc.saving)requestAnimationFrame(()=>{view.current?.requestMeasure();view.current?.focus()})},[active,doc.saving,doc.generation]);
  return <section className="remote-editor" hidden={!active} aria-label={`${doc.path} 编辑器`}>
    <header className="remote-editor-toolbar"><span title={`${doc.serverName}:${doc.path}`}>{doc.serverName} / {doc.path}</span><IconAction label="重新读取" icon={<IconRefresh size={15}/>} disabled={doc.saving} onClick={onReload}/><IconAction label="下载文件" icon={<IconDownload size={15}/>} disabled={doc.saving} onClick={onDownload}/><IconAction label="保存 ⌘S" icon={<IconDeviceFloppy size={15}/>} loading={doc.saving} disabled={doc.content===null||doc.content===doc.baseline||doc.saving} onClick={onSave}/></header>
    {doc.error&&<div className="remote-editor-error" role="alert">{doc.error}</div>}
    {doc.content===null?<div className="remote-editor-unavailable"><strong>{doc.path.split('/').pop()}</strong><p>{doc.reason}</p><span>{doc.size<1024?`${doc.size} B`:`${(doc.size/1024).toFixed(1)} KB`}</span></div>:<div className="remote-editor-code" ref={host}/>}
    <footer className="remote-editor-footer"><span>{doc.saving?'正在保存…':doc.content!==doc.baseline?'未保存':doc.content===null?'仅查看文件信息':'已保存'}</span><span>{doc.content===null?'':`UTF-8 · ${doc.content.includes('\r\n')?'CRLF':doc.content.includes('\r')?'CR':'LF'}`}</span></footer>
  </section>;
}
