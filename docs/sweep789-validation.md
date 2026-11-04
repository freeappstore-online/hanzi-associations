# Issues 7–9: bug and refactor sweep

Implementation base: `ff45b50bd34f6dd212408367ea1a93246a4953a4`.
Remote coder implementation: `b1e505218a63ce345530e67d72ab39816ae3c4b1`.

## Repairs

- **#9:** mutation-based draft merging against current durable state, Web Locks serialization, cross-tab synchronization, delayed import safety, exportable unsaved drafts, persistent failed-write warnings, and safe browser storage getters. Same-ID conflicts use newest `updatedAt`; ties retain the stored copy. Without Web Locks concurrent writes remain best effort.
- **#8:** a lazy, versioned CacheStorage dictionary snapshot, validated with SHA-256 and entry count before use. Corrupt cache is rejected and recovered online. Worker retry recreates a crashed worker. Empty normalized pinyin no longer matches every library card. Removed the unused public/local overlay helper.
- **#7:** error-only speech feedback, guarded browser speech APIs, cancellation on Word identity changes, and explicit mobile action icons. Normal playback still adds no label or layout shift.
- **SDK startup:** full browser QA discovered that SDK 0.16.6 Logger resolves the localStorage getter outside its catch. Yi carries a pinned pnpm dependency patch guarding reads, writes and clear. Upstream release tracking: [platform #341](https://github.com/freeappstore-online/platform/issues/341). No auth-storage shim is installed.

## Verification history

The remote implementation runner passed 69 unit tests and association validation. Its build was interrupted before PWA completion during handoff; that aggregate run is not counted as passing.

Root's first production build, PWA generation and styling checks passed. The full 84-case mobile/desktop browser run passed 79 and exposed five failures: the SDK startup bug in both layouts, an overly strict numeric-filter assertion in both layouts, and a speech test that checked cancellation before asynchronous saving closed the editor. The filter correctly retains the chair definition's literal `zhang1` match; its regression now checks that one card remains. The speech test waits for editor closure and cancellation.

The pinned SDK patch has a unit regression covering startup, logging and clear with a throwing localStorage getter. Browser regression coverage includes blocked session/local storage; corrupt/read/write failures and export retention; simultaneous tabs and same-ID stale saves; delayed imports; storage events after quota failures; oversized combined imports; actual service-worker offline reload after HTTP cache eviction; corrupt cache recovery; worker restart; numeric filtering; and in-place speech cleanup.

Speech tests use mocks and do not prove audible pronunciation on a physical phone. First dictionary download requires a connection; browser data eviction or denied CacheStorage removes offline availability. Public publication proof still uses fresh network requests. All six existing image files and association metadata remain unchanged.

## Final local checks

- `pnpm test`: **70 unit tests**, six-association validation, TypeScript/build/PWA generation, and **2 styling tests** passed.
- `pnpm test:browser tests/browser/sweep.spec.ts tests/browser/reading.spec.ts --workers=2`: **36 passed**, rerunning every affected/previously failing case on mobile and desktop. Unaffected connection/publication cases passed in the initial full run; they were not repeated after the narrow SDK logger patch.
- Independent Playwright smoke: blocked sessionStorage with real dictionary lookup; genuinely simultaneous draft creation and editing in two tabs followed by reload; and offline dictionary lookup after ordinary HTTP-cache eviction all passed.
- `fas check`: all hard checks passed. Two existing advisory warnings remain: the intentionally lazy dictionary/NOTICE are outside the SW precache glob, and the repo's platform-guide pointer format.
- `git diff --check` passed. The association directory is byte-identical to the implementation base.

Deployment and live verification are recorded on issues [#7](https://github.com/freeappstore-online/hanzi-associations/issues/7), [#8](https://github.com/freeappstore-online/hanzi-associations/issues/8), and [#9](https://github.com/freeappstore-online/hanzi-associations/issues/9).
