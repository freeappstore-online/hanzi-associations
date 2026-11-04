import { useDrafts } from './drafts'
import { sessionStore } from './storage'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { initApp } from '@freeappstore/sdk'
import { Badge, BuildInfo, EmptyState, Modal, PageHeader, SearchInput, Shell, Spinner, Tabs, useToast, type NavItem } from '@freeappstore/sdk/ui'
import { entryKey, normalizePinyin, toneMarks, type Entry, type Filter } from './dictionary'
import { backupSchema, fetchIndex, importDrafts, draftSchema, newDraft, type Draft, type Published } from './model'
import { finishOAuth } from './oauth'
import { usePublication } from './usePublication'
import { activeRequest, draftProgress } from './publication'
import { Button, Notice } from './ui'
import { Profile } from './Profile'
import { About } from './About'
import { Word } from './Word'
import { ReadingProvider } from './reading'
import { stopSpeech } from './speech'

const NAV: NavItem[] = [
  { label: 'Association library', href: '/', title: 'Association library — Yi' },
  { label: 'Look up', href: '/lookup', title: 'Look up — Yi' },
  { label: 'Profile', href: '/profile', title: 'Profile — Yi' },
  { label: 'About', href: '/about', title: 'About — Yi' },
]
// Capture and remove OAuth parameters before rendering external links or starting requests.
const callback = new URL(window.location.href)
const hasCallback = callback.pathname === '/connection' && (callback.searchParams.has('code') || callback.searchParams.has('error'))
if (hasCallback) window.history.replaceState(null, '', '/connection')
let callbackResult: Promise<unknown> | undefined
const fas = initApp({ appId: 'hanzi-associations' })
// Keep private learning activity local; no background diagnostic uploads.
fas.log.destroy()

function Label({ children, title, hint }: { children: ReactNode; title: string; hint?: string }) {
  return <label className="grid gap-2 text-sm font-semibold"><span className="sr-only sm:not-sr-only">{title}</span>{children}{hint && <span className="hidden sm:block text-xs font-normal leading-relaxed text-muted">{hint}</span>}</label>
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
  return <ReadingProvider><Shell profileHref="/profile" app={fas} appName="Yi" nav={NAV} onNavigate={navigate}>
    <Workspace path={path} />
    <BuildInfo />
  </Shell></ReadingProvider>
}

