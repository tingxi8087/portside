import { App } from 'paper-ink';
import { useWorkspace } from '@/store/workspace';
import TerminalPane, { createSession } from '@/components/TerminalPane';
import ShortcutPanel from '@/components/ShortcutPanel';

export default function Terminal() {
  const {sessions,activeSession,addSession}=useWorkspace();
  const {message}=App.useApp();
  return <div className="page terminal-page"><div className="workbench-split">
    <TerminalPane sessions={sessions.filter(session=>!session.serverId)} activeId={activeSession} onNew={()=>addSession(createSession())}/>
    <ShortcutPanel onRun={shortcut=>{addSession(createSession(shortcut.name,shortcut.directory,shortcut.command));message.success(`演示：已运行「${shortcut.name}」`)}}/>
  </div></div>;
}
