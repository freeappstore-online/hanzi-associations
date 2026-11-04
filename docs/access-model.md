# Public content, private execution

Yi's landing page and `/associations` show the same shared public library.
Viewing, searching, refreshing images and copying cards require no account and
make no PAGS calls unless a saved pending owner request is being tracked. `/lookup` is the dictionary. Local drafts have their own tab;
they never overlay public cards, including legacy drafts with a public card's ID.
Copying a public card creates a new local draft ID. Draft storage and JSON backup
formats are unchanged. No existing public card or image was changed for this work.

## Current publishing target

Yi currently supports only the configured private Hanzi Association Artist
(`abfc80a9-a7c3-4951-b7b3-85f826e4fdfa`) and its single ready repository binding
(`repo_5d14d39b-dfdb-4a4e-a94b-a71c7a11b6d6`,
`freeappstore-online/hanzi-associations`). This is an owner-only integration, not
a public shared generation service. Generation consumes the connected owner's
Codex subscription. Public viewing consumes none of that subscription.

FreeAppStore and ProAgentStore (PAGS) sign-ins are independent. A FreeAppStore
account does not establish PAGS identity or artist ownership. Yi uses public OAuth
registration and PKCE with only `read runtime` scopes; it does not change account
permissions. Tokens stay in sessionStorage, never in exports, receipts or UI.

## Authenticated identity and lifetime

The discovered, authenticated `whoami` tool is called with `{}` (no explicit token;
the OAuth bearer is handled by the transport). Its supported top-level identity
fields are `id`, `login`, `provider`, and `providerLabel`. Only these fields are
consumed; email, roles and other metadata are discarded. The UI shows login and
provider, plus the safe account identifier. If the tool is absent, successful
ownership verification is honestly labeled “Verified artist owner,” with the
bound repository's `userId` only when available. An advertised identity tool that
fails or returns invalid data makes verification fail. Candidate/recruiting
profiles are not used.

Verification remains valid for the current OAuth session (with the existing
30-second expiry margin); it does not expire every minute during editing.
Disconnect, expiry, token/client/expiry or authenticated account identity changes,
and explicit access denials revoke authorization. Ownership and repository binding
are separate from engine/session readiness. A slow recheck, unavailable network
read, or busy runner does not erase an already established identity. Malformed
ownership data still fails closed. Fresh server checks are mandatory before every
dispatch, even when the identity remains visible. Storage/focus/visibility events and a one-second local timer
remove stale UI. Every client operation checks the captured session before and
after asynchronous work. A client that observes a session change is permanently
unusable. Late OAuth exchanges cannot overwrite a switched or disconnected
session. UI connection generations prevent late promises from restoring an old
account. Disconnect takes effect before transport shutdown finishes.

## Dispatch checks and limits

Publish controls require verified ownership. Direct `Pags.publish()` calls also
run the private checks; a caller cannot access a raw message method or bypass the
checks by overriding the public `verify()` method. These browser controls are
safeguards, not a substitute for PAGS server authorization: users control their
browser code and can construct their own network requests.

Each dispatch freshly verifies active ownership before reading private resources,
the single ready repo binding, Codex subscription billing, and active session
compatibility. An active session must be on the right repo and Codex, alive, idle,
ready, connected and without another owner/auth prompt. Timeline/capture response
IDs are checked when present. No await occurs between the final local session
check and invoking the message transport, other than the message operation itself.
If no session is active, the existing supported message flow may open one; Yi
never changes engine settings or opens a competing session itself.

Web Locks serialize UI publishing across same-origin tabs. The client also rejects
concurrent dispatch and already-recorded requests. A validated durable pending
receipt is saved before sending. Receipt/history storage failure blocks dispatch.
A lost acknowledgement remains uncertain and is never automatically resent.
There is no server idempotency key or cross-device lock; another browser or an
external actor can still race the server between reads and dispatch. Never clear
an unresolved receipt to force a retry.

## Receipts and activity coverage

Profile shows the current receipt and up to 50 recent requests on this
device/hostname, with status, request time and latest receipt update time. The
history stores word, request ID, status and timestamps, not prompts, tokens or raw
terminal logs. It is device-only and shared by accounts using that browser; it is
not an account-wide PAGS audit log. Existing pending receipts remain readable;
older generations cannot be reconstructed. Legacy update time uses the original
request time until the next status observation.

A single workflow coordinator checks active pending requests every 12 seconds on
any visible page, and on focus, visibility restoration or network recovery. A
synchronous in-flight guard prevents overlapping verification, polling and sending.
The interval does not depend on checking/status/ownership changes, so slow responses
cannot reset and starve it. Session changes invalidate late work. Every check starts
with the public index and raster SHA-256; expired/disconnected OAuth does not prevent
public reconciliation. Missing private status is reported as connection needed or
status unavailable, without silently changing the last observed request state.

