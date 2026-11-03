import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Pags, type PagsClient } from '../web/src/pags.ts'
import { createRequest, loadPending, loadReceipts, PENDING_KEY, HISTORY_KEY, savePending } from '../web/src/generation.ts'
import { AUTH_KEY, disconnect } from '../web/src/oauth.ts'
import type { Store } from '../web/src/model.ts'
import { tools, response } from './pags-fixture.ts'
const draft = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8')).associations[0]
function store(): Store {
  const values = new Map<string, string>()
  return { getItem: k => values.get(k) || null, setItem: (k, v) => { values.set(k, v) }, removeItem: k => { values.delete(k) } }
}
function auth(storage: Store, token = 'synthetic-owner', expiresAt = Date.now() + 3600000) {
  storage.setItem(AUTH_KEY, JSON.stringify({ accessToken: token, expiresAt, clientId: 'synthetic-client' }))
}
function fixture() {
  const storage = store(), session = store(), calls: string[] = []
  auth(session)
  let handle: (name: string) => unknown | Promise<unknown> = response
  let available = tools
  let connect: () => Promise<void> = async () => {}
  let revoked = 0
  const adapter = {
    connect: () => connect(), close: async () => {}, listTools: async () => ({ tools: available }),
    callTool: async ({ name, arguments: args }: { name: string; arguments: Record<string, unknown> }) => {
      calls.push(name); assert.ok(!('token' in args))
      return { content: [{ type: 'text', text: JSON.stringify(await handle(name)) }] }
    },
  } as unknown as PagsClient
  const client = new Pags(() => { revoked++ }, adapter)
  return { client, session, storage, calls, setHandle: (fn: typeof handle) => { handle = fn }, setTools: (next: typeof tools) => { available = next }, setConnect: (fn: typeof connect) => { connect = fn }, get revoked() { return revoked } }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

test('anonymous direct publish and raw method bypass cannot reach transport', async () => {
  const f = fixture()
  assert.equal('call' in f.client, false)
  assert.equal('client' in f.client, false)
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}), /session/)
  disconnect(f.session)
  await assert.rejects(() => f.client.connect(f.session), /Connect/)
  assert.deepEqual(f.calls, [])
})
test('another account cannot verify or directly publish, even overriding public verify', async () => {
  const f = fixture(); f.setHandle(name => name === 'my_instances' ? { instances: [] } : response(name))
  await f.client.connect(f.session)
  await assert.rejects(() => f.client.verify(), /does not own/)
  f.client.verify = async () => ({ label: 'forged', checkedAt: 0, validUntil: Infinity })
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}), /does not own/)
  assert.deepEqual(f.calls, ['my_instances', 'my_instances']); assert.equal(f.client.verification, null)
})
test('owner identity uses whoami only and missing metadata has honest fallback', async () => {
  const f = fixture(); await f.client.connect(f.session)
  assert.equal((await f.client.verify()).label, 'Test Owner · Google')
  assert.equal(f.client.verification?.accountId, 'google:synthetic-owner')
  assert.ok(!JSON.stringify(f.client.verification).includes('unused@example.invalid'))
  const g = fixture(); g.setTools(tools.filter(t => t.name !== 'whoami')); await g.client.connect(g.session)
  assert.equal((await g.client.verify()).label, 'Verified artist owner')
  assert.equal(g.client.verification?.accountId, 'google:synthetic-owner')
})
test('verification lasts for the valid OAuth session, not a 60-second editing timer', async () => {
  const f = fixture(); await f.client.connect(f.session)
  const owner = await f.client.verify()
  assert.ok(owner.validUntil - owner.checkedAt > 60_000)
})
test('successful owner dispatch rechecks all guards and records one queued receipt', async () => {
  const f = fixture(); await f.client.connect(f.session); await f.client.verify(); f.calls.length = 0
  const request = createRequest(draft, null)
  await f.client.publish(request, f.storage, () => {})
  assert.deepEqual(f.calls, ['my_instances', 'coding_repos_list', 'whoami', 'coding_engine_get', 'coding_sessions_list', 'coding_timeline', 'coding_session_capture', 'coding_session_message'])
  assert.equal(loadPending(f.storage)?.status, 'queued'); assert.equal(loadPending(f.storage)?.sessionId, 'csess-test')
  assert.equal(loadReceipts(f.storage)[0].status, 'queued')
  await assert.rejects(() => f.client.publish(request, f.storage, () => {}), /receipt/)
  assert.equal(f.calls.filter(n => n === 'coding_session_message').length, 1)
})
test('lost send remains uncertain, survives reload, and cannot be resent directly', async () => {
  const f = fixture(); await f.client.connect(f.session)
  f.setHandle(name => { if (name === 'coding_session_message') throw Error('private token must never surface'); return response(name) })
  const request = createRequest(draft, null)
  await f.client.publish(request, f.storage, () => {})
  const restored = loadPending(f.storage)!
  assert.equal(restored.status, 'uncertain'); assert.equal(restored.id, request.id); assert.ok(f.client.verification)
  assert.throws(() => createRequest(draft, restored), /already pending/)
  await assert.rejects(() => f.client.publish(request, f.storage, () => {}), /receipt/)
  assert.equal(f.calls.filter(n => n === 'coding_session_message').length, 1)
  assert.ok(!JSON.stringify(restored).includes('private token'))
})
test('busy artist blocks dispatch without losing verified ownership', async () => {
  const f = fixture(); await f.client.connect(f.session); await f.client.verify()
  f.setHandle(name => name === 'coding_session_capture' ? { ...response(name) as object, runState: 'thinking', ready: false } : response(name))
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}), /busy/)
  assert.ok(!f.calls.includes('coding_session_message')); assert.equal(loadPending(f.storage), null); assert.ok(f.client.verification)
})
for (const guard of ['my_instances', 'coding_repos_list', 'whoami', 'coding_engine_get', 'coding_sessions_list']) test(`fresh ${guard} failure blocks previously verified owner dispatch`, async () => {
  const f = fixture(); await f.client.connect(f.session); await f.client.verify()
  f.setHandle(name => name === guard ? {} : response(name))
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}))
  assert.equal(Boolean(f.client.verification), ['coding_engine_get', 'coding_sessions_list'].includes(guard)); assert.ok(!f.calls.includes('coding_session_message'))
})
for (const mode of ['disconnect', 'expire', 'switch', 'close']) test(`${mode} revokes verification and prevents old client reuse`, async () => {
  const f = fixture(); await f.client.connect(f.session); await f.client.verify()
  if (mode === 'disconnect') disconnect(f.session)
  if (mode === 'expire') auth(f.session, 'synthetic-owner', Date.now() - 1)
  if (mode === 'switch') auth(f.session, 'synthetic-other')
  if (mode === 'close') await f.client.close()
  assert.equal(f.client.verification, null)
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}), /session/)
  auth(f.session)
  await assert.rejects(() => f.client.verify(), /session/)
  assert.ok(!f.calls.includes('coding_session_message'))
})
test('disconnect during connection cannot resurrect a client', async () => {
  const f = fixture(), gate = deferred(); f.setConnect(() => gate.promise)
  const connecting = f.client.connect(f.session); await f.client.close(); gate.resolve()
  await assert.rejects(() => connecting, /Could not connect/)
  assert.equal(f.client.isCurrent(), false)
})
for (const phase of ['my_instances', 'coding_session_capture']) test(`account switch during ${phase} cannot authorize or dispatch`, async () => {
  const f = fixture(), gate = deferred(), entered = deferred(); await f.client.connect(f.session)
  f.setHandle(async name => { if (name === phase) { entered.resolve(); await gate.promise } return response(name) })
  const publishing = f.client.publish(createRequest(draft, null), f.storage, () => {})
  await entered.promise; auth(f.session, 'synthetic-other'); gate.resolve()
  await assert.rejects(() => publishing, /PAGS|session/)
  assert.equal(f.client.verification, null); assert.ok(!f.calls.includes('coding_session_message'))
})
test('disconnect in receipt callback prevents dispatch, preserves conservative receipt', async () => {
  const f = fixture(); await f.client.connect(f.session)
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => disconnect(f.session)), /session/)
  assert.equal(loadPending(f.storage)?.status, 'uncertain'); assert.ok(!f.calls.includes('coding_session_message'))
})
test('concurrent verification failure cannot be overwritten by stale success', async () => {
  const f = fixture(), entered = deferred(), gate = deferred(); await f.client.connect(f.session)
  let calls = 0
  f.setHandle(async name => { if (name === 'my_instances') { if (++calls === 1) { entered.resolve(); await gate.promise } else return { instances: [] } } return response(name) })
  const first = f.client.verify(); await entered.promise
  await assert.rejects(() => f.client.verify(), /does not own/); gate.resolve()
  await assert.rejects(() => first, /Verification changed/); assert.equal(f.client.verification, null)
})
test('receipt storage failure prevents dispatch', async () => {
  const f = fixture(); await f.client.connect(f.session)
  f.storage.setItem = () => { throw Error('quota') }
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}), /receipt/)
  assert.ok(!f.calls.includes('coding_session_message'))
})
test('schema changes fail closed and never forward unknown parameters', async () => {
  const f = fixture(); f.setTools(tools.map(t => t.name === 'coding_session_message' ? { ...t, inputSchema: { type: 'object', properties: {} } } : t)); await f.client.connect(f.session)
  await f.client.publish(createRequest(draft, null), f.storage, () => {})
  assert.ok(!f.calls.includes('coding_session_message')); assert.ok(f.client.verification)
})
test('device history retains bounded timestamped receipts without briefs or private output', () => {
  const s = store()
  for (let i = 0; i < 52; i++) savePending(s, { ...createRequest(draft, null), status: 'published' })
  const receipts = loadReceipts(s); assert.equal(receipts.length, 50)
  assert.ok(receipts.every(r => r.createdAt && r.updatedAt && r.status === 'published'))
  assert.ok(!s.getItem(HISTORY_KEY)?.includes('description'))
  const legacy = store(); legacy.setItem(PENDING_KEY, JSON.stringify(createRequest(draft, null)))
  assert.equal(loadReceipts(legacy).length, 1)
})
for (const matching of [false, true]) test(`deployed publication requires matching raster checksum (${matching})`, async () => {
  const client = new Pags(), request = createRequest(draft, null), original = globalThis.fetch
  const index = { version: 1, associations: [{ ...draft, requestId: request.id }] }
  globalThis.fetch = async url => String(url).includes('index.json') ? Response.json(index) : new Response(matching ? readFileSync(`web/public${draft.image}`) : new Uint8Array([137, 80, 78, 71]))
  try { assert.equal((await client.reconcile(request)).status, matching ? 'published' : 'deploying') }
  finally { globalThis.fetch = original }
})

