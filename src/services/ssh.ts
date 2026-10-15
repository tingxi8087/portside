import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { Server } from '@/data/demo';
import type { TerminalEvent, TerminalTransport } from './terminal';
export type ConnectionInfo={home:string;sftpAvailable:boolean};
export type Credentials={password?:string;passphrase?:string};
export type HostInfo={fingerprint:string;keyType:string;status:'unknown'|'trusted'|'changed';previousFingerprint?:string};
export type RemoteFile={name:string;folder:boolean;symlink:boolean;size:number;modified:number};
export type RemoteTextFile={path:string;size:number;content:string|null;revision:string;reason:string|null};
export type RemoteDirectory={path:string;files:RemoteFile[]};
export type TransferEvent={id:string;name:string;transferred:number;total:number;status:'running'|'completed'};
function native(){if(!isTauri())throw new Error('SSH 和文件管理需要在 Portside 桌面 App 中使用')}
export const ssh={
 hostInfo:(target:Server)=>{native();return invoke<HostInfo>('ssh_host_info',{target})},
 trust:(target:Server,fingerprint:string,expectedPreviousFingerprint?:string)=>invoke<void>('ssh_trust_host',{target,fingerprint,expectedPreviousFingerprint:expectedPreviousFingerprint??null}),
 connect:(target:Server,credentials?:Credentials,testOnly=false)=>{native();return invoke<ConnectionInfo>('ssh_connect',{target,credentials:credentials??null,testOnly})},
 saveCredentials:(serverId:string,credentials:Credentials)=>invoke<void>('ssh_save_credentials',{serverId,credentials}),
 deleteCredentials:(serverId:string)=>invoke<void>('ssh_delete_credentials',{serverId}),
 hasCredentials:(serverId:string)=>invoke<boolean>('ssh_has_credentials',{serverId}),
 disconnect:(serverId:string)=>invoke<void>('ssh_disconnect',{serverId}),
 readText:(serverId:string,path:string)=>invoke<RemoteTextFile>('ssh_text_read',{serverId,path}),
 saveText:(serverId:string,path:string,content:string,expectedRevision:string)=>invoke<RemoteTextFile>('ssh_text_save',{serverId,path,content,expectedRevision}),
 list:(serverId:string,path:string)=>invoke<RemoteDirectory>('ssh_list',{serverId,path}),
 action:(serverId:string,path:string,action:'mkdir'|'rename'|'delete',name?:string)=>invoke<void>('ssh_file_action',{serverId,path,action,name:name??null}),
 pickUpload:()=>invoke<string[]>('ssh_pick_upload'),
 pickDownload:(name:string)=>invoke<string|null>('ssh_pick_download',{name}),
 transfer:async(serverId:string,id:string,localPath:string,remotePath:string,upload:boolean,overwrite:boolean,onProgress:(e:TransferEvent)=>void)=>{const channel=new Channel<TransferEvent>();channel.onmessage=onProgress;await invoke('ssh_transfer',{serverId,transferId:id,localPath,remotePath,upload,overwrite,onProgress:channel})},
 cancelTransfer:(transferId:string)=>invoke<void>('ssh_transfer_cancel',{transferId}),
};
export const sshTerminalTransport:TerminalTransport={
 async start(session,cols,rows,onEvent){native();const channel=new Channel<TerminalEvent>();channel.onmessage=onEvent;await invoke('ssh_terminal_open',{sessionId:session.id,serverId:session.serverId,cols,rows,directory:session.directory,onEvent:channel})},
 write:(sessionId,data)=>invoke('ssh_terminal_write',{sessionId,data}),
 resize:(sessionId,cols,rows)=>invoke('ssh_terminal_resize',{sessionId,cols,rows}),
 close:sessionId=>invoke('ssh_terminal_close',{sessionId}),
 ack:(sessionId,bytes)=>invoke('ssh_terminal_ack',{sessionId,bytes}),
};