function Workspace({ path }: { path: string }) {
  useEffect(() => { stopSpeech(); return () => stopSpeech() }, [path])
  const toast = useToast()
  const { drafts, storageError, persist } = useDrafts()
  const [published, setPublished] = useState<Published[]>([])
  const [editor, setEditor] = useState<Draft | null>(null)
  const [indexError, setIndexError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [draftWorkflow, setDraftWorkflow] = useState(false)
  const loaded = useRef(false)
  const publication = usePublication(Boolean(editor) || draftWorkflow || ['/connection', '/profile'].includes(path), published, [...drafts.map(d => d.id), ...(editor ? [editor.id] : [])], setPublished)
  const { connected, verified, receipts, busy, pending, receiptError, checking, checkConnection, checkStatus, connect } = publication

  async function refresh() {
    try { setPublished(await fetchIndex()); setIndexError('') }
    catch (error) { setIndexError(errorMessage(error)) }
  }
  useEffect(() => {
    if (loaded.current) return
    loaded.current = true
    void refresh()
    if (hasCallback) {
      callbackResult ??= finishOAuth(sessionStore, callback)
      void callbackResult.then(() => { toast.show('PAGS connected. Checking artist ownership automatically.', { variant: 'success' }) }).catch(error => setConnectionError(errorMessage(error)))
    }
  }, [])
  function copyCard(card: Draft) {
    const draft = draftSchema.parse({ ...card, id: crypto.randomUUID(), updatedAt: new Date().toISOString() })
    void persist([draft]); setEditor(draft)
  }

  function edit(draft: Draft) { setEditor(draft) }
  function change(next: Draft) {
    const draft = { ...next, updatedAt: new Date(Math.max(Date.now(), Date.parse(next.updatedAt) + 1)).toISOString() }
    setEditor(draft)
    void persist([draft])
  }
  function select(entry: Entry) {
    const existing = drafts.find(d => entryKey(d.entry) === entryKey(entry))
    const draft = existing || newDraft(entry)
    if (!existing) void persist([draft])
    setEditor(draft)
  }
  async function publish(draft: Draft) {
    if (!await persist([draft])) return
    await publication.publish(draft)
  }
  function draftStatus(draft: Draft) {
    const progress = draftProgress(draft, pending, receipts, publication.verifiedImages, publication.imageFailures.includes(draft.id))
    const blocked = activeRequest(pending) || receipts.some(r => !['published', 'failed'].includes(r.status))
    return <div className="space-y-3" data-testid="draft-progress">
      <div role="status" className="space-y-1"><Badge variant={progress.label === 'Published' ? 'success' : progress.label === 'Failed' ? 'danger' : 'default'}>{progress.label}</Badge><p className="text-sm text-muted">{progress.detail}</p>
        {progress.editedWhilePending && <p className="text-sm text-muted">Your latest edits are saved locally. The pending request uses the earlier saved description.</p>}
        {progress.active && publication.statusError && <p className="text-sm text-muted">{publication.statusError}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {progress.image && <a className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 py-2 text-sm font-bold text-accent" href={progress.image.image} target="_blank" rel="noreferrer">{progress.changed || progress.active || progress.knownPublished ? 'View last published image' : 'View image'}</a>}
        {progress.knownPublished ? <Button icon="refresh" secondary onClick={() => void publication.checkImages()}>Check published image</Button> : progress.active ? <><Button icon="pending" disabled>{progress.label}</Button><Button icon="refresh" secondary disabled={checking || busy} onClick={() => void checkStatus()}>{checking ? 'Checking status…' : 'Check status'}</Button>{!connected && <Button icon="connect" secondary onClick={() => void connect()}>Reconnect PAGS</Button>}</> : progress.label !== 'Published' && <>
          {verified ? <Button icon="publish" disabled={busy || checking || blocked || Boolean(receiptError || storageError) || draft.description.trim().length < 20 || draft.type === 'sound' && !draft.cue.trim() || Boolean(draft.songArtist.trim()) !== Boolean(draft.songTitle.trim())} onClick={() => void publish(draft)}>{busy ? 'Preparing…' : 'Generate & publish image'}</Button> : connected ? <Button icon="refresh" disabled={busy || checking} onClick={() => void checkConnection()}>{busy || checking ? 'Checking artist…' : 'Check artist connection'}</Button> : <Button icon="connect" onClick={() => void connect()}>Connect PAGS to publish</Button>}
          {blocked && <p className="text-xs text-muted">Another request is pending. Check its status before generating again.</p>}
        </>}
        {progress.label === 'Failed' && <a className="inline-flex min-h-11 items-center text-sm text-accent underline" href="https://proagentstore.online" target="_blank" rel="noreferrer">Review failure in PAGS ↗</a>}
      </div>
    </div>
  }

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
      const next = importDrafts(await file.text(), [])
      const saved = await persist(next); toast.show(saved ? 'Backup imported. The newest version of each draft was kept.' : 'Backup could not be saved. Review the warning and export current drafts.', { variant: saved ? 'success' : 'error' })
    } catch (error) { toast.show(errorMessage(error), { variant: 'error' }) }
  }
  return <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
    {storageError && <Notice danger>{storageError} <button className="underline" onClick={exportBackup}>Export current drafts</button></Notice>}
    {receiptError && <Notice danger>{receiptError}</Notice>}
    {(connectionError || publication.error) && <Notice danger>{connectionError || publication.error}</Notice>}
    {path === '/lookup' ? <Lookup onSelect={select} seed={published[0]} onEdit={copyCard} /> : path === '/' || path === '/associations' ? <Library drafts={drafts} published={published} onEdit={edit} onCopy={copyCard} onExport={exportBackup} onImport={importBackup} onRefresh={refresh} onScope={setDraftWorkflow} renderStatus={draftStatus} /> : path === '/connection' || path === '/profile' ? <Profile app={fas} publication={publication} draftCount={drafts.length} onExport={exportBackup} onImport={importBackup} /> : path === '/about' ? <About /> : <><PageHeader title="Page not found" description="Choose a screen from Yi’s navigation to continue." /></>}
    {indexError && <Notice>{indexError} <button onClick={() => void refresh()} className="underline">Try again</button></Notice>}
    <Modal open={Boolean(editor)} onClose={() => setEditor(null)} title={editor ? `Your association · ${editor.entry.simplified}` : 'Your association'} maxWidth={680}>
      {editor && <div className="space-y-5">
        {(publication.error || receiptError || storageError) && <Notice danger>{publication.error || receiptError || storageError}</Notice>}
        <div className="rounded-2xl bg-paper-deep p-4"><Word entry={editor.entry} /></div>
        <Label title="What makes it memorable?"><select className={field} value={editor.type} onChange={e => change({ ...editor, type: e.target.value as Draft['type'] })}><option value="sound">Sound association</option><option value="character">Character association</option><option value="meaning">Meaning association</option></select></Label>
        <Label title={editor.type === 'sound' ? 'Approximate sound-alike' : 'Memory cue (optional)'} hint="A personal memory aid. This does not replace the Chinese pronunciation."><input className={field} maxLength={200} value={editor.cue} onChange={e => change({ ...editor, cue: e.target.value })} placeholder="Memory sound-alike · e.g. easy" /></Label>
        <Label title="Describe the image" hint="Be vivid: colours, shapes, a person, an action, a feeling. At least 20 characters to publish."><textarea className={`${field} min-h-32 resize-y`} maxLength={4000} rows={5} value={editor.description} onChange={e => change({ ...editor, description: e.target.value })} placeholder="A sunshine-yellow beanbag chair on wooden legs. Someone sinks into its soft cushions, completely at ease…" /></Label>
        <fieldset className="space-y-3"><legend className="mb-2 text-sm font-semibold">Music cue <span className="font-normal text-muted">· optional</span></legend><div className="grid gap-3 sm:grid-cols-2"><Label title="Song title"><input className={field} maxLength={200} value={editor.songTitle} onChange={e => change({ ...editor, songTitle: e.target.value })} placeholder="Song title · e.g. Easy" /></Label><Label title="Artist"><input className={field} maxLength={200} value={editor.songArtist} onChange={e => change({ ...editor, songArtist: e.target.value })} placeholder="Artist · e.g. Faith No More" /></Label></div><p className="text-xs text-muted">Title and artist only. Yi does not copy or upload recordings.</p></fieldset>
        {<Notice>Publishing makes this description, word, music cue, and generated image public in Yi’s repository and app. It consumes the connected owner’s Codex subscription and may take a few minutes.</Notice>}
        {draftStatus(editor)}
        <div className="flex flex-wrap gap-3"><Button icon="save" secondary onClick={async () => { const saved = await persist([editor]); setEditor(null); toast.show(saved ? 'Draft saved on this device.' : 'Draft kept in this tab. Export a backup.', { variant: saved ? 'success' : 'error' }) }}>Save draft</Button></div>
        <p className="text-xs text-muted">{verified ? `Artist verified · ${verified.label}. Access and runner readiness are checked again before sending.` : 'Publishing requires the owner of Yi’s private artist. Existing PAGS sessions are checked automatically.'} Changes save locally as you type.</p>
      </div>}
    </Modal>
  </div>
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
      const failed = () => { worker.current?.terminate(); worker.current = null; if (id !== sequence.current) return; setLoading(false); setError('Dictionary search could not start. Retry to restart it.') }
      try {
        worker.current ??= new Worker(new URL('./dictionary.worker.ts', import.meta.url), { type: 'module' })
        worker.current.onmessage = ({ data }) => {
          if (data.id !== sequence.current) return
          setLoading(false); setError(data.error || ''); setResults(data.entries || []); setTotal(data.total || 0)
        }
        worker.current.onerror = failed
        worker.current.postMessage({ id, query, filter })
      } catch { failed() }
    }, 180)
    return () => clearTimeout(timer)
  }, [query, filter, retry])
  return <>
    <PageHeader title="Look up" description={<span className="hidden sm:inline">Find a word. Make it unforgettable.</span>} />
    <section aria-label="Dictionary search" className="space-y-4 rounded-3xl border border-line bg-panel p-5 sm:p-7">
      <div className="hidden sm:flex items-center gap-2"><span className="text-xs font-extrabold uppercase tracking-widest text-accent">Your next memory starts here</span><span aria-hidden="true" className="text-accent">↗</span></div>
      <SearchInput value={query} onChange={setQuery} placeholder="Hanzi, pinyin, or English · 椅子, yǐzi, chair" />
      <div className="flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[{ key: 'all', label: 'All entries' }, { key: 'words', label: 'Words' }, { key: 'characters', label: 'Characters' }]} active={filter} onChange={v => setFilter(v as Filter)} /><p className="hidden sm:block text-xs text-muted">CC-CEDICT · 125,356 entries</p></div>
      {!query && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="hidden sm:block text-muted">Try a little inspiration</span>{['chair', '梦', 'xǐ huan', '明'].map(q => <button className="min-h-11 rounded-full border border-line px-4 font-semibold text-accent hover:bg-accent-soft" key={q} onClick={() => setQuery(q)}>{q}</button>)}</div>}
    </section>
    {loading ? <div className="flex items-center gap-3 py-6 text-sm text-muted" role="status"><Spinner size={20} />Loading or searching the dictionary…</div> : error ? <Notice danger>{error} <button className="underline" onClick={() => { worker.current?.terminate(); worker.current = null; setRetry(v => v + 1) }}>Retry</button></Notice> : query.trim() ? <section aria-label="Dictionary results" className="space-y-3">
      <p className="text-sm text-muted" role="status">{total ? `${total.toLocaleString()} matches${total > 60 ? ' · showing the 60 closest' : ''}. Choose the reading you mean.` : 'No entries found. Try another spelling, shorter word, or All entries.'}</p>
      <div className="grid gap-3 sm:grid-cols-2">{results.map(entry => <article key={entryKey(entry)} className="min-w-0 rounded-2xl border border-line bg-panel p-5">
        <Word entry={entry} /><div className="mt-3"><Button icon="create" secondary aria-label={`Create association ${entry.simplified} ${toneMarks(entry.pinyin)}`} onClick={() => onSelect(entry)}>Create association</Button></div>
      </article>)}</div>
    </section> : <>
      {seed && <section className="grid overflow-hidden rounded-3xl border border-line bg-panel md:grid-cols-2" aria-label="First association">
        <img src={seed.image} alt={seed.alt} className="aspect-square h-full w-full object-cover" width="1254" height="1254" fetchPriority="high" />
        <div className="flex flex-col justify-center gap-5 p-6 sm:p-9"><div className="hidden sm:block"><Badge variant="accent">A word becomes a world</Badge></div><Word entry={seed.entry} /><div className="border-l-2 border-accent pl-4"><p className="hidden text-xs font-bold uppercase tracking-widest text-muted sm:block">Sounds a little like</p><p className="mt-1 font-serif text-4xl text-accent"><span className="sr-only sm:hidden">Approximate mnemonic sound-alike: </span>“easy”</p><p className="hidden text-xs text-muted sm:mt-2 sm:block">An approximate memory cue, not the pronunciation.</p></div><p className="hidden text-sm leading-relaxed text-muted sm:block">Sink into a sunshine-yellow chair. All that softness, all that ease. One vivid scene to help a new word stay with you.</p><Song draft={seed} /><div><Button icon="copy" secondary onClick={() => onEdit(seed)}>Make this association yours ↗</Button></div></div>
      </section>}
      <div className="hidden sm:grid gap-4 sm:grid-cols-3">{[['01', 'Find your word', 'Look up real dictionary entries, from a single character to a favourite phrase.'], ['02', 'Make a connection', 'Play with a sound, a shape, or a meaning. Add a song if it helps.'], ['03', 'Give it a picture', 'Save a private draft or browse pictures shared in the public library.']].map(([n, title, detail]) => <div key={n} className="p-3"><p className="text-xs font-extrabold text-accent">{n}</p><h2 className="mt-2 font-semibold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-muted">{detail}</p></div>)}</div>
    </>}
    <p className="hidden sm:block text-xs leading-relaxed text-muted">Dictionary readings come from <a href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict" target="_blank" rel="noreferrer" className="underline">CC-CEDICT / MDBG</a>, CC BY-SA 4.0. Mnemonics are personal associations. Pinyin search ignores tone differences; compare the readings before choosing.</p>
  </>
}

