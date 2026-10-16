import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/utils/processMemory.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {formatProcessMemory}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('uses decimal MB and GB without changing the measured footprint',()=>{
 assert.equal(formatProcessMemory(0),'0.0 MB');
 assert.equal(formatProcessMemory(471.7),'471.7 MB');
 assert.equal(formatProcessMemory(999.9),'999.9 MB');
 assert.equal(formatProcessMemory(1000),'1.00 GB');
 assert.equal(formatProcessMemory(1487.8),'1.49 GB');
});
test('missing and invalid memory stays unavailable rather than zero',()=>{
 for(const value of [undefined,null,NaN,Infinity,-1])assert.equal(formatProcessMemory(value),'—');
});
