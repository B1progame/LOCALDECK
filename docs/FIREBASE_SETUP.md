# Firebase setup for LocalDeck (complete guide)

Firebase is used for one thing only: **signing in to create and manage share links**. The library, your projects and your profile never touch Firebase. Everything below happens in the [Firebase console](https://console.firebase.google.com/) for the project **LocalDeck** (`login-localdeck`), except Part 7, which is in the Google Cloud console.

Status key: ✅ already done (checked on 23 Nov 2026) · ⬜ still to do · ➖ optional

---

## Part 1. Project settings ✅

⚙️ **Settings (gear) → Project settings → General**

| Setting | Value | Status |
|---|---|---|
| Project name | `LocalDeck` | ✅ |
| Public-facing name | `LocalDeck` (shown in emails as `%APP_NAME%` and on the Google sign-in popup) | ✅ |
| Support email | your address (shown on the Google consent screen) | ✅ |
| Environment type | leave **Unspecified** | ✅ |

Scroll to **Your apps → Web apps**. The values there must match the GitHub Actions variables of the repository (**Settings → Secrets and variables → Actions → Variables**):

| Firebase field | GitHub variable | Status |
|---|---|---|
| `apiKey` | `VITE_FIREBASE_API_KEY` | ✅ |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` = `login-localdeck` | ✅ |
| `appId` | `VITE_FIREBASE_APP_ID` | ✅ |

These are public web-app values, not secrets. If you ever change them, push any commit (or re-run the **Build and deploy LOCALDECK** workflow) so the site is rebuilt with the new values.

---

## Part 2. Sign-in providers

**Build → Authentication → Sign-in method**

### 2a. Email/Password ✅ + Email link ⬜
1. Click **Email/Password**.
2. **Email/Password**: on ✅
3. **Email link (passwordless sign-in)**: turn **on** ⬜. This powers “Email me a sign-in link instead”.
4. **Save**.

### 2b. Google ✅
1. Click **Google**. It should say **Enabled**.
2. **Project support email**: your address.
3. **Save**.

### 2c. Other providers ➖
Microsoft, Apple, GitHub, X/Twitter, Yahoo and Facebook each need an app registered at that company and its keys pasted into Firebase (Apple also needs a paid developer account). Phone sign-in needs the paid Blaze plan. **Anonymous** must stay **off**: share accounts need a confirmed email. You don't need any of these; Google, email + password and the email link cover everyone for free.

If you ever enable GitHub or Facebook, also add the GitHub Actions variable `VITE_FIREBASE_GITHUB_ENABLED=true` (or `VITE_FIREBASE_FACEBOOK_ENABLED=true`) so the button appears.

---

## Part 3. Authentication settings

**Authentication → Settings** (tab at the top)

### 3a. Authorized domains ✅
Must contain:
- `localhost` (for testing on your computer)
- `b1progame.github.io` (the live site)
- `login-localdeck.firebaseapp.com` and `login-localdeck.web.app` (added automatically)

Without `b1progame.github.io`, the Google popup and the email links are refused with “unauthorized domain”.

### 3b. Password policy ⬜
**Password policy → Edit** (or ✏️):

| Setting | Choose |
|---|---|
| Enforcement mode | **Require enforcement** |
| Require uppercase character | ✔ |
| Require lowercase character | ✔ |
| Require special character | ✔ |
| Require numeric character | ✘ (leave off, the app doesn't ask for a number) |
| Force upgrade on sign-in | ✘ (leave off, so older accounts can still sign in) |
| Minimum password length | **12** |
| Maximum password length | `4096` (leave) |

**Save.** The app shows the same four rules as a live checklist.

### 3c. User actions ➖
- **Enable create (sign-up)**: keep **on** (otherwise nobody can create an account).
- **Enable delete**: your choice. It lets users delete their own account through the API. LocalDeck has no delete-account button yet, so it changes nothing visible.

### 3d. Email enumeration protection ➖ (recommended on)
If you see this switch, keep it **on**. It stops strangers from checking which emails have accounts. LocalDeck already shows the neutral “The email or password is incorrect” message that this produces.

### 3e. User account linking ➖
Keep **Link accounts that use the same email** (the default). Then signing in with Google and with email + password for the same address gives one account.

---

## Part 4. Email templates ⬜

**Authentication → Templates**

Do these in order. Full HTML for the message bodies is in [`EMAIL_TEMPLATES.md`](EMAIL_TEMPLATES.md).

### 4a. Email address verification
1. Click **Email address verification → ✏️**.
2. **Sender name**: `LocalDeck`
3. **From**: leave `noreply@login-localdeck.firebaseapp.com` (changing it needs your own domain).
4. **Reply to**: empty, or your address.
5. **Subject**: `Confirm your email for LocalDeck`
6. **Message**: paste the verification HTML from `EMAIL_TEMPLATES.md`. Keep `%LINK%`, `%EMAIL%`, `%APP_NAME%` exactly. If the box is grey and locked, skip this step.
7. Don't save yet: do 4b first.

### 4b. Action URL (once, applies to every email)
1. In the same edit view, click **Customize action URL** (bottom).
2. Enter `https://b1progame.github.io/LOCALDECK/` (with the final slash).
3. **Save** the dialog, then **Save** the template.

Every link (verify email, reset password, sign-in link) now opens LocalDeck's own page instead of the plain Firebase page.

### 4c. Password reset
**Password reset → ✏️** · Sender `LocalDeck` · Subject `Reset your LocalDeck password` · Message: the reset HTML (if editable) · **Save**.

### 4d. Email address change ➖
**Email address change → ✏️** · Sender `LocalDeck` · Subject `Your LocalDeck email was changed`. LocalDeck has no “change email” screen, so this is only sent if you change an address yourself in the console.

### 4e. SMTP settings ➖
Lets emails come from your own mailbox instead of `noreply@…firebaseapp.com`. It needs an email provider that allows SMTP with an app password (Gmail with 2-step verification and an app password works; many free Outlook accounts no longer allow SMTP). Skip it unless emails keep landing in spam.

---

## Part 5. Users and usage

**Authentication → Users**: every share account appears here. You can disable or delete an account, or send a password reset from the ⋮ menu. Deleting a user here does not delete their encrypted links; those expire after 3 days on their own.

**Authentication → Usage**: shows sign-ins and how many emails were sent. The free Spark plan has a daily email sending limit; if many people sign up in one day, some verification emails may be delayed until the next day.

---

## Part 6. Cloudflare sharing Worker ✅

The Worker checks every Firebase sign-in before it allows uploads. It is deployed and set up:

| Item | Where | Status |
|---|---|---|
| `FIREBASE_PROJECT_ID` = `login-localdeck` | Worker secret | ✅ |
| `ALLOWED_ORIGIN` = `https://b1progame.github.io,http://localhost:5468` | `cloudflare/wrangler.toml` | ✅ |
| Database tables | created automatically by the Worker | ✅ |

Redeploy after changing anything in `cloudflare/`:

```powershell
cd "C:\Users\bslid.BENJI-PC\OneDrive\Dokumente\BENJI\ran\LOCALDECK\cloudflare"
```

```powershell
npx wrangler deploy
```

It must say it is deploying **localdeck-share**.

---

## Part 7. Google sign-in screen branding ➖ (Google Cloud console)

The Google popup says “Continue to login-localdeck.firebaseapp.com”. To show your app name and logo instead:

1. Firebase **Project settings → General → View in Google Cloud** (button at the top right of “Your project”).
2. **APIs & Services → OAuth consent screen** (newer consoles call it **Google Auth Platform → Branding**).
3. **App name**: `LocalDeck` · **User support email**: yours · **App logo**: upload `public/icon-512.png` from this project.
4. **Application home page**: `https://b1progame.github.io/LOCALDECK/`
5. **Save**.
6. Under **Audience** (or **Publishing status**), make sure it is **In production**, not **Testing**. In Testing, only listed test users can sign in with Google.

Uploading a logo can make Google ask for brand verification, which can take a few days; until then the popup keeps working with the old look.

### Hardening the API key ➖ (only if you're comfortable)
**APIs & Services → Credentials → Browser key (auto created by Firebase) → Application restrictions → Websites**, add:
- `https://b1progame.github.io/*`
- `http://localhost:5468/*`
- `https://login-localdeck.firebaseapp.com/*`

**Save.** This stops other websites from using your key. If sign-in breaks right after, remove the restriction again and tell me the error.

---

## Part 8. Test everything

Use a private browser window on <https://b1progame.github.io/LOCALDECK/> → **Shared links → Continue to sign in**.

1. **Create account**: username, a real email, a password that turns all four checks green.
2. Open the email: sender “LocalDeck”, your subject. Click the button → LocalDeck shows **“Your email is verified.”**
3. **Sign in** with that email and password → you land on **Your encrypted links**.
4. **Share a project**: in the library, ••• → **Create encrypted link** → copy the link, open it in another browser → it shows the project with **Import to my library**.
5. **Sign out**, then **Forgot?** → reset email → LocalDeck's **Choose a new password** page → sign in with the new password.
6. **Email me a sign-in link instead** → click the link → signed in without a password.
7. **Continue with Google** → popup → LocalDeck offers to use your Google name and picture.

## Troubleshooting

| What you see | What it means | Fix |
|---|---|---|
| No email arrives | Spam folder, or the daily email limit | Check spam and mark “Not spam”; wait and resend |
| “This link no longer works” | Links work once and expire | Request a new one |
| Email link opens a Firebase page | Action URL not saved | Part 4b |
| “Email-link sign-in isn't switched on yet” | Passwordless not enabled | Part 2a step 3 |
| Google popup closes with “unauthorized domain” | Site missing from authorized domains | Part 3a |
| Only you can sign in with Google | Consent screen in Testing | Part 7 step 6 |
| “That password doesn't meet the account rules” | Firebase policy stricter than what was typed | Use 12+ characters with A–Z, a–z and a symbol |
| “Could not reach the LocalDeck sharing service” | Worker not deployed or site address not allowed | Part 6 |
| “The sharing service is not finished setting up” | Worker database problem | Redeploy the Worker (Part 6) |
| Anything else | | Send me the exact red message |
