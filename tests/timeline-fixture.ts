const id = '0ad2eed4-36ed-4a9c-a11c-bfbbc3a39539'
const failure = `YI_FAILED ${id} GitHub push access remains unavailable (push=false). No image generated or files changed.`
// Sanitized event shape supplied from the real failed request. The pane prefix
// is omitted by the service; chars and toolCallGap are not assistant provenance.
export const failedSnapshot = {
  seq: 63728, type: 'terminal', createdAt: '2026-11-03 21:51:51',
  content: `3 - <<'PY'...\n  ↳✓ Current session: {'originator':'codex_exec','source':'exec','model_provider':'openai','cli_version':'0.164.0'}\n[08:51:50] ${failure}`,
  chars: 8079, toolCalls: [{ tool: 'Bash', input: '[sanitized]', output: '[sanitized]', ok: true, inputCut: true, outputCut: true }], toolCallGap: true,
}
