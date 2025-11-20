// Service Worker for BOTZZZ773 PWA
const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `botzzz773-${CACHE_VERSION}`;
const API_CACHE_NAME = `botzzz773-api-${CACHE_VERSION}`;
const PENDING_REQUESTS_CACHE = 'botzzz773-pending-requests';
const OFFLINE_URL = '/offline.html';
const SYNC_TAG = 'sync-pending-requests';
const OFFLINE_QUEUE_ENDPOINTS = [
  '/.netlify/functions/orders',
  '/.netlify/functions/payments'
];

// Assets to cache immediately on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/services.html',
  '/order.html',
  '/css/style.css',
  '/css/dashboard-styles.css',
  '/js/main.js',
  '/js/dashboard.js',
  '/js/services.js',
  '/js/order.js',
  '/js/pwa.js',
  '/manifest.json',
  OFFLINE_URL
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching static assets');
        return cache.addAll(STATIC_ASSETS.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => {
        console.log('[ServiceWorker] Skip waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[ServiceWorker] Installation failed:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            const allowedCaches = [CACHE_NAME, API_CACHE_NAME, PENDING_REQUESTS_CACHE];
            if (!allowedCaches.includes(cacheName)) {
              console.log('[ServiceWorker] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[ServiceWorker] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldQueueRequest(url, request.method)) {
    event.respondWith(queueRequest(request));
    return;
  }

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip chrome extensions and other protocols
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Skip Netlify functions (API calls)
  if (url.pathname.startsWith('/.netlify/')) {
    return event.respondWith(handleApiRequest(request));
  }

  // Network first strategy for HTML pages
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response before caching
          const responseClone = response.clone();
          
          // Cache the new version
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          
          return response;
        })
        .catch(() => {
          // Fallback to cache
          return caches.match(request)
            .then((cachedResponse) => {
              return cachedResponse || caches.match(OFFLINE_URL);
            });
        })
    );
    return;
  }

  // Cache first strategy for static assets (CSS, JS, images)
  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Return cached version and update in background
            fetch(request).then((response) => {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, response);
              });
            }).catch(() => {});
            
            return cachedResponse;
          }
          
          // Not in cache, fetch from network
          return fetch(request)
            .then((response) => {
              // Cache the new resource
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseClone);
              });
              
              return response;
            })
            .catch(() => {
              // Return a fallback for images
              if (request.destination === 'image') {
                return new Response(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect fill="#ddd" width="200" height="200"/><text fill="#999" x="50%" y="50%" text-anchor="middle" dy=".3em">Offline</text></svg>',
                  { headers: { 'Content-Type': 'image/svg+xml' } }
                );
              }
              throw new Error('Network request failed');
            });
        })
    );
    return;
  }

  // Default: network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});

function shouldQueueRequest(url, method) {
  if (method !== 'POST') {
    return false;
  }
  return OFFLINE_QUEUE_ENDPOINTS.some((endpoint) => url.pathname.startsWith(endpoint));
}

async function queueRequest(request) {
  const networkAttempt = request.clone();
  try {
    return await fetch(networkAttempt);
  } catch (error) {
    const offlineClone = request.clone();
    const cache = await caches.open(PENDING_REQUESTS_CACHE);
    await cache.put(
      offlineClone,
      new Response(
        JSON.stringify({ queuedAt: Date.now(), url: request.url }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    );

    if (self.registration && self.registration.sync) {
      try {
        await self.registration.sync.register(SYNC_TAG);
      } catch (syncError) {
        console.warn('[ServiceWorker] Unable to register background sync:', syncError);
      }
    }

    await notifyClients({ type: 'REQUEST_QUEUED', url: request.url });

    return new Response(
      JSON.stringify({
        success: true,
        queued: true,
        message: 'No connection detected. Your request was queued and will sync automatically.'
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    return new Response(
      JSON.stringify({ error: 'Network error. Please check your connection.', offline: true }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function notifyClients(message) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach((client) => client.postMessage(message));
  } catch (error) {
    console.warn('[ServiceWorker] Unable to notify clients:', error);
  }
}

// Background sync for offline form submissions
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync:', event.tag);
  
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncQueuedRequests());
  }
});

async function syncQueuedRequests() {
  // Sync any pending orders when back online
  try {
    const cache = await caches.open(PENDING_REQUESTS_CACHE);
    const requests = await cache.keys();
    
    for (const request of requests) {
      try {
        await fetch(request.clone());
        await cache.delete(request);
        await notifyClients({ type: 'REQUEST_SYNCED', url: request.url });
      } catch (error) {
        console.error('[ServiceWorker] Sync failed for:', request.url);
      }
    }
  } catch (error) {
    console.error('[ServiceWorker] Background sync failed:', error);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'New notification',
    icon: '/img/icons/icon-192x192.png',
    badge: '/img/icons/icon-96x96.png',
    vibrate: [200, 100, 200],
    tag: 'botzzz773-notification',
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification('BOTZZZ773', options)
  );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification clicked');
  
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/')
  );
});

// Message handling for cache updates
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});
