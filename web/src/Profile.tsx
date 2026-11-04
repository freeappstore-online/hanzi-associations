import { useRef } from 'react'
import type { FreeAppStore } from '@freeappstore/sdk'
import { useAuth } from '@freeappstore/sdk/hooks'
import { Badge, Card, PageHeader, ProfilePage, SignInButton } from '@freeappstore/sdk/ui'
import { Button } from './ui'
import { DEFAULT_SIZES, SIZE_LIMITS, useReading, type ReadingSizes } from './reading'
import { Word } from './Word'
import { statusLabel } from './publication'
import type { usePublication } from './usePublication'

type Props = {
  app: FreeAppStore
  publication: ReturnType<typeof usePublication>
  draftCount: number
  onExport: () => void
  onImport: (file?: File) => Promise<void>
}
const externalLink = 'inline-flex min-h-11 items-center text-sm font-semibold text-accent underline'

export function Profile({ app, publication: p, draftCount, onExport, onImport }: Props) {
  const { sizes, update, error: readingError } = useReading()
  const { user, loading } = useAuth(app)
  const upload = useRef<HTMLInputElement>(null)
  return <>
    <PageHeader title="Profile" description="Your accounts, connections and activity on this device." />
    <p className="text-sm text-muted">FreeAppStore and PAGS sign-ins are independent. You can browse Yi and save local drafts without either account.</p>
    <Card padding="1.5rem" className="space-y-4 min-w-0">
      <h2 className="text-xl font-bold">Reading sizes</h2>
      {readingError && <p role="alert">{readingError}</p>}
      {(Object.keys(SIZE_LIMITS) as (keyof ReadingSizes)[]).map(key => <label key={key} className="grid gap-2">
        <span>{key === 'hanzi' ? 'Hanzi' : key === 'pinyin' ? 'Pinyin' : 'Translation'} · {sizes[key]}</span>
        <input aria-label={`${key === 'hanzi' ? 'Hanzi' : key === 'pinyin' ? 'Pinyin' : 'Translation'} size`} className="min-h-11 w-full" type="range" min={SIZE_LIMITS[key][0]} max={SIZE_LIMITS[key][1]} step="1" value={sizes[key]} onChange={e => update({ ...sizes, [key]: Number(e.target.value) })} />
      </label>)}
      <Button secondary onClick={() => update({ ...DEFAULT_SIZES })}>Reset reading sizes</Button>
      <div aria-label="Reading preview"><Word entry={{ simplified: '椅子', traditional: '椅子', pinyin: 'yi3 zi5', definitions: ['chair'] }} /></div>
      <p className="text-sm text-muted">Tap Hanzi or pinyin to hear Mandarin. Offline speech needs an installed local Mandarin voice.</p>
    </Card>
    <div className="grid items-start gap-6 md:grid-cols-2">
      <Card padding="1.5rem" className="space-y-4">
        <h2 className="text-xl font-bold">FreeAppStore account</h2>
        {loading ? <p role="status">Checking FreeAppStore sign-in…</p> : user ? <>
          <div data-testid="fas-identity"><Badge variant="success">Signed in</Badge><ProfilePage app={app} /></div>
        </> : <><Badge>Signed out</Badge><div><SignInButton app={app} label="Sign in to FreeAppStore" /></div></>}
        <p className="text-sm text-muted">This is your platform account. Signing out here leaves your PAGS connection, drafts and publication receipts in place.</p>
      </Card>
      <Card padding="1.5rem" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-bold">Your image artist</h2><Badge variant={p.verified ? 'success' : 'default'}>{p.verified ? 'Artist verified' : p.connected ? p.busy ? 'Checking artist…' : 'Connected · ownership not confirmed' : 'Not connected'}</Badge></div>
        <p className="text-sm text-muted">Image publishing requires Yi’s private PAGS artist and uses its owner’s Codex subscription. It does not use your FreeAppStore sign-in.</p>
        {p.verified && <div data-testid="owner-identity" className="rounded-xl border border-line bg-paper-deep p-4 text-sm"><p className="break-words font-semibold">{p.verified.label}</p><p>Verified artist ownership</p>{p.verified.accountId && <p className="mt-1 break-all text-xs text-muted">Account: {p.verified.accountId}</p>}<p className="mt-2 text-xs text-muted">Access is checked again before every dispatch.</p></div>}
        <div className="flex flex-wrap gap-2">{p.connected ? <>
          <Button disabled={p.busy || p.checking} onClick={() => void p.checkConnection()}>{p.busy ? 'Checking artist…' : p.verified ? 'Check artist connection' : 'Retry connection check'}</Button>
          <Button secondary disabled={p.busy} onClick={() => void p.connect()}>Reconnect PAGS</Button>
          <Button secondary onClick={p.signOut}>Disconnect</Button>
        </> : <Button disabled={p.busy} onClick={() => void p.connect()}>{p.busy ? 'Opening sign-in…' : 'Connect PAGS'}</Button>}</div>
        <p className="text-xs text-muted">PAGS sign-in stays in this tab and expires automatically. Connect again after expiry. Disconnecting PAGS leaves FreeAppStore signed in and keeps your saved work. Yi requests read and runtime permissions only.</p>
        <a href="https://proagentstore.online" target="_blank" rel="noreferrer" className={externalLink}>Open PAGS for full activity ↗</a>
      </Card>
    </div>
    <Card padding="1.5rem" className="space-y-3">
      <h2 className="text-xl font-bold">GitHub publishing connection</h2>
      <p className="text-sm text-muted">The remote artist needs its own GitHub access to publish. Yi does not check that connection’s live status here.</p>
      <a href="https://proagentstore.online/console/preferences" target="_blank" rel="noreferrer" className={externalLink}>PAGS settings · GitHub Reconnect ↗</a>
      <p className="text-sm text-muted">Use GitHub Reconnect in PAGS settings for the platform connection. The artist’s remote-machine GitHub CLI login is separate; this action cannot repair that machine’s access. If publishing reports an access failure, ask the artist operator to review it. Reconnecting never resends a request.</p>
    </Card>
    {p.pending && <Card padding="1.5rem" className="space-y-3">
      <h2 className="text-xl font-bold">Latest publication</h2>
      <div className="flex flex-wrap items-center gap-2"><Badge variant={p.pending.status === 'failed' ? 'danger' : p.pending.status === 'published' ? 'success' : 'warning'}>{statusLabel[p.pending.status]}</Badge><span lang="zh">{p.pending.draft.entry.simplified}</span></div>
      <p role="status" className="text-sm text-muted">{p.pending.detail}</p>
      {p.statusError && <p role="status" className="text-sm text-muted">{p.statusError}</p>}
      {p.pending.status !== 'published' && <Button secondary disabled={p.busy || p.checking} onClick={() => void p.checkStatus()}>{p.checking ? 'Checking…' : 'Check publication'}</Button>}
      <p className="break-all text-xs text-muted">Request {p.pending.id}</p>
    </Card>}
    <Card padding="1.5rem" className="space-y-3">
      <h2 className="text-xl font-bold">Recent activity on this device</h2>
      <p className="text-sm text-muted">Up to 50 receipts from this browser and hostname, shared by accounts using this device. This is not account-wide history. Private terminal logs are not shown.</p>
      {p.receipts.length ? <ol className="space-y-3">{p.receipts.map(r => <li key={r.id} className="rounded-xl border border-line p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><span lang="zh">{r.word}</span><Badge>{statusLabel[r.status]}</Badge></div><p className="mt-2 text-xs text-muted">Requested <time dateTime={r.createdAt}>{new Date(r.createdAt).toLocaleString()}</time> · Updated <time dateTime={r.updatedAt}>{new Date(r.updatedAt).toLocaleString()}</time></p><p className="mt-1 break-all text-xs text-muted">{r.id}</p></li>)}</ol> : <p className="text-sm text-muted">No publication receipts on this device yet.</p>}
    </Card>
    <Card padding="1.5rem" className="space-y-3">
      <h2 className="text-xl font-bold">Your local drafts</h2>
      <p className="text-sm text-muted">{draftCount} saved on this device. Export a backup before clearing browser data or moving to another hostname. Backups contain drafts only, never sign-in credentials or private logs.</p>
      <div className="flex flex-wrap gap-2"><Button secondary onClick={onExport}>Export drafts</Button><Button secondary onClick={() => upload.current?.click()}>Import backup</Button></div>
      <input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label="Import backup file" onChange={e => { void onImport(e.target.files?.[0]); e.target.value = '' }} />
    </Card>
  </>
}
