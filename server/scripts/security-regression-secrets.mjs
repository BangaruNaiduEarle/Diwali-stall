// Read-only scan; secret values and matching source lines are never printed or copied.
import assert from 'node:assert/strict'
import {readFile,writeFile,readdir,stat} from 'node:fs/promises'
import path from 'node:path'
const root=path.resolve(process.argv[2]),{directory}=JSON.parse(await readFile(path.join(root,'phase7-current.json'),'utf8'))
assert.ok(directory.startsWith(root+path.sep)&&path.basename(directory).startsWith('p7-'))
const env=await readFile(path.join(root,'.dev.vars'),'utf8'),match=env.match(/HANDOVER_SIGNING_JWK='([^']+)'/)
assert.ok(match,'Missing known isolated server signing key')
const jwk=JSON.parse(match[1]);assert.equal(jwk.kty,'EC');assert.equal(jwk.crv,'P-256');assert.ok(jwk.d)
const protectedValues=new Map([[jwk.d,'isolated-server-root-private-scalar'],[match[1],'isolated-server-private-JWK']])
const credentialSources=[]
function credentials(data){if(Array.isArray(data)){for(const value of data)credentials(value);return}if(!data||typeof data!=='object')return;for(const [key,value]of Object.entries(data)){if(['password','cookie','deviceToken'].includes(key)&&typeof value==='string'&&value.length>12)protectedValues.set(value,'isolated-fixture-'+key);else if(value&&typeof value==='object')credentials(value)}}
for(const relative of ['fixture-actors.json','fixture-actors-authenticated.json']){try{credentials(JSON.parse(await readFile(path.join(root,relative),'utf8')));credentialSources.push(relative)}catch(error){if(error.code!=='ENOENT')throw error}}
const qrFiles=[]
for(const phase of [2,3,4,5,6]){
 try{const pointer=JSON.parse(await readFile(path.join(root,'phase'+phase+'-current.json'),'utf8'));assert.ok(pointer.directory.startsWith(root+path.sep));credentials(JSON.parse(await readFile(path.join(pointer.directory,'state.json'),'utf8')));credentialSources.push('phase'+phase+' fixture state');if(phase===6){const p=JSON.parse(await readFile(path.join(pointer.directory,'browser-progress.json'),'utf8'));for(const name of ['normal','mixed'])qrFiles.push({label:'phase6-'+name+'-QR',text:JSON.stringify(p.saved[name].envelope)})}}catch(error){if(error.code!=='ENOENT')throw error}
}
const roots=[path.resolve('src'),path.resolve('public'),path.resolve('dist'),path.join(root,'frontend-dist')],files=[]
async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const f=path.join(folder,entry.name);if(entry.isDirectory())await walk(f);else if(entry.isFile())files.push(f)}}
const scannedRoots=[]
for(const folder of roots){try{assert.ok((await stat(folder)).isDirectory());await walk(folder);scannedRoots.push(folder)}catch(error){if(error.code!=='ENOENT')throw error}}
const findings=[],genericPatterns=[['private-key-PEM',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['AWS-access-key-literal',/\bAKIA[A-Z0-9]{16}\b/],['npm-token-literal',/\bnpm_[A-Za-z0-9]{36}\b/]]
for(const file of files){const bytes=await readFile(file),text=bytes.toString('utf8');for(const [value,kind]of protectedValues)if(bytes.includes(Buffer.from(value)))findings.push({file,kind});for(const [kind,pattern]of genericPatterns)if(pattern.test(text))findings.push({file,kind})}
const qr=[]
for(const item of qrFiles){const unsafeNames=/"(?:d|purchasePricePaise|purchase_unit_paise|profitPaise|margin|deviceToken|password|privateKey|final_price_paise)"\s*:/.test(item.text);const knownSecret=[...protectedValues.keys()].some(value=>item.text.includes(value));qr.push({artifact:item.label,unsafeFieldsAbsent:!unsafeNames,knownSecretsAbsent:!knownSecret});if(unsafeNames||knownSecret)findings.push({file:item.label,kind:'unsafe-QR-field-or-secret'})}
const service=await readFile('server/src/services/adminHandover.js','utf8'),sourceBoundaries={rootLoadedOnlyFromServerEnvironment:service.includes('JSON.parse(env.HANDOVER_SIGNING_JWK)'),preparationReturnsPublicRootAndCertificate:service.includes('rootKey, certificate:'),adminPrivateCatalogueNotPopulated:service.includes("['owner','super_admin'].includes(scope.effectiveRole)")}
assert.ok(Object.values(sourceBoundaries).every(Boolean))
const result={status:findings.length?'FAIL':'PASS',roots:scannedRoots,filesScanned:files.length,knownSecretValuesChecked:protectedValues.size,credentialSources,findings,qr,sourceBoundaries,serverSecretValuesLogged:false,originalEnvOrProductionSecretsRead:false,limitations:['Known isolated signing/fixture values and high-confidence literal patterns only; not proof about unknown production secrets.','Per-device non-exportable keys and tokens intentionally remain in scoped browser storage; Owner private snapshots are not server-only.','Production HTTPS/deployment configuration and account secrets were not accessed.']}
const output=path.join(directory,'secret-boundaries.json');await writeFile(output,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({output,status:result.status,filesScanned:result.filesScanned,knownValues:protectedValues.size,findings:findings.length,qrArtifacts:qr.length}));assert.equal(result.status,'PASS')
