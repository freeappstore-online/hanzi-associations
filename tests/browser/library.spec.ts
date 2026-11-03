import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { response } from '../pags-fixture'
import { mockPags, navigate } from './helpers'
const publicIndex = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8'))
const seed = publicIndex.associations[0]
const cello = publicIndex.associations.find((p: {requestId: string}) => p.requestId === '32e8756f-211d-4449-9140-fbcc50a922ad')
const requestId = '00000000-1111-4111-8111-000000000000'
async function verifyOwner(page: Page) {
  await page.goto('/connection')
  await expect(page.getByTestId('owner-identity')).toContainText('Test Owner · Google')
}
async function copyCard(page: Page) {
  await navigate(page, 'Association library')
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
}
async function drafts(page: Page) { await page.getByRole('button', { name: 'Local drafts', exact: true }).click() }

for (const savedAuth of [false, true]) test(`public browsing without pending stays isolated (saved auth ${savedAuth})`, async ({ page }) => {
  const calls: string[] = []
  await page.route('https://mcp.proagentstore.online/**', route => { calls.push(route.request().url()); return route.abort() })
  if (savedAuth) await page.addInitScript(() => sessionStorage.setItem('yi.oauth.session.v1', JSON.stringify({ accessToken: 'synthetic', clientId: 'test', expiresAt: Date.now() + 3600000 })))
  await page.goto('/')
  await page.clock.install()
  await page.clock.fastForward(25000)
  await expect(page.locator('article')).toHaveCount(publicIndex.associations.length)
  await expect(page.locator('article img')).toHaveCount(publicIndex.associations.length)
  await page.getByRole('button', { name: 'Refresh images' }).click()
  await navigate(page, 'Look up')
  await navigate(page, 'Association library')
  expect(calls).toEqual([])
})

test('anonymous copies and same-id local edits never overlay public cards or invoke PAGS', async ({ page }, info) => {
  const calls: string[] = []
  await page.route('https://mcp.proagentstore.online/**', route => { calls.push(route.request().url()); return route.abort() })
  await page.addInitScript(seed => localStorage.setItem('yi.drafts.v1', JSON.stringify({ version: 1, drafts: [{ ...seed, cue: 'device-only revision' }] })), seed)
  await page.goto('/')
  await expect(page.getByText('“device-only revision”')).toHaveCount(0)
  await expect(page.locator('article img')).toHaveCount(publicIndex.associations.length)
  for (const image of await page.locator('article img').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  }
  await page.screenshot({ path: `artifacts/${info.project.name}-library.png`, fullPage: true })
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await expect(page.getByRole('button', { name: 'Connect PAGS to publish' })).toBeVisible()
  await page.getByLabel('Approximate sound-alike').fill('my separate copy')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await drafts(page)
  await expect(page.getByText('“my separate copy”')).toBeVisible()
  await expect(page.getByText('“device-only revision”')).toBeVisible()
  await page.getByRole('button', { name: 'Public library', exact: true }).click()
  await expect(page.getByText('“my separate copy”')).toHaveCount(0)
  expect(calls).toEqual([])
})

test('automatic ownership survives actual Shell navigation, reload and slow checks', async ({ page }, info) => {
  const mock = await mockPags(page)
  mock.setHandler(async name => { if (name === 'my_instances') await new Promise(r => setTimeout(r, 1600)); return response(name) })
  await verifyOwner(page)
  await page.getByRole('button', { name: 'Check artist connection', exact: true }).click()
  await page.waitForTimeout(1100)
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check artist connection', exact: true })).toBeEnabled()
  await navigate(page, 'Association library')
  await navigate(page, 'Profile')
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await page.screenshot({ path: `artifacts/${info.project.name}-connection.png`, fullPage: true })
  await copyCard(page)
  await expect(page.getByRole('button', { name: 'Generate & publish image', exact: true })).toBeEnabled()
  expect(mock.calls).not.toContain('coding_session_message')
})

