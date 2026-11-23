# Branded account emails

Firebase sends the verification and password-reset emails. By default they say "Your project-175953444466 team" and link to a plain Firebase page. These steps make them look like LocalDeck and open the links inside the app. Everything is set in the [Firebase console](https://console.firebase.google.com/) for the `login-localdeck` project. Nothing in this repository can change it for you.

## 1. Give the project a public name

**Project settings → General → Public-facing name:** `LocalDeck`

This replaces "project-175953444466" everywhere `%APP_NAME%` appears.

## 2. Open email links inside LocalDeck

**Authentication → Templates → Email address verification → ✏️ → Customize action URL:**

```text
https://b1progame.github.io/LOCALDECK/
```

Firebase then sends links like `https://b1progame.github.io/LOCALDECK/?mode=verifyEmail&oobCode=…`. LocalDeck recognises them (`src/authAction.tsx`): it verifies the address, or shows a "choose a new password" form, in the app's own design. One action URL covers every template.

## 3. Sender and subject

Set these for each template:

| Field | Value |
|---|---|
| Sender name | `LocalDeck` |
| Reply-to | your own address, or leave empty |
| Verification subject | `Confirm your email for LocalDeck` |
| Password reset subject | `Reset your LocalDeck password` |

The sender address stays `noreply@login-localdeck.firebaseapp.com` unless you add a custom domain under **Templates → Customize domain**.

## 4. Message bodies

Paste these into the **Message** field. Firebase replaces `%LINK%`, `%EMAIL%` and `%APP_NAME%`.

### Email address verification

```html
<div style="margin:0;padding:32px 16px;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:#16151d">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e6e4ef">
    <div style="padding:28px 32px;background:#0b0c12;color:#f6f5fa">
      <img src="https://b1progame.github.io/LOCALDECK/icon-192.png" width="40" height="40" alt="" style="border-radius:11px;vertical-align:middle">
      <span style="margin-left:10px;font-size:18px;font-weight:700;letter-spacing:-0.3px;vertical-align:middle">LocalDeck</span>
    </div>
    <div style="padding:32px">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-0.4px">Confirm your email address</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#565766">You're almost ready to share projects from %APP_NAME%. Confirm that <b style="color:#16151d">%EMAIL%</b> belongs to you.</p>
      <a href="%LINK%" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#6e4fe0;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Confirm email</a>
      <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#7d7e8c">The link works once and expires soon. If you didn't create a LocalDeck sharing account, you can ignore this email; nothing happens.</p>
    </div>
    <div style="padding:18px 32px;border-top:1px solid #eeedf4;font-size:12px;color:#9a9aa8">Your library stays on your device. Only the projects you choose to share are uploaded, encrypted.</div>
  </div>
</div>
```

### Password reset

```html
<div style="margin:0;padding:32px 16px;background:#f4f3f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:#16151d">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e6e4ef">
    <div style="padding:28px 32px;background:#0b0c12;color:#f6f5fa">
      <img src="https://b1progame.github.io/LOCALDECK/icon-192.png" width="40" height="40" alt="" style="border-radius:11px;vertical-align:middle">
      <span style="margin-left:10px;font-size:18px;font-weight:700;letter-spacing:-0.3px;vertical-align:middle">LocalDeck</span>
    </div>
    <div style="padding:32px">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;letter-spacing:-0.4px">Reset your password</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#565766">Someone asked to reset the password for <b style="color:#16151d">%EMAIL%</b> on %APP_NAME%. Choose a new one here:</p>
      <a href="%LINK%" style="display:inline-block;padding:13px 22px;border-radius:12px;background:#6e4fe0;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Choose a new password</a>
      <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#7d7e8c">If you didn't ask for this, ignore this email. Your password stays the same.</p>
    </div>
  </div>
</div>
```

## 5. Authorized domains

**Authentication → Settings → Authorized domains** must include `b1progame.github.io`. Otherwise the action page and Google sign-in are refused.

## 6. Passwordless sign-in link (optional, free)

**Authentication → Sign-in method → Email/Password → ✏️ → turn on “Email link (passwordless sign-in)” → Save.**

LocalDeck then shows “Email me a sign-in link instead” on the sign-in screen. The link returns to `https://b1progame.github.io/LOCALDECK/`, where LocalDeck finishes the sign-in automatically. If it is opened on another device, LocalDeck asks for the email address first.

## 7. Test everything

1. Open the live site in a private window and go to **Shared links → Continue to sign in → Create account**.
2. Sign up with a real address you can read. Check the email's sender name, subject and design, then click the button. LocalDeck should show “Your email is verified.”
3. Sign in with that email and password.
4. Sign out, use **Forgot?**, and check the reset email and LocalDeck's “Choose a new password” page.
5. Try **Email me a sign-in link instead** and **Continue with Google**.

Emails sometimes land in spam at first. Marking them “Not spam” once helps.
