import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { reportedOutcome, requestTurn, isRequestTurn, incompleteEvent, timelineSchema, type Outcome } from './outcome'
import { getSession, ISSUER, type OAuthSession } from './oauth'
import { assertBinding, assertTarget, generationInstruction, INSTANCE_ID, REPO_ID, loadPending, loadReceipts, pendingSchema, savePending, sessionList, type Pending } from './generation'
import { fetchIndex, verifyImage, type Store, type Published } from './model'

const required = ['my_instances', 'coding_repos_list', 'coding_engine_get', 'coding_sessions_list', 'coding_session_capture', 'coding_timeline', 'coding_session_message'] as const
const allowed = [...required, 'whoami'] as const
type ToolName = typeof allowed[number]
const captureSchema = z.object({ sessionId: z.string().optional(), runState: z.string(), runnerConnected: z.boolean(), alive: z.boolean().optional(), ready: z.boolean().optional(), authPrompt: z.unknown().optional(), pane: z.string().optional(), ownership: z.object({ owners: z.array(z.unknown()) }).optional() })

export class StatusUnavailable extends Error {}
class AccessDenied extends Error {}

// Never display raw MCP results: terminal output may contain private account data.
function unpack(result: unknown): unknown {
  const r = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() }).parse(result)
  if (r.isError) throw new AccessDenied('PAGS refused the operation. Check account permissions and runner availability in PAGS.')
  let value: unknown = r.structuredContent
  if (!value) {
    const text = r.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || ''
    try { value = JSON.parse(text) } catch { value = text }
  }
  if (value && typeof value === 'object' && 'error' in value || typeof value === 'string' && /^(Error|Authentication required|Permission denied)/i.test(value)) throw new AccessDenied('PAGS refused the operation. Reconnect or check the artist in PAGS.')
  return value
}

export type OwnerVerification = { label: string; accountId?: string; checkedAt: number; validUntil: number }
// The adapter is injectable for synthetic tests, never selected by URL/storage/UI.
export type PagsClient = Pick<Client, 'connect' | 'listTools' | 'callTool' | 'close'>

function safeIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : undefined
}

