import { z } from 'zod'
import type { Store } from './model'

export const ISSUER = 'https://mcp.proagentstore.online'
export const SCOPES = 'read runtime'
export const AUTH_KEY = 'yi.oauth.session.v1'
export const FLOW_KEY = 'yi.oauth.flow.v1'
const CLIENT_KEY = 'yi.oauth.client.v1'
const authGenerations = new WeakMap<Store, number>()
function nextAuthGeneration(store: Store) { const next = (authGenerations.get(store) || 0) + 1; authGenerations.set(store, next); return next }
const sessionSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.number().finite(), clientId: z.string().min(1) })
const flowSchema = z.object({ state: z.string().min(32), verifier: z.string().min(43).max(128), createdAt: z.number(), redirectUri: z.string().url(), clientId: z.string().min(1) })
export type OAuthSession = z.infer<typeof sessionSchema>
const metadataSchema = z.object({
  issuer: z.literal(ISSUER), authorization_endpoint: z.literal(`${ISSUER}/authorize`),
  token_endpoint: z.literal(`${ISSUER}/token`), registration_endpoint: z.literal(`${ISSUER}/register`),
  code_challenge_methods_supported: z.array(z.string()).refine(v => v.includes('S256')),
  token_endpoint_auth_methods_supported: z.array(z.string()).refine(v => v.includes('none')),
})
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)))
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function challenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}
async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('PAGS sign-in could not be completed. Please reconnect and try again.')
  return response.json()
}
function put(store: Store, key: string, value: unknown) {
  try { store.setItem(key, JSON.stringify(value)) }
  catch { throw new Error('Session storage is unavailable. Allow browser storage to connect securely.') }
}
export function getSession(store: Store, now = Date.now()): OAuthSession | null {
  try {
    const raw = store.getItem(AUTH_KEY)
    if (!raw) return null
    const parsed = sessionSchema.parse(JSON.parse(raw))
    if (parsed.expiresAt <= now + 30000) { store.removeItem(AUTH_KEY); return null }
    return parsed
  } catch { return null }
}
export function disconnect(store: Store) {
  nextAuthGeneration(store)
  for (const key of [AUTH_KEY, FLOW_KEY, CLIENT_KEY]) store.removeItem(key)
}
export async function beginOAuth(store: Store, origin: string) {
  const generation = nextAuthGeneration(store)
  const metadata = metadataSchema.parse(await jsonFetch(`${ISSUER}/.well-known/oauth-authorization-server`))
  const redirectUri = `${origin}/connection`
  let clientId: string | undefined
  try {
    const cached = JSON.parse(store.getItem(CLIENT_KEY) || 'null')
    if (cached?.redirectUri === redirectUri && typeof cached.clientId === 'string') clientId = cached.clientId
  } catch { /* A damaged registration is replaced; never reuse credentials. */ }
  if (!clientId) {
    const registration = await jsonFetch(metadata.registration_endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Yi — Chinese associations', redirect_uris: [redirectUri], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPES }),
    })
    if (typeof registration.client_id !== 'string' || !registration.client_id || registration.token_endpoint_auth_method && registration.token_endpoint_auth_method !== 'none') throw new Error('PAGS did not register a public browser client.')
    clientId = registration.client_id
    put(store, CLIENT_KEY, { clientId, redirectUri })
  }
  if (authGenerations.get(store) !== generation) throw new Error('Sign-in was cancelled or superseded.')
  const state = random(), verifier = random()
  put(store, FLOW_KEY, { state, verifier, createdAt: Date.now(), redirectUri, clientId })
  const url = new URL(metadata.authorization_endpoint)
  url.search = new URLSearchParams({ client_id: clientId!, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES, state, code_challenge: await challenge(verifier), code_challenge_method: 'S256', resource: `${ISSUER}/mcp` }).toString()
  return url.href
}

export function consumeState(store: Store, state: string | null, redirectUri: string, now = Date.now()) {
  const raw = store.getItem(FLOW_KEY)
  store.removeItem(FLOW_KEY) // Single use, including rejected callbacks.
  let flow: z.infer<typeof flowSchema>
  try { flow = flowSchema.parse(JSON.parse(raw || 'null')) }
  catch { throw new Error('This sign-in has no matching request in this tab. Connect again.') }
  if (!state || state !== flow.state || flow.redirectUri !== redirectUri || now - flow.createdAt > 600000 || now < flow.createdAt) throw new Error('Sign-in state is invalid or expired. Connect again in this tab.')
  return flow
}

export async function finishOAuth(store: Store, callback: URL) {
  const generation = nextAuthGeneration(store)
  const previousSession = store.getItem(AUTH_KEY)
  const flow = consumeState(store, callback.searchParams.get('state'), callback.origin + callback.pathname)
  if (callback.searchParams.has('error')) throw new Error('PAGS sign-in was cancelled or declined.')
  const code = callback.searchParams.get('code')
  if (!code) throw new Error('PAGS did not return an authorization code.')
  const metadata = metadataSchema.parse(await jsonFetch(`${ISSUER}/.well-known/oauth-authorization-server`))
  const tokens = await jsonFetch(metadata.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, client_id: flow.clientId, code_verifier: flow.verifier, resource: `${ISSUER}/mcp` }).toString(),
  })
  if (typeof tokens.access_token !== 'string' || tokens.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) throw new Error('PAGS returned an invalid or expired session.')
  if (tokens.scope && (!SCOPES.split(' ').every(s => tokens.scope.split(' ').includes(s)) || tokens.scope.split(' ').some((s: string) => !SCOPES.split(' ').includes(s)))) throw new Error('PAGS granted unexpected permissions. Reconnect with read and runtime only.')
  // Deliberately do not retain refresh tokens; reconnect after the short session expires.
  const session = { accessToken: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000, clientId: flow.clientId }
  if (authGenerations.get(store) !== generation || store.getItem(AUTH_KEY) !== previousSession) throw new Error('Sign-in was cancelled or the account changed. Connect again.')
  put(store, AUTH_KEY, session)
  return session
}
