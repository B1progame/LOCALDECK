# LOCALDECK

Your personal library for learning, games, tools, and all the little things you make. A small, dependency-free offline-first web app for GitHub Pages.

## What it does

- Import one or more HTML files, or a ZIP containing a complete HTML project.
- Keep projects and metadata in this browser's IndexedDB. Imports are not uploaded.
- Run local projects in a sandboxed player, including files such as images, CSS, and scripts inside ZIP packages.
- Search, favorite, rename, and remove projects; browse learning and games separately.
- Export a portable ZIP backup and restore it later.
- Generate an AI-ready project brief in AI Studio.
- Cache the app shell for offline use after the first visit. Install it as an app from a compatible browser.
- Adapt to phone and tablet screens and respect reduced-motion preferences.

## Run locally

Service workers require HTTPS or a localhost address. Opening `index.html` directly as a `file://` URL will show the library, but offline caching and the local project player need a local web server.

With Python installed, open a terminal in this folder and run:

```powershell
python -m http.server 49283
```

Then visit <http://localhost:49283>. Import a project, reload once if the browser is setting up offline support, and try opening it from your library.

## Live site and GitHub CLI

LOCALDECK is live at <https://b1progame.github.io/LOCALDECK/>. The public source is <https://github.com/B1progame/LOCALDECK>. GitHub Pages deploys the repository root from `main`; pushing a new commit publishes the update.

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

This is a static app: HTML, CSS, JavaScript, a manifest, an icon, and a service worker. There is no build step, server database, account, analytics, external font, or runtime dependency.
