import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { build } from '../../../server/node_modules/esbuild/lib/main.js'
import { Browser } from '../../../server/scripts/offline-qr-pack-browser-client.mjs'

test('Platform stall creation selects an existing Owner and has no password field', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Stall from './src/admin/components/PlatformCreateStallSection.jsx';
    const root=createRoot(document.getElementById('root'));
    window.openStall=()=>root.render(React.createElement(Stall));
    window.closeStall=()=>root.render(null);window.openStall();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'isolated-platform-ui', setup(b) {
      b.onResolve({ filter: /(?:adminPlatformApi\.js|AdminSessionContext\.jsx|react-router-dom)$/ }, args => ({ path: args.path, namespace: 'test' }))
      b.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: p }) => ({ loader: 'js', contents:
        p.endsWith('adminPlatformApi.js') ? `
          export async function fetchPlatformSeasonMembers(){return {ok:true,season:{status:'active'},members:[{userId:'owner-1',email:'owner@test.com',role:'owner'}]}}
          export async function createPlatformLocation(){throw Error('Unexpected creation call')}` :
        p.endsWith('AdminSessionContext.jsx') ? `
          export const useAdminSession=()=>({platformAdmin:true,locationModeEnabled:true,email:'owner@test.com',seasonSwitching:false,
            authorizedLocations:[{business:{id:'business-1',name:'Test business',type:'seasonal',status:'active'},
              operatingSeason:{id:'season-2026',status:'active'},association:{operatingYear:2026,status:'active'},location:{status:'active'}}]})` :
        'export const Link=({children})=>children',
      }))
    } }],
  })
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const browser = new Browser('platform-password-inspection', await mkdtemp(path.join(tmpdir(), 'diwali-platform-password-')), port, [])
  browser.intercept = p => browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  try {
    await browser.launch()
    await browser.eval(`document.body.innerHTML='<div id="root"></div>'`)
    await browser.eval(bundle.outputFiles[0].text)
    const loaded = `Array.from(document.querySelectorAll('select')).some(s=>s.value==='owner-1'&&!s.matches(':disabled'))`
    await browser.wait(loaded)
    assert.equal(await browser.eval(`Array.from(document.querySelectorAll('label')).some(l=>l.textContent.includes('Initial owner')&&l.querySelector('select')?.value==='owner-1')`), true)
    assert.equal(await browser.eval(`document.querySelectorAll('input[type="password"],input[autocomplete*="password"]').length`), 0)
    assert.equal(await browser.eval(`Array.from(document.querySelectorAll('input')).every(i=>i.closest('label')?.textContent.match(/Stall display name|Unique stall code/))`), true)
    await browser.eval(`document.querySelector('form').reset()`)
    assert.equal(await browser.eval(`document.querySelectorAll('input').length`), 2)
    await browser.eval('window.closeStall()')
    await browser.wait(`!document.querySelector('form')`)
    await browser.eval('window.openStall()')
    await browser.wait(loaded)
    assert.equal(await browser.eval(`document.querySelectorAll('input[type="password"],input[autocomplete*="password"]').length`), 0)
  } finally { await browser.close() }
})