function Song({ draft }: { draft: Draft }) {
  if (!draft.songArtist || !draft.songTitle) return null
  return <a className="inline-flex min-h-11 items-center gap-3 text-sm font-semibold text-accent underline decoration-line-strong underline-offset-4" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${draft.songArtist} ${draft.songTitle}`)}`} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">♫</span><span>{draft.songTitle} · {draft.songArtist}<span className="hidden sm:block text-xs font-normal text-muted">Find a listen link ↗</span></span></a>
}

function Library({ drafts, published, onEdit, onCopy, onExport, onImport, onRefresh, onScope, renderStatus }: { drafts: Draft[]; published: Published[]; onEdit: (draft: Draft) => void; onCopy: (draft: Draft) => void; onExport: () => void; onImport: (file?: File) => Promise<void>; onRefresh: () => Promise<void>; onScope: (drafts: boolean) => void; renderStatus: (draft: Draft) => ReactNode }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('published')
  const upload = useRef<HTMLInputElement>(null)
  // Public data never merges with local revisions, even when IDs match.
  const cards: Draft[] = (scope === 'drafts' ? drafts : published).filter(d => {
    const q = query.toLowerCase().trim()
    return !q || [d.entry.simplified, d.entry.traditional, d.entry.definitions.join(' '), d.cue, d.description, d.songArtist, d.songTitle].some(v => v.toLowerCase().includes(q)) || (Boolean(normalizePinyin(q)) && normalizePinyin(d.entry.pinyin).includes(normalizePinyin(q)))
  })
  return <>
    <PageHeader title="Association library" description={<span className="hidden sm:inline">Shared pictures for learning Chinese. Free to browse, no sign-in needed.</span>} actions={<Button icon="refresh" secondary onClick={() => void onRefresh()}>Refresh images</Button>} />
    {scope === 'drafts' && <div className="flex flex-wrap items-center gap-2"><Button icon="export" secondary onClick={onExport}>Export drafts</Button><Button icon="import" secondary onClick={() => upload.current?.click()}>Import backup</Button><input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label="Import backup file" onChange={e => { void onImport(e.target.files?.[0]); e.target.value = '' }} /><span className="text-xs text-muted">Drafts live on this device. Export to keep a backup.</span></div>}
    <SearchInput value={query} onChange={setQuery} placeholder="Search words, memory cues, or songs" />
    <Tabs tabs={[{ key: 'published', label: 'Public library' }, { key: 'drafts', label: 'Local drafts' }]} active={scope} onChange={value => { setScope(value); onScope(value === 'drafts') }} />
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{cards.map(draft => { const p = scope === 'published' ? draft as Published : undefined; return <article key={draft.id} className="overflow-hidden rounded-3xl border border-line bg-panel">
      {p && <img src={p.image} alt={p.alt} loading="lazy" className="aspect-square w-full object-cover" />}
      <div className="space-y-3 p-5"><div className="hidden flex-wrap items-center gap-2 sm:flex"><Badge variant={p ? 'success' : 'default'}>{p ? 'Public card' : 'Local draft'}</Badge><span className="text-xs text-muted">{draft.type}</span></div><Word entry={draft.entry} />{draft.cue && <p className="font-serif text-2xl text-accent"><span className="sr-only sm:hidden">{draft.type === 'sound' ? 'Approximate mnemonic sound-alike: ' : 'Memory cue: '}</span>“{draft.cue}” <span className="hidden sm:block font-sans text-xs text-muted">{draft.type === 'sound' ? 'approximate cue' : 'memory cue'}</span></p>}<p className="line-clamp-3 text-sm leading-relaxed text-muted">{draft.description || 'Your image starts with a vivid description.'}</p><Song draft={draft} />{!p && renderStatus(draft)}<div><Button icon={p ? 'copy' : 'edit'} secondary onClick={() => p ? onCopy(draft) : onEdit(draft)}>{p ? 'Copy to local drafts' : 'Revise association'}</Button></div></div>
    </article>})}</div>
    {!cards.length && <EmptyState title="Room for a new memory" message="Look up a word to start an association, or try a different search." />}
    <p className="hidden sm:block text-xs text-muted">Public cards come from the shared repository. Copies and edits stay in Local drafts on this device. Only the verified artist owner can publish images.</p>
  </>
}
