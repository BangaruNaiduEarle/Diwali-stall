import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser, delay } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

test('Users role controls use explicit updates, role policy and scoped feedback', async t => {
  const source = await readFile(new URL('./AdminUsersPage.jsx', import.meta.url), 'utf8')
  const names = source.match(/import\s*{([^}]+)}\s*from '\.\.\/api\/adminApi\.js'/)[1].split(',').map(name => name.trim()).filter(Boolean)
  const users = ['super_admin', 'owner', 'admin'].map((role, i) => ({ id: ['super', 'owner', 'staff'][i], email: ['super@test.com', 'owner@test.com', 'staff@test.com'][i], role, disabled: false }))
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import Page from './src/admin/pages/AdminUsersPage.jsx';
    window.users=${JSON.stringify(users)};window.calls=[];window.pending=[];window.readOnly=false;
    window.session={email:'super@test.com',permissionRole:'super_admin',contextKey:'stall-a',seasonStatus:'active',locationModeEnabled:true,location:{name:'Stall A'}};
    window.api=(name,args)=>{window.calls.push({name,args});if(name==='fetchAdminUsers')return Promise.resolve({ok:true,users:window.users});return new Promise(resolve=>window.pending.push(resolve))};
    const root=createRoot(document.getElementById('root'));let tick=0;window.render=()=>root.render(React.createElement(Page,{tick:++tick}));window.render();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'controlled-role-apis', setup(b) {
    b.onResolve({ filter: /(?:adminApi\.js|adminOffline\.js|AdminSessionContext\.jsx|useAdminSeasonReadOnly\.js)$/ }, args => ({ path: args.path, namespace: 'controlled' }))
    b.onLoad({ filter: /.*/, namespace: 'controlled' }, ({ path: p }) => ({ loader: 'js', contents:
      p.endsWith('adminApi.js') ? names.map(name => `export const ${name}=(...args)=>window.api('${name}',args)`).join('\n') :
      p.endsWith('adminOffline.js') ? 'export const fetchBillingPermissions=async()=>({ok:true,permissions:[]});export const setBillingPermission=()=>{throw Error("Unexpected billing mutation")}' :
      p.endsWith('AdminSessionContext.jsx') ? 'export const useAdminSession=()=>window.session' :
      'export const useAdminSeasonReadOnly=()=>({isReadOnly:window.readOnly})',
    }))
  } }], })
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const browser = new Browser('user-roles', await mkdtemp(path.join(tmpdir(), 'diwali-user-roles-')), port, [])
  browser.intercept = p => browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  const select = email => `document.querySelector('[aria-label="Role for ${email}"]')`
  const update = email => browser.eval(`Array.from(${select(email)}.closest('td').querySelectorAll('button')).find(b=>b.textContent.trim()==='Update role').click()`)
  const choose = (email, role) => browser.eval(`{const el=${select(email)};el.value='${role}';el.dispatchEvent(new Event('change',{bubbles:true}))}`)
  try {
    await browser.launch()
    await browser.eval("document.body.innerHTML='<div id=\"root\"></div>'")
    await browser.eval(bundle.outputFiles[0].text)
    await t.test('Super Admin sees eligible roles in Actions and saves with pending/success states and list refresh', async () => {
      await browser.wait(`Boolean(${select('staff@test.com')})`)
      assert.equal(await browser.eval(`${select('staff@test.com')}.value`), 'admin')
      assert.equal(await browser.eval(`${select('staff@test.com')}.closest('td').cellIndex`), 3)
      assert.deepEqual(await browser.eval(`Array.from(${select('staff@test.com')}.options,o=>o.value)`), ['admin', 'super_admin'])
      assert.equal(await browser.eval(`Boolean(${select('super@test.com')})`), false)
      assert.equal(await browser.eval(`Boolean(${select('owner@test.com')})`), false)
      await choose('staff@test.com', 'super_admin')
      assert.equal(await browser.eval('window.calls.some(c=>c.name==="updateAdminUserRole")'), false)
      await update('staff@test.com')
      await browser.wait('window.pending.length===1')
      assert.deepEqual(await browser.eval('window.calls.at(-1).args'), ['staff', 'super_admin'])
      assert.equal(await browser.eval(`${select('staff@test.com')}.disabled`), true)
      await browser.eval("window.users[2].role='super_admin';window.pending[0]({ok:true,user:window.users[2]})")
      await browser.wait('document.body.textContent.includes("Role updated for staff@test.com")')
      await browser.wait('window.calls.filter(c=>c.name==="fetchAdminUsers").length===2')
      assert.equal(await browser.eval(`${select('staff@test.com')}.value`), 'super_admin')
    })
    await t.test('Owner cannot offer Super Admin promotions and backend failures remain visible', async () => {
      await browser.eval("window.users[2].role='admin';window.session={...window.session,permissionRole:'owner',email:'owner@test.com'};window.render()")
      await browser.wait(`Boolean(${select('staff@test.com')}) && ${select('staff@test.com')}.value==='admin'`)
      assert.deepEqual(await browser.eval(`Array.from(${select('staff@test.com')}.options,o=>o.value)`), ['admin', 'owner'])
      assert.equal(await browser.eval(`Boolean(${select('owner@test.com')})`), false)
      const create = await browser.eval('Array.from(document.querySelector("form select:last-of-type").options,o=>o.value)')
      assert.equal(create.includes('super_admin'), false)
      await choose('staff@test.com', 'owner'); await update('staff@test.com')
      await browser.wait('window.pending.length===2')
      await browser.eval("window.pending[1]({ok:false,message:'Membership changed; refresh and retry.'})")
      await browser.wait('document.body.textContent.includes("Membership changed; refresh and retry.")')
      assert.equal(await browser.eval(`${select('staff@test.com')}.disabled`), false)
      assert.equal(await browser.eval('window.users[2].role'), 'admin')
    })
    await t.test('stale role responses cannot affect a newly selected stall', async () => {
      await update('staff@test.com')
      await browser.wait('window.pending.length===3')
      await browser.eval("window.session={...window.session,contextKey:'stall-b',location:{name:'Stall B'}};window.users=[];window.render()")
      await browser.wait('document.body.textContent.includes("Stall B") && !document.querySelector("tbody tr")')
      await browser.eval('window.pending[2]({ok:true})')
      await delay(100)
      assert.equal(await browser.eval('document.body.textContent.includes("Role updated for staff@test.com")'), false)
    })
    await t.test('season-only Owners can choose Owner without offering Super Admin promotion', async () => {
      await browser.eval("window.users=[{id:'staff',email:'staff@test.com',role:'admin',disabled:false}];window.session={...window.session,contextKey:'season-only',locationModeEnabled:false};window.render()")
      await browser.wait(`Boolean(${select('staff@test.com')})`)
      assert.deepEqual(await browser.eval(`Array.from(${select('staff@test.com')}.options,o=>o.value)`), ['admin', 'owner'])
    })
    await t.test('read-only and Admin actors have no role controls', async () => {
      await browser.eval("window.users=[{id:'staff',email:'staff@test.com',role:'admin',disabled:false}];window.session={...window.session,contextKey:'stall-c'};window.readOnly=true;window.render()")
      await browser.wait('Boolean(document.querySelector("tbody tr"))')
      assert.equal(await browser.eval('Boolean(document.querySelector("[aria-label^=\\"Role for\\"]"))'), false)
      await browser.eval("window.readOnly=false;window.session.permissionRole='admin';window.render()")
      await browser.wait('document.body.textContent.includes("Owner or Super Admin access required")')
      assert.equal(await browser.eval('Boolean(document.querySelector("table"))'), false)
      assert.equal(await browser.eval('window.calls.some(c=>c.name==="createAdminUser")'), false)
    })
  } finally { await browser.close() }
})
