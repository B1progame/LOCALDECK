# Security notes

- Imports are read locally. Metadata parsing reads JSON and HTML text without evaluating imported scripts.
- ZIP paths are normalized and checked for traversal, duplicates, case collisions, malformed records, unsupported encryption, and resource limits before storage.
- Item writes and removals use IndexedDB transactions; library repair can remove incomplete records and orphaned files.
- Project scripts run only in an opaque-origin sandbox. The app does not pass credentials or a privileged message bridge into that frame.
- Share uploads happen only after an explicit user action. AES-GCM encrypts the ZIP in the browser; the key is only in the fragment, which is not sent in HTTP requests.
- The Worker requires an owner token for upload, listing, and revoke. KV entries use random IDs, expire after 3 days, and are deleted on revocation or scheduled cleanup. D1 does not store project titles, plaintext content, or keys. Free sharing is capped at 24 MiB per share, 512 MiB of active data, and 3 simultaneous uploads.
- Browser storage is not a backup. Anyone with a complete share link can decrypt and keep a downloaded copy; revocation only blocks future downloads.

Report a security issue privately to the repository owner rather than publishing a working exploit.

