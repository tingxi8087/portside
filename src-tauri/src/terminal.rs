use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{collections::HashMap, io::{Read, Write}, sync::{Arc, Condvar, Mutex}, thread};
use tauri::{ipc::Channel, State};

const OUTPUT_WINDOW: usize = 256 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent { pub kind: String, pub data: Option<Vec<u8>>, pub code: Option<u32> }
struct Flow { pending: usize, closed: bool }
struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    flow: (Mutex<Flow>, Condvar),
}
#[derive(Default)]
pub struct TerminalManager { sessions: Mutex<HashMap<String, Arc<PtySession>>> }
impl TerminalManager {
    pub fn close_all(&self) { let entries = self.sessions.lock().unwrap().drain().map(|(_,s)|s).collect::<Vec<_>>(); for session in entries { close(&session); } }
    fn get(&self,id:&str)->Result<Arc<PtySession>,String>{self.sessions.lock().map_err(|e|e.to_string())?.get(id).cloned().ok_or_else(||"终端会话已关闭".into())}
}
fn close(session:&PtySession) {
    let (flow,wake)=&session.flow;
    if let Ok(mut state)=flow.lock(){state.closed=true;wake.notify_all();}
    // Only signal this PTY's process group, never the host application's group.
    if let Ok(mut child)=session.child.lock(){if let Some(pid)=child.process_id(){unsafe{libc::kill(-(pid as i32),libc::SIGHUP);}} let _=child.kill();}
}
fn dimensions(cols:u16,rows:u16)->PtySize{PtySize{rows:rows.clamp(2,500),cols:cols.clamp(2,1000),pixel_width:0,pixel_height:0}}
fn working_directory(directory:&str)->Result<std::path::PathBuf,String>{
    let home=std::env::var("HOME").map_err(|_|"无法获取用户目录")?;
    let path=if directory.is_empty()||directory=="~"{home}else if let Some(rest)=directory.strip_prefix("~/"){format!("{home}/{rest}")}else{directory.to_string()};
    let path=std::path::PathBuf::from(path);
    if !path.is_absolute()||!path.is_dir(){return Err("执行目录不存在或不是绝对路径".into())} Ok(path)
}
#[tauri::command]
pub fn terminal_start(state:State<'_,TerminalManager>,id:String,directory:String,cols:u16,rows:u16,on_event:Channel<TerminalEvent>)->Result<(),String>{
    let mut sessions=state.sessions.lock().map_err(|e|e.to_string())?;
    if sessions.contains_key(&id){return Err("终端会话已存在".into())}
    if sessions.len()>=32{return Err("最多同时打开 32 个终端".into())}
    let cwd=working_directory(&directory)?;
    let pair=native_pty_system().openpty(dimensions(cols,rows)).map_err(|e|e.to_string())?;
    let shell=std::env::var("SHELL").unwrap_or_else(|_|"/bin/zsh".into());
    let mut command=CommandBuilder::new(shell); command.arg("-l");command.arg("-i");command.cwd(cwd);command.env("TERM","xterm-256color");command.env("COLORTERM","truecolor");command.env("TERM_PROGRAM","Portside");
    let child=pair.slave.spawn_command(command).map_err(|e|e.to_string())?;
    drop(pair.slave);
    let mut reader=pair.master.try_clone_reader().map_err(|e|e.to_string())?;
    let writer=pair.master.take_writer().map_err(|e|e.to_string())?;
    let session=Arc::new(PtySession{master:Mutex::new(pair.master),writer:Mutex::new(writer),child:Mutex::new(child),flow:(Mutex::new(Flow{pending:0,closed:false}),Condvar::new())});
    sessions.insert(id,session.clone());
    thread::spawn(move||{
        let mut bytes=[0u8;8192];
        loop{
            let count=match reader.read(&mut bytes){Ok(0)|Err(_)=>break,Ok(n)=>n};
            let (flow,wake)=&session.flow;
            let mut state=flow.lock().unwrap();
            while state.pending>=OUTPUT_WINDOW&&!state.closed{state=wake.wait(state).unwrap();}
            if state.closed{break} state.pending+=count;drop(state);
            if on_event.send(TerminalEvent{kind:"data".into(),data:Some(bytes[..count].to_vec()),code:None}).is_err(){close(&session);break}
        }
        let code=session.child.lock().ok().and_then(|mut child|child.wait().ok()).map(|s|s.exit_code());
        let _=on_event.send(TerminalEvent{kind:"exit".into(),data:None,code});
    }); Ok(())
}
#[tauri::command]
pub fn terminal_write(state:State<'_,TerminalManager>,id:String,data:String)->Result<(),String>{
    if data.len()>1024*1024{return Err("单次终端输入过大".into())}
    let session=state.get(&id)?;let mut writer=session.writer.lock().map_err(|e|e.to_string())?;
    writer.write_all(data.as_bytes()).and_then(|_|writer.flush()).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn terminal_resize(state:State<'_,TerminalManager>,id:String,cols:u16,rows:u16)->Result<(),String>{let session=state.get(&id)?;let result=session.master.lock().map_err(|e|e.to_string())?.resize(dimensions(cols,rows)).map_err(|e|e.to_string());result}
#[tauri::command]
pub fn terminal_ack(state:State<'_,TerminalManager>,id:String,bytes:usize)->Result<(),String>{let session=state.get(&id)?;let(flow,wake)=&session.flow;let mut state=flow.lock().map_err(|e|e.to_string())?;state.pending=state.pending.saturating_sub(bytes);wake.notify_all();Ok(())}
#[tauri::command]
pub fn terminal_close(state:State<'_,TerminalManager>,id:String)->Result<(),String>{if let Some(session)=state.sessions.lock().map_err(|e|e.to_string())?.remove(&id){close(&session)} Ok(())}