test('Users Management and login password visibility', async t => {
  const sources = await Promise.all(['AdminUsersPage.jsx', 'AdminLoginPage.jsx'].map(name => readFile(new URL(name, import.meta.url), 'utf8')))
  const names = sources.flatMap(source => source.match(/import\s*{([^}]+)}\s*from '\.\.\/api\/adminApi\.js'/)[1].split(',').map(s => s.trim()).filter(Boolean))
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Users from './src/admin/pages/AdminUsersPage.jsx';import Login from './src/admin/pages/AdminLoginPage.jsx';
    window.session={permissionRole:'owner',email:'owner@test.com',status:'denied',seasonStatus:'active',locationModeEnabled:false,refreshSession:async()=>({ok:true})};
    window.calls=[];window.checks=[];window.page='users';const root=createRoot(document.getElementById('root'));
    window.renderPage=()=>root.render(React.createElement(window.page==='users'?Users:Login));window.renderPage();
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'password-ui-boundaries', setup(b) {
      b.onResolve({ filter: /(?:adminApi\.js|AdminSessionContext\.jsx|useAdminSeasonReadOnly\.js|adminApiMode\.js|react-router-dom)$/ }, args => ({ path: args.path, namespace: 'test' }))
      b.onLoad({ filter: /.*/, namespace: 'test' }, ({ path: p }) => ({ loader: 'js', contents:
        p.endsWith('adminApi.js') ? [...new Set(names)].map(name => `export async function ${name}(value,password){
          ${name === 'fetchAdminUsers' ? `return {ok:true,users:[{id:'u1',email:'staff@test.com',role:'admin',disabled:false}]}` :
            `window.calls.push('${name}');window.checks.push((password??value.password)==='Disposable-test-only-42');return {ok:true}`}
        }`).join('\n') :
        p.endsWith('AdminSessionContext.jsx') ? 'export const useAdminSession=()=>window.session' :
        p.endsWith('useAdminSeasonReadOnly.js') ? 'export const useAdminSeasonReadOnly=()=>({isReadOnly:false})' :
        p.endsWith('adminApiMode.js') ? 'export const isLocalViteProxyMode=()=>false' :
        `const navigate=()=>{};export const useNavigate=()=>navigate;export const useLocation=()=>({pathname:'/admin/login',state:null});export const Link=({children})=>children`,
      }))
    } }],
  })
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const browser = new Browser('password-ui', await mkdtemp(path.join(tmpdir(), 'diwali-password-ui-')), port, [])
  browser.intercept = p => browser.call('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  const setInput = (selector, value) => browser.eval(`{
    const input=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }`)
  const password = 'Disposable-test-only-42'
  const checkToggle = async selector => {
    assert.equal(await browser.eval(`document.querySelector(${JSON.stringify(selector)}).type==='password'`), true)
    await setInput(selector, password)
    await browser.eval(`document.querySelector(${JSON.stringify(selector)}).parentElement.querySelector('button').focus()`)
    await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 })
    await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await browser.wait(`document.querySelector(${JSON.stringify(selector)}).type==='text'`)
    assert.equal(await browser.eval(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(password)}`), true)
    assert.equal(await browser.eval(`document.querySelector(${JSON.stringify(selector)}).parentElement.querySelector('button').getAttribute('aria-label')==='Hide password'`), true)
    await browser.eval(`document.querySelector(${JSON.stringify(selector)}).parentElement.querySelector('button').click()`)
    await browser.wait(`document.querySelector(${JSON.stringify(selector)}).type==='password'`)
    assert.equal(await browser.eval(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(password)}`), true)
  }
  const click = text => browser.eval(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`)
  try {
    await browser.launch()
    await browser.call('Page.bringToFront')
    await browser.call('Emulation.setFocusEmulationEnabled', { enabled: true })
    await browser.eval(`document.body.innerHTML='<div id="root"></div>'`)
    await browser.eval(bundle.outputFiles[0].text)
    await browser.wait(`Boolean(document.querySelector('[placeholder="Temporary password"]'))`)
    await t.test('create user: hidden default, keyboard toggle, validation, submit and reset', async () => {
      const selector = '[placeholder="Temporary password"]'
      await checkToggle(selector)
      assert.equal(await browser.eval('window.calls.length'), 0)
      assert.equal(await browser.eval(`document.querySelector('${selector}').required && document.querySelector('${selector}').minLength===12`), true)
      await setInput('[placeholder="Email"]', 'new@test.com')
      await browser.eval(`document.querySelector('${selector}').parentElement.querySelector('button').click()`)
      await click('Create user')
      await browser.wait(`window.calls.includes('createAdminUser') && document.querySelector('${selector}').value===''`)
      assert.equal(await browser.eval('window.checks.every(Boolean)'), true)
      assert.equal(await browser.eval(`document.querySelector('${selector}').type==='password'`), true)
      await browser.eval(`document.querySelector('${selector}').parentElement.querySelector('button').click();document.querySelector('${selector}').closest('form').reset()`)
      await browser.wait(`document.querySelector('${selector}').type==='password'`)
    })
    await t.test('reset password: cancel/reopen and successful submit reset visibility', async () => {
      await click('Reset password')
      await browser.wait(`Boolean(document.querySelector('[autocomplete="new-password"]'))`)
      await checkToggle('[autocomplete="new-password"]')
      await browser.eval(`document.querySelector('[autocomplete="new-password"]').parentElement.querySelector('button').click()`)
      await click('Cancel')
      await browser.wait(`!document.querySelector('[autocomplete="new-password"]')`)
      await click('Reset password')
      await browser.wait(`Boolean(document.querySelector('[autocomplete="new-password"]'))`)
      assert.equal(await browser.eval(`document.querySelector('[autocomplete="new-password"]').type==='password' && document.querySelector('[autocomplete="new-password"]').value===''`), true)
      await setInput('[autocomplete="new-password"]', password)
      await click('Change password')
      await browser.wait(`window.calls.includes('resetAdminUserPassword') && !document.querySelector('[autocomplete="new-password"]')`)
      assert.equal(await browser.eval('window.checks.every(Boolean)'), true)
    })
    await t.test('Super Admin new-login form resets when closed; Admin cannot access forms', async () => {
      await browser.eval(`window.session.permissionRole='super_admin';window.session.locationModeEnabled=true;window.renderPage()`)
      await browser.wait(`Array.from(document.querySelectorAll('select')).some(s=>s.querySelector('[value="existing"]'))`)
      const select = `Array.from(document.querySelectorAll('select')).find(s=>s.querySelector('[value="existing"]'))`
      await browser.eval(`{const s=${select};s.value='new';s.dispatchEvent(new Event('change',{bubbles:true}))}`)
      await browser.wait(`Boolean(document.querySelector('[placeholder="Temporary password"]'))`)
      await checkToggle('[placeholder="Temporary password"]')
      await browser.eval(`document.querySelector('[aria-label="Show password"]').click();const s=${select};s.value='existing';s.dispatchEvent(new Event('change',{bubbles:true}))`)
      await browser.wait(`!document.querySelector('[placeholder="Temporary password"]')`)
      await browser.eval(`{const s=${select};s.value='new';s.dispatchEvent(new Event('change',{bubbles:true}))}`)
      await browser.wait(`document.querySelector('[placeholder="Temporary password"]')?.type==='password'`)
      await browser.eval(`window.session.permissionRole='admin';window.renderPage()`)
      await browser.wait(`document.body.textContent.includes('Owner or Super Admin access required')`)
      assert.equal(await browser.eval('document.querySelectorAll("input").length'), 0)
    })
    await t.test('login: preserves current-password autocomplete and submitted value; reset/remount hides', async () => {
      await browser.eval(`window.page='login';window.renderPage()`)
      await browser.wait(`Boolean(document.querySelector('[autocomplete="current-password"]'))`)
      await checkToggle('[autocomplete="current-password"]')
      await setInput('[autocomplete="username"]', 'test@test.com')
      await click('Sign in')
      await browser.wait(`window.calls.includes('loginAdmin')`)
      assert.equal(await browser.eval('window.checks.every(Boolean)'), true)
      await browser.eval(`document.querySelector('[aria-label="Show password"]').click();document.querySelector('form').reset()`)
      await browser.wait(`document.querySelector('[autocomplete="current-password"]').type==='password' && document.querySelector('[autocomplete="current-password"]').value===''`)
      await browser.eval(`window.page='users';window.renderPage()`)
      await browser.wait(`!document.querySelector('[autocomplete="current-password"]')`)
      await browser.eval(`window.page='login';window.renderPage()`)
      await browser.wait(`document.querySelector('[autocomplete="current-password"]')?.type==='password'`)
    })
  } finally { await browser.close() }
})
