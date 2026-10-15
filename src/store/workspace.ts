import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { shortcuts, initialSession } from '@/data/demo';
import type { Process, Port, Shortcut, Server, Session } from '@/data/demo';
import { createRemoteFileWorkspace } from '@/data/demoFiles';
import { disposeTerminal } from '@/services/terminal';
import { workspaceStorage, blockConfigWrites } from '@/services/config';
import type { RemoteFileWorkspace } from '@/data/demoFiles';

type Settings = { theme: 'light' | 'dark' | 'system'; background: string; opacity: number; blur: number; terminalTheme: 'dark' | 'light'; extraColumns: boolean };
export const defaultSettings: Settings = {theme:'light',background:'',opacity:20,blur:10,terminalTheme:'dark',extraColumns:false};
type Workspace = {
  processes: Process[]; ports: Port[]; shortcuts: Shortcut[]; shortcutTags: string[]; servers: Server[];
  sessions: Session[]; activeSession: string; settings: Settings;
  remoteFiles: Record<string,RemoteFileWorkspace>;
  updateRemoteFiles: (serverId:string,update:(current:RemoteFileWorkspace)=>RemoteFileWorkspace)=>void;
  endProcess: (pid:number)=>void; resetDemo: ()=>void;
  renameShortcutTag: (name:string,next:string)=>void; deleteShortcutTag: (name:string)=>void;
  deleteShortcuts: (ids:string[])=>void;
  setShortcutTag: (ids:string[],tag:string|null)=>void;
  addShortcuts: (shortcuts:Shortcut[])=>void;
  saveShortcut: (shortcut:Shortcut)=>void; deleteShortcut: (id:string)=>void;
  saveServer: (server:Server)=>void; deleteServer: (id:string)=>void;
  addSession: (session:Session)=>void; updateSession: (id:string, change:Partial<Session>)=>void;
  closeSession: (id:string)=>void; setActiveSession:(id:string)=>void;
  setSettings: (settings:Partial<Settings>)=>void;
};
export const useWorkspace = create<Workspace>()(persist((set)=>({
  processes:[],ports:[],shortcuts,shortcutTags:['开发','Git','部署'],servers:[],sessions:[initialSession],activeSession:initialSession.id,settings:defaultSettings,remoteFiles:{},
  updateRemoteFiles:(serverId,update)=>set(state=>({remoteFiles:{...state.remoteFiles,[serverId]:update(state.remoteFiles[serverId]??createRemoteFileWorkspace())}})),
  endProcess:(pid)=>set(s=>({processes:s.processes.filter(p=>p.pid!==pid),ports:s.ports.filter(p=>p.pid!==pid)})),
  resetDemo:()=>set({processes:[],ports:[]}),
  renameShortcutTag:(name,next)=>set(s=>({shortcutTags:s.shortcutTags.map(tag=>tag===name?next:tag),shortcuts:s.shortcuts.map(item=>({...item,tag:item.tag===name?next:item.tag}))})),
  deleteShortcutTag:(name)=>set(s=>({shortcutTags:s.shortcutTags.filter(tag=>tag!==name),shortcuts:s.shortcuts.map(item=>({...item,tag:item.tag===name?null:item.tag}))})),
  addShortcuts:(items)=>set(s=>({shortcuts:[...items,...s.shortcuts],shortcutTags:Array.from(new Set([...s.shortcutTags,...items.flatMap(item=>item.tag?[item.tag]:[])]))})),
  saveShortcut:(shortcut)=>set(s=>{
    const item={...shortcut,tag:shortcut.tag?.trim()||null};
    return {shortcutTags:item.tag?Array.from(new Set([...s.shortcutTags,item.tag])):s.shortcutTags,shortcuts:s.shortcuts.some(c=>c.id===item.id)?s.shortcuts.map(c=>c.id===item.id?item:c):[...s.shortcuts,item]};
  }),
  deleteShortcuts:(ids)=>set(s=>({shortcuts:s.shortcuts.filter(item=>!ids.includes(item.id))})),
  setShortcutTag:(ids,tag)=>set(s=>({
    shortcutTags:tag?Array.from(new Set([...s.shortcutTags,tag])):s.shortcutTags,
    shortcuts:s.shortcuts.map(item=>!ids.includes(item.id)?item:{...item,tag}),
  })),
  deleteShortcut:(id)=>set(s=>({shortcuts:s.shortcuts.filter(c=>c.id!==id)})),
  saveServer:(server)=>set(s=>({servers:s.servers.some(c=>c.id===server.id)?s.servers.map(c=>c.id===server.id?server:c):[...s.servers,server]})),
  deleteServer:(id)=>set(s=>({servers:s.servers.filter(c=>c.id!==id)})),
  addSession:(session)=>set(s=>({sessions:[...s.sessions,session],activeSession:session.id})),
  updateSession:(id,change)=>set(s=>({sessions:s.sessions.map(c=>c.id===id?{...c,...change}:c)})),
  closeSession:(id)=>{disposeTerminal(id);set(s=>{const sessions=s.sessions.filter(c=>c.id!==id);return {sessions,activeSession:s.activeSession===id?(sessions.at(-1)?.id??''):s.activeSession}})},
  setActiveSession:(activeSession)=>set({activeSession}),
  setSettings:(change)=>set(s=>({settings:{...s.settings,...change}})),
}),{
  name:'portside-preview-v1',
  storage:createJSONStorage(()=>workspaceStorage),
  onRehydrateStorage:()=> (_state,error)=>{if(error)blockConfigWrites(error)},
  partialize:s=>({shortcuts:s.shortcuts,shortcutTags:s.shortcutTags,servers:s.servers.map(({id,name,host,user,port,auth,group,privateKeyPath})=>({id,name,host,user,port,auth,group,privateKeyPath})),settings:s.settings}),
  merge:(persisted,current)=>{
    const saved=persisted as Partial<Workspace> | undefined;
    const {accent: _legacyAccent,...settings}=(saved?.settings??{}) as Partial<Settings> & {accent?:string};
    const migratedShortcuts=(saved?.shortcuts??current.shortcuts).map(item=>{
      const legacy=item as Shortcut & {tags?:string[]};
      const tag=item.tag!==undefined?item.tag:legacy.tags!==undefined?(legacy.tags[0]??null):(shortcuts.find(seed=>seed.id===item.id)?.tag??null);
      return {id:item.id,name:item.name,directory:item.directory,command:item.command,tag};
    });
    const shortcutTags=Array.from(new Set([...(saved?.shortcutTags??current.shortcutTags),...migratedShortcuts.flatMap(item=>item.tag?[item.tag]:[])]));
    return {...current,servers:saved?.servers??current.servers,shortcuts:migratedShortcuts,shortcutTags,settings:{...defaultSettings,...settings}};
  },
}));
