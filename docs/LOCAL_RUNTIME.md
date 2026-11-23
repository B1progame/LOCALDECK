# Local runtime and offline use

Use a current browser with IndexedDB, service workers, Web Crypto, and `DecompressionStream`. Serve LOCALDECK from HTTPS or `localhost`; opening the HTML file directly does not provide the secure context needed by the player or offline cache.

The app shell is cached after its first successful load. Imported project files are stored separately in IndexedDB and are not cleared when the app cache updates. Browser cleanup, profile removal, or device loss can still remove local projects; export a library backup regularly.

Imported projects run inside a sandboxed iframe with an opaque origin. The main app does not expose its DOM, IndexedDB, share token, or other item files to project code. The service worker maps requested paths back to the selected item's stored assets and rejects unsafe paths. Some modules, network APIs, server routes, and browser-specific features may be unavailable. Never treat a compatibility report as a security review.

To check a local multi-file project, import a ZIP with HTML plus relative CSS and JavaScript assets, then launch it from the library. Switch the browser offline after the shell and item are stored to check that particular project. An app-shell cache alone does not make remote dependencies offline-capable.
