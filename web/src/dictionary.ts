export interface Entry {
  traditional: string
  simplified: string
  pinyin: string
  definitions: string[]
}

const tones: Record<string, string> = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ', m: 'm̄ḿm̌m̀', n: 'n̄ńňǹ' }

export function toneMarks(pinyin: string): string {
  return pinyin.replace(/([a-züÜ:]+)([0-5])/gi, (_, raw: string, digit: string) => {
    const syllable = raw.replace(/u:/gi, 'ü').replace(/v/gi, 'ü')
    const tone = Number(digit)
    if (tone === 0 || tone === 5) return syllable
    const lower = syllable.toLowerCase()
    let i = lower.indexOf('a')
    if (i < 0) i = lower.indexOf('e')
    if (i < 0 && lower.includes('ou')) i = lower.indexOf('o')
    if (i < 0) i = Math.max(...['i', 'o', 'u', 'ü'].map(v => lower.lastIndexOf(v)))
    if (i < 0) {
      // Syllabic nasals are rare but valid CC-CEDICT readings.
      const mark = ['', '\u0304', '\u0301', '\u030c', '\u0300'][tone]
      return syllable.replace(/[mn]/i, c => (c + mark).normalize('NFC'))
    }
    const marked = tones[lower[i]][tone - 1]
    return syllable.slice(0, i) + (syllable[i] === lower[i] ? marked : marked.toUpperCase()) + syllable.slice(i + 1)
  })
}

export function normalizePinyin(value: string): string {
  // Keep ü distinct from u, while accepting ü / u: / v and any tone notation.
  return value.toLowerCase().replace(/u:|v/g, 'ü').normalize('NFD')
    .replace(/u\u0308/g, 'v').replace(/[\u0300-\u036f0-5\s'’·-]/g, '').normalize('NFC')
}

export function parseCedict(text: string): Entry[] {
  const entries: Entry[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\S+) (\S+) \[([^\]]+)\] \/(.+)\/$/)
    if (match) entries.push({ traditional: match[1], simplified: match[2], pinyin: match[3], definitions: match[4].split('/') })
  }
  return entries
}

export const entryKey = (e: Entry) => `${e.traditional}|${e.simplified}|${e.pinyin}`
export type Filter = 'all' | 'characters' | 'words'
export function makeSearchIndex(entries: Entry[]) {
  return entries.map(entry => ({ entry, sound: normalizePinyin(entry.pinyin), gloss: entry.definitions.join('; ').toLowerCase() }))
}
export function searchDictionary(index: ReturnType<typeof makeSearchIndex>, query: string, filter: Filter = 'all') {
  const q = query.trim().toLowerCase()
  if (!q || q.length > 100) return { entries: [], total: 0 }
  const sound = normalizePinyin(q)
  const hanzi = /\p{Script=Han}/u.test(q)
  const terms = q.split(/\s+/)
  const matches: { entry: Entry; score: number }[] = []
  for (const row of index) {
    const { entry: e } = row
    const length = [...e.simplified].length
    if (filter === 'characters' && length !== 1 || filter === 'words' && length < 2) continue
    let score = 0
    if (hanzi) {
      if (e.simplified === q || e.traditional === q) score = 100
      else if (e.simplified.startsWith(q) || e.traditional.startsWith(q)) score = 65
      else if (e.simplified.includes(q) || e.traditional.includes(q)) score = 30
    } else {
      if (row.sound === sound) score = 90
      else if (sound.length > 1 && row.sound.startsWith(sound)) score = 25
      if (e.definitions.some(d => d.toLowerCase() === q)) score = Math.max(score, 100)
      else if (terms.every(t => row.gloss.split(/[^a-zü0-9]+/).some(w => w === t))) score = Math.max(score, 55)
    }
    if (score) matches.push({ entry: e, score: score - length / 100 })
  }
  matches.sort((a, b) => b.score - a.score || a.entry.pinyin.localeCompare(b.entry.pinyin))
  return { entries: matches.slice(0, 60).map(m => m.entry), total: matches.length }
}

// Some hosts decode Content-Encoding before fetch exposes bytes. Inspect the
// payload, not the filename/header, so both raw gzip and decoded text work.
export async function decodeDictionary(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
