import {readFileSync} from 'node:fs';
export function loadConfig(env=process.env){
 const sslMode=env.PG_SSL_MODE||'url';
 if(!['url','disable','verify-full'].includes(sslMode))throw new Error('PG_SSL_MODE must be url, disable, or verify-full.');
 const postgres={connectionString:env.DATABASE_URL||'postgresql://postgres:postgres@127.0.0.1:5432/gigtask_db',max:10,options:'-c timezone=UTC',connectionTimeoutMillis:8000,statement_timeout:15000};
 if(sslMode==='disable')postgres.ssl=false;
 if(sslMode==='verify-full'){// Explicit SSL configuration wins over URL SSL parameters.
  const url=new URL(postgres.connectionString);for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])url.searchParams.delete(key);postgres.connectionString=url.toString();
  postgres.ssl={rejectUnauthorized:true,...(env.PG_SSL_CA_FILE?{ca:readFileSync(env.PG_SSL_CA_FILE,'utf8')}:{})};
 }
 return {postgres,mongoUri:env.MONGODB_URI||'mongodb://127.0.0.1:27017',mongoDb:env.MONGODB_DB||'gigtask_db',host:env.HOST||'127.0.0.1',port:Number(env.PORT)||3000,origins:(env.CORS_ORIGIN||'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s=>s.trim()).filter(Boolean)};
}
