import { useEffect, useRef, useState } from 'react'
import type { Entry } from './dictionary'
import { entryKey, toneMarks } from './dictionary'
import { syllables } from './tones'
import { speakWord, stopSpeech } from './speech'
import { useReading } from './reading'
export function Word({ entry }: { entry: Entry }) {
  const { sizes } = useReading()
  const owner = useRef({})
  const [message, setMessage] = useState('')
  const identity = entryKey(entry)
  useEffect(() => { setMessage(''); return () => stopSpeech(owner.current) }, [identity])
  const play = () => speakWord(entry.simplified, owner.current, setMessage)
  // Dynamic rem sizes preserve the SDK global text-size preference.
  return <div role="group" aria-label="Dictionary pronunciation and meaning" className="word min-w-0 space-y-2 wrap-anywhere">
    <button type="button" className="word-hanzi block min-h-11 min-w-11 max-w-full rounded-sm text-left leading-snug select-text wrap-anywhere" style={{ fontSize: `${sizes.hanzi / 16}rem` }} lang="zh-Hans" title="Play Mandarin pronunciation" aria-label={`Pronounce ${entry.simplified}`} onClick={play}>{entry.simplified}</button>
    {entry.traditional !== entry.simplified && <button type="button" onClick={play} title="Play Mandarin pronunciation" aria-label={`Pronounce ${entry.traditional}`} lang="zh-Hant" className="word-traditional block min-h-11 min-w-11 max-w-full rounded-sm text-left leading-snug text-muted select-text wrap-anywhere" style={{ fontSize: `${sizes.hanzi / 16}rem` }}>{entry.traditional}</button>}
    <button type="button" className="word-pinyin flex min-h-11 min-w-11 max-w-full flex-wrap gap-x-3 gap-y-1 rounded-sm text-left leading-snug text-accent select-text" style={{ fontSize: `${sizes.pinyin / 16}rem` }} title="Play Mandarin pronunciation" aria-label={`Pronounce ${toneMarks(entry.pinyin)}`} onClick={play}>
      {syllables(entry.pinyin).map((s, i) => <span className="inline-flex max-w-full flex-wrap items-center gap-1" key={i}><span className="min-w-0 wrap-anywhere">{s.text}</span><svg className="h-10 w-10 shrink-0" role="img" aria-label={`Tone ${s.number}: ${s.label}`} width="40" height="40" viewBox="0 0 40 40" fill="none"><path d="M5 8H35 M5 20H35 M5 32H35" stroke="currentColor" opacity="0.18" />{s.path ? <path d={s.path} stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /> : <circle cx="20" cy="20" r="3.5" fill="currentColor" />}</svg></span>)}
    </button>
    <p className="word-translation min-w-0 wrap-anywhere leading-relaxed text-muted" style={{ fontSize: `${sizes.translation / 16}rem` }}>{entry.definitions.join('; ')}</p>
    {message && <p role="alert" className="text-sm">{message}</p>}
  </div>
}
