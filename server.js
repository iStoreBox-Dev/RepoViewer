'use strict';
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const {spawnSync,spawn}=require('node:child_process');
const crypto=require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const APP_VERSION = '2.4.0';
const BUILD_ID = '2026-11-02-download-jobs';
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

const downloadEnabled=process.env.APPSTORE_DOWNLOAD_ENABLED==='true';
const jobLimit=20;
const jobs=new Map();
let runningJob=null;
const downloadDir=process.env.IPA_DOWNLOAD_DIR||'/tmp/repoviewer-ipa';
function workerReady(){
 if(!downloadEnabled)return {available:false,reason:'App Store download worker is disabled by the operator'};
 if(!process.env.APPSTORE_DOWNLOAD_TOKEN || process.env.APPSTORE_DOWNLOAD_TOKEN.length<32)return {available:false,reason:'Operator API token is not configured'};
 const result=spawnSync('ipatool',['--version'],{timeout:3000,encoding:'utf8'});
 if(result.error||result.status!==0)return {available:false,reason:'ipatool executable unavailable in this container'};
 if(!fs.existsSync(downloadDir))return {available:false,reason:'Download storage is not configured'};
 return {available:true,reason:'Local ipatool executable detected. Apple account authorization must be configured separately.'};
}
function publicJob(job){return {id:job.id,appId:job.appId,status:job.status,createdAt:job.createdAt,updatedAt:job.updatedAt,error:job.error||null,filename:job.filename||null}}
function startJob(job){
 runningJob=job.id;job.status='running';job.updatedAt=Date.now();
 const file=job.appId+'-'+job.id+'.ipa';
 const out=path.join(downloadDir,file);
 const child=spawn('ipatool',['download','-i',job.appId,'-o',out],{cwd:downloadDir,env:{...process.env,HOME:process.env.IPATOOL_HOME||'/tmp/ipatool'},stdio:['ignore','ignore','pipe']});
 let stderr='';
 child.stderr.on('data',part=>{stderr=(stderr+String(part)).slice(-1000)});
 child.on('error',err=>{job.status='failed';job.error='Downloader process could not start';job.updatedAt=Date.now();runningJob=null});
 child.on('close',code=>{if(job.status==='failed')return;job.updatedAt=Date.now();runningJob=null;if(code===0&&fs.existsSync(out)){job.status='complete';job.filename=file}else{job.status='failed';job.error='Download failed. Check worker authorization and environment.';try{fs.unlinkSync(out)}catch{}}});
}
function queueDownload(appId){
 if(jobs.size>=jobLimit){for(const [id,j] of jobs){if(j.status!=='running'){jobs.delete(id);break}}}
 const id=crypto.randomUUID();const job={id,appId,status:'queued',createdAt:Date.now(),updatedAt:Date.now()};
 jobs.set(id,job);startJob(job);return publicJob(job);
}

