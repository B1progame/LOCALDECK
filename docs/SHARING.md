# Optional encrypted sharing

LOCALDECK works without a network service. If you choose **Create encrypted link**, the browser exports one project to ZIP and encrypts it with AES-GCM before sending it. Cloudflare receives ciphertext only. The decryption key stays in the URL fragment (`#`), which browsers do not send to the Worker. Anyone with the complete link can import the project until it expires or is revoked.

## Free plan safeguards

The free Worker stores ciphertext in Workers KV and share metadata in D1. The Worker enforces a 24 MiB maximum per encrypted share, a 512 MiB combined active storage cap, no more than 3 uploads in progress, and a fixed 3-day expiry. KV entries also receive a 3-day TTL. Cleanup removes expired metadata and releases reserved capacity. Each owner IP is limited to 10 upload attempts per hour and 60 management attempts per hour; only the 100 most recent links appear in the management list.

Cloudflare's free KV allowance is 1 GB per account and a 25 MiB maximum value. The app's 512 MiB cap leaves room below that account limit, and the 24 MiB per-share cap fits within KV's item limit. Cloudflare says free-plan operation limits fail closed when exceeded instead of billing for overages. Other services already using the account's KV allowance also count against its shared 1 GB. Free KV is eventually consistent, so a new share may take a short time to appear in another region.

Owner management is protected by a random `OWNER_TOKEN` stored as a Worker secret. Recipients do not need an account; the full link is their access credential. Never put the owner token in GitHub variables, app code, or a committed `.env` file. The app holds it only in the page's memory while the dialog is open.

## Create the Cloudflare resources

Use the Cloudflare **Workers Free** plan only. In `cloudflare/`, create a KV namespace and copy the returned ID into `wrangler.toml` under `[[kv_namespaces]]` as `id`. Create a separate preview namespace and put its ID in `preview_id`:

```powershell
npx wrangler kv namespace create SHARES_KV
npx wrangler kv namespace create SHARES_KV --preview
```

Create a D1 database if the configured one is not present, update its ID in `wrangler.toml`, and apply the schema:

```powershell
npx wrangler d1 create localdeck-shares
npx wrangler d1 execute localdeck-shares --remote --file schema.sql
```

Create a random owner token locally and keep it in a password manager. Then set it as a Worker secret; the prompt does not echo the secret:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put OWNER_TOKEN
```

Set `ALLOWED_ORIGIN` in `wrangler.toml` to the exact origin of the deployed Pages site, then deploy the Worker:

```powershell
npx wrangler deploy
```

The Worker URL is shown by Wrangler. Add that URL as the GitHub Actions variable `VITE_SHARE_API_BASE` in the `B1progame/LOCALDECK` repository, then run the Pages workflow. This variable is public and contains only the API URL, never the owner token.

## Future storage changes

The free KV setup intentionally stays below 1 GB. A 4 GB allowance requires moving the payloads to R2. R2 currently requires enabling its subscription in Cloudflare, even though it includes 10 GB-month of storage and free operation allowances. Do not enable it unless you accept the billing setup and have configured account spending alerts/limits. The Worker must be reviewed and redeployed with a hard R2 quota before any migration.

## Data and operational notes

- Cloudflare sees ciphertext, opaque IDs, sizes, and timestamps, but not project titles or decryption keys.
- Anyone who receives the full link can open it while it is active. Revocation blocks future access but cannot erase a copy already imported.
- Share links are not included in local library backups; projects remain on each device.
- Free-plan quota exhaustion can temporarily make sharing unavailable. The Worker cannot upgrade the account or enable paid services.

