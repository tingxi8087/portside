//! The ssh2 crate exposes only SFTP v3 rename, which cannot overwrite on OpenSSH.
//! Use OpenSSH's advertised POSIX rename extension on a dedicated SFTP channel.
use super::{error, Result};
use std::io::{Read, Write};
const EXTENSION: &[u8]=b"posix-rename@openssh.com";
fn string(output:&mut Vec<u8>, value:&[u8]) {output.extend_from_slice(&(value.len() as u32).to_be_bytes());output.extend_from_slice(value)}
fn field<'a>(input:&mut &'a [u8])->Result<&'a [u8]> {
    if input.len()<4 {return Err("无效 SFTP 响应".into())}
    let size=u32::from_be_bytes(input[..4].try_into().unwrap()) as usize;*input=&input[4..];
    if size>input.len() {return Err("无效 SFTP 响应长度".into())}
    let value=&input[..size];*input=&input[size..];Ok(value)
}
fn send(channel:&mut ssh2::Channel, bytes:&[u8])->Result<()> {
    channel.write_all(&(bytes.len() as u32).to_be_bytes()).map_err(error)?;
    channel.write_all(bytes).map_err(error)?;channel.flush().map_err(error)
}
fn receive(channel:&mut ssh2::Channel)->Result<Vec<u8>> {
    let mut length=[0;4];channel.read_exact(&mut length).map_err(error)?;
    let length=u32::from_be_bytes(length) as usize;
    if length==0||length>256*1024 {return Err("SFTP 响应大小无效".into())}
    let mut body=vec![0;length];channel.read_exact(&mut body).map_err(error)?;Ok(body)
}
pub(super) fn replace(session:&ssh2::Session,source:&str,destination:&str)->Result<()> {
    let mut channel=session.channel_session().map_err(error)?;channel.subsystem("sftp").map_err(error)?;
    send(&mut channel,&[1,0,0,0,3])?; // SSH_FXP_INIT, v3
    let version=receive(&mut channel)?;
    if version.len()<5||version[0]!=2 {return Err("SFTP 初始化失败".into())}
    let mut extensions=&version[5..];let mut supported=false;
    while !extensions.is_empty() {let name=field(&mut extensions)?;let version=field(&mut extensions)?;supported|=name==EXTENSION&&version==b"1";}
    if !supported {return Err("服务器不支持安全替换文件，未保存；请下载后编辑".into())}
    let mut request=vec![200,0,0,0,1]; // SSH_FXP_EXTENDED, request 1
    string(&mut request,EXTENSION);string(&mut request,source.as_bytes());string(&mut request,destination.as_bytes());send(&mut channel,&request)?;
    let response=receive(&mut channel)?;
    if response.len()<9||response[0]!=101||response[1..5]!=[0,0,0,1] {return Err("SFTP 保存响应无效".into())}
    let status=u32::from_be_bytes(response[5..9].try_into().unwrap());
    if status!=0 {return Err(format!("安全替换失败（SFTP {status}），原文件未主动移除"))}
    let _=channel.send_eof();let _=channel.close();Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn sftp_fields_validate_lengths() {
        let mut bytes=vec![];string(&mut bytes,b"test");let mut slice=bytes.as_slice();assert_eq!(field(&mut slice).unwrap(),b"test");assert!(slice.is_empty());
        assert!(field(&mut &[0,0,0][..]).is_err());assert!(field(&mut &[255,255,255,255][..]).is_err());
    }
}