Opening Local drafts, an editor or Profile establishes ownership from a
valid saved OAuth session automatically, including after reload. No trusted boolean
is persisted. Anonymous public browsing, or saved OAuth without pending/owner work,
makes zero PAGS calls. Explicit owner work or saved pending tracking may use private
reads. Acknowledgement, a working session and a pushed-commit marker are not proof
of publication. The shared library is refreshed after matching deployment proof.

Receipts include draftId. Legacy rows resolve that field only from the matching
pending request or a deployed index record with the same requestId, never from word
text. Unmatched rows remain unassigned. Migration preserves request IDs and is
bounded to 50 rows. An unresolved history receipt also prevents a new dispatch if
its pending snapshot was lost; investigate rather than guessing a new request.

Draft status distinguishes the pending snapshot, current local edits, and the last
verified public image. A completed receipt without a currently verified matching
image says “Checking published image” or “Published image unavailable”; it offers a
public image recheck and does not offer generation as if nothing had happened.
Only local draft/request image IDs are hashed. Successful checks (including shared
in-flight checks) are cached by path and SHA for the mounted workspace, and failed
checks can be retried. This cache proves public content only, never authorization.

The full-activity link uses the verified PAGS homepage,
https://proagentstore.online (HTTP 200 checked 3 November 2026). Select the private
artist there for activity. Yi does not guess an instance-specific route or display
private logs in the app.

## Verification evidence and remaining limits

Automated app tests use synthetic OAuth and MCP transport only. They cover public
browsing without PAGS calls, non-owner and anonymous direct publishing, rechecking
all guards, expiry/disconnect, failed reverification, account-switch races, late
verification responses, one accepted owner dispatch, uncertain-send preservation,
receipt storage, local drafts and public image checksums. Browser tests intercept
all PAGS URLs and never dispatch a real generation request.

The owner separately reported an independent PAGS server audit passing 175 focused
local tests with synthetic sessions and no bypass found, and is documenting exact
coverage in GitHub issue #1. That is owner-reported server evidence, not a result of
this repository's app tests. No production cross-account test or live OAuth-to-CLI
generation was performed in this delivery; mocked app tests cannot prove production
server authorization. Production PAGS remains responsible for authorization on
every private read and message, regardless of the browser's checks.

## Future contributions

A reusable public artist template, newcomer setup guide, selecting one's own
instance, and reviewed community contributions are separate future work. None is
available in this delivery. The private artist template has not been published,
and connecting a different account does not grant publishing access.

## Issue #2 investigation and regressions

Observed in the pre-fix UI with a synthetic 1.6-second ownership read: the identity
was absent during the recheck, and absent after reload. The real SDK Shell link
round trip retained identity in that reproduction. We did not reproduce permanent
identity loss after the delayed recheck, nor claim that navigation alone revoked it.

Code inspection found that #verifyTarget revoked ownership at the beginning of
every check, while a one-second UI timer cleared the displayed identity during
that gap. Status polling required that displayed identity and the connection path;
reconciliation did not restore identity via an explicit success callback until the
whole status check returned. Its timer also restarted on checking/verified changes.
Reload had no automatic ownership restoration. Those are the identified mechanisms;
the exact production timing of the original cello symptom was not replayed.

Regressions use actual SDK navigation links (and the mobile Menu), reloads, real
12-second periodic polls, delayed synthetic MCP responses and synthetic deployment
index/image responses. They cover one accepted dispatch through queued, generating,
publishing and checksum-proven publication; local edits during a request; expired
legacy cello reconciliation with zero private calls; unavailable/completed image
states; targeted image caching; failure/uncertain states; and access revocation.
No real generation, account change or production authorization experiment is part
of these tests. The six existing raster assets and index must remain byte-identical
to b66041c5d5e51a901f6216c996ab66b282ca0463.

Local delivery validation: 45 unit tests, 40 distinct browser scenarios across
full and targeted runs (mobile and desktop), two styling tests, production build,
and all six association validations. Screenshots of both viewports were inspected.
The mobile image-loading assertion now scrolls lazy images into view; counts come
from the index. A timed poll assertion was widened from 20 to 40 seconds after one
loaded-machine timeout; the application interval remains 12 seconds and the slow
synthetic read remains 1.6 seconds. Final affected lifecycle runs passed on both
viewports without manual status clicks. No generation request reached production.

## Issues #3 and #4: Profile and result recovery

Profile (`/profile`) is reachable through SDK Shell navigation and its signed-in
avatar using released SDK 0.16.6. The SDK ProfilePage keeps existing appearance,
text size, friends, API keys, sign-out and account-deletion controls. PAGS controls
and device receipts remain outside its signed-in gate. FreeAppStore and PAGS
identity/session lifetimes remain separate. `/connection` renders the same page
and is still the registered OAuth redirect URI; `/about` holds story and credits.
No credentials, account merge, permission changes or expanded token persistence
are involved. PAGS settings at `/console/preferences` provides platform GitHub
Reconnect; it cannot repair the artist machine's separate GitHub CLI login. The
Profile page makes no claim about live GitHub connectivity.

