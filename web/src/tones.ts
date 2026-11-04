// Tone contours adapted from MIT-licensed freeappstore-online/hanzi-practice,
// commit 51199fc26d81c8f14f7ba082e1f721135be27500 (see THIRD_PARTY_NOTICES.md).
import { toneMarks } from './dictionary'
export const TONES = {
  1: { path: 'M6 11 H34', label: 'high and level' },
  2: { path: 'M6 32 C16 29 24 16 34 6', label: 'rising' },
  3: { path: 'M5 12 C11 35 19 40 24 27 S30 10 35 5', label: 'dip then rise' },
  4: { path: 'M6 6 C15 13 25 26 34 34', label: 'falling' },
  5: { path: '', label: 'neutral' },
} as const
export function syllables(pinyin: string) {
  return (pinyin.match(/[\p{L}\p{M}:]+[0-5]?/gu) || []).map(raw => {
    const marks: Record<string, number> = { '\u0304': 1, '\u0301': 2, '\u030c': 3, '\u0300': 4 }
    const digit = raw.match(/[0-5]$/)?.[0]
    const number = (digit ? Number(digit) || 5 : [...raw.normalize('NFD')].map(c => marks[c]).find(Boolean) || 5) as keyof typeof TONES
    return { text: toneMarks(raw), number, ...TONES[number] }
  })
}
