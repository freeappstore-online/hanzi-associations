# Public content, private execution

Yi's landing page and `/associations` show the same shared public library.
Viewing, searching, refreshing images and copying cards require no account and
make no PAGS calls. `/lookup` is the dictionary. Local drafts have their own tab;
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
and verification/transport failures
revoke authorization. Storage/focus/visibility events and a one-second local timer
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

About & connection shows the current receipt and up to 50 recent requests on this
device/hostname, with status, request time and latest receipt update time. The
history stores word, request ID, status and timestamps, not prompts, tokens or raw
terminal logs. It is device-only and shared by accounts using that browser; it is
not an account-wide PAGS audit log. Existing pending receipts remain readable;
older generations cannot be reconstructed. Legacy update time uses the original
request time until the next status observation.

Polling is limited to the visible connection page with verified ownership and a
pending request. Public library browsing never polls PAGS, even with a saved OAuth
session and pending receipt. Returning to the connection page permits status
checks without resending generation. Public index plus raster SHA-256 are the only
proof of publication. Acknowledged, generating and pushed-commit states are not
proof of a live image.

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
