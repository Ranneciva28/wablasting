import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
export const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir, { recursive:true, mode:0o700 });
export const db = new DatabaseSync(resolve(dataDir,'app.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS auth(user TEXT,key TEXT,value TEXT,PRIMARY KEY(user,key));
CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id),name TEXT,phone TEXT,optin INTEGER DEFAULT 0,UNIQUE(user,phone));
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY,user TEXT REFERENCES users(id),name TEXT,message TEXT,status TEXT DEFAULT 'queued',created INTEGER);
CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,campaign TEXT REFERENCES campaigns(id),phone TEXT,name TEXT,status TEXT DEFAULT 'pending',error TEXT,waid TEXT);
`);
const secret=process.env.SESSION_ENCRYPTION_KEY;
if(!/^[a-f0-9]{64}$/i.test(secret || '')) throw new Error('SESSION_ENCRYPTION_KEY must be 64 hex characters');
const key=Buffer.from(secret,'hex');
export function encrypt(value){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key,iv);return seal(c,iv,value);}
function seal(c,iv,value){const body=Buffer.concat([c.update(value,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64');}
export function decrypt(value){const b=Buffer.from(value,'base64');const c=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}
