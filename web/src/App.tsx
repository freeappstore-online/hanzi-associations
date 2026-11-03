import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { initApp } from '@freeappstore/sdk'
import { Badge, BuildInfo, Card, EmptyState, Modal, PageHeader, SearchInput, Shell, Spinner, Tabs, useToast, type NavItem } from '@freeappstore/sdk/ui'
import { entryKey, normalizePinyin, toneMarks, type Entry, type Filter } from './dictionary'
import { backupSchema, fetchIndex, importDrafts, loadDrafts, mergeCards, newDraft, sameBrief, saveDrafts, type Draft, type Published } from './model'
import { beginOAuth, disconnect, finishOAuth, getSession } from './oauth'
import { createRequest, loadPending, savePending, type Pending } from './generation'
import type { Pags } from './pags'

const NAV: NavItem[] = [
  { label: 'Look up', href: '/', title: 'Look up — Yi' },
  { label: 'My associations', href: '/associations', title: 'My associations — Yi' },
  { label: 'About & connection', href: '/connection', title: 'About & connection — Yi' },
]
// Capture and remove OAuth parameters before rendering external links or starting requests.
const callback = new URL(window.location.href)
const hasCallback = callback.pathname === '/connection' && (callback.searchParams.has('code') || callback.searchParams.has('error'))
if (hasCallback) window.history.replaceState(null, '', '/connection')
let callbackResult: Promise<unknown> | undefined
const fas = initApp({ appId: 'hanzi-associations' })
// Keep private learning activity local; no background diagnostic uploads.
fas.log.destroy()

function Button({ secondary, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return <button {...props} className={`min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-line-strong bg-panel text-ink hover:bg-paper-deep' : 'bg-accent text-paper hover:bg-accent-hover'} ${className}`} />
}
function Label({ children, title, hint }: { children: ReactNode; title: string; hint?: string }) {
  return <label className="grid gap-2 text-sm font-semibold">{title}{children}{hint && <span className="text-xs font-normal leading-relaxed text-muted">{hint}</span>}</label>
}
const field = 'w-full min-w-0 rounded-xl border border-line-strong bg-paper px-3 py-3 text-base font-normal text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft'
const errorMessage = (error: unknown) => error instanceof Error && error.name !== 'ZodError' ? error.message : 'This data could not be validated. Check the fields or backup format and try again.'

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  const navigate = (href: string) => { window.history.pushState(null, '', href); setPath(href) }
  return <Shell app={fas} appName="Yi" nav={NAV} onNavigate={navigate}>
    <Workspace path={path} />
    <BuildInfo />
  </Shell>
}

