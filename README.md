# MarkNest

> **A private, offline-first home for bookmarks and notes.**

MarkNest is a small static web app for keeping bookmarks, notes, categories, and site families in your browser. It is intentionally built without a backend, account system, analytics, or runtime third-party dependencies.

The core promise is simple: **your MarkNest data stays in the browser and is not uploaded by the application.**

This is a privacy-focused personal tool, not a password manager, encrypted vault, or cloud-sync service. Those distinctions matter, especially when software is involved and every `localStorage` call is apparently expected to become a heroic privacy claim.

---

## Features

- 🔖 **Bookmarks** — add, edit, delete, favorite, archive, search, filter, and bulk-manage links.
- 📝 **Notes** — keep lightweight notes alongside your bookmarks.
- 🗂️ **Categories** — create and manage custom categories.
- 🔗 **Site Families** — group related domains under a shared family.
- ✨ **Local site suggestions** — bundled metadata can suggest names and categories without contacting a catalog service.
- 🔎 **Fast search** — search bookmarks and notes locally.
- ⌨️ **Keyboard shortcuts** — optional shortcuts for common actions.
- 📦 **Import / export** — JSON, Netscape HTML, CSV, TSV, TXT, and Markdown.
- 🎨 **Themes** — multiple light and dark themes.
- 📱 **Responsive UI** — desktop and mobile layouts.
- 🧭 **Sidebar index** — quick navigation for all bookmarks, favorites, notes, and categories.
- 📲 **Installable PWA** — supported browsers can install MarkNest as an app.
- 📴 **Offline-first** — bookmark management does not require a server.
- 🌐 **Optional site logos** — favicons can be loaded directly from bookmarked sites when explicitly enabled.

---

## Privacy model

MarkNest has no application backend. The data path is deliberately boring:

```text
┌─────────────────┐
│     MarkNest    │
│   HTML / CSS /  │
│   JavaScript    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Browser storage │
│   localStorage  │
└─────────────────┘
```

The project does **not** require or bundle:

- cloud databases
- authentication services
- API keys or service credentials
- analytics or telemetry
- remote JavaScript libraries
- JavaScript CDNs
- remote fonts
- a remote bookmark/site-catalog API
- a build server or application backend

The site catalog is embedded in `app.js`, so suggestions work without a network connection.

### Optional site logos

The **Load site logos** setting is **off by default**. When enabled, MarkNest may request `https://<bookmark-domain>/favicon.ico` directly from the bookmarked website. This is the one intentional external-network feature.

Enabling logos can reveal to that website that the browser requested its favicon and may reveal the browser's network address to that website. MarkNest does not proxy these requests through a third party.

For strict offline/privacy mode, leave site logos disabled.

---

## Security posture

MarkNest is designed to reduce its attack and data-exposure surface, not to claim that a browser application is invincible.

Current safeguards include:

- same-origin Content Security Policy
- `connect-src 'none'` for the application page
- no third-party runtime scripts
- no application API calls
- no authentication secrets
- no cloud database
- HTML escaping for user-controlled rendered text
- HTTP/HTTPS-only bookmark destinations
- rejection of URLs containing embedded usernames or passwords
- `noopener noreferrer` on external bookmark links
- `no-referrer` on the document and optional favicon requests
- favicon loading restricted to HTTPS `/favicon.ico` URLs
- service-worker caching restricted to known application-shell assets
- local storage schema/version checks
- integrity checksums for stored data
- last-known-good recovery snapshot
- storage quota/error handling
- best-effort persistent-storage request where supported

### What MarkNest does not protect against

`localStorage` is **not encryption**. Data stored there can potentially be inspected by someone with access to the browser profile or developer tools. A malicious script that gains execution in the same origin could also access it.

Do not use MarkNest for:

- passwords
- API tokens
- private keys
- recovery codes
- payment credentials
- highly confidential records

If exposure would cause serious harm, use a purpose-built encrypted application instead.

---

## Local data and durability

MarkNest uses `localStorage` because it is widely available, simple, and keeps the project dependency-free. A reliability layer is built around it.

The storage layer provides:

- schema versioning
- integrity checksums for corruption detection
- a previous-valid-state recovery snapshot
- migration support for older local bookmark data
- storage/quota error handling
- defensive normalization of stored records
- a request for persistent storage when the browser exposes that capability

These measures reduce application-level data-loss risks. They cannot prevent loss caused by clearing site data, deleting a browser profile, private-browsing restrictions, browser/OS failure, storage eviction, or hardware failure.

### Backups are still your responsibility

Use **Export** regularly for important collections. A local-only application intentionally does not provide automatic cloud recovery. That is good for privacy and less convenient for disaster recovery.

---

## Offline behavior

After the application shell has been opened from a suitable origin and cached, MarkNest can manage its local collection without internet access.

The app does not need the network to:

- view bookmarks
- add or edit bookmarks
- manage notes
- search
- manage categories
- manage Site Families
- import/export data
- change themes

