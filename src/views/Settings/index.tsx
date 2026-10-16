import FloatingSettings from '@/views/Floating/Settings';
import { useEffect, useRef, useState } from 'react';
import { App, Checkbox, Segmented, Slider, Tabs } from 'paper-ink';
import { IconSun, IconMoon, IconDeviceDesktop, IconUpload, IconRefresh, IconCheck, IconPhoto, IconX } from 'paper-ink/icons';
import { useWorkspace, defaultSettings } from '@/store/workspace';
import { Button } from '@/components/UI';
import { version } from '../../../package.json';
import { readAutostart, setAutostart, supportsAutostart } from '@/services/autostart';

export default function Settings() {
  const {settings,setSettings}=useWorkspace();
  const {message,modal}=App.useApp();
  const [tab,setTab]=useState('appearance');
  const input=useRef<HTMLInputElement>(null);
  const [autostart,setAutostartChecked]=useState(false);
  const [autostartReady,setAutostartReady]=useState(false);
  const [autostartBusy,setAutostartBusy]=useState(false);
  const changingAutostart=useRef(false);
  useEffect(()=>{
    if(!supportsAutostart)return;
    let active=true;
    void readAutostart().then(enabled=>{if(active){setAutostartChecked(enabled);setAutostartReady(true)}}).catch(()=>{if(active)void message.error('无法读取开机自动启动状态，请重新打开设置')});
    return()=>{active=false};
  },[message]);
  const changeAutostart=async(enabled:boolean)=>{
    if(changingAutostart.current)return;
    changingAutostart.current=true;setAutostartBusy(true);
    try{setAutostartChecked(await setAutostart(enabled))}
    catch(error){void message.error(error instanceof Error?error.message:String(error));try{setAutostartChecked(await readAutostart())}catch{setAutostartReady(false)}}
    finally{changingAutostart.current=false;setAutostartBusy(false)}
  };
  const upload=(file?:File)=>{
    if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){message.warning('请选择 PNG、JPG 或 WebP 图片');return}
    if(file.size>2*1024*1024){message.warning('请使用 2 MB 以内的图片');return}
    const reader=new FileReader();reader.onload=()=>setSettings({background:String(reader.result)});reader.readAsDataURL(file);
  };
  const appearance=<>
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
  </>;
  return <div className="page settings-page settings-page--tabs">
    <Tabs className="settings-tabs" size="small" aria-label="设置分类" activeKey={tab} onChange={setTab} tabBarExtraContent={<span className="saved-label"><IconCheck size={14}/>自动保存</span>} items={[
      {key:'appearance',label:'外观',children:appearance},
      {key:'floating',label:'悬浮球',children:<FloatingSettings/>},
      {key:'general',label:'通用',children:<section className="settings-section">
        <div className="setting-row"><strong>启动</strong><Checkbox checked={autostart} disabled={!supportsAutostart||!autostartReady||autostartBusy} onChange={event=>void changeAutostart(event.target.checked)} title={supportsAutostart?undefined:'仅桌面 App 支持'}>开机自动启动</Checkbox></div>
      </section>},
    ]}/>
      <div className="settings-footer"><div><span className="brand-small">Portside</span><span>{version}</span></div>{tab==='appearance'&&<Button size="small" type="text" icon={<IconRefresh size={14}/>} onClick={()=>modal.confirm({title:'恢复默认外观？',content:'只重置主题与背景，不影响快捷指令和连接配置。',okText:'恢复默认',cancelText:'取消',onOk:()=>setSettings({...defaultSettings,floatingEnabled:settings.floatingEnabled,floatingMetrics:settings.floatingMetrics})})}>恢复默认</Button>}</div>
  </div>;
}
