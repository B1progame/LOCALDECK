# Deployment

## GitHub Pages

The included Actions workflow runs tests, TypeScript checks, and a production Vite build, then deploys `dist/`. The Vite base path and service-worker scope are configured for `https://b1progame.github.io/LOCALDECK/`; routing uses URL fragments so Pages does not need rewrite rules. In repository Settings → Pages, choose **GitHub Actions** as the source. Push to `main` or run the workflow manually.

## Cloudflare sharing service

Cloudflare is optional. Follow [`SHARING.md`](SHARING.md) to create a private R2 bucket, a D1 database, set the server-side `OWNER_TOKEN`, and deploy the Worker. Configure the Pages Actions variable `VITE_SHARE_API_BASE` with the Worker origin if recipients should be able to open share links on the deployed site. Do not put the owner token in a Pages variable, repository file, or frontend build.

## Local verification

```powershell
npm ci
npm test
npm run typecheck
npm run build
npm run dev -- --host 127.0.0.1 --port 5468
```

For service-worker and multi-file player checks, use the production build on an HTTPS or localhost origin. Keep development and production Worker secrets separate.
