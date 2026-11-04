export function mandarinVoices(voices: SpeechSynthesisVoice[]) {
  return voices.filter(v => /^(cmn|zh)(-|_|$)/i.test(v.lang) && !/(?:-|_)(HK|MO|yue)(?:-|_|$)/i.test(v.lang) && !/cantonese|yue|廣東|广东|粵語|粤语/i.test(v.name))
    .sort((a, b) => Number(b.localService) - Number(a.localService) || Number(/^zh[-_]CN$/i.test(b.lang)) - Number(/^zh[-_]CN$/i.test(a.lang)))
}
let active: { owner: object; stop: () => void } | null = null
export function stopSpeech(owner?: object) {
  if (active && (!owner || active.owner === owner)) { const old = active; active = null; old.stop() }
}
export function speakWord(text: string, owner: object, report: (message: string) => void) {
  stopSpeech()
  if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) { report('Speech is unavailable in this browser. Try a browser with Mandarin speech support.'); return }
  const synth = speechSynthesis
  let done = false
  let utterance: SpeechSynthesisUtterance | undefined
  let timer: ReturnType<typeof setTimeout>
  const clear = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', start); if (utterance) { utterance.onstart = null; utterance.onend = null; utterance.onerror = null } }
  const finish = (message = '') => { if (done) return; done = true; clear(); if (active?.owner === owner) active = null; report(message) }
  const session = { owner, stop: () => { finish(); synth.cancel() } }
  active = session
  function start() {
    if (done || utterance) return
    const voice = mandarinVoices(synth.getVoices()).find(v => navigator.onLine || v.localService)
    if (!voice) return
    clearTimeout(timer)
    synth.removeEventListener('voiceschanged', start)
    utterance = new SpeechSynthesisUtterance(text)
    utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.85
    utterance.onend = () => finish()
    utterance.onerror = () => finish('Pronunciation could not play. Check your Mandarin voice and try again.')
    timer = setTimeout(() => { finish('Speech did not finish. Tap the word to try again.'); synth.cancel() }, 30000)
    utterance.onstart = () => { if (!done) report(`Speaking ${text}`) }
    try { synth.speak(utterance) } catch { finish('Pronunciation could not play. Check your Mandarin voice and try again.') }
  }
  report('Loading Mandarin voices…')
  timer = setTimeout(() => finish(navigator.onLine ? 'No Mandarin voice is available. Install a Mandarin voice in your device speech settings, then tap again.' : 'Offline pronunciation needs an installed local Mandarin voice.'), 1200)
  synth.addEventListener('voiceschanged', start)
  start()
}
