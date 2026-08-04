/**
 * service-worker.js - Progressive Web App Service Worker for list.daliuren.cc
 * 100% Offline Cache-First Strategy for Clean Single-File Application
 */

const CACHE_NAME = 'list-face-attendance-v4';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/tailwind.min.css',
  './css/custom.css',
  './js/app.js',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v4...');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .catch(err => console.error('[SW] Cache addAll error:', err))
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker v4...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch((err) => {
        console.warn('[SW] Offline fetch fallback failed:', err);
      });
    })
  );
});
