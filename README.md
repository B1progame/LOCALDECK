# LOCALDECK

Your personal library for learning, games, tools, and all the little things you make. A local-first web app for GitHub Pages.

## What it does

- Import one or more HTML files, or a ZIP containing a complete HTML project.
- Keep projects and metadata in this browser's IndexedDB. Imports are not uploaded.
- Run local projects in a sandboxed player, including files such as images, CSS, and scripts inside ZIP packages.
- Edit saved HTML files in the browser, save changes to this device, and preview them in the isolated player.
- Search, favorite, rename, and remove projects; browse learning and games separately.
- Export a portable ZIP backup and restore it later.
- Inspect one HTML file in AI Studio and prepare a precise, single-file AI prompt.
- Prepare a detailed PDF-to-project prompt for an external AI chat; attach the PDF there and ask it for a LOCALDECK-ready ZIP with generated or code-drawn artwork.
- Share a project with an expiring, end-to-end encrypted link when the optional Cloudflare service is configured.
- Cache the app shell for offline use after the first visit. Install it as an app from a compatible browser.
- Adapt to phone and tablet screens and respect reduced-motion preferences.

## Run locally

Service workers require HTTPS or a localhost address. Opening `index.html` directly as a `file://` URL will show the library, but offline caching and the local project player need a local web server.

Open a terminal in this folder and run:

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5468
```

Then visit <http://127.0.0.1:5468>. The development server uses 5468 so it does not collide with other tools using 5173. Import a project, then open it from your library.

## Live site and GitHub CLI

LOCALDECK is live at <https://b1progame.github.io/LOCALDECK/>. The public source is <https://github.com/B1progame/LOCALDECK>. GitHub Actions builds and deploys `dist/` when `main` changes.

```powershell
gh auth status
gh repo view B1progame/LOCALDECK
git add .
git commit -m "Update LOCALDECK"
git push
gh api repos/B1progame/LOCALDECK/pages/builds/latest
```

The app files are public; projects imported into the app remain in each visitor's browser and are never part of the repository.

If `gh auth status` reports an expired token, run `gh auth login` in your terminal and then repeat the commands. LOCALDECK does not need a GitHub token at runtime.

## ZIP package format

Put an `index.html` at the project root when possible. Keep asset paths relative to the HTML file. A `localdeck.json` next to the entry page can set the library details:

```json
{
  "title": "Derivative practice",
  "type": "learning",
  "subject": "Mathematics",
  "description": "An interactive guide to derivatives",
  "tags": ["calculus", "practice"]
}
```

Supported `type` values include `learning`, `game`, `app`, `simulation`, `presentation`, `tool`, and `other`. Regular ZIP compression (stored or DEFLATE) is supported. Encrypted ZIP files and ZIP64 packages are not.

## Browser and project notes

- Use a current browser with IndexedDB, service workers, and the `DecompressionStream` API for compressed ZIP imports.
- The same browser profile on the same device contains the library. Browser data cleanup can remove it; use **Settings → Export library** for a backup.
- A project that needs remote APIs, online media, or other internet services may not work offline.
- Browser sandboxing isolates imported project scripts from the library's storage and controls, but imported projects should still be treated as untrusted content.
- Large ZIP packages need enough free memory while being imported and backed up.

## Project files

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) describes the local app and optional Worker boundaries.
- [`docs/LOCAL_RUNTIME.md`](docs/LOCAL_RUNTIME.md) documents sandboxing and offline behavior.
- [`docs/SECURITY.md`](docs/SECURITY.md) summarizes import, runtime, and sharing protections.
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) covers Pages and local verification.

## Build and deploy

Install Node.js 22 or newer, then run:

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5468
npm test
npm run typecheck
npm run build
```

GitHub Actions builds the app and deploys `dist/` to GitHub Pages after pushes to `main`. Set the repository's Pages source to **GitHub Actions** once. The app has no server database or analytics. Its runtime dependencies are bundled into the static build.

## Optional encrypted sharing

The app works without Cloudflare. Optional sharing supports Google, verified email/password, GitHub, and Facebook sign-in. Microsoft is not included. Email verification uses Firebase's managed sender, so no custom domain is needed. Sign-in is required to create, list, or delete links; anyone with a valid shared link can open it without an account. Follow [`docs/SHARING.md`](docs/SHARING.md) to configure the free Cloudflare Worker, KV, D1, Google, and Firebase providers. Each link expires in 3 days; uploads are limited to 24 MiB per link, 48 MiB active per account, 5 per hour and 15 per day per account, and 100 per day globally. Active storage is capped at 512 MiB and uploads at 3 concurrently. The Worker verifies signed identity tokens; public client configuration contains no OAuth client secret or Cloudflare token. Shared ZIPs are encrypted in the browser with AES-GCM before upload; the decryption key stays in the URL fragment and is never sent to the Worker. Link owners can permanently delete shares from Shared links.

## Icon prompt

Use this prompt if you want to regenerate the supplied icon in an image model:

> Create a premium app icon for LOCALDECK, a private offline library for HTML projects. Square 1:1 canvas, no text or letters. A small stack of three softly folded rounded sheets, the front sheet warm ivory with a subtle pink-to-cream sheen, two lavender and vivid violet sheets behind it, one tiny four-point cream sparkle at the upper right. Centered, sculpted paper with smooth beveled edges, delicate realistic soft shadows, gentle luminous violet gradient background. Clean Apple-quality icon craft, tactile, elegant, instantly recognizable at small sizes, refined 3D illustration, no border, no watermark.
