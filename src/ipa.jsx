import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import JSZip from 'jszip';
import './ipa.css';
const MAX_SIZE=1024*1024*1024;
const MAX_METADATA=2*1024*1024;
function xmlPlist(bytes){
 const str=new TextDecoder().decode(bytes);
 if(!str.includes('<plist'))return null;
 const doc=new DOMParser().parseFromString(str,'application/xml');
 if(doc.querySelector('parsererror'))return null;
 const parse=node=>{
  if(!node)return null;
  switch(node.tagName){
   case 'string':case 'key':case 'date':return node.textContent;
   case 'integer':case 'real':return Number(node.textContent);
   case 'true':return true;case 'false':return false;
   case 'array':return [...node.children].map(parse);
   case 'dict':{const o={};const children=[...node.children];for(let i=0;i<children.length-1;i+=2){if(children[i].tagName==='key')o[children[i].textContent]=parse(children[i+1])}return o}
   default:return null;
  }
 };
 return parse(doc.querySelector('plist > dict'));
}
const friendly=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';
function Inspector(){
 const[file,setFile]=useState(null),[details,setDetails]=useState(null),[entries,setEntries]=useState([]),[query,setQuery]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[expanded,setExpanded]=useState(false);
 async function inspect(f){
  setFile(f);setDetails(null);setEntries([]);setError('');setQuery('');
  if(!f)return;
  if(f.size>MAX_SIZE){setError('This IPA exceeds the 1 GB browser inspection limit.');return}
  setLoading(true);
  try{
   const zip=await JSZip.loadAsync(f,{checkCRC32:false});
   const files=Object.values(zip.files).filter(x=>!x.dir);
   if(files.length>30000)throw Error('Archive has too many entries to inspect safely.');
   const listing=files.map(x=>({path:x.name,size:x._data?.uncompressedSize||0})).sort((a,b)=>a.path.localeCompare(b.path));
   const metadata=files.find(x=>/^Payload\/[^/]+\.app\/Info\.plist$/.test(x.name));
   if(!metadata)throw Error('No Payload/*.app/Info.plist found. This does not look like an iOS IPA.');
   const length=metadata._data?.uncompressedSize||0;
   if(length>MAX_METADATA)throw Error('Info.plist exceeds the 2 MB metadata limit.');
   const data=await metadata.async('uint8array');
   const plist=xmlPlist(data);
   const provisioning=files.some(x=>/\/embedded\.mobileprovision$/.test(x.name));
   const binary=!plist && new TextDecoder().decode(data.slice(0,8))==='bplist00';
   setDetails({plist,binary,appPath:metadata.name.split('/Info.plist')[0],files:files.length,provisioning,compressedSize:f.size});
   setEntries(listing);
  }catch(e){setError(e.message||'Could not inspect archive.')}
  finally{setLoading(false)}
 }
 const p=details?.plist||{};
 const filtered=entries.filter(x=>x.path.toLowerCase().includes(query.toLowerCase())).slice(0,expanded?1500:120);
 const row=(name,value)=>value!==undefined&&value!==null&&value!==''?<div className="info"><span>{name}</span><strong>{String(value)}</strong></div>:null;
 return <div className="app"><header><a href="/" className="brand">◈ RepoViewer</a><nav><a href="/tools">iOS Tools</a><a href="/">Browse apps</a></nav></header><nav className="rv-nav" aria-label="Main navigation"><a href="/" aria-current={location.pathname==='/'?'page':undefined} className="nav-discover">Discover</a><a href="/tools" aria-current={location.pathname==='/tools'?'page':undefined}>Profiles</a><a href="/ipa" aria-current={location.pathname==='/ipa'?'page':undefined}>IPA Inspector</a><a href="/utilities" aria-current={location.pathname==='/utilities'?'page':undefined}>Developer Utilities</a></nav><main><div className="hero"><div className="tag">DEVICE-LOCAL IPA ANALYSIS</div><h1>Look inside an IPA.</h1><p>Explore application bundles and review metadata before installing. The IPA stays in your browser.</p></div><section className="drop"><input type="file" accept=".ipa,.zip,application/zip" id="ipa-file" onChange={e=>inspect(e.target.files?.[0])}/><label htmlFor="ipa-file"><span className="uploadIcon">↥</span><strong>{file?file.name:'Choose an IPA file'}</strong><small>{file?friendly(file.size):'Select an IPA or ZIP file from your device'}</small></label></section>{loading&&<div className="message" role="status">Reading IPA archive locally…</div>}{error&&<div className="message error" role="alert">{error}</div>}{details&&<><div className="stats"><article><small>ARCHIVE ENTRIES</small><strong>{details.files.toLocaleString()}</strong></article><article><small>IPA SIZE</small><strong>{friendly(details.compressedSize)}</strong></article><article><small>PROVISIONING FILE</small><strong>{details.provisioning?'Present':'Not found'}</strong></article></div><section className="panel"><h2>Application information</h2>{details.binary?<p className="message">Binary Info.plist detected. File structure is available, but this version does not decode binary plist metadata yet. No app identity is inferred.</p>:details.plist?<div className="infoGrid">{row('App name',p.CFBundleDisplayName||p.CFBundleName)}{row('Bundle identifier',p.CFBundleIdentifier)}{row('Version',p.CFBundleShortVersionString)}{row('Build',p.CFBundleVersion)}{row('Minimum iOS',p.MinimumOSVersion)}{row('Executable',p.CFBundleExecutable)}{row('Bundle type',p.CFBundlePackageType)}</div>:<p className="message">Info.plist could not be parsed. Archive entries are still available.</p>}<p className="note">Metadata is publisher-provided, not verified. Provisioning-file presence does not prove signing validity.</p></section><section className="panel"><div className="row"><div><h2>Archive explorer</h2><p>Search bundled resources and embedded files.</p></div><span className="count">{entries.length.toLocaleString()} files</span></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search paths, e.g. Frameworks or .plist" aria-label="Search archive paths"/><div className="files">{filtered.map((x,i)=><div className="entry" key={x.path+i}><span title={x.path}>{x.path}</span><small>{friendly(x.size)}</small></div>)}{filtered.length===0&&<div className="message">No matching entries.</div>}</div>{entries.length>120&&!expanded&&<button className="button" onClick={()=>setExpanded(true)}>Show more files</button>}</section></>}<footer>Read-only local inspection · No IPA uploads · Avoid opening untrusted executables</footer></main></div>;
}
createRoot(document.getElementById('root')).render(<Inspector/>);
