import {staticFiles} from '../../frontend/static-files.js';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {openDatabase} from './database.js';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function integer(value,fallback,min=1,max=1e9){if(value===null||value===undefined)return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)fail(400,'Enter a valid identifier or page number.');return n;}
const client=r=>({...r,escrow_balance:r.balance_cents/100,balance_cents:undefined});
const worker=r=>({...r,is_available:Boolean(r.is_available)});
const contract=r=>({...r,budget:r.budget_cents/100,budget_cents:undefined});
const audit=r=>({...r,amount_changed:r.amount_cents/100,balance_after:r.balance_after_cents/100,amount_cents:undefined,balance_after_cents:undefined});
export function createApplication({databasePath}={}) {
 const {db,transaction,refreshEarnings}=openDatabase(databasePath);
 const one=(sql,...args)=>db.prepare(sql).get(...args);
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 function actor(req){const role=req.headers['x-demo-role'];if(!['client','freelancer','admin'].includes(role))fail(401,'Choose a demo actor to continue.');if(role==='admin')return {role,id:null};const id=integer(req.headers['x-demo-id']);if(!id||!one(`SELECT id FROM ${role==='client'?'clients':'freelancers'} WHERE id=?`,id))fail(401,'Choose an existing demo actor.');return {role,id};}
 function ownClient(a,id){if(a.role!=='admin'&&(a.role!=='client'||a.id!==id))fail(403,'You can only view your own client balance and audit logs.');}
 function ownWorker(a,id){if(a.role==='freelancer'&&a.id!==id)fail(403,'Freelancers can only inspect their own profile and analytics.');}
 function ownedContract(a,r){if(a.role!=='admin'&&(a.role==='client'?r.client_id:r.freelancer_id)!==a.id)fail(403,'This contract belongs to another demo actor.');}
 function paginate(table,where,args,q,convert=r=>r,order='id'){
  const page=integer(q.get('page'),1),limit=integer(q.get('limit'),10,1,100);
  const total=one(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`, ...args).n;
  return {data:all(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,...args,limit,(page-1)*limit).map(convert),page,limit,total,totalPages:Math.ceil(total/limit)};
 }
 function get(path,q,a){
  if(path==='/api/overview'){
   if(a.role==='client')return {balance:client(one('SELECT * FROM clients WHERE id=?',a.id)).escrow_balance,contracts:one('SELECT COUNT(*) n FROM contracts WHERE client_id=?',a.id).n,freelancers:one('SELECT COUNT(*) n FROM freelancers').n};
   if(a.role==='freelancer')return {contracts:one('SELECT COUNT(*) n FROM contracts WHERE freelancer_id=?',a.id).n,completed:one("SELECT COUNT(*) n FROM contracts WHERE freelancer_id=? AND status='COMPLETED'",a.id).n};
   return {clients:one('SELECT COUNT(*) n FROM clients').n,freelancers:one('SELECT COUNT(*) n FROM freelancers').n,contracts:one('SELECT COUNT(*) n FROM contracts').n};
  }
  for(const [entity,convert] of Object.entries({clients:client,freelancers:worker,contracts:contract})){
   if(path===`/api/${entity}`){let where='1=1',args=[];
    if(entity==='clients'&&a.role!=='admin'){if(a.role!=='client')fail(403,'Client browsing is restricted to admin.');where+=' AND id=?';args.push(a.id);}
    if(entity==='freelancers'&&a.role==='freelancer'){where+=' AND id=?';args.push(a.id);}
    if(entity==='contracts'&&a.role!=='admin'){where+=` AND ${a.role==='client'?'client_id':'freelancer_id'}=?`;args.push(a.id);}
    if(q.get('search')){const participantSearch='EXISTS(SELECT 1 FROM freelancers search_worker WHERE search_worker.id=contracts.freelancer_id AND search_worker.name LIKE ?)';const clause=entity==='contracts'?(a.role==='admin'?`(CAST(id AS TEXT) LIKE ? OR ${participantSearch} OR EXISTS(SELECT 1 FROM clients search_client WHERE search_client.id=contracts.client_id AND search_client.name LIKE ?))`:participantSearch):(a.role==='admin'?'(name LIKE ? OR CAST(id AS TEXT) LIKE ?)':'name LIKE ?');where+=' AND '+clause;for(let n=0;n<(clause.match(/\?/g)||[]).length;n++)args.push(`%${q.get('search')}%`);} 
    if(entity==='contracts'&&q.get('status')){if(!['FUNDED','IN_PROGRESS','COMPLETED'].includes(q.get('status')))fail(400,'Unknown status.');where+=' AND status=?';args.push(q.get('status'));}
    if(entity==='contracts'&&q.get('clientId')){const id=integer(q.get('clientId'));ownClient(a,id);where+=' AND client_id=?';args.push(id);}
    if(entity==='freelancers'&&q.get('workedWith')==='true'){if(a.role!=='client')fail(403,'Work history filtering is for the selected client.');where+=" AND EXISTS(SELECT 1 FROM contracts history WHERE history.freelancer_id=freelancers.id AND history.client_id=? AND history.status IN ('IN_PROGRESS','COMPLETED'))";args.push(a.id);}
    if(entity==='freelancers'&&q.get('available')==='true')where+=' AND is_available=1';
    return paginate(entity,where,args,q,entity==='contracts'?r=>({...convert(r),client_name:one('SELECT name FROM clients WHERE id=?',r.client_id).name,freelancer_name:one('SELECT name FROM freelancers WHERE id=?',r.freelancer_id).name}):convert);
   }
   const match=path.match(new RegExp(`^/api/${entity}/(\\d+)$`));if(match){const id=Number(match[1]);const r=one(`SELECT * FROM ${entity} WHERE id=?`,id);if(!r)fail(404,'Record not found.');if(entity==='clients')ownClient(a,id);if(entity==='freelancers')ownWorker(a,id);if(entity==='contracts')ownedContract(a,r);return {data:convert(r)};}
  }
  let m=path.match(/^\/api\/clients\/(\d+)\/audit$/);
  if(m){const id=Number(m[1]);ownClient(a,id);if(!one('SELECT id FROM clients WHERE id=?',id))fail(404,'Client not found.');let where='client_id=?',args=[id];for(const key of ['from','to']){const v=q.get(key);if(!v)continue;if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'Enter a valid date in YYYY-MM-DD format.');where+=` AND substr(timestamp,1,10) ${key==='from'?'>=':'<='} ?`;args.push(v);}if(q.get('from')&&q.get('to')&&q.get('from')>q.get('to'))fail(400,'The end date must be after the start date.');return paginate('wallet_audit_logs',where,args,q,audit,'timestamp,id');}
  m=path.match(/^\/api\/freelancers\/(\d+)\/portfolio$/);if(m){const id=Number(m[1]);ownWorker(a,id);if(!one('SELECT id FROM freelancers WHERE id=?',id))fail(404,'Freelancer not found.');const p=one('SELECT document FROM portfolios WHERE freelancer_id=?',id);return {data:p?JSON.parse(p.document):null};}
  if(path==='/api/analytics/lifetime-earnings'){const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:1);ownWorker(a,id);if(!one('SELECT id FROM freelancers WHERE id=?',id))fail(404,'Freelancer not found.');const rows=all(`SELECT f.id freelancer_id,f.name,s.completed,s.total_cents/100.0 total FROM earnings_snapshot s JOIN freelancers f ON f.id=s.freelancer_id ${id?'WHERE f.id=?':''} ORDER BY total DESC`,...(id?[id]:[]));return {data:rows,lastRefreshed:one("SELECT value FROM metadata WHERE key='last_refreshed'").value};}
  if(path==='/api/analytics/revenue'||path==='/api/analytics/rankings'){
   const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:1);ownWorker(a,id);if(!one('SELECT id FROM freelancers WHERE id=?',id))fail(404,'Freelancer not found.');
   // Match inherited semantics: creation date attribution; days with recorded revenue only.
   const cte=`WITH daily AS (SELECT freelancer_id,substr(created_at,1,10) date,SUM(budget_cents)/100.0 revenue FROM contracts WHERE status='COMPLETED' GROUP BY freelancer_id,date), rolling AS (SELECT *,AVG(revenue) OVER(PARTITION BY freelancer_id ORDER BY julianday(date) RANGE BETWEEN 6 PRECEDING AND CURRENT ROW) moving_average FROM daily)`;
   if(path.endsWith('/revenue'))return {data:all(`${cte} SELECT date,revenue,moving_average FROM rolling WHERE freelancer_id=? ORDER BY date`,id),measure:'Average daily revenue over recorded revenue days within seven calendar days, attributed to contract creation date.'};
   const rankedSQL=`${cte}, latest AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY freelancer_id ORDER BY date DESC) rn FROM rolling), ranked AS (SELECT freelancer_id,date,moving_average,DENSE_RANK() OVER(ORDER BY moving_average DESC) revenue_rank FROM latest WHERE rn=1) SELECT r.*,f.name FROM ranked r JOIN freelancers f ON f.id=r.freelancer_id ${a.role==='freelancer'?'WHERE r.freelancer_id=?':''}`;
   const args=a.role==='freelancer'?[a.id]:[],page=integer(q.get('page'),1),limit=integer(q.get('limit'),10,1,100);
   const total=one(`SELECT COUNT(*) n FROM (${rankedSQL})`,...args).n;
   return {data:all(`${rankedSQL} ORDER BY revenue_rank,freelancer_id LIMIT ? OFFSET ?`,...args,limit,(page-1)*limit),page,limit,total,totalPages:Math.ceil(total/limit),measure:'Latest seven-day moving-average revenue (recorded days only), all completed-contract history.'};
  }
  if(path==='/api/workers/nearby'){
   if(a.role==='freelancer')fail(403,'Worker discovery is available to clients and admin.');
   if(!q.get('lat')?.trim()||!q.get('lng')?.trim())fail(400,'Choose a job-site latitude and longitude.');const lat=Number(q.get('lat')),lng=Number(q.get('lng'));
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail(400,'Latitude must be -90 to 90 and longitude -180 to 180.');
   const rad=d=>d*Math.PI/180;const rows=all('SELECT f.*,l.latitude,l.longitude,l.timestamp location_updated_at FROM worker_locations l JOIN freelancers f ON f.id=l.freelancer_id WHERE f.is_available=1 AND l.timestamp>=?',new Date(Date.now()-7200000).toISOString());
   return {data:rows.map(worker).map(f=>{const x=Math.min(1,Math.sin(rad(f.latitude-lat)/2)**2+Math.cos(rad(lat))*Math.cos(rad(f.latitude))*Math.sin(rad(f.longitude-lng)/2)**2);return {...f,distance_meters:6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))};}).filter(r=>r.distance_meters<=5000).sort((a,b)=>a.distance_meters-b.distance_meters).slice(0,20)};
  }
  if(path==='/api/reviews/analytics'){
   const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:undefined);if(id)ownWorker(a,id);if(id&&!one('SELECT id FROM freelancers WHERE id=?',id))fail(404,'Freelancer not found.');
   const where=id?'WHERE freelancer_id=?':'',args=id?[id]:[];
   const summary=one(`SELECT COUNT(*) total_reviews,AVG(rating) average_rating FROM reviews ${where}`,...args);
   const distribution=all(`SELECT rating,COUNT(*) review_count FROM reviews ${where} GROUP BY rating`,...args);
   const tags=all(`SELECT j.value skill_tag,COUNT(*) tag_count FROM reviews r,json_each(r.skill_tags) j ${id?'WHERE r.freelancer_id=?':''} GROUP BY j.value ORDER BY tag_count DESC,skill_tag LIMIT 10`,...args);
   return {rating_distribution:[1,2,3,4,5].map(rating=>({rating,review_count:distribution.find(r=>r.rating===rating)?.review_count||0})),top_skill_tags:tags,...summary,scope:id?`Freelancer #${id}`:'Whole platform'};
  }
  if(path==='/api/reviews'){const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:undefined);if(id)ownWorker(a,id);return paginate('reviews',id?'freelancer_id=?':'1=1',id?[id]:[],q,r=>({...r,skill_tags:JSON.parse(r.skill_tags)}),'created_at DESC,id DESC');}
  fail(404,'Endpoint not found.');
 }
 function mutate(path,method,body,a,req){
  if(path==='/api/analytics/lifetime-earnings/refresh'&&method==='POST'){transaction(refreshEarnings);return {lastRefreshed:one("SELECT value FROM metadata WHERE key='last_refreshed'").value};}
  if(path==='/api/contracts/fund'&&method==='POST'){
   if(a.role!=='client')fail(403,'Only a client can fund a gig.');
   if(body.clientId!==undefined&&Number(body.clientId)!==a.id)fail(403,'Funding must use the selected client.');
   const freelancerId=integer(body.freelancerId);if(!freelancerId)fail(400,'Choose a freelancer before funding.');
   if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(body.budget)))fail(400,'Enter a valid budget with up to two decimal places.');
   const cents=Math.round(Number(body.budget)*100);if(cents<=0)fail(400,'Budget must be greater than zero.');
   const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[\w-]{8,100}$/.test(key))fail(400,'A valid idempotency key is required.');
   const payload=JSON.stringify({freelancerId,cents});
   return transaction(()=>{
    const prior=one('SELECT * FROM funding_requests WHERE request_key=?',key);if(prior){if(prior.actor_id!==a.id||prior.payload!==payload)fail(409,'This request key was used with different funding details.');return JSON.parse(prior.response);}
    const f=one('SELECT * FROM freelancers WHERE id=?',freelancerId);if(!f)fail(404,'Freelancer not found.');if(!f.is_available)fail(409,'Worker unavailable. Choose an available freelancer.');
    const c=one('SELECT * FROM clients WHERE id=?',a.id);if(c.balance_cents<cents)fail(409,`Insufficient balance. Available balance is ${(c.balance_cents/100).toFixed(2)} INR.`);
    db.prepare('UPDATE clients SET balance_cents=balance_cents-? WHERE id=?').run(cents,a.id);
    const created=db.prepare("INSERT INTO contracts(client_id,freelancer_id,budget_cents,status,created_at) VALUES(?,?,?,'FUNDED',?)").run(a.id,freelancerId,cents,new Date().toISOString());
    const result={data:contract(one('SELECT * FROM contracts WHERE id=?',Number(created.lastInsertRowid))),balanceBefore:c.balance_cents/100,balanceAfter:(c.balance_cents-cents)/100,audit:audit(one('SELECT * FROM wallet_audit_logs WHERE client_id=? ORDER BY id DESC LIMIT 1',a.id))};
    db.prepare('INSERT INTO funding_requests VALUES(?,?,?,?)').run(key,a.id,payload,JSON.stringify(result));return result;
   });
  }
  const m=path.match(/^\/api\/contracts\/(\d+)\/status$/);
  if(m&&method==='PATCH'){
   if(a.role==='admin')fail(403,'Admin is read only.');
   return transaction(()=>{const c=one('SELECT * FROM contracts WHERE id=?',Number(m[1]));if(!c)fail(404,'Contract not found.');ownedContract(a,c);const expected={FUNDED:'IN_PROGRESS',IN_PROGRESS:'COMPLETED'}[c.status];if(body.status!==expected||!expected)fail(409,'Only forward status transitions are allowed. Reload the contract and try again.');
    try{db.prepare('UPDATE contracts SET status=? WHERE id=?').run(body.status,c.id);}catch(e){if(e.message.includes('UNIQUE constraint'))fail(409,'This freelancer already has an in progress contract. Complete it before starting another.');throw e;}
    refreshEarnings();return {data:contract(one('SELECT * FROM contracts WHERE id=?',c.id))};
   });
  }
  fail(405,'This action is not supported.');
 }
 const server=http.createServer(async(req,res)=>{try{
  const origin=req.headers.origin;const allowedOrigins=(process.env.CORS_ORIGIN||'http://localhost:5173,http://127.0.0.1:5173').split(',');if(origin&&allowedOrigins.includes(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Demo-Role,X-Demo-Id,Idempotency-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');}if(req.method==='OPTIONS'){res.writeHead(origin&&!allowedOrigins.includes(origin)?403:204);res.end();return;}const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
   if(req.method==='GET'&&url.pathname==='/api/health'){res.end(JSON.stringify({status:'ok',mode:'demo-sqlite'}));return;}
   if(req.method==='GET'&&url.pathname==='/api/actors'){const role=url.searchParams.get('role');if(!['client','freelancer'].includes(role))fail(400,'Choose client or freelancer.');const table=role==='client'?'clients':'freelancers';const q=url.searchParams;const search=q.get('search')||'';res.end(JSON.stringify(paginate(table,'name LIKE ?',[`%${search}%`],q,r=>({id:r.id,name:r.name}))));return;}
   const a=actor(req);let result;
   if(req.method==='GET')result=get(url.pathname,url.searchParams,a);
   else{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)fail(413,'Request is too large.');}let body;try{body=JSON.parse(raw||'{}');}catch{fail(400,'Request must contain valid JSON.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Request must contain an object.');result=mutate(url.pathname,req.method,body,a,req);}
   res.end(JSON.stringify({...result,mode:'demo-sqlite'}));return;
  }
  if(req.method!=='GET')fail(405,'Method not allowed.');
  if(url.pathname==='/config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.GIGTASK_CONFIG = { apiBaseUrl: "/api" };');return;}const file=Object.hasOwn(staticFiles,url.pathname)?staticFiles[url.pathname]:null;if(!file)fail(404,'Page not found.');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(new URL('../../frontend/'+file,import.meta.url)));
 }catch(e){if(!e.status)console.error(e);res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'The server could not complete this action. Please retry.'}));}});
 return {server,db};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const {server}=createApplication();server.listen(Number(process.env.PORT)||3000,'127.0.0.1',()=>console.log('GigTask: http://localhost:3000 · persistent SQLite demo'));}
