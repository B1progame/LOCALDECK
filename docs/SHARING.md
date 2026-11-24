# Optional encrypted sharing

Sharing is optional and stays off until you configure the app and Worker. Creating and managing links requires sign-in with Google, verified email/password, GitHub, or Facebook. Microsoft is not offered. GitHub and Facebook users must verify the email address they share with Firebase before they can manage links. A recipient never needs an account: anyone with the complete link can open it until its three-day expiry or until the owner deletes it.

## Limits and privacy

- Maximum 24 MiB per encrypted upload.
- Maximum 48 MiB of active shares per account and 512 MiB across the whole service.
- Maximum 3 uploads in progress globally and 3 per account.
- Maximum 5 upload attempts per account per hour, 15 per account per UTC day, and 100 upload attempts globally per UTC day.
- Maximum 50 active links shown per account. Links expire after 3 days and owners can delete them sooner.
- A client IP is limited to 40 authentication attempts and 120 share reads per hour. IP addresses are hashed before rate-limit records are stored.

The browser encrypts each ZIP with AES-GCM before upload. Cloudflare stores ciphertext, an opaque random ID, owner ID, byte count, and timestamps; it never receives project names, plaintext project files, or the decryption key. The key stays after `#` in the link. The browser that created a link also keeps it locally (IndexedDB, never in backups) so the owner can show it again under **Shared links**; the record is removed when the link expires or is deleted. On another device the link cannot be shown, because the server does not know the key. Deleting a share immediately removes its D1 record and requests deletion of its KV object, so future downloads stop; recipients may keep a copy they downloaded earlier.

Google sign-in uses only the standard identity scopes (email, profile, openid). The Google web client ID is public configuration and is embedded in the app build by design. There is no Google API key or OAuth client secret in the app. The Worker independently verifies the ID token signature, issuer, audience, expiry, and verified email against Google's rotating public keys before every owner action. The token is held in this tab's session storage and expires with Google's one-hour credential. No owner password or shared bearer token is stored in the repository.

Email/password sign-in is an optional Firebase Authentication provider. Passwords are sent directly to Firebase over HTTPS and are never sent to the Cloudflare Worker or stored by LOCALDECK. The Worker checks Firebase's signed ID token, project audience, issuer, expiry, and `email_verified` claim for every owner action. Email sign-up requires confirmation; password-reset messages use Firebase's sender. No custom domain or mail server is required. Google and Firebase email logins have separate share accounts, even if they use the same email address; sign-in methods are not silently linked.

GitHub and Facebook use Firebase's browser SDK and Firebase's OAuth redirect handler. Their OAuth client secrets are entered only into the Firebase provider settings; never place them in GitHub Actions variables, the frontend, or the Worker. Firebase treats GitHub and Facebook email claims as untrusted, so LOCALDECK explicitly sends a Firebase email-verification message and the Worker rejects the account until the token says `email_verified: true`. Google sign-in is handled directly by Google Identity Services. Microsoft sign-in is intentionally omitted.

The Firebase Web API key, Project ID, and Web App ID are public project configuration, not secrets or authorization credentials. Restrict the API key to Firebase Authentication / Identity Toolkit and review quotas. Do not enable unrelated paid Google APIs, enable Firebase Authentication with Identity Platform, or attach a billing account for this feature. Firebase Spark includes social sign-in at no cost; free-plan usage limits can stop sign-in or email delivery until they reset. Check Google's current [Spark pricing and limits](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) before enabling additional products.

The Worker is designed for Cloudflare's free plan: 512 MiB active storage is below the included 1 GB KV storage limit, and the 24 MiB object maximum is below KV's 25 MiB value limit. KV includes 1,000 writes and 1,000 deletes per day, and Workers Free includes 100,000 requests per day; Cloudflare documents that free-plan KV operations fail after a quota is reached and the Workers request limit rejects additional requests. Service limits are a backstop, not a billing setting. Keep the account on Workers Free and do not enable R2, Workers Paid, or other paid storage. The account owner should also review their Cloudflare plan and billing settings directly.

## Set up Google sign-in (free)

