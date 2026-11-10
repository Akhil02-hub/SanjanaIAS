const CACHE_NAME = 'sanjana-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/offline.html',
    '/logo.png',
    '/manifest.json'
];

// Install Service Worker and cache core assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Fetch from cache first, then network
self.addEventListener('fetch', (e) => {
    // Don't cache API calls or Supabase auth
    if (e.request.url.includes('supabase') || e.request.url.includes('/api/')) return;

    e.respondWith(
        fetch(e.request).catch(() => {
            // If network fails, try cache, then offline page
            return caches.match(e.request).then((response) => {
                return response || caches.match('/offline.html');
            });
        })
    );
});