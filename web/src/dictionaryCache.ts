import { decodeDictionary, makeSearchIndex, parseCedict } from './dictionary'

// CC-CEDICT snapshot 2026-11-02. Bump the cache version/hash with the snapshot.
export const DICTIONARY_CACHE = 'yi-dictionary-2026-11-02-v1'
const PATH = '/dictionary/cedict.bin'
const SHA256 = '0c0d0ccea1f05eae5ffacefa37f911211455c0cfbab8cf0418b8c7a823d57b31'
export async function validateDictionary(bytes: ArrayBuffer) {
  const text = await decodeDictionary(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  if (hash !== SHA256) throw new Error('Dictionary snapshot is corrupt or incomplete.')
  const entries = parseCedict(text)
  if (entries.length !== 125356) throw new Error('Dictionary data is incomplete.')
  return makeSearchIndex(entries)
}
export async function loadDictionary() {
  let cache: Cache | undefined
  try { cache = await caches.open(DICTIONARY_CACHE) } catch { /* Online lookup still works without CacheStorage. */ }
  try {
    const cached = await cache?.match(PATH)
    if (cached) return await validateDictionary(await cached.arrayBuffer())
  } catch { try { await cache?.delete(PATH) } catch { /* Best effort; never trust invalid bytes. */ } }
  const response = await fetch(PATH, { cache: 'no-store' })
  if (!response.ok) throw new Error('Dictionary download failed.')
  const bytes = await response.arrayBuffer()
  const index = await validateDictionary(bytes)
  try { await cache?.put(PATH, new Response(bytes)) } catch { /* Storage denial must not break online lookup. */ }
  return index
}
