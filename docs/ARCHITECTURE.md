# LOCALDECK architecture

LOCALDECK is a static React and TypeScript app with two independent parts: the on-device library and an optional encrypted transfer service. The normal library has no account, server database, or upload path.

## Browser application

- Vite builds the app under the `/LOCALDECK/` GitHub Pages path and uses hash routes.
- Dexie stores item metadata, file blobs, collections, subjects, usage history, preferences, and import jobs in IndexedDB.
- A versioned service worker caches the app shell and serves item files from IndexedDB at `__localdeck_asset/<item>/<path>`.
- The player and HTML editor preview use an opaque-origin sandboxed iframe. The service worker adds a response-level CSP sandbox before project scripts run, so Safari can route same-origin file requests without exposing the parent app. No privileged bridge is exposed to project scripts.
- The HTML editor updates the selected HTML blob, size, and content hash in one IndexedDB transaction. Edits stay in this browser and flow into exports and share packages.
- Import previews are created before a transaction writes item and assets. Failed writes roll back and leave a failed import record.
- Backups are versioned ZIP archives validated before the restore transaction.

## Optional sharing

When a signed-in user chooses **Create encrypted link**, the browser exports one item to ZIP, encrypts the bytes with a fresh AES-GCM key, and uploads ciphertext with a provider-signed ID token. The Worker verifies Google or Firebase token signatures and claims before every owner action, then scopes list/delete and quotas to that provider's stable subject ID. D1 stores an opaque identifier, owner ID, timestamps, and size; Workers KV stores the encrypted payload for at most 3 days. The decryption key stays after `#` in the application URL. Recipients decrypt and validate the project locally before they choose to import it; they do not need accounts. Per-account storage is capped at 48 MiB, each upload at 24 MiB, uploads at 5/hour and 15/day per account plus 100/day globally, service storage at 512 MiB, and concurrent uploads at 3. Provider accounts are separate even when their verified email addresses match.

## Tradeoffs

The service worker is needed for local multi-file URLs while the iframe has an opaque origin. It is served from the Pages app origin but only returns blobs for a validated item ID and normalized path. Some projects still need a server, cross-origin features, or browser capabilities that this static runtime cannot provide; compatibility reports are estimates, not guarantees.

## Optional local HTML review

AI Studio first inspects HTML with DOMParser, without executing it. An optional browser-native Prompt API enhancement is only offered when the browser exposes that API. It receives a bounded JSON summary and visible text after removing scripts, styles, templates, SVG, and embedded browsing contexts; it never receives raw HTML or runs as a cloud service. The user starts model creation explicitly, and its result is advisory. Browsers without the feature retain the full deterministic local outline and prompt builder.
