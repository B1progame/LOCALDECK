# Security notes

- Imports are read locally. Metadata parsing reads JSON and HTML text without evaluating imported scripts.
- ZIP paths are normalized and checked for traversal, duplicates, case collisions, malformed records, unsupported encryption, and resource limits before storage.
- Item writes and removals use IndexedDB transactions; library repair can remove incomplete records and orphaned files.
- Project scripts run only in an opaque-origin sandbox. The player iframe permits same-origin routing so Safari can reach saved files through the service worker; the service worker adds a response-level CSP `sandbox` before the HTML document executes. The app does not pass credentials or a privileged message bridge into that frame.
- The in-app HTML editor changes only the selected local IndexedDB file and updates the item size/hash transactionally. Saving does not publish code or change a file on the user's computer; previews continue to run in the isolated player.
- Share uploads happen only after an explicit user action. AES-GCM encrypts the ZIP in the browser; the key is only in the fragment, which is not sent in HTTP requests.
- The Worker verifies Google or Firebase ID token signatures and checks issuer, audience, expiry, and verified email before upload, listing, or deletion. Firebase email, GitHub, and Facebook accounts must have verified email claims; the GitHub/Facebook sign-in flow sends Firebase's verification message before permitting link management. Accounts use stable provider subject IDs, and the app does not silently link accounts with matching email addresses. Passwords are sent only to Firebase Authentication over HTTPS and are never stored by LOCALDECK or accepted by the Worker. Per-account active storage is capped at 100 MiB; each upload is capped at 24 MiB; uploads are limited to 5 per hour and 15 per day per account, and 100 per day globally. Total active data is capped at 1,200 MiB, with 3 simultaneous uploads. Client IP hashes limit authentication attempts and downloads.
- KV entries use random IDs and a fixed 3-day TTL. Owners can permanently delete share metadata and the KV object; scheduled cleanup removes expired records and releases quota. D1 does not store project titles, plaintext content, or decryption keys. The Google web client ID is public configuration; no API key, client secret, or Cloudflare token is included in the frontend.
- Browser storage is not a backup. Anyone with a complete share link can decrypt and keep a downloaded copy; revocation only blocks future downloads.

Report a security issue privately to the repository owner rather than publishing a working exploit.

- AI Studio's structural inspection always parses HTML locally without executing scripts. Its optional browser-native AI uses only a bounded summary with script/style/template/SVG and embedded browsing contexts removed; there is no cloud AI fallback or API key. Treat model output as advisory. The native model is created only after the user clicks the scan button and may download browser-managed model data to the device.
- The PDF-to-project helper does not read or upload the selected PDF. It inserts only the filename into a prompt for the user to copy to an external AI chat. That AI provider receives the PDF only if the user attaches it there; provider availability, limits, and costs are outside LOCALDECK.
- Firebase's Web API key is public project configuration and is used only for Firebase Authentication endpoints. It provides no Worker or Google Cloud privileges. Restrict it to Firebase-related APIs and never expose service-account credentials or unrelated private API keys.

## Review of 25 November 2026

Done with the checklists of Cloudflare's [security-audit skill](https://github.com/cloudflare/security-audit-skill) (commit `c1c8a8c`, guidance mode, no independent second reviewer): browser, sign-in, HTTP, data isolation, availability, cloud settings, supply chain, AI. Only source code and local tests, nothing was tried against the live service.

| Finding | Fixed by |
|---|---|
| A project could open another website in its own frame and take data along, although projects have no internet | `frame-src` in `index.html` |
| Another website could show LocalDeck in a frame and place its own buttons over it | LocalDeck does not start in a frame |
| Stored codes of IP addresses could be found again by trying all addresses | HMAC with a secret that is not in the database, new every day |
| One IPv6 connection has many addresses and got around the limits | the limit counts the network (/64) |
| Many people behind one address (a school) shared one limit for valid sign-ins | valid sign-ins count per account |
| A made-up key number made the Worker ask Google for keys every time | at most five times a minute |
| Eight unfinished uploads stopped uploads for everyone | 30, still three per account |

Checked and fine: token checks (signature, project, lifetime, confirmed address), admin rights, SQL parameters, ownership of links, projects and AI connections, encryption, the service worker, output of project and AI texts, packages (`npm audit`), rights of the GitHub workflow.

Not visible in the code, please check once: in Google Cloud the Firebase web key should be limited to the address of the site, and Cloudflare, Google and GitHub should have two-step sign-in.

The sign-in is kept in the browser and renewed every hour (`src/services/session.ts`). "Stay signed in" can be turned off on the sign-in page, then it ends with the tab. Other GitHub Pages of the same account share the browser storage, because they have the same address. A domain of its own would separate them.

## Second review of 25 November 2026

Same skill and way of working: source code and local tests only, nothing was tried against the live service. Read again: the whole Worker, sign-in, sessions, admin, MCP, the parts that read imported or shared projects, the new local AI and the GitHub workflow.

| Finding | How bad | Fixed by |
|---|---|---|
| A shared link could be made so that opening it froze the page of the person (a 128 KB file took 15 seconds, larger ones never ended) | Medium | Limited search patterns in `src/services/importer.ts`, `contentCheck.ts` and `projectPhoto.ts` |
| A person with an AI connection could make a small edit blow a project up to more than the memory of the Worker, which also ends other requests | Medium | The size is calculated before the text is built, at most 5,000 replacements |
| Requests above a limit were refused but still counted in the database. The free plan has a number of writes a day for everyone, so one connection could have used them up | Medium | Above the limit nothing is written any more |
| The check of AI projects could be made slow the same way (seconds of computing time) | Low | Limited search patterns, at most 60 problems are looked up |
| A blocked account could finish an upload that it had started before | Low | Blocked accounts are checked for every part |
| The admin page could be opened by everyone. It was empty and the Worker refused, but it and its code were there | Low | Only admins load it, for everyone else the address leads to the start page and the Worker answers 404 |
| The build in GitHub had the rights that only publishing needs | Low | Rights per job |

Checked and fine: token checks, admin rights on every request, ownership of links, parts, projects and connections, SQL parameters, CORS, the mail relay, the local test admin (this computer only, not in the published site), the service worker, the text that goes to the small AI and what comes back, packages (`npm audit`: 0), no secrets in the repository or its history.

Known and accepted: the free plan has 100,000 requests a day, so someone can still use those up. The number of visitors can be faked. A sign-in is valid for up to an hour after an account was disabled in Firebase. The small model is loaded from a fixed version, its files are not checked again with a checksum.
