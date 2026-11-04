import { localStore } from './storage'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
export const DEFAULT_SIZES = { hanzi: 40, pinyin: 24, translation: 20 }
export const SIZE_LIMITS = { hanzi: [24, 72], pinyin: [16, 40], translation: [16, 36] } as const
export type ReadingSizes = typeof DEFAULT_SIZES
export const READING_KEY = 'yi.reading.v1'
export function parseSizes(raw: string | null): ReadingSizes {
  if (!raw) return { ...DEFAULT_SIZES }
  const value = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Object.keys(DEFAULT_SIZES).some(k => { const n = value[k]; const [min, max] = SIZE_LIMITS[k as keyof ReadingSizes]; return !Number.isInteger(n) || n < min || n > max })) throw Error('Invalid reading sizes')
  return { hanzi: value.hanzi, pinyin: value.pinyin, translation: value.translation }
}
const Context = createContext<{ sizes: ReadingSizes; update: (s: ReadingSizes) => void; error: string }>({ sizes: DEFAULT_SIZES, update: () => {}, error: '' })
export const useReading = () => useContext(Context)
export function ReadingProvider({ children }: { children: ReactNode }) {
  const [sizes, setSizes] = useState(DEFAULT_SIZES)
  const [error, setError] = useState('')
  useEffect(() => { try { setSizes(parseSizes(localStore.getItem(READING_KEY))) } catch { setError('Reading sizes could not be loaded. Defaults are in use; reset to repair saved settings.') } }, [])
  function update(next: ReadingSizes) {
    const valid = parseSizes(JSON.stringify(next)); setSizes(valid)
    try { localStore.setItem(READING_KEY, JSON.stringify(valid)); setError('') } catch { setError('Reading sizes apply in this tab but could not be saved on this device.') }
  }
  return <Context.Provider value={{ sizes, update, error }}>{children}</Context.Provider>
}
