// Custom service worker for the Veritas Ledger app shell. Built with the injectManifest
// strategy: vite-plugin-pwa substitutes the precache manifest token below and leaves the
// rest of this file alone. The token is written once, on purpose — the plugin replaces
// every occurrence, comments included.
//
// The generated worker was not enough in dev: Vite serves modules on demand, so the
// precache only ever held index.html and registerSW.js and an offline reload had no
// application code to boot from. The runtime routes below fill that gap by caching
// same-origin GETs as they are requested.

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';

self.skipWaiting();
clientsClaim();

// Production shell. In dev this manifest is close to empty by design, which is why the
// runtime routes carry the weight there.
precacheAndRoute(self.__WB_MANIFEST);
// Only ever touches Workbox's own precache; the runtime caches below are left alone so
// a precache revision change cannot wipe the modules collected while browsing.
cleanupOutdatedCaches();

const SHELL_CACHE = 'veritas-shell';
const RUNTIME_CACHE = 'veritas-runtime';

// Evidence data must never be served from cache: a stale custody docket or a stale
// verification result would be actively wrong. The API is cross-origin today, so
// sameOrigin already excludes it; this guard keeps that true if it is ever proxied
// under the app's own origin.
const isApi = (url) => url.pathname.startsWith('/api/');

// Navigations: prefer the network so a reachable server always wins, fall back to the
// cached document when offline. This is what renders the UI on an offline reload.
registerRoute(
  ({ request, url }) => request.mode === 'navigate' && !isApi(url),
  new NetworkFirst({
    cacheName: SHELL_CACHE,
    networkTimeoutSeconds: 3,
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  }),
);

// Same-origin GETs: app code, styles, icons, and the modules Vite serves on demand in
// dev (/src/*.jsx, /node_modules/.vite/deps/*). Stale-while-revalidate keeps them fresh
// while online and available while not.
registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin && request.method === 'GET' && request.mode !== 'navigate' && !isApi(url),
  new StaleWhileRevalidate({
    cacheName: RUNTIME_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      // purgeOnQuotaError stays off: dropping the whole cache under quota pressure is
      // exactly the silent-disappearance failure this worker is meant to avoid.
      new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: false }),
    ],
  }),
);
