import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { indexSchema } from '../web/src/model.ts'
import { entryKey, parseCedict } from '../web/src/dictionary.ts'

const data = indexSchema.parse(JSON.parse(await readFile('web/public/associations/index.json', 'utf8')))
const dictionary = parseCedict(gunzipSync(await readFile('web/public/dictionary/cedict.bin')).toString('utf8'))
const entries = new Map(dictionary.map(e => [entryKey(e), e]))
const ids = new Set<string>(), requests = new Set<string>()
for (const a of data.associations) {
  if (ids.has(a.id) || requests.has(a.requestId)) throw new Error('Duplicate card or request id')
  ids.add(a.id); requests.add(a.requestId)
  const entry = entries.get(entryKey(a.entry))
  if (!entry || JSON.stringify(entry.definitions) !== JSON.stringify(a.entry.definitions)) throw new Error(`Dictionary mismatch: ${a.id}`)
  const path = `web/public${a.image}`
  if (!(await stat(path)).isFile()) throw new Error(`Not a file: ${path}`)
  const bytes = await readFile(path)
  if (bytes.length < 1024 || !(bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || bytes[0] === 255 && bytes[1] === 216 || bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')) throw new Error(`Not a raster: ${path}`)
  if (createHash('sha256').update(bytes).digest('hex') !== a.imageSha256) throw new Error(`Checksum mismatch: ${path}`)
}
console.log(`Validated ${data.associations.length} association(s): dictionary entries, safe paths, unique ids, raster signatures, and SHA-256.`)
