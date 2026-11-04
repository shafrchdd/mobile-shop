const DB_NAME="kerala_mobile_erp", DB_VERSION=1;
const STORES=["shop_settings","categories","brands","products","customers","suppliers","staff","financial_accounts","expense_categories","service_catalog","stock_lots","stock_movements","product_serials","sales","sale_items","sale_returns","purchases","purchase_items","payments","payment_allocations","recharge_platforms","recharge_operators","recharge_wallets","recharge_commission_rules","recharge_topups","recharge_wallet_transactions","recharge_transactions","recharge_agents","agent_collections","repair_jobs","repair_job_parts","repair_status_history","expenses","wages","accounts","journal_entries","journal_lines","reminders","audit_logs","app_settings","backup_history"];
let connection;
export function db(){
 if(connection)return connection;
 connection=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{const d=req.result;for(const name of STORES){if(!d.objectStoreNames.contains(name)){const s=d.createObjectStore(name,{keyPath:"id"});s.createIndex("createdAt","createdAt");}}};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 return connection;
}
export async function add(store,value){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(store,"readwrite");tx.objectStore(store).add(value);tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error);});}
export async function put(store,value){const d=await db();return new Promise((res,rej)=>{const tx=d.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=()=>res(value);tx.onerror=()=>rej(tx.error);});}
export async function all(store){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function count(store){const d=await db();return new Promise((res,rej)=>{const r=d.transaction(store).objectStore(store).count();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function exportAll(){const d=await db();const names=[...d.objectStoreNames];const tx=d.transaction(names,"readonly");const out={schemaVersion:DB_VERSION,exportedAt:new Date().toISOString(),data:{}};await Promise.all(names.map(n=>new Promise((res,rej)=>{const r=tx.objectStore(n).getAll();r.onsuccess=()=>{out.data[n]=r.result;res()};r.onerror=()=>rej(r.error)})));return out;}
export async function restoreAll(payload){if(!payload?.data||!payload.schemaVersion)throw Error("Invalid backup file");const d=await db();const names=Object.keys(payload.data).filter(n=>d.objectStoreNames.contains(n));const tx=d.transaction(names,"readwrite");for(const n of names){const s=tx.objectStore(n);s.clear();for(const row of payload.data[n])s.put(row);}return new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);});}
export const uid=()=>crypto.randomUUID();
