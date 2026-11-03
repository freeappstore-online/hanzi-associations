# Yi

Chinese words, vivid memories. A mobile-first dictionary and mnemonic image
library at https://yi.freeappstore.online. The original
https://hanzi-associations.freeappstore.online remains supported.

- Search 125,356 CC-CEDICT entries by simplified/traditional hanzi, pinyin, or
  English. Filter words or single characters and choose alternate readings.
- Browse the shared public library without login or PAGS calls when no pending owner
  request is being tracked. Copy public cards into separate device-only drafts.
- Save sound, character, or meaning associations locally; revise descriptions
  and optional music cues; import/export JSON backups.
- Publish images through the owner's private PAGS artist using direct Codex
  subscription CLI sessions. A real native-generated yellow-chair image is
  included in `web/public/associations/chair-easy-v1.png`.

## Development

Node 22+, pnpm. `pnpm install`, then `pnpm dev`.

- `pnpm test`: unit tests, published-asset validation, typecheck/build, SDK styling.
- `pnpm test:browser`: Playwright Chromium mobile + desktop workflows.
- `pnpm validate:associations`: exact dictionary entries, safe paths, raster
  signatures, unique IDs, and SHA-256. Also visually inspect every new image.
- `fas check`: platform compliance. `git push origin main` deploys through Actions.

If Playwright Chromium is missing, install it with `pnpm exec playwright install chromium`.
Local screenshots and traces are gitignored under artifacts/ and test-results/.

## Connection and publication

The browser discovers `https://mcp.proagentstore.online/.well-known/oauth-authorization-server`
and registers a public OAuth client (`token_endpoint_auth_method: none`).
Authorization Code + PKCE S256 requests only `read runtime`. State is single use
and expires after ten minutes. Tokens stay in sessionStorage, are never logged
or exported, and expire according to the server; reconnect rather than retain
refresh tokens. The callback query is removed immediately.

The official `@modelcontextprotocol/sdk` uses `/mcp`, discovers tool schemas,
and validates input before each call. Only the required read/message tools and optional authenticated `whoami` identity
tool are allowed. Candidate/recruiting profiles are never read. Ownership is checked before instance reads. The artist
must be the account's active `abfc80a9-a7c3-4951-b7b3-85f826e4fdfa`, bound only
to `repo_5d14d39b-dfdb-4a4e-a94b-a71c7a11b6d6` / this repository, with default
Codex subscription billing. An active session must be on that repo and Codex,
idle, alive, ready, and without another owner before dispatch. No account
configuration is changed by Yi.

`coding_session_message` has no server-side idempotency parameter. Yi uses Web
Locks across tabs, writes a local durable request receipt before sending, and
never automatically resends an uncertain request. It reconciles sessions and
checks active pending requests every 12 seconds while visible on any page.
Each check first tries public deployment proof, including when OAuth has expired.
Authenticated reads are allowed for saved pending tracking or explicit owner
work; ordinary public browsing without pending work never invokes PAGS. A lost acknowledgement
can remain uncertain and require owner investigation in PAGS. This prevents
blind retries; it cannot enforce a cross-device server lock. Do not clear a
pending receipt to bypass it. Queued means acknowledged, generating means the
associated session is working, deploying means a commit is reported or only
part of the asset deployment is live. Published requires a matching deployed
index record and raster SHA-256. See ASSOCIATIONS.md for the agent contract.

The public library, dictionary and local drafts require no account. Publishing
controls appear only for the verified owner of the configured private artist.
The client rechecks ownership before dispatch, including direct method calls.
PAGS server authorization is the final boundary; mocked app tests do not prove
production cross-account protection. The live OAuth approval and browser-to-CLI publish
flow require that owner's account and an idle runner. Automated tests use
synthetic OAuth/MCP responses; they never dispatch a real coding turn.

## Public library and owner connection

The landing page is Association library; `/lookup` is dictionary search. Public
cards and local drafts are separate views. A copied public card gets its own local
ID, and a local revision never changes the visible public library.

FreeAppStore and PAGS sign-ins are independent. Only authenticated PAGS `whoami`
identity (login/provider) is displayed, with an honest owner-verification fallback
if identity metadata is unavailable. No name is hardcoded. Verification lasts for
the current valid OAuth session, is revoked on expiry/disconnect/session changes
or explicit access denial. Slow checks, transient read failures and a busy runner
do not erase known ownership. All guards run again before dispatch. Generation consumes the
connected owner's Codex subscription; public browsing does not.

Opening a draft, Local drafts or About & connection automatically checks a saved
PAGS session. There is no persisted trusted ownership flag. Draft cards and editors
show Draft, Queued, Generating, Publishing, Published or Failed, and explain
unconfirmed delivery, unavailable status or a needed connection. Saving and editing
remain local and available throughout. Completed receipts remain completed when
image verification is delayed or unavailable; they never silently revert to Draft.
Only images related to local draft/request IDs are checked, with successful checks
cached by image path and SHA. Local revisions are shown separately from the last
published image and from the snapshot of an in-flight request.

Recent activity is up to 50 device-only publication receipts, with timestamps and
status, shared by accounts using this browser/hostname. It is not account-wide
history. The PAGS homepage link leads to the service where the owner can select
the artist for full activity. Yi displays no raw private terminal logs.

See [the access model](docs/access-model.md) for lifecycle checks, receipt coverage,
server-authorization evidence and test limitations. A reusable public template,
own-instance selection and community contributions are future work, not shipped
features. The owner's private artist template remains private.

## Privacy, data and offline behaviour

No analytics loader or AI API key is included. The SDK Shell supplies navigation,
theme and accessible dialogs; background SDK diagnostic uploads are disabled.
Drafts use localStorage, session tokens use sessionStorage, and backups contain
only draft fields. Storage failures are visible and block publishing. Published
images and all association metadata are public. Hostnames have separate browser
storage; export/import to move drafts when switching hosts.

The dictionary gzip (served as cedict.bin to avoid automatic HTTP decompression) is fetched lazily into a Web Worker on first search. It is
not in the initial JS graph or service-worker precache; a new offline page may
need to reconnect for dictionary search. Publication data is never precached.
Browsers need DecompressionStream, Web Crypto and Web Locks for full support.
Songs are title/artist with an external YouTube search link; no audio is copied.

App code: MIT. Dictionary: CC-CEDICT / MDBG, snapshot 2026-11-02, unchanged
125,356-entry gzip, CC BY-SA 4.0. See `web/public/dictionary/NOTICE.txt`; its
license applies separately to dictionary data and adaptations. Tone-mark and
search normalization happen in memory and never replace source pronunciation.
