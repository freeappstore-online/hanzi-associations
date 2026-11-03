import { INSTANCE_ID, REPO_ID, REPO } from '../web/src/generation.ts'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
export const toolNames = ['my_instances', 'whoami', 'coding_repos_list', 'coding_engine_get', 'coding_sessions_list', 'coding_session_capture', 'coding_timeline', 'coding_session_message']
export const tools: Tool[] = toolNames.map(name => ({ name, inputSchema: { type: 'object', properties: name === 'my_instances' || name === 'whoami' ? { token: { type: 'string' } } : { instance_id: { type: 'string' }, ...(['coding_session_capture', 'coding_timeline', 'coding_session_message'].includes(name) ? { session_id: { type: 'string' } } : {}), ...(name === 'coding_timeline' ? { limit: { type: 'number' }, since_seq: { type: 'number' }, before: { type: 'number' } } : {}), ...(name === 'coding_session_message' ? { message: { type: 'string' } } : {}) }, required: name === 'my_instances' || name === 'whoami' ? [] : name === 'coding_session_message' ? ['instance_id', 'message'] : ['instance_id'], ...(name === 'coding_timeline' ? { not: { required: ['since_seq', 'before'] } } : {}), additionalProperties: false } }))
export function response(name: string): unknown {
  switch (name) {
    case 'my_instances': return { instances: [{ id: INSTANCE_ID, status: 'active' }] }
    case 'whoami': return { id: 'google:synthetic-owner', login: 'Test Owner', provider: 'google', providerLabel: 'Google', email: 'unused@example.invalid', roles: ['user'], createdAt: '2026-01-01T00:00:00Z', tokenExpiry: new Date(Date.now() + 3600000).toISOString() }
    case 'coding_repos_list': return { repos: [{ id: REPO_ID, githubRepo: REPO, cloneStatus: 'ready', userId: 'google:synthetic-owner' }] }
    case 'coding_engine_get': return { defaultEngineId: 'codex', engines: [{ id: 'codex', billing: 'subscription' }] }
    case 'coding_sessions_list': return [{ id: 'csess-test', repoId: REPO_ID, clientType: 'codex', status: 'active' }]
    case 'coding_session_capture': return { sessionId: 'csess-test', runState: 'idle', runnerConnected: true, alive: true, ready: true, ownership: { owners: [] } }
    case 'coding_timeline': return { sessionId: 'csess-test', repoId: REPO_ID, nextSeq: 1, events: [] }
    case 'coding_session_message': return 'Sent to session csess-test: "synthetic" — direct turn, delivered, not yet processed'
    default: throw Error('Unexpected tool ' + name)
  }
}
