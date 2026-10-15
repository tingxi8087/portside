export type Process = { pid: number; name: string; app: string; cpu: number; memory: number; disk: number; network: number; user: string; command: string; color: string };
export type Port = { id: string; port: number; pid: number; protocol: 'TCP' | 'UDP'; address: string; scope: 'local' | 'network' };
export type Shortcut = { id: string; name: string; directory: string; command: string; tag: string | null };
export type Server = { id: string; name: string; host: string; user: string; port: number; auth: 'key' | 'password' | 'agent'; group: string; privateKeyPath?: string };
export type Session = { id: string; name: string; directory: string; lines: string[]; running: boolean; initialCommand?: string; serverId?: string };

export const processes: Process[] = [
  { pid:12840, name:'node', app:'Portside · Vite', cpu:2.4, memory:186.2, disk:12.4, network:4.2, user:'tingxi', command:'node /Users/tingxi/appCode/Portside/node_modules/.bin/vite', color:'green' },
  { pid:12912, name:'node', app:'API Server', cpu:1.2, memory:124.8, disk:3.6, network:8.1, user:'tingxi', command:'node /Users/tingxi/appCode/api-server/index.js', color:'green' },
  { pid:8432, name:'postgres', app:'PostgreSQL 16', cpu:0.3, memory:62.4, disk:48.2, network:0.8, user:'tingxi', command:'/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16', color:'blue' },
  { pid:9041, name:'redis-server', app:'Redis', cpu:0.1, memory:12.6, disk:1.2, network:0.2, user:'tingxi', command:'/opt/homebrew/bin/redis-server 127.0.0.1:6379', color:'red' },
  { pid:14208, name:'python3', app:'Local notebook', cpu:3.8, memory:248.5, disk:8.5, network:2.1, user:'tingxi', command:'python3 -m http.server 8000', color:'amber' },
  { pid:6512, name:'Docker', app:'Docker Desktop', cpu:4.6, memory:524.3, disk:128.6, network:32.4, user:'tingxi', command:'/Applications/Docker.app/Contents/MacOS/com.docker.backend', color:'blue' },
  { pid:15762, name:'node', app:'Docs · Next.js', cpu:0.8, memory:162.1, disk:2.4, network:1.8, user:'tingxi', command:'next dev --port 3001', color:'green' },
  { pid:382, name:'ControlCenter', app:'macOS', cpu:0.2, memory:38.4, disk:0.1, network:0, user:'tingxi', command:'/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter', color:'gray' },
  { pid:264, name:'mDNSResponder', app:'Bonjour Service', cpu:0.1, memory:8.2, disk:0, network:0.6, user:'root', command:'/usr/sbin/mDNSResponder', color:'gray' },
  { pid:17622, name:'Code Helper', app:'Visual Studio Code', cpu:8.2, memory:412.8, disk:16.2, network:3.4, user:'tingxi', command:'/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app', color:'blue' },
  { pid:17003, name:'Safari', app:'Safari', cpu:5.1, memory:386.4, disk:6.2, network:12.6, user:'tingxi', command:'/Applications/Safari.app/Contents/MacOS/Safari', color:'blue' },
];
export const ports: Port[] = [
  {id:'3000-12840',port:3000,pid:12840,protocol:'TCP',address:'127.0.0.1',scope:'local'},
  {id:'3001-15762',port:3001,pid:15762,protocol:'TCP',address:'127.0.0.1',scope:'local'},
  {id:'5432-8432',port:5432,pid:8432,protocol:'TCP',address:'127.0.0.1',scope:'local'},
  {id:'6379-9041',port:6379,pid:9041,protocol:'TCP',address:'127.0.0.1',scope:'local'},
  {id:'8000-14208',port:8000,pid:14208,protocol:'TCP',address:'0.0.0.0',scope:'network'},
  {id:'8080-12912',port:8080,pid:12912,protocol:'TCP',address:'127.0.0.1',scope:'local'},
  {id:'8888-6512',port:8888,pid:6512,protocol:'TCP',address:'0.0.0.0',scope:'network'},
  {id:'5000-382',port:5000,pid:382,protocol:'TCP',address:'0.0.0.0',scope:'network'},
  {id:'7000-382',port:7000,pid:382,protocol:'TCP',address:'0.0.0.0',scope:'network'},
  {id:'5353-264',port:5353,pid:264,protocol:'UDP',address:'0.0.0.0',scope:'network'},
];
export const shortcuts: Shortcut[] = [
  {id:'vite',name:'启动前端',directory:'~/appCode/Portside',command:'npm run dev',tag:'开发'},
  {id:'api',name:'启动 API 服务',directory:'~/appCode/api-server',command:'npm run start',tag:'开发'},
  {id:'git',name:'查看 Git 状态',directory:'~/appCode/Portside',command:'git status',tag:'Git'},
];
export const servers: Server[] = [
  {id:'production',name:'Production',host:'192.0.2.10',user:'root',port:22,auth:'key',group:'生产环境'},
  {id:'development',name:'Development',host:'192.0.2.24',user:'ubuntu',port:22,auth:'key',group:'开发环境'},
  {id:'staging',name:'Staging',host:'198.51.100.8',user:'deploy',port:22,auth:'password',group:'测试环境'},
];
export const initialSession: Session = {id:'local-1',name:'zsh',directory:'~',running:false,lines:[]};
