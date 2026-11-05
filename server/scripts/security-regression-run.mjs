// Explicit safe suite/audit runner. Never invokes migration/integration lifecycle hooks.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,readdir,access} from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash} from 'node:crypto'

const root=path.resolve(process.argv[2]),mode=process.argv[3]
const manifest=JSON.parse(await readFile(path.join(root,'isolation.json'),'utf8'))
assert.equal(manifest.root,root);assert.ok(manifest.disposableDatabaseFile.startsWith(path.join(root,'persist')+path.sep));assert.notEqual(manifest.disposableDatabaseFile,manifest.original)
const run=promisify(execFile),cwd=path.resolve('.'),python='C:/Users/naidu/AppData/Local/Programs/Python/Python314/python.exe'
const packageFiles=['package.json','package-lock.json','server/package.json','server/package-lock.json']
const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex')
if(mode==='prepare'){
 const directory=path.join(root,'p7-'+crypto.randomUUID().slice(0,8));await mkdir(directory)
 await run(python,['server/scripts/security-regression-db.py',root,directory,'snapshot'],{windowsHide:true})
 const hashes=Object.fromEntries(await Promise.all(packageFiles.map(async f=>[f,await digest(f)])))
 await writeFile(path.join(directory,'inputs-before.json'),JSON.stringify({node:process.version,cwd,hashes},null,2),{flag:'wx'})
 await writeFile(path.join(root,'phase7-current.json'),JSON.stringify({directory}),{flag:'wx'});console.log(JSON.stringify({directory,snapshotCreated:true}));process.exit(0)
}
const {directory}=JSON.parse(await readFile(path.join(root,'phase7-current.json'),'utf8'));assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p7-'))
const rootPackage=JSON.parse(await readFile('package.json','utf8')),serverPackage=JSON.parse(await readFile('server/package.json','utf8'))
const scriptArgs=script=>{assert.ok(script.startsWith('node --test '));return script.split(' ').slice(1)}
const scopeFiles=(await readdir('server/tests')).filter(f=>/(Location|Season|Platform).*\.test\.js$/.test(f)&&!f.startsWith('auditLocationCompatibility')&&!f.includes('FamilyPack')).sort().map(f=>'server/tests/'+f)
const suites={
 backend:{cwd:path.join(cwd,'server'),args:scriptArgs(serverPackage.scripts['test:unit'])},
 scope:{cwd,args:['--test','--test-concurrency=1',...scopeFiles]},
 billing:{cwd,args:scriptArgs(rootPackage.scripts['test:handover'])},
 offline:{cwd,args:scriptArgs(rootPackage.scripts['test:offline'])},
 tooling:{cwd,args:['--test','--test-concurrency=1','server/tests/serverToolingCompatibility.test.js']},
 frontend:{cwd,args:['--test','--test-concurrency=1','src/admin/api/adminApi.billAdjustments.test.js','src/admin/api/adminApi.seasonSession.test.js','src/admin/api/adminLocationContext.test.js','src/admin/lib/adminRoles.test.js','src/admin/lib/billAdjustment.test.js','src/admin/lib/adminCustomerRequestInternalSummary.test.js']},
}
await writeFile(path.join(directory,'suite-plan.json'),JSON.stringify({suites,scopeExclusions:['auditLocationCompatibility.test.js (separate historical audit implementation suite)','FamilyPack scope files already covered by billing selection'],migrationHooksInvoked:false},null,2))
const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
async function execute(name,args,workingDirectory,kind){
 const started=new Date().toISOString();let result
 try{const value=await run(process.execPath,args,{cwd:workingDirectory,windowsHide:true,maxBuffer:25e6,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});result={exitCode:0,stdout:value.stdout,stderr:value.stderr}}
 catch(error){result={exitCode:typeof error.code==='number'?error.code:1,stdout:error.stdout??'',stderr:error.stderr??error.message}}
 await writeFile(path.join(directory,name+'.stdout.log'),result.stdout,{flag:'wx'});await writeFile(path.join(directory,name+'.stderr.log'),result.stderr,{flag:'wx'})
 const data={name,kind,started,finished:new Date().toISOString(),command:[process.execPath,...args],cwd:workingDirectory,exitCode:result.exitCode}
 if(kind==='audit'||kind==='tree'){
  try{const json=JSON.parse(result.stdout);await writeFile(path.join(directory,name+'.json'),JSON.stringify(json,null,2),{flag:'wx'});if(kind==='audit'){data.vulnerabilities=json.metadata?.vulnerabilities;data.auditError=json.error;data.status=result.exitCode===0&&json.metadata?.vulnerabilities?.total===0?'PASS':'FAIL'}else data.status=result.exitCode===0?'PASS':'FAIL'}catch(error){data.status='FAIL';data.parseError=error.message}
 }else{
  for(const key of ['tests','suites','pass','fail','cancelled','skipped','todo']){const m=result.stdout.match(new RegExp('^# '+key+' (\\d+)\\s*$','m'));data[key]=m?Number(m[1]):null}
  data.status=result.exitCode===0&&data.fail===0&&data.cancelled===0&&data.pass>0?'PASS':'FAIL'
 }
 await writeFile(path.join(directory,name+'-result.json'),JSON.stringify(data,null,2),{flag:'wx'});console.log(JSON.stringify(data));return data
}
if(mode==='audits'){
 await access(npmCli)
 const results=await Promise.all([
  execute('root-audit',[npmCli,'audit','--json','--offline=false','--prefer-online','--ignore-scripts'],cwd,'audit'),
  execute('server-audit',[npmCli,'audit','--json','--offline=false','--prefer-online','--ignore-scripts'],path.join(cwd,'server'),'audit'),
  execute('root-tree',[npmCli,'ls','--all','--json'],cwd,'tree'),
  execute('server-tree',[npmCli,'ls','--all','--json'],path.join(cwd,'server'),'tree'),
 ])
 if(results.some(r=>r.status!=='PASS'))process.exitCode=1
}else if(suites[mode]){const s=suites[mode];if((await execute(mode,s.args,s.cwd,'suite')).status!=='PASS')process.exitCode=1}
else if(mode==='verify-inputs'){
 const before=JSON.parse(await readFile(path.join(directory,'inputs-before.json'),'utf8')),hashes=Object.fromEntries(await Promise.all(packageFiles.map(async f=>[f,await digest(f)])))
 const result={status:JSON.stringify(before.hashes)===JSON.stringify(hashes)?'PASS':'FAIL',packageAndLockFilesUnchanged:JSON.stringify(before.hashes)===JSON.stringify(hashes),hashes}
 await writeFile(path.join(directory,'inputs-after.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));assert.equal(result.status,'PASS')
}else throw Error('Select prepare, audits, backend, scope, billing, offline, tooling, frontend or verify-inputs')
