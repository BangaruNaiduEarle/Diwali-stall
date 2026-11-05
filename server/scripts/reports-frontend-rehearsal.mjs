import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import { build as buildWorker } from 'esbuild'
import { Miniflare } from 'miniflare'
import { build as buildFrontend } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { pwaShellPlugin } from '../../scripts/pwaShellPlugin.js'
import { reportFields, reportValue } from '../../src/admin/lib/reports.js'


const root='C:/Users/naidu/AppData/Local/Temp/diwali-release-b38657123a324f3a9e7c02c159b82c79'
const mode=process.argv[2],run=promisify(execFile)
const directory=mode==='prepare'?path.join(root,'reports-ui-'+crypto.randomUUID().slice(0,8)):path.resolve(process.argv[3])
assert.ok(directory.startsWith(path.resolve(root)+path.sep)&&path.basename(directory).startsWith('reports-ui-'))
const file=name=>path.join(directory,name),save=(name,value)=>writeFile(file(name),JSON.stringify(value,null,2))
const inspect=async operation=>{const r=await run('C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe',['server/scripts/reports-frontend-db.py',directory,operation],{windowsHide:true});console.log(r.stdout.trim())}
let state
if(mode==='prepare'){
  await mkdir(directory)
  const sourceDirectory=path.join(root,'chain-687017a4'),source=JSON.parse(await readFile(path.join(sourceDirectory,'state.json'),'utf8'))
  state={sourceDatabase:source.databaseFile,databaseId:crypto.randomUUID(),actors:source.actors,password:source.password,a:source.a,b:source.b,season:source.season,otherSeason:source.otherSeason}
  const runtime=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-01',port:0,host:'127.0.0.1',
    d1Databases:{DB:state.databaseId},d1Persist:file('persist/v3/d1'),cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false})
  try {const db=await runtime.getD1Database('DB');await db.prepare('SELECT 1').first()}finally{await runtime.dispose()}
  const data=file('persist/v3/d1/miniflare-D1DatabaseObject'),names=(await readdir(data)).filter(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')
  assert.equal(names.length,1);state.databaseFile=path.join(data,names[0]);await save('state.json',state);await inspect('clone')
  console.log(JSON.stringify({directory,migrationsApplied:false}));process.exit(0)
}else state=JSON.parse(await readFile(file('state.json'),'utf8'))
if(mode==='build'){
  await buildFrontend({configFile:false,envDir:false,root:process.cwd(),plugins:[react(),tailwindcss(),pwaShellPlugin()],
    define:{'import.meta.env.VITE_API_BASE_URL':'""'},build:{outDir:file('frontend-dist'),emptyOutDir:false},logLevel:'warn'})
  console.log('BUILD PASS '+file('frontend-dist'));process.exit(0)
}
if(mode==='verify'){await inspect('verify');process.exit(0)}
assert.ok(['browser','browser-resume'].includes(mode))
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(read,predicate,seconds=20){for(let n=0;n<seconds*10;n++){const value=await read();if(predicate(value))return value;await delay(100)}throw Error('Browser state timed out')}
let runtime,backend
const faults={failGet:false,holdGet:false,held:[],heldReady:false}
let traces=[],results=[]
if(mode==='browser-resume'){
  const prior=JSON.parse(await readFile(file('browser-results.json'),'utf8'));await save('browser-attempt-'+Date.now()+'.json',prior)
  results=prior.filter(row=>row.status==='PASS');traces=JSON.parse(await readFile(file('http-trace.json'),'utf8'))
}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost')
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk)
      const settings=url.pathname.startsWith('/api/admin/reports/'),method=req.method
      const trace={path:url.pathname,query:url.search,method,location:req.headers['x-admin-location-id'],season:req.headers['x-admin-season-id']};traces.push(trace)
      if(settings&&method==='GET'&&faults.failGet){faults.failGet=false;trace.status=503;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'fixture_network_failure',message:'Reports are temporarily unavailable.'}));return}
      const hold=settings&&method==='GET'&&faults.holdGet;if(hold)faults.holdGet=false
      const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(!['host','content-length','connection'].includes(key)&&value!=null)headers.set(key,String(value))
      const r=await fetch(new URL(req.url,backend),{method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),body=Buffer.from(await r.arrayBuffer());trace.status=r.status
      if(hold){faults.heldReady=true;await new Promise(resolve=>faults.held.push(resolve))}
      // Node fetch has already decoded a compressed Worker body.
      for(const [key,value]of r.headers)if(!['transfer-encoding','connection','content-length','content-encoding','set-cookie'].includes(key))res.setHeader(key,value)
      const cookies=r.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies)
      res.writeHead(r.status);res.end(body);return
    }
    const base=file('frontend-dist'),candidate=path.resolve(base,'.'+decodeURIComponent(url.pathname))
    assert.ok(candidate===path.resolve(base)||candidate.startsWith(path.resolve(base)+path.sep))
    let target=candidate
    try{if(!(await stat(target)).isFile())target=path.join(base,'index.html')}catch{target=path.join(base,'index.html')}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2'}
    res.setHeader('Content-Type',types[path.extname(target)]??'application/octet-stream');res.end(await readFile(target))
  }catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'test_proxy_failure',message:error.message}))}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin='http://127.0.0.1:'+server.address().port
