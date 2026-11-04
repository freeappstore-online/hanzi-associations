import type { Store } from './model'

// Resolve the browser getter inside each guarded operation. Never substitute
// memory for durable credentials, publication receipts, or draft storage.
export function browserStore(kind: 'localStorage' | 'sessionStorage'): Store {
  const access = () => {
    try { return globalThis[kind] }
    catch { throw new Error(`${kind === 'sessionStorage' ? 'Session' : 'Local'} storage is unavailable. Allow browser storage to save or connect securely.`) }
  }
  return {
    getItem: key => access().getItem(key),
    setItem: (key, value) => access().setItem(key, value),
    removeItem: key => access().removeItem(key),
  }
}
export const localStore = browserStore('localStorage')
export const sessionStore = browserStore('sessionStorage')
