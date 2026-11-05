import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
export const site='http://localhost:5193', worker='http://localhost:8793'
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export async function until(read,predicate,seconds=30) {for(let n=0;n<seconds*5;n++){const value=await read();if(predicate(value))return value;await delay(200)}throw Error('Timed out waiting for saved browser state')}

export class Browser {
  constructor(name,profile,port,trace){Object.assign(this,{name,profile,port,trace,sequence:0,pending:new Map(),blocked:new Set(),faults:[],held:[],suspended:true})}
  call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.sequence;this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}))})}
  async launch(){
    await mkdir(this.profile,{recursive:true})
    this.chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--remote-debugging-port='+this.port,'--user-data-dir='+this.profile,'about:blank'],{windowsHide:true,stdio:'ignore'})
    let target
    for(let i=0;i<100;i++){try{target=await(await fetch(`http://127.0.0.1:${this.port}/json/new?about:blank`,{method:'PUT'})).json();break}catch{await delay(100)}}
    if(!target)throw Error('Chrome startup failed: '+this.name)
    this.socket=new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject})
    this.socket.onmessage=event=>{
      const m=JSON.parse(event.data)
      if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result)}
      if(m.method==='Fetch.requestPaused')this.intercept(m.params).catch(error=>{this.trace.push({browser:this.name,interceptionError:error.message});this.call('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'}).catch(()=>{})})
    }
    await this.call('Page.enable');await this.call('Network.enable')
    await this.call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'},{urlPattern:worker+'/api/admin/offline/sync',requestStage:'Response'}]})
  }
  async intercept(p){
    const url=new URL(p.request.url),allowed=[site,worker].includes(url.origin)||['about:','data:','blob:'].includes(url.protocol)
    if(!allowed){this.blocked.add(url.origin);return this.call('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'})}
    const sync=url.pathname==='/api/admin/offline/sync'&&p.request.method==='POST'
    let op={};if(sync)try{op=JSON.parse(p.request.postData)}catch{/* preflight */}
    const response=p.responseStatusCode!=null||p.responseErrorReason!=null
    if(sync){
      const row={browser:this.name,time:Date.now(),stage:response?'response':'request',operationId:op.operationId,kind:op.kind,scope:op.scope,...(response?{status:p.responseStatusCode,error:p.responseErrorReason}:{})}
      if(response&&p.responseStatusCode===200){try{const body=await this.call('Fetch.getResponseBody',{requestId:p.requestId}),ack=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body);row.ack={operationId:ack.operationId,requestId:ack.requestId,revision:ack.revision,idempotentReplay:ack.idempotentReplay}}catch(error){row.bodyReadError=error.message}}
      this.trace.push(row)
      if(!response&&this.suspended){row.injectedFault='startup_synchronization_block';await this.call('Fetch.failRequest',{requestId:p.requestId,errorReason:'ConnectionClosed'});await this.offline(true);return}
      if(!response&&this.gate&&this.gate(op)){this.held.push({requestId:p.requestId,op:op.operationId,kind:op.kind,at:Date.now()});return}
      const fault=this.faults.find(f=>!f.used&&f.kind===op.kind&&f.stage===(response?'response':'request')&&(!response||p.responseStatusCode===200))
      if(fault){fault.used=true;fault.operationId=op.operationId;fault.ack=row.ack;row.injectedFault=fault.label;await this.call('Fetch.failRequest',{requestId:p.requestId,errorReason:'ConnectionClosed'});await this.offline(true);return}
    }
    return this.call('Fetch.continueRequest',{requestId:p.requestId})
  }
  async release(){this.gate=null;const held=this.held.splice(0);await Promise.all(held.map(p=>this.call('Fetch.continueRequest',{requestId:p.requestId})));return held.map(p=>({browser:this.name,operationId:p.op,kind:p.kind,heldAt:p.at,releasedAt:Date.now()}))}
  async eval(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value}
  async wait(expression,seconds=30){try{return await until(()=>this.eval(expression).catch(()=>false),Boolean,seconds)}catch{throw Error(this.name+' timed out: '+expression+' | '+(await this.eval('document.body.innerText')).slice(-1800))}}
  async click(text){await this.wait(`Array.from(document.querySelectorAll('button')).some(x=>x.textContent.trim()===${JSON.stringify(text)}&&!x.matches(':disabled'))`);await this.eval(`Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(text)}).click()`);await delay(50)}
  async field(label,value){await this.wait(`Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes(${JSON.stringify(label)})&&(l.querySelector('input,textarea,select')||document.getElementById(l.htmlFor)))`);await this.eval(`(()=>{const l=Array.from(document.querySelectorAll('label')).find(x=>x.textContent.includes(${JSON.stringify(label)}));const input=l.querySelector('input,textarea,select')??document.getElementById(l.htmlFor);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event(input.tagName==='SELECT'?'change':'input',{bubbles:true}))})()`)}
  async area(label,value){await this.eval(`(()=>{const input=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
  async saved(){await delay(50);await this.wait("document.body.textContent.includes('Draft saved on this device')&&!document.body.textContent.includes('Saving draft')")}
  async offline(value){await this.call('Network.emulateNetworkConditions',{offline:value,latency:0,downloadThroughput:-1,uploadThroughput:-1});await this.wait(`navigator.onLine===${!value}`)}
  async link(href){await this.wait(`Boolean(document.querySelector('a[href=${JSON.stringify(href)}]'))`);await this.eval(`document.querySelector('a[href=${JSON.stringify(href)}]').click()`)}
  async login(actor,state){
    await this.call('Page.navigate',{url:site+'/admin/login'})
    await this.wait("Boolean(document.querySelector('input[type=email]'))||location.pathname!=='/admin/login'")
    if(await this.eval("Boolean(document.querySelector('input[type=email]'))")){await this.field('Email',actor.email);await this.field('Password',actor.password);await this.click('Sign in');await this.wait("location.pathname!=='/admin/login'")}
    for(const value of [state.season,state.a]){
      await this.wait(`Array.from(document.querySelectorAll('select')).some(s=>Array.from(s.options).some(o=>o.value===${JSON.stringify(value)}))`)
      await this.eval(`(()=>{const s=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value===${JSON.stringify(value)}));s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
      await delay(250)
    }
    await this.link('/admin/offline');await this.wait("document.querySelector('h1')?.textContent==='Offline billing workspace'")
    const cookies=(await this.call('Network.getCookies',{urls:[worker]})).cookies
    actor.cookie=cookies.map(c=>c.name+'='+c.value).join('; ')
  }
  async prepare(qr=false){await this.click('Prepare / refresh selected stall for offline use');await this.wait("document.body.textContent.includes('Offline page reload is ready.')");if(qr)await this.qrPrepare()}
  async qrPrepare(){await this.click('Prepare / refresh secure QR handover online');await this.wait("document.body.textContent.includes('QR signing and verification are prepared')")}
  async snapshot(){return this.eval(`(async()=>{const names=['profiles','catalogues','drafts','outbox','versions','meta'];if(!(await indexedDB.databases()).some(d=>d.name==='diwali-offline-billing-v1'))return Object.fromEntries(names.map(n=>[n,[]]));return new Promise((resolve,reject)=>{const o=indexedDB.open('diwali-offline-billing-v1');o.onerror=()=>reject(o.error);o.onsuccess=()=>{const db=o.result;if(!names.every(n=>db.objectStoreNames.contains(n))){db.close();reject(Error('Offline storage is uninitialized'));return}const tx=db.transaction(names,'readonly'),q={};for(const n of names)q[n]=tx.objectStore(n).getAll();tx.onabort=()=>{db.close();reject(tx.error)};tx.oncomplete=()=>{resolve(Object.fromEntries(Object.entries(q).map(([n,r])=>[n,n==='outbox'?r.result.sort((a,b)=>a.order-b.order):r.result])));db.close()}}})})()`)}
  async queue(kind){const count=(await this.snapshot()).outbox.length,label={CREATE:'Queue request creation',EDIT:'Queue item adjustments',CLOSE:'Queue closure',PAYMENT:'Save payment to outbox'}[kind];await this.click(label);await until(()=>this.snapshot(),s=>s.outbox.length===count+1);await this.wait("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='New local request'&&!b.matches(':disabled'))");await this.saved()}
  async newDraft(name,products){await this.click('New local request');await this.saved();await this.field('Customer name',name);await this.saved();await this.field('Mobile','9876543210');await this.saved();for(const product of products){await this.field('Saved catalogue',product);await this.click('Add product');await this.saved()}await this.queue('CREATE')}
  async quantity(value){await this.field('Quantity',value);await this.saved()}
  async fresh(id){const before=new Set((await this.snapshot()).drafts.map(d=>d.draftId));await this.field('Request ID to save for offline work',id);await this.click('Save fresh revision as separate draft');await until(()=>this.snapshot(),s=>s.drafts.some(d=>d.requestId===id&&!before.has(d.draftId)));await this.wait("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='New local request'&&!b.matches(':disabled'))");await this.saved();await this.wait(`document.body.textContent.includes(${JSON.stringify(id)})`)}
  async sync(){await this.click('Synchronize pending operations')}
  async idle(){await this.wait("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Synchronize pending operations'&&!b.disabled)")}
  async close(){if(this.socket?.readyState===1){const exited=new Promise(resolve=>this.chrome.once('exit',resolve));await this.call('Browser.close').catch(()=>{});await Promise.race([exited,delay(4000)]);this.socket.close()}else this.chrome?.kill()}
}


