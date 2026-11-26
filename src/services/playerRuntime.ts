/* What a project gets in the player, so that more projects work as they are. It runs in the isolated frame before
   the project. LocalDeck itself stays out of reach: the frame only sends messages, and the player checks them. */
import { scriptJson } from './packPage.ts';

/** At most this much per project, like the storage of a browser. */
export const MAX_SAVE = 5 * 1024 * 1024;

export type Saved = { local: Record<string, string>; cookies: string };

/** Content-Security-Policy of a project. Without the internet nothing can leave the page. */
export function projectPolicy(internet: boolean): string {
  const web = internet ? ' https:' : '';
  return `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:${web}; style-src 'unsafe-inline' data: blob:${web}; img-src data: blob:${web}; font-src data: blob:${web}; media-src data: blob:${web}; connect-src data: blob:${internet ? ' https: wss:' : ''}; worker-src data: blob:; frame-src data: blob:${web}; form-action 'none'; base-uri 'none'`;
}

/** The script, with what the project saved earlier. `token` identifies its messages. */
export function runtimeScript(saved: Saved, token: string, named: Record<string, string>, folder: string): string {
  return `(${RUNTIME})(${scriptJson(saved)},${scriptJson(token)},${scriptJson(named)},${scriptJson(folder)},${MAX_SAVE})`;
}

/** Written as text, because it belongs to the page of the project. */
export const RUNTIME = String.raw`function (saved, token, files, folder, limit) {
  var send = function (message) { message.localdeck = message.localdeck || 'save'; message.token = token; try { parent.postMessage(message, '*'); } catch (error) {} };
  var resolve = function (value) {
    var text = String(value || '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(text)) return null;
    var parts = text.charAt(0) === '/' ? [] : folder ? folder.split('/') : [];
    text.replace(/[?#].*$/, '').split('/').forEach(function (part) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); });
    var path = parts.join('/').toLowerCase();
    try { path = decodeURIComponent(path); } catch (error) {}
    return path;
  };
  var byName = function (value) { var path = resolve(value); return path !== null && Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null; };

  /* localStorage, sessionStorage and cookies. The browser refuses them here, so these keep the values and send them to LocalDeck. */
  var timer = 0, cookies = typeof saved.cookies === 'string' ? saved.cookies : '';
  var persist = function () { clearTimeout(timer); timer = setTimeout(flush, 250); };
  var flush = function () { clearTimeout(timer); send({ local: local.data, cookies: cookies }); };
  var size = function (data) { var total = 0; for (var key in data) total += key.length + data[key].length; return total * 2; };
  var storage = function (data, keep) {
    var api = {
      data: data,
      getItem: function (key) { key = String(key); return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { key = String(key); value = String(value); var before = data[key]; data[key] = value; if (size(data) > limit) { if (before === undefined) delete data[key]; else data[key] = before; throw new DOMException('The storage of this project is full.', 'QuotaExceededError'); } if (keep) persist(); },
      removeItem: function (key) { delete data[String(key)]; if (keep) persist(); },
      clear: function () { for (var key in data) delete data[key]; if (keep) persist(); },
      key: function (index) { var keys = Object.keys(data); return index >= 0 && index < keys.length ? keys[index] : null; },
    };
    return new Proxy(api, {
      get: function (target, name) { if (name === 'length') return Object.keys(data).length; if (name in target) return target[name]; return typeof name === 'string' ? target.getItem(name) : undefined; },
      set: function (target, name, value) { if (name in target) return false; target.setItem(name, value); return true; },
      deleteProperty: function (target, name) { target.removeItem(name); return true; },
      has: function (target, name) { return name in target || Object.prototype.hasOwnProperty.call(data, name); },
      ownKeys: function () { return Object.keys(data); },
      getOwnPropertyDescriptor: function (target, name) { return Object.prototype.hasOwnProperty.call(data, name) ? { value: data[name], enumerable: true, configurable: true, writable: true } : undefined; },
    });
  };
  var local = storage(saved.local && typeof saved.local === 'object' ? saved.local : {}, true), session = storage({}, false);
  try { Object.defineProperty(window, 'localStorage', { value: local, configurable: true }); } catch (error) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: session, configurable: true }); } catch (error) {}
  try {
    Object.defineProperty(document, 'cookie', { configurable: true,
      get: function () { return cookies; },
      set: function (text) {
        var parts = String(text).split(';'), pair = parts[0], at = pair.indexOf('='), name = (at < 0 ? '' : pair.slice(0, at)).trim(), rest = parts.slice(1).join(';');
        var expires = /expires\s*=\s*([^;]+)/i.exec(rest);
        var gone = /max-age\s*=\s*-?0\b/i.test(rest) || (expires !== null && Date.parse(expires[1]) < Date.now());
        var list = cookies ? cookies.split('; ').filter(function (entry) { return entry.split('=')[0] !== name; }) : [];
        if (!gone && pair.trim()) list.push(pair.trim());
        cookies = list.join('; ').slice(0, 8192);
        persist();
      },
    });
  } catch (error) {}
  addEventListener('pagehide', flush);

  /* Files that scripts ask for by name. */
  [[window.HTMLImageElement, 'src'], [window.HTMLMediaElement, 'src'], [window.HTMLScriptElement, 'src'], [window.HTMLSourceElement, 'src'], [window.HTMLLinkElement, 'href']].forEach(function (entry) {
    if (!entry[0]) return;
    var own = Object.getOwnPropertyDescriptor(entry[0].prototype, entry[1]);
    if (!own || !own.set) return;
    Object.defineProperty(entry[0].prototype, entry[1], { configurable: true, enumerable: own.enumerable, get: own.get, set: function (value) { own.set.call(this, byName(value) || value); } });
  });
  var setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) { var lower = String(name).toLowerCase(); return setAttribute.call(this, name, (lower === 'src' || (lower === 'href' && this.tagName !== 'A')) && byName(value) || value); };
  var NativeAudio = window.Audio;
  if (NativeAudio) { window.Audio = function (value) { return value === undefined ? new NativeAudio() : new NativeAudio(byName(value) || value); }; window.Audio.prototype = NativeAudio.prototype; }
  var nativeFetch = window.fetch;
  window.fetch = function (value, options) {
    var url = value && typeof value === 'object' && 'url' in value ? value.url : value;
    var found = byName(url);
    if (found) return nativeFetch.call(window, found, options && { method: 'GET', signal: options.signal });
    return nativeFetch.call(window, value, options);
  };
  var open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) { var args = Array.prototype.slice.call(arguments); args[1] = byName(url) || url; return open.apply(this, args); };
  var NativeWorker = window.Worker;
  if (NativeWorker) { window.Worker = function (url, options) { return new NativeWorker(byName(url) || url, options); }; window.Worker.prototype = NativeWorker.prototype; }

  /* Links to other pages of the project open them in the player. */
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || event.defaultPrevented || link.target === '_blank') return;
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var path = resolve(href);
    if (path === null) return;
    event.preventDefault();
    flush();
    send({ localdeck: 'open', path: path || 'index.html', hash: href.indexOf('#') >= 0 ? href.slice(href.indexOf('#')) : '' });
  });
}`;
