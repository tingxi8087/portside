import { App } from 'paper-ink';
import type { Shortcut } from '@/data/demo';
import { shortcutCommand } from '@/utils/shortcutCommand';
import { localTerminalTransport, terminalError } from '@/services/terminal';
import ResizableWorkspace from '@/components/ResizableWorkspace';
import { useWorkspace } from '@/store/workspace';
import TerminalPane, { createSession } from '@/components/TerminalPane';
import ShortcutPanel from '@/components/ShortcutPanel';

export default function Terminal() {
  const {sessions,activeSession,addSession}=useWorkspace();
  const {message}=App.useApp();
  const local=sessions.filter(session=>!session.serverId);
  const active=local.find(session=>session.id===activeSession)??local[0];
  const run=(shortcut:Shortcut)=>{if(active)void localTerminalTransport.write(active.id,shortcutCommand(shortcut)).catch(error=>message.error(terminalError(error)))};
  return <div className="page terminal-page"><ResizableWorkspace className="workbench-split" label="快捷指令" sidebar={<ShortcutPanel context={active?`运行到：${active.name}`:undefined} runDisabledReason={!active?.running?'请先打开一个可用终端':undefined} onRun={run} onRunNew={shortcut=>addSession(createSession(shortcut.name,shortcut.directory||'~',shortcut.command))}/>}>
    <TerminalPane sessions={local} activeId={activeSession} onNew={()=>addSession(createSession())}/>
  </ResizableWorkspace></div>;
}