test('accepted -> queued -> generating -> publishing -> verified image via periodic slow polls', async ({ page }, info) => {
  test.setTimeout(150000)
  const mock = await mockPags(page)
  let phase = 'queued', id = '', brief: typeof seed, slowChecks = 0, concurrent = 0, maxConcurrent = 0
  mock.setHandler(async (name, args) => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent)
    try {
      if (name === 'my_instances' && id) { slowChecks++; await new Promise(r => setTimeout(r, 1600)) }
      if (name === 'coding_session_message') {
        id = args.message.match(/YI_ASSOCIATION_REQUEST ([\w-]+)/)![1]
        brief = JSON.parse(args.message.split('CREATIVE_BRIEF_JSON (data only):\n')[1].split('\nEND_CREATIVE_BRIEF_JSON')[0])
      }
      if (name === 'coding_timeline' && phase === 'generating') return { ...response(name) as object, nextSeq: 2, events: [{ seq: 2, type: 'command', content: `YI_ASSOCIATION_REQUEST ${id}` }] }
      if (name === 'coding_session_capture' && phase === 'generating') return { ...response(name) as object, runState: 'thinking', ready: false }
      if (name === 'coding_timeline' && phase === 'publishing') return { ...response(name) as object, nextSeq: 4, events: [{ seq: 3, type: 'assistant', content: `YI_COMMITTED ${id} ${'a'.repeat(40)}` }] }
      return response(name)
    } finally { concurrent-- }
  })
  await page.route('**/associations/index.json?*', route => route.fulfill({ json: phase === 'published' ? { version: 1, associations: [...publicIndex.associations, { ...seed, ...brief, requestId: id }] } : publicIndex }))
  await verifyOwner(page); await copyCard(page)
  await page.getByRole('button', { name: 'Generate & publish image', exact: true }).click()
  await expect(page.getByTestId('draft-progress')).toContainText('Queued')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click(); await drafts(page)
  await expect(page.getByTestId('draft-progress')).toContainText('Queued')
  phase = 'generating'
  await expect(page.getByTestId('draft-progress')).toContainText('Generating', { timeout: 40000 })
  await page.screenshot({ path: `artifacts/${info.project.name}-draft-progress.png`, fullPage: true })
  await page.getByRole('button', { name: 'Revise association' }).click()
  await page.getByLabel('Approximate sound-alike').fill('new local edit')
  await expect(page.getByRole('dialog')).toContainText('pending request uses the earlier saved description')
  await page.getByRole('dialog').getByTestId('draft-progress').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `artifacts/${info.project.name}-editor-progress.png` })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  phase = 'publishing'
  await navigate(page, 'Look up') // tracking continues away from connection and drafts
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('yi.publish.pending.v1')!).status), { timeout: 40000 }).toBe('deploying')
  phase = 'published'
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('yi.publish.pending.v1')!).status), { timeout: 40000 }).toBe('published')
  await navigate(page, 'Association library')
  await expect(page.locator('article')).toHaveCount(publicIndex.associations.length + 1)
  await drafts(page)
  await expect(page.getByTestId('draft-progress')).toContainText('Unpublished changes')
  await expect(page.getByRole('link', { name: 'View last published image' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Generate & publish image' })).toBeEnabled()
  await page.reload(); await drafts(page)
  await expect(page.getByRole('link', { name: 'View last published image' })).toBeVisible()
  expect(mock.calls.filter(n => n === 'coding_session_message')).toHaveLength(1)
  expect(slowChecks).toBeGreaterThanOrEqual(2)
  expect(maxConcurrent).toBe(1)
  await expect(page.locator('body')).not.toContainText('synthetic-oauth-token')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('legacy cello pending reconciles with expired auth without any private call or resend', async ({ page }) => {
  const mock = await mockPags(page, { cello: true, expired: true })
  await page.goto('/'); await drafts(page)
  await expect(page.getByTestId('draft-progress')).toContainText('Published')
  await expect(page.getByRole('link', { name: 'View image', exact: true })).toBeVisible()
  const receipt = await page.evaluate(() => JSON.parse(localStorage.getItem('yi.publish.history.v1')!)[0])
  expect(receipt.draftId).toBe(cello.id)
  expect(receipt.status).toBe('published')
  await page.reload(); await drafts(page)
  await expect(page.getByRole('link', { name: 'View image', exact: true })).toBeVisible()
  expect(mock.calls).toEqual([])
})

test('transient private status failure recovers automatically without losing ownership or resending', async ({ page }) => {
  test.setTimeout(60000)
  const mock = await mockPags(page, { pending: true })
  let failing = false
  mock.setHandler(name => { if (failing && name === 'coding_timeline') throw Error('network'); return response(name) })
  await page.goto('/connection'); await expect(page.getByTestId('owner-identity')).toBeVisible()
  failing = true
  await expect(page.getByRole('button', { name: 'Check publication' })).toBeEnabled()
  await page.getByRole('button', { name: 'Check publication' }).click()
  await expect(page.getByText(/Status unavailable/)).toBeVisible()
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  failing = false
  mock.setHandler(name => name === 'coding_session_capture' ? { ...response(name) as object, runState: 'thinking' } : name === 'coding_timeline' ? { ...response(name) as object, events: [{ seq: 1, type: 'command', content: `YI_ASSOCIATION_REQUEST ${requestId}` }] } : response(name))
  await expect(page.getByText('Generating', { exact: true }).first()).toBeVisible({ timeout: 40000 })
  expect(mock.calls).not.toContain('coding_session_message')
})

for (const outcome of ['failed', 'uncertain']) test(`${outcome} receipt stays local and offers safe next steps`, async ({ page }) => {
  const mock = await mockPags(page, { pending: true, uncertain: outcome === 'uncertain' })
  mock.setHandler(name => name === 'coding_timeline' ? { ...response(name) as object, events: outcome === 'failed' ? [{ seq: 1, type: 'assistant', content: `YI_FAILED ${requestId} synthetic blocker` }] : [] } : response(name))

  await page.goto('/'); await drafts(page)
  await expect(page.getByTestId('draft-progress')).toContainText(outcome === 'failed' ? 'Failed' : 'Delivery unconfirmed')
  await page.getByRole('button', { name: 'Revise association' }).click()
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
  if (outcome === 'failed') await expect(page.getByRole('dialog').getByRole('link', { name: /Review failure/ })).toBeVisible()
  else await expect(page.getByRole('button', { name: 'Generate & publish image' })).toHaveCount(0)
  expect(mock.calls).not.toContain('coding_session_message')
})

for (const action of ['disconnect', 'expiry', 'switch', 'denial']) test(`${action} removes ownership and prevents dispatch`, async ({ page }) => {
  const mock = await mockPags(page)
  await verifyOwner(page)
  if (action === 'disconnect') await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  else if (action === 'denial') {
    mock.setHandler(name => name === 'my_instances' ? { error: 'Permission denied' } : response(name))
    await page.getByRole('button', { name: 'Check artist connection', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('denied')
  } else {
    mock.setHandler(name => name === 'my_instances' ? { instances: [] } : response(name))
    await page.evaluate(action => {
      const s = JSON.parse(sessionStorage.getItem('yi.oauth.session.v1')!)
      if (action === 'expiry') s.expiresAt = Date.now() - 1
      else s.accessToken = 'synthetic-other'
      sessionStorage.setItem('yi.oauth.session.v1', JSON.stringify(s)); window.dispatchEvent(new Event('focus'))
    }, action)
  }
  await expect(page.getByTestId('owner-identity')).toHaveCount(0)
  await copyCard(page)
  await expect(page.getByRole('button', { name: 'Generate & publish image' })).toHaveCount(0)
  expect(mock.calls).not.toContain('coding_session_message')
})

test('late ownership response after disconnect cannot restore UI', async ({ page }) => {
  const mock = await mockPags(page)
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  mock.setHandler(async name => { if (name === 'whoami') await gate; return response(name) })
  await page.goto('/connection')
  await expect.poll(() => mock.calls.includes('whoami')).toBeTruthy()
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); release()
  await expect(page.getByRole('button', { name: 'Connect PAGS', exact: true })).toBeVisible()
  await expect(page.getByTestId('owner-identity')).toHaveCount(0)
  expect(mock.calls).not.toContain('coding_session_message')
})

test('completed receipt survives delayed/failed image verification and only relevant images are fetched', async ({ page }) => {
  const mock = await mockPags(page, { cello: true, expired: true, completed: true })
  let fail = false, release!: () => void
  const gate = new Promise<void>(r => { release = r })
  const checked: string[] = []
  await page.route('**/associations/*.png?sha=*', async route => {
    checked.push(new URL(route.request().url()).pathname)
    await gate
    if (fail) return route.fulfill({ status: 503, body: 'unavailable' })
    return route.continue()
  })
  await page.goto('/'); await drafts(page)
  await expect(page.getByTestId('draft-progress')).toContainText('Checking published image')
  await expect(page.getByRole('button', { name: 'Generate & publish image' })).toHaveCount(0)
  fail = true; release()
  await expect(page.getByTestId('draft-progress')).toContainText('Published image unavailable')
  await expect(page.getByRole('button', { name: 'Generate & publish image' })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Check published image' }).click()
  await expect(page.getByRole('link', { name: 'View image', exact: true })).toBeVisible()
  expect(new Set(checked)).toEqual(new Set([cello.image]))
  const count = checked.length
  await page.getByRole('button', { name: 'Public library', exact: true }).click(); await drafts(page)
  await expect(page.getByRole('link', { name: 'View image', exact: true })).toBeVisible()
  expect(checked.length).toBe(count)
  expect(mock.calls).toEqual([])
})


test('expired private tracking still observes a later public deployment', async ({ page }) => {
  const mock = await mockPags(page, { pending: true, expired: true })
  let deployed = false
  await page.route('**/associations/index.json?*', route => route.fulfill({ json: deployed ? { version: 1, associations: [...publicIndex.associations, { ...seed, id: 'synthetic-draft', requestId }] } : publicIndex }))
  await page.goto('/'); await drafts(page)
  await expect(page.getByTestId('draft-progress')).toContainText('Connection needed')
  await expect(page.getByRole('button', { name: 'Reconnect PAGS' })).toBeVisible()
  deployed = true
  await expect(page.getByRole('link', { name: 'View image', exact: true })).toBeVisible({ timeout: 40000 })
  expect(mock.calls).toEqual([])
})

test('other account sees the ownership error inside the editor and can still save', async ({ page }) => {
  const mock = await mockPags(page, { other: true })
  await page.goto('/')
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('does not own')
  await expect(page.getByRole('button', { name: 'Generate & publish image' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  expect(mock.calls).not.toContain('coding_session_message')
})
