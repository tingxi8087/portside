import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/components/TerminalPane/runtime.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({initialCommand,resizeImpl=async()=>{}}={}){
  const opening=deferred(),calls=[];let emit,dispose;
  class Terminal {
    cols=80;rows=24;dimensions={cols:122,rows:14};options={};
    buffer={active:{type:'normal'}};
    open(){} loadAddon(addon){addon.activate?.(this)}
    onData(handler){this.dataHandler=handler} input(data){this.dataHandler?.(data)} onResize(handler){this.resizeHandler=handler} attachCustomKeyEventHandler(handler){this.keyHandler=handler}
    resize(cols,rows){this.cols=cols;this.rows=rows;this.resizeHandler?.({cols,rows})}
    write(data,done){done?.()} writeln(){} dispose(){}
  }
  class FitAddon {
    activate(terminal){this.terminal=terminal}
    fit(){const t=this.terminal,d=t.dimensions;if(t.cols!==d.cols||t.rows!==d.rows)t.resize(d.cols,d.rows)}
  }
  const exports={};
  vm.runInNewContext(code,{exports,document:{createElement:()=>({})},TextEncoder,Uint8Array,require:name=>{
    if(name==='@xterm/xterm')return {Terminal};
    if(name==='@xterm/addon-fit')return {FitAddon};
    if(name==='@xterm/addon-search')return {SearchAddon:class{}};
    if(name==='@/services/clipboard')return {writeClipboard:async()=>{}};
    if(name==='@/services/terminal')return {terminalError:String,registerTerminalDisposer:(id,callback)=>{dispose=callback}};
    throw new Error(`Unexpected import: ${name}`);
  }});
  const runtime=exports.getRuntime({id:'test',directory:'~',initialCommand},{
    start:async(session,cols,rows,onEvent)=>{calls.push(['start',cols,rows]);emit=onEvent;await opening.promise},
    resize:async(id,cols,rows)=>{calls.push(['resize',cols,rows]);await resizeImpl(cols,rows)},
    write:async(id,data)=>{calls.push(['write',data])},close:async()=>{calls.push(['close'])},
  });
  runtime.fit.fit(); // The viewport fits while SSH is still connecting.
  return {runtime,calls,opening,emit:event=>emit(event),dispose:()=>dispose()};
}

test('slow connection synchronizes the already fitted viewport before the initial command',async()=>{
  const f=fixture({initialCommand:'pwd'});
  assert.equal(f.runtime.status,'connecting');
  f.opening.resolve();await f.runtime.start;
  assert.deepEqual(f.calls,[['start',80,24],['resize',122,14],['write','pwd\r']]);
  assert.equal(f.runtime.status,'ready');
});
test('another fit during the initial resize is synchronized before becoming ready',async()=>{
  const resizing=deferred();let first=true;
  const f=fixture({resizeImpl:async()=>{if(first){first=false;await resizing.promise}}});
  f.opening.resolve();await tick();
  assert.equal(f.runtime.status,'connecting');
  f.runtime.terminal.dimensions={cols:98,rows:30};f.runtime.fit.fit();
  resizing.resolve();await f.runtime.start;
  assert.deepEqual(f.calls,[['start',80,24],['resize',122,14],['resize',98,30]]);
  f.runtime.terminal.dimensions={cols:110,rows:28};f.runtime.fit.fit();await tick();
  assert.deepEqual(f.calls.at(-1),['resize',110,28]);
});
test('exited and disposed connections never become ready or run an initial command',async()=>{
  for(const mode of ['exited','disposed']){
    const f=fixture({initialCommand:'pwd'});
    if(mode==='exited')f.emit({kind:'exit',code:0});else f.dispose();
    f.opening.resolve();await f.runtime.start;await tick();
    assert.notEqual(f.runtime.status,'ready');
    assert.equal(f.calls.some(call=>call[0]==='resize'||call[0]==='write'),false);
  }
});
test('a failed initial resize is visible and does not execute the initial command',async()=>{
  const f=fixture({initialCommand:'pwd',resizeImpl:async()=>{throw new Error('resize failed')}});
  f.opening.resolve();await f.runtime.start;
  assert.equal(f.runtime.status,'error');assert.match(f.runtime.detail,/resize failed/);
  assert.equal(f.calls.some(call=>call[0]==='write'),false);
});

test('Shift+left/right use ordinary arrows in the main buffer and preserve alternate-screen shortcuts',async()=>{
  const f=fixture();f.opening.resolve();await f.runtime.start;
  const event=key=>({type:'keydown',key,shiftKey:true,altKey:false,ctrlKey:false,metaKey:false,isComposing:false,preventDefault(){this.prevented=true},stopPropagation(){}});
  for(const [key,sequence] of [['ArrowLeft','\x1b[D'],['ArrowRight','\x1b[C']]){
    const press=event(key);assert.equal(f.runtime.terminal.keyHandler(press),false);
    assert.equal(press.prevented,true);assert.deepEqual(f.calls.at(-1),['write',sequence]);
  }
  f.runtime.terminal.buffer.active.type='alternate';
  assert.equal(f.runtime.terminal.keyHandler(event('ArrowLeft')),true);
  f.runtime.terminal.buffer.active.type='normal';
  assert.equal(f.runtime.terminal.keyHandler({...event('ArrowLeft'),ctrlKey:true}),true);
});
