import {fileURLToPath} from 'node:url';
import {writeFile,mkdir} from 'node:fs/promises';
import {loadConfig} from '../src/config.js';
import {createConnections} from '../src/connections.js';
import {migratePostgres,migrateMongo} from './migrate.js';
import {BASE_CITY,seedPosition} from '../src/geography.js';
export const SCALE={clients:1000,freelancers:2000,contracts:60000,audits:101000,pings:500000};
const first='Aarav Aditi Aditya Aisha Akash Akshara Aman Amara Ananya Anika Anirudh Anjali Arjun Arnav Avani Bhavana Charan Deepa Dev Devika Dhruv Diya Esha Farah Gautam Harini Harsh Ishaan Ishita Jai Janani Kabir Karthik Kavya Kiran Lakshmi Madhav Manasa Meera Mihir Mira Mohan Nandini Naveen Neha Nikhil Nisha Pallavi Pranav Priya Rahul Raj Rhea Rohan Rohit Saanvi Sahil Sanjana Sara Shreya Siddharth Simran Sneha Suraj Tanvi Varun Ved Vihaan Vikram Yash Zoya Abhay Abhishek Advait Ahaan Ajay Akhil Alok Amit Amrita Anand Anita Ankit Anshul Anupama Archana Arvind Ashwin Bharat Chetan Chirag Daksh Darshan Dinesh Divya Ekta Gaurav Gayatri Girish Hari Hemant Himani Indira Isha Jagdish Jyoti Kailash Kamal Kamini Keshav Kunal Lalit Leela Mahesh Malini Manish Mansi Mayank Mukesh Nakul Namrata Naman Neelam Nitin Om Pankaj Parth Pooja Prakash Pratik Rajesh Ramesh Rashmi Ritu Sagar Sandeep Sanjay Seema Shivam Sunita Tarun Uday Vandana Vivek'.split(' ');
const last='Verma Tandon Patil Sharma Shrivastav Singh Kandagatla Saha Chadha Karre Reddy Kapoor Modi Chaudhary Rathore Thakur Jalal Pandey Gandhi Rathee Rajput Sen Pradhan'.split(' ');
// Neighbouring ids get different surnames; every (first, last) pair is used at most once.
export function personName(index){if(index>=first.length*last.length)throw new Error('Name pool exhausted. Extend curated name lists instead of adding digits.');const f=index%first.length,round=Math.floor(index/first.length);return `${first[f]} ${last[(round+f*7)%last.length]}`;}
const tags=['Web development','Graphic design','Photography','Copywriting','Electrical repair','Carpentry','Home cleaning','Video editing','Data analysis','Delivery'];
export async function seedScale(connections,{replace=false,onProgress=console.log}={}){
 if(!replace)throw new Error('Scale seed requires explicit replacement authorization.');
 const {pool,mongo}=connections;
 await pool.query('SELECT 1');await mongo.command({ping:1});
 await migratePostgres(pool);await migrateMongo(mongo);
 const clients=Array.from({length:SCALE.clients},(_,i)=>({id:i+1,name:personName(i),balance:50000+(i%100)*250}));
 const workers=Array.from({length:SCALE.freelancers},(_,i)=>({id:i+1,name:personName(SCALE.clients+i),is_available:(i+1)%5!==0,...seedPosition(i+1)}));
 const connection=await pool.connect();
 try{
  await connection.query('BEGIN');await connection.query("SET LOCAL statement_timeout='0'");await connection.query("SET LOCAL timezone='UTC'");await connection.query('SELECT pg_advisory_xact_lock(41725,3)');
  await connection.query('TRUNCATE api_funding_requests,wallet_audit_logs,contracts,freelancers,clients RESTART IDENTITY');
  await connection.query(`INSERT INTO clients(id,name,escrow_balance,created_at)
   SELECT id,name,balance,now()-interval '120 days' FROM jsonb_to_recordset($1::jsonb) AS x(id int,name text,balance numeric)`,[JSON.stringify(clients)]);
  await connection.query(`INSERT INTO freelancers(id,name,latitude,longitude,is_available)
   SELECT id,name,latitude,longitude,is_available FROM jsonb_to_recordset($1::jsonb) AS x(id int,name text,latitude numeric,longitude numeric,is_available boolean)`,[JSON.stringify(workers)]);
  await connection.query(`INSERT INTO contracts(id,client_id,freelancer_id,budget,status,created_at)
   SELECT n,((n-1)%1000)+1,((n-1)%2000)+1,(25000+(n*3731)%475000)/100.0,
    CASE WHEN n>59800 THEN 'IN_PROGRESS'::status WHEN n%10<7 THEN 'COMPLETED'::status ELSE 'FUNDED'::status END,
    now()-(n%90)*interval '1 day'-(n%86400)*interval '1 second' FROM generate_series(1,60000) n`);
  // Ledger that matches the contracts: each contract is a hold, two in three preceded by a top-up of half its budget.
  // The opening deposit makes the running balance end at the current balance and never fall below it.
  // Written directly, since the trigger can only stamp the present time.
  await connection.query(`INSERT INTO wallet_audit_logs(client_id,amount_changed,action_type,balance_after,timestamp)
   SELECT client_id,amount,CASE WHEN amount<0 THEN 'ESCROW_HOLD'::action_type ELSE 'ESCROW_RELEASE'::action_type END,
    SUM(amount) OVER(PARTITION BY client_id ORDER BY ts,seq ROWS UNBOUNDED PRECEDING),ts
   FROM (
    SELECT cl.id client_id,cl.escrow_balance+COALESCE(net.reduction,0) amount,cl.created_at ts,0 seq
     FROM clients cl LEFT JOIN (SELECT client_id,SUM(budget-CASE WHEN id%3<2 THEN round(budget/2,2) ELSE 0 END) reduction FROM contracts GROUP BY client_id) net ON net.client_id=cl.id
    UNION ALL SELECT client_id,round(budget/2,2),created_at-interval '1 millisecond',1 FROM contracts WHERE id%3<2
    UNION ALL SELECT client_id,-budget,created_at,2 FROM contracts
   ) events
   ORDER BY ts,client_id,seq`);
  for(const table of ['clients','freelancers','contracts','wallet_audit_logs'])await connection.query(`SELECT setval(pg_get_serial_sequence('${table}','id'),(SELECT MAX(id) FROM ${table}))`);
  await connection.query('ANALYZE clients; ANALYZE freelancers; ANALYZE contracts; ANALYZE wallet_audit_logs');await connection.query('SELECT refresh_freelancer_earnings()');
  await connection.query('COMMIT');onProgress('PostgreSQL replaced: 1,000 clients, 2,000 freelancers, 60,000 contracts, 101,000 reconciled audit entries.');
 }catch(error){await connection.query('ROLLBACK');throw error;}finally{connection.release();}
 // Use the stored coordinates so pings match PostgreSQL exactly.
 const stored=(await pool.query('SELECT id,name,latitude,longitude,is_available FROM freelancers ORDER BY id')).rows;
 for(const name of ['Portfolios','GigReviews','WorkerLocations'])await mongo.collection(name).deleteMany({});
 onProgress('Old GigTask MongoDB documents removed; collection validators and indexes retained.');
 for(let start=0;start<stored.length;start+=500){const batch=stored.slice(start,start+500);await mongo.collection('Portfolios').insertMany(batch.map(f=>({_id:`scale-portfolio-${f.id}`,freelancer_id:f.id,name:f.name,skills:[tags[f.id%tags.length],tags[(f.id+3)%tags.length],'Communication'],certifications:[{name:'Professional skills certification',issuer:['Skill India','City Skills Academy','Open Learning Institute'][f.id%3],year:2021+f.id%5}],projects:[{title:`${tags[f.id%tags.length]} for a local business`,description:'Delivered a focused client project with clear milestones and quality review.',completed_at:new Date(Date.now()-(f.id%60)*86400000)}]})));}
 const completed=(await pool.query("SELECT id,freelancer_id,created_at FROM contracts WHERE status='COMPLETED' ORDER BY id")).rows;
 for(let start=0;start<completed.length;start+=2000)await mongo.collection('GigReviews').insertMany(completed.slice(start,start+2000).map(c=>({_id:`scale-review-${c.id}`,contract_id:c.id,freelancer_id:c.freelancer_id,rating:1+(c.id*7)%5,skill_tags:[tags[c.freelancer_id%tags.length],['Reliable','On time','Clear communication','Quality work'][c.id%4]],review_text:['Clear communication and thoughtful delivery.','The work met our brief and was completed on schedule.','Helpful collaboration with attention to detail.','Good results; a few details needed a second pass.','A practical solution for our small business.'][c.id%5],created_at:new Date(Math.min(Date.now(),new Date(c.created_at).getTime()+3600000))})));
 onProgress(`MongoDB portfolios: ${stored.length}; linked completed-contract reviews: ${completed.length}.`);
 const epoch=Date.now();
 for(let start=0;start<SCALE.pings;start+=5000){const documents=[];
  for(let n=start;n<Math.min(start+5000,SCALE.pings);n++){const f=stored[n%stored.length],round=Math.floor(n/stored.length),jitter=round===249?0:Math.sin(n*1.37)*0.0002;documents.push({_id:`scale-location-${n}`,freelancer_id:f.id,is_available:f.is_available,is_current:round===249,location:{type:'Point',coordinates:[Number(f.longitude)+jitter,Number(f.latitude)+jitter]},created_at:new Date(epoch-(249-round)*1000)});}
  await mongo.collection('WorkerLocations').insertMany(documents,{ordered:false});
  if((start+5000)%50000===0)onProgress(`WorkerLocations: ${start+5000} / ${SCALE.pings}`);
 }
 const manifest={generatedAt:new Date().toISOString(),baseCity:BASE_CITY,counts:{...SCALE,reviews:completed.length,portfolios:stored.length},names:'Curated first and last names, unique across clients and freelancers, no numeric suffixes',locationsExpireAfterHours:2,resetScope:'GigTask application tables and three MongoDB collections only',history:'Synthetic ledger written directly: an opening deposit per client, a hold per contract and partial top-ups. Every contract reduces the client balance and the ledger ends exactly at the current balance. The live funding workflow is tested separately through the stored procedure and trigger.'};
 await mkdir(new URL('../reports/',import.meta.url),{recursive:true});await writeFile(new URL('../reports/seed-manifest.json',import.meta.url),JSON.stringify(manifest,null,2));return manifest;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const connections=createConnections(loadConfig());try{if(!process.argv.includes('--replace-gigtask-data'))throw new Error('Pass --replace-gigtask-data to replace the configured GigTask data.');const result=await seedScale(connections,{replace:true});console.log(JSON.stringify(result));}catch(error){console.error('Scale seed failed:',error.code||error.name,error.message);process.exitCode=1;}finally{await connections.close();}
}
