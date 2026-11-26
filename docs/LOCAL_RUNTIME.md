# Local runtime and offline use

Use a current browser with IndexedDB, service workers, Web Crypto, and `DecompressionStream`. Serve LOCALDECK from HTTPS or `localhost`; opening the HTML file directly does not provide the secure context needed by the player or offline cache.

The app shell is cached after its first successful load. Imported project files are stored separately in IndexedDB and are not cleared when the app cache updates. Browser cleanup, profile removal, or device loss can still remove local projects; export a library backup regularly.

Imported projects run inside a sandboxed iframe with an opaque origin. The main app does not expose its DOM, IndexedDB, share token, or other item files to project code. The service worker keeps the app offline and serves PDFs of projects. Some modules, network APIs, server routes, and browser-specific features may be unavailable. Never treat a compatibility report as a security review.

## What projects can use

- **Many files.** Browsers do not let a service worker serve a frame with an opaque origin, and such a frame may not load `blob:` addresses of LocalDeck either. So the player packs the page with all its files into one page (`src/services/packPage.ts`): styles, `@import`, scripts, JavaScript modules, pictures and fonts become `data:` addresses, and files that scripts load by name (`fetch`, `new Image`, `Audio`, `XMLHttpRequest`, workers) are found by `src/services/playerRuntime.ts`. Links to other pages of the project open them in the player. Very large files (over 60 MB, or more than 160 MB together) are left out.
- **localStorage, sessionStorage and cookies.** The browser refuses them in an opaque origin, so LocalDeck puts a replacement into every page of a project before its own scripts run. localStorage and cookies are kept on the device in the database `localdeck-project-saves`, one record per project, at most 5 MB. sessionStorage lasts until the project is closed. The page sends changes to the player, which only accepts them with the key it gave that page. The details of a project show what it saved and can delete it. Deleting the project deletes it too. Backups do not contain it.
- **Paths from the root** like `/assets/logo.png` are taken from the project, not from the website.
- **alert, confirm, prompt and eval** are allowed.
- **The internet** is off (Content-Security-Policy of the page). In the details of a project, **Allow the internet** lets it load scripts, styles, fonts, pictures and data over https and use WebSockets. It stays in its opaque origin and still cannot see the library, other projects or the sign-in. It can then send anything it knows to other websites, so LocalDeck asks first.
- **Not possible:** IndexedDB, a service worker of the project, opening new windows, and anything that needs a server of its own, such as PHP, a database or accounts. Such projects need their own hosting.

To check a local multi-file project, import a ZIP with HTML plus relative CSS and JavaScript assets, then launch it from the library. Switch the browser offline after the shell and item are stored to check that particular project. An app-shell cache alone does not make remote dependencies offline-capable.
