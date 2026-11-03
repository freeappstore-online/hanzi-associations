import { sameBrief, verifyImage, type Draft, type Published } from './model'
import type { Pending, Receipt } from './generation'

export const statusLabel = { queued: 'Queued', generating: 'Generating', deploying: 'Publishing', published: 'Published', failed: 'Failed', uncertain: 'Delivery unconfirmed' } as const
export const activeRequest = (p: Pending | null) => Boolean(p && p.status !== 'published' && p.status !== 'failed')

// Public proof works without OAuth, including after expiry or an explicit disconnect.
export async function deployedResult(request: Pending, cards: Published[]): Promise<Pending | null> {
  const match = cards.find(p => p.requestId === request.id && p.id === request.draft.id)
  if (!match) return null
  try {
    await verifyImage(match)
    return { ...request, status: 'published', detail: 'The published image is live and its checksum matches.' }
  } catch {
    return { ...request, status: 'deploying', detail: 'The card is live; waiting for its matching image bytes.' }
  }
}

export function draftProgress(draft: Draft, pending: Pending | null, receipts: Receipt[], images: Published[], imageUnavailable = false) {
  const request = pending?.draft.id === draft.id ? pending : null
  const receipt = receipts.find(r => r.draftId === draft.id)
  const image = images.find(p => p.id === draft.id)
  const status = request?.status ?? receipt?.status
  const active = Boolean(status && !['published', 'failed'].includes(status))
  const knownPublished = status === 'published' && (!image || image.requestId !== (request?.id ?? receipt?.id))
  const changed = image && !sameBrief(draft, image)
  return {
    active, image, changed, knownPublished,
    label: knownPublished ? imageUnavailable ? 'Published image unavailable' : 'Checking published image' : active ? statusLabel[status!] : image && !changed && (!status || status === 'published') ? 'Published' : status === 'failed' ? 'Failed' : 'Draft',
    detail: knownPublished ? 'This request completed. Its published image must be checked before viewing. It will not be generated again.' : active ? request?.detail ?? 'A pending receipt exists, but its request details are unavailable. Review activity in PAGS; do not resend.' : status === 'failed' ? 'The artist reported a failure. Review it before creating a new request.' : changed ? 'Unpublished changes · the last published image is still available.' : image ? 'Published image verified.' : 'Saved only on this device.',
    editedWhilePending: active && request && !sameBrief(draft, request.draft),
  }
}
