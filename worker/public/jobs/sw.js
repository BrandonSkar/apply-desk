// Lets Apply Desk be installed to a phone's home screen. It caches nothing: every request goes to the network,
// so the queue and your answers are always current.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
