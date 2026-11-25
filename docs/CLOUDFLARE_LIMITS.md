# When someone floods the sharing service

The free plan of Cloudflare answers 100,000 requests a day for the whole account and starts again at 00:00 UTC ([limits](https://developers.cloudflare.com/workers/platform/limits/)). Above that Cloudflare answers with error 1027. **It never costs anything**, because the free plan has no bill. The library, the player and everything offline go on working. Only creating and opening shared links, signing in and the AI connection wait until the next day, and LocalDeck says so.

## What LocalDeck does

- One address may send 300 requests a minute (`[[ratelimits]]` in [`cloudflare/wrangler.toml`](../cloudflare/wrangler.toml)). It is checked first, without the database.
- Above the hourly limits nothing is written to the database any more.
- Browsers remember the permission (CORS) instead of asking before every request.
- Visits are counted once a day per open page, not per click.

## What it cannot do

A refused request still counts, because Cloudflare counts every request that reaches the Worker. Code inside the Worker cannot change that. Whoever wants to can still use up the 100,000.

## The real protection: an own domain

Requests can only be stopped before the Worker by the firewall of Cloudflare, and that works for an own domain, not for `workers.dev`. A domain costs about 10 euros a year, the rest is free.

1. Buy a domain and add it to Cloudflare (free plan). It must be bought by you, LocalDeck does not need your payment data.
2. In `cloudflare/wrangler.toml` add, with your domain:
   ```toml
   workers_dev = false
   routes = [{ pattern = "share.example.com", custom_domain = true }]
   ```
3. Deploy: `npx --prefix cloudflare wrangler deploy --config cloudflare/wrangler.toml`
4. Dashboard → the domain → Security → WAF → Rate limiting rules: one rule is free. If the hostname is `share.example.com`, more than 50 requests in 10 seconds from one IP: block.
5. Same place: switch on Bot Fight Mode.
6. GitHub → Settings → Secrets and variables → Actions → Variables: set `VITE_SHARE_API_BASE` to `https://share.example.com` and run the workflow again.

AI connections that already exist have the old address and have to be made again.
