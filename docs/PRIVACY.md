# Privacy page and cookies

`#/privacy` (`src/privacyPage.tsx`) says what LocalDeck stores and whom it contacts, in all five languages. It is linked in Settings and on the sign-in page. Change it together with the code.

**Set who is responsible.** GitHub → repository → Settings → Secrets and variables → Actions → Variables:

| Variable | Example |
|---|---|
| `VITE_OPERATOR_NAME` | the name of the person who runs the site |
| `VITE_OPERATOR_CONTACT` | an email address or a web address |

They are public on the page. Without them the page links to the issues of the GitHub project.

**Cookies.** LocalDeck sets none and has no tracking, so it has no cookie banner. The home page contacts its own server and, to count the visit, the Worker. The sign-in page also loads `apis.google.com` and `firebaseapp.com` (Google Firebase), so that the sign-in window opens with one click. A banner becomes necessary when statistics, advertising, embedded videos or similar things are added.

## Counting visitors

`src/services/visit.ts` sends one empty `POST /api/v1/shares/visit` when the published site is opened, and one more when it stays open into a new day. The Worker makes a code from the network address and the browser type with a secret key that changes every day, so nobody counts twice. It keeps the code until the day is over (`visitors`) and the two numbers of the day for 400 days (`visit_days`). Programs, other websites and more than 50 openings a day do not count.

It is a count of devices and connections: a person with a phone and a computer counts twice, people behind the same address with the same browser count once. Visitors per month cannot be counted this way, because the code changes every day. Settings → Count my visit turns it off, and so do Do Not Track and Global Privacy Control.

## Deleting an account

**Deleting an account.** Shared links → Delete account. `DELETE /api/v1/shares/me` removes links, AI connections, counters and the account, a few links per request, then the app deletes the Firebase sign-in. A blocked account keeps only its number.

This is no legal advice. Whether an imprint (Impressum) is needed depends on how the site is used.
