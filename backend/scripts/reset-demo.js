import {loadConfig} from '../src/config.js';
import {createConnections} from '../src/connections.js';
import {migratePostgres,migrateMongo} from './migrate.js';
import {seedLinked} from './seed-linked.js';
if(!process.argv.includes('--confirm-gigtask-reset'))throw new Error('Pass --confirm-gigtask-reset to clear GigTask application records in the configured databases.');
const connections=createConnections(loadConfig());
try{
 await connections.pool.query('SELECT 1');await connections.mongo.command({ping:1});
 await migratePostgres(connections.pool);await migrateMongo(connections.mongo);
 await connections.pool.query('TRUNCATE api_funding_requests,wallet_audit_logs,contracts,freelancers,clients RESTART IDENTITY');
 console.log('Cleared GigTask PostgreSQL application records.');
 for(const name of ['Portfolios','GigReviews','WorkerLocations'])await connections.mongo.collection(name).deleteMany({});
 console.log('Cleared GigTask MongoDB documents; validators and indexes retained.');
 const result=await seedLinked(connections);
 console.log(JSON.stringify({seeded:true,base_city:result.baseCity,workers:result.workers}));
}catch(error){console.error('GigTask reset/seed failed:',error.code||error.name,error.message);process.exitCode=1;}finally{await connections.close();}
