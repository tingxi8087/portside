import ResizableWorkspace from '@/components/ResizableWorkspace';
import { useWorkspace } from '@/store/workspace';
import TerminalPane, { createSession } from '@/components/TerminalPane';
import ShortcutPanel from '@/components/ShortcutPanel';

export default function Terminal() {
  const {sessions,activeSession,addSession}=useWorkspace();
  return <div className="page terminal-page"><ResizableWorkspace className="workbench-split" label="快捷指令" sidebar={<ShortcutPanel onRun={shortcut=>{addSession(createSession(shortcut.name,shortcut.directory,shortcut.command))}}/>}>
    <TerminalPane sessions={sessions.filter(session=>!session.serverId)} activeId={activeSession} onNew={()=>addSession(createSession())}/>
  </ResizableWorkspace></div>;
}
