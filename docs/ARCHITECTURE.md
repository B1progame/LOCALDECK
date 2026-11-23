# LOCALDECK architecture

LOCALDECK is a static React and TypeScript app with two independent parts: the on-device library and an optional encrypted transfer service. The normal library has no account, server database, or upload path.

## Browser application

- Vite builds the app under the `/LOCALDECK/` GitHub Pages path and uses hash routes.
- Dexie stores item metadata, file blobs, collections, subjects, usage history, preferences, and import jobs in IndexedDB.
- A versioned service worker caches the app shell and serves item files from IndexedDB at `__localdeck_asset/<item>/<path>`.
- The player uses an opaque-origin sandboxed iframe. No privileged bridge is exposed to project scripts.
- Import previews are created before a transaction writes item and assets. Failed writes roll back and leave a failed import record.
- Backups are versioned ZIP archives validated before the restore transaction.

## Optional sharing

When a signed-in user chooses **Create encrypted link**, the browser exports one item to ZIP, encrypts the bytes with a fresh AES-GCM key, and uploads ciphertext with the Google ID token. The Worker verifies the signature and claims before every owner action, then scopes list/delete and quotas to Google's stable subject ID. D1 stores an opaque identifier, owner ID, timestamps, and size; Workers KV stores the encrypted payload for at most 3 days. The decryption key stays after `#` in the application URL. Recipients decrypt and validate the project locally before they choose to import it; they do not need accounts. Per-account storage is capped at 48 MiB, each upload at 24 MiB, uploads at 5/hour and 15/day per account plus 100/day globally, service storage at 512 MiB, and concurrent uploads at 3.

## Tradeoffs

The service worker is needed for local multi-file URLs while the iframe has an opaque origin. It is served from the Pages app origin but only returns blobs for a validated item ID and normalized path. Some projects still need a server, cross-origin features, or browser capabilities that this static runtime cannot provide; compatibility reports are estimates, not guarantees.
