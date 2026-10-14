// Deterministic synthetic seed records, imported once by database.js on first startup.
// Positive opening-history adjustments release balance; negative holds reserve it.
const names = ['Aarav Sharma','Priya Reddy','Kabir Verma','Ananya Tandon','Rohan Patil','Meera Singh','Arjun Kapoor','Sara Thakur'];
const skills = ['Web development','Graphic design','Photography','Copywriting'];
export const clients = Array.from({length:32},(_,i)=>({id:i+1,name:`${names[i%8]}${i>7 ? ` ${Math.floor(i/8)+1}`:''}`,escrow_balance:1000+i*175,created_at:'2026-09-01T09:00:00Z'}));
export const freelancers = Array.from({length:48},(_,i)=>({id:i+1,name:`${names[(i+3)%8]}${i>7 ? ` ${Math.floor(i/8)+1}`:''}`,skill:skills[i%4],is_available:i%3!==0,latitude:17.45452+(i%7-3)*0.006,longitude:78.35008+(i%9-4)*0.006}));
export const contracts = Array.from({length:160},(_,i)=>({id:i+1,client_id:i%32+1,freelancer_id:i%48+1,budget:500+(i%12)*250,status:['FUNDED','IN_PROGRESS','COMPLETED','COMPLETED'][i%4],created_at:new Date(Date.UTC(2026,8,1+i%40,10)).toISOString()}));
export const audits = clients.flatMap(c=>Array.from({length:6},(_,i)=>({id:(c.id-1)*6+i+1,client_id:c.id,amount_changed:i%3===2?-200:300,action_type:i%3===2?'ESCROW_HOLD':'ESCROW_RELEASE',balance_after:c.escrow_balance-[700,400,600,300,0,200][i],timestamp:new Date(Date.UTC(2026,9,1+i,10)).toISOString()})));
// Ensure chronological ledger balances reconcile exactly to the displayed current balance.
for(const c of clients){const rows=audits.filter(a=>a.client_id===c.id);let balance=c.escrow_balance-rows.reduce((s,r)=>s+r.amount_changed,0);for(const row of rows){balance+=row.amount_changed;row.balance_after=balance;}}
export const portfolios = freelancers.map(f=>({freelancer_id:f.id,name:f.name,skills:[f.skill,'Communication','Project management'],certifications:[{name:'Professional skills certificate',issuer:'Demo Academy',year:2025}],projects:[{title:`${f.skill} project`,description:'A sample portfolio project demonstrating recent client work.'}]}));
export const reviews = freelancers.flatMap(f=>Array.from({length:5},(_,i)=>({freelancer_id:f.id,rating:3+(f.id+i)%3,skill_tags:[f.skill,i%2?'Reliable':'Great communication']})));
