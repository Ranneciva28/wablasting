import { test } from 'node:test';import assert from 'node:assert/strict';import { spawn } from 'node:child_process';import { mkdtemp,rm } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join } from 'node:path';import { once } from 'node:events';
test('account isolation, CSRF, authentication and disconnected campaign guard',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wablasting-'));const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir,SESSION_ENCRYPTION_KEY:'ab'.repeat(32),REGISTRATION_CODE:'test-invite'},stdio:['ignore','pipe','pipe']});
 // Discover listening port through the structured startup line.
 let output='';const ready=new Promise((resolve,reject)=>{child.stdout.on('data',d=>{output+=d;const m=output.match(/ready on (\d+)/);if(m)resolve(Number(m[1]));});child.on('exit',()=>reject(Error('Server exited: '+output)));child.stderr.on('data',d=>{output+=d;});});
 let timer;try{const port=await Promise.race([ready,new Promise((_,r)=>timer=setTimeout(()=>r(Error(output)),20000))]);clearTimeout(timer);const base=`http://127.0.0.1:${port}/api`;
 const request=async(path,body,cookie,csrf=true)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-Requested-With':'wablasting'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 assert.equal((await request('/me')).status,401);
 assert.equal((await request('/auth/register',{email:'a@example.com',password:'long-password-123',code:'test-invite'},null,false)).status,403);
 const a=await request('/auth/register',{email:'a@example.com',password:'long-password-123',code:'test-invite'});assert.equal(a.status,200);
 const b=await request('/auth/register',{email:'b@example.com',password:'long-password-123',code:'test-invite'});assert.equal(b.status,200);
 assert.equal((await request('/contacts',{name:'Test',phone:'08123456789',optin:true},a.cookie)).status,200);
 assert.equal((await request('/contacts',null,b.cookie)).data.length,0);
 const contact=(await request('/contacts',null,a.cookie)).data[0];assert.equal(contact.phone,'628123456789');
 assert.equal((await request('/campaigns',{name:'Test',message:'Hello',contacts:[contact.id]},a.cookie)).status,400);
 await request('/logout',{},a.cookie);assert.equal((await request('/me',null,a.cookie)).status,401);
 }finally{clearTimeout(timer);child.kill('SIGTERM');await once(child,'exit');await rm(dir,{recursive:true,force:true});}
});