function Workspace({ path }: { path: string }) {
  const toast = useToast()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [published, setPublished] = useState<Published[]>([])
  const [editor, setEditor] = useState<Draft | null>(null)
  const [storageError, setStorageError] = useState('')
  const [indexError, setIndexError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [connected, setConnected] = useState(false)
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [receiptError, setReceiptError] = useState('')
  const [checking, setChecking] = useState(false)
  const loaded = useRef(false)
  const damaged = useRef(false)
  const pags = useRef<Pags | null>(null)
  const connectPromise = useRef<Promise<Pags> | null>(null)
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  async function refresh() {
    try { setPublished(await fetchIndex()); setIndexError('') }
    catch (error) { setIndexError(errorMessage(error)) }
  }
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    try { setDrafts(loadDrafts(localStorage)) } catch (error) { damaged.current = true; setStorageError(errorMessage(error)) }
    try { setPending(loadPending(localStorage)) } catch (error) { setReceiptError(errorMessage(error)) }
    setConnected(Boolean(getSession(sessionStorage)))
    void refresh()
    if (hasCallback) {
      callbackResult ??= finishOAuth(sessionStorage, callback)
      void callbackResult.then(() => { setConnected(true); toast.show('PAGS connected. Verify the artist before publishing.', { variant: 'success' }) }).catch(error => setConnectionError(errorMessage(error)))
    }
  }, [])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key?.startsWith('yi.')) {
        try { setDrafts(loadDrafts(localStorage)); setPending(loadPending(localStorage)) }
        catch (error) { setReceiptError(errorMessage(error)) }
      }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => () => { void pags.current?.close() }, [])

  function persist(next: Draft[]) {
    setDrafts(next)
    if (damaged.current) return false
    try { saveDrafts(localStorage, next); setStorageError(''); return true }
    catch (error) { setStorageError(errorMessage(error)); return false }
  }
  function edit(draft: Draft) { setEditor(draft) }
  function change(next: Draft) {
    const draft = { ...next, updatedAt: new Date().toISOString() }
    setEditor(draft)
    persist([...drafts.filter(d => d.id !== draft.id), draft])
  }
  function select(entry: Entry) {
    const existing = drafts.find(d => entryKey(d.entry) === entryKey(entry))
    const draft = existing || newDraft(entry)
    if (!existing) persist([...drafts, draft])
    setEditor(draft)
  }
  async function client() {
    if (!getSession(sessionStorage)) { setConnected(false); throw new Error('Connect PAGS on About & connection to publish. Your draft stays on this device.') }
    if (pags.current) return pags.current
    if (!connectPromise.current) connectPromise.current = (async () => {
      const { Pags } = await import('./pags')
      const next = new Pags()
      await next.connect(sessionStorage)
      pags.current = next
      return next
    })().finally(() => { connectPromise.current = null })
    return connectPromise.current
  }
  async function checkConnection() {
    setBusy(true); setConnectionError(''); setVerified(false)
    try { await (await client()).verify(); setVerified(true); toast.show('Owned artist, Yi repository, and Codex subscription verified.', { variant: 'success' }) }
    catch (error) { setConnectionError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  async function connect() {
    setBusy(true); setConnectionError('')
    try { window.location.assign(await beginOAuth(sessionStorage, window.location.origin)) }
    catch (error) { setConnectionError(errorMessage(error)); setBusy(false) }
  }
  async function signOut() {
    await pags.current?.close(); pags.current = null
    try { disconnect(sessionStorage); setConnected(false); setVerified(false); setConnectionError('') }
    catch { setConnectionError('Browser storage could not be cleared. Close this tab to end its session.') }
  }
  async function publish(draft: Draft) {
    setBusy(true); setConnectionError('')
    try {
      if (receiptError || storageError) throw new Error('Resolve the browser storage warning before publishing. Export a backup first.')
      if (!navigator.locks) throw new Error('This browser cannot safely coordinate publishing across tabs. Use a current browser with Web Locks support.')
      await navigator.locks.request('yi-publication', { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Another Yi tab is publishing. Check its status first.')
        const request = createRequest(draft, loadPending(localStorage))
        if (!persist([...drafts.filter(d => d.id !== draft.id), draft])) throw new Error('Save or export your draft before publishing.')
        await (await client()).publish(request, localStorage, setPending)
        setEditor(null)
      })
    } catch (error) { setConnectionError(errorMessage(error)); toast.show(errorMessage(error), { variant: 'error', duration: 8000 }) }
    finally { setBusy(false) }
  }
  async function checkStatus() {
    const current = pendingRef.current
    if (!current || checking) return
    setChecking(true)
    try {
      const next = await (await client()).reconcile(current)
      savePending(localStorage, next); setPending(next); setConnectionError('')
      if (next.status === 'published') { await refresh(); toast.show('Your image is published and verified.', { variant: 'success' }) }
    } catch (error) { setConnectionError(errorMessage(error)) }
    finally { setChecking(false) }
  }
  useEffect(() => {
    if (!connected || !pending || ['published', 'failed'].includes(pending.status)) return
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void checkStatus() }, 12000)
    return () => clearInterval(timer)
  }, [connected, pending?.id, pending?.status, checking])

  function exportBackup() {
    const blob = new Blob([JSON.stringify(backupSchema.parse({ version: 1, drafts }), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `yi-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function importBackup(file?: File) {
    if (!file) return
    try {
      if (file.size > 10_000_000) throw new Error('Choose a backup smaller than 10 MB.')
      const next = importDrafts(await file.text(), drafts)
      const saved = persist(next); toast.show(saved ? 'Backup imported. The newest version of each draft was kept.' : 'Backup loaded in this tab, but storage failed. Export to keep it.', { variant: saved ? 'success' : 'error' })
    } catch (error) { toast.show(errorMessage(error), { variant: 'error' }) }
  }
  const unresolved = Boolean(pending && !['published', 'failed'].includes(pending.status))
  return <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
    {storageError && <Notice danger>{storageError} <button className="underline" onClick={exportBackup}>Export current drafts</button></Notice>}
    {receiptError && <Notice danger>{receiptError}</Notice>}
    {pending && <Card className="border border-line" padding="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={pending.status === 'published' ? 'success' : pending.status === 'failed' ? 'danger' : 'warning'}>{pending.status}</Badge><span className="font-semibold">{pending.draft.entry.simplified} · {pending.draft.cue || pending.draft.type}</span></div>
      {pending.status !== 'published' && <Button secondary disabled={checking || busy} onClick={() => void checkStatus()}>{checking ? 'Checking…' : 'Check publication'}</Button>}</div>
      <p className="mt-2 text-sm text-muted" role="status">{pending.detail}</p><p className="mt-2 break-all text-xs text-muted">Request {pending.id}</p>
    </Card>}
    {connectionError && <Notice danger>{connectionError}</Notice>}
    {path === '/' ? <Lookup onSelect={select} seed={published[0]} onEdit={edit} /> : path === '/associations' ? <Library drafts={drafts} published={published} onEdit={edit} onExport={exportBackup} onImport={importBackup} onRefresh={refresh} /> : path === '/connection' || path === '/about' ? <Connection connected={connected} verified={verified} busy={busy} onConnect={connect} onVerify={checkConnection} onDisconnect={signOut} /> : <><PageHeader title="Page not found" description="Choose a screen from Yi’s navigation to continue." /></>}
    {indexError && <Notice>{indexError} <button onClick={() => void refresh()} className="underline">Try again</button></Notice>}
    <Modal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor ? `Your association · ${editor.entry.simplified}` : 'Your association'} maxWidth={680}>
      {editor && <div className="space-y-5">
        <div className="rounded-2xl bg-paper-deep p-4"><p className="text-3xl" lang="zh">{editor.entry.simplified} <span className="text-lg text-muted">{editor.entry.traditional !== editor.entry.simplified && editor.entry.traditional}</span></p><p className="mt-2 font-semibold">{toneMarks(editor.entry.pinyin)} <span className="text-xs font-normal text-muted">dictionary pinyin</span></p><p className="mt-1 text-sm text-muted">{editor.entry.definitions.join('; ')}</p></div>
        <Label title="What makes it memorable?"><select className={field} value={editor.type} onChange={e => change({ ...editor, type: e.target.value as Draft['type'] })}><option value="sound">Sound association</option><option value="character">Character association</option><option value="meaning">Meaning association</option></select></Label>
        <Label title={editor.type === 'sound' ? 'Approximate sound-alike' : 'Memory cue (optional)'} hint="A personal memory aid. This does not replace the Chinese pronunciation."><input className={field} maxLength={200} value={editor.cue} onChange={e => change({ ...editor, cue: e.target.value })} placeholder="e.g. easy" /></Label>
        <Label title="Describe the image" hint="Be vivid: colours, shapes, a person, an action, a feeling. At least 20 characters to publish."><textarea className={`${field} min-h-32 resize-y`} maxLength={4000} rows={5} value={editor.description} onChange={e => change({ ...editor, description: e.target.value })} placeholder="A sunshine-yellow beanbag chair on wooden legs. Someone sinks into its soft cushions, completely at ease…" /></Label>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Music cue <span className="font-normal text-muted">· optional</span></legend><div className="grid gap-3 sm:grid-cols-2"><Label title="Song title"><input className={field} maxLength={200} value={editor.songTitle} onChange={e => change({ ...editor, songTitle: e.target.value })} placeholder="Easy" /></Label><Label title="Artist"><input className={field} maxLength={200} value={editor.songArtist} onChange={e => change({ ...editor, songArtist: e.target.value })} placeholder="Faith No More" /></Label></div><p className="text-xs text-muted">Title and artist only. Yi does not copy or upload recordings.</p></fieldset>
        <Notice>Publishing makes this description, word, music cue, and generated image public in Yi’s repository and app. It uses your connected artist’s Codex subscription and may take a few minutes.</Notice>
        <div className="flex flex-wrap gap-3"><Button secondary onClick={() => { const saved = persist([...drafts.filter(d => d.id !== editor.id), editor]); setEditor(null); toast.show(saved ? 'Draft saved on this device.' : 'Draft kept in this tab. Export a backup.', { variant: saved ? 'success' : 'error' }) }}>Save draft</Button><Button disabled={busy || unresolved || Boolean(receiptError) || Boolean(storageError)} onClick={() => void publish(editor)}>{busy ? 'Preparing…' : published.some(p => p.id === editor.id) ? 'Publish new image' : 'Publish image'}</Button></div>
        <p className="text-xs text-muted">{connected ? 'PAGS connected. Ownership and subscription are checked before every publication.' : 'Connect your own PAGS account in About & connection to publish.'} {drafts.some(d => d.id === editor.id) && !storageError ? 'Changes save locally as you type.' : ''}</p>
      </div>}
    </Modal>
  </div>
}

function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div role={danger ? 'alert' : undefined} className={`rounded-xl border p-4 text-sm leading-relaxed ${danger ? 'border-danger/30 bg-danger-soft text-ink' : 'border-line bg-paper-deep text-muted'}`}>{children}</div>
}

function Lookup({ onSelect, seed, onEdit }: { onSelect: (entry: Entry) => void; seed?: Published; onEdit: (draft: Draft) => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [results, setResults] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const worker = useRef<Worker | null>(null)
  const sequence = useRef(0)
  useEffect(() => () => worker.current?.terminate(), [])
  useEffect(() => {
    const id = ++sequence.current
    if (!query.trim()) { setResults([]); setTotal(0); setLoading(false); return }
    setLoading(true); setError('')
    const timer = setTimeout(() => {
      worker.current ??= new Worker(new URL('./dictionary.worker.ts', import.meta.url), { type: 'module' })
      worker.current.onmessage = ({ data }) => {
        if (data.id !== sequence.current) return
        setLoading(false); setError(data.error || ''); setResults(data.entries || []); setTotal(data.total || 0)
      }
      worker.current.onerror = () => { setLoading(false); setError('Dictionary search could not start. Reload or try a current browser.') }
      worker.current.postMessage({ id, query, filter })
    }, 180)
    return () => clearTimeout(timer)
  }, [query, filter, retry])
  return <>
    <PageHeader title="Look up" description="Find a word. Make it unforgettable." />
    <section aria-label="Dictionary search" className="space-y-4 rounded-3xl border border-line bg-panel p-5 sm:p-7">
      <div className="flex items-center gap-2"><span className="text-xs font-extrabold uppercase tracking-widest text-accent">Your next memory starts here</span><span aria-hidden="true" className="text-accent">↗</span></div>
      <SearchInput value={query} onChange={setQuery} placeholder="Hanzi, pinyin, or English · 椅子, yǐzi, chair" />
      <div className="flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[{ key: 'all', label: 'All entries' }, { key: 'words', label: 'Words' }, { key: 'characters', label: 'Characters' }]} active={filter} onChange={v => setFilter(v as Filter)} /><p className="text-xs text-muted">CC-CEDICT · 125,356 entries</p></div>
      {!query && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">Try a little inspiration</span>{['chair', '梦', 'xǐ huan', '明'].map(q => <button className="min-h-11 rounded-full border border-line px-4 font-semibold text-accent hover:bg-accent-soft" key={q} onClick={() => setQuery(q)}>{q}</button>)}</div>}
    </section>
    {loading ? <div className="flex items-center gap-3 py-6 text-sm text-muted" role="status"><Spinner size={20} />Loading or searching the dictionary…</div> : error ? <Notice danger>{error} <button className="underline" onClick={() => setRetry(v => v + 1)}>Retry</button></Notice> : query.trim() ? <section aria-label="Dictionary results" className="space-y-3">
      <p className="text-sm text-muted" role="status">{total ? `${total.toLocaleString()} matches${total > 60 ? ' · showing the 60 closest' : ''}. Choose the reading you mean.` : 'No entries found. Try another spelling, shorter word, or All entries.'}</p>
      <div className="grid gap-3 sm:grid-cols-2">{results.map(entry => <button key={entryKey(entry)} onClick={() => onSelect(entry)} className="group min-w-0 rounded-2xl border border-line bg-panel p-5 text-left hover:border-accent focus-visible:ring-2 focus-visible:ring-accent">
        <div className="flex items-start justify-between gap-2"><span lang="zh" className="break-words text-3xl leading-relaxed">{entry.simplified}</span><span className="text-lg text-accent" aria-hidden="true">＋</span></div>
        <p className="mt-1 font-semibold text-accent">{toneMarks(entry.pinyin)}</p><p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{entry.definitions.join('; ')}</p>{entry.traditional !== entry.simplified && <p lang="zh" className="mt-2 text-xs text-muted">Traditional · {entry.traditional}</p>}
      </button>)}</div>
    </section> : <>
      {seed && <section className="grid overflow-hidden rounded-3xl border border-line bg-panel md:grid-cols-2" aria-label="First association">
        <img src={seed.image} alt={seed.alt} className="aspect-square h-full w-full object-cover" width="1254" height="1254" fetchPriority="high" />
        <div className="flex flex-col justify-center gap-5 p-6 sm:p-9"><div><Badge variant="accent">A word becomes a world</Badge></div><div><p className="text-5xl leading-tight" lang="zh">椅子</p><p className="mt-3 text-xl font-semibold">yǐzi <span className="text-base font-normal text-muted">· chair</span></p></div><div className="border-l-2 border-accent pl-4"><p className="text-xs font-bold uppercase tracking-widest text-muted">Sounds a little like</p><p className="mt-1 font-serif text-4xl text-accent">“easy”</p><p className="mt-2 text-xs text-muted">An approximate memory cue, not the pronunciation.</p></div><p className="text-sm leading-relaxed text-muted">Sink into a sunshine-yellow chair. All that softness, all that ease. One vivid scene to help a new word stay with you.</p><Song draft={seed} /><div><Button secondary onClick={() => onEdit(seed)}>Make this association yours ↗</Button></div></div>
      </section>}
      <div className="grid gap-4 sm:grid-cols-3">{[['01', 'Find your word', 'Look up real dictionary entries, from a single character to a favourite phrase.'], ['02', 'Make a connection', 'Play with a sound, a shape, or a meaning. Add a song if it helps.'], ['03', 'Give it a picture', 'Save a private draft, or publish a vivid image with your connected artist.']].map(([n, title, detail]) => <div key={n} className="p-3"><p className="text-xs font-extrabold text-accent">{n}</p><h2 className="mt-2 font-semibold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p></div>)}</div>
    </>}
    <p className="text-xs leading-relaxed text-muted">Dictionary readings come from <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict" target="_blank" rel="noreferrer" className="underline">CC-CEDICT / MDBG</a>, CC BY-SA 4.0. Mnemonics are personal associations. Pinyin search ignores tone differences; compare the readings before choosing.</p>
  </>
}

function Song({ draft }: { draft: Draft }) {
  if (!draft.songArtist || !draft.songTitle) return null
  return <a className="inline-flex min-h-11 items-center gap-3 text-sm font-semibold text-accent underline decoration-line-strong underline-offset-4" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${draft.songArtist} ${draft.songTitle}`)}`} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♫</span><span>{draft.songTitle} · {draft.songArtist}<span className="block text-xs font-normal text-muted">Find a listen link ↗</span></span></a>
}

function Library({ drafts, published, onEdit, onExport, onImport, onRefresh }: { drafts: Draft[]; published: Published[]; onEdit: (draft: Draft) => void; onExport: () => void; onImport: (file?: File) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const upload = useRef<HTMLInputElement>(null)
  const cards = mergeCards(drafts, published).filter(({ draft: d, published: p }) => {
    if (scope === 'drafts' && !drafts.some(local => local.id === d.id) || scope === 'published' && !p) return false
    const q = query.toLowerCase().trim()
    return !q || [d.entry.simplified, d.entry.traditional, d.entry.definitions.join(' '), d.cue, d.description, d.songArtist, d.songTitle].some(v => v.toLowerCase().includes(q)) || normalizePinyin(d.entry.pinyin).includes(normalizePinyin(q))
  })
  return <>
    <PageHeader title="My associations" description="Small connections. Lasting memories." actions={<Button secondary onClick={() => void onRefresh()}>Refresh images</Button>} />
    <div className="flex flex-wrap items-center gap-2"><Button secondary onClick={onExport}>Export drafts</Button><Button secondary onClick={() => upload.current?.click()}>Import backup</Button><input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label="Import backup file" onChange={e => { void onImport(e.target.files?.[0]); e.target.value = '' }} /><span className="text-xs text-muted">Drafts live on this device. Export to keep a backup.</span></div>
    <SearchInput value={query} onChange={setQuery} placeholder="Search your words, memory cues, or songs" />
    <Tabs tabs={[{ key: 'all', label: 'All cards' }, { key: 'drafts', label: 'Local drafts' }, { key: 'published', label: 'Published' }]} active={scope} onChange={setScope} />
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{cards.map(({ draft, published: p }) => <article key={draft.id} className="overflow-hidden rounded-3xl border border-line bg-panel">
      {p ? <img src={p.image} alt={p.alt} loading="lazy" className="aspect-square w-full object-cover" /> : <div className="flex aspect-video items-center justify-center bg-accent-soft p-5 text-6xl text-accent" lang="zh">{draft.entry.simplified}</div>}
      <div className="space-y-3 p-5"><div className="flex flex-wrap items-center gap-2"><Badge variant={p ? 'success' : 'default'}>{p ? 'Published' : 'Local draft'}</Badge>{p && !sameBrief(draft, p) && <Badge variant="warning">Revised draft</Badge>}<span className="text-xs text-muted">{draft.type}</span></div><h2 className="text-3xl" lang="zh">{draft.entry.simplified}</h2><p className="text-sm font-semibold">{toneMarks(draft.entry.pinyin)} <span className="font-normal text-muted">· {draft.entry.definitions[0]}</span></p>{draft.cue && <p className="font-serif text-2xl text-accent">“{draft.cue}” <span className="font-sans text-xs text-muted">{draft.type === 'sound' ? 'approximate cue' : 'memory cue'}</span></p>}<p className="line-clamp-3 text-sm leading-relaxed text-muted">{draft.description || 'Your image starts with a vivid description.'}</p><Song draft={draft} /><div><Button secondary onClick={() => onEdit(draft)}>Revise association</Button></div></div>
    </article>)}</div>
    {!cards.length && <EmptyState title="Room for a new memory" message="Look up a word to start an association, or try a different search." />}
    <p className="text-xs text-muted">Published cards are shared from the public repository. Local revisions stay private until you choose Publish image.</p>
  </>
}

function Connection({ connected, verified, busy, onConnect, onVerify, onDisconnect }: { connected: boolean; verified: boolean; busy: boolean; onConnect: () => void; onVerify: () => void; onDisconnect: () => void }) {
  return <>
    <PageHeader title="About & connection" description="Your imagination, with a little help from Yi." />
    <div className="grid items-start gap-6 md:grid-cols-2"><Card padding="p-6" className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Your image artist</h2><Badge variant={connected ? 'success' : 'default'}>{verified ? 'Artist verified' : connected ? 'Connected' : 'Not connected'}</Badge></div><p className="text-sm leading-relaxed text-muted">Connect your own ProAgentStore account to publish images with the private Hanzi Association Artist. The artist must belong to you and be bound to Yi. Other accounts can use the dictionary, local drafts, and backups.</p><div className="flex flex-wrap gap-3">{connected ? <><Button disabled={busy} onClick={onVerify}>{busy ? 'Verifying…' : 'Verify artist'}</Button><Button secondary disabled={busy} onClick={onDisconnect}>Disconnect</Button></> : <Button disabled={busy} onClick={onConnect}>{busy ? 'Opening sign-in…' : 'Connect PAGS'}</Button>}</div><p className="text-xs leading-relaxed text-muted">Secure browser sign-in with PKCE. Yi requests read and runtime permissions only. Your session stays in this tab’s sessionStorage, expires automatically, and is cleared when you disconnect. Reconnect after expiry.</p><a href="https://proagentstore.online" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline">Open ProAgentStore ↗</a></Card>
    <div className="space-y-5"><Card padding="p-6" className="space-y-3"><h2 className="text-xl font-bold">A memory, not a translation</h2><p className="text-sm leading-relaxed text-muted">Yi helps you attach a vivid image to a Chinese word’s sound, characters, or meaning. “Easy” is a personal cue for 椅子; the dictionary pronunciation is yǐzi. Always learn the real reading and tones alongside your association.</p></Card><Card padding="p-6" className="space-y-3"><h2 className="text-xl font-bold">Private drafts, public pictures</h2><p className="text-sm leading-relaxed text-muted">Lookups run locally after the dictionary downloads. Drafts stay in this browser’s localStorage. Clearing browser data removes them, and different hostnames have separate storage: export before moving between Yi’s addresses.</p><p className="text-sm leading-relaxed text-muted">Publish image sends your brief to your artist and commits the result to the public app repository. Anyone can view published images and descriptions. Avoid private or sensitive details. No recordings are uploaded; music cues are titles, artists, and external search links.</p></Card></div></div>
    <Card padding="p-6" className="space-y-3"><h2 className="text-xl font-bold">Sources & credits</h2><p className="text-sm leading-relaxed text-muted">Dictionary: <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict" className="text-accent underline" target="_blank" rel="noreferrer">CC-CEDICT, published by MDBG</a>. Community-maintained, based on CEDICT by Paul Denisowski. Bundled snapshot: 2 November 2026, 125,356 entries. Data is unchanged and licensed under <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="text-accent underline" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>. Yi converts numbered pinyin to tone marks for display and normalizes text for search.</p><p className="text-sm text-muted">Seed illustration generated with native Codex image generation through ChatGPT subscription authentication. App source is MIT licensed. Built on <a href="https://freeappstore.online" className="text-accent underline">FreeAppStore</a>. <a href="https://github.com/freeappstore-online/hanzi-associations" className="text-accent underline" target="_blank" rel="noreferrer">View source ↗</a></p></Card>
  </>
}
