import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function createFrontendServer({apiBaseUrl=process.env.FRONTEND_API_URL||'http://localhost:3000/api'}={}){
 if(!/^https?:\/\//.test(apiBaseUrl)&&!apiBaseUrl.startsWith('/'))throw new Error('FRONTEND_API_URL must be an HTTP(S) URL or relative API path.');
 return http.createServer(async(req,res)=>{try{
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/config.js'){res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(`window.GIGTASK_CONFIG = ${JSON.stringify({apiBaseUrl}).replace(/</g,'\\u003c')};`);return;}
  const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
  if(!files[path]){res.writeHead(404);res.end('Page not found');return;}
  const file=files[path];res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');const content=await readFile(new URL(file,import.meta.url));res.end(req.method==='HEAD'?undefined:content);
 }catch{res.writeHead(500);res.end('Could not load frontend.');}});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const port=Number(process.env.FRONTEND_PORT)||5173;createFrontendServer().listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Frontend: http://localhost:${port}`));}
