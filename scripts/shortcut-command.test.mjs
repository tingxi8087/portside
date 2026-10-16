import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
const source=readFileSync(new URL('../src/utils/shortcutCommand.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {shortcutCommand}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('blank directory writes only the command to the existing session',()=>{
 assert.equal(shortcutCommand({directory:'  ',command:'echo hello\npwd'}),'echo hello\npwd\r');
});
test('explicit paths are literal, home expands, and failed cd suppresses the entire command',()=>{
 const root=mkdtempSync(join(tmpdir(),'portside-shortcut-command-'));
 try{
  const name="space ' dollar $(echo wrong)";const path=join(root,name);mkdirSync(path);
  const run=(directory,command='printf %s "$PWD"')=>spawnSync('/bin/zsh',['-f','-c',shortcutCommand({directory,command}).slice(0,-1)],{encoding:'utf8',env:{...process.env,HOME:root}});
  assert.equal(run(path).stdout,path);
  assert.equal(run(`~/${name}`).stdout,path);
  assert.equal(run('~').stdout,root);
  const failed=run(join(root,'missing'),"printf first\nprintf second");
  assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');
 }finally{rmSync(root,{recursive:true,force:true})}
});
