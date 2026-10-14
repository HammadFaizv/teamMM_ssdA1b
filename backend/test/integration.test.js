import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {MongoClient} from 'mongodb';
import {loadConfig} from '../src/config.js';
import {createApplication} from '../src/server.js';
import {migratePostgres,migrateMongo} from '../scripts/migrate.js';
import {seedLinked} from '../scripts/seed-linked.js';
const enabled=Boolean(process.env.TEST_DATABASE_URL&&process.env.TEST_MONGODB_URI),required=process.env.REQUIRE_DB_TESTS==='1';
// `npm run test:full` sets REQUIRE_DB_TESTS so a missing database fails the run instead of silently skipping this suite.
test('real PostgreSQL + MongoDB API integration', {skip:enabled||required?false:'set TEST_DATABASE_URL and TEST_MONGODB_URI to run this suite (npm run test:full requires it)'}, async t=>{
 assert.ok(enabled,'TEST_DATABASE_URL and TEST_MONGODB_URI are required when REQUIRE_DB_TESTS=1');
 const name=`gigtask_test_${process.pid}_${Date.now()}`,admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 const mongoClient=new MongoClient(process.env.TEST_MONGODB_URI),mongo=mongoClient.db(name);
 await admin.query(`CREATE SCHEMA ${name}`);
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${name},pg_catalog -c timezone=UTC`});
 const config=loadConfig({CORS_ORIGIN:'http://localhost:5173'}),app=createApplication({config,connections:{pool,mongo,close:async()=>{}}});
 let base;
 async function request(path,{role='admin',id,method='GET',body,key,origin}={}){const res=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json','X-Demo-Role':role,...(id?{'X-Demo-Id':String(id)}:{}),...(key?{'Idempotency-Key':key}:{}),...(origin?{Origin:origin}:{})},...(body?{body:JSON.stringify(body)}:{})});return {...(res.status===204?{}:await res.json()),status:res.status,headers:res.headers};}
 async function fund(amount='10',key=crypto.randomUUID()){return request('contracts/fund',{role:'client',id:1,method:'POST',key,body:{freelancerId:3,budget:amount}});}
 try{
  await migratePostgres(pool);await migratePostgres(pool);await migrateMongo(mongo);await migrateMongo(mongo);await seedLinked({pool,mongo});await seedLinked({pool,mongo});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${app.server.address().port}`;
  await t.test('health, CORS and actor pagination',async()=>{assert.equal((await request('health')).status,200);assert.equal((await request('actors?role=client&limit=5&page=2')).data[0].id,6);assert.equal((await request('actors?role=client',{origin:'http://localhost:5173'})).headers.get('access-control-allow-origin'),'http://localhost:5173');assert.equal((await request('actors?role=client',{origin:'https://bad.example'})).status,403);assert.equal((await request('contracts',{method:'OPTIONS',origin:'http://localhost:5173'})).status,204);});
  await t.test('server pagination and ownership',async()=>{const r=await request('contracts?limit=2',{role:'client',id:1});assert.equal(r.data.length,2);assert.ok(r.data.every(c=>c.client_id===1));assert.equal((await request('clients/2',{role:'client',id:1})).status,403);assert.equal((await request('freelancers/2/portfolio',{role:'freelancer',id:3})).status,403);});
  await t.test('linked MongoDB data is idempotent and uses SQL freelancer IDs',async()=>{const p=await request('freelancers/3/portfolio');assert.equal(p.data.freelancer_id,3);assert.equal((await request('reviews/analytics?freelancerId=3')).total_reviews,5);assert.equal(await mongo.collection('Portfolios').countDocuments(),48);assert.equal(await mongo.collection('GigReviews').countDocuments(),240);});
  let first,second;
  await t.test('stored procedure funding, audit trigger, idempotent retry and rollback',async()=>{const before=(await request('clients/1')).data.escrow_balance,key=crypto.randomUUID();const [a,b]=await Promise.all([fund('12.50',key),fund('12.50',key)]);assert.equal(a.status,200);assert.equal(a.data.id,b.data.id);assert.equal(a.balanceAfter,before-12.5);assert.equal(a.audit.amount_changed,-12.5);assert.equal(a.audit.action_type,'ESCROW_HOLD');assert.equal((await fund('13',key)).status,409);assert.equal((await fund('999999')).status,409);assert.equal((await request('clients/1')).data.escrow_balance,before-12.5);first=a.data.id;second=(await fund()).data.id;});
  await t.test('database active-contract constraint and participant-only status changes',async()=>{const change=(id,status,role='client',actorId=1)=>request(`contracts/${id}/status`,{role,id:actorId,method:'PATCH',body:{status}});assert.equal((await change(first,'IN_PROGRESS')).status,200);const conflict=await change(second,'IN_PROGRESS');assert.equal(conflict.status,409);assert.match(conflict.error,/already has an in progress/);assert.equal((await change(first,'COMPLETED','admin')).status,403);assert.equal((await change(first,'COMPLETED','freelancer',3)).status,200);assert.equal((await change(second,'IN_PROGRESS')).status,200);assert.equal((await change(second,'FUNDED')).status,409);});
  await t.test('materialized view refresh and actual SQL window analytics',async()=>{const before=(await request('analytics/lifetime-earnings?freelancerId=3')).data[0].total;assert.equal((await request('analytics/lifetime-earnings/refresh',{method:'POST'})).status,200);const after=await request('analytics/lifetime-earnings?freelancerId=3');assert.equal(after.data[0].total,before+12.5);assert.ok(after.lastRefreshed);assert.ok((await request('analytics/revenue?freelancerId=3')).data.length);const r=await request('analytics/rankings?limit=2');assert.equal(r.data.length,2);assert.ok(r.total>2);});
  const nearby='workers/nearby?lat=17.45452&lng=78.35008';
  await t.test('geoNear returns current, fresh pings only; a newer far-away ping supersedes the old one',async()=>{
   const r=await request(nearby);assert.ok(r.data.length);assert.ok(r.data.every((f,i)=>f.is_available&&f.distance_meters<=5000&&(!i||f.distance_meters>=r.data[i-1].distance_meters)));assert.equal(new Set(r.data.map(f=>f.id)).size,r.data.length);
   const target=r.data[0],pings=mongo.collection('WorkerLocations');
   assert.equal((await request(`workers/${target.id}/location`,{role:'freelancer',id:target.id,method:'POST',body:{lat:0,lng:0}})).status,200);
   assert.ok(!(await request(nearby)).data.some(f=>f.id===target.id));
   assert.equal(await pings.countDocuments({freelancer_id:target.id,is_current:true}),1);assert.ok(await pings.countDocuments({freelancer_id:target.id})>=2,'ping history is kept');
   await pings.updateMany({},{$set:{created_at:new Date('2000-01-01')}});assert.equal((await request(nearby)).data.length,0);
  });
  await t.test('the database allows one current ping per worker and migration repairs and cleans up older data',async()=>{
   const pings=mongo.collection('WorkerLocations'),ping=(created_at,extra={})=>({freelancer_id:5,is_available:true,is_current:true,location:{type:'Point',coordinates:[78.35,17.45]},created_at,...extra});
   await pings.updateMany({freelancer_id:5},{$set:{is_current:false}});await pings.insertOne(ping(new Date()));
   await assert.rejects(pings.insertOne(ping(new Date())),e=>e.code===11000);
   // Older data: duplicate current pings, plus the indexes earlier revisions created.
   await pings.dropIndex('uq_workerlocations_current');await pings.createIndex({freelancer_id:1,created_at:-1,_id:-1},{name:'idx_worker_latest_ping'});
   const older=(await pings.insertOne(ping(new Date(Date.now()-60000)))).insertedId;
   await migrateMongo(mongo);
   assert.equal(await pings.countDocuments({freelancer_id:5,is_current:true}),1);assert.equal((await pings.findOne({_id:older})).is_current,false);
   const names=(await pings.indexes()).map(i=>i.name);assert.ok(names.includes('uq_workerlocations_current'));assert.ok(!names.includes('idx_worker_latest_ping'));
  });
  await t.test('new worker pings are permission checked and immediately discoverable',async()=>{
   assert.equal((await request('workers/3/location',{method:'POST',body:{lat:17.45452,lng:78.35008}})).status,403);
   const sent=await request('workers/3/location',{role:'freelancer',id:3,method:'POST',body:{lat:17.45452,lng:78.35008}});
   assert.equal(sent.status,200);
   assert.ok((await request('workers/nearby?lat=17.45452&lng=78.35008')).data.some(f=>f.id===3));
  });
  await t.test('fund_gig requires REPEATABLE READ; standalone entry point commits on success and rolls back on failure',async()=>{
   const client=await pool.connect();try{
    const balance=async()=>Number((await client.query('SELECT escrow_balance FROM clients WHERE id=1')).rows[0].escrow_balance),contracts=async()=>Number((await client.query('SELECT count(*) n FROM contracts WHERE client_id=1')).rows[0].n);
    await client.query('BEGIN');await assert.rejects(client.query('CALL fund_gig(1,3,1,NULL::integer)'),/REPEATABLE READ/);await client.query('ROLLBACK');
    const money=await balance(),count=await contracts();
    await client.query('CALL fund_gig(1,3,2.50)');assert.equal(await balance(),money-2.5);assert.equal(await contracts(),count+1);
    await assert.rejects(client.query('CALL fund_gig(1,3,99999999)'),e=>/Insufficient balance/.test(e.message));assert.equal(await balance(),money-2.5);assert.equal(await contracts(),count+1);
    await assert.rejects(client.query('CALL fund_gig(1,3,0)'),/greater than zero/);assert.equal(await balance(),money-2.5);
   }finally{client.release();}
  });
  await t.test('audit is append-only and budget/status constraints remain database enforced',async()=>{await assert.rejects(pool.query('UPDATE wallet_audit_logs SET amount_changed=0'),/append-only/);await assert.rejects(pool.query("INSERT INTO contracts(client_id,freelancer_id,budget,status,created_at) VALUES(1,3,-1,'FUNDED',now())"),/contracts_positive_budget/);assert.equal((await request('clients/1/audit?from=2026-02-30')).status,400);});
  await t.test('funding rejects bad input, wrong actors and unavailable or missing freelancers',async()=>{
   const available=(await pool.query('SELECT id FROM freelancers WHERE is_available ORDER BY id LIMIT 1')).rows[0].id,away=(await pool.query('SELECT id FROM freelancers WHERE NOT is_available ORDER BY id LIMIT 1')).rows[0].id;
   const post=(body,{role='client',id=3,key=crypto.randomUUID()}={})=>request('contracts/fund',{role,id,method:'POST',key,body});
   const before=(await pool.query('SELECT escrow_balance FROM clients WHERE id=3')).rows[0].escrow_balance,count=async()=>Number((await pool.query('SELECT count(*) n FROM contracts')).rows[0].n),contracts=await count();
   const unavailable=await post({freelancerId:away,budget:'5'});assert.equal(unavailable.status,409);assert.match(unavailable.error,/unavailable/i);
   assert.equal((await post({freelancerId:999999,budget:'5'})).status,404);
   assert.equal((await post({freelancerId:available,budget:'5'},{role:'freelancer',id:available})).status,403);assert.equal((await post({freelancerId:available,budget:'5'},{role:'admin'})).status,403);
   assert.equal((await request('contracts/fund',{role:'client',id:3,method:'POST',body:{freelancerId:available,budget:'5'}})).status,400);
   assert.equal((await post({freelancerId:available,budget:'5'},{key:'short'})).status,400);
   for(const budget of ['10000000','007',' 5 ','1,5','0.001',[5],{},true,null,'1e2','-5'])assert.equal((await post({freelancerId:available,budget})).status,400,`budget ${JSON.stringify(budget)}`);
   for(const freelancerId of [true,'3abc','0x10',1.5,0,-1,[3],null])assert.equal((await post({freelancerId,budget:'5'})).status,400,`freelancerId ${JSON.stringify(freelancerId)}`);
   assert.equal((await post({freelancerId:available,budget:'9999999.99'})).status,409,'the largest valid budget reaches the procedure and fails on balance');
   assert.equal((await pool.query('SELECT escrow_balance FROM clients WHERE id=3')).rows[0].escrow_balance,before);assert.equal(await count(),contracts);
  });
  await t.test('different keys cannot spend the same balance twice, and concurrent status changes apply once',async()=>{
   const available=(await pool.query("SELECT id FROM freelancers f WHERE is_available AND NOT EXISTS(SELECT 1 FROM contracts c WHERE c.freelancer_id=f.id AND c.status='IN_PROGRESS') ORDER BY id DESC LIMIT 1")).rows[0].id;
   await pool.query('UPDATE clients SET escrow_balance=100 WHERE id=2');
   const spend=()=>request('contracts/fund',{role:'client',id:2,method:'POST',key:crypto.randomUUID(),body:{freelancerId:available,budget:'70'}});
   const results=await Promise.all([spend(),spend(),spend()]);
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409,409]);assert.ok(results.filter(r=>r.status===409).every(r=>/Insufficient balance|same moment/.test(r.error)));
   assert.equal((await pool.query('SELECT escrow_balance FROM clients WHERE id=2')).rows[0].escrow_balance,'30.00');
   assert.equal(Number((await pool.query('SELECT count(*) n FROM contracts WHERE client_id=2 AND budget=70')).rows[0].n),1);
   const contract=results.find(r=>r.status===200).data.id,start=()=>request(`contracts/${contract}/status`,{role:'client',id:2,method:'PATCH',body:{status:'IN_PROGRESS'}});
   assert.deepEqual((await Promise.all([start(),start()])).map(r=>r.status).sort(),[200,409]);
  });
  await t.test('audit trigger: unchanged balance logs nothing, credits log a release, each row is logged once',async()=>{
   const logs=async()=>Number((await pool.query('SELECT count(*) n FROM wallet_audit_logs')).rows[0].n),n=await logs();
   await pool.query('UPDATE clients SET escrow_balance=escrow_balance WHERE id=1');assert.equal(await logs(),n);
   await pool.query('UPDATE clients SET name=name WHERE id=1');assert.equal(await logs(),n);
   await pool.query('UPDATE clients SET escrow_balance=escrow_balance+5 WHERE id=1');const credit=(await pool.query('SELECT * FROM wallet_audit_logs ORDER BY id DESC LIMIT 1')).rows[0];assert.equal(credit.action_type,'ESCROW_RELEASE');assert.equal(Number(credit.amount_changed),5);
   await pool.query('UPDATE clients SET escrow_balance=escrow_balance+1 WHERE id IN (1,2,3)');assert.equal(await logs(),n+4);
   await assert.rejects(pool.query('DELETE FROM wallet_audit_logs WHERE id=$1',[credit.id]),/append-only/);
  });
  await t.test('audit filters: one-sided, empty and out-of-range requests',async()=>{
   const audit=query=>request(`clients/1/audit?${query}`,{role:'client',id:1}),all=await audit('limit=100');assert.ok(all.total>=1);
   assert.equal((await audit('from=2000-01-01')).total,all.total);assert.equal((await audit('to=2100-01-01')).total,all.total);
   const none=await audit('from=2100-01-01');assert.equal(none.status,200);assert.equal(none.total,0);assert.deepEqual(none.data,[]);
   const beyond=await audit('page=999999');assert.equal(beyond.status,200);assert.deepEqual(beyond.data,[]);assert.equal(beyond.total,all.total);
   assert.equal((await audit('from=2026-10-14&to=2026-10-14')).status,200);
  });
  await t.test('pagination, search and identifier edge cases',async()=>{
   for(const q of ['page=0','limit=0','limit=101','limit=abc','page=1.5','page=-1','limit=','page=9007199254740993'])assert.equal((await request(`contracts?${q}`)).status,400,q);
   const far=await request('contracts?page=100000&limit=100');assert.equal(far.status,200);assert.deepEqual(far.data,[]);assert.ok(far.total>0);
   for(const q of ['%25','_','%25%25','a%5C'])assert.equal((await request(`freelancers?search=${q}`)).total,0,`search ${q} is literal text`);
   assert.ok((await request('freelancers?search=a')).total>0);
   for(const path of ['clients/0','clients/abc','clients/99999999999','freelancers/99999'])assert.ok([400,404].includes((await request(path)).status),path);
  });
  await t.test('coordinate boundaries and ping freshness limits',async()=>{
   for(const q of ['lat=90&lng=180','lat=-90&lng=-180','lat=0&lng=0','lat=1e1&lng=1e1','lat=+17.4&lng=78'])assert.equal((await request(`workers/nearby?${q}`)).status,200,q);
   for(const q of ['lat=90.0001&lng=0','lat=0&lng=180.1','lat=0x10&lng=0','lat=abc&lng=0','lat=&lng=0','lat=Infinity&lng=0','lat=1,5&lng=0'])assert.equal((await request(`workers/nearby?${q}`)).status,400,q);
   const origin={lat:17.45452,lng:78.35008},metersPerDegree=111195,pings=mongo.collection('WorkerLocations');
   const send=(id,north)=>request(`workers/${id}/location`,{role:'freelancer',id,method:'POST',body:{lat:origin.lat+north/metersPerDegree,lng:origin.lng}});
   const worker=(await pool.query('SELECT id FROM freelancers WHERE is_available ORDER BY id DESC LIMIT 1')).rows[0].id,found=async()=>(await request(nearby)).data.some(f=>f.id===worker);
   await send(worker,4980);assert.ok(await found(),'a worker 4.98 km away is inside the radius');
   await send(worker,5020);assert.ok(!await found(),'a worker 5.02 km away is outside the radius');
   const aged=async seconds=>{await pings.updateMany({freelancer_id:worker,is_current:true},{$set:{created_at:new Date(Date.now()-seconds*1000)}});return found();};
   await send(worker,100);assert.ok(await aged(7190),'a ping just under two hours old is still fresh');assert.ok(!await aged(7210),'a ping just over two hours old is not');
   await send(worker,100);assert.ok(await found());await pool.query('UPDATE freelancers SET is_available=false WHERE id=$1',[worker]);assert.ok(!await found(),'PostgreSQL availability overrides the ping');await pool.query('UPDATE freelancers SET is_available=true WHERE id=$1',[worker]);
  });
  await t.test('review analytics for a freelancer without reviews',async()=>{
   await mongo.collection('GigReviews').deleteMany({freelancer_id:4});
   const r=await request('reviews/analytics?freelancerId=4');assert.equal(r.status,200);assert.equal(r.total_reviews,0);assert.equal(r.average_rating,null);assert.deepEqual(r.top_skill_tags,[]);assert.equal(r.rating_distribution.length,5);assert.ok(r.rating_distribution.every(b=>b.review_count===0));
   const list=await request('reviews?freelancerId=4');assert.equal(list.total,0);assert.deepEqual(list.data,[]);
  });
  await t.test('unsupported methods, unknown paths, malformed and oversized bodies',async()=>{
   const raw=(method,path,{body,role='admin'}={})=>fetch(`${base}/api/${path}`,{method,headers:{'Content-Type':'application/json','X-Demo-Role':role},...(body===undefined?{}:{body})});
   assert.equal((await raw('GET','nothing-here')).status,404);assert.equal((await raw('DELETE','contracts/1')).status,405);assert.equal((await raw('POST','nothing-here',{body:'{}'})).status,405);
   assert.equal((await raw('POST','contracts/fund',{body:'{not json',role:'client'})).status,401,'the actor is checked before the body');
   const client=(body)=>fetch(`${base}/api/contracts/fund`,{method:'POST',headers:{'Content-Type':'application/json','X-Demo-Role':'client','X-Demo-Id':'3'},body});
   assert.equal((await client('{not json')).status,400);assert.equal((await client('[1]')).status,400);assert.equal((await client('"text"')).status,400);
   const padded=length=>JSON.stringify({pad:'x'.repeat(length-10)});assert.equal(padded(16384).length,16384);
   assert.notEqual((await client(padded(16384))).status,413,'a body of exactly 16384 bytes is accepted');assert.equal((await client(padded(16385))).status,413);
   assert.equal((await raw('HEAD','health')).status,405,'HEAD is not an API method');
  });
  await t.test('old idempotency records are trimmed after a successful funding',async()=>{
   await pool.query("INSERT INTO api_funding_requests(request_key,actor_id,payload,response,created_at) VALUES('expired-key-0001',1,'{}','{}',now()-interval '3 days')");
   assert.equal((await fund('1')).status,200);
   for(let i=0;i<50;i++){if(!Number((await pool.query("SELECT count(*) n FROM api_funding_requests WHERE request_key='expired-key-0001'")).rows[0].n))return;await new Promise(r=>setTimeout(r,50));}
   assert.fail('the expired idempotency record was not removed');
  });
 }finally{if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));await pool.end();await mongo.dropDatabase();await mongoClient.close();await admin.query(`DROP SCHEMA ${name} CASCADE`);await admin.end();}
});
