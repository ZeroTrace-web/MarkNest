# Changelog

## 1.1.1 — Brutal reliability and control fixes

- Restored wiring for the main bookmark import/export controls and Site Families manager controls.
- Added import-mode controls, cancel/confirm behavior, backdrop closing, Escape handling, and focus trapping for the import dialog.
- Added Site Families backdrop closing, Escape handling, focus trapping, and delegated edit/delete controls.
- Made local mutations restore the previous storage snapshot when a multi-step action fails, avoiding partially applied changes.
- Serialized effective local mutations by reading the latest snapshot at operation time, preventing concurrent writes from overwriting each other.
- Made the first successful local write create an initial recovery snapshot.
- Changed unrecoverable storage corruption from silent reset to an explicit load error, protecting against apparent data loss.
- Persisted the selected export format in MarkNest settings.

## 1.1.0 — Lumamark parity update

- Ported the newer responsive sidebar and persistent sidebar index, including bookmark, note, favorite, and category navigation.
- Added favorites-only filtering to the bookmark view.
- Added bookmark/note type badges and favorite/pinned badges.
- Improved favicon handling with safer domain checks and load-error fallback behavior while keeping MarkNest’s direct-site, opt-in logo policy.
- Ported the newer visual/layout refinements used by LumaMark, including responsive mobile navigation and modal scrolling/focus improvements.
- Preserved MarkNest’s local-only storage adapter, offline behavior, and `connect-src 'none'` CSP.

## 1.0.0 — First release

- Initial public MarkNest release.
- Local-only bookmark, notes, categories, and Site Families storage.
- Offline-capable PWA shell.
- JSON, HTML, CSV, TSV, TXT, and Markdown import/export.
- Local site catalog for bookmark suggestions.
- Optional HTTPS favicon loading, disabled by default.
- Storage integrity checks, recovery snapshot, migration, and quota handling.
- Security-focused CSP and safe rendering of user-controlled values.
