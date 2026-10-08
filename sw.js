/*
 * SmartScan service worker.
 *
 * Caches the app shell (HTML, CSS, JS, manifest, icons) so the app
 * stays usable offline. Data (documents, folders, images) is never
 * cached here — it lives in localStorage/IndexedDB and is always
 * local-first.
 *
 * Strategy:
 *   - install: cache the shell.
 *   - fetch: serve from cache, falling back to the network.
 */

const CACHE_NAME = "smartscan-shell-v1";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
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
            .filter(key => key !== CACHE_NAME)
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