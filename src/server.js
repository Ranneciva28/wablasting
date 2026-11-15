import express from 'express';
import helmet from 'helmet';
import { randomUUID,randomBytes,scryptSync,timingSafeEqual,createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './store.js';
import * as wa from './whatsapp.js';
import { phone,text,personalize } from './validation.js';
const app=express();app.disable('x-powered-by');app.use(helmet());app.use(express.json({limit:'256kb'}));
const hash=t=>createHash('sha256').update(t).digest('hex');
const secure=process.env.COOKIE_SECURE==='true';
const cookie=(token,age)=>`session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure?'; Secure':''}`;
const attempts=new Map();
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(!['GET','HEAD'].includes(req.method) && req.get('X-Requested-With')!=='wablasting')return res.status(403).json({error:'Invalid request origin'});next();});
app.post('/api/auth/:action',(req,res)=>{
 const action=req.params.action;if(!['login','register'].includes(action))return res.sendStatus(404);
 const ip=req.socket.remoteAddress;const now=Date.now();let bucket=attempts.get(ip);if(!bucket || bucket.until<now){bucket={count:0,until:now+900000};attempts.set(ip,bucket);}if(++bucket.count>20)return res.status(429).json({error:'Terlalu banyak percobaan. Coba 15 menit lagi.'});
 try{
 const email=text(req.body.email,200,'Email').toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Email tidak valid');
 const password=text(req.body.password,128,'Password');if(password.length<12)throw Error('Password minimal 12 karakter');
 let user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if(action==='register'){
  if(!process.env.REGISTRATION_CODE || req.body.code!==process.env.REGISTRATION_CODE)return res.status(403).json({error:'Kode undangan tidak valid'});
  if(user)throw Error('Email sudah terdaftar');
  const salt=randomBytes(16).toString('hex');user={id:randomUUID(),email,password:`${salt}:${scryptSync(password,salt,64).toString('hex')}`};db.prepare('INSERT INTO users VALUES(?,?,?)').run(user.id,email,user.password);
 }else{
  const [salt,expected]=(user?.password || 'dummy:'+ '0'.repeat(128)).split(':');const actual=scryptSync(password,salt,64);if(!timingSafeEqual(actual,Buffer.from(expected,'hex')) || !user)return res.status(401).json({error:'Email atau password salah'});
 }
 const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,now+86400000);res.setHeader('Set-Cookie',cookie(token,86400));res.json({email:user.email});
 }catch(e){res.status(400).json({error:e.message});}
});
app.use('/api',(req,res,next)=>{const token=req.headers.cookie?.match(/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/)?.[1];const row=token && db.prepare('SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user WHERE token=? AND expires>?').get(hash(token),Date.now());if(!row)return res.status(401).json({error:'Silakan login'});req.user=row;next();});
app.get('/api/me',(req,res)=>res.json(req.user));
app.post('/api/logout',(req,res)=>{const token=req.headers.cookie?.match(/session=([a-f0-9]{64})/)?.[1];if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));res.setHeader('Set-Cookie',cookie('',0));res.json({ok:true});});
app.get('/api/whatsapp',(req,res)=>res.json(wa.status(req.user.id)));
app.post('/api/whatsapp/connect',async(req,res)=>res.json(await wa.connect(req.user.id)));
app.post('/api/whatsapp/disconnect',async(req,res)=>{await wa.disconnect(req.user.id);res.json({ok:true});});
app.get('/api/contacts',(req,res)=>res.json(db.prepare('SELECT * FROM contacts WHERE user=? ORDER BY name').all(req.user.id)));
app.post('/api/contacts',(req,res)=>{const name=text(req.body.name,100,'Nama');const n=phone(req.body.phone);if(req.body.optin!==true)throw Error('Persetujuan penerima wajib dikonfirmasi');db.prepare('INSERT INTO contacts VALUES(?,?,?,?,1) ON CONFLICT(user,phone) DO UPDATE SET name=excluded.name,optin=1').run(randomUUID(),req.user.id,name,n);res.json({ok:true});});
app.delete('/api/contacts/:id',(req,res)=>{db.prepare('DELETE FROM contacts WHERE id=? AND user=?').run(req.params.id,req.user.id);res.json({ok:true});});
app.get('/api/campaigns',(req,res)=>res.json(db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM deliveries WHERE campaign=c.id) total,(SELECT COUNT(*) FROM deliveries WHERE campaign=c.id AND status='sent') sent,(SELECT COUNT(*) FROM deliveries WHERE campaign=c.id AND status='failed') failed FROM campaigns c WHERE user=? ORDER BY created DESC`).all(req.user.id)));
app.get('/api/campaigns/:id',(req,res)=>{const c=db.prepare('SELECT * FROM campaigns WHERE id=? AND user=?').get(req.params.id,req.user.id);if(!c)return res.sendStatus(404);res.json({...c,deliveries:db.prepare('SELECT * FROM deliveries WHERE campaign=?').all(c.id)});});
app.post('/api/campaigns',(req,res)=>{
 const name=text(req.body.name,100,'Nama campaign'),message=text(req.body.message,4000,'Pesan');
 if(wa.status(req.user.id).state!=='connected')throw Error('Hubungkan WhatsApp dahulu');
 if(!Array.isArray(req.body.contacts) || !req.body.contacts.length || req.body.contacts.length>100)throw Error('Pilih 1–100 kontak');
 if(db.prepare("SELECT id FROM campaigns WHERE user=? AND status IN ('queued','running','paused')").get(req.user.id))throw Error('Selesaikan atau batalkan campaign sebelumnya');
 const contacts=[...new Set(req.body.contacts)].map(id=>db.prepare('SELECT * FROM contacts WHERE id=? AND user=? AND optin=1').get(id,req.user.id));if(contacts.some(c=>!c))throw Error('Kontak tidak valid');
 const id=randomUUID();db.exec('BEGIN');try{db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?)').run(id,req.user.id,name,message,'queued',Date.now());for(const c of contacts)db.prepare('INSERT INTO deliveries(id,campaign,phone,name) VALUES(?,?,?,?)').run(randomUUID(),id,c.phone,c.name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}res.status(201).json({id});
});
app.post('/api/campaigns/:id/:action',(req,res)=>{const c=db.prepare('SELECT * FROM campaigns WHERE id=? AND user=?').get(req.params.id,req.user.id);if(!c)return res.sendStatus(404);const states={pause:'paused',resume:'queued',cancel:'cancelled'};const state=states[req.params.action];if(!state || ['completed','cancelled'].includes(c.status))throw Error('Perubahan status tidak valid');db.prepare('UPDATE campaigns SET status=? WHERE id=?').run(state,c.id);res.json({ok:true});});
app.use(express.static(fileURLToPath(new URL('../public',import.meta.url))));
app.use((err,req,res,next)=>{console.error(err.name);res.status(400).json({error:err.message || 'Request gagal'});});
// In-flight sends cannot safely be replayed after process failure.
db.exec("UPDATE deliveries SET status='unknown',error='Server restart saat pengiriman; periksa WhatsApp sebelum mengirim ulang' WHERE status='sending'; UPDATE campaigns SET status='paused' WHERE status IN ('running','queued');");
let busy=false,stopping=false;
async function tick(){
 if(busy || stopping)return;busy=true;
 try{
 const campaigns=db.prepare("SELECT * FROM campaigns WHERE status IN ('queued','running') ORDER BY created").all();
 for(const c of campaigns){
  if(stopping)break;
  if(wa.status(c.user).state!=='connected')continue;
  const d=db.prepare("SELECT * FROM deliveries WHERE campaign=? AND status='pending' LIMIT 1").get(c.id);
  if(!d){db.prepare("UPDATE campaigns SET status='completed' WHERE id=?").run(c.id);continue;}
  db.prepare("UPDATE campaigns SET status='running' WHERE id=?").run(c.id);
  // Contact deletion immediately suppresses pending sends.
  if(!db.prepare('SELECT id FROM contacts WHERE user=? AND phone=? AND optin=1').get(c.user,d.phone)){db.prepare("UPDATE deliveries SET status='skipped',error='Kontak dihapus' WHERE id=?").run(d.id);continue;}
  db.prepare("UPDATE deliveries SET status='sending' WHERE id=?").run(d.id);
  try{const result=await wa.send(c.user,d.phone,personalize(c.message,d.name));db.prepare("UPDATE deliveries SET status='sent',waid=? WHERE id=?").run(result?.key?.id || null,d.id);}catch{db.prepare("UPDATE deliveries SET status='unknown',error='Pengiriman tidak terkonfirmasi; periksa WhatsApp sebelum mengirim ulang' WHERE id=?").run(d.id);db.prepare("UPDATE campaigns SET status='paused' WHERE id=? AND status='running'").run(c.id);}
 }
 }finally{busy=false;}
}
const timer=setInterval(()=>tick().catch(e=>console.error(e.name)),5000);
const cleanup=setInterval(()=>{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());for(const [k,v] of attempts)if(v.until<Date.now())attempts.delete(k);},60000);
const server=app.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`wablasting ready on ${server.address().port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;clearInterval(timer);clearInterval(cleanup);wa.closeAll();server.close(()=>process.exit(0));setTimeout(()=>process.exit(1),10000).unref();});