Opening a saved bookmark is separate: the destination website may require internet access. MarkNest does not download or proxy the destination page.

The optional site-logo feature is separate and intentionally performs external favicon requests when enabled.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| UI | HTML + CSS |
| Application | Vanilla JavaScript |
| Data | Browser `localStorage` |
| Offline shell | Service Worker |
| Installability | Web App Manifest / PWA |
| Site metadata | Embedded JavaScript data |
| Backend | None |
| Build system | None |
| Runtime dependencies | None |

There is no `npm install`, bundler, framework, database, or environment-variable setup.

---

## Project structure

```text
marknest/
├── index.html      # Application markup and security policy
├── styles.css      # UI, layout, and themes
├── app.js          # Application logic, validation, and local storage
├── sw.js           # Offline application-shell service worker
├── manifest.json   # PWA metadata
├── icon-192.png    # PWA icon
├── icon-512.png    # PWA icon
├── CHANGELOG.md    # Release history
├── SECURITY.md     # Security policy
├── .gitignore      # Repository hygiene
└── README.md       # Project documentation
```

The site catalog is embedded in `app.js` rather than fetched at runtime.

---

## Run locally

For normal browser/PWA behavior, serve the files instead of opening `index.html` with `file://`.

### Python

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

No dependencies need to be installed.

### Static hosting

MarkNest is a static site and can be deployed to a static web host or served from your own web server.

```text
Build command: none
Output directory: repository root
Backend: none
```

Use HTTPS for production deployments because browsers require a secure context for many service-worker/PWA features. `localhost` is treated as a secure development context by browsers.

### Recommended response headers

The app includes a CSP in `index.html` so the project remains protected even on simple static hosting. For production deployments, sending security headers from the web server is stronger. A reasonable starting point is:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; connect-src 'none'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'; media-src 'none'; frame-src 'none'; child-src 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
```

`frame-ancestors` is most reliable as an HTTP response header because browsers do not reliably apply it when delivered through a `<meta>` element.

---

## Import and export

Supported formats:

| Format | Typical use |
| --- | --- |
| JSON | Native MarkNest backup/import format |
| HTML | Chrome/Firefox/Netscape-style bookmark files |
| CSV | Spreadsheet workflows |
| TSV | Tab-separated data |
| TXT | Simple bookmark lists |
| Markdown | Human-readable lists |

Imports are validated and size-limited before records are added. Duplicate URLs can be skipped during import.

---

## Storage compatibility

MarkNest stores data under its own `marknest:` local-storage namespace. The application also contains a migration path for earlier local bookmark data so an upgrade does not unnecessarily strand existing collections.

If you want a clean reset, export your data first, then clear the MarkNest site data in your browser.

---

## Version 1.0.0

The first release is intentionally conservative:

- local-only data storage
- no account system
- no cloud synchronization
- no analytics
- no runtime third-party dependencies
- offline application shell
- import/export support
- optional external favicon loading
- local integrity and recovery safeguards

The project favors understandable code and a small dependency surface over a large framework or service stack.

---

## Known limitations

1. **No automatic sync.** Data belongs to the browser profile where it was created.
2. **No encryption at rest.** `localStorage` is not a secure vault.
3. **Browser storage is finite.** Very large collections may eventually hit browser quota limits.
4. **Backups are manual.** Export files are the recovery mechanism.
5. **PWA support varies.** Browser capabilities differ across platforms.
6. **Favicons are optional network requests.** Turn them off for strict offline mode.
7. **Bookmark destinations are outside MarkNest's trust boundary.** A bookmark can point to a malicious or compromised website; saving a URL does not make the destination safe.

---

## Development principles

Contributions should preserve the project's core properties:

1. **Local by default.** Do not add a backend or telemetry as a convenience.
2. **Explicit network behavior.** Any new network request should be intentional, documented, and user-visible where appropriate.
3. **No secrets in the repository.** Never commit credentials, tokens, private keys, or environment dumps.
4. **Escape untrusted text.** User-controlled values must not become executable HTML.
5. **Keep dependencies minimal.** A small static app is easier to inspect and audit.
6. **Document privacy tradeoffs honestly.** Local does not mean encrypted, and convenience must not become a hidden network request.
7. **Treat imported files and bookmark URLs as untrusted input.**
8. **Preserve import/export compatibility where practical.**

---

## Security reporting

If you find a security issue, please do not publish working exploit details before the issue has been reviewed. Use the repository's private GitHub security-reporting mechanism when it is enabled by the maintainer.

If private reporting is unavailable, use the least-public reporting channel available to the project maintainer.

See [`SECURITY.md`](SECURITY.md) for the project policy.

---

## License

No license is declared in this repository yet. Until a license is added, standard copyright law applies and others should not assume they have permission to redistribute or modify the code.

---

## Philosophy

MarkNest is deliberately small. The goal is not to become a giant productivity platform with an account system, ten integrations, seventeen trackers, and a mysterious dashboard that needs a meeting to explain it.

It is a bookmark and notes tool that works locally, stays understandable, and gives the user control over their data.