test('changed authenticated identity revokes an otherwise unchanged OAuth client', async () => {
  const f = fixture(); await f.client.connect(f.session); await f.client.verify()
  f.setHandle(name => name === 'whoami' ? { ...response(name) as object, id: 'github:other-account', login: 'Other' } : response(name))
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {}), /identity changed/)
  assert.equal(f.client.verification, null); assert.equal(f.client.isCurrent(), false)
  assert.ok(!f.calls.includes('coding_session_message'))
})
test('receipt history also prevents replay of an older completed request ID', async () => {
  const f = fixture(); await f.client.connect(f.session)
  const older = { ...createRequest(draft, null), status: 'published' as const }
  savePending(f.storage, older); savePending(f.storage, { ...createRequest(draft, null), status: 'published' })
  await assert.rejects(() => f.client.publish(older, f.storage, () => {}), /receipt/)
  assert.deepEqual(f.calls, [])
})

test('reverification begun by a receipt callback cannot race a dispatch', async () => {
  const f = fixture(); await f.client.connect(f.session)
  let reverify: Promise<unknown> | undefined
  await assert.rejects(() => f.client.publish(createRequest(draft, null), f.storage, () => {
    f.setHandle(name => name === 'my_instances' ? { instances: [] } : response(name))
    reverify = f.client.verify().catch(() => {})
  }), /Verification changed/)
  await reverify
  assert.ok(!f.calls.includes('coding_session_message')); assert.equal(f.client.verification, null)
})


