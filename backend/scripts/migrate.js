import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../src/config.js';
import {createConnections} from '../src/connections.js';
const sqlFile=name=>readFile(new URL('../database/sql/'+name,import.meta.url),'utf8');
export async function migratePostgres(pool){
 const connection=await pool.connect();try{await connection.query('BEGIN');await connection.query('SELECT pg_advisory_xact_lock(41725,2)');
  // 01 runs only on an empty database; the rest are idempotent.
  const exists=(await connection.query("SELECT to_regclass('clients') relation")).rows[0].relation;
  if(!exists)await connection.query(await sqlFile('01_schema_ddl.sql'));
  for(const name of ['02_indexes.sql','03_triggers_and_audit.sql','04_stored_procedures.sql','05_materialized_views.sql','07_api_integration.sql'])await connection.query(await sqlFile(name));
  await connection.query('SELECT api_refresh_earnings()');await connection.query('COMMIT');
 }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
}
// Indexes from earlier revisions.
const legacyIndexes=[['WorkerLocations','idx_workerlocations_available_freelancer'],['WorkerLocations','idx_worker_latest_ping']];
// The unique current-ping index needs one current ping per worker; keep the newest.
async function normalizeCurrentPings(mongo){
 const pings=mongo.collection('WorkerLocations');
 if(!(await mongo.listCollections({name:'WorkerLocations'}).hasNext())||await pings.indexExists('uq_workerlocations_current'))return;
 const duplicates=await pings.aggregate([{$match:{is_current:true}},{$sort:{created_at:-1,_id:-1}},{$group:{_id:'$freelancer_id',ids:{$push:'$_id'},n:{$sum:1}}},{$match:{n:{$gt:1}}}],{allowDiskUse:true}).toArray();
 for(const d of duplicates)await pings.updateMany({_id:{$in:d.ids.slice(1)}},{$set:{is_current:false}});
}
export async function migrateMongo(mongo){
 // Replay the validators and indexes from the mongosh script.
 const operations=[];
 let shell;
 shell=new Proxy({getSiblingDB:()=>shell,createCollection:(name,options)=>operations.push({type:'collection',name,options}),getCollectionNames:()=>[]},{get(target,key){return key in target?target[key]:{createIndex:(keys,options)=>operations.push({type:'index',name:key,keys,options}),getIndexes:()=>[]};}});
 const script=await readFile(new URL('../database/mongo/01_collections_and_indexes.js',import.meta.url),'utf8');
 vm.runInNewContext(script,{db:shell,print:()=>{},printjson:()=>{}},{timeout:1000});
 await normalizeCurrentPings(mongo);
 for(const [collection,name] of legacyIndexes){try{await mongo.collection(collection).dropIndex(name);}catch(error){if(error.codeName!=='IndexNotFound'&&error.codeName!=='NamespaceNotFound')throw error;}}
 for(const op of operations){if(op.type==='collection'){try{await mongo.createCollection(op.name,op.options);}catch(error){if(error.code!==48)throw error;await mongo.command({collMod:op.name,...op.options});}}else await mongo.collection(op.name).createIndex(op.keys,op.options);}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const connections=createConnections(loadConfig());try{await migratePostgres(connections.pool);console.log('PostgreSQL schema and API migration applied.');await migrateMongo(connections.mongo);console.log('MongoDB inherited validators and indexes applied.');}catch(error){console.error('Migration failed:',error.message);process.exitCode=1;}finally{await connections.close();}
}
