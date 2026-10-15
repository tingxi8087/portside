import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source=readFileSync(new URL('../src/utils/shortcutTransfer.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {parseShortcutFile:parse,serializeShortcuts:serialize,planShortcutImport:plan}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const entry={name:'启动',command:'echo "你好"\nprintf done\n',directory:'~/测试 project',tag:'开发'};
const file=items=>JSON.stringify({format:'portside-shortcuts',version:1,shortcuts:items});

test('round trip preserves multiline commands, Unicode paths and single tags, excludes IDs and runtime state',()=>{
 const text=serialize([{...entry,id:'old-id',running:true,password:'excluded'}]);
 assert.deepEqual(parse(text),[entry]);
 assert.equal(/old-id|running|password/.test(text),false);
 assert.deepEqual(parse('\uFEFF'+text),[entry]);
});
test('rejects wrong format, unsupported version, empty or malformed entries without partially importing',()=>{
 for(const text of ['broken','null','[]','{}',JSON.stringify({format:'portside-shortcuts',version:2,shortcuts:[entry]}),file([]),file([entry,{...entry,command:' '}]),file([{...entry,tag:['dev']}]),file([{...entry,directory:12}])])assert.throws(()=>parse(text));
});
test('size and count bounds reject oversized input',()=>{
 assert.throws(()=>parse(' '.repeat(4*1024*1024+1)),/4 MB/);
 assert.throws(()=>parse(file(Array.from({length:1001},()=>entry))),/1000/);
});
test('exact duplicates in existing data and incoming file are skipped',()=>{
 assert.equal(plan([entry],[entry])[0].duplicate,true);
 assert.deepEqual(plan([],[entry,entry]).map(r=>r.duplicate),[false,true]);
});
test('name collisions never overwrite and reserve unique suffixes across the batch',()=>{
 const existing=[entry,{...entry,name:'启动 副本'}];
 const result=plan(existing,[{...entry,command:'one'},{...entry,command:'two'}]);
 assert.deepEqual(result.map(r=>r.item.name),['启动 副本 2','启动 副本 3']);
 assert.deepEqual(existing,[entry,{...entry,name:'启动 副本'}]);
});
test('different directories or labels are distinct commands, untagged remains null',()=>{
 assert.equal(plan([entry],[{...entry,directory:'/srv/app'}])[0].duplicate,false);
 assert.equal(plan([entry],[{...entry,tag:null}])[0].duplicate,false);
 assert.equal(parse(file([{...entry,tag:'  '}]))[0].tag,null);
});
test('a later row matching a generated copy is skipped too',()=>{
 const result=plan([entry],[{...entry,command:'changed'},{...entry,name:'启动 副本',command:'changed'}]);
 assert.deepEqual(result.map(row=>row.duplicate),[false,true]);
});
