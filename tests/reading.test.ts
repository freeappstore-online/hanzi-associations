import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syllables, TONES } from '../web/src/tones'
import { DEFAULT_SIZES, parseSizes } from '../web/src/reading'
import { mandarinVoices, speakWord, stopSpeech } from '../web/src/speech'
test('dictionary syllables each have the matching contour including neutral and ü', () => {
  assert.deepEqual(syllables('yi1 yi2 yi3 yi4 zi5 nu:3').map(s => s.number), [1, 2, 3, 4, 5, 3])
  assert.deepEqual(syllables('yi3 zi5').map(s => s.text), ['yǐ', 'zi'])
  assert.equal(syllables('nu:3')[0].text, 'nǚ')
  assert.deepEqual(syllables('xǐ huan nǚ lǜ yǐ zi').map(s => [s.text, s.number]), [['xǐ', 3], ['huan', 5], ['nǚ', 3], ['lǜ', 4], ['yǐ', 3], ['zi', 5]])
  assert.equal(TONES[3].path, 'M5 12 C11 35 19 40 24 27 S30 10 35 5')
})
test('reading preferences reject corrupt and out-of-bounds persisted values', () => {
  assert.deepEqual(parseSizes(null), DEFAULT_SIZES)
  assert.deepEqual(parseSizes('{"hanzi":72,"pinyin":40,"translation":36}'), { hanzi: 72, pinyin: 40, translation: 36 })
  for (const bad of ['null', '{}', 'broken', '{"hanzi":73,"pinyin":24,"translation":20}', '{"hanzi":40,"pinyin":"24","translation":20}']) assert.throws(() => parseSizes(bad))
})
test('Mandarin voices prefer local service and exclude Cantonese language and names', () => {
  const voices = [{ lang: 'zh-CN', name: 'remote', localService: false }, { lang: 'zh-TW', name: 'local', localService: true }, { lang: 'zh-HK', name: 'HK', localService: true }, { lang: 'yue-CN', name: 'yue', localService: true }, { lang: 'zh-CN', name: 'Cantonese', localService: true }, { lang: 'en-US', name: 'English', localService: true }] as SpeechSynthesisVoice[]
  assert.deepEqual(mandarinVoices(voices).map(v => v.name), ['local', 'remote'])
})
test('speech replacement cancels old utterances and owner cancellation clears callbacks', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'speechSynthesis')
  const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance')
  let cancels = 0
  const spoken: { text: string; onend: unknown }[] = []
  Object.defineProperty(globalThis, 'speechSynthesis', { configurable: true, value: { getVoices: () => [{ lang: 'zh-CN', name: 'local', localService: true }], addEventListener() {}, removeEventListener() {}, cancel() { cancels++ }, speak(u: typeof spoken[number]) { spoken.push(u) } } })
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: class { constructor(public text: string) {} } })
  try {
    const a = {}, b = {}
    speakWord('椅子', a, () => {}); speakWord('你好', b, () => {})
    assert.deepEqual(spoken.map(u => u.text), ['椅子', '你好']); assert.equal(cancels, 1)
    stopSpeech(a); assert.equal(cancels, 1)
    stopSpeech(b); assert.equal(cancels, 2); assert.equal(spoken[1].onend, null)
  } finally {
    stopSpeech()
    if (original) Object.defineProperty(globalThis, 'speechSynthesis', original); else Reflect.deleteProperty(globalThis, 'speechSynthesis')
    if (originalUtterance) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', originalUtterance); else Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')
  }
})
