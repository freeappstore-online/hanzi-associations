import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { getSession, ISSUER } from './oauth'
import { assertTarget, generationInstruction, INSTANCE_ID, REPO_ID, savePending, sessionList, type Pending } from './generation'
import { fetchIndex, verifyImage, type Store } from './model'

const allowed = ['my_instances', 'coding_repos_list', 'coding_engine_get', 'coding_sessions_list', 'coding_session_capture', 'coding_timeline', 'coding_session_message'] as const
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

export class Pags {
  private client = new Client({ name: 'Yi', version: '1.0.0' }, { capabilities: {} })
  private schemas = new Map<string, Tool>()
  private validator = new AjvJsonSchemaValidator()
  private expiresAt = 0
  async connect(storage: Store) {
    const session = getSession(storage)
    if (!session) throw new Error('Connect your PAGS account first. Sessions expire and must be reconnected.')
    this.expiresAt = session.expiresAt
    const transport = new StreamableHTTPClientTransport(new URL(`${ISSUER}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${session.accessToken}` }, credentials: 'omit', redirect: 'error' },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    })
    try {
      await this.client.connect(transport)
      let cursor: string | undefined
      do {
        const page = await this.client.listTools(cursor ? { cursor } : {})
        for (const tool of page.tools) if (allowed.includes(tool.name as ToolName)) this.schemas.set(tool.name, tool)
        cursor = page.nextCursor
      } while (cursor)
      if (allowed.some(name => !this.schemas.has(name))) throw new Error('Required PAGS tools are not available with this connection.')
    } catch {
      await this.close()
      throw new Error('Could not connect to the PAGS MCP service. Reconnect and check your network or permissions.')
    }
  }
  async close() { await this.client.close().catch(() => {}) }
  async call(name: ToolName, args: Record<string, unknown>): Promise<unknown> {
    if (Date.now() + 30000 >= this.expiresAt) throw new Error('Your PAGS session expired. Reconnect to continue.')
    const tool = this.schemas.get(name)
    if (!tool || !allowed.includes(name)) throw new Error('This PAGS tool was not discovered or allowed.')
    const properties = tool.inputSchema.properties || {}
    if (Object.keys(args).some(key => !(key in properties)) || !this.validator.getValidator(tool.inputSchema)(args).valid) throw new Error('PAGS changed its tool schema. Publishing is blocked until Yi is updated.')
    try { return unpack(await this.client.callTool({ name, arguments: args }, undefined, { timeout: 60000 })) }
    catch { throw new Error('PAGS did not confirm the operation. Check status before trying anything else.') }
  }
  async verify() {
    const instances = await this.call('my_instances', {})
    // Check ownership BEFORE reading any instance-owned resource.
    const owned = z.object({ instances: z.array(z.object({ id: z.string(), status: z.string() })) }).parse(instances)
    if (!owned.instances.some(i => i.id === INSTANCE_ID && i.status === 'active')) throw new Error('This account does not own the configured Yi artist. You can still look up words and save drafts.')
    const [repos, engine, sessions] = await Promise.all([
      this.call('coding_repos_list', { instance_id: INSTANCE_ID }),
      this.call('coding_engine_get', { instance_id: INSTANCE_ID }),
      this.call('coding_sessions_list', { instance_id: INSTANCE_ID }),
    ])
    return assertTarget(instances, repos, engine, sessions)
  }
  async publish(request: Pending, storage: Store, onUpdate: (p: Pending) => void) {
    const session = await this.verify()
    let sinceSeq: number | undefined
    if (session) {
      const capture = captureSchema.parse(await this.call('coding_session_capture', { instance_id: INSTANCE_ID, session_id: session.id }))
      if (!capture.runnerConnected || !capture.alive || !capture.ready || capture.runState !== 'idle' || capture.authPrompt || capture.ownership?.owners.length) throw new Error('The artist is busy, offline, or needs sign-in. Nothing was sent. Try again after its current work ends.')
      const timeline = timelineSchema.parse(await this.call('coding_timeline', { instance_id: INSTANCE_ID, session_id: session.id, limit: 1 }))
      sinceSeq = timeline.nextSeq
    }
    const pending: Pending = { ...request, sessionId: session?.id, sinceSeq, status: 'uncertain', detail: 'Sending once. If the response is lost, Yi will reconcile this request without resending.' }
    savePending(storage, pending) // Must succeed BEFORE any mutating call.
    onUpdate(pending)
    try {
      const result = await this.call('coding_session_message', { instance_id: INSTANCE_ID, ...(session ? { session_id: session.id } : {}), message: generationInstruction(pending) })
      if (typeof result !== 'string' || !result.includes('Sent to session ') || result.includes('reply was lost')) throw new Error('Unconfirmed delivery')
      const sid = result.match(/Sent to session ([a-zA-Z0-9_-]+):/)?.[1]
      const next: Pending = { ...pending, sessionId: sid || pending.sessionId, status: 'queued', detail: 'PAGS accepted the message. Generation has not yet been observed.' }
      savePending(storage, next); onUpdate(next)
    } catch {
      // Do not mark failed: even a timeout or lost acknowledgement may have sent it.
      onUpdate(pending)
    }
  }
  async reconcile(request: Pending): Promise<Pending> {
    // Deployed data is the only proof of publication; no terminal success heuristic.
    const published = await fetchIndex()
    const match = published.find(p => p.requestId === request.id && p.id === request.draft.id)
    if (match) {
      try { await verifyImage(match); return { ...request, status: 'published', detail: 'The published index and raster image are live, and the image checksum matches.' } }
      catch { return { ...request, status: 'deploying', detail: 'The published card is live; waiting for its matching image bytes.' } }
    }
    const session = await this.verify()
    let sid = request.sessionId
    if (!sid) {
      const sessions = sessionList(await this.call('coding_sessions_list', { instance_id: INSTANCE_ID }))
      // Find the opaque session id by observing the request marker, never by guessing.
      for (const candidate of sessions.filter(s => s.repoId === REPO_ID && s.clientType === 'codex').slice(0, 5)) {
        const timeline = timelineSchema.parse(await this.call('coding_timeline', { instance_id: INSTANCE_ID, session_id: candidate.id, limit: 40 }))
        if (timeline.events.some(e => e.content?.includes(`YI_ASSOCIATION_REQUEST ${request.id}`))) { sid = candidate.id; break }
      }
    }
    if (!sid) return { ...request, status: 'uncertain', detail: 'Delivery is still unconfirmed. The request will not be resent. Check the artist’s timeline in PAGS.' }
    const timeline = timelineSchema.parse(await this.call('coding_timeline', { instance_id: INSTANCE_ID, session_id: sid, limit: 40, ...(request.sinceSeq !== undefined ? { since_seq: request.sinceSeq } : {}) }))
    if (timeline.repoId && timeline.repoId !== REPO_ID) throw new Error('The request session no longer matches Yi.')
    // Only exact standalone marker lines qualify; the original prompt contains inline examples.
    const report = timeline.events.filter(e => e.type !== 'user' && e.type !== 'instruction').map(e => e.content || '').join('\n')
    const next = { ...request, sessionId: sid, sinceSeq: timeline.nextSeq ?? request.sinceSeq }
    if (new RegExp(`^YI_FAILED ${request.id} [^\n]+$`, 'm').test(report)) return { ...next, status: 'failed', detail: 'The artist reported a failure. Review its PAGS timeline for the exact blocker, revise if needed, and publish again.' }
    if (new RegExp(`^YI_COMMITTED ${request.id} [a-f0-9]{40}$`, 'm').test(report)) return { ...next, status: 'deploying', detail: 'The artist reports a pushed commit. Waiting for the deployed index and verified image.' }
    if (session?.id === sid) {
      const capture = captureSchema.parse(await this.call('coding_session_capture', { instance_id: INSTANCE_ID, session_id: sid }))
      if (!capture.runnerConnected || capture.authPrompt) return { ...next, detail: 'The artist is offline or needs sign-in. This request remains pending; it will not be resent.' }
      if (capture.runState === 'thinking' || capture.runState === 'responding') return { ...next, status: 'generating', detail: 'The request’s Codex session is working. Publication is not yet verified.' }
    }
    return { ...next, detail: request.status === 'deploying' ? request.detail : 'No deployed result yet. Check the artist in PAGS if it needs attention. Yi will not resend this request.' }
  }
}
