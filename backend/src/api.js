import {fail,integer,pageQuery,budget,dates,coordinates,ownClient,ownWorker,ownedContract} from './validation.js';
import {reviewFacet,nearbyPipeline,freelancerFilter} from './mongo-pipelines.js';
const like=text=>`%${text.replace(/[\\%_]/g,'\\$&')}%`;
const numeric=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,['escrow_balance','budget','latitude','longitude','amount_changed','balance_after','completed','total','revenue','moving_average','revenue_rank','lifetime_completed_contracts','lifetime_total_earnings'].includes(key)&&value!==null?Number(value):value]));
const worker=row=>({...numeric(row),skill:row.skill||'See portfolio'});
const measure='Average daily revenue over recorded revenue days within seven calendar days, attributed to contract creation date.';
const rolling=`WITH daily AS (SELECT freelancer_id,date_trunc('day',created_at) earning_day,SUM(budget) revenue FROM contracts WHERE status='COMPLETED' GROUP BY freelancer_id,date_trunc('day',created_at)), rolling AS (SELECT *,AVG(revenue) OVER(PARTITION BY freelancer_id ORDER BY earning_day RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW) moving_average FROM daily)`;
export function createAPI({pool,mongo}){
 const rows=async(sql,args=[],connection=pool)=>(await connection.query(sql,args)).rows;
 const one=async(sql,args=[],connection=pool)=>(await rows(sql,args,connection))[0];
 async function record(table,id,connection=pool){const r=await one(`SELECT * FROM ${table} WHERE id=$1`,[id],connection);if(!r)fail(404,'Record not found.');return r;}
 async function actor(req){const role=req.headers['x-demo-role'];if(!['client','freelancer','admin'].includes(role))fail(401,'Choose a demo actor to continue.');if(role==='admin')return {role,id:null};const id=integer(req.headers['x-demo-id']);if(!id||!await one(`SELECT id FROM ${role==='client'?'clients':'freelancers'} WHERE id=$1`,[id]))fail(401,'Choose an existing demo actor.');return {role,id};}
 async function paginated(table,where,args,q,convert=numeric,order='id',select='*'){
  const {page,limit,offset}=pageQuery(q),total=Number((await one(`SELECT count(*) n FROM ${table} WHERE ${where}`,args)).n);
  const data=await rows(`SELECT ${select} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset]);
  return {data:data.map(convert),page,limit,total,totalPages:Math.ceil(total/limit)};
 }
 async function publicGet(path,q){
  if(path==='/api/health'){
   const result=await Promise.allSettled([pool.query('SELECT 1'),mongo.command({ping:1})]);
   return {status:result.every(r=>r.status==='fulfilled')?'ok':'degraded',databases:{postgres:result[0].status==='fulfilled'?'connected':'unavailable',mongo:result[1].status==='fulfilled'?'connected':'unavailable'}};
  }
  if(path==='/api/actors'){const role=q.get('role');if(!['client','freelancer'].includes(role))fail(400,'Choose client or freelancer.');return paginated(role==='client'?'clients':'freelancers','name ILIKE $1',[like(q.get('search')||'')],q,r=>r,'id','id,name');}
 }
 async function get(path,q,a){
  if(path==='/api/overview'){
   if(a.role==='client'){const r=await one('SELECT escrow_balance FROM clients WHERE id=$1',[a.id]);return {balance:Number(r.escrow_balance),contracts:Number((await one('SELECT COUNT(*) n FROM contracts WHERE client_id=$1',[a.id])).n),freelancers:Number((await one('SELECT COUNT(*) n FROM freelancers')).n)};}
   if(a.role==='freelancer'){const r=await one("SELECT COUNT(*) n,COUNT(*) FILTER(WHERE status='COMPLETED') completed FROM contracts WHERE freelancer_id=$1",[a.id]);return {contracts:Number(r.n),completed:Number(r.completed)};}
   const r=await one('SELECT (SELECT COUNT(*) FROM clients) clients,(SELECT COUNT(*) FROM freelancers) freelancers,(SELECT COUNT(*) FROM contracts) contracts');return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,Number(v)]));
  }
  for(const entity of ['clients','freelancers','contracts']){
   if(path===`/api/${entity}`){let where='true';const args=[];const add=(clause,value)=>{args.push(value);where+=' AND '+clause.replaceAll('?',`$${args.length}`);};
    if(entity==='clients'&&a.role!=='admin'){if(a.role!=='client')fail(403,'Client browsing is restricted to admin.');add('id=?',a.id);}
    if(entity==='freelancers'&&a.role==='freelancer')add('id=?',a.id);
    if(entity==='contracts'&&a.role!=='admin')add(`${a.role==='client'?'client_id':'freelancer_id'}=?`,a.id);
    if(q.get('search')){
     const participantSearch="EXISTS (SELECT 1 FROM freelancers search_worker WHERE search_worker.id=contracts.freelancer_id AND search_worker.name ILIKE ?)";
     const clause=entity==='contracts'?(a.role==='admin'?`(CAST(id AS TEXT) ILIKE ? OR ${participantSearch} OR EXISTS (SELECT 1 FROM clients search_client WHERE search_client.id=contracts.client_id AND search_client.name ILIKE ?))`:participantSearch):(a.role==='admin'?'(name ILIKE ? OR CAST(id AS TEXT) ILIKE ?)':'name ILIKE ?');
     add(clause,like(q.get('search')));
    }
    if(entity==='contracts'&&q.get('status')){if(!['FUNDED','IN_PROGRESS','COMPLETED'].includes(q.get('status')))fail(400,'Unknown status.');add('status=?',q.get('status'));}
    if(entity==='contracts'&&q.get('clientId')){const id=integer(q.get('clientId'));ownClient(a,id);add('client_id=?',id);}
    if(entity==='freelancers'&&q.get('workedWith')==='true'){if(a.role!=='client')fail(403,'Work history filtering is for the selected client.');add("EXISTS (SELECT 1 FROM contracts history WHERE history.freelancer_id=freelancers.id AND history.client_id=? AND history.status IN ('IN_PROGRESS','COMPLETED'))",a.id);}
    if(entity==='freelancers'&&q.get('available')==='true')where+=' AND is_available=true';
    return paginated(entity,where,args,q,entity==='freelancers'?worker:numeric,'id',entity==='contracts'?'contracts.*,(SELECT name FROM clients WHERE clients.id=contracts.client_id) client_name,(SELECT name FROM freelancers WHERE freelancers.id=contracts.freelancer_id) freelancer_name':'*');
   }
   const match=path.match(new RegExp(`^/api/${entity}/(\\d+)$`));if(match){const id=integer(match[1]);if(entity==='clients')ownClient(a,id);if(entity==='freelancers')ownWorker(a,id);const r=await record(entity,id);if(entity==='contracts')ownedContract(a,r);return {data:entity==='freelancers'?worker(r):numeric(r)};}
  }
  let match=path.match(/^\/api\/clients\/(\d+)\/audit$/);
  if(match){const id=integer(match[1]);ownClient(a,id);await record('clients',id);dates(q);let where='client_id=$1';const args=[id];if(q.get('from')){args.push(q.get('from'));where+=` AND timestamp >= $${args.length}::date`;}if(q.get('to')){args.push(q.get('to'));where+=` AND timestamp < $${args.length}::date + INTERVAL '1 day'`;}return paginated('wallet_audit_logs',where,args,q,numeric,'timestamp,id');}
  match=path.match(/^\/api\/freelancers\/(\d+)\/portfolio$/);
  if(match){const id=integer(match[1]);ownWorker(a,id);await record('freelancers',id);return {data:await mongo.collection('Portfolios').findOne(freelancerFilter(id))};}
  if(path==='/api/analytics/lifetime-earnings'){
   const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:1);ownWorker(a,id);await record('freelancers',id);
   const data=await rows('SELECT freelancer_id,freelancer_name name,lifetime_completed_contracts completed,lifetime_total_earnings total FROM freelancer_lifetime_earnings WHERE freelancer_id=$1',[id]);
   return {data:data.map(numeric),lastRefreshed:(await one("SELECT value FROM api_metadata WHERE key='earnings_refreshed'"))?.value||null};
  }
  if(path==='/api/analytics/revenue'||path==='/api/analytics/rankings'){
   const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:1);ownWorker(a,id);await record('freelancers',id);
   if(path.endsWith('/revenue'))return {data:(await rows(`${rolling} SELECT to_char(earning_day,'YYYY-MM-DD') date,revenue,moving_average FROM rolling WHERE freelancer_id=$1 ORDER BY earning_day`,[id])).map(numeric),measure};
   const rankSQL=`${rolling}, latest AS(SELECT DISTINCT ON(freelancer_id) * FROM rolling ORDER BY freelancer_id,earning_day DESC), ranked AS(SELECT *,DENSE_RANK() OVER(ORDER BY moving_average DESC) revenue_rank FROM latest) SELECT r.freelancer_id,to_char(r.earning_day,'YYYY-MM-DD') date,r.moving_average,r.revenue_rank,f.name FROM ranked r JOIN freelancers f ON f.id=r.freelancer_id ${a.role==='freelancer'?'WHERE r.freelancer_id=$1':''}`;
   const args=a.role==='freelancer'?[a.id]:[],{page,limit,offset}=pageQuery(q);const total=Number((await one(`SELECT COUNT(*) n FROM (${rankSQL}) ranked_count`,args)).n);
   return {data:(await rows(`${rankSQL} ORDER BY revenue_rank,freelancer_id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,offset])).map(numeric),page,limit,total,totalPages:Math.ceil(total/limit),measure:'Latest seven-day moving-average revenue (recorded days only), all completed-contract history.'};
  }
  if(path==='/api/workers/nearby'){
   if(a.role==='freelancer')fail(403,'Worker discovery is available to clients and admin.');const {lat,lng}=coordinates(q),pipeline=nearbyPipeline(lat,lng);const paginationQuery=new URLSearchParams(q);if(!paginationQuery.has('limit'))paginationQuery.set('limit','100');const {page,limit:nearbyLimit,offset}=pageQuery(paginationQuery);
   // One current ping per worker, nearest first; PostgreSQL decides availability.
   const pings=await mongo.collection('WorkerLocations').aggregate(pipeline,{maxTimeMS:12000}).toArray();
   const workers=pings.length?await rows('SELECT * FROM freelancers WHERE id=ANY($1::int[]) AND is_available=true',[pings.map(p=>p.freelancer_id)]):[];
   const byId=new Map(workers.map(f=>[f.id,f])),data=pings.filter(p=>byId.has(p.freelancer_id)).map(p=>({...worker(byId.get(p.freelancer_id)),latitude:p.location.coordinates[1],longitude:p.location.coordinates[0],distance_meters:p.distance_meters,location_updated_at:p.created_at}));
   return {data:data.slice(offset,offset+nearbyLimit),page,limit:nearbyLimit,total:data.length,totalPages:Math.ceil(data.length/nearbyLimit),origin:{latitude:lat,longitude:lng},radius_meters:5000};
  }
  if(path==='/api/reviews/analytics'||path==='/api/reviews'){
   const id=integer(q.get('freelancerId'),a.role==='freelancer'?a.id:undefined);if(id){ownWorker(a,id);await record('freelancers',id);}const filter=id?freelancerFilter(id):{};
   if(path.endsWith('/analytics')){const [result]=await mongo.collection('GigReviews').aggregate(reviewFacet(filter),{maxTimeMS:12000}).toArray();const distribution=result?.rating_distribution||[];return {rating_distribution:[1,2,3,4,5].map(rating=>({rating,review_count:distribution.find(r=>r.rating===rating)?.review_count||0})),top_skill_tags:result?.top_skill_tags||[],average_rating:result?.overall_average_rating[0]?.average_rating??null,total_reviews:result?.overall_average_rating[0]?.total_reviews||0,scope:id?`Freelancer #${id}`:'Whole platform'};}
   const {page,limit,offset}=pageQuery(q),collection=mongo.collection('GigReviews');const [total,data]=await Promise.all([collection.countDocuments(filter,{maxTimeMS:12000}),collection.find(filter).sort({created_at:-1,_id:-1}).skip(offset).limit(limit).maxTimeMS(12000).toArray()]);return {data,page,limit,total,totalPages:Math.ceil(total/limit)};
  }
  fail(404,'Endpoint not found.');
 }
 async function mutate(path,method,body,a,req){
  if(path==='/api/contracts/fund'&&method==='POST'){
   if(a.role!=='client')fail(403,'Only a client can fund a gig.');if(body.clientId!==undefined&&Number(body.clientId)!==a.id)fail(403,'Funding must use the selected client.');
   const freelancerId=integer(body.freelancerId);if(!freelancerId)fail(400,'Choose a freelancer before funding.');const amount=budget(body.budget),key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[\w-]{8,100}$/.test(key))fail(400,'A valid idempotency key is required.');const payload={freelancerId,budget:amount};
   const connection=await pool.connect();let broken=false;
   // fund_gig requires REPEATABLE READ.
   const attempt=async()=>{try{await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    const prior=await one('SELECT * FROM api_funding_requests WHERE request_key=$1',[key],connection);
    if(prior){if(prior.actor_id!==a.id||JSON.stringify(prior.payload)!==JSON.stringify(payload)){
      if(prior.actor_id!==a.id||prior.payload.freelancerId!==payload.freelancerId||prior.payload.budget!==payload.budget)fail(409,'This request key was used with different funding details.');
     }await connection.query('COMMIT');return prior.response;}
    const c=await one('SELECT * FROM clients WHERE id=$1 FOR UPDATE',[a.id],connection);if(!c)fail(404,'Client not found.');await record('freelancers',freelancerId,connection);
    const output=await one('CALL fund_gig($1::integer,$2::integer,$3::numeric,NULL::integer)',[a.id,freelancerId,amount],connection);
    const created=await record('contracts',output.p_contract_id,connection),after=await one('SELECT escrow_balance FROM clients WHERE id=$1',[a.id],connection),auditEntry=await one('SELECT * FROM wallet_audit_logs WHERE client_id=$1 ORDER BY id DESC LIMIT 1',[a.id],connection);
    const result={data:numeric(created),balanceBefore:Number(c.escrow_balance),balanceAfter:Number(after.escrow_balance),audit:numeric(auditEntry)};
    await connection.query('INSERT INTO api_funding_requests(request_key,actor_id,payload,response) VALUES($1,$2,$3::jsonb,$4::jsonb)',[key,a.id,JSON.stringify(payload),JSON.stringify(result)]);
    await connection.query('COMMIT');
    // Idempotency keys last a day; trim best effort.
    pool.query("DELETE FROM api_funding_requests WHERE request_key IN (SELECT request_key FROM api_funding_requests WHERE created_at<now()-interval '1 day' LIMIT 100)").catch(()=>{});
    return result;
   }catch(error){await connection.query('ROLLBACK').catch(()=>{broken=true;});throw error;}};
   // Session-level per-key lock before BEGIN (a REPEATABLE READ snapshot is fixed by the first statement); retry 40001.
   try{await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[key]);
    for(let tries=1;;tries++){try{return await attempt();}catch(error){if(error.code==='40001'&&tries<3)continue;throw error;}}
   }finally{try{await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]);}catch{broken=true;}connection.release(broken);}
  }
  const locationMatch=path.match(/^\/api\/workers\/(\d+)\/location$/);
  if(locationMatch&&method==='POST'){
   const id=integer(locationMatch[1]);if(a.role!=='freelancer'||a.id!==id)fail(403,'Only the selected freelancer can send their own location ping.');
   const origin=coordinates(new URLSearchParams({lat:body.lat??'',lng:body.lng??''}));const f=await record('freelancers',id),timestamp=new Date();
   // Keep ping history; the new ping becomes the only current one.
   const pings=mongo.collection('WorkerLocations');await pings.updateMany({freelancer_id:id,is_current:true},{$set:{is_current:false}});
   try{await pings.insertOne({freelancer_id:id,is_available:f.is_available,is_current:true,location:{type:'Point',coordinates:[origin.lng,origin.lat]},created_at:timestamp});}catch(error){if(error.code===11000)fail(409,'Another location update for this worker was processed at the same moment. Retry.');throw error;}
   return {data:{freelancer_id:id,latitude:origin.lat,longitude:origin.lng,created_at:timestamp}};
  }
  const match=path.match(/^\/api\/contracts\/(\d+)\/status$/);
  if(match&&method==='PATCH'){
   if(a.role==='admin')fail(403,'Admin is read only.');const connection=await pool.connect();try{await connection.query('BEGIN');const c=await one('SELECT * FROM contracts WHERE id=$1 FOR UPDATE',[integer(match[1])],connection);if(!c)fail(404,'Contract not found.');ownedContract(a,c);const expected={FUNDED:'IN_PROGRESS',IN_PROGRESS:'COMPLETED'}[c.status];if(!expected||body.status!==expected)fail(409,'Only forward status transitions are allowed. Reload the contract and try again.');const updated=await one('UPDATE contracts SET status=$1 WHERE id=$2 RETURNING *',[body.status,c.id],connection);await connection.query('COMMIT');return {data:numeric(updated)};}catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
  }
  if(path==='/api/analytics/lifetime-earnings/refresh'&&method==='POST'){
   await pool.query('SELECT api_refresh_earnings()');return {lastRefreshed:(await one("SELECT value FROM api_metadata WHERE key='earnings_refreshed'"))?.value};
  }
  fail(405,'This action is not supported.');
 }
 return {actor,publicGet,get,mutate};
}
