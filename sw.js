// ===== SERVICE WORKER =====
// Caches the app on first visit so it keeps working without a connection.
// Online: files are fetched fresh (network-first) and the cache is refreshed.
// Offline or slow network: files are served from the cache.

const CACHE_NAME = 'fth-v1';
const NETWORK_TIMEOUT_MS = 4000;
const APP_FILES = [
    'i.html',
    'script.js',
    'debug.js',
    'times.js',
    'css/style.css',
    'img/logo.png'
];

self.addEventListener('install', event => {
    event.waitUntil(precacheAppFiles().then(() => self.skipWaiting()));
});

/**
 * Caches each app file separately, so one missing or renamed file does not break offline support.
 * Files missing from APP_FILES are still cached the first time the page loads them (see networkFirst).
 * @returns {Promise<void>}
 */
async function precacheAppFiles() {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(APP_FILES.map(file => cache.add(new Request(file, { cache: 'reload' }))));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            console.warn('Service worker could not cache', APP_FILES[i], result.reason);
        }
    });
}

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }
    event.respondWith(networkFirst(event.request, url));
});

/**
 * Fetches from the network with a timeout, falling back to the cache
 * @param {Request} request - Original request
 * @param {URL} url - Parsed request URL
 * @returns {Promise<Response>}
 */
async function networkFirst(request, url) {
    // Ignore query parameters (?l, ?r, ?test, ?cd) so every variant shares one cache entry
    url.search = '';
    const cacheKey = url.href;
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetchWithTimeout(cacheKey, NETWORK_TIMEOUT_MS);
        if (response.ok) {
            await cache.put(cacheKey, response.clone());
            return response;
        }
        const cached = await cache.match(cacheKey);
        return cached || response;
    }
    catch (error) {
        const cached = await cache.match(cacheKey);
        if (cached) {
            return cached;
        }
        // Serve the page for a directory URL (e.g. /fth/) when it is not cached under that name
        if (request.mode === 'navigate') {
            const page = await cache.match(new URL('i.html', self.registration.scope).href);
            if (page) {
                return page;
            }
        }
        throw error;
    }
}

/**
 * fetch() that rejects when the network does not answer in time
 * @param {string} url - URL to fetch
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { cache: 'no-cache', signal: controller.signal })
        .finally(() => clearTimeout(timer));
}
