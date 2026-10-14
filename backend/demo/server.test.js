import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from './server.js';
import {openDatabase} from './database.js';

const {server,db}=createApplication({databasePath:':memory:'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const client={role:'client',id:1},admin={role:'admin'},freelancer={role:'freelancer',id:3};
async function request(path,{actor=admin,method='GET',body,key}={}){
 const headers={'Content-Type':'application/json'};
 if(actor){headers['X-Demo-Role']=actor.role;if(actor.id)headers['X-Demo-Id']=String(actor.id);}
 if(key)headers['Idempotency-Key']=key;
 const response=await fetch(base+'/api/'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,...await response.json()};
}
async function fund(budget='50.00',worker=3,key=crypto.randomUUID(),a=client){return request('contracts/fund',{actor:a,method:'POST',key,body:{freelancerId:worker,budget}});}
test.after(()=>new Promise(resolve=>server.close(()=>{db.close();resolve();})));

test('actor catalog is public, paginated, and excludes balances',async()=>{const r=await request('actors?role=client&limit=5&page=2',{actor:null});assert.equal(r.data.length,5);assert.equal(r.data[0].id,6);assert.deepEqual(Object.keys(r.data[0]),['id','name']);assert.equal((await request('clients',{actor:null})).status,401);assert.equal((await request('clients',{actor:{role:'client',id:999}})).status,401);});
test('lists apply server ownership and pagination',async()=>{const r=await request('contracts?limit=2',{actor:client});assert.equal(r.data.length,2);assert.ok(r.data.every(c=>c.client_id===1));const workers=await request('freelancers',{actor:freelancer});assert.equal(workers.total,1);assert.equal(workers.data[0].id,3);assert.equal((await request('clients?limit=1000')).status,400);assert.equal((await request('clients?search=Priya')).data.length,4);});
test('direct links and mutations enforce role and ownership',async()=>{for(const path of ['clients/2','clients/2/audit','contracts/2'])assert.equal((await request(path,{actor:client})).status,403);for(const path of ['freelancers/2','freelancers/2/portfolio','analytics/revenue?freelancerId=2','reviews/analytics?freelancerId=2','workers/nearby?lat=17&lng=78'])assert.equal((await request(path,{actor:freelancer})).status,403);assert.equal((await fund('1',3,crypto.randomUUID(),admin)).status,403);assert.equal((await fund('1',3,crypto.randomUUID(),freelancer)).status,403);});
test('funding atomically deducts balance, inserts contract and trigger audit',async()=>{const before=(await request('clients/1',{actor:client})).data.escrow_balance;const r=await fund();assert.equal(r.status,200);assert.equal(r.data.status,'FUNDED');assert.equal(r.balanceBefore,before);assert.equal(r.balanceAfter,before-50);assert.equal(r.audit.amount_changed,-50);assert.equal(r.audit.balance_after,r.balanceAfter);assert.equal(r.audit.action_type,'ESCROW_HOLD');assert.equal((await request('clients/1',{actor:client})).data.escrow_balance,before-50);});
test('funding failures have no partial side effects',async()=>{const before=db.prepare('SELECT balance_cents FROM clients WHERE id=1').get().balance_cents;const count=db.prepare('SELECT COUNT(*) n FROM contracts').get().n;for(const budget of ['0','-1','2.001','1e2','NaN','',null])assert.equal((await fund(budget)).status,400);assert.equal((await fund('999999')).status,409);assert.equal((await fund('10',1)).status,409);assert.equal((await fund('10',999)).status,404);const impersonation=await request('contracts/fund',{actor:client,method:'POST',key:crypto.randomUUID(),body:{clientId:2,freelancerId:3,budget:'10'}});assert.equal(impersonation.status,403);assert.equal(db.prepare('SELECT balance_cents FROM clients WHERE id=1').get().balance_cents,before);assert.equal(db.prepare('SELECT COUNT(*) n FROM contracts').get().n,count);});
test('idempotency reconciles a retry without a second deduction',async()=>{const key=crypto.randomUUID();const [a,b]=await Promise.all([fund('15',3,key),fund('15',3,key)]);assert.equal(a.status,200);assert.equal(b.data.id,a.data.id);assert.equal(b.audit.id,a.audit.id);assert.equal((await fund('16',3,key)).status,409);});
test('multiple funded contracts allowed, database rejects second active contract',async()=>{const first=await fund('10'),second=await fund('10');const change=(id,status,a=client)=>request(`contracts/${id}/status`,{actor:a,method:'PATCH',body:{status}});assert.equal((await change(first.data.id,'IN_PROGRESS')).status,200);const conflict=await change(second.data.id,'IN_PROGRESS');assert.equal(conflict.status,409);assert.match(conflict.error,/already has an in progress/);assert.equal((await request(`contracts/${second.data.id}`,{actor:client})).data.status,'FUNDED');assert.equal((await change(first.data.id,'COMPLETED',admin)).status,403);assert.equal((await change(first.data.id,'COMPLETED',{role:'client',id:2})).status,403);assert.equal((await change(first.data.id,'COMPLETED',freelancer)).status,200);assert.equal((await change(second.data.id,'IN_PROGRESS')).status,200);assert.equal((await change(second.data.id,'FUNDED')).status,409);});
test('database constraints cannot be bypassed by direct SQL',()=>{assert.throws(()=>db.prepare('UPDATE clients SET balance_cents=-1 WHERE id=1').run(),/CHECK/);assert.throws(()=>db.prepare("INSERT INTO contracts(client_id,freelancer_id,budget_cents,status,created_at) VALUES(1,3,100,'IN_PROGRESS','2026-10-12')").run(),/UNIQUE/);assert.throws(()=>db.prepare("UPDATE contracts SET status='FUNDED' WHERE status='COMPLETED'").run(),/Invalid status transition/);});
test('audit dates validate and balances reconcile',async()=>{assert.equal((await request('clients/1/audit?from=2026-02-30')).status,400);assert.equal((await request('clients/1/audit?from=2026-10-10&to=2026-10-01')).status,400);const r=await request('clients/1/audit?limit=100',{actor:client});for(let i=1;i<r.data.length;i++)assert.equal(r.data[i].balance_after,r.data[i-1].balance_after+r.data[i].amount_changed);assert.equal(r.data.at(-1).balance_after,(await request('clients/1',{actor:client})).data.escrow_balance);});
test('nearby results are fresh, unique, available and distance sorted',async()=>{assert.equal((await request('workers/nearby?lat=&lng=78')).status,400);assert.equal((await request('workers/nearby?lat=91&lng=78')).status,400);db.prepare('UPDATE worker_locations SET timestamp=? WHERE freelancer_id=3').run('2000-01-01T00:00:00Z');const r=await request('workers/nearby?lat=17.45452&lng=78.35008');assert.ok(r.data.length);assert.ok(!r.data.some(f=>f.id===3));assert.equal(new Set(r.data.map(f=>f.id)).size,r.data.length);r.data.forEach((f,i)=>{assert.ok(f.is_available);assert.ok(f.distance_meters<=5000);if(i)assert.ok(f.distance_meters>=r.data[i-1].distance_meters);});assert.equal((await request('workers/nearby?lat=0&lng=0')).data.length,0);});
test('selected-worker reviews and SQL analytics expose correct scope',async()=>{const r=await request('reviews/analytics?freelancerId=3');assert.equal(r.total_reviews,5);assert.equal(r.rating_distribution.reduce((s,r)=>s+r.review_count,0),5);const ranking=await request('analytics/rankings');for(let i=1;i<ranking.data.length;i++){const a=ranking.data[i-1],b=ranking.data[i];assert.ok(a.moving_average>=b.moving_average);assert.equal(b.revenue_rank,a.revenue_rank+(a.moving_average===b.moving_average?0:1));}const summary=await request('analytics/lifetime-earnings',{actor:freelancer});assert.equal(summary.data.length,1);assert.equal(summary.data[0].freelancer_id,3);assert.ok(summary.lastRefreshed);assert.ok((await request('analytics/revenue?freelancerId=3')).data.length);});
test('persistent data survives reopening the database',()=>{const dir=mkdtempSync(join(tmpdir(),'gigtask-test-')),path=join(dir,'db.sqlite');let app=openDatabase(path);app.db.prepare('UPDATE clients SET balance_cents=12345 WHERE id=1').run();app.db.close();app=openDatabase(path);assert.equal(app.db.prepare('SELECT balance_cents FROM clients WHERE id=1').get().balance_cents,12345);app.db.close();rmSync(dir,{recursive:true,force:true});});
test('frontend and health are served',async()=>{assert.match(await(await fetch(base)).text(),/actor-dialog/);assert.equal((await request('health',{actor:null})).mode,'demo-sqlite');assert.equal((await request('nothing')).status,404);});

test('worked-with selector is scoped to the client and excludes funded-only contracts',async()=>{
 const r=await request('freelancers?workedWith=true&limit=100',{actor:client});
 const expected=db.prepare("SELECT DISTINCT freelancer_id FROM contracts WHERE client_id=1 AND status IN ('IN_PROGRESS','COMPLETED')").all().map(r=>r.freelancer_id).sort((a,b)=>a-b);
 assert.deepEqual(r.data.map(f=>f.id).sort((a,b)=>a-b),expected);
 assert.equal((await request('freelancers?workedWith=true',{actor:admin})).status,403);
 assert.equal((await request('freelancers?workedWith=true',{actor:freelancer})).status,403);
 const other=await request('freelancers?workedWith=true&limit=100',{actor:{role:'client',id:2}});
 assert.ok(other.data.every(f=>db.prepare("SELECT 1 FROM contracts WHERE client_id=2 AND freelancer_id=? AND status IN ('IN_PROGRESS','COMPLETED')").get(f.id)));
});

test('client searches use names while admin searches also accept IDs',async()=>{
 const name=db.prepare('SELECT f.name FROM contracts c JOIN freelancers f ON f.id=c.freelancer_id WHERE c.client_id=1 LIMIT 1').get().name;
 const r=await request('contracts?search='+encodeURIComponent(name)+'&limit=100',{actor:client});
 assert.ok(r.data.length);
 assert.ok(r.data.every(c=>c.client_id===1&&c.freelancer_name.includes(name)));
 assert.equal((await request('freelancers?search=48',{actor:client})).total,0);
 assert.ok((await request('freelancers?search=48',{actor:admin})).data.some(f=>f.id===48));
 assert.ok((await request('contracts?search=1&limit=100',{actor:admin})).data.some(c=>c.id===1));
});
