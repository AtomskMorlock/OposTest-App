const CACHE_PREFIX = "opostest";
const STATIC_CACHE = `${CACHE_PREFIX}-static-v2`;
const DATA_CACHE = `${CACHE_PREFIX}-data-v1`;

const SCOPE_URL = new URL(self.registration.scope);
const INDEX_URL = new URL("index.html", SCOPE_URL).toString();

const CORE_ASSETS = [
  new URL("./", SCOPE_URL).toString(),
  INDEX_URL,
  new URL("manifest.webmanifest", SCOPE_URL).toString(),
  new URL("favicon.svg", SCOPE_URL).toString(),
  new URL("icons/apple-touch-icon-180.png", SCOPE_URL).toString(),
  new URL("icons/icon-192.png", SCOPE_URL).toString(),
  new URL("icons/icon-512.png", SCOPE_URL).toString(),
  new URL("version.json", SCOPE_URL).toString(),
  new URL("version.js", SCOPE_URL).toString()
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && ![STATIC_CACHE, DATA_CACHE].includes(k))
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function canonicalKey(url) {
  return `${url.origin}${url.pathname}`;
}

async function networkFirst(request, cacheName, keyOverride = "") {
  const cache = await caches.open(cacheName);
  const key = keyOverride || request;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) await cache.put(key, fresh.clone());
    return fresh;
  } catch (_) {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match(INDEX_URL);
      if (fallback) return fallback;
    }
    throw _;
  }
}

async function staleWhileRevalidate(request, cacheName, keyOverride = "") {
  const cache = await caches.open(cacheName);
  const key = keyOverride || request;
  const cached = await cache.match(key);

  const networkPromise = fetch(request)
    .then(async response => {
      if (response && response.ok) await cache.put(key, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await networkPromise;
  if (fresh) return fresh;
  return fetch(request);
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname.toLowerCase();
  const key = canonicalKey(url);

  if (request.mode === "navigate" || path.endsWith("/index.html") || path === "/" || path === SCOPE_URL.pathname) {
    event.respondWith(networkFirst(request, STATIC_CACHE, INDEX_URL));
    return;
  }

  if (path.endsWith("/version.json") || path.endsWith("/version.js")) {
    event.respondWith(networkFirst(request, STATIC_CACHE, key));
    return;
  }

  if (path.endsWith(".json")) {
    event.respondWith(networkFirst(request, DATA_CACHE, key));
    return;
  }

  if (
    path.endsWith(".js") ||
    path.endsWith(".css") ||
    path.endsWith(".svg") ||
    path.endsWith(".png") ||
    path.endsWith(".webmanifest")
  ) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE, request));
  }
});