Observed evidence for #3 is the owner-supplied sanitized coding_timeline event
63728: a terminal feed tail ending with `[08:51:50] YI_FAILED` for the failed 黄
request. The old bare-marker regex could not match it. The earlier mobile receipt
was not inspected; advancing beyond that event is a recovery scenario, not a
claim about the phone's exact stored state. Tests replay cursor 63729 with the
failure at 63728 while unrelated session work is busy.

The timeline does not supply a structured per-request outcome. Parsing therefore
uses a deliberately narrow rendered-output convention: a complete single-line
assistant/chat_assistant marker, or the final top-level timestamped marker in a
terminal feed tail of at most 400 characters. Only HH:MM:SS timestamps, literal
matching request UUIDs and exact commit hashes qualify. Commands, instructions,
user messages, unknown types, indented tool echoes, visible prompt/code blocks and
toolCalls never supply outcomes. Full pane snapshots/seq expansions are excluded;
the feed's intentional terminal tail is different from the full 8,079-character
prompt/tool-containing snapshot. This convention is not cryptographic assistant
provenance: ambiguous or unsupported output remains unconfirmed. No private
failure text is displayed, and a commit report is never proof of deployment.

New receipts keep an immutable dispatchSeq separate from the advancing sinceSeq.
Forward reads use since_seq/nextSeq exclusively (oldest to newest). Legacy
unresolved receipts without a dispatch boundary read the newest page and move
backwards using before/oldestSeq exclusively, to recover an already-skipped
outcome or the original request turn. Both scans are bounded to five pages.
Narrative event.chars greater than content.length identifies unread outcome text; the
page-level truncated counts are checked too. Intentional terminal-tail cuts are
allowed. Command/instruction bodies are never outcome sources, so a complete
first-line request marker suffices for attribution even in a 1,200-character
head of a longer command. Later cut commands still establish supersession and
do not block historical recovery. Incomplete/looping/over-budget reads retain the prior cursor and show
status unavailable rather than skipping unseen text. Public SHA proof remains
first, even without auth.

Generating requires a matching latest command/instruction/user turn and a working
matching session; a later unrelated turn supersedes it. A busy session alone no
longer proves that an old request is generating. If request-specific progress
cannot be established, Yi reports unconfirmed/stopped-or-other-work status and
never resends. Legacy recovery has finite history coverage; very old, ambiguous
or heavily truncated activity may still require manual review in PAGS.

Local validation for #3/#4: 57 unit tests, 48 distinct browser scenarios (24
per viewport across full and targeted runs), two styling checks and production
build passed. The six published cards/images validate and remain byte-identical
to b66041c5d5e51a901f6216c996ab66b282ca0463. Desktop/mobile signed-in and
signed-out Profile screenshots were inspected. Tests use synthetic FAS/OAuth/MCP
responses and deployment bytes; no real generation or resend was dispatched.
The first broad browser run was interrupted during review; one mobile workflow
exceeded its overall timeout under six workers. Targeted runs used two workers
and retained the application polling interval. The quota-warning test now scopes
to the editor alert, and lazy-image checks wait for the index-derived card count
before scrolling each image into view.
FAS compliance passed all hard checks with the same two existing warnings:
dictionary/NOTICE offline precaching and the CLAUDE.md SKILLS pointer.

## Issue #5: local reading preferences and browser speech

Reading sizes use the separate `yi.reading.v1` localStorage key, containing only
three bounded numbers. Invalid values fall back with a visible error. Storage
failure keeps the current tab's preview working; reset explicitly repairs values.
No account, OAuth, publication, image, or dictionary data is changed by these controls.

Pronunciation takes only the dictionary entry's Chinese word. Taps on pinyin or
traditional Chinese use the same word; cues and image descriptions are never
speech input. Browser voices load through `voiceschanged`; local Mandarin wins
over remote Mandarin, Cantonese is excluded, and offline use requires local
speech. Cancellation detaches callbacks and cancels the active utterance on
replacement, navigation and component removal. Speech is user initiated and
makes no application API/PAGS requests. Browser/OS remote voices may use network.
Tests mock speech events and do not demonstrate audible device output.

Issue #5 handoff verification: 61 unit tests passed (also rerun with concurrency
2), all six association assets validated, and an earlier production build plus
two styling checks passed. FAS hard checks passed with the same two existing
warnings. The broad two-worker browser run finished with 56 passing and 6 failing:
four new preference checks targeted a data attribute not forwarded by SDK Card
(corrected to the labeled preview); one mobile test encountered missing sw.js
because preview overlapped PWA generation; one existing desktop ownership test
exceeded its overall timeout on the overloaded runner. Default mobile/desktop
lookup screenshots were inspected. Maximum-size screenshot checks remain pending.
The subsequent build passed TypeScript and Vite bundling but was terminated with
SIGTERM before completing PWA generation, so its chained browser rerun did not
start. The final decorative draft-Hanzi removal has not been rebuilt. Root is
responsible for final build, browser verification, maximum-size screenshots and
deployment after this bundle handoff. Do not interpret this as 62 browser passes
or audible physical-device speech validation. No push or generation was attempted.