test('slow and transient ownership checks preserve identity; real denial revokes it', async () => {
  const f = fixture(); await f.client.connect(f.session); await f.client.verify()
  const gate = deferred(), entered = deferred()
  f.setHandle(async name => { if (name === 'my_instances') { entered.resolve(); await gate.promise; throw Error('network-private-detail') } return response(name) })
  const checking = f.client.verify(); await entered.promise
  assert.ok(f.client.verification)
  gate.resolve(); await assert.rejects(() => checking, /Status unavailable/)
  assert.ok(f.client.verification)
  f.setHandle(name => name === 'my_instances' ? { error: 'permission denied' } : response(name))
  await assert.rejects(() => f.client.verify(), /denied/)
  assert.equal(f.client.verification, null)
})

test('legacy receipts map only by request ID from pending or deployed index', () => {
  const s = store(), pending = createRequest(draft, null)
  s.setItem(PENDING_KEY, JSON.stringify(pending))
  const other = createRequest(draft, null)
  s.setItem(HISTORY_KEY, JSON.stringify([pending, other].map(p => ({ id: p.id, word: draft.entry.simplified, status: 'queued', createdAt: p.createdAt, updatedAt: p.createdAt }))))
  assert.equal(loadReceipts(s)[0].draftId, draft.id)
  assert.equal(loadReceipts(s)[1].draftId, undefined)
  assert.equal(loadReceipts(s, [{ ...draft, requestId: other.id }])[1].draftId, draft.id)
})

