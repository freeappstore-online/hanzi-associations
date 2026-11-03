import { z } from 'zod'

export const timelineSchema = z.object({
  sessionId: z.string().nullable().optional(), repoId: z.string().nullable().optional(),
  nextSeq: z.number().optional(), oldestSeq: z.number().optional(), hasMore: z.boolean().optional(),
  truncated: z.object({ events: z.number(), chars: z.number() }).optional(),
  events: z.array(z.object({ seq: z.number(), type: z.string(), content: z.string().optional(), chars: z.number().optional(), truncated: z.boolean().optional() })),
})
type Event = z.infer<typeof timelineSchema>['events'][number]
export type Outcome = 'failed' | 'deploying'

// PAGS currently supplies rendered terminal snapshots, not structured outcomes.
// Never scan toolCalls, unknown event types, indented tool echoes or prompt bodies.
// Assistant messages must consist entirely of one marker. For terminal snapshots,
// only the final top-level, renderer-timestamped line is a supported result.
export function reportedOutcome(event: Event, requestId: string): Outcome | undefined {
  if (!event.content || incompleteEvent(event)) return
  let line = event.content.replace(/\r\n/g, '\n')
  if (event.type === 'terminal') {
    // The feed retains at most 400 characters of terminal text. Full pane
    // captures (including seq expansion) are not a trusted narrative channel.
    if (line.length > 400) return
    const lines = line.split('\n')
    while (lines.at(-1) === '') lines.pop()
    // A visible raw prompt/code block is ambiguous: do not treat an example in
    // it as an outcome. Normal terminal tool echoes have indentation/│/↳ prefixes.
    if (lines.some(l => /^(?:```|~~~|YI_ASSOCIATION_REQUEST |CREATIVE_BRIEF_JSON|END_CREATIVE_BRIEF_JSON|(?:\[[0-2]\d:[0-5]\d:[0-5]\d\] )?(?:User:|Instruction:|Command:|⚙))/.test(l))) return
    const last = lines.at(-1)?.match(/^\[(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\] (.+)$/)
    if (!last) return
    line = last[1]
  } else if (event.type === 'assistant' || event.type === 'chat_assistant') {
    line = line.replace(/\n$/, '')
  } else return
  // UUID comparison is literal; neither the request nor private error text is
  // interpolated into a regex or exposed in the UI.
  const match = line.match(/^YI_(FAILED|COMMITTED) ([0-9a-f-]{36}) ([^\r\n]+)$/)
  if (!match || match[2] !== requestId) return
  if (match[1] === 'FAILED' && match[3].trim()) return 'failed'
  if (match[1] === 'COMMITTED' && /^[a-f0-9]{40}$/.test(match[3])) return 'deploying'
}

export function isRequestTurn(event: { type: string }): boolean {
  return ['command', 'instruction', 'user', 'chat_user'].includes(event.type)
}
export function requestTurn(event: Event, id: string): boolean {
  const content = event.content ?? ''
  const firstLineIsComplete = content.includes('\n') || (event.chars ?? content.length) <= content.length
  return isRequestTurn(event) && firstLineIsComplete && content.split('\n')[0] === `YI_ASSOCIATION_REQUEST ${id}`
}
export function incompleteEvent(event: Event): boolean {
  // Command bodies cannot contain outcomes. Their complete first line identifies
  // a request; any later command supersedes it, even if the body is cut.
  if (isRequestTurn(event)) return false
  if (event.truncated) return true
  // budgetFeedEvent truncates terminal panes to a deliberate 400-character tail.
  // For all other types, chars > content.length means unread narrative/commands.
  if (event.type === 'terminal') return (event.content?.length ?? 0) > 400
  return (event.chars ?? 0) > (event.content?.length ?? 0)
}
