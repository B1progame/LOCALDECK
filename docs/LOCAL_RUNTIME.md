# Local runtime and offline use

Use a current browser with IndexedDB, service workers, Web Crypto, and `DecompressionStream`. Serve LOCALDECK from HTTPS or `localhost`; opening the HTML file directly does not provide the secure context needed by the player or offline cache.

The app shell is cached after its first successful load. Imported project files are stored separately in IndexedDB and are not cleared when the app cache updates. Browser cleanup, profile removal, or device loss can still remove local projects; export a library backup regularly.

Imported projects run inside a sandboxed iframe with an opaque origin. The main app does not expose its DOM, IndexedDB, share token, or other item files to project code. The service worker maps requested paths back to the selected item's stored assets and rejects unsafe paths. Some modules, network APIs, server routes, and browser-specific features may be unavailable. Never treat a compatibility report as a security review.

## What projects can use

- **localStorage, sessionStorage and cookies.** The browser refuses them in an opaque origin, so LocalDeck puts a replacement into every page of a project before its own scripts run. localStorage and cookies are kept on the device in the database `localdeck-project-saves`, one record per project, at most 5 MB. sessionStorage lasts until the project is closed. Only a page of the same project can change its record (the service worker checks the page that sends it). The details of a project show what it saved and can delete it. Deleting the project deletes it too. Backups do not contain it.
- **Paths from the root** like `/assets/logo.png` are taken from the project, not from the website.
- **alert, confirm, prompt and eval** are allowed.
- **The internet** is off. In the details of a project, **Allow the internet** lets it load scripts, styles, fonts, pictures and data over https and use WebSockets. It stays in its opaque origin and still cannot see the library, other projects or the sign-in. It can then send anything it knows to other websites, so LocalDeck asks first.
- **Not possible:** IndexedDB, a service worker of the project, opening new windows, and anything that needs a server of its own, such as PHP, a database or accounts. Such projects need their own hosting.

To check a local multi-file project, import a ZIP with HTML plus relative CSS and JavaScript assets, then launch it from the library. Switch the browser offline after the shell and item are stored to check that particular project. An app-shell cache alone does not make remote dependencies offline-capable.
