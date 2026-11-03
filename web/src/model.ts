import { z } from 'zod'
import { entryKey, type Entry } from './dictionary'

const text = (max: number) => z.string().max(max)
export const entrySchema = z.object({ traditional: text(80).min(1), simplified: text(80).min(1), pinyin: text(200).min(1), definitions: z.array(text(2000)).min(1).max(100) })
export const draftSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), entry: entrySchema,
  type: z.enum(['sound', 'character', 'meaning']), cue: text(200), description: text(4000),
  songArtist: text(200), songTitle: text(200), updatedAt: z.string().datetime(),
})
export type Draft = z.infer<typeof draftSchema>
export const publishedSchema = draftSchema.extend({
  requestId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/),
  image: z.string().regex(/^\/associations\/[a-zA-Z0-9-]+\.(png|webp|jpe?g)$/),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  alt: text(1000).min(1), generatedWith: z.literal('codex-native-image-generation'),
})
export type Published = z.infer<typeof publishedSchema>
export const indexSchema = z.object({ version: z.literal(1), associations: z.array(publishedSchema).max(5000) })
export const backupSchema = z.object({ version: z.literal(1), drafts: z.array(draftSchema).max(2000) })
export const DRAFT_KEY = 'yi.drafts.v1'
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function loadDrafts(storage: Store): Draft[] {
  try {
    const raw = storage.getItem(DRAFT_KEY)
    return raw ? backupSchema.parse(JSON.parse(raw)).drafts : []
  } catch { throw new Error('Your saved drafts could not be read. They have not been overwritten. Export or recover browser storage before saving new drafts.') }
}
export function saveDrafts(storage: Store, drafts: Draft[]) {
  const valid = backupSchema.parse({ version: 1, drafts })
  try { storage.setItem(DRAFT_KEY, JSON.stringify(valid)) }
  catch { throw new Error('Drafts could not be saved on this device. Keep this tab open and export a backup.') }
}
export function importDrafts(raw: string, existing: Draft[]): Draft[] {
  if (raw.length > 10_000_000) throw new Error('Backup is too large (10 MB maximum).')
  const imported = backupSchema.parse(JSON.parse(raw)).drafts
  const merged = new Map(existing.map(d => [d.id, d]))
  for (const d of imported) if (!merged.has(d.id) || merged.get(d.id)!.updatedAt < d.updatedAt) merged.set(d.id, d)
  return backupSchema.parse({ version: 1, drafts: [...merged.values()] }).drafts
}
export function newDraft(entry: Entry): Draft {
  return { id: crypto.randomUUID(), entry, type: 'sound', cue: '', description: '', songArtist: '', songTitle: '', updatedAt: new Date().toISOString() }
}
export function mergeCards(drafts: Draft[], published: Published[]) {
  const rows = new Map<string, { draft: Draft; published?: Published }>()
  for (const p of published) rows.set(p.id, { draft: p, published: p })
  for (const d of drafts) rows.set(d.id, { draft: d, published: rows.get(d.id)?.published })
  return [...rows.values()].sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt))
}
export function sameBrief(a: Draft, b: Draft) {
  return entryKey(a.entry) === entryKey(b.entry) && ['type', 'cue', 'description', 'songArtist', 'songTitle'].every(k => a[k as keyof Draft] === b[k as keyof Draft])
}
export async function fetchIndex(): Promise<Published[]> {
  const response = await fetch(`/associations/index.json?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Published cards could not be loaded. Your local drafts are still available.')
  return indexSchema.parse(await response.json()).associations
}
export async function verifyImage(p: Published) {
  const response = await fetch(`${p.image}?sha=${p.imageSha256}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('The image is still deploying.')
  const bytes = await response.arrayBuffer()
  const signature = new Uint8Array(bytes).slice(0, 12)
  if (!(signature[0] === 137 && signature[1] === 80 || signature[0] === 255 && signature[1] === 216 || String.fromCharCode(...signature.slice(0, 4)) === 'RIFF')) throw new Error('The deployed asset is not a raster image.')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  if (hash !== p.imageSha256) throw new Error('The image is still deploying.')
}
