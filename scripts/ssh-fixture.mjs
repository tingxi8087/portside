#!/usr/bin/env node
/** Isolated localhost-only Linux SSH fixtures. Never discovers or removes unrelated containers. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, realpath, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ownerLabel='com.portside.ssh-fixture';
function command(binary,args,options={}){return new Promise((resolve,reject)=>{let stdout='',stderr='';const child=spawn(binary,args,{cwd:repository,env:process.env,...options,stdio:options.stdio??['ignore','pipe','pipe']});child.stdout?.on('data',data=>stdout+=data);child.stderr?.on('data',data=>stderr+=data);child.on('error',reject);child.on('exit',code=>code===0?resolve(stdout.trim()):reject(new Error(`${binary} exited ${code}: ${stderr.trim()}`)))})}
async function inspect(name){return JSON.parse(await command('docker',['inspect',name]))[0]}
async function persist(state){await writeFile(path.join(state.root,'state.json'),JSON.stringify(state,null,2),{mode:0o600})}
async function validateState(statePath){
 const actual=await realpath(statePath);const root=await realpath(path.dirname(actual));const temporary=await realpath(tmpdir());
 if(path.dirname(root)!==temporary||!path.basename(root).startsWith('portside-ssh-fixture-')||path.basename(actual)!=='state.json')throw new Error('Refusing a state file outside a dedicated temporary fixture directory');
 const state=JSON.parse(await readFile(actual,'utf8'));
 if(state.root!==root||!/^[a-f0-9-]{36}$/.test(state.nonce)||state.owner!=='Portside SSH self-test')throw new Error('Fixture ownership marker is invalid');
 return state;
}
async function stop(state){
 for(const container of state.containers??[]){
  let current;try{current=await inspect(container.id)}catch{continue}
  if(current.Id!==container.id||current.Config.Labels?.[ownerLabel]!==state.nonce||current.Name!==`/${container.name}`||!container.name.startsWith(`portside-ssh-${state.nonce}-`))throw new Error(`Refusing to remove unowned container ${container.name}`);
  await command('docker',['rm','-f',container.id]);
 }
 if(state.agentPid){const ps=spawnSync('ps',['-p',String(state.agentPid),'-o','command='],{encoding:'utf8'});const text=ps.stdout?.trim()??'';if(text.includes('ssh-agent')&&text.includes(path.join(state.root,'agent.sock')))process.kill(state.agentPid,'SIGTERM');}
 if(state.image){let image;try{image=JSON.parse(await command('docker',['image','inspect',state.image]))[0]}catch{}if(image?.Config.Labels?.[ownerLabel]===state.nonce)await command('docker',['image','rm',state.image]);}
 // Root was allocated by mkdtemp; containers and agent were verified before deletion.
 await rm(state.root,{recursive:true,force:true});
}
async function start(){
 const root=await mkdtemp(path.join(await realpath(tmpdir()),'portside-ssh-fixture-'));await chmod(root,0o700);
 const nonce=randomUUID();const state={owner:'Portside SSH self-test',nonce,root,containers:[],image:`portside-ssh-fixture:${nonce}`};await persist(state);
 try{
  await command('docker',['build','--label',`${ownerLabel}=${nonce}`,'-t',state.image,path.join(repository,'src-tauri/tests/ssh-fixture')],{stdio:'inherit'});
  await command('ssh-keygen',['-q','-t','ed25519','-N','','-C','portside-fixture','-f',path.join(root,'id_ed25519')]);
  await writeFile(path.join(root,'id_encrypted'),await readFile(path.join(root,'id_ed25519')),{mode:0o600});await command('ssh-keygen',['-q','-p','-P','','-N','fixture-passphrase','-f',path.join(root,'id_encrypted')]);
  await writeFile(path.join(root,'sshd-no-sftp.conf'),'PasswordAuthentication yes\nPermitRootLogin no\nUsePAM no\nPerSourcePenalties no\n',{mode:0o600});
  for(const mode of ['sftp','no-sftp']){
   const name=`portside-ssh-${nonce}-${mode}`;const args=['run','-d','--label',`${ownerLabel}=${nonce}`,'--name',name,'-p','127.0.0.1::22'];
   if(mode==='no-sftp')args.push('--mount',`type=bind,source=${path.join(root,'sshd-no-sftp.conf')},target=/etc/ssh/sshd_no_sftp_config,readonly`);
   args.push(state.image);if(mode==='no-sftp')args.push('/usr/sbin/sshd','-D','-e','-f','/etc/ssh/sshd_no_sftp_config');
   const id=await command('docker',args);state.containers.push({name,id,mode});await persist(state);
   await command('docker',['exec',id,'mkdir','-p','/home/tester/.ssh']);await command('docker',['cp',path.join(root,'id_ed25519.pub'),`${id}:/home/tester/.ssh/authorized_keys`]);await command('docker',['exec',id,'chown','-R','tester:tester','/home/tester/.ssh']);await command('docker',['exec',id,'chmod','700','/home/tester/.ssh']);await command('docker',['exec',id,'chmod','600','/home/tester/.ssh/authorized_keys']);
   const actual=await inspect(id);const binding=actual.NetworkSettings.Ports['22/tcp']?.[0];if(binding?.HostIp!=='127.0.0.1')throw new Error('SSH fixture unexpectedly exposes a non-localhost port');state[mode==='sftp'?'sshPort':'noSftpPort']=Number(binding.HostPort);await persist(state);
   await command('ssh',['-i',path.join(root,'id_ed25519'),'-p',binding.HostPort,'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=accept-new','-o',`UserKnownHostsFile=${path.join(root,'known_hosts')}`,'tester@127.0.0.1','true']);
  }
  const agent=await command('ssh-agent',['-a',path.join(root,'agent.sock')]);state.agentPid=Number(agent.match(/SSH_AGENT_PID=(\d+)/)?.[1]);if(!state.agentPid)throw new Error('Could not identify dedicated SSH agent');await persist(state);
  state.environment={PORTSIDE_SSH_FIXTURE_ROOT:root,PORTSIDE_SSH_FIXTURE_PORT:String(state.sshPort),PORTSIDE_SSH_NO_SFTP_PORT:String(state.noSftpPort),SSH_AUTH_SOCK:path.join(root,'agent.sock')};
  await command('ssh-add',[path.join(root,'id_ed25519')],{env:{...process.env,...state.environment}});await persist(state);
  console.log(JSON.stringify({state:path.join(root,'state.json'),ssh:`127.0.0.1:${state.sshPort}`,withoutSftp:`127.0.0.1:${state.noSftpPort}`,user:'tester',password:'fixture-password',environment:state.environment},null,2));return state;
 }catch(error){await stop(state).catch(cleanup=>console.error('Cleanup requires attention:',cleanup.message));throw error}
}
const [mode,statePath]=process.argv.slice(2);
try{
 if(mode==='start')await start();
 else if(mode==='stop'){if(!statePath)throw new Error('Usage: node scripts/ssh-fixture.mjs stop /tmp/portside-ssh-fixture-.../state.json');await stop(await validateState(statePath));console.log('Removed only the named fixture containers, agent, image and temporary directory.');}
 else if(mode==='test'){const state=await start();try{await command('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--lib','ssh::','--','--include-ignored','--nocapture'],{env:{...process.env,...state.environment},stdio:'inherit'})}finally{await stop(state)}}
 else throw new Error('Usage: node scripts/ssh-fixture.mjs start | test | stop <state.json>');
}catch(error){console.error(error.message);process.exitCode=1;}