const html=fs.readFileSync(path.join(__dirname,'dist','app.html'));
const toolsHtml=html;
const ipaHtml=fs.readFileSync(path.join(__dirname,'dist','ipa.html'));
const utilitiesHtml=fs.readFileSync(path.join(__dirname,'dist','utilities.html'));
const labHtml=fs.readFileSync(path.join(__dirname,'dist','lab.html'));
const appleLookup=async(id,country)=>new Promise((resolve,reject)=>{const target='https://itunes.apple.com/lookup?id='+encodeURIComponent(id)+'&country='+encodeURIComponent(country)+'&entity=software';const req=https.get(target,{timeout:10000,headers:{Accept:'application/json','User-Agent':'RepoViewer/2.1'}},res=>{if(res.statusCode!==200){res.resume();return reject(Error('Apple lookup returned HTTP '+res.statusCode))}const chunks=[];let n=0;res.on('data',part=>{n+=part.length;if(n>2*1024*1024){res.destroy();reject(Error('Apple lookup response is too large'))}else chunks.push(part)});res.on('end',()=>{try{const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));const app=data.results?.find(x=>x.wrapperType==='software'||x.kind==='software');if(!app)return reject(Error('No app found for this ID in the selected storefront'));const allowed=['trackId','trackName','trackViewUrl','artistName','artistViewUrl','bundleId','version','minimumOsVersion','fileSizeBytes','description','releaseNotes','releaseDate','currentVersionReleaseDate','averageUserRating','userRatingCount','formattedPrice','price','currency','primaryGenreName','contentAdvisoryRating','artworkUrl100','artworkUrl512','screenshotUrls','ipadScreenshotUrls'];resolve(Object.fromEntries(allowed.filter(k=>app[k]!==undefined).map(k=>[k,app[k]])))}catch(e){reject(e)}});res.on('error',reject)});req.on('timeout',()=>req.destroy(Error('Apple lookup timed out')));req.on('error',reject)});
http.createServer(async(req,res)=>{
  const send=(status,type,data)=>{res.writeHead(status,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; object-src 'none'"});res.end(data)};
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/api/appstore/worker')return send(200,'application/json',JSON.stringify(workerReady()));
  if(u.pathname==='/api/appstore/download' && req.method==='POST'){
   const readiness=workerReady();if(!readiness.available)return send(503,'application/json',JSON.stringify({error:readiness.reason}));
   const supplied=req.headers['x-operator-token'];const expected=process.env.APPSTORE_DOWNLOAD_TOKEN;
   if(typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return send(403,'application/json',JSON.stringify({error:'Operator authorization required'}));
   if(runningJob)return send(409,'application/json',JSON.stringify({error:'Another download is already running'}));
   let body='';req.on('data',chunk=>{body+=chunk;if(body.length>2048)req.destroy()});req.on('end',()=>{try{const parsed=JSON.parse(body),id=String(parsed.id||'');if(!/^\\d{5,15}$/.test(id))return send(400,'application/json',JSON.stringify({error:'Invalid app ID'}));return send(202,'application/json',JSON.stringify({job:queueDownload(id)}))}catch{return send(400,'application/json',JSON.stringify({error:'Invalid request'}))}});return;
  }
  if(u.pathname==='/api/appstore/job'){
    const supplied=req.headers['x-operator-token'],expected=process.env.APPSTORE_DOWNLOAD_TOKEN||'';
    if(!expected||typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return send(403,'application/json',JSON.stringify({error:'Operator authorization required'}));
    const job=jobs.get(u.searchParams.get('id'));return job?send(200,'application/json',JSON.stringify({job:publicJob(job)})):send(404,'application/json',JSON.stringify({error:'Job not found'}));
  }
  if(req.method!=='GET')return send(405,'text/plain','Method not allowed');
  if(u.pathname==='/api/appstore/lookup'){const id=u.searchParams.get('id')||'',country=(u.searchParams.get('country')||'bh').toLowerCase();if(!/^\d{5,15}$/.test(id)||!/^[a-z]{2}$/.test(country))return send(400,'application/json',JSON.stringify({error:'Invalid App Store ID or country'}));try{return send(200,'application/json',JSON.stringify({app:await appleLookup(id,country)}))}catch(e){console.error('[appstore-lookup]',e.message);return send(502,'application/json',JSON.stringify({error:e.message}))}}
  if(u.pathname==='/api/repo'){
    const raw=u.searchParams.get('url');if(!raw || raw.length>2048)return send(400,'application/json',JSON.stringify({error:'Enter a valid repository URL'}));
    try{return send(200,'application/json',JSON.stringify(await fetchJson(raw)));}
    catch(e){console.error('[repo-fetch]',new Date().toISOString(),e && e.stack || e);return send(400,'application/json',JSON.stringify({error:e.message}));}
  }
  if(u.pathname==='/appstore' || u.pathname==='/appstore.html')return send(200,'text/html; charset=utf-8',labHtml);
  if(u.pathname==='/utilities' || u.pathname==='/utilities.html')return send(200,'text/html; charset=utf-8',utilitiesHtml);
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
