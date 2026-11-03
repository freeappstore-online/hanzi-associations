import { expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { tools, response } from '../pags-fixture'
const publicIndex = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8'))
const seed = publicIndex.associations[0]
const cello = publicIndex.associations.find((p: {requestId: string}) => p.requestId === '32e8756f-211d-4449-9140-fbcc50a922ad')
const requestId = '00000000-1111-4111-8111-000000000000'
export async function mockPags(page: Page, options: { pending?: boolean; other?: boolean; expired?: boolean; cello?: boolean; completed?: boolean; uncertain?: boolean; yellow?: boolean } = {}) {
  const calls: string[] = []
  let handler: (name: string, args: Record<string, string>) => unknown | Promise<unknown> = name => options.other && name === 'my_instances' ? { instances: [] } : response(name)
  await page.addInitScript(({ options, seed, cello, requestId }) => {
    if (localStorage.getItem('test-initialized')) return
    localStorage.setItem('test-initialized', 'yes')
    sessionStorage.setItem('yi.oauth.session.v1', JSON.stringify({ accessToken: 'synthetic-oauth-token', clientId: 'synthetic-client', expiresAt: Date.now() + (options.expired ? -1 : 3600000) }))
    if (options.pending || options.cello || options.yellow) {
      const draft = options.cello ? cello : { ...seed, id: 'synthetic-draft' }
      const id = options.yellow ? '0ad2eed4-36ed-4a9c-a11c-bfbbc3a39539' : options.cello ? cello.requestId : requestId
      const pending = { id, draft, ...(options.yellow ? { sinceSeq: 63729 } : {}), sessionId: 'csess-test', status: options.completed ? 'published' : options.uncertain ? 'uncertain' : 'queued', detail: 'PAGS accepted the message. Generation has not yet been observed.', createdAt: '2026-11-03T10:00:00.000Z' }
      localStorage.setItem('yi.publish.pending.v1', JSON.stringify(pending))
      localStorage.setItem('yi.publish.history.v1', JSON.stringify([{ id, word: draft.entry.simplified, status: pending.status, createdAt: pending.createdAt, updatedAt: pending.createdAt }]))
      localStorage.setItem('yi.drafts.v1', JSON.stringify({ version: 1, drafts: [draft] }))
    }
  }, { options, seed, cello, requestId })
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
      try { result = { content: [{ type: 'text', text: JSON.stringify(await handler(body.params.name, body.params.arguments)) }] } }
      catch { await route.abort(); return }
    } else throw Error('Unexpected MCP method ' + body.method)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) })
  })
  return { calls, setHandler: (fn: typeof handler) => { handler = fn } }
}
export async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('link', { name, exact: true }).click()
}
