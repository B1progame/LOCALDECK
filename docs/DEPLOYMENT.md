# Deployment

## GitHub Pages

The included Actions workflow runs tests, TypeScript checks, and a production Vite build, then deploys `dist/`. The Vite base path and service-worker scope are configured for `https://b1progame.github.io/LOCALDECK/`; routing uses URL fragments so Pages does not need rewrite rules. In repository Settings → Pages, choose **GitHub Actions** as the source. Push to `main` or run the workflow manually.

## Cloudflare sharing service

Cloudflare sharing is optional. Follow [`SHARING.md`](SHARING.md) to create Workers KV namespaces and a D1 database on the Workers Free plan, configure Google and Firebase email/GitHub/Facebook sign-in, run the correct D1 schema or upgrade, configure provider values, and deploy. Set the Pages Actions variables `VITE_SHARE_API_BASE`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_FIREBASE_API_KEY`. For Firebase GitHub/Facebook sign-in, also set `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`, then set the matching `VITE_FIREBASE_*_ENABLED` variable to `true` only for each configured provider. These values are public app configuration. Never put a GitHub/Facebook OAuth secret, service-account key, or Cloudflare token in any `VITE_` variable.

## Local verification

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run dev -- --host 127.0.0.1 --port 5468
```

For service-worker and multi-file player checks, use the production build on an HTTPS or localhost origin. Keep development and production Worker secrets separate.