const bundle=await buildWorker({entryPoints:[path.resolve('server/src/index.js')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false,logLevel:'silent'})
runtime=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-01',host:'127.0.0.1',port:0,d1Databases:{DB:state.databaseId},d1Persist:file('persist/v3/d1'),cachePersist:false,kvPersist:false,r2Persist:false,durableObjectsPersist:false,
  bindings:{ADMIN_LOCATION_MODE:true,ADMIN_LOCAL_DEV_AUTH:false,CORS_ALLOWED_ORIGINS:origin}})
backend=await runtime.ready
class Browser{
  constructor(actor,index){Object.assign(this,{actor,index,profile:file('browser-'+actor+'-'+crypto.randomUUID().slice(0,8)),sequence:0,pending:new Map(),errors:[]})}
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}))})}
  async launch(){
    const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
    this.chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--enable-automation','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port='+port,'--user-data-dir='+this.profile,'about:blank'],{windowsHide:true,stdio:'ignore'})
    const target=await until(async()=>{try{return await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json()}catch{return null}},v=>v?.webSocketDebuggerUrl)
    this.socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject})
    this.socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)}
      if(m.method==='Fetch.requestPaused'){const url=new URL(m.params.request.url);this.call(url.origin===origin||['about:','data:','blob:'].includes(url.protocol)?'Fetch.continueRequest':'Fetch.failRequest',{requestId:m.params.requestId,...(url.origin!==origin&&!['about:','data:','blob:'].includes(url.protocol)?{errorReason:'BlockedByClient'}:{})}).catch(()=>{})}
      if(m.method==='Runtime.exceptionThrown')this.errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description??''))}
    await this.call('Runtime.enable');await this.call('Page.enable');await this.call('Fetch.enable',{patterns:[{urlPattern:'*'}]})
    const commandLine=await this.call('Browser.getBrowserCommandLine');assert.ok(commandLine.arguments.includes('--user-data-dir='+this.profile))
  }
  async eval(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  wait(expression){return until(()=>this.eval(expression),Boolean)}
  async navigate(route){
    const link=route.startsWith('/admin/')&&route!=='/admin/login'&&await this.eval(`location.origin===${JSON.stringify(origin)}&&Boolean(document.querySelector('a[href='+JSON.stringify(${JSON.stringify(route)})+']'))`)
    if(link)await this.eval(`document.querySelector('a[href='+JSON.stringify(${JSON.stringify(route)})+']').click()`)
    else await this.call('Page.navigate',{url:origin+route})
    await this.wait(`location.pathname===${JSON.stringify(route)}&&document.readyState==='complete'`)
  }
  async click(label){await this.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.matches(':disabled'))throw Error('Button unavailable: '+${JSON.stringify(label)});b.click()})()`)}
  async field(label,value){await this.eval(`(()=>{const e=document.querySelector('[aria-label='+JSON.stringify(${JSON.stringify(label)})+']')||[...document.querySelectorAll('input')].find(e=>e.type===${JSON.stringify(label==='Email'?'email':'password')});if(!e)throw Error('Missing field '+${JSON.stringify(label)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
  async choose(value){await this.wait(`Array.from(document.querySelectorAll('select')).some(s=>[...s.options].some(o=>o.value===${JSON.stringify(value)}))`);await this.eval(`(()=>{const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value===${JSON.stringify(value)}));s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(200)}
  async ready(){await this.wait("Boolean(document.querySelector('[aria-label=\"Report results\"]'))")}
  async login(){await this.navigate('/admin/login');await this.wait("Boolean(document.querySelector('input[type=email]'))");await this.field('Email',state.actors[this.actor].email);await this.field('Password',state.password);await this.click('Sign in');await this.wait("location.pathname!=='/admin/login'");await this.choose(state.season);await this.choose(this.actor==='ownerB'?state.b:state.a);await this.navigate('/admin/reports');await this.ready()}
  async close(){if(this.socket?.readyState===1){await Promise.race([this.call('Browser.close').catch(()=>{}),delay(1500)]);this.socket.close()}this.chrome?.kill()}
}
const browsers=[],check=async(id,name,callback)=>{
  if(results.some(row=>row.id===id&&row.status==='PASS')){console.log('RETAIN '+id);return}
  try{const evidence=await callback();results.push({id,name,status:'PASS',evidence});console.log('PASS '+id)}
  catch(error){results.push({id,name,status:'FAIL',error:error.stack});throw error}
  finally{await save('browser-results.json',results);await save('http-trace.json',traces)}
}
const reportTypes=['sales-by-date','bills','collections','products','seasons','profit']
async function selectReport(browser,type){await browser.choose(type);await browser.wait(`document.querySelector('[aria-label="Report results"]')?.dataset.report===${JSON.stringify(type)}`)}
async function screenshot(browser,name){const shot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(file(name+'.png'),Buffer.from(shot.data,'base64'))}
async function api(browser,route){return browser.eval(`(async()=>{const r=await fetch('/api/admin/'+${JSON.stringify(route)},{headers:{'X-Admin-Location-Id':${JSON.stringify(state.a)},'X-Admin-Season-Id':${JSON.stringify(state.season)}}});return {status:r.status,data:await r.json()}})()`)}
try{
  for(const [index,actor]of ['owner','super','admin','ownerB'].entries()){const browser=new Browser(actor,index);browsers.push(browser);await browser.launch();await browser.login()}
  const [owner,superAdmin,admin,ownerB]=browsers
  await check('REPORT-UI-01','All six sections render actual scoped Worker data and unavailable historical/Family Pack profit',async()=>{
    const observed=[]
    for(const type of reportTypes){
      await selectReport(owner,type)
      const actual=await api(owner,'reports/'+type);assert.equal(actual.status,200)
      const displayed=await owner.eval("document.querySelector('[aria-label=\"Report results\"]').textContent")
      assert.ok(displayed.includes(type==='collections'?'Collected':type==='products'?'Saved lines':'Bills'))
      for(const field of reportFields(type,'summary','owner'))if(Object.hasOwn(actual.data.summary,field.key))assert.ok(displayed.includes(reportValue(actual.data.summary[field.key],field.type)),type+': '+field.key)
      if(type==='profit'){assert.equal(actual.data.summary.profitPaise,null);assert.ok(displayed.includes('Unavailable'));assert.ok(displayed.includes('Family Pack profit is unavailable'));assert.ok(displayed.includes('Known-subset'))}
      observed.push({type,status:actual.status,rows:actual.data.rows.length,total:actual.data.pagination.total})
      await screenshot(owner,'desktop-'+type)
    }
    return {observed,scope:{stall:state.a,season:state.season},screenshots:6}
  })
  await check('REPORT-UI-02','Admin projections, direct API denials, Super Admin and independent Owner B',async()=>{
    assert.deepEqual(await admin.eval("[...document.querySelector('[aria-label=Report]').options].map(o=>o.value)"),['bills','products'])
    for(const type of ['bills','products']){await selectReport(admin,type);const text=await admin.eval("document.querySelector('[aria-label=\"Report results\"]').textContent");assert.ok(!/Frozen purchase cost|Complete historical profit|Saved quotation adjustment|Known sales subset|Saved line gross/.test(text))}
    for(const type of ['sales-by-date','collections','seasons','profit'])assert.equal((await api(admin,'reports/'+type)).status,403)
    await selectReport(superAdmin,'profit');assert.ok(await superAdmin.eval("document.body.textContent.includes('Historical Profit Report')"))
    await selectReport(ownerB,'bills');const a=(await api(owner,'reports/bills')).data.rows[0].requestId
    const status=await ownerB.eval(`(async()=>{const r=await fetch('/api/admin/reports/bills?requestId='+${JSON.stringify(a)},{headers:{'X-Admin-Location-Id':${JSON.stringify(state.b)},'X-Admin-Season-Id':${JSON.stringify(state.season)}}});return r.status})()`);assert.equal(status,404)
    await screenshot(admin,'admin-products');return {adminChoices:2,privilegedDirectRequests:403,foreignBill:404,superProfit:true,independentProfiles:4}
  })
  await check('REPORT-UI-03','Date windows, empty/reset and payment/product filters use existing API parameters',async()=>{
    await selectReport(owner,'bills');await owner.field('Start date (included)','2099-01-01');await owner.field('End date (excluded)','2099-01-02');await owner.click('Apply report filters');await owner.ready()
    assert.ok(await owner.eval("document.body.textContent.includes('No recorded results match these filters.')"))
    assert.ok(traces.some(t=>t.query?.includes('from=2099-01-01')&&t.query.includes('toExclusive=2099-01-02')&&t.status===200))
    await screenshot(owner,'empty-date-window');await owner.click('Reset filters');await owner.ready()
    assert.ok(!(await owner.eval("document.querySelector('[aria-label=\"Report results\"]').textContent")).includes('No recorded results'))
    await selectReport(owner,'collections');await owner.choose('occurred');await owner.choose('UPI');await owner.choose('OFFLINE');await owner.click('Apply report filters');await owner.ready()
    assert.ok(traces.some(t=>t.query?.includes('dateBasis=occurred')&&t.query.includes('paymentMethod=UPI')&&t.query.includes('recordingMode=OFFLINE')))
    await selectReport(owner,'products');const packId=(await api(owner,'reports/products')).data.rows.find(row=>row.lineType==='family_pack').familyPackId
    await owner.field('Family Pack ID',packId);await owner.choose('box');await owner.click('Apply report filters');await owner.ready()
    assert.ok(traces.some(t=>t.query?.includes('familyPackId='+packId)&&t.query.includes('unitType=box')))
    assert.ok(await owner.eval(`document.querySelector('[aria-label="Report results"]').textContent.includes(${JSON.stringify(packId)})`))
    return {halfOpenDateQuery:true,emptyThenReset:true,paymentBasisMethodMode:true,productPackUnit:true}
  })
  await check('REPORT-UI-04','Pagination preserves server totals and loads independent rows',async()=>{
    await selectReport(owner,'bills');await owner.choose('1');await owner.click('Apply report filters');await owner.ready()
    const first=await owner.eval("document.querySelector('article[aria-label=\"Report row 1\"]').textContent")
    assert.ok(await owner.eval("document.body.textContent.includes('Page 1 of 2')"));await owner.click('Next report page');await owner.ready()
    assert.ok(await owner.eval("document.body.textContent.includes('Page 2 of 2')"));assert.notEqual(await owner.eval("document.querySelector('article[aria-label=\"Report row 1\"]').textContent"),first)
    assert.equal(await owner.eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Next report page').disabled"),true)
    await owner.click('Previous report page');await owner.ready();assert.equal(await owner.eval("document.querySelector('article[aria-label=\"Report row 1\"]').textContent"),first)
    return {rowsPerPage:1,pages:2,serverTotalsUnchanged:true}
  })
  await check('REPORT-UI-05','Loading/error/retry and interrupted late A response cannot populate B',async()=>{
    faults.failGet=true;await owner.click('Apply report filters');await owner.wait("document.body.textContent.includes('Reports are temporarily unavailable.')")
    assert.equal(await owner.eval("Boolean(document.querySelector('[aria-label=\"Report results\"]'))"),false)
    await owner.click('Retry reports');await owner.ready()
    faults.holdGet=true;await owner.click('Apply report filters');await until(()=>Promise.resolve(faults.heldReady),Boolean)
    assert.ok(await owner.eval("document.body.textContent.includes('Loading selected stall report')"))
    const a=(await api(superAdmin,'reports/bills')).data.rows[0].requestId
    await owner.choose(state.b);await owner.ready();assert.deepEqual(await owner.eval("[...document.querySelector('[aria-label=Report]').options].map(o=>o.value)"),['bills','products'])
    faults.held.splice(0).forEach(resolve=>resolve());await delay(400)
    assert.ok(!(await owner.eval("document.querySelector('[aria-label=\"Report results\"]').textContent")).includes(a))
    assert.equal(await owner.eval("document.querySelector('[aria-label=\"Rows per page\"]').value"),'25')
    await screenshot(owner,'stall-b-after-delayed-a');await owner.choose(state.a);await owner.ready()
    return {loadErrorHiddenOldResults:true,retry:true,loading:true,lateResponseIgnored:true,scopeFiltersReset:true,lesserRoleApplied:true}
  })
  await check('REPORT-UI-06','Season selector refreshes data without broadening scope',async()=>{
    await selectReport(owner,'seasons');await owner.choose(state.otherSeason);await owner.ready();await selectReport(owner,'seasons')
    const selected=await owner.eval("document.querySelector('[aria-label=\"Report results\"]').textContent")
    assert.ok(selected.includes(state.otherSeason));assert.ok(!selected.includes('47,000'))
    assert.ok(traces.some(t=>t.path.startsWith('/api/admin/reports')&&t.season===state.otherSeason&&t.status===200))
    await owner.choose(state.season);await owner.choose(state.a);await owner.ready()
    return {otherSeason:state.otherSeason,headerRefresh:true,selectedSeasonOnly:true}
  })
  await check('REPORT-UI-07','Mobile layouts at 360px and 390px keep all six reports and navigation usable',async()=>{
    const layouts=[]
    for(const width of [360,390]){
      await owner.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true})
      for(const type of reportTypes){await selectReport(owner,type);const metrics=await owner.eval('({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})');assert.ok(metrics.scroll<=metrics.client+1,JSON.stringify({width,type,metrics}));layouts.push({width,type,...metrics});await screenshot(owner,'mobile-'+width+'-'+type)}
    }
    await owner.call('Emulation.clearDeviceMetricsOverride');return {layouts,screenshots:12,physicalAndroid:'NOT TESTED'}
  })
  await check('REPORT-UI-08','Displayed summary and line values match server values for all six reports',async()=>{
    const observations=[]
    for(const type of reportTypes){
      await selectReport(owner,type);const {data}=await api(owner,'reports/'+type)
      const rendered=await owner.eval(`(()=>{const pairs=container=>Object.fromEntries([...container.querySelectorAll('dl > div')].map(item=>[item.querySelector('dt').textContent,item.querySelector('dd').textContent]));const results=document.querySelector('[aria-label="Report results"]');return {summary:pairs(results.querySelector('.admin-panel')),rows:[...results.querySelectorAll('article')].map(pairs)}})()`)
      for(const field of reportFields(type,'summary','owner'))if(Object.hasOwn(data.summary,field.key))assert.equal(rendered.summary[field.label],reportValue(data.summary[field.key],field.type),type+': '+field.key)
      assert.equal(rendered.rows.length,data.rows.length)
      for(const [index,row]of data.rows.entries())for(const field of reportFields(type,'columns','owner'))if(Object.hasOwn(row,field.key))assert.equal(rendered.rows[index][field.label],reportValue(row[field.key],field.type),type+': '+field.key)
      observations.push({type,rows:data.rows.length,summaryAndRowsMatch:true})
    }
    return observations
  })
  await check('REPORT-UI-09','Existing workspace, billing/settings screens and mobile Reports navigation still load',async()=>{
    await owner.navigate('/admin/business');await owner.wait("Boolean(document.querySelector('h1'))")
    await owner.navigate('/admin/quick-bill');await owner.wait("document.querySelector('.admin-page__title')?.textContent.toLowerCase().includes('quick bill')")
    await owner.navigate('/admin/settings');await owner.wait("Boolean(document.querySelector('form[aria-label=\"Stall settings form\"]'))")
    await owner.call('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true})
    await owner.click('Menu');await owner.wait("Boolean(document.querySelector('dialog[open] a[href=\"/admin/reports\"]'))")
    await screenshot(owner,'mobile-reports-navigation')
    await owner.eval("document.querySelector('dialog[open] a[href=\"/admin/reports\"]').click()")
    await owner.ready();assert.equal(await owner.eval("Boolean(document.querySelector('dialog[open]'))"),false)
    await owner.call('Emulation.clearDeviceMetricsOverride')
    return {workspaceLoaded:true,quickBillLoaded:true,settingsLoaded:true,mobileReportsLink:true,financialWrites:0}
  })
  assert.ok(browsers.every(browser=>browser.errors.length===0),JSON.stringify(browsers.map(b=>({actor:b.actor,errors:b.errors}))))
}catch(error){
  await save('startup-or-run-diagnostic-'+Date.now()+'.json',{error:error.stack,trace:traces,browsers:await Promise.all(browsers.map(async b=>({actor:b.actor,errors:b.errors,page:await b.eval('({url:location.href,text:document.body?.textContent?.slice(0,4000)})').catch(()=>null)})))})
  throw error
}finally{
  await save('browser-console.json',browsers.map(b=>({actor:b.actor,errors:b.errors})))
  faults.held.splice(0).forEach(resolve=>resolve())
  await Promise.allSettled(browsers.map(browser=>browser.close()))
  await runtime.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
}
await inspect('verify')