export class Pags {
  #client: PagsClient
  #schemas = new Map<string, Tool>()
  #validator = new AjvJsonSchemaValidator()
  #storage?: Store
  #session?: OAuthSession
  #closed = false
  #connecting = false
  #sending = false
  #revision = 0
  #accountId?: string
  #verification: OwnerVerification | null = null
  #onRevoke: () => void
  constructor(onRevoke: () => void = () => {}, client: PagsClient = new Client({ name: 'Yi', version: '1.1.0' }, { capabilities: {} })) {
    this.#client = client
    this.#onRevoke = onRevoke
  }
  #revoke() { this.#revision++; this.#verification = null; this.#onRevoke() }
  isCurrent() {
    const current = this.#storage && getSession(this.#storage)
    const valid = !this.#closed && !!current && !!this.#session && current.accessToken === this.#session.accessToken && current.clientId === this.#session.clientId && current.expiresAt === this.#session.expiresAt
    if (!valid && this.#session) { this.#closed = true; this.#revoke() }
    return valid
  }
  get verification(): OwnerVerification | null {
    if (!this.isCurrent() || !this.#verification) return null
    if (Date.now() >= this.#verification.validUntil) { this.#revoke(); return null }
    return { ...this.#verification }
  }
  #assertCurrent() {
    if (!this.isCurrent()) throw new Error('Your PAGS session expired, disconnected, or changed. Reconnect and verify the artist again.')
  }
  async connect(storage: Store) {
    if (this.#closed || this.#session || this.#connecting) throw new Error('Use a new PAGS client for each connection.')
    const session = getSession(storage)
    if (!session) throw new Error('Connect your PAGS account first. Sessions expire and must be reconnected.')
    this.#storage = storage; this.#session = session; this.#connecting = true
    const transport = new StreamableHTTPClientTransport(new URL(`${ISSUER}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${session.accessToken}` }, credentials: 'omit', redirect: 'error' },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    })
    try {
      await this.#client.connect(transport)
      this.#assertCurrent()
      let cursor: string | undefined
      const cursors = new Set<string>()
      do {
        const page = await this.#client.listTools(cursor ? { cursor } : {})
        this.#assertCurrent()
        for (const tool of page.tools) if (allowed.includes(tool.name as ToolName)) this.#schemas.set(tool.name, tool)
        cursor = page.nextCursor
        if (cursor && cursors.has(cursor)) throw new Error('Repeated tool page')
        if (cursor) cursors.add(cursor)
      } while (cursor)
      if (required.some(name => !this.#schemas.has(name))) throw new Error('Required PAGS tools are not available with this connection.')
    } catch {
      await this.close()
      throw new Error('Could not connect to the PAGS MCP service. Reconnect and check your network or permissions.')
    } finally { this.#connecting = false }
  }
  async close() {
    this.#closed = true; this.#revoke(); this.#schemas.clear()
    await this.#client.close().catch(() => {})
  }
  // Runtime-private: callers cannot bypass owner checks with a raw message call.
  async #call(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    this.#assertCurrent()
    const tool = this.#schemas.get(name)
    if (!tool || !allowed.includes(name)) throw new Error('This PAGS tool was not discovered or allowed.')
    const properties = tool.inputSchema.properties || {}
    if (Object.keys(args).some(key => !(key in properties)) || !this.#validator.getValidator(tool.inputSchema)(args).valid) throw new Error('PAGS changed its tool schema. Publishing is blocked until Yi is updated.')
    try {
      const result = await this.#client.callTool({ name, arguments: args }, undefined, { timeout: 60000 })
      this.#assertCurrent()
      return unpack(result)
    } catch (error) {
      const code = (error as { code?: number; status?: number })?.code ?? (error as { status?: number })?.status
      if (error instanceof AccessDenied || code === 401 || code === 403 || !this.isCurrent()) {
        this.#revoke()
        throw new AccessDenied('PAGS denied access or the session changed. Reconnect or check your account permissions.')
      }
      throw new StatusUnavailable('Status unavailable. Yi will retry automatically; no request will be resent.')
    }
  }
  async #verifyOwner() {
    const revision = ++this.#revision
    try {
      const instances = await this.#call('my_instances', {})
      const owned = z.object({ instances: z.array(z.object({ id: z.string(), status: z.string() })) }).parse(instances)
      if (!owned.instances.some(i => i.id === INSTANCE_ID && i.status === 'active')) throw new Error('This account does not own the configured Yi artist. Public cards and local drafts remain available.')
      const repos = await this.#call('coding_repos_list', { instance_id: INSTANCE_ID })
      assertBinding(repos)
      // whoami is authenticated account identity; never read candidate/profile data.
      const identity = this.#schemas.has('whoami') ? z.object({ id: z.string().min(1), login: z.string().min(1), provider: z.enum(['google', 'github']), providerLabel: z.string().min(1) }).parse(await this.#call('whoami', {})) : undefined
      const bound = z.object({ repos: z.array(z.object({ userId: z.unknown().optional() })) }).parse(repos)
      const accountId = safeIdentity(identity?.id) || safeIdentity(bound.repos[0]?.userId)
      const login = safeIdentity(identity?.login)
      const provider = safeIdentity(identity?.providerLabel) || identity?.provider
      this.#assertCurrent()
      if (this.#accountId && accountId !== this.#accountId) { this.#closed = true; throw new Error('The authenticated account identity changed. Reconnect and verify again.') }
      const verification: OwnerVerification = { label: login && provider ? `${login} · ${provider}` : 'Verified artist owner', ...(accountId ? { accountId } : {}), checkedAt: Date.now(), validUntil: this.#session!.expiresAt - 30000 }
      if (revision !== this.#revision) throw new Error('Verification changed while checking. Verify the current account again.')
      this.#accountId = accountId
      this.#verification = verification
      return { instances, repos, revision, verification: { ...verification } }
    } catch (error) { if (!(error instanceof StatusUnavailable)) this.#revoke(); throw error }
  }
  async #verifyTarget() {
    const owner = await this.#verifyOwner()
    const engine = await this.#call('coding_engine_get', { instance_id: INSTANCE_ID })
    const sessions = await this.#call('coding_sessions_list', { instance_id: INSTANCE_ID })
    return { ...owner, session: assertTarget(owner.instances, owner.repos, engine, sessions) }
  }
  async verify() { return (await this.#verifyOwner()).verification }
  async publish(request: Pending, storage: Store, onUpdate: (p: Pending) => void) {
    this.#assertCurrent()
    if (this.#sending) throw new Error('A publication is already being prepared. Check its status.')
    this.#sending = true
    try {
      const valid = pendingSchema.parse(request)
      const existing = loadPending(storage)
      if (loadReceipts(storage).some(r => r.id === valid.id || !['published', 'failed'].includes(r.status)) || existing && !['published', 'failed'].includes(existing.status)) throw new Error('This device already has a publication receipt. Check its status; never resend an uncertain request.')
      // This private path runs even when a caller skips the UI or overrides verify().
      const { session, revision } = await this.#verifyTarget()
      let sinceSeq: number | undefined
      if (session) {
        const timeline = timelineSchema.parse(await this.#call('coding_timeline', { instance_id: INSTANCE_ID, session_id: session.id, limit: 1 }))
        if (timeline.repoId && timeline.repoId !== REPO_ID || timeline.sessionId && timeline.sessionId !== session.id) throw new Error('The request session no longer matches Yi.')
        sinceSeq = timeline.nextSeq
        const capture = captureSchema.parse(await this.#call('coding_session_capture', { instance_id: INSTANCE_ID, session_id: session.id }))
        if (capture.sessionId && capture.sessionId !== session.id || !capture.runnerConnected || !capture.alive || !capture.ready || capture.runState !== 'idle' || capture.authPrompt || capture.ownership?.owners.length) throw new Error('The artist is busy, offline, or needs sign-in. Nothing was sent. Try again after its current work ends.')
      }
      this.#assertCurrent()
      if (revision !== this.#revision) throw new Error('Verification changed before sending. Nothing was sent.')
      const pending: Pending = { ...valid, sessionId: session?.id, sinceSeq, dispatchSeq: sinceSeq, status: 'uncertain', detail: 'Sending once. If the response is lost, Yi will reconcile this request without resending.' }
      savePending(storage, pending)
      onUpdate(pending)
      this.#assertCurrent()
      if (revision !== this.#revision) throw new Error('Verification changed before sending. Nothing was sent.')
      try {
        const result = await this.#call('coding_session_message', { instance_id: INSTANCE_ID, ...(session ? { session_id: session.id } : {}), message: generationInstruction(pending) })
        if (typeof result !== 'string' || !result.includes('Sent to session ') || result.includes('reply was lost')) throw new Error('Unconfirmed delivery')
        const sid = result.match(/Sent to session ([a-zA-Z0-9_-]+):/)?.[1]
        const next: Pending = { ...pending, sessionId: sid || pending.sessionId, status: 'queued', detail: 'PAGS accepted the message. Generation has not yet been observed.' }
        savePending(storage, next); onUpdate(next)
      } catch {
        onUpdate(pending) // It may have been sent. Never retry automatically.
      }
    } finally { this.#sending = false }
  }
  async reconcile(request: Pending, cards?: Published[]): Promise<Pending> {
    return this.#reconcile(request, cards)
  }
  async #reconcile(request: Pending, cards?: Published[]): Promise<Pending> {
    // Deployed data is the only proof of publication; no terminal success heuristic.
    const published = cards ?? await fetchIndex()
    const match = published.find(p => p.requestId === request.id && p.id === request.draft.id)
    if (match) {
      try { await verifyImage(match); return { ...request, status: 'published', detail: 'The published index and raster image are live, and the image checksum matches.' } }
      catch { return { ...request, status: 'deploying', detail: 'The published card is live; waiting for its matching image bytes.' } }
    }
    const { session } = await this.#verifyTarget()
    let sid = request.sessionId
    if (!sid) {
      const sessions = sessionList(await this.#call('coding_sessions_list', { instance_id: INSTANCE_ID }))
      // Find the opaque session id by observing the request marker, never by guessing.
      for (const candidate of sessions.filter(s => s.repoId === REPO_ID && s.clientType === 'codex').slice(0, 5)) {
        const timeline = timelineSchema.parse(await this.#call('coding_timeline', { instance_id: INSTANCE_ID, session_id: candidate.id, limit: 40 }))
        if (timeline.repoId && timeline.repoId !== REPO_ID || timeline.sessionId && timeline.sessionId !== candidate.id) throw new Error('The request session no longer matches Yi.')
        if (timeline.events.some(e => requestTurn(e, request.id) || reportedOutcome(e, request.id))) { sid = candidate.id; break }
      }
    }
    if (!sid) return request.status === 'deploying' ? request : { ...request, status: 'uncertain', detail: 'Delivery is still unconfirmed. The request will not be resent. Check the artist’s timeline in PAGS.' }
    const recovering = request.dispatchSeq === undefined
    let cursor = recovering ? undefined : request.sinceSeq ?? request.dispatchSeq
    let before: number | undefined
    let nextSeq = request.sinceSeq
    let outcome: Outcome | undefined
    let dispatchSeq = request.dispatchSeq
    let turn = request.requestTurnSeq
    let superseded = request.superseded ?? false
    const events: z.infer<typeof timelineSchema>['events'] = []
    let incomplete = false
    for (let page = 0; page < 5; page++) {
      // since_seq reads oldest->newest. before reads a newest page backwards.
      // These modes are mutually exclusive in the PAGS API.
      const timeline = timelineSchema.parse(await this.#call('coding_timeline', { instance_id: INSTANCE_ID, session_id: sid, limit: 40, ...(recovering ? before !== undefined ? { before } : {} : { since_seq: cursor }) }))
      if (timeline.repoId && timeline.repoId !== REPO_ID || timeline.sessionId && timeline.sessionId !== sid) throw new Error('The request session no longer matches Yi.')
      if (recovering ? page === 0 : true) nextSeq = timeline.nextSeq === undefined ? nextSeq : Math.max(nextSeq ?? 0, timeline.nextSeq)
      const relevant = timeline.events.filter(e => recovering || cursor === undefined || e.seq > cursor)
      events.push(...relevant)
      for (const event of relevant) {
        const found = reportedOutcome(event, request.id)
        if (found === 'failed' || found && !outcome) outcome = found
      }
      if (outcome === 'failed') break
      if (relevant.some(incompleteEvent) || (timeline.truncated?.events ?? 0) > timeline.events.filter(e => (e.chars ?? 0) > (e.content?.length ?? 0)).length) { incomplete = true; break }
      const boundary = recovering && relevant.find(e => requestTurn(e, request.id))
      if (boundary) { dispatchSeq = Math.max(0, boundary.seq - 1); break }
      if (!timeline.hasMore) break
      if (page === 4) { incomplete = true; break }
      if (recovering) {
        if (timeline.oldestSeq === undefined || before !== undefined && timeline.oldestSeq >= before || !this.#schemas.get('coding_timeline')?.inputSchema.properties?.before) { incomplete = true; break }
        before = timeline.oldestSeq
      } else {
        if (timeline.nextSeq === undefined || cursor !== undefined && timeline.nextSeq <= cursor) { incomplete = true; break }
        cursor = timeline.nextSeq
      }
    }
    // A later user turn can be unrelated code work. A busy session alone is not
    // evidence this image is generating. Only the matched latest request turn is.
    for (const event of events.sort((a, b) => a.seq - b.seq)) {
      if (!isRequestTurn(event)) continue
      if (turn !== undefined && event.seq <= turn) continue
      if (requestTurn(event, request.id)) turn = event.seq
      else if (turn !== undefined) superseded = true
    }
    if (incomplete && outcome !== 'failed') return { ...request, sessionId: sid, status: request.status === 'deploying' || outcome === 'deploying' ? 'deploying' : 'uncertain', detail: 'Status unavailable: activity is incomplete. Review the artist in PAGS. The saved cursor is unchanged and nothing will be resent.' }
    const next = { ...request, sessionId: sid, sinceSeq: recovering && dispatchSeq === undefined && !outcome ? request.sinceSeq : nextSeq, dispatchSeq, requestTurnSeq: turn, superseded }
    if (outcome === 'failed') return { ...next, status: 'failed', detail: 'The artist reported a failure. Review its PAGS timeline for the blocker. This request will not be resent.' }
    if (outcome === 'deploying') return { ...next, status: 'deploying', detail: 'The artist reports a pushed commit. Waiting for the deployed index and verified image.' }
    // The cursor may have moved past YI_COMMITTED. A busy session is weaker
    // evidence than that durable receipt; only explicit failure or live proof
    // may replace the publishing state.
    if (request.status === 'deploying') return next
    if (session?.id === sid) {
      const capture = captureSchema.parse(await this.#call('coding_session_capture', { instance_id: INSTANCE_ID, session_id: sid }))
      if (capture.sessionId && capture.sessionId !== sid) throw new Error('The request session no longer matches Yi.')
      if (!capture.runnerConnected || capture.authPrompt) return { ...next, status: 'uncertain', detail: 'The artist is offline or needs sign-in. This request remains pending; it will not be resent.' }
      if (turn !== undefined && !superseded && (capture.runState === 'thinking' || capture.runState === 'responding')) return { ...next, status: 'generating', detail: 'The request’s Codex session is working. Publication is not yet verified.' }
    }
    return { ...next, status: request.status === 'queued' && !recovering && !superseded ? 'queued' : 'uncertain', detail: 'No request-specific progress is confirmed. The artist may have stopped or moved to other work. Review it in PAGS; Yi will not resend this request.' }
  }
}
