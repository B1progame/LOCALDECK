# Privacy page and cookies

`#/privacy` (`src/privacyPage.tsx`) says what LocalDeck stores and whom it contacts, in all five languages. It is linked in Settings and on the sign-in page. Change it together with the code.

**Set who is responsible.** GitHub → repository → Settings → Secrets and variables → Actions → Variables:

| Variable | Example |
|---|---|
| `VITE_OPERATOR_NAME` | the name of the person who runs the site |
| `VITE_OPERATOR_CONTACT` | an email address or a web address |

They are public on the page. Without them the page links to the issues of the GitHub project.

**Cookies.** LocalDeck sets none and has no tracking, so it has no cookie banner. Checked on the live site: the home page contacts only its own server, the sign-in page also loads `apis.google.com` and `firebaseapp.com` (Google Firebase), so that the sign-in window opens with one click. A banner becomes necessary when statistics, advertising, embedded videos or similar things are added.

**Deleting an account.** Shared links → Delete account. `DELETE /api/v1/shares/me` removes links, AI connections, counters and the account, a few links per request, then the app deletes the Firebase sign-in. A blocked account keeps only its number.

This is no legal advice. Whether an imprint (Impressum) is needed depends on how the site is used.
