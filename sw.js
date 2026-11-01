/*
 * SmartScan service worker.
 *
 * Caches the app shell (HTML, CSS, JS, manifest, icons) so the app
 * stays usable offline. Data (documents, folders, images) is never
 * cached here — it lives in localStorage/IndexedDB and is always
 * local-first.
 *
 * OCR (Tesseract.js + language data) is loaded from CDN on first use.
 * The browser HTTP cache usually keeps those assets after the first
 * successful OCR run, so later offline OCR works for the selected
 * language. Language packs are not precached here — they are large and
 * the language is user-controlled.
 *
 * Strategy:
 *   - install: cache the shell.
 *   - fetch: serve from cache, falling back to the network.
 */

const CACHE_NAME = "smartscan-shell-v6";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./favicon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key.startsWith("smartscan-shell-") && key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  // Only handle same-origin GET requests.
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).catch(() => {
        // Offline and not cached: return a bare offline shell so the
        // app still loads rather than showing a browser error page.
        if (event.request.headers.get("accept")?.includes("text/html")) {
          return caches.match("./");
        }
        throw new Error("Network request failed and nothing cached.");
      });
    })
  );
});