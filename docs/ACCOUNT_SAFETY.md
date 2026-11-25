# Safety of the accounts behind the site

## Limits for signing in

| Where | Limit |
|---|---|
| Firebase | Blocks an account for a while after many wrong passwords |
| Worker | 30 refused sign-ins per hour and connection, 40 real ones per account, 240 tries in total per connection |
| This browser | After four wrong passwords 30 seconds, doubling up to 15 minutes. One reset or sign-in email per minute |

The browser limit can be avoided by a program that talks to Firebase directly. Firebase's own limit and the key restriction below are the real ones.

## Limit the Firebase web key

The key is public by design. The restriction keeps other websites from using it.

1. Open https://console.cloud.google.com/apis/credentials?project=login-localdeck
2. Under **API keys** open the key of the web app (usually "Browser key (auto created by Firebase)").
3. **Application restrictions** → **Websites** → add:
   - `https://b1progame.github.io/*`
   - `https://login-localdeck.firebaseapp.com/*`
   - `https://login-localdeck.web.app/*`
   - `http://localhost:5468/*`
4. **API restrictions** → **Restrict key** → choose **Identity Toolkit API** and **Token Service API**. Without the second one people are signed out after an hour.
5. **Save**, wait five minutes, then sign in once with Google and once with email. If something fails, set both restrictions back to "None".

## Two-step sign-in

- **Google:** https://myaccount.google.com/signinoptions/twosv → turn on, use a passkey or an authenticator app.
- **GitHub:** https://github.com/settings/security → Two-factor authentication → Enable, save the recovery codes.
- **Cloudflare:** https://dash.cloudflare.com/profile/authentication → Two-Factor Authentication → Add, save the backup codes.
