import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeDrafts, upsertDrafts } from '../web/src/drafts'
import { DRAFT_KEY, loadDrafts, type Draft, type Store } from '../web/src/model'
import { browserStore } from '../web/src/storage'
import { getSession } from '../web/src/oauth'
import { loadDictionary, validateDictionary } from '../web/src/dictionaryCache'
import { speakWord, stopSpeech } from '../web/src/speech'
const seed: Draft = JSON.parse(readFileSync('web/public/associations/index.json', 'utf8')).associations[0]
const a = { ...seed, id: 'a', updatedAt: '2026-11-04T01:00:00.000Z' }
const b = { ...a, id: 'b' }
function memory(): Store {
  const data = new Map<string, string>()
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v) }, removeItem: k => { data.delete(k) } }
}
test('upserts retain independent drafts and newer same-ID edits from durable storage', () => {
  const store = memory()
  upsertDrafts(store, [a]); upsertDrafts(store, [b])
  assert.equal(loadDrafts(store).length, 2)
  const edited = { ...a, cue: 'latest', updatedAt: '2026-11-04T02:00:00.000Z' }
  upsertDrafts(store, [edited]); upsertDrafts(store, [a])
  assert.equal(loadDrafts(store).find(d => d.id === a.id)?.cue, 'latest')
  assert.equal(mergeDrafts([edited], [a])[0].cue, 'latest')
})
test('corrupt/read-failed stores are never written; write failures propagate', () => {
  const store = memory(); store.setItem(DRAFT_KEY, '{broken')
  assert.throws(() => upsertDrafts(store, [a]), /not been overwritten/)
  assert.equal(store.getItem(DRAFT_KEY), '{broken')
  let writes = 0
  assert.throws(() => upsertDrafts({ ...store, getItem() { throw Error('read') }, setItem() { writes++ } }, [a]))
  assert.equal(writes, 0)
  assert.throws(() => upsertDrafts({ ...store, getItem: () => null, setItem() { throw Error('quota') } }, [a]), /export a backup/)
})
test('blocked session getter fails closed without throwing during anonymous session reads', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } })
  try { const store = browserStore('sessionStorage'); assert.equal(getSession(store), null); assert.throws(() => store.setItem('auth', 'secret'), /storage is unavailable/) }
  finally { if (original) Object.defineProperty(globalThis, 'sessionStorage', original); else Reflect.deleteProperty(globalThis, 'sessionStorage') }
})
test('dictionary validates exact snapshot and works online with denied cache', async () => {
  const bytes = Uint8Array.from(readFileSync('web/public/dictionary/cedict.bin')).buffer
  await assert.rejects(() => validateDictionary(new TextEncoder().encode('corrupt').buffer), /corrupt/)
  const oldFetch = globalThis.fetch, oldCache = Object.getOwnPropertyDescriptor(globalThis, 'caches')
  Object.defineProperty(globalThis, 'caches', { configurable: true, get() { throw Error('denied') } })
  globalThis.fetch = async () => new Response(bytes)
  try { assert.equal((await loadDictionary()).length, 125356); globalThis.fetch = async () => { throw Error('offline') }; await assert.rejects(loadDictionary, /offline/) }
  finally { globalThis.fetch = oldFetch; if (oldCache) Object.defineProperty(globalThis, 'caches', oldCache); else Reflect.deleteProperty(globalThis, 'caches') }
})
for (const method of ['getVoices', 'addEventListener', 'speak', 'cancel']) test(`speech contains ${method} failures and reports only errors`, () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis'), utterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance')
  const synth = { getVoices: () => [{ lang: 'zh-CN', name: 'local', localService: true }], addEventListener() {}, removeEventListener() {}, speak() {}, cancel() {} }
  Object.assign(synth, { [method]: () => { throw Error('browser failure') } })
  Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: synth })
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: class {} })
  try { const errors: string[] = []; speakWord('椅子', {}, error => errors.push(error)); stopSpeech(); assert.ok(errors.every(e => !e || e.includes('could not play'))) }
  finally { stopSpeech(); if (old) Object.defineProperty(globalThis, 'speechSynthesis', old); else Reflect.deleteProperty(globalThis, 'speechSynthesis'); if (utterance) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', utterance); else Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance') }
})
