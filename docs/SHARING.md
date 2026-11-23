# Optional encrypted sharing

LOCALDECK works without a network service. This Worker is only used when you choose **Create encrypted link** on a project. The browser exports that project to ZIP, encrypts the bytes with AES-GCM, and uploads only the ciphertext. The 256-bit decryption key is carried after `#` in the generated URL; browsers do not send URL fragments to the Worker. Anyone who gets the complete link can open the project until expiry or revocation.

The Worker stores encrypted blobs in R2 and minimal metadata in D1. It accepts 1 hour, 1 day, 7 day, or 30 day expirations, caps encrypted blobs at 50 MiB, allows at most 10 owner uploads per IP per hour, caps active storage at 200 links / 512 MiB, limits owner listing to the most recent 100 links, and removes expired objects on its scheduled cleanup. Set a strong random `OWNER_TOKEN` with Wrangler secrets; never put it in GitHub variables or a committed `.env` file. Owner tokens are sent only over HTTPS and are held in page memory while the dialog is open.

## Create the Cloudflare resources

Install the Cloudflare Wrangler CLI, log in to the account that should own the storage, then from `cloudflare/` run:

```powershell
wrangler login
wrangler d1 create localdeck-shares
wrangler r2 bucket create localdeck-shares
```

Copy the D1 `database_id` returned by Wrangler into `wrangler.toml`. Apply the schema:

```powershell
wrangler d1 execute localdeck-shares --file schema.sql
```

Generate a random token locally and set it as a Worker secret. Keep the value in your password manager; LOCALDECK never stores it:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
wrangler secret put OWNER_TOKEN
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to the origin of your deployed Pages site (for example `https://b1progame.github.io`) and deploy:

```powershell
wrangler deploy
```

The deployment URL is shown by Wrangler. Try a local request with the Worker dev server before using a real project:

```powershell
wrangler dev
```

## Connect GitHub Pages

In the `B1progame/LOCALDECK` repository, add the Actions variable `VITE_SHARE_API_BASE` with the full Worker origin, such as `https://localdeck-share.<your-subdomain>.workers.dev`. The Pages workflow embeds this public API origin at build time. It does not contain the owner token. Push a commit or run **Build and deploy LOCALDECK** from the Actions tab.

In LOCALDECK, open a project's menu and choose **Create encrypted link**. Enter the Worker URL and owner token, choose an expiration, and copy the link. To review or revoke links, open **Shared links**, enter the same values, and load the list. Revocation deletes the R2 object and marks its database row revoked. Expired rows are removed by the scheduled Worker task.

## Data and operational notes

- Share contents are end-to-end encrypted by the browser. Cloudflare sees ciphertext, object size, creation time, and expiration time; project titles and decryption keys are not stored in D1.
- A link is a bearer credential. Anyone with the full URL, including the fragment key, can import the project.
- Revocation blocks future loads but cannot erase a copy someone already imported.
- Share links are not included in local library backups; projects remain on each device.
- Keep D1 and R2 in the same Cloudflare account. The share payload limit is 50 MiB; the library's local backup limit remains independent.
- Public reads are bounded by expiry and object size. The upload limiter hashes addresses before storing them; old windows are pruned by the scheduled cleanup.
