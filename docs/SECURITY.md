# Security notes

- Imports are read locally. Metadata parsing reads JSON and HTML text without evaluating imported scripts.
- ZIP paths are normalized and checked for traversal, duplicates, case collisions, malformed records, unsupported encryption, and resource limits before storage.
- Item writes and removals use IndexedDB transactions; library repair can remove incomplete records and orphaned files.
- Project scripts run only in an opaque-origin sandbox. The player iframe permits same-origin routing so Safari can reach saved files through the service worker; the service worker adds a response-level CSP `sandbox` before the HTML document executes. The app does not pass credentials or a privileged message bridge into that frame.
- The in-app HTML editor changes only the selected local IndexedDB file and updates the item size/hash transactionally. Saving does not publish code or change a file on the user's computer; previews continue to run in the isolated player.
- Share uploads happen only after an explicit user action. AES-GCM encrypts the ZIP in the browser; the key is only in the fragment, which is not sent in HTTP requests.
- The Worker verifies Google ID token signatures and checks issuer, audience, expiry, and verified email before upload, listing, or deletion. Shares are owned by Google's stable subject ID. Per-account active storage is capped at 48 MiB; each upload is capped at 24 MiB; uploads are limited to 5 per hour and 15 per day per account, and 100 per day globally. Total active data is capped at 512 MiB, with 3 simultaneous uploads. Client IP hashes limit authentication attempts and downloads.
- KV entries use random IDs and a fixed 3-day TTL. Owners can permanently delete share metadata and the KV object; scheduled cleanup removes expired records and releases quota. D1 does not store project titles, plaintext content, or decryption keys. The Google web client ID is public configuration; no API key, client secret, or Cloudflare token is included in the frontend.
- Browser storage is not a backup. Anyone with a complete share link can decrypt and keep a downloaded copy; revocation only blocks future downloads.

Report a security issue privately to the repository owner rather than publishing a working exploit.
