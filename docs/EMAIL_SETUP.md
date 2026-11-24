# Your own confirmation email (free)

Firebase locks the text of its verification email. This setup sends LocalDeck's own design instead. It costs nothing: Firebase stays on Spark, Cloudflare stays on Workers Free, and Gmail sends the email through Google Apps Script. No card and no domain are needed.

```text
Sign up → Firebase creates the account
        → your Cloudflare Worker checks the sign-in and creates the confirmation link
        → Apps Script sends the LocalDeck email from a Gmail address
        → the button opens LocalDeck, which confirms the address
```

Until you finish these steps, LocalDeck keeps using Firebase's email. The same happens if your service fails or reaches its daily limit, so signing up always works.

**Good to know**
- A normal Google account can send about 100 emails per day this way. The Worker stops at 90.
- People see the Gmail address as the sender. Use a **separate Google account** for this, not your personal one.
- The service account key stays in Cloudflare. Apps Script never gets it.

You need about 15 minutes. Do the parts in order.

## Part 1. Service account

1. Open [Google Cloud → Service accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=login-localdeck) with the Google account that owns the Firebase project.
2. **Create service account** → name `localdeck-mail` → **Create and continue**.
3. Role: **Firebase Authentication Admin**. Nothing else. → **Continue** → **Done**.
4. Click the new account → **Keys → Add key → Create new key → JSON → Create**. A file downloads.

That file is a password. Never send it to anyone, never put it in this repository, and delete it after Part 3. Don't use the key from Firebase's own "Generate new private key" button: that one can do everything in the project.

## Part 2. Gmail sender

1. Sign in to the Google account that should send the emails. Open [a new Apps Script project](https://script.google.com/home/projects/create) and name it `LocalDeck mail`.
2. Delete the sample code, paste all of [`email/apps-script/Code.gs`](../email/apps-script/Code.gs), and save.
3. Make a secret. Run this in PowerShell and copy the result:

   ```powershell
   [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
   ```

4. In Apps Script: **Project settings** (gear) → **Script properties → Add script property**. Name `MAIL_RELAY_SECRET`, value: the secret. **Save**.
5. Back in the editor choose `sendTestToMyself` → **Run** and allow the permissions. Google warns that the app is unverified because it is your own script: **Advanced → Go to LocalDeck mail**. The preview email arrives in that inbox. Its button opens LocalDeck and says the link no longer works, which is right for a preview.
6. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. **Deploy**, then copy the address that ends in `/exec`.

## Part 3. Cloudflare

Run these one after another.

```powershell
cd cloudflare
```

Change the path to your downloaded file:

```powershell
Get-Content "$HOME\Downloads\YOUR-KEY-FILE.json" -Raw | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

Paste the `/exec` address when asked:

```powershell
npx wrangler secret put MAIL_RELAY_URL
```

Paste the secret from Part 2 when asked:

```powershell
npx wrangler secret put MAIL_RELAY_SECRET
```

```powershell
npx wrangler deploy
```

Now delete the JSON file from Downloads and empty the recycle bin.

## Part 4. Test

1. Create an account in a private window with an address you own.
2. The email has the purple LocalDeck header. If a plain one arrives, it came from Firebase: see below.
3. Click **Confirm email** → LocalDeck shows "Your email is verified."
4. Sign in.

| What you see | What to do |
|---|---|
| Plain Firebase email | Run `npx wrangler tail` in `cloudflare`, sign up again and read the `verification_mail_failed` line |
| `service_account_rejected` | The JSON was not stored completely. Repeat the first secret |
| `link_rejected_403` | The service account has no Firebase Authentication Admin role, or the Identity Toolkit API is off |
| `relay_forbidden` | The two `MAIL_RELAY_SECRET` values differ |
| `relay_bad_answer` | The web app access is not **Anyone**, or the address does not end in `/exec` |
| `relay_daily_limit` | Gmail's limit for today is used up |
| Nothing in the log | The three secrets are not all set, or the Worker was not deployed |

After changing `Code.gs`: **Deploy → Manage deployments → ✏️ → New version**. A plain save does not update the web app.

# Admin account

The admin sees all active links under **Shared links**, can delete any of them, and has no hourly or daily upload limit. Project contents stay encrypted, also for the admin. The address is stored only in Cloudflare.

```powershell
npx wrangler secret put ADMIN_EMAILS
```

Type the exact address of the Google account (several: separated by commas), then:

```powershell
npx wrangler deploy
```

Sign out in LocalDeck and choose **Continue with Google** again. An **Admin** label appears under **Shared links**. Only a Google sign-in counts; an email and password account with the same address is not an admin.
