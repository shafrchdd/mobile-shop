const CACHE_NAME = "mobile-shop-erp-v7";
const ICON_LIBRARY = "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.js";
const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/database.js",
  "./assets/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    // Best-effort pre-cache of the pinned Lucide script. The app still installs
    // if the CDN is temporarily unavailable; successful fetches are reused offline.
    try {
      const response = await fetch(ICON_LIBRARY, { mode: "cors" });
      if (response.ok) await cache.put(ICON_LIBRARY, response);
    } catch (error) {
      // The icon library will be cached on its first successful online request.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("mobile-shop-erp-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const isIconLibrary = event.request.url.startsWith(ICON_LIBRARY);

  if (isIconLibrary) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(ICON_LIBRARY);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(ICON_LIBRARY, response.clone());
        return response;
      } catch (error) {
        return new Response("Lucide icons are not cached yet. Connect once to load icons.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
    })());
    return;
  }

  if (requestUrl.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== "opaque") cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === "navigate") return cache.match("./index.html");
      throw error;
    }
  })());
});
