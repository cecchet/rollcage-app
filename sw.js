// Rollcage assessment tool offline support -- same approach as PassTech's
// sw.js: network-first, falling back to cache. Every successful GET the app
// makes (the page, its scripts/styles, the 3D model's STL parts, images)
// is cached as it's fetched, so one normal online visit caches everything
// the app uses without a hand-maintained precache list that would go stale
// on every release. Offline, those cached copies serve instead; an
// uncached navigation falls back to the cached page shell so the app still
// opens. The three.js / jsPDF libraries come from cdnjs, so that origin is
// cached too.
//
// /api/ (AI photo analysis/sorting) is never cached -- it's a POST to a
// paid vision API and simply isn't available offline.

const CACHE_NAME = "rollcage-v2";
const CACHEABLE_ORIGINS = [self.location.origin, "https://cdnjs.cloudflare.com"];
const PRECACHE_URLS = ["./", "./index.html", "./manifest.webmanifest", "./images/favicon-192.png", "./images/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!CACHEABLE_ORIGINS.includes(url.origin) || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const shell = (await caches.match("./")) || (await caches.match("./index.html"));
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});
