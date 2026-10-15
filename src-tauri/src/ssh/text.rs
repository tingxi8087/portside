//! Bounded UTF-8 editing over SFTP; save only against the revision that was read.
use super::{blocking, connection, error, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use ssh2::{OpenFlags, OpenType, Sftp};
use std::{io::{Read, Write}, path::Path, sync::Mutex};

const LIMIT: usize = 1024 * 1024;
static EDIT_LOCK: Mutex<()> = Mutex::new(());
#[derive(Serialize, Debug)]
#[serde(rename_all="camelCase")]
pub struct TextFile {
    path: String,
    size: u64,
    content: Option<String>,
    revision: String,
    reason: Option<String>,
}
fn revision(bytes: &[u8], stat: &ssh2::FileStat) -> String {
    format!("{:x}:{}:{}:{}:{}", Sha256::digest(bytes), stat.mtime.unwrap_or(0), stat.perm.unwrap_or(0), stat.uid.unwrap_or(0), stat.gid.unwrap_or(0))
}
fn decode(bytes: Vec<u8>) -> std::result::Result<String, String> {
    let text=String::from_utf8(bytes).map_err(|_|"仅支持 UTF-8 文本，请下载后使用本地应用打开".to_string())?;
    if text.chars().any(|c| c.is_control() && !matches!(c,'\n'|'\r'|'\t')) {return Err("这是二进制文件，请下载后打开".into())}
    // A fixed line separator preserves LF / CRLF / CR, but cannot preserve mixed endings.
    let without_crlf=text.replace("\r\n", "");
    let kinds=usize::from(text.contains("\r\n"))+usize::from(without_crlf.contains('\n'))+usize::from(without_crlf.contains('\r'));
    if kinds>1 {return Err("文件含混合换行符，暂不编辑以保留原格式，请下载后打开".into())}
    Ok(text)
}
fn snapshot(sftp: &Sftp, path: &Path) -> Result<TextFile> {
    if !sftp.stat(path).map_err(error)?.is_file() {return Err("仅支持打开普通文件".into())}
    let mut file=sftp.open(path).map_err(error)?;
    let stat=file.stat().map_err(error)?;
    if !stat.is_file() {return Err("仅支持打开普通文件".into())}
    let size=stat.size.unwrap_or(0);
    let display=path.to_string_lossy().into_owned();
    if size>LIMIT as u64 {return Ok(TextFile{path:display,size,content:None,revision:String::new(),reason:Some("文件超过 1 MB，请下载后打开".into())})}
    let mut bytes=Vec::new();
    (&mut file).take(LIMIT as u64+1).read_to_end(&mut bytes).map_err(error)?;
    if bytes.len()>LIMIT {return Err("读取时文件已超过 1 MB，请下载后打开".into())}
    let after=file.stat().map_err(error)?;
    if stat.size!=after.size || stat.mtime!=after.mtime {return Err("文件正在变化，请重新打开".into())}
    let revision=revision(&bytes,&after);
    let size=bytes.len() as u64;
    match decode(bytes) {
        Ok(content)=>Ok(TextFile{path:display,size,content:Some(content),revision,reason:None}),
        Err(reason)=>Ok(TextFile{path:display,size,content:None,revision,reason:Some(reason)}),
    }
}
#[tauri::command]
pub async fn ssh_text_read(server_id: String, path: String) -> Result<TextFile> {
    blocking(move || {
        let _guard=EDIT_LOCK.lock().map_err(error)?;
        let conn=connection(&server_id)?;
        let sftp=conn.session.sftp().map_err(error)?;
        let canonical=sftp.realpath(Path::new(&path)).map_err(error)?;
        snapshot(&sftp,&canonical)
    }).await
}
#[tauri::command]
pub async fn ssh_text_save(server_id: String, path: String, content: String, expected_revision: String) -> Result<TextFile> {
    blocking(move || {
        if content.len()>LIMIT {return Err("文件超过 1 MB，无法保存".into())}
        decode(content.as_bytes().to_vec())?;
        let _guard=EDIT_LOCK.lock().map_err(error)?;
        let conn=connection(&server_id)?;
        let sftp=conn.session.sftp().map_err(error)?;
        let path=Path::new(&path);
        // Do not silently follow a new symlink that replaced the file since opening it.
        if sftp.lstat(path).map_err(error)?.file_type().is_symlink() {return Err("文件已被替换为符号链接，请重新打开".into())}
        let original=snapshot(&sftp,path)?;
        if original.content.is_none() || original.revision!=expected_revision {return Err("远程文件已修改，请重新读取后再保存；本地修改仍保留".into())}
        let stat=sftp.stat(path).map_err(error)?;
        let mut permission_check=sftp.open_mode(path,OpenFlags::WRITE,0,OpenType::File).map_err(|e|format!("文件不可写，未保存：{e}"))?;
        permission_check.close().map_err(error)?;
        let nonce=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(error)?.as_nanos();
        let temp=path.parent().ok_or("无效路径")?.join(format!(".portside-edit-{}-{nonce}",std::process::id()));
        let mut output=sftp.open_mode(&temp,OpenFlags::WRITE|OpenFlags::CREATE|OpenFlags::EXCLUSIVE,0o600,OpenType::File).map_err(error)?;
        let result=(|| {
            output.write_all(content.as_bytes()).map_err(error)?;
            output.flush().map_err(error)?;
            output.close().map_err(error)?;
            // Preserve ownership before permissions (chown can clear special permission bits).
            let temp_stat=sftp.stat(&temp).map_err(error)?;
            if temp_stat.uid!=stat.uid || temp_stat.gid!=stat.gid {
                sftp.setstat(&temp,ssh2::FileStat{size:None,uid:stat.uid,gid:stat.gid,perm:None,atime:None,mtime:None}).map_err(|e|format!("无法保留原文件所有者，未保存：{e}"))?;
            }
            sftp.setstat(&temp,ssh2::FileStat{size:None,uid:None,gid:None,perm:stat.perm,atime:None,mtime:None}).map_err(error)?;
            if snapshot(&sftp,path)?.revision!=expected_revision {return Err("远程文件已修改，未覆盖；本地修改仍保留".into())}
            super::posix_rename::replace(&conn.session,&temp.to_string_lossy(),&path.to_string_lossy())?;
            snapshot(&sftp,path)
        })();
        if result.is_err() {let _=sftp.unlink(&temp);}
        result
    }).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn text_validation_preserves_unicode_bom_and_line_endings() {
        for text in ["", "中文\nhello\n", "\u{feff}中文\r\nnext\r\n", "old\rmac\r"] {assert_eq!(decode(text.as_bytes().to_vec()).unwrap(),text);}
    }
    #[test] fn binary_invalid_encoding_and_mixed_endings_are_not_editable() {
        for bytes in [vec![0,1,2],vec![255,254,65,0],b"one\r\ntwo\n".to_vec()] {assert!(decode(bytes).is_err());}
    }
    #[test] fn revision_detects_same_size_same_timestamp_content_changes() {
        let stat=ssh2::FileStat{size:Some(3),uid:Some(1),gid:Some(1),perm:Some(0o100644),atime:None,mtime:Some(1)};
        assert_ne!(revision(b"one",&stat),revision(b"two",&stat));
    }
    #[test]
    #[ignore = "Requires isolated SSH fixture"]
    fn real_sftp_edit_conflict_permissions_binary_and_symlink() {
        use super::super::{Target,Credentials,Connection,state,handshake,authenticate};
        use tauri::async_runtime::block_on as run;
        let target=Target{id:"portside-text-fixture".into(),host:"127.0.0.1".into(),user:"tester".into(),port:std::env::var("PORTSIDE_SSH_FIXTURE_PORT").unwrap().parse().unwrap(),auth:"password".into(),private_key_path:None};
        let credentials=Credentials{password:Some("fixture-password".into()),passphrase:None};
        let session=handshake(&target).unwrap();authenticate(&session,&target,&credentials).unwrap();
        state().connections.lock().unwrap().insert(target.id.clone(),Connection{session:session.clone(),target:target.clone(),credentials});
        let sftp=session.sftp().unwrap();let root=format!("/home/tester/text-test-{}",std::process::id());sftp.mkdir(Path::new(&root),0o700).unwrap();
        let path=format!("{root}/配置.json");
        let mut file=sftp.create(Path::new(&path)).unwrap();file.write_all("\u{feff}原文\r\n".as_bytes()).unwrap();file.close().unwrap();
        sftp.setstat(Path::new(&path),ssh2::FileStat{size:None,uid:None,gid:None,perm:Some(0o640),atime:None,mtime:None}).unwrap();
        let original=run(ssh_text_read(target.id.clone(),path.clone())).unwrap();assert_eq!(original.content.as_deref(),Some("\u{feff}原文\r\n"));
        let saved=run(ssh_text_save(target.id.clone(),path.clone(),"\u{feff}修改\r\n".into(),original.revision.clone())).unwrap();assert_eq!(saved.content.as_deref(),Some("\u{feff}修改\r\n"));assert_eq!(sftp.stat(Path::new(&path)).unwrap().perm.unwrap()&0o777,0o640);
        assert!(run(ssh_text_save(target.id.clone(),path.clone(),"stale".into(),original.revision)).unwrap_err().contains("已修改"));
        assert_eq!(run(ssh_text_read(target.id.clone(),path.clone())).unwrap().content,saved.content);
        let link=format!("{root}/link");sftp.symlink(Path::new(&path),Path::new(&link)).unwrap();assert_eq!(run(ssh_text_read(target.id.clone(),link.clone())).unwrap().path,path);
        assert!(run(ssh_text_save(target.id.clone(),link.clone(),"unsafe".into(),saved.revision)).is_err());
        let binary=format!("{root}/binary");let mut file=sftp.create(Path::new(&binary)).unwrap();file.write_all(&[0,1,255]).unwrap();file.close().unwrap();assert!(run(ssh_text_read(target.id.clone(),binary.clone())).unwrap().content.is_none());
        sftp.setstat(Path::new(&path),ssh2::FileStat{size:None,uid:None,gid:None,perm:Some(0o444),atime:None,mtime:None}).unwrap();
        let readonly=run(ssh_text_read(target.id.clone(),path.clone())).unwrap();
        assert!(run(ssh_text_save(target.id.clone(),path.clone(),"should not write".into(),readonly.revision)).is_err());
        assert_eq!(run(ssh_text_read(target.id.clone(),path.clone())).unwrap().content,readonly.content);
        assert!(run(ssh_text_save(target.id.clone(),path.clone(),"x".repeat(LIMIT+1),String::new())).is_err());
        assert!(!sftp.readdir(Path::new(&root)).unwrap().iter().any(|(path,_)|path.file_name().unwrap().to_string_lossy().starts_with(".portside-edit-")));
        for p in [path,link,binary] {sftp.unlink(Path::new(&p)).unwrap();}sftp.rmdir(Path::new(&root)).unwrap();state().connections.lock().unwrap().remove(&target.id);
    }

}