1. Open [Google Auth Platform](https://console.cloud.google.com/auth/clients) and choose or create a project.
2. Configure the app branding and support email. For audience, choose **External** if people outside your organization should sign in. A project left in testing mode only allows the test users you list.
3. Create an OAuth client with application type **Web application**.
4. Add this exact deployed origin under **Authorized JavaScript origins**: `https://b1progame.github.io`. Do not add a redirect URI; this integration uses the Google Identity Services popup callback.
5. Copy the OAuth **Client ID** ending in `.apps.googleusercontent.com`. Do not create an API key or client secret for this feature. Sign-in uses Google's public identity script and default identity scopes; the project does not need an enabled Google data API.

Google's [client ID setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) covers the current console fields. Google's [server verification guide](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) explains why the Worker validates the signature and audience rather than trusting profile data sent by the browser.

## Set up Firebase sign-in (free, no custom domain)

1. Create a Firebase project and keep it on the **Spark (no-cost)** plan. Do not add a billing account or enable unrelated products.
2. In **Authentication → Sign-in method**, enable **Google** and **Email/Password**. Keep email verification enabled; choose a password policy of at least 12 characters.
3. In **Authentication → Settings → Authorized domains**, add `b1progame.github.io`. This is the app host you already use, not a domain you need to buy or own.
4. In **Project settings → General**, copy the Firebase **Project ID** and the web app's **Web API key**. The key is public Firebase config, not a password. In Google Cloud **APIs & Services → Credentials**, restrict it to Firebase Authentication / Identity Toolkit. Keep quotas small and do not allow unrelated paid APIs.
5. In the `B1progame/LOCALDECK` repository, open **Settings → Secrets and variables → Actions → Variables** and add these three variables from Firebase: `VITE_FIREBASE_API_KEY` (Web API key), `VITE_FIREBASE_PROJECT_ID` (`login-localdeck`), and `VITE_FIREBASE_APP_ID` (the Web App ID beginning `1:175953444466:web:`). These are public web-app settings, not passwords. The API key is intended to appear in a browser build; restrict it to Firebase Authentication / Identity Toolkit and set a small quota.
6. In Cloudflare, open the `localdeck-share` Worker settings and add a plain-text variable named `FIREBASE_PROJECT_ID` with that project ID. The project ID is not a secret. Do not put a service-account key, password, private API key, or Cloudflare token in the Pages variables.
7. Deploy the Worker from `cloudflare/` with `npx wrangler deploy`, then run the Pages workflow on `main` so it builds with the Firebase variables. The Google sign-in button uses Firebase's Google provider; you do not need a separate Google OAuth client ID for that button. Keep `VITE_GOOGLE_CLIENT_ID` only if you want the older direct Google sign-in option instead.

Firebase Authentication sends verification and password-reset messages from its managed sender; you do not need to set up SMTP, buy a domain, or publish your own mail server. Keep the project on Spark and check its current quotas before enabling more services. Google's Firebase [email/password guide](https://firebase.google.com/docs/auth/web/password-auth) and [free-plan limits](https://firebase.google.com/docs/auth/limits) document the current behavior.

## Set up GitHub sign-in (free)

GitHub sign-in is exchanged through Firebase, so the GitHub OAuth secret stays in the Firebase console. Email verification is required because Firebase does not treat GitHub's email claim as verified by itself.

1. Finish the Firebase project, web app, and authorized-domain steps from the email setup above. Keep the project on Spark.
2. In GitHub, open your profile menu → **Settings → Developer settings → OAuth Apps → New OAuth App**.
3. Enter `LOCALDECK` for the application name, `https://b1progame.github.io/LOCALDECK/` as the homepage URL, and a placeholder callback URL for the initial save if GitHub requires one.
4. In Firebase, open **Authentication → Sign-in method → Add new provider → GitHub**. Enable it. Firebase shows its OAuth callback URL; copy it.
5. Return to GitHub's OAuth App settings and set **Authorization callback URL** to the exact Firebase callback URL, normally `https://<PROJECT_ID>.firebaseapp.com/__/auth/handler`. Save.
6. Copy GitHub's **Client ID** and create a **Client secret**. In Firebase's GitHub provider settings, paste both values and save. Keep the client secret in Firebase only; never put it in this repository or GitHub Actions.
7. In the Firebase **Project settings → General → Your apps** web app card, copy its **Project ID** and **App ID**.
8. In `B1progame/LOCALDECK` → **Settings → Secrets and variables → Actions → Variables**, add `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, and `VITE_FIREBASE_GITHUB_ENABLED` with the text `true`. The existing `VITE_FIREBASE_API_KEY` is also needed. These are public app settings, not secrets.
9. Add `b1progame.github.io` to Firebase **Authentication → Settings → Authorized domains** if it is not already listed.
10. Run the Pages workflow on `main`. On the Shared links page, choose **Continue with GitHub**. The first time, LOCALDECK sends a verification email; click it, return to LOCALDECK, and choose GitHub again.

The Firebase [GitHub sign-in guide](https://firebase.google.com/docs/auth/web/github-auth) shows the provider setup and callback URL. GitHub sign-in does not ask for repository access: LOCALDECK requests only the email scope it needs to verify the account. If Firebase says the email already belongs to another sign-in method, use the original method; accounts are not silently merged.

## Set up Facebook sign-in (free, optional)

Facebook is an optional social login. It requires a Meta developer app and may require Meta's app review and privacy details before people outside the app's testers can use it. Skip this provider if you want the least setup; Google, GitHub, and email are enough.

1. Create a Facebook developer app at [Meta for Developers](https://developers.facebook.com/) and add the **Facebook Login** product.
2. In Firebase, open **Authentication → Sign-in method → Add new provider → Facebook**. Enable it and copy Firebase's OAuth callback URL.
3. In the Meta app's **Facebook Login → Settings**, add that exact URL under **Valid OAuth Redirect URIs**.
4. Copy the Meta **App ID** and **App Secret** into Firebase's Facebook provider settings. Keep the App Secret in Firebase only.
5. Add `b1progame.github.io` to the Firebase authorized domains if needed. Set the Meta app to the mode/status required for your intended users.
6. In GitHub Actions **Variables**, add `VITE_FIREBASE_FACEBOOK_ENABLED` with the text `true`. Keep `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID` set. If you skip Facebook, leave this variable unset so the button stays hidden.
7. Run the Pages workflow on `main`. Facebook users must confirm their email before LOCALDECK accepts their sign-in.

See Firebase's [Facebook Login guide](https://firebase.google.com/docs/auth/web/facebook-login) for its current console labels. LOCALDECK asks only for the email permission and does not call the Facebook API for profile data.

## Set up Cloudflare (Workers Free)

Run Wrangler commands from `cloudflare/`. Sign in with `npx wrangler login` if requested. Keep the account on **Workers Free**.

If the KV namespaces do not already exist, create a production and preview namespace:

```powershell
npx wrangler kv namespace create SHARES_KV
npx wrangler kv namespace create SHARES_KV --preview
```

Copy the returned namespace IDs into `wrangler.toml` as `id` and `preview_id`. The D1 database configured in `wrangler.toml` is `localdeck-shares`; create it only if it does not already exist:

```powershell
npx wrangler d1 create localdeck-shares
```

Update `database_id` with the returned ID. For a **new empty database**, initialize it with the current schema:

```powershell
npx wrangler d1 execute localdeck-shares --remote --file schema.sql
```

For a database that already has the original token-based R2 schema, first inspect old rows and remove their objects from the old R2 bucket while its binding still exists. Get the keys with:

```powershell
npx wrangler d1 execute localdeck-shares --remote --command "SELECT id, object_key, size_bytes, expires_at FROM shares;"
```

Delete each listed object individually with `npx wrangler r2 object delete localdeck-shares/<object_key>`. Do not delete the entire bucket if it contains anything else. This old R2 storage may be billable, so check the Cloudflare dashboard and remove legacy objects before relying on the free KV setup. Then apply the one-time database upgrade:

```powershell
npx wrangler d1 execute localdeck-shares --remote --file migrations/0002_google_owner_auth.sql
```

The upgrade moves old metadata into a `legacy_shares` table and creates the new Google-owned tables. Old links cannot be assigned safely to Google accounts and stop working with the new Worker. The migration keeps the object keys until you confirm the old R2 objects are deleted; then remove those metadata rows with `npx wrangler d1 execute localdeck-shares --remote --command "DROP TABLE legacy_shares;"`. Do not run the upgrade against a new database initialized with `schema.sql`.

Set the Google client ID as a Worker secret (this keeps server configuration out of source control; it is still a public identifier, not a private OAuth secret):

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
```

Paste the `.apps.googleusercontent.com` client ID at Wrangler's prompt. Keep `ALLOWED_ORIGIN` in `wrangler.toml` set to the exact deployed website origin. Then deploy:

```powershell
npx wrangler deploy
```

## Configure GitHub Pages

In the `B1progame/LOCALDECK` repository, open **Settings → Secrets and variables → Actions → Variables** and add:

- `VITE_SHARE_API_BASE`: the Worker origin printed by Wrangler, for example `https://localdeck-share.<your-account>.workers.dev`.
- `VITE_GOOGLE_CLIENT_ID`: the same public Google web client ID you set on the Worker.
- `VITE_FIREBASE_API_KEY`: the Firebase Web API key for email, GitHub, or Facebook sign-in.
- `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`: the public Firebase web app values needed for GitHub and Facebook sign-in.
- Set `VITE_FIREBASE_GITHUB_ENABLED` to `true` only after GitHub is enabled in Firebase. Set `VITE_FIREBASE_FACEBOOK_ENABLED` to `true` only after Facebook is enabled in Firebase. Leave either variable empty to keep that button hidden.

Run the Pages workflow after saving the variables. `VITE_GOOGLE_CLIENT_ID` will be visible in the built JavaScript because OAuth web client IDs are public by design. Never put a Google client secret, Cloudflare API token, or unrelated API key in a `VITE_` variable. None is needed for this feature.

## Operational notes

- Cloudflare Free quotas are shared with other Workers/KV use on the account. When platform free limits are reached, sharing can temporarily stop working until the quota resets; this app does not enable paid services.
- Google and Firebase social sign-in require the app to be hosted on HTTPS, except localhost during development.
- Share creation, listing, and deletion require an account. Opening a valid share link does not: the Worker exposes only that link's encrypted payload and expiry metadata to anyone who has its random URL. Recipients never need to register.
- If you later change storage providers or raise any caps, re-check the free plan's current limits and deploy new server-side enforcement before changing the UI limits.
