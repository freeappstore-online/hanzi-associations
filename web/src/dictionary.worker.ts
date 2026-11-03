import { decodeDictionary, makeSearchIndex, parseCedict, searchDictionary, type Filter } from './dictionary'

let index: Promise<ReturnType<typeof makeSearchIndex>> | undefined
async function load() {
  const response = await fetch('/dictionary/cedict.bin')
  if (!response.ok || !response.body) throw new Error('Dictionary download failed.')
  const text = await decodeDictionary(await response.arrayBuffer())
  const entries = parseCedict(text)
  if (entries.length < 100000) throw new Error('Dictionary data is incomplete.')
  return makeSearchIndex(entries)
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; query: string; filter: Filter }>) => {
  try {
    index ??= load().catch(error => { index = undefined; throw error })
    self.postMessage({ id: data.id, ...searchDictionary(await index, data.query, data.filter) })
  } catch {
    self.postMessage({ id: data.id, error: 'Could not load the dictionary. Check your connection and try again. A browser with gzip DecompressionStream support is required.' })
  }
}
