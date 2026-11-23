# Deployment

## GitHub Pages

The included Actions workflow runs tests, TypeScript checks, and a production Vite build, then deploys `dist/`. The Vite base path and service-worker scope are configured for `https://b1progame.github.io/LOCALDECK/`; routing uses URL fragments so Pages does not need rewrite rules. In repository Settings → Pages, choose **GitHub Actions** as the source. Push to `main` or run the workflow manually.

## Cloudflare sharing service

Cloudflare sharing is optional. Follow [`SHARING.md`](SHARING.md) to create Workers KV namespaces and a D1 database on the Workers Free plan, configure Google Sign-In, run the correct D1 schema or upgrade, set the server-side `GOOGLE_CLIENT_ID`, and deploy the Worker. Set the Pages Actions variables `VITE_SHARE_API_BASE` and `VITE_GOOGLE_CLIENT_ID` so users can sign in and recipients can open share links. The Google client ID is public; never place API secrets or Cloudflare tokens in any `VITE_` variable.

## Local verification

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run dev -- --host 127.0.0.1 --port 5468
```

For service-worker and multi-file player checks, use the production build on an HTTPS or localhost origin. Keep development and production Worker secrets separate.
