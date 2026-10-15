// Test the real TS storage adapter with an injected IPC boundary, never user files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source=await fs.readFile(new URL('../src/services/config.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const injectable=compiled.replace(/import\s*\{[^}]*\}\s*from\s*['"]@tauri-apps\/api\/core['"];?/, 'const {invoke,isTauri}=globalThis.__portsideConfigTest;');
const events=new EventTarget();globalThis.window=events;
globalThis.localStorage={getItem:()=>null,setItem:()=>{throw Error('native test must not write localStorage')},removeItem:()=>{}};
let sequence=0;
async function adapter(invoke){globalThis.__portsideConfigTest={isTauri:()=>true,invoke};return (await import(`data:text/javascript;base64,${Buffer.from(`${injectable}\n// case ${++sequence}`).toString('base64')}`)).workspaceStorage;}
let alerted='';events.addEventListener('portside-config-error',event=>{alerted=event.detail});
{
 const calls=[];const storage=await adapter(async(command)=>{calls.push(command);if(command==='config_read')throw Error('synthetic unreadable config');});
 await assert.rejects(storage.getItem('test'));
 assert.match(alerted,/synthetic unreadable config/);
 await storage.setItem('test','{"state":{}}');
 assert.deepEqual(calls,['config_read'],'read failure must block all native writes');
 console.log('PASS read failure surfaced and native overwrite blocked');
}
{
 const writes=[];let release;
 const storage=await adapter(async(command,args)=>{if(command==='config_read')return 'initial';writes.push(args.value);if(args.value==='one')await new Promise(resolve=>{release=resolve});});
 await storage.getItem('test');await storage.setItem('test','initial');assert.equal(writes.length,0,'unchanged hydrated bytes must not be saved');
 const first=storage.setItem('test','one');await Promise.resolve();
 const second=storage.setItem('test','two');const third=storage.setItem('test','three');
 assert.deepEqual(writes,['one'],'only one write may be in flight');release();await Promise.all([first,second,third]);
 assert.deepEqual(writes,['one','three'],'intermediate queued values must be coalesced and latest persisted');
 await storage.setItem('test','three');assert.equal(writes.length,2,'unchanged state must not cause more disk I/O');
 console.log('PASS native writes serialize, coalesce to last value, and skip duplicates');
}
{
 let attempts=0;const storage=await adapter(async(command)=>{if(command==='config_read')return null;if(++attempts===1)throw Error('synthetic disk failure');});
 await storage.getItem('test');await storage.setItem('test','retry-value');assert.match(alerted,/synthetic disk failure/);
 await storage.setItem('test','retry-value');assert.equal(attempts,2,'failed save must not be recorded as successfully persisted');
 console.log('PASS failed write is reported and identical value may be retried');
}
{
 for(let delay=0;delay<8;delay++){
  const writes=[];const storage=await adapter(async(command,args)=>{if(command==='config_write')writes.push(args.value)});
  const first=storage.setItem('test','one');for(let step=0;step<delay;step++)await Promise.resolve();
  const second=storage.setItem('test','two');await Promise.all([first,second]);
  assert.equal(writes.at(-1),'two',`latest update lost at write completion microtask boundary ${delay}`);
 }
 console.log('PASS updates at every write-completion microtask boundary retain latest value');
}
{
 let releaseFirst,releaseLast;let lastStarted=false;let resolved=false;
 const writes=[];const storage=await adapter(async(command,args)=>{
  if(command!=='config_write')return;
  writes.push(args.value);
  if(args.value==='first')await new Promise(resolve=>{releaseFirst=resolve});
  if(args.value==='last'){lastStarted=true;await new Promise(resolve=>{releaseLast=resolve});}
 });
 const first=storage.setItem('test','first');await Promise.resolve();
 const last=storage.setItem('test','last').then(()=>{resolved=true});
 releaseFirst();for(let step=0;step<8&&!lastStarted;step++)await Promise.resolve();
 assert.equal(lastStarted,true,'last write must start after first completes');
 assert.equal(resolved,false,'setItem promise must not resolve before its latest value is written');
 releaseLast();await Promise.all([first,last]);
 assert.equal(resolved,true);assert.deepEqual(writes,['first','last']);
 console.log('PASS returned save promise waits for the final coalesced native write');
}
