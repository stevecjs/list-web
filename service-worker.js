/**
 * service-worker.js - Progressive Web App Service Worker for list.daliuren.cc
 * 100% Offline Cache-First Strategy for HTML, JS, CSS, and Local Model Binaries
 */

const CACHE_NAME = 'list-face-attendance-v1';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/tailwind.min.css',
  './css/custom.css',
  './js/face-api.min.js',
  './js/db.js',
  './js/sound.js',
  './js/app.js',
  './models/tiny_face_detector_model-weights_manifest.json',
  './models/tiny_face_detector_model-shard1',
  './models/face_landmark_68_tiny_model-weights_manifest.json',
  './models/face_landmark_68_tiny_model-shard1',
  './models/face_recognition_model-weights_manifest.json',
  './models/face_recognition_model-shard1',
  './models/face_recognition_model-shard2',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// Install Event - Pre-cache all static assets & model binaries
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker and caching assets...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Cache addAll error:', err))
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
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

// Fetch Event - Cache-First Strategy
self.addEventListener('fetch', (event) => {
  // Only intercept GET requests
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
        // Dynamically cache new valid responses
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
