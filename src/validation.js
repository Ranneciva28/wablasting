export function phone(value){const n=String(value || '').replace(/[\s()+-]/g,'').replace(/^0/,'62');if(!/^[1-9]\d{7,14}$/.test(n))throw new Error('Nomor harus memakai kode negara, contoh 628123456789');return n;}
export function text(value,max,label){if(typeof value!=='string' || !value.trim() || value.length>max)throw new Error(`${label} wajib diisi, maksimal ${max} karakter`);return value.trim();}
export const personalize=(message,name)=>message.replaceAll('{{nama}}',()=>name);
