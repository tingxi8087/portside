export type FileItem={name:string;folder:boolean;size:string;modified:string};
export const initialFiles:Record<string,FileItem[]>={
  '/home/ubuntu':[{name:'apps',folder:true,size:'—',modified:'今天 10:24'},{name:'backups',folder:true,size:'—',modified:'昨天 02:00'},{name:'logs',folder:true,size:'—',modified:'今天 11:08'},{name:'.profile',folder:false,size:'807 B',modified:'10月12日'},{name:'README.md',folder:false,size:'1.2 KB',modified:'10月14日'}],
  '/home/ubuntu/apps':[{name:'portside-api',folder:true,size:'—',modified:'今天 10:24'},{name:'docker-compose.yml',folder:false,size:'2.4 KB',modified:'10月14日'}],
  '/home/ubuntu/apps/portside-api':[{name:'package.json',folder:false,size:'1.1 KB',modified:'今天 10:24'}],
  '/home/ubuntu/backups':[], '/home/ubuntu/logs':[{name:'access.log',folder:false,size:'24.8 KB',modified:'今天 11:08'}],
  '/home':[{name:'ubuntu',folder:true,size:'—',modified:'今天'}], '/':[{name:'home',folder:true,size:'—',modified:'今天'}],
};

export type RemoteFileWorkspace = { files: Record<string,FileItem[]>; path: string };
export const createRemoteFileWorkspace = ():RemoteFileWorkspace => ({ files:initialFiles,path:'/home/ubuntu' });
