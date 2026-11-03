import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { tools, response } from '../pags-fixture'
const publicIndex = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8'))
const seed = publicIndex.associations[0]
const requestId = '00000000-1111-4111-8111-000000000000'
async function mockPags(page: Page, options: { pending?: boolean; other?: boolean } = {}) {
  const calls: string[] = []
  let handler: (name: string) => unknown | Promise<unknown> = name => options.other && name === 'my_instances' ? { instances: [] } : response(name)
  await page.addInitScript(({ pending, seed, requestId }) => {
    sessionStorage.setItem('yi.oauth.session.v1', JSON.stringify({ accessToken: 'synthetic-oauth-token', clientId: 'synthetic-client', expiresAt: Date.now() + 3600000 }))
    if (pending) localStorage.setItem('yi.publish.pending.v1', JSON.stringify({ id: requestId, draft: seed, status: 'uncertain', detail: 'Synthetic pending request', createdAt: '2026-11-03T10:00:00.000Z' }))
  }, { pending: options.pending, seed, requestId })
  // All PAGS requests are trapped. No test reaches a real artist or auth service.
  await page.route('https://mcp.proagentstore.online/**', async route => {
    if (route.request().method() !== 'POST') { await route.fulfill({ status: 405 }); return }
    const body = route.request().postDataJSON()
    if (body.id === undefined) { await route.fulfill({ status: 202 }); return }
    let result: unknown
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-pags', version: '1' } }
    else if (body.method === 'tools/list') result = { tools }
    else if (body.method === 'tools/call') {
      calls.push(body.params.name)
      expect(body.params.arguments).not.toHaveProperty('token')
      result = { content: [{ type: 'text', text: JSON.stringify(await handler(body.params.name)) }] }
    } else throw Error('Unexpected MCP method ' + body.method)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) })
  })
  return { calls, setHandler: (fn: typeof handler) => { handler = fn } }
}
async function navigate(page: Page, path: string) {
  await page.evaluate(path => { history.pushState(null, '', path); window.dispatchEvent(new PopStateEvent('popstate')) }, path)
}
async function verifyOwner(page: Page) {
  await page.goto('/connection')
  await page.getByRole('button', { name: 'Verify artist', exact: true }).click()
  await expect(page.getByTestId('owner-identity')).toContainText('Test Owner · Google')
}
async function copyCard(page: Page) {
  await navigate(page, '/')
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

test('public landing, copies and same-id local revisions never invoke PAGS', async ({ page }, info) => {
  const calls: string[] = []
  await page.route('https://mcp.proagentstore.online/**', route => { calls.push(route.request().url()); return route.abort() })
  await page.addInitScript(seed => {
    localStorage.setItem('yi.drafts.v1', JSON.stringify({ version: 1, drafts: [{ ...seed, cue: 'device-only revision' }] }))
  }, seed)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Association library', exact: true })).toBeVisible()
  await expect(page.locator('article')).toHaveCount(5)
  await expect(page.getByText('“device-only revision”')).toHaveCount(0)
  await expect(page.locator('article img')).toHaveCount(5)
  await expect.poll(() => page.locator('article img').evaluateAll(images => images.every(img => (img as HTMLImageElement).naturalWidth > 0))).toBeTruthy()
  await page.screenshot({ path: `artifacts/${info.project.name}-library.png`, fullPage: true })
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await expect(page.getByRole('button', { name: /Publish.*image/ })).toHaveCount(0)
  await page.getByLabel('Approximate sound-alike').fill('my separate copy')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.getByRole('button', { name: 'Local drafts', exact: true }).click()
  await expect(page.getByText('“my separate copy”')).toBeVisible()
  await expect(page.getByText('“device-only revision”')).toBeVisible()
  await page.getByRole('button', { name: 'Public library', exact: true }).click()
  await expect(page.getByText('“my separate copy”')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  expect(calls).toEqual([])
})
test('public browsing with saved OAuth and pending request still makes zero PAGS calls', async ({ page }) => {
  const mock = await mockPags(page, { pending: true })
  await page.goto('/')
  await page.clock.install()
  await page.clock.fastForward(25_000)
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await expect(page.getByRole('button', { name: /Publish.*image/ })).toHaveCount(0)
  expect(mock.calls).toEqual([])
})
test('other account cannot see publishing controls and retains local drafts', async ({ page }) => {
  const mock = await mockPags(page, { other: true })
  await page.goto('/connection')
  await page.getByRole('button', { name: 'Verify artist', exact: true }).click()
  await expect(page.getByText(/does not own the configured Yi artist/)).toBeVisible()
  await expect(page.getByTestId('owner-identity')).toHaveCount(0)
  await copyCard(page)
  await expect(page.getByRole('button', { name: /Publish.*image/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  expect(mock.calls).toEqual(['my_instances'])
})
test('verified owner sends once through synthetic MCP and sees scoped receipt', async ({ page }, info) => {
  const mock = await mockPags(page)
  await verifyOwner(page)
  await expect(page.getByText(/FreeAppStore and PAGS sign-ins are independent/)).toBeVisible()
  await page.clock.install()
  await page.clock.fastForward(65_000)
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await expect.poll(() => page.getByRole('heading', { name: 'Your image artist' }).locator('..').locator('..').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(16)
  await page.screenshot({ path: `artifacts/${info.project.name}-connection.png`, fullPage: true })
  await copyCard(page)
  await expect(page.getByRole('button', { name: 'Publish image', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Publish image', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await navigate(page, '/connection')
  await expect(page.getByText('queued', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent activity on this device' })).toBeVisible()
  await expect(page.locator('time')).toHaveCount(2)
  expect(mock.calls.filter(n => n === 'coding_session_message')).toHaveLength(1)
  expect(mock.calls.filter(n => n === 'my_instances')).toHaveLength(2)
  await expect(page.locator('body')).not.toContainText('synthetic-oauth-token') // raw token is not the account identifier
})
for (const action of ['disconnect', 'expiry', 'switch', 'reverify failure']) test(`${action} removes verified controls and identity`, async ({ page }) => {
  const mock = await mockPags(page)
  await verifyOwner(page)
  if (action === 'disconnect') await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  else if (action === 'reverify failure') {
    mock.setHandler(name => name === 'my_instances' ? { instances: [] } : response(name))
    await page.getByRole('button', { name: 'Verify artist', exact: true }).click()
    await expect(page.getByText(/does not own/)).toBeVisible()
  } else {
    await page.evaluate(action => {
      const s = JSON.parse(sessionStorage.getItem('yi.oauth.session.v1')!)
      if (action === 'expiry') s.expiresAt = Date.now() - 1
      else s.accessToken = 'synthetic-other'
      sessionStorage.setItem('yi.oauth.session.v1', JSON.stringify(s))
      window.dispatchEvent(new Event('focus'))
    }, action)
  }
  await expect(page.getByTestId('owner-identity')).toHaveCount(0)
  await copyCard(page)
  await expect(page.getByRole('button', { name: /Publish.*image/ })).toHaveCount(0)
  expect(mock.calls).not.toContain('coding_session_message')
})
test('late verification after disconnect cannot restore verified UI', async ({ page }) => {
  const mock = await mockPags(page)
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  mock.setHandler(async name => { if (name === 'whoami') await gate; return response(name) })
  await page.goto('/connection')
  await page.getByRole('button', { name: 'Verify artist', exact: true }).click()
  await expect.poll(() => mock.calls.includes('whoami')).toBeTruthy()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  release()
  await expect(page.getByRole('button', { name: 'Connect PAGS', exact: true })).toBeVisible()
  await copyCard(page)
  await expect(page.getByRole('button', { name: /Publish.*image/ })).toHaveCount(0)
  expect(mock.calls).not.toContain('coding_session_message')
})
