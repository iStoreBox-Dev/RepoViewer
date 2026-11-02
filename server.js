'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = '1.7.0';
const BUILD_ID = '2026-11-02-react-ipa';
console.log('[RepoViewer] Version '+APP_VERSION+' | Build '+BUILD_ID+' | Node '+process.version);
const limit = 24 * 1024 * 1024; // JSON metadata, not IPA downloads
const MAX_APPS = 10000;
const blocked = new net.BlockList();
for (const [base, bits] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['224.0.0.0',4],['240.0.0.0',4]
]) blocked.addSubnet(base,bits,'ipv4');
for (const [base,bits] of [['::',128],['::1',128],['fc00::',7],['fe80::',10],['ff00::',8]]) blocked.addSubnet(base,bits,'ipv6');
function safeIP(ip){
  const type=net.isIP(ip);
  if(!type || blocked.check(ip,type===4?'ipv4':'ipv6')) return false;
  if(type===6 && ip.toLowerCase().startsWith('::ffff:')){
    const tail=ip.substring(7);
    if(net.isIP(tail)===4) return safeIP(tail);
    return false;
  }
  return true;
}
function validateUrl(raw){
  const u=new URL(raw);
  if(!['http:','https:'].includes(u.protocol) || u.username || u.password || u.port && !['80','443'].includes(u.port)) throw Error('Only public HTTP(S) URLs are supported');
  if(!u.hostname || u.hostname==='localhost' || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local') || net.isIP(u.hostname)) throw Error('Use a public repository hostname');
  return u;
}
async function fetchJson(raw, redirects=0){
  if(redirects>3) throw Error('Too many redirects');
  const u=validateUrl(raw);
  return new Promise((resolve,reject)=>{
    const lookup=(hostname, options, cb)=>{
      dns.lookup(hostname,{all:true,verbatim:true},(err,addresses)=>{
        if(err)return cb(err);
        if(!addresses.length || addresses.some(a=>!safeIP(a.address))) return cb(Error('Blocked private/internal network address'));
        // Node 20+ may request all DNS results for autoSelectFamily.
        // Returning a scalar in that case causes "Invalid IP address: undefined".
        if(options && options.all) return cb(null,addresses);
        const family=options && options.family;
        const one=addresses.find(a=>!family || a.family===family);
        if(!one) return cb(Error('No DNS address matches requested family'));
        cb(null,one.address,one.family);
      });
    };
    const transport=u.protocol==='https:'?https:http;
    const req=transport.get(u,{lookup,timeout:10000,headers:{'Accept':'application/json','User-Agent':'RepoViewer/1.0'}},res=>{
      if([301,302,303,307,308].includes(res.statusCode)){
        const loc=res.headers.location;res.resume();
        if(!loc)return reject(Error('Redirect missing destination'));
        return resolve(fetchJson(new URL(loc,u).href,redirects+1));
      }
      if(res.statusCode!==200){res.resume();return reject(Error('Repository returned HTTP '+res.statusCode));}
      if(Number(res.headers['content-length'])>limit){res.destroy();return reject(Error('Repository JSON exceeds the 24 MB safety limit'));}
      let len=0;const chunks=[];
      res.on('data',chunk=>{len+=chunk.length;if(len>limit){res.destroy();reject(Error('Repository JSON exceeds the 24 MB safety limit'));}else chunks.push(chunk);});
      res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value || !Array.isArray(value.apps))throw Error('JSON must contain an apps array');if(value.apps.length>MAX_APPS)throw Error('Repository exceeds the 10,000 app safety limit');resolve(value);}catch(e){reject(e);}});
      res.on('error',reject);
    });
    req.on('timeout',()=>req.destroy(Error('Repository request timed out')));
    req.on('error',reject);
  });
}
const html=fs.readFileSync(path.join(__dirname,'public','index.html'));
const toolsHtml=fs.readFileSync(path.join(__dirname,'public','tools.html'));
const ipaHtml=fs.readFileSync(path.join(__dirname,'dist','ipa.html'));
http.createServer(async(req,res)=>{
  const send=(status,type,data)=>{res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; object-src 'none'"});res.end(data)};
  const u=new URL(req.url,'http://localhost');
  if(req.method!=='GET')return send(405,'text/plain','Method not allowed');
  if(u.pathname==='/api/repo'){
    const raw=u.searchParams.get('url');if(!raw || raw.length>2048)return send(400,'application/json',JSON.stringify({error:'Enter a valid repository URL'}));
    try{return send(200,'application/json',JSON.stringify(await fetchJson(raw)));}
    catch(e){console.error('[repo-fetch]',new Date().toISOString(),e && e.stack || e);return send(400,'application/json',JSON.stringify({error:e.message}));}
  }
  if(u.pathname==='/ipa' || u.pathname==='/ipa.html')return send(200,'text/html; charset=utf-8',ipaHtml);
  if(u.pathname.startsWith('/assets/')){
    const filename=path.basename(u.pathname);
    if(!/^[a-zA-Z0-9_.-]+$/.test(filename))return send(404,'text/plain','Not found');
    try{const file=fs.readFileSync(path.join(__dirname,'dist','assets',filename));return send(200,filename.endsWith('.js')?'text/javascript; charset=utf-8':filename.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream',file)}catch{return send(404,'text/plain','Not found')}
  }
  if(u.pathname==='/tools' || u.pathname==='/tools.html')return send(200,'text/html; charset=utf-8',toolsHtml);
  if(u.pathname==='/health')return send(200,'text/plain','ok | RepoViewer '+APP_VERSION+' | '+BUILD_ID);
  if(u.pathname==='/' || u.pathname==='/index.html')return send(200,'text/html; charset=utf-8',html);
  return send(404,'text/plain','Not found');
}).listen(PORT,'0.0.0.0',()=>console.log('[RepoViewer] HTTP server listening on 0.0.0.0:'+PORT+' | version '+APP_VERSION+' | build '+BUILD_ID));
