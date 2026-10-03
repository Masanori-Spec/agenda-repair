import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
// Development only. Explicit public allowlist excludes source tests, evidence and dotfiles.
const allowed=p=>p==='/index.html' || p==='/icon.svg' || /^\/src\/[A-Za-z0-9_-]+\.(js|css)$/.test(p) || /^\/public\/[A-Za-z0-9_-]+\.json$/.test(p);
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    const pathname=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    if(!allowed(pathname)){res.writeHead(404);res.end('Not found');return;}
    const bytes=await readFile(path.join(root,pathname));
    res.writeHead(200,{'Content-Type':mime[path.extname(pathname)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"});
    res.end(bytes);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||4174),'127.0.0.1',()=>console.log(`Agenda Repair: http://127.0.0.1:${process.env.PORT||4174}`));
