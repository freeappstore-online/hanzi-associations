import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportedOutcome, timelineSchema, incompleteEvent, requestTurn } from '../web/src/outcome.ts'

const id = '0ad2eed4-36ed-4a9c-a11c-bfbbc3a39539'
const failure = `YI_FAILED ${id} GitHub push access remains unavailable (push=false). No image generated or files changed.`
import { failedSnapshot } from './timeline-fixture.ts'
test('actual terminal tail reports timestamped failure without exposing its private reason', () => {
  assert.equal(reportedOutcome(failedSnapshot, id), 'failed')
  const page = timelineSchema.parse({ sessionId: 'csess-test', repoId: 'bound-repo', runState: 'idle', runnerConnected: true, events: [failedSnapshot], nextSeq: 63729, hasMore: true, oldestSeq: 63719, truncated: { events: 3, chars: 17408 } })
  assert.equal(reportedOutcome(page.events[0], id), 'failed')
  assert.ok(!('toolCalls' in page.events[0]))
})
test('standalone assistant markers retain exact request and commit boundaries', () => {
  for (const type of ['assistant', 'chat_assistant']) {
    assert.equal(reportedOutcome({ seq: 1, type, content: failure }, id), 'failed')
    assert.equal(reportedOutcome({ seq: 1, type, content: `YI_COMMITTED ${id} ${'a'.repeat(40)}` }, id), 'deploying')
  }
  assert.equal(reportedOutcome({ ...failedSnapshot, content: `[23:59:59] YI_COMMITTED ${id} ${'a'.repeat(40)}` }, id), 'deploying')
  assert.equal(reportedOutcome(failedSnapshot, '00000000-1111-4111-8111-000000000000'), undefined)
})
test('untrusted provenance, tool echoes, examples and incomplete markers do not qualify', () => {
  for (const type of ['user', 'chat_user', 'instruction', 'command', 'tool', 'tool_result', 'unknown']) {
    assert.equal(reportedOutcome({ seq: 1, type, content: failure }, id), undefined)
    assert.equal(reportedOutcome({ ...failedSnapshot, type }, id), undefined)
  }
  for (const content of [failure, `  [08:51:50] ${failure}`, `│ [08:51:50] ${failure}`, `↳✓ [08:51:50] ${failure}`, `[24:00:00] ${failure}`, `[08:51:50] ${failure}\nMore output`, `\`\`\`text\n[08:51:50] ${failure}`, `YI_ASSOCIATION_REQUEST ${id}\n[08:51:50] ${failure}`, `User: example\n[08:51:50] ${failure}`, `Command: echo\n[08:51:50] ${failure}`, `[08:51:50] YI_FAILED ${id}`, `[08:51:50] YI_COMMITTED ${id} ${'a'.repeat(41)}`]) {
    assert.equal(reportedOutcome({ ...failedSnapshot, content }, id), undefined, content)
  }
  assert.equal(reportedOutcome({ seq: 1, type: 'assistant', content: `Example:\n${failure}` }, id), undefined)
  assert.equal(reportedOutcome({ ...failedSnapshot, content: 'No result', toolCalls: [{ output: failure }] } as typeof failedSnapshot, id), undefined)
  assert.equal(reportedOutcome({ ...failedSnapshot, truncated: true }, id), undefined)
})

test('full terminal snapshots with prompt and tool blocks are not the feed outcome channel', () => {
  const full = { ...failedSnapshot, content: '⚙ Bash command\n' + 'x'.repeat(7700) + '\n' + failedSnapshot.content }
  assert.equal(reportedOutcome(full, id), undefined)
  assert.equal(reportedOutcome({ ...full, content: full.content.slice(-400) }, id), 'failed')
})

test('real chars truncation blocks narrative outcomes; complete command first lines and terminal tails remain usable', () => {
  const cut = { seq: 63726, type: 'command', content: `YI_ASSOCIATION_REQUEST ${id}`, chars: 5000 }
  assert.equal(incompleteEvent(cut), false)
  assert.equal(requestTurn(cut, id), false)
  assert.equal(requestTurn({ ...cut, chars: cut.content.length }, id), true)
  assert.equal(requestTurn({ ...cut, content: cut.content + '\n' + 'x'.repeat(1100), chars: 3250 }, id), true)
  assert.equal(reportedOutcome({ seq: 1, type: 'chat_assistant', content: failure, chars: failure.length + 20 }, id), undefined)
  assert.equal(incompleteEvent(failedSnapshot), false)
  assert.equal(reportedOutcome(failedSnapshot, id), 'failed')
})
