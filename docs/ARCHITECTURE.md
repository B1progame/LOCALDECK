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

When the user explicitly chooses Create encrypted link, the browser exports one item to ZIP, encrypts it with a fresh AES-GCM key, and uploads ciphertext to the Worker. D1 stores only an opaque identifier, object key, status, timestamps, and size. The decryption key stays after the `#` in the application URL. Recipients decrypt and validate the project locally before they choose to import it.

## Tradeoffs

The service worker is needed for local multi-file URLs while the iframe has an opaque origin. It is served from the Pages app origin but only returns blobs for a validated item ID and normalized path. Some projects still need a server, cross-origin features, or browser capabilities that this static runtime cannot provide; compatibility reports are estimates, not guarantees.
