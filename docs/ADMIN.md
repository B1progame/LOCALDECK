# Admin page

`#/admin`, visible to the Google accounts in the Worker secret `ADMIN_EMAILS` (setup: [`EMAIL_SETUP.md`](EMAIL_SETUP.md#admin-account)). The Worker checks the rights on every request.

| Tab | What it does |
|---|---|
| Overview | Accounts, active links, storage, uploads of today, and 30 days of uploads, downloads, sign-ins and data |
| Accounts | First and last sign-in, uploads, downloads, storage. Own limits, block, delete all links |
| Links | All active links with owner, size, downloads and expiry. Delete any link |
| Limits | Size per link, storage, uploads per hour and day, and days online, for everyone and for admins. Total storage. Pause uploads. Allow or stop AI connections ([`AI_CONNECTION.md`](AI_CONNECTION.md)) |
| History | The last 30 changes made by admins |

## What limits can be

| Limit | Range | Why |
|---|---|---|
| Size per link | 1 to 80 MiB | Over 24 MiB the app uploads parts of 20 MiB, because a KV value holds 25 MiB. The app itself imports ZIPs up to 80 MB |
| Storage, per account and total | up to 900 MiB | The free KV plan holds 1 GB |
| Uploads of the whole service | up to 800 a day | The free KV plan allows 1,000 writes a day |
| Days online | 1 to 30 | |
| AI changes per day | 0 to 1,000 | 0 switches AI off for that account |
| AI projects online | 1 to 180 days after the last change | Stored in D1, not in KV |

A change applies to the next upload. Links that already exist keep their expiry.

## Data that is stored

The Worker keeps the name, email address, sign-in method, times and counters of every account that signs in, so the admin can see them. The sign-in page says so. Accounts that have not signed in for 180 days and have no links are deleted. Project names and contents are never known to the server. Counting starts when this version of the Worker is deployed; older sign-ins and downloads are not known.
