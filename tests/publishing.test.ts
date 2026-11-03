import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Pags } from '../web/src/pags.ts'
import { createRequest, loadPending, PENDING_KEY, REPO_ID } from '../web/src/generation.ts'
import type { Store } from '../web/src/model.ts'
const draft = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8')).associations[0]
function store(): Store {
  const values = new Map<string, string>()
  return { getItem: k => values.get(k) || null, setItem: (k, v) => { values.set(k, v) }, removeItem: k => { values.delete(k) } }
}

test('lost send remains uncertain, survives reload, and cannot be sent as a new request', async () => {
  const client = new Pags(), storage = store(), request = createRequest(draft, null)
  let calls = 0
  client.verify = async () => undefined
  client.call = async name => { assert.equal(name, 'coding_session_message'); calls++; throw Error('lost response') }
  await client.publish(request, storage, () => {})
  const restored = loadPending(storage)!
  assert.equal(calls, 1); assert.equal(restored.status, 'uncertain'); assert.equal(restored.id, request.id)
  assert.throws(() => createRequest(draft, restored), /already pending/)
})
test('acknowledgement means queued, never completed', async () => {
  const client = new Pags(), storage = store(), request = createRequest(draft, null)
  client.verify = async () => undefined
  client.call = async () => `Sent to session csess-test: "brief" — direct turn, delivered, not yet processed`
  await client.publish(request, storage, () => {})
  assert.equal(loadPending(storage)?.status, 'queued'); assert.equal(loadPending(storage)?.sessionId, 'csess-test')
})
test('busy or unrelated work is not interrupted', async () => {
  const client = new Pags(), storage = store(), request = createRequest(draft, null)
  client.verify = async () => ({ id: 'session', repoId: REPO_ID, clientType: 'codex', status: 'active' })
  const calls: string[] = []
  client.call = async name => { calls.push(name); return { runState: 'thinking', alive: true, ready: false, runnerConnected: true } }
  await assert.rejects(() => client.publish(request, storage, () => {}), /busy/)
  assert.deepEqual(calls, ['coding_session_capture']); assert.equal(storage.getItem(PENDING_KEY), null)
})
test('receipt storage failure prevents dispatch', async () => {
  const client = new Pags(), storage = store()
  client.verify = async () => undefined
  let calls = 0
  client.call = async () => { calls++; return null }
  storage.setItem = () => { throw Error('quota') }
  await assert.rejects(() => client.publish(createRequest(draft, null), storage, () => {}), /receipt/)
  assert.equal(calls, 0)
})
test('ownership must pass before instance reads', async () => {
  const client = new Pags(), calls: string[] = []
  client.call = async name => { calls.push(name); return { instances: [] } }
  await assert.rejects(() => client.verify(), /does not own/)
  assert.deepEqual(calls, ['my_instances'])
})
test('deployed index without matching raster checksum stays deploying', async () => {
  const client = new Pags(), request = createRequest(draft, null), original = globalThis.fetch
  const index = { version: 1, associations: [{ ...draft, requestId: request.id }] }
  globalThis.fetch = async url => String(url).includes('index.json') ? Response.json(index) : new Response(new Uint8Array([137, 80, 78, 71]))
  try { assert.equal((await client.reconcile(request)).status, 'deploying') }
  finally { globalThis.fetch = original }
})
test('published requires matching request, deployed bytes, and SHA-256', async () => {
  const client = new Pags(), request = createRequest(draft, null), original = globalThis.fetch
  const index = { version: 1, associations: [{ ...draft, requestId: request.id }] }
  globalThis.fetch = async url => String(url).includes('index.json') ? Response.json(index) : new Response(readFileSync(`web/public${draft.image}`))
  try { assert.equal((await client.reconcile(request)).status, 'published') }
  finally { globalThis.fetch = original }
})
