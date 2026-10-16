/*
 * Danest service worker. The app opens instantly and keeps working on a weak connection.
 *
 * Guest, money and staff data (/api) is never cached: it always comes live from the server,
 * so a shared or lost device holds no bookings, bills or passwords. Only the app itself
 * (code, fonts, images) is stored.
 *
 * VERSION and SHELL are filled in at build time (see vite.config.ts), so every deploy is a
 * new worker; staff are offered a reload instead of being reloaded mid-task.
 */
const VERSION = '__VERSION__';
const SHELL = [/* __SHELL__ */];
const SHELL_CACHE = `danest-shell-${VERSION}`;
const ASSET_CACHE = `danest-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL_CACHE && key !== ASSET_CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages: always try the network first so a deploy shows up at once; fall back to the saved app.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get('content-type') ?? '').includes('text/html')) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    );
    return;
  }

  // Built files have a content hash in their name, so a saved copy is always the right one.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Images and icons: show the saved copy straight away, refresh it in the background.
  if (url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (c) => {
        const hit = await c.match(req);
        const fresh = fetch(req)
          .then((res) => (res.ok && c.put(req, res.clone()), res))
          .catch(() => hit ?? Response.error());
        return hit ?? fresh;
      }),
    );
  }
});
