export function fail(status,message){throw Object.assign(new Error(message),{status});}
export function integer(value,fallback,min=1,max=2147483647){if(value===null||value===undefined)return fallback;if(typeof value!=='number'&&!(typeof value==='string'&&/^\d{1,15}$/.test(value)))fail(400,'Enter a valid identifier or page number.');const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)fail(400,'Enter a valid identifier or page number.');return n;}
export function pageQuery(q){const page=integer(q.get('page'),1),limit=integer(q.get('limit'),10,1,100);const offset=(page-1)*limit;if(!Number.isSafeInteger(offset))fail(400,'Page number is too large.');return {page,limit,offset};}
export function budget(value){if(typeof value!=='string'&&typeof value!=='number')fail(400,'Enter a valid budget with up to two decimal places.');if(!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(String(value)))fail(400,'Enter a valid budget with up to two decimal places.');const cents=Math.round(Number(value)*100);if(cents<=0)fail(400,'Budget must be greater than zero.');return (cents/100).toFixed(2);}
export function dates(q){for(const key of ['from','to']){const value=q.get(key);if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))fail(400,'Enter a valid date in YYYY-MM-DD format.');}if(q.get('from')&&q.get('to')&&q.get('from')>q.get('to'))fail(400,'The end date must be after the start date.');}
export function coordinates(q){if(!q.get('lat')?.trim()||!q.get('lng')?.trim())fail(400,'Choose a job-site latitude and longitude.');const decimal=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;if(!decimal.test(q.get('lat').trim())||!decimal.test(q.get('lng').trim()))fail(400,'Latitude and longitude must be decimal numbers.');const lat=Number(q.get('lat')),lng=Number(q.get('lng'));if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail(400,'Latitude must be -90 to 90 and longitude -180 to 180.');return {lat,lng};}
export const ownClient=(a,id)=>{if(a.role!=='admin'&&(a.role!=='client'||a.id!==id))fail(403,'You can only view your own client balance and audit logs.');};
export const ownWorker=(a,id)=>{if(a.role==='freelancer'&&a.id!==id)fail(403,'Freelancers can only inspect their own profile and analytics.');};
export const ownedContract=(a,r)=>{if(a.role!=='admin'&&(a.role==='client'?r.client_id:r.freelancer_id)!==a.id)fail(403,'This contract belongs to another demo actor.');};
export function publicError(error){
 if(error.status)return {status:error.status,error:error.message};
 if(error.code==='23505')return {status:409,error:error.constraint==='idx_active_gig'?'This freelancer already has an in progress contract. Complete it before starting another.':'This record conflicts with an existing record. Reload and try again.'};
 if(error.code==='40001')return {status:409,error:'Another change to this balance happened at the same moment. Please retry.'};
 if(error.code==='P0001'||error.code==='22023')return {status:409,error:error.message};
 if(error.code==='23503')return {status:409,error:'A referenced client or freelancer no longer exists.'};
 if(error.code==='23514')return {status:409,error:'The transaction violates a budget, balance or status constraint.'};
 if(error.code===292)return {status:503,error:'The location query exceeded the database memory limit. Please retry or contact the project administrator.'};
 if(['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','28P01','3D000','57P01','53300','57014'].includes(error.code)||/Mongo.*(Error|Timeout)/.test(error.name||''))return {status:503,error:'A database is unavailable. Check the backend connection configuration and retry.'};
 if(error.code==='42P01'||error.code==='42883')return {status:503,error:'Database setup is incomplete. Run the backend migrations.'};
 return {status:500,error:'The server could not complete this action. Please retry.'};
}
