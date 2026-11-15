import makeWASocket, { BufferJSON, initAuthCreds, proto, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { db,encrypt,decrypt } from './store.js';
const clients=new Map();
const logger=pino({level:'silent'});
function authState(user){
 const read=key=>{const row=db.prepare('SELECT value FROM auth WHERE user=? AND key=?').get(user,key);return row?JSON.parse(decrypt(row.value),BufferJSON.reviver):null;};
 const write=(key,value)=>{if(value==null)db.prepare('DELETE FROM auth WHERE user=? AND key=?').run(user,key);else db.prepare('INSERT OR REPLACE INTO auth VALUES(?,?,?)').run(user,key,encrypt(JSON.stringify(value,BufferJSON.replacer)));};
 const creds=read('creds') || initAuthCreds();
 return {state:{creds,keys:{get:async(type,ids)=>Object.fromEntries(ids.map(id=>{let v=read(`${type}-${id}`);if(type==='app-state-sync-key' && v)v=proto.Message.AppStateSyncKeyData.fromObject(v);return [id,v];})),set:async data=>{db.exec('BEGIN');try{for(const [type,items] of Object.entries(data))for(const [id,value] of Object.entries(items))write(`${type}-${id}`,value);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}},save:()=>write('creds',creds)};
}
export function status(user){const c=clients.get(user);return {state:c?.state || 'disconnected',qr:c?.qr || null,phone:c?.socket?.user?.id?.split(':')[0] || null};}
export async function connect(user){
 if(clients.has(user))return status(user);
 const client={state:'connecting',qr:null,socket:null,retries:0,stopped:false};clients.set(user,client);
 const open=async()=>{
  if(client.stopped)return;
  const {state,save}=authState(user);
  const socket=makeWASocket({auth:state,logger,markOnlineOnConnect:false,syncFullHistory:false});client.socket=socket;
  socket.ev.on('creds.update',save);
  socket.ev.on('connection.update',async update=>{
   if(client.stopped || client.socket!==socket)return;
   if(update.qr){const qr=await QRCode.toDataURL(update.qr);if(client.socket===socket && !client.stopped){client.qr=qr;client.state='qr';}}
   if(update.connection==='open'){client.state='connected';client.qr=null;client.retries=0;}
   if(update.connection==='close'){
    client.qr=null;const code=update.lastDisconnect?.error?.output?.statusCode;
    if(code===DisconnectReason.loggedOut){client.state='logged_out';client.stopped=true;db.prepare('DELETE FROM auth WHERE user=?').run(user);clients.delete(user);}
    else if(client.retries++<6){client.state='reconnecting';client.timer=setTimeout(()=>open().catch(()=>{client.state='error';}),Math.min(30000,1000*2**client.retries));}
    else {client.state='error';clients.delete(user);}
   }
  });
 };try{await open();}catch(e){clients.delete(user);throw e;}return status(user);
}
export async function disconnect(user){const c=clients.get(user);if(c){c.stopped=true;clearTimeout(c.timer);try{await c.socket?.logout();}catch{}c.socket?.end(undefined);clients.delete(user);}db.prepare('DELETE FROM auth WHERE user=?').run(user);}
export async function send(user,phone,text){const c=clients.get(user);if(c?.state!=='connected')throw new Error('WhatsApp disconnected');const jid=`${phone}@s.whatsapp.net`;const [found]=await c.socket.onWhatsApp(jid);if(!found?.exists)throw new Error('Nomor tidak terdaftar di WhatsApp');return c.socket.sendMessage(jid,{text});}
export function closeAll(){for(const c of clients.values()){c.stopped=true;clearTimeout(c.timer);c.socket?.end(undefined);}}
