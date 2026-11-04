import { useEffect, useRef, useState } from 'react'
import { DRAFT_KEY, importDrafts, loadDrafts, saveDrafts, type Draft, type Store } from './model'
import { localStore } from './storage'

export function mergeDrafts(existing: Draft[], incoming: Draft[]) {
  return importDrafts(JSON.stringify({ version: 1, drafts: incoming }), existing)
}
export function upsertDrafts(store: Store, incoming: Draft[]) {
  // Reading and validating must succeed before any write (including imports).
  const next = mergeDrafts(loadDrafts(store), incoming)
  saveDrafts(store, next)
  return next
}
export function useDrafts() {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [storageError, setStorageError] = useState('')
  const current = useRef<Draft[]>([])
  const queue = useRef(Promise.resolve(true))
  const writeFailed = useRef(false)
  const update = (next: Draft[]) => { current.current = next; setDrafts(next) }
  const fail = (error: unknown) => setStorageError(error instanceof Error && error.name !== 'ZodError' ? error.message : 'Drafts could not be saved: the backup or combined draft collection exceeds the supported limits or contains invalid data. Export your current work before importing more.')
  useEffect(() => {
    const sync = () => {
      try { update(mergeDrafts(loadDrafts(localStore), current.current)); if (!writeFailed.current) setStorageError('') }
      catch (error) { fail(error) }
    }
    sync()
    const changed = (event: StorageEvent) => { if (event.key === DRAFT_KEY || event.key === null) sync() }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  function persist(incoming: Draft[]) {
    try { update(mergeDrafts(current.current, incoming)) } // Keep failed saves exportable.
    catch (error) { writeFailed.current = true; fail(error); return Promise.resolve(false) }
    const write = async () => {
      const commit = () => {
        try { update(upsertDrafts(localStore, current.current)); writeFailed.current = false; setStorageError(''); return true }
        catch (error) { writeFailed.current = true; fail(error); return false }
      }
      try { return navigator.locks ? await navigator.locks.request('yi-drafts', commit) : commit() }
      catch (error) { writeFailed.current = true; fail(error); return false }
    }
    queue.current = queue.current.then(write, write)
    return queue.current
  }
  return { drafts, storageError, persist }
}
