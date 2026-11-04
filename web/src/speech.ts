export function mandarinVoices(voices: SpeechSynthesisVoice[]) {
  return voices.filter(v => /^(cmn|zh)(-|_|$)/i.test(v.lang) && !/(?:-|_)(HK|MO|yue)(?:-|_|$)/i.test(v.lang) && !/cantonese|yue|廣東|广东|粵語|粤语/i.test(v.name))
    .sort((a, b) => Number(b.localService) - Number(a.localService) || Number(/^zh[-_]CN$/i.test(b.lang)) - Number(/^zh[-_]CN$/i.test(a.lang)))
}
let active: { owner: object; stop: () => void } | null = null
export function stopSpeech(owner?: object) {
  if (active && (!owner || active.owner === owner)) { const old = active; active = null; old.stop() }
}
// Error-only callback: normal loading/playback states have no visible label.
export function speakWord(text: string, owner: object, reportError: (error: string) => void) {
  stopSpeech()
  reportError('')
  let synth: SpeechSynthesis
  try {
    if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) throw new Error()
    synth = speechSynthesis
  } catch { reportError('Speech is unavailable in this browser. Try a browser with Mandarin speech support.'); return }
  let done = false
  let utterance: SpeechSynthesisUtterance | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { try { synth.cancel() } catch { /* Browser teardown can throw. */ } }
  const clear = () => {
    clearTimeout(timer)
    try { synth.removeEventListener('voiceschanged', start) } catch { /* Contain browser API failures. */ }
    if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null }
  }
  const finish = (error = '') => { if (done) return; done = true; clear(); if (active === session) active = null; reportError(error) }
  const session = { owner, stop: () => { finish(); cancel() } }
  active = session
  const failed = () => { finish('Pronunciation could not play. Check your Mandarin voice and try again.'); cancel() }
  function start() {
    if (done || utterance) return
    try {
      const voice = mandarinVoices(synth.getVoices()).find(v => navigator.onLine || v.localService)
      if (!voice) return
      clearTimeout(timer)
      synth.removeEventListener('voiceschanged', start)
      utterance = new SpeechSynthesisUtterance(text)
      utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.85
      utterance.onend = () => finish()
      utterance.onerror = failed
      timer = setTimeout(() => { finish('Speech did not finish. Tap the word to try again.'); cancel() }, 30000)
      synth.speak(utterance)
    } catch { failed() }
  }
  timer = setTimeout(() => finish(navigator.onLine ? 'No Mandarin voice is available. Install a Mandarin voice in your device speech settings, then tap again.' : 'Offline pronunciation needs an installed local Mandarin voice.'), 1200)
  try { synth.addEventListener('voiceschanged', start); start() } catch { failed() }
}
