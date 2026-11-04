import { localStore, sessionStore } from './storage'
import { useEffect, useRef, useState } from 'react'
import { beginOAuth, disconnect, getSession } from './oauth'
import { createRequest, loadPending, loadReceipts, migrateReceipts, savePending, type Pending, type Receipt } from './generation'
import { fetchIndex, verifyImage, type Draft, type Published } from './model'
import { activeRequest, deployedResult } from './publication'
import type { OwnerVerification, Pags } from './pags'

export const POLL_MS = 12000
const message = (error: unknown) => error instanceof Error && error.name !== 'ZodError' ? error.message : 'The response could not be validated. Publishing is blocked; check again later.'

// One coordinator per mounted workspace. No trusted ownership flag is stored.
export function usePublication(ownerWork: boolean, published: Published[], draftIds: string[], onPublished: (cards: Published[]) => void) {
  const [connected, setConnected] = useState(Boolean(getSession(sessionStore)))
  const [verified, setVerified] = useState<OwnerVerification | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptError, setReceiptError] = useState('')
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [verifiedImages, setVerifiedImages] = useState<Published[]>([])
  const [imageFailures, setImageFailures] = useState<string[]>([])
  const [imageRetry, setImageRetry] = useState(0)
  const imageCache = useRef(new Map<string, Promise<boolean>>())
  const relevantIds = JSON.stringify([...new Set([...draftIds, ...(pending ? [pending.draft.id] : [])])].sort())
  const clientRef = useRef<Pags | null>(null)
  const epoch = useRef(0)
  const operation = useRef(false)
  const snapshot = useRef(JSON.stringify(getSession(sessionStore)))
  const state = useRef({ ownerWork, pending, published })
  state.current = { ownerWork, pending, published }

  function readStorage() {
    try { setPending(loadPending(localStore)); setReceipts(loadReceipts(localStore, state.current.published)); setReceiptError('') }
    catch (error) { setReceiptError(message(error)) }
  }
  function revoke() {
    epoch.current++
    const old = clientRef.current; clientRef.current = null
    setVerified(null); setError(''); setBusy(false); setChecking(false)
    void old?.close()
  }
  function syncSession() {
    const session = getSession(sessionStore), next = JSON.stringify(session)
    if (next !== snapshot.current || clientRef.current && !clientRef.current.isCurrent()) {
      snapshot.current = next; revoke()
    }
    setConnected(Boolean(session))
    setVerified(clientRef.current?.verification ?? null)
  }
  async function client(started: number) {
    if (!getSession(sessionStore)) throw new Error('Connection needed for private status. Your saved request will not be resent.')
    if (clientRef.current?.isCurrent()) return clientRef.current
    const { Pags } = await import('./pags')
    if (started !== epoch.current) throw new Error('Connection changed.')
    const next = new Pags(() => { if (clientRef.current === next) setVerified(null) })
    clientRef.current = next
    try { await next.connect(sessionStore) }
    catch (error) { if (clientRef.current === next) clientRef.current = null; throw error }
    if (started !== epoch.current || !next.isCurrent()) { await next.close(); throw new Error('Connection changed.') }
    return next
  }
  async function run(work: (started: number) => Promise<void>, checkingStatus = false) {
    if (operation.current) return
    operation.current = true
    const started = epoch.current
    checkingStatus ? setChecking(true) : setBusy(true)
    try { await work(started) }
    catch (error) { if (started === epoch.current) (checkingStatus ? setStatusError : setError)(message(error)) }
    finally {
      operation.current = false
      if (started === epoch.current) { setVerified(clientRef.current?.verification ?? null); setBusy(false); setChecking(false) }
    }
  }
  async function checkConnection() {
    await run(async started => {
      const current = await client(started)
      await current.verify()
      if (started === epoch.current) setError('')
    })
  }
  async function checkStatus() {
    await run(async started => {
      const request = loadPending(localStore)
      if (!request) throw new Error('Request details are unavailable on this device. Review activity in PAGS; do not resend.')
      // Public reconciliation always precedes private reads, even with expired auth.
      const cards = await fetchIndex()
      let next = await deployedResult(request, cards)
      if (started !== epoch.current) return
      if (!next) next = await (await client(started)).reconcile(request, cards)
      if (started !== epoch.current || loadPending(localStore)?.id !== request.id) return
      savePending(localStore, next); setPending(next); setReceipts(loadReceipts(localStore, cards)); setStatusError(''); setError('')
      if (next.status === 'published') {
        onPublished(cards)
        const image = cards.find(p => p.requestId === next.id && p.id === next.draft.id)!
        imageCache.current.set(`${image.image}:${image.imageSha256}`, Promise.resolve(true))
        setVerifiedImages(previous => [...previous.filter(p => p.id !== image.id), image])
      }
    }, true)
  }
  async function publish(draft: Draft) {
    await run(async started => {
      if (receiptError) throw new Error('Resolve the receipt storage warning before publishing.')
      if (!navigator.locks) throw new Error('Use a browser with Web Locks to coordinate publishing safely.')
      await navigator.locks.request('yi-publication', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another Yi tab is publishing. Check status first.')
        const request = createRequest(draft, loadPending(localStore))
        const current = await client(started)
        if (started !== epoch.current) return
        await current.publish(request, localStore, next => { if (started === epoch.current) { setPending(next); setReceipts(loadReceipts(localStore, state.current.published)) } })
        if (started === epoch.current) { setError(''); setStatusError('') }
      })
    })
  }
  async function connect() {
    revoke()
    const started = epoch.current
    setBusy(true)
    try { const url = await beginOAuth(sessionStore, window.location.origin); if (started === epoch.current) window.location.assign(url) }
    catch (error) { if (started === epoch.current) { setError(message(error)); setBusy(false) } }
  }
  function signOut() {
    revoke(); setConnected(false)
    try { disconnect(sessionStore); snapshot.current = JSON.stringify(null) }
    catch { setError('Browser storage could not be cleared. Close this tab to end its session.') }
  }

  const tick = useRef(() => {})
  tick.current = () => {
    syncSession()
    if (document.visibilityState !== 'visible' || operation.current) return
    if (activeRequest(state.current.pending)) void checkStatus()
    else if (state.current.ownerWork && getSession(sessionStore) && !clientRef.current?.verification) void checkConnection()
  }
  useEffect(() => {
    readStorage()
    const localTimer = window.setInterval(syncSession, 1000)
    const pollTimer = window.setInterval(() => tick.current(), POLL_MS)
    const wake = () => tick.current()
    const storage = () => { readStorage(); tick.current() }
    window.addEventListener('storage', storage); window.addEventListener('focus', wake); window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(localTimer); clearInterval(pollTimer)
      window.removeEventListener('storage', storage); window.removeEventListener('focus', wake); window.removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake)
      epoch.current++; void clientRef.current?.close(); clientRef.current = null
    }
  }, [])
  // Changing status or checking state never resets the polling clock.
  useEffect(() => { tick.current() }, [ownerWork, connected, pending?.id])
  useEffect(() => {
    let cancelled = false
    try { setReceipts(migrateReceipts(localStore, published)) } catch (error) { setReceiptError(message(error)) }
    // Only local draft/request IDs are relevant. Cache successful immutable SHA checks,
    // including in-flight work; a rejected check remains retryable.
    if (ownerWork || activeRequest(pending)) {
      const ids: string[] = JSON.parse(relevantIds)
      const cards = published.filter(p => ids.includes(p.id))
      setImageFailures([])
      void Promise.all(cards.map(async p => {
        const key = `${p.image}:${p.imageSha256}`
        let check = imageCache.current.get(key)
        if (!check) {
          check = verifyImage(p).then(() => true, () => { imageCache.current.delete(key); return false })
          imageCache.current.set(key, check)
        }
        return { card: p, valid: await check }
      })).then(results => {
        if (cancelled) return
        setVerifiedImages(results.filter(r => r.valid).map(r => r.card))
        setImageFailures([...results.filter(r => !r.valid).map(r => r.card.id), ...ids.filter(id => !cards.some(p => p.id === id))])
      })
    }
    return () => { cancelled = true }
  }, [published, ownerWork, relevantIds, imageRetry])
  async function checkImages() {
    try { onPublished(await fetchIndex()); setImageRetry(n => n + 1) }
    catch { setImageFailures(JSON.parse(relevantIds)) }
  }
  return { imageFailures, checkImages, connected, verified, pending, receipts, receiptError, error, statusError, busy, checking, verifiedImages, checkConnection, checkStatus, publish, connect, signOut }
}
