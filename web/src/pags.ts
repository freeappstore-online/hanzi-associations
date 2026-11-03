import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { getSession, ISSUER, type OAuthSession } from './oauth'
import { assertTarget, generationInstruction, INSTANCE_ID, REPO_ID, loadPending, loadReceipts, pendingSchema, savePending, sessionList, type Pending } from './generation'
import { fetchIndex, verifyImage, type Store } from './model'

const required = ['my_instances', 'coding_repos_list', 'coding_engine_get', 'coding_sessions_list', 'coding_session_capture', 'coding_timeline', 'coding_session_message'] as const
const allowed = [...required, 'whoami'] as const
type ToolName = typeof allowed[number]
const captureSchema = z.object({ sessionId: z.string().optional(), runState: z.string(), runnerConnected: z.boolean(), alive: z.boolean().optional(), ready: z.boolean().optional(), authPrompt: z.unknown().optional(), pane: z.string().optional(), ownership: z.object({ owners: z.array(z.unknown()) }).optional() })
const timelineSchema = z.object({ sessionId: z.string().nullable().optional(), repoId: z.string().nullable().optional(), nextSeq: z.number().optional(), events: z.array(z.object({ seq: z.number(), type: z.string(), content: z.string().optional() })) })

// Never display raw MCP results: terminal output may contain private account data.
function unpack(result: unknown): unknown {
  const r = z.object({ isError: z.boolean().optional(), structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() }).parse(result)
  if (r.isError) throw new Error('PAGS refused the operation. Check account permissions and runner availability in PAGS.')
  let value: unknown = r.structuredContent
  if (!value) {
    const text = r.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || ''
    try { value = JSON.parse(text) } catch { value = text }
  }
  if (value && typeof value === 'object' && 'error' in value || typeof value === 'string' && /^(Error|Authentication required|Permission denied)/i.test(value)) throw new Error('PAGS refused the operation. Reconnect or check the artist in PAGS.')
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
    } catch {
      this.#revoke()
      throw new Error('PAGS did not confirm the operation. Verify the connection and check status before trying anything else.')
    }
  }
  async #verifyTarget() {
    this.#revoke()
    const revision = this.#revision
    try {
      const instances = await this.#call('my_instances', {})
      const owned = z.object({ instances: z.array(z.object({ id: z.string(), status: z.string() })) }).parse(instances)
      if (!owned.instances.some(i => i.id === INSTANCE_ID && i.status === 'active')) throw new Error('This account does not own the configured Yi artist. Public cards and local drafts remain available.')
      const repos = await this.#call('coding_repos_list', { instance_id: INSTANCE_ID })
      const engine = await this.#call('coding_engine_get', { instance_id: INSTANCE_ID })
      const sessions = await this.#call('coding_sessions_list', { instance_id: INSTANCE_ID })
      const session = assertTarget(instances, repos, engine, sessions)
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
      return { session, verification: { ...verification } }
    } catch (error) { this.#revoke(); throw error }
  }
  async verify() { return (await this.#verifyTarget()).verification }
  async publish(request: Pending, storage: Store, onUpdate: (p: Pending) => void) {
    this.#assertCurrent()
    if (this.#sending) throw new Error('A publication is already being prepared. Check its status.')
    this.#sending = true
    try {
      const valid = pendingSchema.parse(request)
      const existing = loadPending(storage)
      if (loadReceipts(storage).some(r => r.id === valid.id) || existing && !['published', 'failed'].includes(existing.status)) throw new Error('This device already has a publication receipt. Check its status; never resend an uncertain request.')
      // This private path runs even when a caller skips the UI or overrides verify().
      const { session } = await this.#verifyTarget()
      const revision = this.#revision
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
      const pending: Pending = { ...valid, sessionId: session?.id, sinceSeq, status: 'uncertain', detail: 'Sending once. If the response is lost, Yi will reconcile this request without resending.' }
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
        this.#revoke()
        onUpdate(pending) // It may have been sent. Never retry automatically.
      }
    } catch (error) { this.#revoke(); throw error }
    finally { this.#sending = false }
  }
  async reconcile(request: Pending): Promise<Pending> {
    try { return await this.#reconcile(request) }
    catch (error) { this.#revoke(); throw error }
  }
  async #reconcile(request: Pending): Promise<Pending> {
    // Deployed data is the only proof of publication; no terminal success heuristic.
    const published = await fetchIndex()
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
        if (timeline.events.some(e => e.content?.includes(`YI_ASSOCIATION_REQUEST ${request.id}`))) { sid = candidate.id; break }
      }
    }
    if (!sid) return { ...request, status: 'uncertain', detail: 'Delivery is still unconfirmed. The request will not be resent. Check the artist’s timeline in PAGS.' }
    const timeline = timelineSchema.parse(await this.#call('coding_timeline', { instance_id: INSTANCE_ID, session_id: sid, limit: 40, ...(request.sinceSeq !== undefined ? { since_seq: request.sinceSeq } : {}) }))
    if (timeline.repoId && timeline.repoId !== REPO_ID) throw new Error('The request session no longer matches Yi.')
    // Only exact standalone marker lines qualify; the original prompt contains inline examples.
    const report = timeline.events.filter(e => e.type !== 'user' && e.type !== 'instruction').map(e => e.content || '').join('\n')
    const next = { ...request, sessionId: sid, sinceSeq: timeline.nextSeq ?? request.sinceSeq }
    if (new RegExp(`^YI_FAILED ${request.id} [^\n]+$`, 'm').test(report)) return { ...next, status: 'failed', detail: 'The artist reported a failure. Review its PAGS timeline for the exact blocker, revise if needed, and publish again.' }
    if (new RegExp(`^YI_COMMITTED ${request.id} [a-f0-9]{40}$`, 'm').test(report)) return { ...next, status: 'deploying', detail: 'The artist reports a pushed commit. Waiting for the deployed index and verified image.' }
    if (session?.id === sid) {
      const capture = captureSchema.parse(await this.#call('coding_session_capture', { instance_id: INSTANCE_ID, session_id: sid }))
      if (!capture.runnerConnected || capture.authPrompt) return { ...next, detail: 'The artist is offline or needs sign-in. This request remains pending; it will not be resent.' }
      if (capture.runState === 'thinking' || capture.runState === 'responding') return { ...next, status: 'generating', detail: 'The request’s Codex session is working. Publication is not yet verified.' }
    }
    return { ...next, detail: request.status === 'deploying' ? request.detail : 'No deployed result yet. Check the artist in PAGS if it needs attention. Yi will not resend this request.' }
  }
}
