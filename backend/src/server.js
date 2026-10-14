import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {loadConfig} from './config.js';
import {createConnections} from './connections.js';
import {createAPI} from './api.js';
import {fail,publicError} from './validation.js';
export function createApplication({config=loadConfig(),connections=createConnections(config)}={}){
 const api=createAPI(connections);
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');try{
  const origin=req.headers.origin;
  if(origin){if(!config.origins.includes(origin))fail(403,'This frontend origin is not allowed. Configure CORS_ORIGIN on the backend.');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Demo-Role,X-Demo-Id,Idempotency-Key');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'))fail(404,'API route not found. Run the frontend on its separate port.');
  let result;
  if(req.method==='GET'&&['/api/health','/api/actors'].includes(url.pathname))result=await api.publicGet(url.pathname,url.searchParams);
  else {const actor=await api.actor(req);if(req.method==='GET')result=await api.get(url.pathname,url.searchParams,actor);
   else{let raw='',size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)fail(413,'Request is too large.');raw+=chunk;}let body;try{body=JSON.parse(raw||'{}');}catch{fail(400,'Request must contain valid JSON.');}if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'Request must contain an object.');result=await api.mutate(url.pathname,req.method,body,actor,req);}
  }
  if(url.pathname==='/api/health'&&result.status==='degraded')res.statusCode=503;
  res.end(JSON.stringify({...result,mode:'postgres-mongo'}));
 }catch(error){const result=publicError(error);if(result.status===500)console.error('API error:',error.code||error.name);res.writeHead(result.status);res.end(JSON.stringify({error:result.error}));}});
 return {server,close:connections.close};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const config=loadConfig(),app=createApplication({config});app.server.listen(config.port,config.host,()=>console.log(`GigTask API: http://${config.host}:${config.port}/api · PostgreSQL + MongoDB`));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>app.server.close(async()=>{await app.close();process.exit(0);}));}