test('completed receipt never downgrades to a never-published draft while image is unavailable', async () => {
  const { draftProgress } = await import('../web/src/publication.ts')
  const pending = { ...createRequest(draft, null), status: 'published' as const }
  assert.equal(draftProgress(draft, pending, [], []).label, 'Checking published image')
  assert.equal(draftProgress(draft, pending, [], [], true).label, 'Published image unavailable')
  assert.equal(draftProgress(draft, pending, [], [{ ...draft, requestId: pending.id }]).label, 'Published')
  assert.equal(draftProgress({ ...draft, cue: 'edited after publication' }, pending, [], [{ ...draft, requestId: pending.id }]).label, 'Draft')
  const s = store(); savePending(s, pending)
  assert.equal(draftProgress(draft, null, loadReceipts(s), []).label, 'Checking published image')
})


test('verification started during engine reads invalidates the prepared dispatch', async () => {
  const f = fixture(), gate = deferred(), entered = deferred()
  await f.client.connect(f.session)
  f.setHandle(async name => { if (name === 'coding_engine_get') { entered.resolve(); await gate.promise } return response(name) })
  const publishing = f.client.publish(createRequest(draft, null), f.storage, () => {})
  await entered.promise; await f.client.verify(); gate.resolve()
  await assert.rejects(() => publishing, /Verification changed/)
  assert.ok(!f.calls.includes('coding_session_message'))
})

test('reported commit remains publishing after its cursor advances, but permits explicit failure', async () => {
  const f = fixture(); await f.client.connect(f.session)
  const request = { ...createRequest(draft, null), sessionId: 'csess-test' }
  let phase: 'committed' | 'thinking' | 'failed' = 'committed'
  f.setHandle(name => {
    if (name === 'coding_timeline') return {
      ...response(name) as object,
      nextSeq: phase === 'committed' ? 11 : phase === 'thinking' ? 12 : 13,
      events: phase === 'thinking' ? [] : [{ seq: phase === 'committed' ? 10 : 12, type: 'assistant', content: phase === 'committed' ? `YI_COMMITTED ${request.id} ${'a'.repeat(40)}` : `YI_FAILED ${request.id} deployment blocked` }],
    }
    if (name === 'coding_session_capture') return { ...response(name) as object, runState: 'thinking', ready: false }
    return response(name)
  })
  const committed = await f.client.reconcile(request, [])
  assert.equal(committed.status, 'deploying'); assert.equal(committed.sinceSeq, 11)
  phase = 'thinking'
  const waiting = await f.client.reconcile(committed, [])
  assert.equal(waiting.status, 'deploying'); assert.equal(waiting.sinceSeq, 12)
  assert.equal(waiting.detail, committed.detail)
  phase = 'failed'
  assert.equal((await f.client.reconcile(waiting, [])).status, 'failed')
  assert.ok(!f.calls.includes('coding_session_message'))
})
