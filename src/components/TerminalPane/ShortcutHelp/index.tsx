import { useState } from 'react';
import { Modal, Tabs } from 'paper-ink';
import { IconHelpCircle } from 'paper-ink/icons';
import { IconAction } from '@/components/UI';
import './style.less';

type System='mac'|'windows'|'linux';
type Shortcut={label:string;keys:string[]};
const editing:Shortcut[]=[
  {label:'取消当前输入 / 中断运行中的程序',keys:['Control','C']},
  {label:'删除光标前一个字符',keys:['退格']},
  {label:'向左 / 向右移动光标',keys:['←','/','→']},
  {label:'移到行首',keys:['Control','A']},
  {label:'移到行尾',keys:['Control','E']},
  {label:'删除光标前内容（部分 Shell 清整行）',keys:['Control','U']},
  {label:'删除光标到行尾的内容',keys:['Control','K']},
  {label:'删除前一个词',keys:['Control','W']},
  {label:'恢复最近剪切的文本',keys:['Control','Y']},
  {label:'清屏，保留当前输入',keys:['Control','L']},
  {label:'搜索历史命令',keys:['Control','R']},
  {label:'浏览上一条 / 下一条历史命令',keys:['↑','/','↓']},
  {label:'补全命令、文件名或路径',keys:['Tab']},
];
const appShortcuts:Shortcut[]=[
  {label:'展开 / 收起右侧面板',keys:['Command','B']},
  {label:'切换终端 / SSH / 端口 / 进程',keys:['Command','1–4']},
  {label:'搜索页面、连接或快捷指令',keys:['Command','K']},
];
function ShortcutList({title,items}:{title:string;items:Shortcut[]}){
  return <section className="terminal-shortcuts-group"><h3>{title}</h3><dl>{items.map(item=><div className="terminal-shortcut-row" key={item.label}><dt>{item.label}</dt><dd>{item.keys.map((key,index)=><span className="terminal-shortcut-key" key={`${key}-${index}`}>{index>0&&<span className="terminal-shortcut-join">{key==='/'||item.keys[index-1]==='/'?'':'+'}</span>}{key==='/'?<span className="terminal-shortcut-join">/</span>:<kbd>{key}</kbd>}</span>)}</dd></div>)}</dl></section>;
}
export default function ShortcutHelp(){
  const [open,setOpen]=useState(false);
  const [system,setSystem]=useState<System>(()=>/Mac|iPhone|iPad/i.test(navigator.platform)?'mac':/Win/i.test(navigator.platform)?'windows':'linux');
  const content=(target:System)=><div className="terminal-shortcuts-scroll">
    <p className="terminal-shortcuts-note">{target==='mac'?<>Control（⌃）用于命令行编辑；Command（⌘）用于复制、粘贴。两者是不同的键。</>:<>以下为 {target==='windows'?'Windows 下 Bash / Zsh（如 WSL）':'Linux 下 Bash / Zsh'} 的常用按键参考。</>}</p>
    <ShortcutList title="命令行编辑" items={editing}/>
    <ShortcutList title="复制与粘贴" items={[
      {label:'复制选中的终端文字',keys:target==='mac'?['Command','C']:['Control','Shift','C']},
      {label:'粘贴剪贴板内容',keys:target==='mac'?['Command','V']:['Control','Shift','V']},
      ...(target==='mac'?[{label:'删除前一个词（Portside）',keys:['Option','退格']}]:[]),
    ]}/>
    {target==='mac'&&<ShortcutList title="Portside" items={appShortcuts}/>}
    <p className="terminal-shortcuts-note terminal-shortcuts-footnote">SSH 连接 Linux 服务器时，复制粘贴仍按本机系统使用。Shell 自定义绑定、PowerShell、Vim 等程序可能不同。Portside 普通终端中的 Shift＋← / → 仅移动光标，不作文本选择。</p>
  </div>;
  return <><IconAction label="终端快捷键" icon={<IconHelpCircle size={15}/>} onClick={()=>setOpen(true)}/><Modal open={open} title="终端快捷键" centered width={560} footer={null} rootClassName="terminal-shortcuts-modal" onCancel={()=>setOpen(false)}>
    <Tabs size="small" activeKey={system} onChange={key=>setSystem(key as System)} items={[{key:'mac',label:'macOS',children:content('mac')},{key:'windows',label:'Windows',children:content('windows')},{key:'linux',label:'Linux',children:content('linux')}]}/>
  </Modal></>;
}
