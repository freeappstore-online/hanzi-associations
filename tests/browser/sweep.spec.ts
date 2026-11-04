import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
const seed = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8')).associations[0]
const rows = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('yi.drafts.v1') || '{"drafts":[]}').drafts)
const copy = (page: Page) => page.getByRole('button', { name: 'Make this association yours ↗' }).click()
test('two initially open tabs retain independent drafts and newest same-ID edits', async ({ page, context }) => {
  const second = await context.newPage()
  await Promise.all([page.goto('/lookup'), second.goto('/lookup')])
  await copy(page); await copy(second)
  await expect.poll(async () => (await rows(page)).length).toBe(2)
  await expect.poll(() => second.getByRole('dialog').getByRole('textbox', { name: 'Describe the image' }).inputValue()).toBe(seed.description)
  const first = (await rows(page))[0]
  await page.getByRole('textbox', { name: 'Describe the image' }).fill('A newer first-tab description preserved across stale saves.')
  await expect.poll(async () => (await rows(page)).find((d: any) => d.id === first.id)?.description).toContain('newer first-tab')
  // Open the same ID in both tabs through actual Local drafts navigation.
  for (const p of [page, second]) {
    await p.getByRole('button', { name: 'Save draft', exact: true }).click()
    await p.goto('/')
    await p.getByRole('button', { name: 'Local drafts', exact: true }).click()
    await p.getByRole('button', { name: 'Revise association' }).first().click()
  }
  await page.getByRole('textbox', { name: 'Describe the image' }).fill('Latest same-ID edit from the first tab.')
  await expect.poll(async () => (await rows(page))[0].description).toBe('Latest same-ID edit from the first tab.')
  await second.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect.poll(async () => (await rows(page))[0].description).toBe('Latest same-ID edit from the first tab.')
  await second.close()
})
test('delayed backup import merges with edits made while file text is pending', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text
    File.prototype.text = async function() { const text = await original.call(this); await new Promise<void>(r => { (window as any).releaseImport = r }); return text }
  })
  await page.goto('/lookup'); await copy(page)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.goto('/'); await page.getByRole('button', { name: 'Local drafts', exact: true }).click()
  const old = (await rows(page))[0]
  await page.getByLabel('Import backup file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, drafts: [old, { ...old, id: 'imported' }] })) })
  await page.getByRole('button', { name: 'Revise association' }).click()
  await page.getByRole('textbox', { name: 'Describe the image' }).fill('Edited during the delayed import, keep this version.')
  await page.evaluate(() => (window as any).releaseImport())
  await expect.poll(async () => (await rows(page)).length).toBe(2)
  expect((await rows(page)).find((d: any) => d.id === old.id).description).toContain('Edited during')
})
test('blocked session getter preserves public browsing and secure connect reports storage error', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } }))
  await page.goto('/lookup'); await expect(page.getByRole('button', { name: 'Pronounce 椅子', exact: true })).toBeVisible()
  await page.goto('/profile')
  // Fail before authorization navigation even with metadata/registration available.
  await page.route('https://mcp.proagentstore.online/**', route => route.fulfill({ json: route.request().url().endsWith('/register') ? { client_id: 'synthetic', token_endpoint_auth_method: 'none' } : { issuer: 'https://mcp.proagentstore.online', authorization_endpoint: 'https://mcp.proagentstore.online/authorize', token_endpoint: 'https://mcp.proagentstore.online/token', registration_endpoint: 'https://mcp.proagentstore.online/register', code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] } }))
  await page.getByRole('button', { name: 'Connect PAGS', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Session storage is unavailable' })).toBeVisible()
})
for (const failure of ['corrupt', 'read', 'write', 'getter']) test(`draft ${failure} failure keeps work exportable without replacing storage`, async ({ page }) => {
  await page.addInitScript(failure => {
    if (failure === 'corrupt') localStorage.setItem('yi.drafts.v1', '{broken')
    if (failure === 'getter') Object.defineProperty(window, 'localStorage', { get() { throw Error('blocked') } })
    const read = Storage.prototype.getItem, write = Storage.prototype.setItem
    Storage.prototype.getItem = function(k) { if (failure === 'read' && k === 'yi.drafts.v1') throw Error('read'); return read.call(this, k) }
    Storage.prototype.setItem = function(k, v) { if (failure === 'write' && k === 'yi.drafts.v1') throw Error('quota'); return write.call(this, k, v) }
  }, failure)
  await page.goto('/lookup'); await copy(page)
  await page.getByRole('textbox', { name: 'Describe the image' }).fill('Keep this exportable local work after storage failure.')
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  if (failure === 'write') {
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'yi.drafts.v1' })))
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('could not be saved')
  }
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export current drafts' }).click()
  const file = await download
  const stream = await file.createReadStream(); const chunks = []; for await (const chunk of stream!) chunks.push(chunk)
  expect(JSON.parse(Buffer.concat(chunks).toString()).drafts[0].description).toContain('Keep this exportable')
  if (failure === 'corrupt') expect(await page.evaluate(() => localStorage.getItem('yi.drafts.v1'))).toBe('{broken')
})
test('real SW and dictionary survive HTTP cache eviction and offline reload; corrupt cache recovers online', async ({ page, context }) => {
  test.setTimeout(90000)
  await page.goto('/lookup')
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.getByRole('button', { name: 'chair', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dictionary results' })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await caches.open('yi-dictionary-2026-11-02-v1')).keys().then(k => k.length))).toBe(1)
  const cdp = await context.newCDPSession(page); await cdp.send('Network.clearBrowserCache')
  await context.setOffline(true); await page.reload()
  await page.getByRole('button', { name: 'chair', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dictionary results' })).toBeVisible()
  await context.setOffline(false)
  await page.evaluate(async () => { await (await caches.open('yi-dictionary-2026-11-02-v1')).put('/dictionary/cedict.bin', new Response('corrupt')) })
  await page.reload(); await page.getByRole('button', { name: 'chair', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dictionary results' })).toBeVisible()
  await page.evaluate(async () => { await caches.delete('yi-dictionary-2026-11-02-v1') })
  await cdp.send('Network.clearBrowserCache'); await context.setOffline(true); await page.reload()
  await page.getByRole('button', { name: 'chair', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load the dictionary' })).toBeVisible()
  await context.setOffline(false)
})
test('worker crash retry constructs a new worker; numeric library query does not match all', async ({ page }) => {
  await page.addInitScript(() => {
    const Real = window.Worker
    let calls = 0
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) { super(url, options); if (++calls === 1) this.postMessage = () => { setTimeout(() => this.dispatchEvent(new ErrorEvent('error')), 0) } }
    }
  })
  await page.goto('/lookup'); await page.getByRole('button', { name: 'chair', exact: true }).click()
  await page.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dictionary results' })).toBeVisible()
  await page.goto('/'); await page.getByPlaceholder('Search words, memory cues, or songs').fill('1')
  await expect(page.locator('article')).toHaveCount(0)
})
test('in-place Word replacement cancels speech and clears prior errors (mock, not audible proof)', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { cancel: 0, fail: false, current: null as any }
    ;(window as any).voiceState = state
    Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [{ lang: 'zh-CN', name: 'local', localService: true }], addEventListener() {}, removeEventListener() {}, cancel() { state.cancel++ }, speak(u: any) { state.current = u; if (state.fail) u.onerror?.() } } })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(public text: string) {} } })
  })
  let entry = seed.entry
  await page.route('**/associations/index.json?*', route => route.fulfill({ json: { version: 1, associations: [{ ...seed, entry }] } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Pronounce 椅子', exact: true }).click()
  entry = { ...seed.entry, simplified: '新', traditional: '新', pinyin: 'xin1' }
  await page.getByRole('button', { name: 'Refresh images' }).click()
  await expect(page.getByRole('button', { name: 'Pronounce 新', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).voiceState.cancel)).toBe(1)
  expect(await page.evaluate(() => (window as any).voiceState.current.onend)).toBeNull()
  await page.evaluate(() => { (window as any).voiceState.fail = true })
  await page.getByRole('button', { name: 'Pronounce 新', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not play')
  entry = seed.entry
  await page.getByRole('button', { name: 'Refresh images' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText(/Speaking|Loading Mandarin/)).toHaveCount(0)
})

test('over-limit combined import reports validation without throwing or replacing drafts', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/lookup'); await copy(page)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.goto('/'); await page.getByRole('button', { name: 'Local drafts', exact: true }).click()
  const imported = Array.from({ length: 2000 }, (_, i) => ({ ...seed, id: `import-${i}` }))
  await page.getByLabel('Import backup file').setInputFiles({ name: 'limit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, drafts: imported })) })
  await expect(page.getByRole('alert').filter({ hasText: 'combined draft collection exceeds' })).toBeVisible()
  expect(await rows(page)).toHaveLength(1)
  expect(errors).toEqual([])
})
