import { useRef } from 'react';
import { App, Segmented, Slider } from 'paper-ink';
import { IconSun, IconMoon, IconDeviceDesktop, IconUpload, IconRefresh, IconCheck, IconPhoto, IconX } from 'paper-ink/icons';
import { useWorkspace, defaultSettings } from '@/store/workspace';
import { Button } from '@/components/UI';

export default function Settings() {
  const {settings,setSettings}=useWorkspace();
  const {message,modal}=App.useApp();
  const input=useRef<HTMLInputElement>(null);
  const upload=(file?:File)=>{
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){message.warning('请选择 PNG、JPG 或 WebP 图片');return}
    if(file.size>2*1024*1024){message.warning('预览版请使用 2 MB 以内的图片');return}
    const reader=new FileReader();reader.onload=()=>setSettings({background:String(reader.result)});reader.readAsDataURL(file);
  };
  return <div className="page settings-page">
    <div className="settings-intro"><span>纸墨 · 黑白灰</span><span className="saved-label"><IconCheck size={14}/>自动保存</span></div>
    <div className="settings-scroll">
      <section className="settings-section">
        <div className="setting-row"><strong>应用主题</strong><Segmented aria-label="应用主题" size="small" value={settings.theme} onChange={theme=>setSettings({theme})} options={[
          {value:'light',label:'浅色',icon:<IconSun size={14}/>},
          {value:'dark',label:'深色',icon:<IconMoon size={14}/>},
          {value:'system',label:'跟随系统',icon:<IconDeviceDesktop size={14}/>},
        ]}/></div>
        <div className="setting-row"><strong>终端配色</strong><Segmented aria-label="终端配色" size="small" value={settings.terminalTheme} onChange={terminalTheme=>setSettings({terminalTheme})} options={[{value:'dark',label:'墨黑'},{value:'light',label:'浅纸'}]}/></div>
      </section>
      <section className="settings-section">
        <div className="settings-section-heading"><h2>窗口背景</h2></div>
        <div className="background-upload">
          {settings.background?<div className="background-thumb" style={{backgroundImage:`url("${settings.background}")`}}/>:<span className="background-placeholder"><IconPhoto size={24} stroke={1.3}/></span>}
          <div><strong>{settings.background?'已选择自定义背景':'使用一张喜欢的图片'}</strong><p>PNG、JPG 或 WebP，最大 2 MB</p></div>
          <Button size="small" icon={<IconUpload size={14}/>} onClick={()=>input.current?.click()}>{settings.background?'更换图片':'选择图片'}</Button>
          {settings.background&&<Button size="small" type="text" aria-label="移除背景" icon={<IconX size={16}/>} onClick={()=>setSettings({background:''})}/>}
          <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/>
        </div>
        <div className="setting-row"><strong>背景透明度</strong><div className="range-control"><Slider ariaLabelForHandle="背景透明度" min={0} max={60} value={settings.opacity} onChange={opacity=>setSettings({opacity})} tooltip={{formatter:value=>`${value}%`}}/><span className="mono">{settings.opacity}%</span></div></div>
        <div className="setting-row"><strong>背景模糊</strong><div className="range-control"><Slider ariaLabelForHandle="背景模糊" min={0} max={30} value={settings.blur} onChange={blur=>setSettings({blur})} tooltip={{formatter:value=>`${value}px`}}/><span className="mono">{settings.blur}px</span></div></div>
      </section>
      <div className="settings-footer"><div><span className="brand-small">Portside</span><span>0.1.0 · 交互预览</span></div><Button size="small" type="text" icon={<IconRefresh size={14}/>} onClick={()=>modal.confirm({title:'恢复默认外观？',content:'只重置主题与背景，不影响快捷指令和连接配置。',okText:'恢复默认',cancelText:'取消',onOk:()=>setSettings(defaultSettings)})}>恢复默认</Button></div>
    </div>
  </div>;
}
