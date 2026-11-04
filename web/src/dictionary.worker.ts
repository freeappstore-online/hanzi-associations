import { loadDictionary } from './dictionaryCache'
import { makeSearchIndex, searchDictionary, type Filter } from './dictionary'

let index: Promise<ReturnType<typeof makeSearchIndex>> | undefined
self.onmessage = async ({ data }: MessageEvent<{ id: number; query: string; filter: Filter }>) => {
  try {
    index ??= loadDictionary().catch(error => { index = undefined; throw error })
    self.postMessage({ id: data.id, ...searchDictionary(await index, data.query, data.filter) })
  } catch {
    self.postMessage({ id: data.id, error: 'Could not load the dictionary. Check your connection and try again. A browser with gzip DecompressionStream support is required.' })
  }
}
