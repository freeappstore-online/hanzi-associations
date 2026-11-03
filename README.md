# Yi

Chinese words, vivid memories. A mobile-first dictionary and mnemonic image
notebook at https://yi.freeappstore.online. The original
https://hanzi-associations.freeappstore.online remains supported.

- Search 125,356 CC-CEDICT entries by simplified/traditional hanzi, pinyin, or
  English. Filter words or single characters and choose alternate readings.
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
and validates input before each call. Only the seven required read/message
tools are allowed. Ownership is checked before instance reads. The artist
must be the account's active `abfc80a9-a7c3-4951-b7b3-85f826e4fdfa`, bound only
to `repo_5d14d39b-dfdb-4a4e-a94b-a71c7a11b6d6` / this repository, with default
Codex subscription billing. An active session must be on that repo and Codex,
idle, alive, ready, and without another owner before dispatch. No account
configuration is changed by Yi.

`coding_session_message` has no server-side idempotency parameter. Yi uses Web
Locks across tabs, writes a local durable request receipt before sending, and
never automatically resends an uncertain request. It reconciles sessions and
polls timeline/capture every 12 seconds while visible. A lost acknowledgement
can remain uncertain and require owner investigation in PAGS. This prevents
blind retries; it cannot enforce a cross-device server lock. Do not clear a
pending receipt to bypass it. Queued means acknowledged, generating means the
associated session is working, deploying means a commit is reported or only
part of the asset deployment is live. Published requires a matching deployed
index record and raster SHA-256. See ASSOCIATIONS.md for the agent contract.

Dictionary and local drafts require no account. Other PAGS users cannot target
this owner's private artist. The live OAuth approval and browser-to-CLI publish
flow require that owner's account and an idle runner. Automated tests use
synthetic OAuth/MCP responses; they never dispatch a real coding turn.

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
